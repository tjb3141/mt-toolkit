<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let code = $state('');
	let adminTapCount = $state(0);
	let adminTapTimer: ReturnType<typeof setTimeout> | null = null;
	let invalid = $derived(page.url.searchParams.get('error') === 'invalid');

	function join(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = code.trim().toUpperCase();
		if (trimmed.length === 6) goto(`/join/${trimmed}`);
	}

	function secretAdminTap() {
		if (adminTapTimer) clearTimeout(adminTapTimer);
		adminTapCount += 1;

		if (adminTapCount >= 7) {
			goto('/admin');
			return;
		}

		adminTapTimer = setTimeout(() => {
			adminTapCount = 0;
		}, 1400);
	}
</script>

<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-10">
	<div>
		<button
			type="button"
			onclick={secretAdminTap}
			aria-label="MT Toolkit"
			class="mb-2 text-left text-sm font-semibold tracking-[0.3em] text-violet-400 uppercase"
		>
			MT Toolkit
		</button>
		<h1 class="text-5xl font-black tracking-tight">Main menu</h1>
		<p class="mt-3 text-sm leading-6 text-zinc-400">
			Join from the room code, or start a host session for the group.
		</p>
	</div>

	<section class="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
		<div class="mb-4">
			<h2 class="text-xl font-black">Join a session</h2>
			<p class="mt-1 text-sm text-zinc-500">Enter the 6-character code from the host screen.</p>
		</div>

		<form onsubmit={join} class="flex flex-col gap-3">
			{#if invalid}
				<p class="text-sm text-red-400">Session not found or expired.</p>
			{/if}
			<input
				bind:value={code}
				maxlength="6"
				placeholder="ABC123"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				oninput={(e) => {
					code = (e.currentTarget as HTMLInputElement).value.toUpperCase();
				}}
				class="w-full rounded-lg border-2 border-zinc-700 bg-zinc-900 px-5 py-4 text-center text-3xl font-black tracking-[0.35em] text-white uppercase placeholder:text-zinc-700 focus:border-violet-500 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={code.trim().length !== 6}
				class="w-full rounded-lg bg-violet-600 py-4 text-lg font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-30"
			>
				Join
			</button>
		</form>
	</section>

	<a
		href="/host"
		class="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 font-bold transition-colors hover:border-violet-500 hover:bg-zinc-800"
	>
		<span>Host a session</span>
		<span class="text-violet-400">Start</span>
	</a>
</main>
