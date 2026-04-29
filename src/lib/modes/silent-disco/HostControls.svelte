<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import QRCode from 'qrcode';
	import type { Session } from '$lib/modes/index';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { session }: { session: Session } = $props();
	let playbackState = $state(untrack(() => session.playback_state));
	let qrDataUrl = $state('');

	type Participant = {
		id: string;
		name: string;
		genre_id: string | null;
		current_track: string | null;
		joined_at: string;
	};
	let participants = $state<Participant[]>([]);
	let genreMap = $state<Record<string, string>>({});
	let channel: RealtimeChannel | null = null;

	const joinUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${session.code}`
	);

	onMount(async () => {
		const url = `${window.location.origin}/join/${session.code}`;
		qrDataUrl = await QRCode.toDataURL(url, {
			margin: 2,
			scale: 6,
			color: { dark: '#ffffff', light: '#18181b' }
		});

		const { data: genreData } = await supabase.from('genres').select('id, name');
		genreMap = Object.fromEntries((genreData ?? []).map((g) => [g.id, g.name]));

		const { data } = await supabase
			.from('participants')
			.select('id, name, genre_id, current_track, joined_at')
			.eq('session_id', session.id)
			.order('joined_at');
		participants = data ?? [];

		channel = supabase
			.channel(`participants:${session.id}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'participants',
					filter: `session_id=eq.${session.id}`
				},
				(payload) => {
					participants = [...participants, payload.new as Participant];
				}
			)
			// No filter on UPDATE — Postgres needs REPLICA IDENTITY FULL to filter UPDATE events
			// by non-PK columns. We filter client-side instead.
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'participants' },
				(payload) => {
					if (payload.new.session_id !== session.id) return;
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

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col items-center gap-8 px-6 py-8">
	<div class="flex w-full items-center justify-between gap-4">
		<p class="text-xs font-semibold tracking-[0.3em] text-violet-400 uppercase">
			MT Toolkit / Host
		</p>
		<a href="/" class="shrink-0 text-sm font-semibold text-zinc-500 hover:text-zinc-300">
			Main menu
		</a>
	</div>

	<div class="text-center">
		<p class="mb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase">Session code</p>
		<p class="text-7xl font-black tracking-widest">{session.code}</p>
	</div>

	{#if qrDataUrl}
		<div class="rounded-lg bg-zinc-900 p-3">
			<img src={qrDataUrl} alt="QR code to join session" class="h-44 w-44" />
		</div>
	{/if}

	<p class="max-w-xs text-center text-xs break-all text-zinc-500">{joinUrl}</p>

	{#if playbackState !== 'ended'}
		<button
			onclick={toggle}
			class="h-36 w-36 rounded-full text-2xl font-black text-white shadow-lg transition-all active:scale-95 {playbackState ===
			'playing'
				? 'bg-red-500 shadow-red-900 hover:bg-red-400'
				: 'bg-emerald-500 shadow-emerald-900 hover:bg-emerald-400'}"
		>
			{playbackState === 'playing' ? 'Pause' : 'Play'}
		</button>
		<button
			onclick={endSession}
			class="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-400"
		>
			End session
		</button>
	{:else}
		<p class="text-zinc-500">Session ended.</p>
	{/if}

	<div class="w-full max-w-sm">
		<p class="mb-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
			Participants ({participants.length})
		</p>
		{#if participants.length === 0}
			<p class="text-sm text-zinc-600">No one has joined yet.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each participants as p (p.id)}
					<li class="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
						<div class="flex items-center justify-between">
							<span class="font-semibold">{p.name}</span>
							<span class="text-xs text-zinc-500">
								{p.genre_id ? (genreMap[p.genre_id] ?? '...') : 'picking...'}
							</span>
						</div>
						{#if p.current_track}
							<span class="truncate text-sm text-zinc-400">{p.current_track}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
