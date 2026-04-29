<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';

	let { session }: { session: Session } = $props();
	let playbackState = $state(session.playback_state);
	let qrDataUrl = $state('');

	const joinUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${session.code}`
	);

	onMount(async () => {
		const url = `${window.location.origin}/join/${session.code}`;
		qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });
	});

	async function toggle() {
		const next = playbackState === 'playing' ? 'paused' : 'playing';
		await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
		playbackState = next;
	}

	async function endSession() {
		await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
		playbackState = 'ended';
	}
</script>

<div class="flex flex-col items-center gap-6 p-8">
	<div class="text-center">
		<p class="text-sm text-gray-500 uppercase tracking-widest mb-1">Session code</p>
		<p class="text-6xl font-bold tracking-widest">{session.code}</p>
	</div>

	{#if qrDataUrl}
		<img src={qrDataUrl} alt="QR code to join session" class="w-48 h-48" />
	{/if}

	<p class="text-sm text-gray-400 break-all">{joinUrl}</p>

	{#if playbackState !== 'ended'}
		<button
			onclick={toggle}
			class="w-32 h-32 rounded-full text-white text-2xl font-bold transition-colors {playbackState === 'playing' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}"
		>
			{playbackState === 'playing' ? 'Pause' : 'Play'}
		</button>

		<button onclick={endSession} class="text-sm text-gray-400 underline">End session</button>
	{:else}
		<p class="text-gray-500">Session ended.</p>
	{/if}
</div>
