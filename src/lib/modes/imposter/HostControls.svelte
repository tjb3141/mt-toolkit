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
	type RoundRow = {
		id: string;
		round: number;
		town_playlist_id: string | null;
		imposter_playlist_id: string | null;
		imposter_participant_id: string | null;
		town_track_id: string | null;
		imposter_track_id: string | null;
	};

	const _initialState = untrack(() => session.playback_state);
	type Phase = 'lobby' | 'setup' | 'playing' | 'revealed' | 'ended';
	let localPhase = $state<Phase>(
		_initialState === 'playing'
			? 'playing'
			: _initialState === 'revealed'
				? 'revealed'
				: _initialState === 'ended'
					? 'ended'
					: 'lobby'
	);

	let qrDataUrl = $state('');
	let participants = $state<Participant[]>([]);
	let playlists = $state<Playlist[]>([]);

	// Setup state
	let townPlaylistId = $state<string | null>(null);
	let imposterPlaylistId = $state<string | null>(null);
	let assignmentMode = $state<'auto' | 'manual' | null>(null);
	let selectedImposterId = $state<string | null>(null); // manual pick

	// Live round state
	let currentRound = $state<RoundRow | null>(null);
	let currentRoundNumber = $state(0);
	let imposterParticipantId = $state<string | null>(null);

	let starting = $state(false);
	let playbackState = $state(untrack(() => session.playback_state));

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

		if (localPhase === 'playing' || localPhase === 'revealed') {
			await loadLatestRound();
		}

		channel = supabase
			.channel(`imposter-host:${session.id}`)
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
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
	});

	async function loadLatestRound() {
		const { data } = await supabase
			.from('imposter_rounds')
			.select(
				'id, round, town_playlist_id, imposter_playlist_id, imposter_participant_id, town_track_id, imposter_track_id'
			)
			.eq('session_id', session.id)
			.order('round', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (data) {
			currentRound = data;
			currentRoundNumber = data.round;
			imposterParticipantId = data.imposter_participant_id;
			townPlaylistId = data.town_playlist_id;
			imposterPlaylistId = data.imposter_playlist_id;
		}
	}

	function goToSetup(mode: 'auto' | 'manual') {
		assignmentMode = mode;
		selectedImposterId = null;
		localPhase = 'setup';
	}

	async function startRound() {
		if (!townPlaylistId || !imposterPlaylistId) return;
		if (assignmentMode === 'manual' && !selectedImposterId) return;

		starting = true;

		// Pick random imposter if auto
		const imposterId =
			assignmentMode === 'auto'
				? shuffle(participants)[0].id
				: selectedImposterId!;

		// Pick random town track and imposter track
		const [{ data: townTracks }, { data: imposterTracks }] = await Promise.all([
			supabase.from('tracks').select('id').eq('playlist_id', townPlaylistId),
			supabase.from('tracks').select('id').eq('playlist_id', imposterPlaylistId)
		]);

		const townTrack = shuffle(townTracks ?? [])[0];
		const imposterTrack = shuffle(imposterTracks ?? [])[0];

		const nextRound = currentRoundNumber + 1;

		const { data: inserted } = await supabase
			.from('imposter_rounds')
			.insert({
				session_id: session.id,
				round: nextRound,
				town_playlist_id: townPlaylistId,
				imposter_playlist_id: imposterPlaylistId,
				imposter_participant_id: imposterId,
				town_track_id: townTrack?.id ?? null,
				imposter_track_id: imposterTrack?.id ?? null
			})
			.select()
			.single();

		await supabase.from('sessions').update({ playback_state: 'playing' }).eq('id', session.id);

		currentRound = inserted ?? null;
		currentRoundNumber = nextRound;
		imposterParticipantId = imposterId;
		playbackState = 'playing';
		localPhase = 'playing';
		starting = false;
	}

	async function togglePlayback() {
		const next = playbackState === 'playing' ? 'paused' : 'playing';
		await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
		playbackState = next;
	}

	async function reveal() {
		await supabase.from('sessions').update({ playback_state: 'revealed' }).eq('id', session.id);
		playbackState = 'revealed';
		localPhase = 'revealed';
	}

	async function endSession() {
		await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
		playbackState = 'ended';
		localPhase = 'ended';
	}

	const imposterName = $derived(
		participants.find((p) => p.id === imposterParticipantId)?.name ?? null
	);
</script>

{#if localPhase === 'lobby'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col items-center gap-6 px-5 py-6"
	>
		<div class="flex w-full items-center justify-between gap-4">
			<p class="music-kicker">Imposter Host</p>
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

		{#if participants.length >= 2}
			<div class="flex w-full max-w-sm flex-col gap-3">
				<button
					onclick={() => goToSetup('auto')}
					class="primary-glow rounded-2xl py-5 text-xl font-black text-white transition active:scale-95"
				>
					Auto-pick Imposter
				</button>
				<button
					onclick={() => goToSetup('manual')}
					class="music-panel rounded-2xl py-5 text-xl font-black text-white transition hover:border-white/25 active:scale-95"
				>
					Pick Imposter Manually
				</button>
			</div>
		{:else}
			<p class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
				Waiting for at least 2 participants...
			</p>
		{/if}
	</div>

{:else if localPhase === 'setup'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-5 py-6"
	>
		<div class="flex items-start justify-between gap-4">
			<div>
				<p class="music-kicker">Imposter Host</p>
				<h2 class="stage-title mt-2 text-4xl font-black">Set up the round</h2>
			</div>
			<HomeButton class="shrink-0" />
		</div>

		<!-- Town playlist -->
		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">Town playlist</p>
			<p class="mb-3 text-sm text-zinc-400">Everyone except the imposter hears a track from this.</p>
			<div class="flex flex-wrap gap-2">
				{#each playlists as pl (pl.id)}
					<button
						onclick={() => (townPlaylistId = pl.id)}
						class="rounded-xl px-4 py-2 text-sm font-semibold transition-all {townPlaylistId === pl.id
							? 'bg-cyan-600 text-white'
							: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
					>
						{pl.name}
					</button>
				{/each}
			</div>
		</div>

		<!-- Imposter playlist -->
		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">Imposter playlist</p>
			<p class="mb-3 text-sm text-zinc-400">The imposter hears a random track from this instead.</p>
			<div class="flex flex-wrap gap-2">
				{#each playlists as pl (pl.id)}
					<button
						onclick={() => (imposterPlaylistId = pl.id)}
						class="rounded-xl px-4 py-2 text-sm font-semibold transition-all {imposterPlaylistId ===
						pl.id
							? 'bg-red-600 text-white'
							: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
					>
						{pl.name}
					</button>
				{/each}
			</div>
		</div>

		<!-- Manual imposter pick -->
		{#if assignmentMode === 'manual'}
			<div class="music-panel rounded-2xl p-5">
				<p class="music-kicker mb-3">Pick the imposter</p>
				<div class="flex flex-wrap gap-2">
					{#each participants as p (p.id)}
						<button
							onclick={() => (selectedImposterId = p.id)}
							class="rounded-xl px-4 py-3 font-semibold transition-all active:scale-95 {selectedImposterId ===
							p.id
								? 'bg-red-600 text-white'
								: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
						>
							{p.name}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="music-panel rounded-2xl p-5">
				<p class="music-kicker mb-1">Imposter selection</p>
				<p class="text-sm text-zinc-400">A random participant will be chosen when you start.</p>
			</div>
		{/if}

		<div class="mt-auto flex gap-3">
			<button
				onclick={() => (localPhase = 'lobby')}
				class="music-panel flex-1 rounded-2xl py-4 font-bold transition hover:border-white/25"
			>
				Back
			</button>
			<button
				onclick={startRound}
				disabled={starting ||
					!townPlaylistId ||
					!imposterPlaylistId ||
					(assignmentMode === 'manual' && !selectedImposterId)}
				class="flex-1 rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
			>
				{starting ? 'Starting...' : 'Start Round'}
			</button>
		</div>
	</div>

{:else if localPhase === 'playing'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-5 py-6"
	>
		<div class="flex w-full items-center justify-between gap-4">
			<div>
				<p class="music-kicker">Imposter Host</p>
				<p class="text-xs text-zinc-500">Round {currentRoundNumber}</p>
			</div>
			<HomeButton class="shrink-0" />
		</div>

		<!-- Play/pause -->
		<div class="flex flex-col items-center gap-4">
			<button
				onclick={togglePlayback}
				class="grid h-40 w-40 place-items-center rounded-full text-2xl font-black text-white shadow-2xl transition-all active:scale-95 {playbackState ===
				'playing'
					? 'bg-red-500 shadow-red-950 hover:bg-red-400'
					: 'bg-emerald-500 shadow-emerald-950 hover:bg-emerald-400'}"
			>
				{playbackState === 'playing' ? 'Pause' : 'Play'}
			</button>
		</div>

		<!-- Participant list with imposter label -->
		<div class="music-panel w-full rounded-2xl p-5">
			<p class="music-kicker mb-3">Participants ({participants.length})</p>
			{#if participants.length === 0}
				<p class="text-sm text-zinc-400">No participants.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each participants as p (p.id)}
						<li class="flex items-center justify-between rounded-xl bg-white/5 px-5 py-4">
							<span class="font-semibold">{p.name}</span>
							{#if p.id === imposterParticipantId}
								<span
									class="rounded-full bg-red-900/60 px-3 py-1 text-xs font-bold text-red-300"
								>
									Imposter
								</span>
							{:else}
								<span
									class="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400"
								>
									Townsperson
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="flex flex-col gap-3">
			<button
				onclick={reveal}
				class="w-full rounded-2xl bg-violet-600 py-5 text-xl font-black text-white transition-colors hover:bg-violet-500 active:scale-95"
			>
				Reveal Imposter
			</button>
			<button
				onclick={endSession}
				class="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
			>
				End session
			</button>
		</div>
	</div>

{:else if localPhase === 'revealed'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-5 py-6"
	>
		<div class="flex w-full items-center justify-between gap-4">
			<p class="music-kicker">Imposter Host — Revealed</p>
			<HomeButton class="shrink-0" />
		</div>

		<div class="music-panel-strong rounded-2xl p-8 text-center">
			<p class="music-kicker mb-4">The imposter was...</p>
			<p class="stage-title text-5xl font-black text-red-400">{imposterName ?? '...'}</p>
		</div>

		<!-- Participant list with labels still visible -->
		<div class="music-panel w-full rounded-2xl p-5">
			<p class="music-kicker mb-3">Participants</p>
			<ul class="flex flex-col gap-2">
				{#each participants as p (p.id)}
					<li class="flex items-center justify-between rounded-xl bg-white/5 px-5 py-4">
						<span class="font-semibold">{p.name}</span>
						{#if p.id === imposterParticipantId}
							<span class="rounded-full bg-red-900/60 px-3 py-1 text-xs font-bold text-red-300">
								Imposter
							</span>
						{:else}
							<span class="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400">
								Townsperson
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		<!-- New round options -->
		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">Play again?</p>
			<p class="mb-4 text-sm text-zinc-400">
				Same participants, same playlists — pick a new imposter.
			</p>
			<div class="flex flex-col gap-3">
				<button
					onclick={() => goToSetup('auto')}
					class="primary-glow rounded-2xl py-4 text-lg font-black text-white transition active:scale-95"
				>
					Auto-pick new imposter
				</button>
				<button
					onclick={() => goToSetup('manual')}
					class="music-panel rounded-2xl py-4 text-lg font-black text-white transition hover:border-white/25 active:scale-95"
				>
					Pick imposter manually
				</button>
			</div>
		</div>

		<button
			onclick={endSession}
			class="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
		>
			End session
		</button>
	</div>

{:else}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">Imposter Host</p>
		<p class="stage-title text-4xl font-black">Session complete</p>
		<p class="text-zinc-500">Thanks for playing!</p>
		<HomeButton />
	</div>
{/if}
