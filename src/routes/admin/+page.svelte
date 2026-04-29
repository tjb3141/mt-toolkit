<script lang="ts">
	import { supabase } from '$lib/supabase';

	type FileResult = { name: string; status: 'pending' | 'uploading' | 'done' | 'error'; message: string };

	let secret = $state('');
	let genre = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let results = $state<FileResult[]>([]);
	let running = $state(false);

	function getDuration(file: File): Promise<number> {
		return new Promise((resolve) => {
			const audio = new Audio();
			const url = URL.createObjectURL(file);
			audio.addEventListener('loadedmetadata', () => {
				URL.revokeObjectURL(url);
				resolve(Math.round(audio.duration) || 0);
			});
			audio.addEventListener('error', () => {
				URL.revokeObjectURL(url);
				resolve(0);
			});
			audio.src = url;
		});
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const files = fileInput?.files;
		if (!files || files.length === 0) return;

		running = true;
		results = Array.from(files).map((f) => ({ name: f.name, status: 'pending', message: '' }));

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const title = file.name.replace(/\.[^/.]+$/, '');
			results[i] = { ...results[i], status: 'uploading' };

			try {
				const duration = await getDuration(file);

				const signRes = await fetch('/admin/sign-upload', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ secret, genre, filename: file.name })
				});
				if (!signRes.ok) throw new Error(await signRes.text());
				const { path, token } = await signRes.json();

				const { error: upErr } = await supabase.storage
					.from('tracks')
					.uploadToSignedUrl(path, token, file, { contentType: 'audio/mpeg' });
				if (upErr) throw new Error(upErr.message);

				const trackRes = await fetch('/admin/tracks', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ secret, genre_name: genre, title, storage_path: path, duration_seconds: duration })
				});
				if (!trackRes.ok) throw new Error(await trackRes.text());

				results[i] = { ...results[i], status: 'done', message: `${duration}s` };
			} catch (err) {
				results[i] = { ...results[i], status: 'error', message: String(err) };
			}
		}

		running = false;
	}
</script>

<main class="mx-auto max-w-md p-8">
	<h1 class="mb-6 text-2xl font-bold">Upload Tracks</h1>

	<form onsubmit={submit} class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm font-medium">
			Admin secret
			<input type="password" bind:value={secret} required class="rounded border px-3 py-2 font-mono text-sm" />
		</label>

		<label class="flex flex-col gap-1 text-sm font-medium">
			Genre name
			<input type="text" bind:value={genre} placeholder="Pop" required class="rounded border px-3 py-2" />
		</label>

		<label class="flex flex-col gap-1 text-sm font-medium">
			MP3 files
			<input
				type="file"
				accept="audio/mpeg,.mp3"
				multiple
				bind:this={fileInput}
				required
				class="rounded border px-3 py-2"
			/>
		</label>

		<button
			type="submit"
			disabled={running}
			class="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
		>
			{running ? 'Uploading…' : 'Upload'}
		</button>
	</form>

	{#if results.length > 0}
		<ul class="mt-6 flex flex-col gap-2 text-sm">
			{#each results as r}
				<li class="flex items-center gap-2">
					{#if r.status === 'pending'}
						<span class="text-gray-400">–</span>
					{:else if r.status === 'uploading'}
						<span class="text-blue-500">↑</span>
					{:else if r.status === 'done'}
						<span class="text-green-600">✓</span>
					{:else}
						<span class="text-red-600">✗</span>
					{/if}
					<span class="flex-1 truncate">{r.name}</span>
					{#if r.message}
						<span class="text-gray-500">{r.message}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>
