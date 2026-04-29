<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabase';
	import { modes } from '$lib/modes/index';

	let selectedMode = $state<string>('silent_disco');
	let creating = $state(false);
	let error = $state('');

	function generateCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
	}

	async function createSession() {
		creating = true;
		error = '';

		for (let attempt = 0; attempt < 5; attempt++) {
			const code = generateCode();
			const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
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

<main class="flex min-h-screen flex-col items-center justify-center p-8">
	<div class="flex flex-col items-center gap-6">
		<h1 class="text-3xl font-bold">Host a Session</h1>

		<div class="flex flex-col gap-2">
			<p class="text-sm font-medium text-gray-600">Mode</p>
			{#each Object.entries(modes) as [key, m]}
				<label class="flex cursor-pointer items-center gap-3">
					<input type="radio" bind:group={selectedMode} value={key} class="accent-black" />
					<span class="font-medium">{m.label}</span>
				</label>
			{/each}
		</div>

		{#if error}
			<p class="text-sm text-red-500">{error}</p>
		{/if}

		<button
			onclick={createSession}
			disabled={creating}
			class="rounded-xl bg-black px-8 py-3 font-semibold text-white disabled:opacity-50"
		>
			{creating ? 'Creating…' : 'Create session'}
		</button>
	</div>
</main>
