<script lang="ts">
	import { goto } from '$app/navigation';
	import HomeButton from '$lib/HomeButton.svelte';
	import { modes } from '$lib/modes/index';
	import { supabase } from '$lib/supabase';

	let selectedMode = $state<string>('silent_disco');
	let creating = $state(false);
	let error = $state('');

	function generateCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(
			''
		);
	}

	async function createSession() {
		creating = true;
		error = '';

		for (let attempt = 0; attempt < 5; attempt++) {
			const code = generateCode();
			const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
			const { data, error: err } = await supabase
				.from('sessions')
				.insert({ code, mode: selectedMode, playback_state: 'paused', expires_at: expiresAt })
				.select()
				.single();

			if (!err && data) {
				goto(`/host/${data.code}`);
				return;
			}
			if (err?.code !== '23505') {
				error = err?.message ?? 'Unknown error';
				break;
			}
		}

		creating = false;
	}

	function modeHelp(key: string) {
		if (key === 'partners') return 'Pair people up by matching songs.';
		if (key === 'imposter') return 'One person hears a different song — spot the odd one out.';
		if (key === 'freeze_dance') return 'Dance when music plays, freeze when it stops.';
		return 'Everyone listens solo while you control play and pause.';
	}
</script>

<main
	class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-5 py-8"
>
	<div class="flex items-center justify-between">
		<HomeButton class="shrink-0" />
		<div class="equalizer h-10" aria-hidden="true">
			<span></span>
			<span></span>
			<span></span>
			<span></span>
			<span></span>
		</div>
	</div>

	<section class="music-panel-strong rounded-2xl p-6">
		<p class="music-kicker mb-3">Host Booth</p>
		<h1 class="stage-title text-5xl font-black tracking-tight">Pick the vibe</h1>
		<p class="mt-3 text-sm leading-6 text-zinc-300">
			Choose a mode, then the app gives you a giant room code and QR screen.
		</p>
	</section>

	<div class="grid gap-3">
		<p class="music-kicker">Mode</p>
		{#each Object.entries(modes) as [key, m]}
			<label
				class="music-panel flex cursor-pointer items-center gap-4 rounded-2xl p-5 transition {selectedMode ===
				key
					? 'border-cyan-300/80 bg-cyan-300/10'
					: 'hover:border-white/25'}"
			>
				<input type="radio" bind:group={selectedMode} value={key} class="sr-only" />
				<div class="icon-tile" aria-hidden="true">
					{#if key === 'silent_disco'}
						<!-- headphones -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
							<path d="M4 13a8 8 0 0 1 16 0" stroke-width="2.25" stroke-linecap="round" />
							<path d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z" stroke-width="2.25" stroke-linejoin="round" />
						</svg>
					{:else if key === 'partners'}
						<!-- two people -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
							<path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke-width="2.25" />
							<path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke-width="2.25" />
							<path d="M3.5 20a4.5 4.5 0 0 1 9 0" stroke-width="2.25" stroke-linecap="round" />
							<path d="M11.5 20a4.5 4.5 0 0 1 9 0" stroke-width="2.25" stroke-linecap="round" />
						</svg>
					{:else if key === 'imposter'}
						<!-- question mark person -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
							<circle cx="12" cy="8" r="3" stroke-width="2.25" />
							<path d="M6 20a6 6 0 0 1 12 0" stroke-width="2.25" stroke-linecap="round" />
							<path d="M12 13v.5" stroke-width="2.25" stroke-linecap="round" />
							<circle cx="18" cy="6" r="4" fill="currentColor" stroke="none" class="text-zinc-900" />
							<path d="M18 4.5c0-.8.6-1.5 1.5-1 .6.3.8 1 .4 1.6L18 6.5V7" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
							<circle cx="18" cy="8.5" r=".6" fill="white" />
						</svg>
					{:else if key === 'freeze_dance'}
						<!-- ice cube / snowflake -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
							<line x1="12" y1="2" x2="12" y2="22" stroke-width="2.25" stroke-linecap="round" />
							<line x1="2" y1="12" x2="22" y2="12" stroke-width="2.25" stroke-linecap="round" />
							<line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke-width="2.25" stroke-linecap="round" />
							<line x1="19.07" y1="4.93" x2="4.93" y2="19.07" stroke-width="2.25" stroke-linecap="round" />
							<line x1="12" y1="2" x2="9" y2="5" stroke-width="2.25" stroke-linecap="round" />
							<line x1="12" y1="2" x2="15" y2="5" stroke-width="2.25" stroke-linecap="round" />
							<line x1="12" y1="22" x2="9" y2="19" stroke-width="2.25" stroke-linecap="round" />
							<line x1="12" y1="22" x2="15" y2="19" stroke-width="2.25" stroke-linecap="round" />
							<line x1="2" y1="12" x2="5" y2="9" stroke-width="2.25" stroke-linecap="round" />
							<line x1="2" y1="12" x2="5" y2="15" stroke-width="2.25" stroke-linecap="round" />
							<line x1="22" y1="12" x2="19" y2="9" stroke-width="2.25" stroke-linecap="round" />
							<line x1="22" y1="12" x2="19" y2="15" stroke-width="2.25" stroke-linecap="round" />
						</svg>
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-xl font-black">{m.label}</p>
					<p class="text-sm text-zinc-400">{modeHelp(key)}</p>
				</div>
				{#if selectedMode === key}
					<span class="rounded-full bg-cyan-300 px-3 py-1 text-xs font-black text-zinc-950">
						On
					</span>
				{/if}
			</label>
		{/each}
	</div>

	{#if error}
		<p class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
			{error}
		</p>
	{/if}

	<button
		onclick={createSession}
		disabled={creating}
		class="primary-glow w-full rounded-2xl py-5 text-2xl font-black text-white transition active:scale-95 disabled:opacity-30"
	>
		{creating ? 'Making room...' : 'Make the Room'}
	</button>
</main>
