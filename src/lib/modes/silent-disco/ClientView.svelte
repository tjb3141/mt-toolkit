<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount } from 'svelte';
	import { untrack } from 'svelte';
	import type { Session } from '$lib/modes/index';

	let { session }: { session: Session } = $props();

	type Genre = { id: string; name: string };
	type Track = { id: string; title: string; storage_path: string; duration_seconds: number };

	let genres = $state<Genre[]>([]);
	let selectedGenre = $state<Genre | null>(null);
	let tracks = $state<Track[]>([]);
	let currentIndex = $state(0);
	let playbackState = $state(session.playback_state);
	let volume = $state(0.8);
	let audioEl = $state<HTMLAudioElement | null>(null);

	function shuffle<T>(arr: T[]): T[] {
		return [...arr].sort(() => Math.random() - 0.5);
	}

	function getUrl(storagePath: string) {
		return supabase.storage.from('tracks').getPublicUrl(storagePath).data.publicUrl;
	}

	onMount(async () => {
		const { data } = await supabase.from('genres').select('id, name').order('display_order');
		genres = data ?? [];

		const channel = supabase
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

		return () => supabase.removeChannel(channel);
	});

	async function selectGenre(genre: Genre) {
		selectedGenre = genre;
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

	// Load new track when currentIndex or tracks change; read playbackState without tracking it
	$effect(() => {
		const _tracks = tracks;
		const _index = currentIndex;
		if (!audioEl || _tracks.length === 0) return;
		audioEl.src = getUrl(_tracks[_index].storage_path);
		const state = untrack(() => playbackState);
		if (state === 'playing') audioEl.play().catch(() => {});
	});

	// Sync volume without touching src
	$effect(() => {
		if (audioEl) audioEl.volume = volume;
	});
</script>

{#if !selectedGenre}
	<div class="flex flex-col gap-4 p-8">
		<h2 class="text-2xl font-bold">Pick your vibe</h2>
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

		<div class="flex flex-col gap-2">
			<label class="text-sm text-gray-500">Volume</label>
			<input type="range" min="0" max="1" step="0.01" bind:value={volume} class="w-full" />
		</div>

		{#if playbackState === 'ended'}
			<p class="text-gray-400">Session ended. Thanks for listening!</p>
		{:else if playbackState !== 'playing'}
			<p class="text-gray-400 text-sm">Waiting for the host to start…</p>
		{/if}

		<button
			onclick={() => { selectedGenre = null; tracks = []; }}
			class="text-sm text-gray-400 underline text-left"
		>
			Change genre
		</button>
	</div>
{/if}
