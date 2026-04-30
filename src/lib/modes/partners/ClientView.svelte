<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	type Track = { id: string; title: string; storage_path: string };
	type PairData = { id: string; track_id: string | null; found: boolean };

	let name = $state('');
	let participantId = $state<string | null>(null);
	let submittingName = $state(false);
	let playbackState = $state(untrack(() => session.playback_state));
	let pair = $state<PairData | null>(null);
	let track = $state<Track | null>(null);
	let audioEl = $state<HTMLAudioElement | null>(null);

	let channel: RealtimeChannel | null = null;
	let pairChannel: RealtimeChannel | null = null;

	function getUrl(trackId: string) {
		return `/api/audio/${trackId}?session=${session.id}`;
	}

	onMount(async () => {
		const saved = sessionStorage.getItem(`participant:${session.id}`);
		if (saved) {
			const { id, n } = JSON.parse(saved);
			participantId = id;
			name = n;
			if (untrack(() => playbackState) === 'playing') {
				await loadPair();
			}
		}

		channel = supabase
			.channel(`partners-client:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
				async (payload) => {
					const newState = payload.new.playback_state;
					playbackState = newState;
					if (newState === 'playing' && participantId) {
						await loadPair();
					}
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
		if (pairChannel) supabase.removeChannel(pairChannel);
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
			if (untrack(() => playbackState) === 'playing') {
				await loadPair();
			}
		}
	}

	async function loadPair() {
		const pid = participantId;
		if (!pid) return;

		const { data } = await supabase
			.from('partners_pairs')
			.select('id, track_id, found')
			.eq('session_id', session.id)
			.or(`participant_1_id.eq.${pid},participant_2_id.eq.${pid}`)
			.maybeSingle();

		if (!data) return;

		pair = data;

		if (data.track_id) {
			const { data: trackData } = await supabase
				.from('tracks')
				.select('id, title, storage_path')
				.eq('id', data.track_id)
				.single();
			track = trackData;
		}

		pairChannel = supabase
			.channel(`pair-client:${data.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'partners_pairs',
					filter: `id=eq.${data.id}`
				},
				(payload) => {
					const newTrackId = payload.new.track_id;
					const newFound = payload.new.found;
					if (pair) pair = { ...pair, found: newFound, track_id: newTrackId };
					if (newFound) {
						audioEl?.pause();
					} else if (!newFound && newTrackId) {
						if (newTrackId !== track?.id) {
							// New track assigned — load it and play
							supabase
								.from('tracks')
								.select('id, title, storage_path')
								.eq('id', newTrackId)
								.single()
								.then(({ data: t }) => {
									if (t) track = t;
								});
						} else {
							// Same track, new round — just resume
							audioEl?.play().catch(() => {});
						}
					}
				}
			)
			.subscribe();
	}

	$effect(() => {
		const _track = track;
		const _audioEl = audioEl;
		if (!_track || !_audioEl) return;
		_audioEl.src = getUrl(_track.id);
		const state = untrack(() => playbackState);
		if (state === 'playing') _audioEl.play().catch(() => {});
	});
</script>

{#if !participantId}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8"
	>
		<div class="music-panel-strong rounded-2xl p-6 text-center">
			<div class="record-mark mx-auto mb-6"></div>
			<p class="music-kicker mb-2">MT Toolkit Partners</p>
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
{:else if playbackState === 'paused'}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8 text-center"
	>
		<div class="music-panel-strong rounded-2xl p-6">
			<p class="music-kicker mb-3">MT Toolkit Partners</p>
			<p class="stage-title text-4xl font-black">Hi, {name}!</p>
			<p class="mt-3 text-lg text-zinc-300">Waiting for the host to start the game...</p>
		</div>
		<div class="equalizer" aria-hidden="true">
			<span></span>
			<span></span>
			<span></span>
			<span></span>
			<span></span>
		</div>
	</div>
{:else if playbackState === 'playing'}
	{#if !pair}
		<div class="stage-shell flex min-h-screen items-center justify-center">
			<p class="text-zinc-400">Loading...</p>
		</div>
	{:else if pair.found}
		<div
			class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8 text-center"
		>
			<div class="record-mark"></div>
			<p class="stage-title text-4xl font-black">You've been found!</p>
			<p class="text-lg text-zinc-300">Your partner found you. Nice moves!</p>
		</div>
	{:else}
		<div
			class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8"
		>
			<p class="music-kicker">MT Toolkit Partners</p>

			<div class="music-panel-strong rounded-2xl p-6">
				<p class="music-kicker text-emerald-300">Now playing</p>
				{#if track}
					<p class="stage-title mt-3 text-3xl leading-tight font-black">{track.title}</p>
				{:else}
					<p class="mt-3 text-zinc-400">Loading track...</p>
				{/if}
				<p class="mt-4 text-xl font-semibold text-zinc-200">
					Find who else is dancing to the same song!
				</p>
			</div>

			<audio bind:this={audioEl} loop></audio>

			<p class="music-panel rounded-2xl p-5 text-sm text-zinc-300">
				Listen and look around. Your partner hears this exact song.
			</p>
		</div>
	{/if}
{:else if playbackState === 'ended'}
	<div
		class="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
	>
		<p class="music-kicker">MT Toolkit Partners</p>
		<p class="stage-title text-3xl font-black">Session ended</p>
		<p class="text-zinc-400">Thanks for playing!</p>
	</div>
{/if}
