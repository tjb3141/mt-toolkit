<script lang="ts">
	import { supabase } from '$lib/supabase';
	import HomeButton from '$lib/HomeButton.svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	type Participant = { id: string; name: string; joined_at: string };
	type Playlist = { id: string; name: string };

	const _initialState = untrack(() => session.playback_state);
	type Phase = 'lobby' | 'setup' | 'playing' | 'ended';
	// Only skip lobby if there's an active round — determined after loadCurrentRoundState runs.
	// A fresh session starts paused with no rounds, so always start at lobby.
	let localPhase = $state<Phase>(_initialState === 'ended' ? 'ended' : 'lobby');

	let qrDataUrl = $state('');
	let participants = $state<Participant[]>([]);
	let playlists = $state<Playlist[]>([]);
	let eliminatedIds = $state<Set<string>>(new Set());

	let selectedPlaylistId = $state<string | null>(null);
	let currentRound = $state(0);
	let playbackState = $state(untrack(() => session.playback_state));
	let starting = $state(false);

	let channel: RealtimeChannel | null = null;

	const joinUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${session.code}`
	);

	function shuffle<T>(arr: T[]): T[] {
		return [...arr].sort(() => Math.random() - 0.5);
	}

	onMount(async () => {
		const url = `${window.location.origin}/join/${session.code}`;
		qrDataUrl = await QRCode.toDataURL(url, {
			margin: 2,
			scale: 6,
			color: { dark: '#ffffff', light: '#18181b' }
		});

		const [{ data: pData }, { data: plData }] = await Promise.all([
			supabase
				.from('participants')
				.select('id, name, joined_at')
				.eq('session_id', session.id)
				.order('joined_at'),
			supabase.from('playlists').select('id, name').order('display_order')
		]);
		participants = pData ?? [];
		playlists = plData ?? [];

		await loadCurrentRoundState();

		channel = supabase
			.channel(`freeze-host:${session.id}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'participants',
					filter: `session_id=eq.${session.id}`
				},
				(payload) => {
					participants = [...participants, payload.new as Participant];
				}
			)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
				(payload) => {
					playbackState = payload.new.playback_state;
					if (payload.new.playback_state === 'ended') localPhase = 'ended';
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'freeze_dance_eliminations'
				},
				(payload) => {
					if (payload.new.session_id !== session.id) return;
					eliminatedIds = new Set([...eliminatedIds, payload.new.participant_id]);
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'DELETE',
					schema: 'public',
					table: 'freeze_dance_eliminations'
				},
				async () => {
					await reloadEliminations();
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
	});

	async function loadCurrentRoundState() {
		const { data: round } = await supabase
			.from('freeze_dance_rounds')
			.select('round, track_id')
			.eq('session_id', session.id)
			.order('round', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (round) {
			currentRound = round.round;
			// Restore playlist selection so "Next Round" pre-selects the same playlist
			const { data: track } = await supabase
				.from('tracks')
				.select('playlist_id')
				.eq('id', round.track_id)
				.single();
			if (track?.playlist_id) selectedPlaylistId = track.playlist_id;
			// Resume into playing phase (mid-session reload)
			localPhase = 'playing';
		}

		await reloadEliminations();
	}

	async function reloadEliminations() {
		const { data } = await supabase
			.from('freeze_dance_eliminations')
			.select('participant_id')
			.eq('session_id', session.id);
		eliminatedIds = new Set((data ?? []).map((r) => r.participant_id));
	}

	async function startRound() {
		if (!selectedPlaylistId) return;
		starting = true;

		const { data: trackRows } = await supabase
			.from('tracks')
			.select('id')
			.eq('playlist_id', selectedPlaylistId);

		const track = shuffle(trackRows ?? [])[0];
		if (!track) { starting = false; return; }

		const nextRound = currentRound + 1;

		// Clear eliminations before inserting new round so clients don't see a stale state
		await supabase.from('freeze_dance_eliminations').delete().eq('session_id', session.id);

		await supabase.from('freeze_dance_rounds').insert({
			session_id: session.id,
			round: nextRound,
			track_id: track.id
		});

		// Write paused to session so clients receive the realtime signal and load the new round
		await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);

		eliminatedIds = new Set();
		currentRound = nextRound;
		playbackState = 'paused';
		localPhase = 'playing';
		starting = false;
	}

	async function togglePlayback() {
		const next = playbackState === 'playing' ? 'paused' : 'playing';
		await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
		playbackState = next;
	}

	async function markOut(participantId: string) {
		await supabase.from('freeze_dance_eliminations').insert({
			session_id: session.id,
			participant_id: participantId
		});
		eliminatedIds = new Set([...eliminatedIds, participantId]);
	}

	async function restoreAll() {
		await supabase
			.from('freeze_dance_eliminations')
			.delete()
			.eq('session_id', session.id);
		eliminatedIds = new Set();
	}

	async function nextRound() {
		localPhase = 'setup';
	}

	async function endSession() {
		await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
		playbackState = 'ended';
		localPhase = 'ended';
	}

	const activeParticipants = $derived(
		participants.filter((p) => !eliminatedIds.has(p.id))
	);
	const eliminatedParticipants = $derived(
		participants.filter((p) => eliminatedIds.has(p.id))
	);
</script>

