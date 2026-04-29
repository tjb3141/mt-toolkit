<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let code = $state('');
	let invalid = $derived(page.url.searchParams.get('error') === 'invalid');

	function join(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = code.trim().toUpperCase();
		if (trimmed.length === 6) goto(`/join/${trimmed}`);
	}
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-10 p-8">
	<div class="text-center">
		<p class="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-violet-400">MT Toolkit</p>
		<h1 class="text-5xl font-black tracking-tight">Join a session</h1>
	</div>

	<form onsubmit={join} class="flex flex-col items-center gap-4">
		{#if invalid}
			<p class="text-sm text-red-400">Session not found or expired.</p>
		{/if}
		<input
			bind:value={code}
			maxlength="6"
			placeholder="••••••"
			autocomplete="off"
			autocorrect="off"
			spellcheck="false"
			oninput={(e) => { code = (e.currentTarget as HTMLInputElement).value.toUpperCase(); }}
			class="w-64 rounded-2xl border-2 border-zinc-700 bg-zinc-900 px-6 py-5 text-center text-4xl font-black uppercase tracking-[0.4em] text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
		/>
		<button
			type="submit"
			disabled={code.trim().length !== 6}
			class="w-64 rounded-2xl bg-violet-600 py-4 text-lg font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-30"
		>
			Join
		</button>
	</form>

	<a href="/host" class="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-300">
		Host a session
	</a>
</main>
