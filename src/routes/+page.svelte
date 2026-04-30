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

<main
	class="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-5 py-8"
>
	<section class="music-panel-strong rounded-2xl p-6">
		<div class="flex items-center justify-between gap-5">
			<div>
				<button
					type="button"
					onclick={secretAdminTap}
					aria-label="MT Toolkit"
					class="music-kicker mb-3 text-left"
				>
					MT Toolkit
				</button>
				<h1 class="stage-title text-5xl font-black tracking-tight">Music Booth</h1>
				<p class="mt-3 max-w-sm text-sm leading-6 text-zinc-300">
					Start the room, scan the code, and let the music do the heavy lifting.
				</p>
			</div>
			<div class="hidden shrink-0 sm:block">
				<div class="record-mark"></div>
			</div>
		</div>

		<div class="mt-6 flex items-center justify-between gap-4">
			<div class="equalizer" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
			</div>

		</div>
	</section>

	<section class="music-panel rounded-2xl p-5">
		<div class="mb-4 flex items-center gap-4">
			<div class="icon-tile" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
					<path d="M4 13a8 8 0 0 1 16 0" stroke-width="2.25" stroke-linecap="round" />
					<path
						d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z"
						stroke-width="2.25"
						stroke-linejoin="round"
					/>
				</svg>
			</div>
			<div>
				<h2 class="text-2xl font-black">Join</h2>
				<p class="text-sm text-zinc-400">Type the code from the host screen.</p>
			</div>
		</div>

		<form onsubmit={join} class="flex flex-col gap-3">
			{#if invalid}
				<p class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
					Session not found or expired.
				</p>
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
				class="w-full rounded-xl border-2 border-white/10 bg-black/35 px-5 py-5 text-center text-4xl font-black tracking-[0.3em] text-white uppercase placeholder:text-zinc-700 focus:border-cyan-300 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={code.trim().length !== 6}
				class="primary-glow w-full rounded-xl py-4 text-xl font-black text-white transition disabled:opacity-30"
			>
				Join Room
			</button>
		</form>
	</section>

	<a
		href="/host"
		class="music-panel flex items-center justify-between gap-4 rounded-2xl p-5 transition hover:border-cyan-300/70"
	>
		<div class="flex items-center gap-4">
			<div class="icon-tile" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-8 w-8">
					<circle cx="12" cy="12" r="8" stroke-width="2.25" />
					<circle cx="12" cy="12" r="2" stroke-width="2.25" />
					<path d="M18.5 5.5 21 3" stroke-width="2.25" stroke-linecap="round" />
				</svg>
			</div>
			<div>
				<p class="text-2xl font-black">Host</p>
				<p class="text-sm text-zinc-400">Create a session</p>
			</div>
		</div>
		<span class="rounded-full bg-cyan-300 px-4 py-2 text-sm font-black text-zinc-950">Start</span>
	</a>
</main>