{#if localPhase === 'lobby'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col items-center gap-6 px-5 py-6"
	>
		<div class="flex w-full items-center justify-between gap-4">
			<p class="music-kicker">Freeze Dance Host</p>
			<HomeButton class="shrink-0" />
		</div>

		<section class="music-panel-strong w-full rounded-2xl p-6 text-center">
			<p class="music-kicker mb-3">Room Code</p>
			<p class="stage-title text-7xl font-black tracking-widest sm:text-8xl">{session.code}</p>
			<p class="mt-4 text-sm font-semibold text-cyan-100">Get everyone into the room first</p>
		</section>

		{#if qrDataUrl}
			<div class="music-panel rounded-2xl p-4">
				<img src={qrDataUrl} alt="QR code to join session" class="h-52 w-52" />
			</div>
		{/if}

		<p class="max-w-sm text-center text-xs break-all text-zinc-400">{joinUrl}</p>

		<div class="music-panel w-full rounded-2xl p-5">
			<p class="music-kicker mb-3">Participants ({participants.length})</p>
			{#if participants.length === 0}
				<p class="text-sm text-zinc-400">No one has joined yet.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each participants as p (p.id)}
						<li class="rounded-xl bg-white/5 px-5 py-4 font-semibold">{p.name}</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if participants.length >= 1}
			<button
				onclick={() => (localPhase = 'setup')}
				class="primary-glow w-full max-w-sm rounded-2xl py-5 text-xl font-black text-white transition active:scale-95"
			>
				Pick a playlist &amp; start
			</button>
		{:else}
			<p class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
				Waiting for participants...
			</p>
		{/if}
	</div>

{:else if localPhase === 'setup'}
	<div class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-5 py-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<p class="music-kicker">Freeze Dance Host</p>
				<h2 class="stage-title mt-2 text-4xl font-black">
					{currentRound > 0 ? `Round ${currentRound + 1}` : 'Pick a playlist'}
				</h2>
			</div>
			<HomeButton class="shrink-0" />
		</div>

		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">Playlist</p>
			<p class="mb-3 text-sm text-zinc-400">Everyone hears the same random track.</p>
			<div class="flex flex-wrap gap-2">
				{#each playlists as pl (pl.id)}
					<button
						onclick={() => (selectedPlaylistId = pl.id)}
						class="rounded-xl px-4 py-2 text-sm font-semibold transition-all {selectedPlaylistId ===
						pl.id
							? 'bg-cyan-600 text-white'
							: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
					>
						{pl.name}
					</button>
				{/each}
			</div>
		</div>

		<div class="mt-auto flex gap-3">
			<button
				onclick={() => (localPhase = currentRound > 0 ? 'playing' : 'lobby')}
				class="music-panel flex-1 rounded-2xl py-4 font-bold transition hover:border-white/25"
			>
				Back
			</button>
			<button
				onclick={startRound}
				disabled={starting || !selectedPlaylistId}
				class="flex-1 rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
			>
				{starting ? 'Starting...' : currentRound > 0 ? 'Start Next Round' : 'Start Round'}
			</button>
		</div>
	</div>

{:else if localPhase === 'playing'}
	<div class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 px-5 py-6">
		<div class="flex w-full items-center justify-between gap-4">
			<div>
				<p class="music-kicker">Freeze Dance Host</p>
				<p class="mt-1 text-xs text-zinc-500">Round {currentRound}</p>
			</div>
			<HomeButton class="shrink-0" />
		</div>

		<div class="flex flex-col items-center gap-4">
			<button
				onclick={togglePlayback}
				class="grid h-44 w-44 place-items-center rounded-full text-3xl font-black text-white shadow-2xl transition-all active:scale-95 {playbackState ===
				'playing'
					? 'bg-red-500 shadow-red-950 hover:bg-red-400'
					: 'bg-emerald-500 shadow-emerald-950 hover:bg-emerald-400'}"
			>
				{playbackState === 'playing' ? 'Pause' : 'Play'}
			</button>
			{#if playbackState === 'paused'}
				<p class="text-sm font-semibold text-red-400">Music stopped — mark anyone who moved</p>
			{:else}
				<p class="text-sm font-semibold text-emerald-400">Music playing</p>
			{/if}
		</div>

		<div class="music-panel w-full rounded-2xl p-5">
			<div class="mb-3 flex items-center justify-between">
				<p class="music-kicker">Still in ({activeParticipants.length})</p>
				{#if playbackState === 'paused' && eliminatedIds.size > 0}
					<button
						onclick={restoreAll}
						class="text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
					>
						Restore all
					</button>
				{/if}
			</div>
			{#if activeParticipants.length === 0}
				<p class="text-sm text-zinc-400">No active players.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each activeParticipants as p (p.id)}
						<li class="flex items-center justify-between rounded-xl bg-white/5 px-5 py-4">
							<span class="font-semibold">{p.name}</span>
							{#if playbackState === 'paused'}
								<button
									onclick={() => markOut(p.id)}
									class="rounded-full bg-red-900/60 px-3 py-1 text-xs font-bold text-red-300 transition hover:bg-red-800"
								>
									Mark out
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if eliminatedParticipants.length > 0}
			<div class="music-panel w-full rounded-2xl p-5">
				<p class="music-kicker mb-3 text-zinc-500">Out ({eliminatedParticipants.length})</p>
				<ul class="flex flex-col gap-2">
					{#each eliminatedParticipants as p (p.id)}
						<li class="flex items-center gap-3 rounded-xl bg-white/5 px-5 py-4">
							<span class="text-xl" aria-hidden="true">🧊</span>
							<span class="font-semibold text-zinc-400">{p.name}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="mt-auto flex flex-col gap-3">
			<button
				onclick={nextRound}
				class="w-full rounded-2xl bg-cyan-600 py-4 text-lg font-black text-white transition-colors hover:bg-cyan-500 active:scale-95"
			>
				Next Round
			</button>
			<button
				onclick={endSession}
				class="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
			>
				End session
			</button>
		</div>
	</div>

{:else}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">Freeze Dance Host</p>
		<p class="stage-title text-4xl font-black">Session complete</p>
		<p class="text-zinc-500">Thanks for playing!</p>
		<HomeButton />
	</div>
{/if}
