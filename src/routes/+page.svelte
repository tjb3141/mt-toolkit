<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount } from 'svelte';

	let status = $state('checking...');

	onMount(async () => {
		const { data, error } = await supabase.from('genres').select('count');
		status = error ? `error: ${error.message}` : 'Supabase connected';
	});
</script>

<h1>Silent Disco</h1>
<p>Supabase: {status}</p>
