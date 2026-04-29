<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();

	type Genre = { id: string; name: string };
	type Track = { id: string; title: string; storage_path: string; duration_seconds: number };

	let name = $state('');
	let participantId = $state<string | null>(null);
	let genres = $state<Genre[]>([]);
	let selectedGenre = $state<Genre | null>(null);
	let tracks = $state<Track[]>([]);
	let currentIndex = $state(0);
	// untrack: intentionally capturing initial value only — managed locally after that
	let playbackState = $state(untrack(() => session.playback_state));
	let audioEl = $state<HTMLAudioElement | null>(null);
	let submittingName = $state(false);
	let channel: RealtimeChannel | null = null;

	function shuffle<T>(arr: T[]): T[] {
		return [...arr].sort(() => Math.random() - 0.5);
	}

	function getUrl(storagePath: string) {
		return supabase.storage.from('tracks').getPublicUrl(storagePath).data.publicUrl;
	}

	onMount(async () => {
		const { data } = await supabase.from('genres').select('id, name').order('display_order');
		genres = data ?? [];

		channel = supabase
			.channel(`session:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
				(payload) => {
					const newState = payload.new.playback_state;
					playbackState = newState;
					if (!audioEl) return;
					if (newState === 'playing') audioEl.play().catch(() => {});
					else audioEl.pause();
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
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
		if (!error && data) participantId = data.id;
	}

	async function selectGenre(genre: Genre) {
		selectedGenre = genre;
		if (participantId) {
			await supabase.from('participants').update({ genre_id: genre.id }).eq('id', participantId);
		}
		const { data } = await supabase
			.from('tracks')
			.select('id, title, storage_path, duration_seconds')
			.eq('genre_id', genre.id);
		tracks = shuffle(data ?? []);
		currentIndex = 0;
	}

	function nextTrack() {
		currentIndex = (currentIndex + 1) % tracks.length;
	}

	$effect(() => {
		const _tracks = tracks;
		const _index = currentIndex;
		if (!audioEl || _tracks.length === 0) return;
		audioEl.src = getUrl(_tracks[_index].storage_path);
		const state = untrack(() => playbackState);
		if (state === 'playing') audioEl.play().catch(() => {});
	});


</script>

{#if !participantId}
	<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
		<h2 class="text-2xl font-bold">What's your name?</h2>
		<form onsubmit={submitName} class="flex flex-col items-center gap-4">
			<input
				bind:value={name}
				placeholder="Your name"
				required
				maxlength="32"
				autocomplete="off"
				class="w-56 rounded-xl border-2 border-gray-300 px-4 py-3 text-center text-xl focus:border-black focus:outline-none"
			/>
			<button
				type="submit"
				disabled={submittingName || name.trim().length === 0}
				class="w-56 rounded-xl bg-black py-3 font-semibold text-white disabled:opacity-40"
			>
				{submittingName ? 'Joining…' : 'Join'}
			</button>
		</form>
	</div>
{:else if !selectedGenre}
	<div class="flex flex-col gap-4 p-8">
		<h2 class="text-2xl font-bold">Pick your vibe, {name}</h2>
		{#each genres as genre}
			<button
				onclick={() => selectGenre(genre)}
				class="rounded-2xl border-2 border-gray-200 p-6 text-left text-xl font-semibold hover:border-black hover:bg-gray-50 active:bg-gray-100"
			>
				{genre.name}
			</button>
		{/each}
	</div>
{:else if tracks.length === 0}
	<div class="p-8 text-gray-400">Loading tracks…</div>
{:else}
	<div class="flex flex-col gap-6 p-8">
		<div>
			<p class="text-sm uppercase tracking-widest text-gray-400">{selectedGenre.name}</p>
			<p class="mt-1 text-lg font-semibold">{tracks[currentIndex].title}</p>
		</div>

		<audio bind:this={audioEl} onended={nextTrack}></audio>

{#if playbackState === 'ended'}
			<p class="text-gray-400">Session ended. Thanks for listening!</p>
		{:else if playbackState !== 'playing'}
			<p class="text-sm text-gray-400">Waiting for the host to start…</p>
		{/if}

		<button
			onclick={() => { selectedGenre = null; tracks = []; }}
			class="text-left text-sm text-gray-400 underline"
		>
			Change genre
		</button>
	</div>
{/if}
