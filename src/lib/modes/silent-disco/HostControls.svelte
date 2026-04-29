<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();
	let playbackState = $state(untrack(() => session.playback_state));
	let qrDataUrl = $state('');

	type Participant = { id: string; name: string; genre_id: string | null; joined_at: string };
	let participants = $state<Participant[]>([]);
	let genreMap = $state<Record<string, string>>({});
	let channel: RealtimeChannel | null = null;

	const joinUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${session.code}`
	);

	onMount(async () => {
		const url = `${window.location.origin}/join/${session.code}`;
		qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });

		const { data: genreData } = await supabase.from('genres').select('id, name');
		genreMap = Object.fromEntries((genreData ?? []).map((g) => [g.id, g.name]));

		const { data } = await supabase
			.from('participants')
			.select('id, name, genre_id, joined_at')
			.eq('session_id', session.id)
			.order('joined_at');
		participants = data ?? [];

		channel = supabase
			.channel(`participants:${session.id}`)
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'participants', filter: `session_id=eq.${session.id}` },
				(payload) => {
					participants = [...participants, payload.new as Participant];
				}
			)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'participants', filter: `session_id=eq.${session.id}` },
				(payload) => {
					participants = participants.map((p) =>
						p.id === payload.new.id ? (payload.new as Participant) : p
					);
				}
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
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

<div class="flex min-h-screen flex-col items-center gap-8 p-8">
	<div class="text-center">
		<p class="mb-1 text-sm uppercase tracking-widest text-gray-500">Session code</p>
		<p class="text-6xl font-bold tracking-widest">{session.code}</p>
	</div>

	{#if qrDataUrl}
		<img src={qrDataUrl} alt="QR code to join session" class="h-48 w-48" />
	{/if}

	<p class="text-sm text-gray-400">{joinUrl}</p>

	{#if playbackState !== 'ended'}
		<button
			onclick={toggle}
			class="h-32 w-32 rounded-full text-2xl font-bold text-white transition-colors {playbackState === 'playing' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}"
		>
			{playbackState === 'playing' ? 'Pause' : 'Play'}
		</button>
		<button onclick={endSession} class="text-sm text-gray-400 underline">End session</button>
	{:else}
		<p class="text-gray-500">Session ended.</p>
	{/if}

	<div class="w-full max-w-sm">
		<p class="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">
			Participants ({participants.length})
		</p>
		{#if participants.length === 0}
			<p class="text-sm text-gray-400">No one has joined yet.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each participants as p (p.id)}
					<li class="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
						<span class="font-medium">{p.name}</span>
						<span class="text-sm text-gray-400">
							{p.genre_id ? genreMap[p.genre_id] ?? '…' : 'picking…'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
