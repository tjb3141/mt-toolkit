<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	type Participant = { id: string; name: string; joined_at: string };
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

		const { data } = await supabase
			.from('participants')
			.select('id, name, joined_at')
			.eq('session_id', session.id)
			.order('joined_at');
		participants = data ?? [];

		if (localPhase === 'playing') {
			await loadLivePairs();
		}

		channel = supabase
			.channel(`host-partners:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'participants', filter: `session_id=eq.${session.id}` },
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
			trackTitle: p.track_id ? (tMap[p.track_id] ?? '?') : '—'
		}));

		subscribeToPairs();
	}

	function subscribeToPairs() {
		pairsChannel = supabase
			.channel(`pairs:${session.id}`)
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
		const { data: trackData } = await supabase.from('tracks').select('id, title');
		const shuffledTracks = shuffle(trackData ?? []);

		const pairRows = pendingPairs.map((pair, i) => ({
			session_id: session.id,
			participant_1_id: pair.p1.id,
			participant_2_id: pair.p2.id,
			track_id: shuffledTracks[i % shuffledTracks.length]?.id ?? null,
			found: false
		}));

		await supabase.from('partners_pairs').insert(pairRows);
		await supabase.from('sessions').update({ playback_state: 'playing' }).eq('id', session.id);

		localPhase = 'playing';
		startingGame = false;
		await loadLivePairs();
	}

	async function markFound(pairId: string) {
		await supabase.from('partners_pairs').update({ found: true }).eq('id', pairId);
		pairs = pairs.map((p) => (p.id === pairId ? { ...p, found: true } : p));
	}

	async function endSession() {
		await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
		localPhase = 'ended';
	}
</script>

{#if localPhase === 'lobby'}
	<div class="flex min-h-screen flex-col items-center gap-8 p-8">
		<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
			MT Toolkit · Partners · Host
		</p>

		<div class="text-center">
			<p class="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">Session code</p>
			<p class="text-7xl font-black tracking-widest">{session.code}</p>
		</div>

		{#if qrDataUrl}
			<div class="rounded-2xl bg-zinc-900 p-3">
				<img src={qrDataUrl} alt="QR code to join session" class="h-44 w-44" />
			</div>
		{/if}

		<p class="max-w-xs break-all text-center text-xs text-zinc-500">{joinUrl}</p>

		<div class="w-full max-w-sm">
			<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
				Participants ({participants.length})
			</p>
			{#if participants.length === 0}
				<p class="text-sm text-zinc-600">No one has joined yet.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each participants as p (p.id)}
						<li class="rounded-2xl bg-zinc-900 px-5 py-4 font-semibold">{p.name}</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if participants.length >= 2}
			<div class="flex w-full max-w-sm flex-col gap-3">
				<button
					onclick={() => startAssigning('auto')}
					class="rounded-2xl bg-violet-600 py-4 text-lg font-bold text-white transition-colors hover:bg-violet-500"
				>
					Auto Assign Partners
				</button>
				<button
					onclick={() => startAssigning('manual')}
					class="rounded-2xl bg-zinc-800 py-4 text-lg font-bold text-white transition-colors hover:bg-zinc-700"
				>
					Assign Manually
				</button>
			</div>
		{:else}
			<p class="text-sm text-zinc-600">Waiting for at least 2 participants…</p>
		{/if}
	</div>

{:else if localPhase === 'assigning'}
	<div class="flex min-h-screen flex-col gap-6 p-8">
		<div>
			<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
				MT Toolkit · Partners · Host
			</p>
			<h2 class="mt-2 text-3xl font-black">Assign Partners</h2>
			<p class="mt-1 text-sm text-zinc-500">
				{assignmentMode === 'auto'
					? 'Auto-assigned — remove pairs to adjust.'
					: 'Tap two participants to pair them.'}
			</p>
		</div>

		{#if assignmentMode === 'manual'}
			<div>
				<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
					Unpaired ({unpaired.length})
				</p>
				<div class="flex flex-wrap gap-2">
					{#each unpaired as p (p.id)}
						<button
							onclick={() => manualSelect(p)}
							class="rounded-xl px-4 py-3 font-semibold transition-all active:scale-95
								{selecting?.id === p.id
								? 'bg-violet-600 text-white'
								: 'bg-zinc-800 text-white hover:bg-zinc-700'}"
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

		<div>
			<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
				Pairs ({pendingPairs.length})
			</p>
			{#if pendingPairs.length === 0}
				<p class="text-sm text-zinc-600">No pairs yet.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each pendingPairs as pair, i}
						<li class="flex items-center justify-between rounded-2xl bg-zinc-900 px-5 py-4">
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
				{unpaired.length} person{unpaired.length !== 1 ? 's' : ''} unpaired — they won't play.
			</p>
		{/if}

		<div class="mt-auto flex gap-3">
			<button
				onclick={() => (localPhase = 'lobby')}
				class="flex-1 rounded-2xl bg-zinc-800 py-4 font-bold transition-colors hover:bg-zinc-700"
			>
				Back
			</button>
			<button
				onclick={startGame}
				disabled={pendingPairs.length === 0 || startingGame}
				class="flex-1 rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
			>
				{startingGame ? 'Starting…' : 'Start Game →'}
			</button>
		</div>
	</div>

{:else if localPhase === 'playing'}
	<div class="flex min-h-screen flex-col gap-6 p-8">
		<div class="flex items-center justify-between">
			<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
				MT Toolkit · Partners · Host
			</p>
			<span class="text-xs text-zinc-500">{pairs.filter((p) => p.found).length}/{pairs.length} found</span>
		</div>

		{#if allFound}
			<div class="rounded-2xl border border-emerald-700 bg-emerald-900/30 px-6 py-5 text-center">
				<p class="text-2xl font-black text-emerald-400">All pairs found!</p>
			</div>
		{/if}

		<ul class="flex flex-col gap-3">
			{#each pairs as pair (pair.id)}
				<li
					class="rounded-2xl bg-zinc-900 px-5 py-4 transition-opacity {pair.found ? 'opacity-40' : ''}"
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
							<span class="shrink-0 text-sm font-bold text-emerald-400">✓ Found</span>
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
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
		<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
			MT Toolkit · Partners · Host
		</p>
		<p class="text-2xl font-black">Session complete</p>
		<p class="text-zinc-500">All pairs found. Great session!</p>
	</div>
{/if}
