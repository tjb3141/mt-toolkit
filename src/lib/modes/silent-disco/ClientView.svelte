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

	function getUrl(trackId: string) {
		return `/api/audio/${trackId}?session=${session.id}`;
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

	function prevTrack() {
		currentIndex = (currentIndex - 1 + tracks.length) % tracks.length;
	}

	// Load audio when track changes
	$effect(() => {
		const _tracks = tracks;
		const _index = currentIndex;
		if (!audioEl || _tracks.length === 0) return;
		audioEl.src = getUrl(_tracks[_index].id);
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
		supabase
			.from('participants')
			.update({ current_track: _tracks[_index].title })
			.eq('id', _pid)
			.then(({ error }) => {
				if (error) console.error('current_track update failed:', error);
			});
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
{:else if !selectedGenre}
	<div class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-8">
		<div class="music-panel-strong rounded-2xl p-6">
			<p class="music-kicker">MT Toolkit</p>
			<h2 class="stage-title mt-2 text-4xl leading-tight font-black">Pick your vibe, {name}</h2>
		</div>
		<div class="flex flex-col gap-3">
			{#each genres as genre}
				<button
					onclick={() => selectGenre(genre)}
					class="music-panel flex items-center gap-4 rounded-2xl px-6 py-6 text-left text-2xl font-black tracking-tight transition-all hover:border-cyan-300/60 active:scale-95"
				>
					<span class="icon-tile" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-7 w-7">
							<path d="M9 18V5l11-2v13" stroke-width="2.25" stroke-linejoin="round" />
							<circle cx="6" cy="18" r="3" stroke-width="2.25" />
							<circle cx="17" cy="16" r="3" stroke-width="2.25" />
						</svg>
					</span>
					{genre.name}
				</button>
			{/each}
		</div>
	</div>
{:else if tracks.length === 0}
	<div class="stage-shell flex min-h-screen items-center justify-center">
		<p class="text-zinc-400">Loading tracks...</p>
	</div>
{:else}
	<div
		class="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8"
	>
		<div>
			<p class="music-kicker">MT Toolkit</p>
			<p class="mt-1 text-sm text-zinc-400">{selectedGenre.name}</p>
		</div>

		<div class="music-panel-strong rounded-2xl p-6">
			{#if playbackState === 'playing'}
				<p class="music-kicker text-emerald-300">Now playing</p>
			{:else if playbackState === 'ended'}
				<p class="music-kicker text-zinc-500">Session ended</p>
			{:else}
				<p class="music-kicker text-zinc-500">Waiting for host...</p>
			{/if}
			<p class="stage-title mt-3 text-3xl leading-tight font-black">{tracks[currentIndex].title}</p>
			<p class="text-sm text-zinc-500">Track {currentIndex + 1} of {tracks.length}</p>
		</div>

		<audio bind:this={audioEl} onended={nextTrack}></audio>

		<div class="flex flex-col gap-6">
			<div class="flex gap-4">
				<button
					onclick={prevTrack}
					class="music-panel flex flex-1 items-center justify-center gap-2 rounded-2xl py-5 text-lg font-bold transition-all hover:border-white/25 active:scale-95"
				>
					Prev
				</button>
				<button
					onclick={nextTrack}
					class="music-panel flex flex-1 items-center justify-center gap-2 rounded-2xl py-5 text-lg font-bold transition-all hover:border-white/25 active:scale-95"
				>
					Skip
				</button>
			</div>

			<button
				onclick={() => {
					selectedGenre = null;
					tracks = [];
				}}
				class="text-left text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
			>
				Change genre
			</button>
		</div>
	</div>
{/if}
