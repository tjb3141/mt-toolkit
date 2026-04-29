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

<main class="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
	<h1 class="text-4xl font-bold">MT Toolkit</h1>

	<form onsubmit={join} class="flex flex-col items-center gap-4">
		{#if invalid}
			<p class="text-sm text-red-500">Session not found or expired.</p>
		{/if}
		<input
			bind:value={code}
			maxlength="6"
			placeholder="Enter code"
			autocomplete="off"
			autocorrect="off"
			spellcheck="false"
			oninput={(e) => { code = (e.currentTarget as HTMLInputElement).value.toUpperCase(); }}
			class="w-48 rounded-xl border-2 border-gray-300 px-4 py-3 text-center text-2xl font-bold uppercase tracking-widest focus:border-black focus:outline-none"
		/>
		<button
			type="submit"
			disabled={code.trim().length !== 6}
			class="w-48 rounded-xl bg-black py-3 text-white font-semibold disabled:opacity-40"
		>
			Join
		</button>
	</form>

	<a href="/host" class="text-sm text-gray-400 underline">Host a session</a>
</main>
