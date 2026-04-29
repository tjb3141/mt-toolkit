<script lang="ts">
	import { supabase } from '$lib/supabase';
	import HomeButton from '$lib/HomeButton.svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	type Participant = { id: string; name: string; joined_at: string };
	type Genre = { id: string; name: string };
	type PendingPair = { p1: Participant; p2: Participant };
	type LivePair = {
		id: string;
		participant_1_id: string;
		participant_2_id: string;
		track_id: string | null;
		found: boolean;
		p1Name: string;
		p2Name: string;
		trackTitle: string;
	};

	let qrDataUrl = $state('');
	let participants = $state<Participant[]>([]);
	let genres = $state<Genre[]>([]);
	let selectedGenreId = $state<string | null>(null);
	let pendingPairs = $state<PendingPair[]>([]);
	let unpaired = $state<Participant[]>([]);
	let selecting = $state<Participant | null>(null);
	let assignmentMode = $state<'auto' | 'manual' | null>(null);
	let pairs = $state<LivePair[]>([]);
	let startingGame = $state(false);

	const _initialState = untrack(() => session.playback_state);
	let localPhase = $state<'lobby' | 'assigning' | 'playing' | 'ended'>(
		_initialState === 'playing' ? 'playing' : _initialState === 'ended' ? 'ended' : 'lobby'
	);

	let channel: RealtimeChannel | null = null;
	let pairsChannel: RealtimeChannel | null = null;

	const joinUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${session.code}`
	);
	const allFound = $derived(pairs.length > 0 && pairs.every((p) => p.found));

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

		const [{ data: pData }, { data: gData }] = await Promise.all([
			supabase
				.from('participants')
				.select('id, name, joined_at')
				.eq('session_id', session.id)
				.order('joined_at'),
			supabase.from('playlists').select('id, name').order('display_order')
		]);
		participants = pData ?? [];
		genres = gData ?? [];

		if (localPhase === 'playing') {
			await loadLivePairs();
		}

		channel = supabase
			.channel(`host-partners:${session.id}`)
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
					if (payload.new.playback_state === 'ended') localPhase = 'ended';
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
		if (pairsChannel) supabase.removeChannel(pairsChannel);
	});

	async function loadLivePairs() {
		const { data: pairData } = await supabase
			.from('partners_pairs')
			.select('id, participant_1_id, participant_2_id, track_id, found')
			.eq('session_id', session.id);

		if (!pairData || pairData.length === 0) return;

		const participantIds = [
			...new Set(pairData.flatMap((p) => [p.participant_1_id, p.participant_2_id]))
		];
		const trackIds = [...new Set(pairData.map((p) => p.track_id).filter(Boolean))] as string[];

		const { data: pData } = await supabase
			.from('participants')
			.select('id, name')
			.in('id', participantIds);
		const { data: tData } =
			trackIds.length > 0
				? await supabase.from('tracks').select('id, title').in('id', trackIds)
				: { data: [] };

		const pMap = Object.fromEntries((pData ?? []).map((p) => [p.id, p.name]));
		const tMap = Object.fromEntries((tData ?? []).map((t) => [t.id, t.title]));

		pairs = pairData.map((p) => ({
			...p,
			p1Name: pMap[p.participant_1_id] ?? '?',
			p2Name: pMap[p.participant_2_id] ?? '?',
			trackTitle: p.track_id ? (tMap[p.track_id] ?? '?') : '-'
		}));

		if (pairsChannel) await supabase.removeChannel(pairsChannel);
		subscribeToPairs();
	}

	function subscribeToPairs() {
		pairsChannel = supabase
			.channel(`pairs:${session.id}:${Date.now()}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'partners_pairs',
					filter: `session_id=eq.${session.id}`
				},
				(payload) => {
					pairs = pairs.map((p) =>
						p.id === payload.new.id ? { ...p, found: payload.new.found } : p
					);
				}
			)
			.subscribe();
	}

	function startAssigning(mode: 'auto' | 'manual') {
		assignmentMode = mode;
		pendingPairs = [];
		unpaired = [...participants];
		selecting = null;

		if (mode === 'auto') {
			const shuffled = shuffle([...participants]);
			const newPairs: PendingPair[] = [];
			for (let i = 0; i + 1 < shuffled.length; i += 2) {
				newPairs.push({ p1: shuffled[i], p2: shuffled[i + 1] });
			}
			pendingPairs = newPairs;
			unpaired = shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : [];
		}

		localPhase = 'assigning';
	}

	function manualSelect(p: Participant) {
		if (!selecting) {
			selecting = p;
		} else if (selecting.id === p.id) {
			selecting = null;
		} else {
			pendingPairs = [...pendingPairs, { p1: selecting, p2: p }];
			unpaired = unpaired.filter((u) => u.id !== selecting!.id && u.id !== p.id);
			selecting = null;
		}
	}

	function removePair(idx: number) {
		const pair = pendingPairs[idx];
		pendingPairs = pendingPairs.filter((_, i) => i !== idx);
		unpaired = [...unpaired, pair.p1, pair.p2];
	}

	async function startGame() {
		startingGame = true;
		const trackQuery = supabase.from('tracks').select('id, title');
		if (selectedGenreId) trackQuery.eq('playlist_id', selectedGenreId);
		const { data: trackData } = await trackQuery;
		const shuffledTracks = shuffle(trackData ?? []);
		const trackMap = Object.fromEntries((trackData ?? []).map((t) => [t.id, t.title]));

		const pairRows = pendingPairs.map((pair, i) => ({
			session_id: session.id,
			participant_1_id: pair.p1.id,
			participant_2_id: pair.p2.id,
			track_id: shuffledTracks[i % shuffledTracks.length]?.id ?? null,
			found: false
		}));

		// Use .select() to get inserted IDs back; build pairs directly, never re-query old rows.
		const { data: inserted } = await supabase
			.from('partners_pairs')
			.insert(pairRows)
			.select('id, participant_1_id, participant_2_id, track_id, found');

		await supabase.from('sessions').update({ playback_state: 'playing' }).eq('id', session.id);

		const p1Map = Object.fromEntries(pendingPairs.map((p) => [p.p1.id, p]));
		pairs = (inserted ?? []).map((row) => ({
			...row,
			p1Name: p1Map[row.participant_1_id]?.p1.name ?? '?',
			p2Name: p1Map[row.participant_1_id]?.p2.name ?? '?',
			trackTitle: row.track_id ? (trackMap[row.track_id] ?? '?') : '-'
		}));

		if (pairsChannel) await supabase.removeChannel(pairsChannel);
		subscribeToPairs();

		localPhase = 'playing';
		startingGame = false;
	}

	async function markFound(pairId: string) {
		await supabase.from('partners_pairs').update({ found: true }).eq('id', pairId);
		pairs = pairs.map((p) => (p.id === pairId ? { ...p, found: true } : p));
	}

	async function restartSamePairs() {
		startingGame = true;

		const trackQuery = supabase.from('tracks').select('id, title');
		if (selectedGenreId) trackQuery.eq('playlist_id', selectedGenreId);
		const { data: trackData } = await trackQuery;
		const shuffledTracks = shuffle(trackData ?? []);
		const trackMap = Object.fromEntries((trackData ?? []).map((t) => [t.id, t.title]));

		// Assign new tracks to each pair and reset found before the async spread.
		const assignments = pairs.map((pair, i) => ({
			id: pair.id,
			trackId: shuffledTracks[i % shuffledTracks.length]?.id ?? null
		}));

		await Promise.all(
			assignments.map(({ id, trackId }) =>
				supabase
					.from('partners_pairs')
					.update({ found: false, track_id: trackId })
					.eq('id', id)
					.then()
			)
		);

		// Update local state immediately with no DB re-query or stale rows.
		pairs = pairs.map((pair, i) => ({
			...pair,
			found: false,
			track_id: assignments[i].trackId,
			trackTitle: assignments[i].trackId ? (trackMap[assignments[i].trackId!] ?? '?') : '-'
		}));

		if (pairsChannel) await supabase.removeChannel(pairsChannel);
		subscribeToPairs();

		startingGame = false;
	}

	async function reassignPairs() {
		await supabase.from('partners_pairs').delete().eq('session_id', session.id);
		await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);
		pairs = [];
		pendingPairs = [];
		unpaired = [...participants];
		selecting = null;
		assignmentMode = null;
		localPhase = 'lobby';
	}

	async function endSession() {
		await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
		localPhase = 'ended';
	}
