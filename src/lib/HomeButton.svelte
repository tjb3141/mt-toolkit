<script lang="ts">
	let { class: className = '' } = $props();
</script>

<a
	href="/"
	aria-label="Return to main menu"
	title="Return to main menu"
	class="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-zinc-100 shadow-lg shadow-black/20 transition-colors hover:border-cyan-300/70 hover:bg-white/15 focus:border-cyan-300 focus:outline-none {className}"
>
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.25"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-8 w-8"
	>
		<path d="M3 10.75 12 3l9 7.75" />
		<path d="M5 9.75V21h5.5v-6.25h3V21H19V9.75" />
	</svg>
	<span class="sr-only">Main menu</span>
</a>
