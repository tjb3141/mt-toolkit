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
			.on('postgres_changes',
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

	function prevTrack() {
		currentIndex = (currentIndex - 1 + tracks.length) % tracks.length;
	}

	// Load audio when track changes
	$effect(() => {
		const _tracks = tracks;
		const _index = currentIndex;
		if (!audioEl || _tracks.length === 0) return;
		audioEl.src = getUrl(_tracks[_index].storage_path);
		const state = untrack(() => playbackState);
		if (state === 'playing') audioEl.play().catch(() => {});
	});

	// Report current track to host
	// Must call .then() — supabase query builders are lazy and never fire without it
	$effect(() => {
		const _pid = participantId;
		const _tracks = tracks;
		const _index = currentIndex;
		if (!_pid || _tracks.length === 0) return;
		supabase.from('participants')
			.update({ current_track: _tracks[_index].title })
			.eq('id', _pid)
			.then(({ error }) => { if (error) console.error('current_track update failed:', error); });
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

{:else if !selectedGenre}
	<div class="flex min-h-screen flex-col gap-6 p-8">
		<div class="pt-4">
			<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit</p>
			<h2 class="mt-2 text-4xl font-black leading-tight">Pick your<br />vibe, {name}</h2>
		</div>
		<div class="flex flex-col gap-3">
			{#each genres as genre}
				<button
					onclick={() => selectGenre(genre)}
					class="rounded-2xl bg-zinc-900 px-6 py-6 text-left text-2xl font-black tracking-tight transition-all hover:bg-zinc-800 active:scale-95"
				>
					{genre.name}
				</button>
			{/each}
		</div>
	</div>

{:else if tracks.length === 0}
	<div class="flex min-h-screen items-center justify-center">
		<p class="text-zinc-500">Loading tracks…</p>
	</div>

{:else}
	<div class="flex min-h-screen flex-col justify-between p-8">
		<div>
			<p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit</p>
			<p class="mt-1 text-sm text-zinc-500">{selectedGenre.name}</p>
		</div>

		<div class="flex flex-col gap-3">
			{#if playbackState === 'playing'}
				<p class="text-xs font-semibold uppercase tracking-widest text-emerald-400">Now playing</p>
			{:else if playbackState === 'ended'}
				<p class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Session ended</p>
			{:else}
				<p class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Waiting for host…</p>
			{/if}
			<p class="text-3xl font-black leading-tight">{tracks[currentIndex].title}</p>
			<p class="text-sm text-zinc-500">Track {currentIndex + 1} of {tracks.length}</p>
		</div>

		<audio bind:this={audioEl} onended={nextTrack}></audio>

		<div class="flex flex-col gap-6">
			<div class="flex gap-4">
				<button
					onclick={prevTrack}
					class="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-900 py-5 text-lg font-bold transition-all hover:bg-zinc-800 active:scale-95"
				>
					⏮ Prev
				</button>
				<button
					onclick={nextTrack}
					class="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-900 py-5 text-lg font-bold transition-all hover:bg-zinc-800 active:scale-95"
				>
					Skip ⏭
				</button>
			</div>

			<button
				onclick={() => { selectedGenre = null; tracks = []; }}
				class="text-left text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
			>
				Change genre
			</button>
		</div>
	</div>
{/if}