</script>

{#if localPhase === 'lobby'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col items-center gap-6 px-5 py-6"
	>
		<div class="flex w-full items-center justify-between gap-4">
			<p class="music-kicker">Partners Host</p>
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
			<p class="music-kicker mb-3">
				Participants ({participants.length})
			</p>
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
					onclick={() => startAssigning('auto')}
					class="primary-glow rounded-2xl py-5 text-xl font-black text-white transition active:scale-95"
				>
					Auto Assign Partners
				</button>
				<button
					onclick={() => startAssigning('manual')}
					class="music-panel rounded-2xl py-5 text-xl font-black text-white transition hover:border-white/25 active:scale-95"
				>
					Assign Manually
				</button>
			</div>
		{:else}
			<p class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
				Waiting for at least 2 participants...
			</p>
		{/if}
	</div>
{:else if localPhase === 'assigning'}
	<div class="stage-shell mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-5 py-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<p class="music-kicker">Partners Host</p>
				<h2 class="stage-title mt-2 text-4xl font-black">Pair the room</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{assignmentMode === 'auto'
						? 'Auto-assigned. Remove pairs to adjust.'
						: 'Tap two participants to pair them.'}
				</p>
			</div>
			<HomeButton class="shrink-0" />
		</div>

		{#if assignmentMode === 'manual'}
			<div>
				<p class="mb-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
					Unpaired ({unpaired.length})
				</p>
				<div class="flex flex-wrap gap-2">
					{#each unpaired as p (p.id)}
						<button
							onclick={() => manualSelect(p)}
							class="rounded-xl px-4 py-3 font-semibold transition-all active:scale-95
								{selecting?.id === p.id ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}"
						>
							{p.name}
						</button>
					{/each}
				</div>
				{#if selecting}
					<p class="mt-3 text-sm text-violet-400">
						Now tap someone to pair with {selecting.name}
					</p>
				{/if}
			</div>
		{/if}

		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">
				Pairs ({pendingPairs.length})
			</p>
			{#if pendingPairs.length === 0}
				<p class="text-sm text-zinc-400">No pairs yet.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each pendingPairs as pair, i}
						<li class="flex items-center justify-between rounded-xl bg-white/5 px-5 py-4">
							<span class="font-semibold">{pair.p1.name} + {pair.p2.name}</span>
							<button
								onclick={() => removePair(i)}
								class="ml-4 text-sm text-zinc-600 hover:text-red-400"
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if unpaired.length > 0 && assignmentMode === 'manual'}
			<p class="text-sm text-zinc-500">
				{unpaired.length} person{unpaired.length !== 1 ? 's' : ''} unpaired. They won't play.
			</p>
		{/if}

		<div class="music-panel rounded-2xl p-5">
			<p class="music-kicker mb-3">Playlist</p>
			<div class="flex flex-wrap gap-2">
				<button
					onclick={() => (selectedGenreId = null)}
					class="rounded-xl px-4 py-2 text-sm font-semibold transition-all {selectedGenreId === null
						? 'bg-violet-600 text-white'
						: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
				>
					All playlists
				</button>
				{#each genres as g (g.id)}
					<button
						onclick={() => (selectedGenreId = g.id)}
						class="rounded-xl px-4 py-2 text-sm font-semibold transition-all {selectedGenreId ===
						g.id
							? 'bg-violet-600 text-white'
							: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
					>
						{g.name}
					</button>
				{/each}
			</div>
		</div>

		<div class="mt-auto flex gap-3">
			<button
				onclick={() => (localPhase = 'lobby')}
				class="music-panel flex-1 rounded-2xl py-4 font-bold transition hover:border-white/25"
			>
				Back
			</button>
			<button
				onclick={startGame}
				disabled={pendingPairs.length === 0 || startingGame}
				class="flex-1 rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
			>
				{startingGame ? 'Starting...' : 'Start Game'}
			</button>
		</div>
	</div>
{:else if localPhase === 'playing'}
	<div class="stage-shell mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-5 py-6">
		<div class="flex items-center justify-between">
			<p class="music-kicker">Find Your Match</p>
			<div class="flex items-center gap-4">
				<span class="text-xs text-zinc-500"
					>{pairs.filter((p) => p.found).length}/{pairs.length} found</span
				>
				<HomeButton class="shrink-0" />
			</div>
		</div>

		{#if allFound}
			<div class="music-panel-strong flex flex-col gap-4 rounded-2xl px-6 py-5">
				<p class="text-center text-2xl font-black text-emerald-400">All pairs found!</p>
				<div>
					<p class="mb-2 text-xs font-semibold tracking-widest text-zinc-400 uppercase">
						Playlist for next round
					</p>
					<div class="flex flex-wrap gap-2">
						<button
							onclick={() => (selectedGenreId = null)}
							class="rounded-xl px-3 py-2 text-sm font-semibold transition-all {selectedGenreId ===
							null
								? 'bg-violet-600 text-white'
								: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
						>
							All playlists
						</button>
						{#each genres as g (g.id)}
							<button
								onclick={() => (selectedGenreId = g.id)}
								class="rounded-xl px-3 py-2 text-sm font-semibold transition-all {selectedGenreId ===
								g.id
									? 'bg-violet-600 text-white'
									: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
							>
								{g.name}
							</button>
						{/each}
					</div>
				</div>
				<div class="flex gap-3">
					<button
						onclick={restartSamePairs}
						disabled={startingGame}
						class="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
					>
						{startingGame ? 'Starting...' : 'Same pairs, new songs'}
					</button>
					<button
						onclick={reassignPairs}
						class="flex-1 rounded-xl bg-zinc-700 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-600"
					>
						New pairs
					</button>
				</div>
			</div>
		{/if}

		<ul class="flex flex-col gap-3">
			{#each pairs as pair (pair.id)}
				<li
					class="music-panel rounded-2xl px-5 py-4 transition-opacity {pair.found
						? 'opacity-40'
						: ''}"
				>
					<div class="flex items-center justify-between gap-4">
						<div class="min-w-0">
							<p class="font-bold">{pair.p1Name} + {pair.p2Name}</p>
							<p class="truncate text-sm text-zinc-500">{pair.trackTitle}</p>
						</div>
						{#if !pair.found}
							<button
								onclick={() => markFound(pair.id)}
								class="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 active:scale-95"
							>
								Found!
							</button>
						{:else}
							<span class="shrink-0 text-sm font-bold text-emerald-400">Found</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<button
			onclick={endSession}
			class="mt-auto text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
		>
			End session
		</button>
	</div>
{:else}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">Partners Host</p>
		<p class="stage-title text-4xl font-black">Session complete</p>
		<p class="text-zinc-500">All pairs found. Great session!</p>
		<HomeButton />
	</div>
{/if}
