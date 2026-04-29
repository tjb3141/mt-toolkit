<script lang="ts">
	let secret = $state('');
	let genre = $state('');
	let playlist_url = $state('');
	let status = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
	let message = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		status = 'loading';
		message = '';

		try {
			const res = await fetch('/admin/trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secret, genre, playlist_url })
			});

			if (res.ok) {
				status = 'success';
				message = `Ingestion started for "${genre}". Check GitHub Actions for progress (~2 min).`;
				genre = '';
				playlist_url = '';
			} else {
				const text = await res.text();
				status = 'error';
				message = text || `Error ${res.status}`;
			}
		} catch (err) {
			status = 'error';
			message = String(err);
		}
	}
</script>

<main class="mx-auto max-w-md p-8">
	<h1 class="mb-6 text-2xl font-bold">Track Ingestion</h1>

	<form onsubmit={submit} class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm font-medium">
			Admin secret
			<input
				type="password"
				bind:value={secret}
				required
				class="rounded border px-3 py-2 font-mono text-sm"
			/>
		</label>

		<label class="flex flex-col gap-1 text-sm font-medium">
			Genre name
			<input
				type="text"
				bind:value={genre}
				placeholder="Pop"
				required
				class="rounded border px-3 py-2"
			/>
		</label>

		<label class="flex flex-col gap-1 text-sm font-medium">
			YouTube playlist URL
			<input
				type="url"
				bind:value={playlist_url}
				placeholder="https://www.youtube.com/playlist?list=..."
				required
				class="rounded border px-3 py-2"
			/>
		</label>

		<button
			type="submit"
			disabled={status === 'loading'}
			class="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
		>
			{status === 'loading' ? 'Triggering…' : 'Start ingestion'}
		</button>
	</form>

	{#if status === 'success'}
		<p class="mt-4 text-green-700">{message}</p>
	{:else if status === 'error'}
		<p class="mt-4 text-red-700">{message}</p>
	{/if}
</main>
