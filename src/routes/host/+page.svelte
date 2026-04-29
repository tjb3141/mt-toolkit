<script lang="ts">
	import { goto } from '$app/navigation';
	import HomeButton from '$lib/HomeButton.svelte';
	import { supabase } from '$lib/supabase';
	import { modes } from '$lib/modes/index';

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
</script>

<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-10">
	<HomeButton class="self-start" />

	<div>
		<p class="mb-2 text-sm font-semibold tracking-[0.3em] text-violet-400 uppercase">MT Toolkit</p>
		<h1 class="text-5xl font-black tracking-tight">Start a session</h1>
	</div>

	<div class="flex w-full flex-col gap-3">
		<p class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Mode</p>
		{#each Object.entries(modes) as [key, m]}
			<label
				class="flex cursor-pointer items-center gap-4 rounded-lg border-2 px-5 py-4 transition-colors {selectedMode ===
				key
					? 'border-violet-500 bg-violet-950'
					: 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'}"
			>
				<input type="radio" bind:group={selectedMode} value={key} class="hidden" />
				<div class="flex flex-col">
					<span class="font-bold">{m.label}</span>
				</div>
				{#if selectedMode === key}
					<span class="ml-auto text-sm font-semibold text-violet-400">Selected</span>
				{/if}
			</label>
		{/each}
	</div>

	{#if error}
		<p class="text-sm text-red-400">{error}</p>
	{/if}

	<button
		onclick={createSession}
		disabled={creating}
		class="w-full rounded-lg bg-violet-600 py-4 text-lg font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-30"
	>
		{creating ? 'Creating...' : 'Create session'}
	</button>
</main>
