<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	let name = $state('');
	let participantId = $state<string | null>(null);
	let submittingName = $state(false);
	let playbackState = $state(untrack(() => session.playback_state));
	let audioEl = $state<HTMLAudioElement | null>(null);

	let trackId = $state<string | null>(null);
	let trackTitle = $state<string | null>(null);
	let isEliminated = $state(false);

	let channel: RealtimeChannel | null = null;
	let elimChannel: RealtimeChannel | null = null;

	function getUrl(id: string) {
		return `/api/audio/${id}?session=${session.id}`;
	}

	onMount(async () => {
		const saved = sessionStorage.getItem(`participant:${session.id}`);
		if (saved) {
			const { id, n } = JSON.parse(saved);
			participantId = id;
			name = n;
			const state = untrack(() => playbackState);
			if (state === 'playing' || state === 'paused') {
				await loadCurrentRound(id);
				await checkElimination(id);
			}
			subscribeToEliminations(id);
		}

		channel = supabase
			.channel(`freeze-client:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
				async (payload) => {
					const newState = payload.new.playback_state;
					playbackState = newState;
					if (!audioEl) return;
					if (newState === 'playing') {
						const pid = untrack(() => participantId);
						if (pid && !untrack(() => trackId)) {
							await loadCurrentRound(pid);
						}
						audioEl.play().catch(() => {});
					} else if (newState === 'paused') {
						audioEl.pause();
					} else {
						audioEl.pause();
					}
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'freeze_dance_rounds',
					filter: `session_id=eq.${session.id}`
				},
				async (_payload) => {
					const pid = untrack(() => participantId);
					if (!pid) return;
					isEliminated = false;
					await loadCurrentRound(pid);
					if (untrack(() => playbackState) === 'playing' && audioEl) {
						audioEl.play().catch(() => {});
					}
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
		if (elimChannel) supabase.removeChannel(elimChannel);
	});

	function subscribeToEliminations(pid: string) {
		elimChannel = supabase
			.channel(`freeze-elim:${session.id}:${pid}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'freeze_dance_eliminations',
					filter: `participant_id=eq.${pid}`
				},
				() => {
					isEliminated = true;
					if (audioEl) audioEl.pause();
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
					const pid2 = untrack(() => participantId);
					if (!pid2) return;
					const eliminated = await checkElimination(pid2);
					if (!eliminated && untrack(() => playbackState) === 'playing' && audioEl) {
						audioEl.play().catch(() => {});
					}
				}
			)
			.subscribe();
	}

	async function loadCurrentRound(pid: string) {
		const { data: round } = await supabase
			.from('freeze_dance_rounds')
			.select('track_id')
			.eq('session_id', session.id)
			.order('round', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (!round?.track_id) return;

		const { data: track } = await supabase
			.from('tracks')
			.select('id, title')
			.eq('id', round.track_id)
			.single();

		if (track) {
			trackId = track.id;
			trackTitle = track.title;
		}

		await checkElimination(pid);
	}

	async function checkElimination(pid: string): Promise<boolean> {
		const { data } = await supabase
			.from('freeze_dance_eliminations')
			.select('id')
			.eq('session_id', session.id)
			.eq('participant_id', pid)
			.maybeSingle();
		isEliminated = !!data;
		return !!data;
	}

	async function submitName(e: SubmitEvent) {
		e.preventDefault();
		submittingName = true;
		const { data, error } = await supabase
			.from('participants')
			.insert({ session_id: session.id, name: name.trim() })
			.select('id')
			.single();
		submittingName = false;
		if (!error && data) {
			participantId = data.id;
			sessionStorage.setItem(
				`participant:${session.id}`,
				JSON.stringify({ id: data.id, n: name.trim() })
			);
			const state = untrack(() => playbackState);
			if (state === 'playing' || state === 'paused') {
				await loadCurrentRound(data.id);
			}
			subscribeToEliminations(data.id);
		}
	}

	$effect(() => {
		const tid = trackId;
		const el = audioEl;
		if (!tid || !el) return;
		el.src = getUrl(tid);
		const state = untrack(() => playbackState);
		const eliminated = untrack(() => isEliminated);
		if (state === 'playing' && !eliminated) el.play().catch(() => {});
	});
</script>

{#if !participantId}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8"
	>
		<div class="music-panel-strong rounded-2xl p-6 text-center">
			<div class="record-mark mx-auto mb-6"></div>
			<p class="music-kicker mb-2">MT Toolkit</p>
			<h1 class="stage-title text-4xl font-black">What's your name?</h1>
		</div>
		<form onsubmit={submitName} class="music-panel flex flex-col gap-4 rounded-2xl p-5">
			<input
				bind:value={name}
				placeholder="Your name"
				required
				maxlength="32"
				autocomplete="off"
				class="w-full rounded-xl border-2 border-white/10 bg-black/30 px-6 py-4 text-center text-2xl font-bold text-white placeholder:text-zinc-600 focus:border-cyan-300 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={submittingName || name.trim().length === 0}
				class="primary-glow w-full rounded-xl py-4 text-lg font-black text-white transition disabled:opacity-30"
			>
				{submittingName ? 'Joining...' : "Let's go"}
			</button>
		</form>
	</div>

{:else if playbackState === 'ended'}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">MT Toolkit</p>
		<p class="stage-title text-3xl font-black">Session ended</p>
		<p class="text-zinc-400">Thanks for playing!</p>
	</div>

{:else if isEliminated}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-5 py-8 text-center"
	>
		<audio bind:this={audioEl}></audio>
		<div class="text-9xl" aria-hidden="true">🧊</div>
		<div class="music-panel-strong rounded-2xl p-6">
			<p class="music-kicker text-blue-300">You're out!</p>
			<p class="stage-title mt-2 text-4xl font-black">You didn't freeze</p>
			<p class="mt-3 text-zinc-400">Watch the others finish the round.</p>
		</div>
	</div>

{:else if !trackId}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8 text-center"
	>
		<audio bind:this={audioEl}></audio>
		<div class="music-panel-strong rounded-2xl p-6">
			<p class="music-kicker mb-3">MT Toolkit</p>
			<p class="stage-title text-4xl font-black">Hi, {name}!</p>
			<p class="mt-3 text-lg text-zinc-300">Waiting for the host to start...</p>
		</div>
		<div class="equalizer" aria-hidden="true">
			<span></span><span></span><span></span><span></span><span></span>
		</div>
	</div>

{:else}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-between gap-8 px-5 py-10"
	>
		<div class="w-full">
			<p class="music-kicker">MT Toolkit</p>
		</div>

		<audio bind:this={audioEl} loop></audio>

		<!-- Big status icon -->
		{#if playbackState === 'playing'}
			<div class="flex flex-col items-center gap-4">
				<div class="text-[9rem] leading-none" aria-hidden="true">🟢</div>
				<p class="text-3xl font-black text-emerald-300">DANCE!</p>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-4">
				<div class="text-[9rem] leading-none" aria-hidden="true">🔴</div>
				<p class="text-3xl font-black text-red-400">FREEZE!</p>
			</div>
		{/if}

		<div class="music-panel-strong w-full rounded-2xl p-5 text-center">
			{#if playbackState === 'playing'}
				<p class="music-kicker text-emerald-300">Now playing</p>
			{:else}
				<p class="music-kicker text-zinc-500">Paused — don't move!</p>
			{/if}
			<p class="stage-title mt-2 text-2xl leading-tight font-black">{trackTitle}</p>
		</div>
	</div>
{/if}
