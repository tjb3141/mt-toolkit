<script lang="ts">
	import { modes } from '$lib/modes/index';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let { session } = data;

	const mode = modes[session.mode] ?? modes.silent_disco;
</script>

<svelte:component this={mode.HostControls} {session} />
