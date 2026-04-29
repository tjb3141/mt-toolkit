<script lang="ts">
	let { class: className = '' } = $props();
</script>

<a
	href="/"
	aria-label="Return to main menu"
	title="Return to main menu"
	class="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 transition-colors hover:border-violet-500 hover:bg-zinc-800 focus:border-violet-500 focus:outline-none {className}"
>
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.25"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-7 w-7"
	>
		<path d="M3 10.75 12 3l9 7.75" />
		<path d="M5 9.75V21h5.5v-6.25h3V21H19V9.75" />
	</svg>
	<span class="sr-only">Main menu</span>
</a>
