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

	function getUrl(storagePath: string) {
		return supabase.storage.from('tracks').getPublicUrl(storagePath).data.publicUrl;
	}

	onMount(() => {
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
					if (pair) pair = { ...pair, found: payload.new.found };
					if (payload.new.found && audioEl) audioEl.pause();
				}
			)
			.subscribe();
	}

	$effect(() => {
		const _track = track;
		const _audioEl = audioEl;
		if (!_track || !_audioEl) return;
		_audioEl.src = getUrl(_track.storage_path);
		const state = untrack(() => playbackState);
		if (state === 'playing') _audioEl.play().catch(() => {});
	});
</script>

{#if !participantId}
	<div class="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
		<div class="text-center">
			<p class="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit</p>
			<h1 class="text-4xl font-black">What's your name?</h1>
		</div>
		<form onsubmit={submitName} class="flex flex-col items-center gap-4">
			<input
				bind:value={name}
				placeholder="Your name"
				required
				maxlength="32"
				autocomplete="off"
				class="w-64 rounded-2xl border-2 border-zinc-700 bg-zinc-900 px-6 py-4 text-center text-2xl font-bold text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={submittingName || name.trim().length === 0}
				class="w-64 rounded-2xl bg-violet-600 py-4 text-lg font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-30"
			>
				{submittingName ? 'Joining…' : "Let's go"}
			</button>
		</form>
	</div>

{:else if playbackState === 'paused'}
	<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
		<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit · Partners</p>
		<div>
			<p class="text-4xl font-black">Hi, {name}!</p>
			<p class="mt-3 text-lg text-zinc-400">Waiting for the host to start the game…</p>
		</div>
		<div class="h-1.5 w-24 animate-pulse rounded-full bg-zinc-800"></div>
	</div>

{:else if playbackState === 'playing'}
	{#if !pair}
		<div class="flex min-h-screen items-center justify-center">
			<p class="text-zinc-500">Loading…</p>
		</div>
	{:else if pair.found}
		<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
			<p class="text-8xl">🎉</p>
			<p class="text-4xl font-black">You've been found!</p>
			<p class="text-lg text-zinc-400">Your partner found you. Nice moves!</p>
		</div>
	{:else}
		<div class="flex min-h-screen flex-col justify-between p-8">
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
					MT Toolkit · Partners
				</p>
			</div>

			<div class="flex flex-col gap-4">
				<p class="text-xs font-semibold uppercase tracking-widest text-emerald-400">Now playing</p>
				{#if track}
					<p class="text-3xl font-black leading-tight">{track.title}</p>
				{:else}
					<p class="text-zinc-500">Loading track…</p>
				{/if}
				<p class="mt-2 text-xl font-semibold text-zinc-300">
					Find who else is dancing to the same song!
				</p>
			</div>

			<audio bind:this={audioEl} loop></audio>

			<p class="text-sm text-zinc-600">
				Listen and look around — your partner hears this exact song.
			</p>
		</div>
	{/if}

{:else if playbackState === 'ended'}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
		<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit · Partners</p>
		<p class="text-2xl font-black">Session ended</p>
		<p class="text-zinc-400">Thanks for playing!</p>
	</div>
{/if}
