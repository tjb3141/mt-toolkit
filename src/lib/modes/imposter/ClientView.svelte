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

	// Set after round starts — server pushes track via imposter_rounds realtime
	let assignedTrackId = $state<string | null>(null);
	let assignedTrackTitle = $state<string | null>(null);
	let isImposter = $state<boolean | null>(null);
	let imposterName = $state<string | null>(null); // revealed at 'revealed' phase

	let channel: RealtimeChannel | null = null;
	let roundChannel: RealtimeChannel | null = null;

	function getUrl(trackId: string) {
		return `/api/audio/${trackId}?session=${session.id}`;
	}

	onMount(async () => {
		const saved = sessionStorage.getItem(`participant:${session.id}`);
		if (saved) {
			const { id, n } = JSON.parse(saved);
			participantId = id;
			name = n;
			const currentState = untrack(() => playbackState);
			if (currentState === 'playing' || currentState === 'paused') {
				await loadCurrentRound(id);
			} else if (currentState === 'revealed') {
				await loadRevealInfo();
			}
			subscribeToRounds();
		}

		channel = supabase
			.channel(`imposter-client:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
				async (payload) => {
					const newState = payload.new.playback_state;
					playbackState = newState;
					if (!audioEl) return;
					if (newState === 'playing') {
						const pid = untrack(() => participantId);
						if (pid && !untrack(() => assignedTrackId)) {
							await loadCurrentRound(pid);
						}
						audioEl.play().catch(() => {});
					} else if (newState === 'paused') {
						audioEl.pause();
					} else {
						// ended or revealed — stop audio
						audioEl.pause();
						if (newState === 'revealed') {
							await loadRevealInfo();
						}
					}
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
		if (roundChannel) supabase.removeChannel(roundChannel);
	});

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
			sessionStorage.setItem(`participant:${session.id}`, JSON.stringify({ id: data.id, n: name.trim() }));
			// Check if a round is already in progress
			const currentState = untrack(() => playbackState);
			if (currentState === 'playing' || currentState === 'revealed') {
				await loadCurrentRound(data.id);
			}
			subscribeToRounds();
		}
	}

	function subscribeToRounds() {
		roundChannel = supabase
			.channel(`imposter-rounds:${session.id}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'imposter_rounds',
					filter: `session_id=eq.${session.id}`
				},
				async (_payload) => {
					// New round started — load our track assignment
					const pid = untrack(() => participantId);
					if (!pid) return;
					await loadCurrentRound(pid);
					// Resume playback if session is playing
					if (untrack(() => playbackState) === 'playing' && audioEl) {
						audioEl.play().catch(() => {});
					}
				}
			)
			.subscribe();
	}

	async function loadCurrentRound(pid: string) {
		const { data: round } = await supabase
			.from('imposter_rounds')
			.select('town_track_id, imposter_track_id, imposter_participant_id')
			.eq('session_id', session.id)
			.order('round', { ascending: false })
			.limit(1)
			.single();

		if (!round) return;

		const roleIsImposter = round.imposter_participant_id === pid;
		const trackId = roleIsImposter ? round.imposter_track_id : round.town_track_id;

		if (!trackId) return;

		const { data: track } = await supabase
			.from('tracks')
			.select('id, title')
			.eq('id', trackId)
			.single();

		isImposter = roleIsImposter;
		if (track) {
			assignedTrackId = track.id;
			assignedTrackTitle = track.title;
		}
	}

	async function loadRevealInfo() {
		const { data: round } = await supabase
			.from('imposter_rounds')
			.select('imposter_participant_id')
			.eq('session_id', session.id)
			.order('round', { ascending: false })
			.limit(1)
			.single();

		if (!round) return;

		const { data: p } = await supabase
			.from('participants')
			.select('name')
			.eq('id', round.imposter_participant_id)
			.single();

		if (p) imposterName = p.name;
	}

	// Wire up audio when track changes
	$effect(() => {
		const tid = assignedTrackId;
		const el = audioEl;
		if (!tid || !el) return;
		el.src = getUrl(tid);
		const state = untrack(() => playbackState);
		if (state === 'playing') el.play().catch(() => {});
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

{:else if playbackState === 'paused' && !assignedTrackId}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8 text-center"
	>
		<audio bind:this={audioEl} loop></audio>
		<div class="music-panel-strong rounded-2xl p-6">
			<p class="music-kicker mb-3">MT Toolkit</p>
			<p class="stage-title text-4xl font-black">Hi, {name}!</p>
			<p class="mt-3 text-lg text-zinc-300">Waiting for the host to start...</p>
		</div>
		<div class="equalizer" aria-hidden="true">
			<span></span><span></span><span></span><span></span><span></span>
		</div>
	</div>

{:else if playbackState === 'playing' || (playbackState === 'paused' && assignedTrackId)}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8"
	>
		<div>
			<p class="music-kicker">MT Toolkit</p>
		</div>

		<div class="music-panel-strong rounded-2xl p-6 text-center">
			{#if playbackState === 'playing'}
				<p class="music-kicker text-emerald-300">Now playing</p>
			{:else}
				<p class="music-kicker text-zinc-500">Paused</p>
			{/if}
			<p class="stage-title mt-3 text-3xl leading-tight font-black">
				{assignedTrackTitle ?? 'Loading...'}
			</p>
			<p class="mt-4 text-zinc-400">Listen through your headphones.</p>
		</div>

		{#if isImposter !== null}
			<div class="text-center">
				{#if isImposter}
					<span class="rounded-full bg-red-900/60 px-5 py-2 text-sm font-bold text-red-300">
						You are the Imposter
					</span>
				{:else}
					<span class="rounded-full bg-zinc-800 px-5 py-2 text-sm font-bold text-zinc-300">
						You are a Townsperson
					</span>
				{/if}
			</div>
		{/if}

		<audio bind:this={audioEl} loop></audio>

		<p class="music-panel rounded-2xl p-5 text-center text-sm text-zinc-300">
			Watch the room. Is everyone moving to the same beat?
		</p>
	</div>

{:else if playbackState === 'revealed'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8 text-center"
	>
		<audio bind:this={audioEl}></audio>
		{#if imposterName}
			<div class="music-panel-strong rounded-2xl p-8">
				<p class="music-kicker mb-4">The imposter was...</p>
				<p class="stage-title text-5xl font-black text-red-400">{imposterName}</p>
				{#if imposterName === name}
					<p class="mt-4 text-lg text-zinc-300">That was you! Did you fool them?</p>
				{:else}
					<p class="mt-4 text-lg text-zinc-300">Did you call it?</p>
				{/if}
			</div>
		{:else}
			<p class="text-zinc-400">Loading reveal...</p>
		{/if}
	</div>

{:else if playbackState === 'ended'}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">MT Toolkit</p>
		<p class="stage-title text-3xl font-black">Session ended</p>
		<p class="text-zinc-400">Thanks for playing!</p>
	</div>
{/if}
