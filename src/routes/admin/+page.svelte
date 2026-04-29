<script lang="ts">
	import HomeButton from '$lib/HomeButton.svelte';
	import { supabase } from '$lib/supabase';

	type Track = { id: string; title: string; storage_path: string; duration_seconds: number | null };
	type Genre = { id: string; name: string; display_order: number; tracks?: Track[] };

	let secret = $state('');
	let unlocked = $state(false);
	let loading = $state(false);
	let genres = $state<Genre[]>([]);

	let expandedIds = $state<Set<string>>(new Set());
	let loadingTracksFor = $state<string | null>(null);

	let editingGenreId = $state<string | null>(null);
	let editingGenreName = $state('');
	let editingTrackId = $state<string | null>(null);
	let editingTrackTitle = $state('');

	let newGenreName = $state('');
	let creatingGenre = $state(false);

	type SessionRow = {
		id: string;
		code: string;
		mode: string;
		playback_state: string;
		created_at: string;
		expires_at: string;
		participant_count: number;
	};
	let sessions = $state<SessionRow[]>([]);
	let loadingSessions = $state(false);

	async function loadSessions() {
		loadingSessions = true;
		const res = await fetch('/admin/sessions', { headers: ah() });
		loadingSessions = false;
		if (res.ok) sessions = await res.json();
	}

	async function endSession(id: string, code: string) {
		if (!confirm(`End session ${code}? All connected clients will see "Session ended".`)) return;
		const res = await fetch(`/admin/sessions/${id}`, { method: 'DELETE', headers: ah() });
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		sessions = sessions.filter((s) => s.id !== id);
	}

	let uploadGenreId = $state<string | null>(null);
	let fileInputs = $state<Record<string, HTMLInputElement | null>>({});
	let uploadResults = $state<Record<string, { name: string; status: string; message: string }[]>>(
		{}
	);
	let uploading = $state(false);

	async function unlock(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		const { data, error } = await supabase
			.from('playlists')
			.select('id, name, display_order')
			.order('display_order');
		loading = false;
		if (error) {
			alert('Failed to load playlists — check your secret is set in Vercel env vars.');
			return;
		}
		genres = data ?? [];
		unlocked = true;
	}

	async function togglePlaylist(id: string) {
		if (expandedIds.has(id)) {
			expandedIds = new Set([...expandedIds].filter((x) => x !== id));
			return;
		}
		expandedIds = new Set([...expandedIds, id]);
		const genre = genres.find((g) => g.id === id);
		if (genre?.tracks) return;
		loadingTracksFor = id;
		const { data } = await supabase
			.from('tracks')
			.select('id, title, storage_path, duration_seconds')
			.eq('playlist_id', id)
			.order('title');
		loadingTracksFor = null;
		genres = genres.map((g) => (g.id === id ? { ...g, tracks: data ?? [] } : g));
	}

	function ah(extra?: Record<string, string>) {
		return { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...extra };
	}

	async function createGenre(e: SubmitEvent) {
		e.preventDefault();
		if (!newGenreName.trim()) return;
		creatingGenre = true;
		const res = await fetch('/admin/playlists', {
			method: 'POST',
			headers: ah(),
			body: JSON.stringify({ name: newGenreName.trim() })
		});
		creatingGenre = false;
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		const genre = await res.json();
		genres = [...genres, { ...genre, tracks: [] }];
		newGenreName = '';
	}

	function startEditGenre(genre: Genre) {
		editingGenreId = genre.id;
		editingGenreName = genre.name;
	}

	async function saveGenreName(id: string) {
		const res = await fetch(`/admin/playlists/${id}`, {
			method: 'PATCH',
			headers: ah(),
			body: JSON.stringify({ name: editingGenreName })
		});
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		genres = genres.map((g) => (g.id === id ? { ...g, name: editingGenreName } : g));
		editingGenreId = null;
	}

	async function deleteGenre(id: string, name: string) {
		if (!confirm(`Delete "${name}" and all its tracks? This cannot be undone.`)) return;
		const res = await fetch(`/admin/playlists/${id}`, { method: 'DELETE', headers: ah() });
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		genres = genres.filter((g) => g.id !== id);
		expandedIds = new Set([...expandedIds].filter((x) => x !== id));
	}

	function startEditTrack(track: Track) {
		editingTrackId = track.id;
		editingTrackTitle = track.title;
	}

	async function saveTrackTitle(genreId: string, trackId: string) {
		const res = await fetch(`/admin/tracks/${trackId}`, {
			method: 'PATCH',
			headers: ah(),
			body: JSON.stringify({ title: editingTrackTitle })
		});
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		genres = genres.map((g) =>
			g.id === genreId
				? {
						...g,
						tracks: g.tracks?.map((t) =>
							t.id === trackId ? { ...t, title: editingTrackTitle } : t
						)
					}
				: g
		);
		editingTrackId = null;
	}

	async function deleteTrack(genreId: string, trackId: string, title: string) {
		if (!confirm(`Delete "${title}"?`)) return;
		const res = await fetch(`/admin/tracks/${trackId}`, { method: 'DELETE', headers: ah() });
		if (!res.ok) {
			alert(await res.text());
			return;
		}
		genres = genres.map((g) =>
			g.id === genreId ? { ...g, tracks: g.tracks?.filter((t) => t.id !== trackId) } : g
		);
	}

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

	async function uploadToGenre(genreId: string, genreName: string) {
		const input = fileInputs[genreId];
		const files = input?.files;
		if (!files || files.length === 0) return;

		uploading = true;
		uploadResults[genreId] = Array.from(files).map((f) => ({
			name: f.name,
			status: 'pending',
			message: ''
		}));

		const newTracks: Track[] = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const title = file.name.replace(/\.[^/.]+$/, '');
			uploadResults[genreId][i] = { ...uploadResults[genreId][i], status: 'uploading' };

			try {
				const duration = await getDuration(file);

				const signRes = await fetch('/admin/sign-upload', {
					method: 'POST',
					headers: ah(),
					body: JSON.stringify({ playlist: genreName, filename: file.name })
				});
				if (!signRes.ok) throw new Error(await signRes.text());
				const { path, token } = await signRes.json();

				const { error: upErr } = await supabase.storage
					.from('tracks')
					.uploadToSignedUrl(path, token, file, { contentType: 'audio/mpeg' });
				if (upErr) throw new Error(upErr.message);

				const trackRes = await fetch('/admin/tracks', {
					method: 'POST',
					headers: ah(),
					body: JSON.stringify({
						playlist_name: genreName,
						title,
						storage_path: path,
						duration_seconds: duration
					})
				});
				if (!trackRes.ok) throw new Error(await trackRes.text());
				const { id } = await trackRes.json();

				newTracks.push({ id, title, storage_path: path, duration_seconds: duration });
				uploadResults[genreId][i] = {
					...uploadResults[genreId][i],
					status: 'done',
					message: `${duration}s`
				};
			} catch (err) {
				uploadResults[genreId][i] = {
					...uploadResults[genreId][i],
					status: 'error',
					message: String(err)
				};
			}
		}

		uploading = false;
		if (newTracks.length > 0) {
			genres = genres.map((g) =>
				g.id === genreId
					? {
							...g,
							tracks: [...(g.tracks ?? []), ...newTracks].sort((a, b) =>
								a.title.localeCompare(b.title)
							)
						}
					: g
			);
		}
		if (input) input.value = '';
	}

	function trackCount(genre: Genre) {
		return genre.tracks != null ? genre.tracks.length : '…';
	}
</script>

<main class="stage-shell mx-auto max-w-3xl p-5 font-sans sm:p-8">
	<header class="music-panel-strong mb-6 flex items-center justify-between gap-4 rounded-2xl p-5">
		<div>
			<p class="music-kicker mb-2">Backstage</p>
			<h1 class="stage-title text-3xl font-black">Music Library</h1>
			<p class="mt-1 text-sm text-zinc-300">Tracks, playlists, and active rooms.</p>
		</div>
		<HomeButton class="shrink-0" />
	</header>

	{#if !unlocked}
		<form onsubmit={unlock} class="music-panel flex max-w-sm flex-col gap-4 rounded-2xl p-5">
			<label class="flex flex-col gap-1 text-sm font-medium">
				Admin secret
				<input
					type="password"
					bind:value={secret}
					required
					autocomplete="current-password"
					class="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white"
				/>
			</label>
			<button
				type="submit"
				disabled={loading}
				class="primary-glow rounded-xl px-4 py-3 text-sm font-black text-white disabled:opacity-50"
			>
				{loading ? 'Loading…' : 'Unlock'}
			</button>
		</form>
	{:else}
		<!-- New playlist -->
		<form onsubmit={createGenre} class="music-panel mb-8 flex gap-2 rounded-2xl p-4">
			<input
				type="text"
				bind:value={newGenreName}
				placeholder="New playlist name…"
				class="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
			/>
			<button
				type="submit"
				disabled={creatingGenre || !newGenreName.trim()}
				class="primary-glow rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-40"
			>
				{creatingGenre ? 'Creating…' : '+ Playlist'}
			</button>
		</form>

		<!-- Playlist list -->
		{#if genres.length === 0}
			<p class="text-sm text-zinc-400">No playlists yet.</p>
		{:else}
			<div class="music-panel flex flex-col divide-y divide-white/10 rounded-2xl">
				{#each genres as genre (genre.id)}
					<div>
						<!-- Genre row -->
						<div class="flex items-center gap-2 px-4 py-3">
							<button
								onclick={() => togglePlaylist(genre.id)}
								class="mr-1 text-zinc-400 transition-transform {expandedIds.has(genre.id)
									? 'rotate-90'
									: ''}"
								aria-label="expand">▶</button
							>

							{#if editingGenreId === genre.id}
								<input
									bind:value={editingGenreName}
									onkeydown={(e) => {
										if (e.key === 'Enter') saveGenreName(genre.id);
										if (e.key === 'Escape') editingGenreId = null;
									}}
									class="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm font-semibold text-white"
								/>
								<button
									onclick={() => saveGenreName(genre.id)}
									class="text-sm text-emerald-400 hover:underline">Save</button
								>
								<button
									onclick={() => (editingGenreId = null)}
									class="text-sm text-zinc-400 hover:underline">Cancel</button
								>
							{:else}
								<span class="flex-1 font-semibold">{genre.name}</span>
								<span class="text-xs text-zinc-500">{trackCount(genre)} tracks</span>
								<button
									onclick={() => startEditGenre(genre)}
									class="text-xs text-zinc-400 hover:text-white">Rename</button
								>
								<button
									onclick={() => deleteGenre(genre.id, genre.name)}
									class="text-xs text-red-400 hover:text-red-300">Delete</button
								>
							{/if}
						</div>

						<!-- Expanded: tracks + upload -->
						{#if expandedIds.has(genre.id)}
							<div class="border-t border-white/10 bg-black/20 px-4 py-3">
								{#if loadingTracksFor === genre.id}
									<p class="text-sm text-zinc-400">Loading…</p>
								{:else if !genre.tracks || genre.tracks.length === 0}
									<p class="mb-3 text-sm text-zinc-400">No tracks yet.</p>
								{:else}
									<ul class="mb-4 flex flex-col gap-0.5">
										{#each genre.tracks as track (track.id)}
											<li class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800">
												{#if editingTrackId === track.id}
													<input
														bind:value={editingTrackTitle}
														onkeydown={(e) => {
															if (e.key === 'Enter') saveTrackTitle(genre.id, track.id);
															if (e.key === 'Escape') editingTrackId = null;
														}}
														class="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-white"
													/>
													<button
														onclick={() => saveTrackTitle(genre.id, track.id)}
														class="text-xs text-emerald-400 hover:underline">Save</button
													>
													<button
														onclick={() => (editingTrackId = null)}
														class="text-xs text-zinc-400 hover:underline">Cancel</button
													>
												{:else}
													<span class="flex-1 truncate text-sm text-zinc-100">{track.title}</span>
													{#if track.duration_seconds}
														<span class="shrink-0 text-xs text-zinc-500"
															>{track.duration_seconds}s</span
														>
													{/if}
													<button
														onclick={() => startEditTrack(track)}
														class="shrink-0 text-xs text-zinc-400 hover:text-white">Rename</button
													>
													<button
														onclick={() => deleteTrack(genre.id, track.id, track.title)}
														class="shrink-0 text-xs text-red-400 hover:text-red-300">Delete</button
													>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}

								<!-- Upload to this genre -->
								<div class="flex items-center gap-2">
									<input
										type="file"
										accept="audio/mpeg,.mp3"
										multiple
										bind:this={fileInputs[genre.id]}
										class="flex-1 text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-zinc-600"
									/>
									<button
										onclick={() => uploadToGenre(genre.id, genre.name)}
										disabled={uploading}
										class="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
									>
										{uploading && uploadGenreId === genre.id ? 'Uploading…' : 'Upload'}
									</button>
								</div>

								{#if uploadResults[genre.id]?.length > 0}
									<ul class="mt-2 flex flex-col gap-1">
										{#each uploadResults[genre.id] as r}
											<li class="flex items-center gap-2 text-xs">
												{#if r.status === 'pending'}<span class="text-zinc-500">–</span>
												{:else if r.status === 'uploading'}<span class="text-blue-400">↑</span>
												{:else if r.status === 'done'}<span class="text-emerald-400">✓</span>
												{:else}<span class="text-red-400">✗</span>{/if}
												<span class="flex-1 truncate text-zinc-300">{r.name}</span>
												{#if r.message}<span class="text-zinc-500">{r.message}</span>{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Active sessions -->
		<div class="music-panel mt-12 rounded-2xl p-5">
			<div class="mb-4 flex items-center gap-4">
				<h2 class="text-lg font-bold">Active Sessions</h2>
				<button
					onclick={loadSessions}
					disabled={loadingSessions}
					class="rounded bg-zinc-700 px-3 py-1 text-xs font-semibold text-white hover:bg-zinc-600 disabled:opacity-40"
				>
					{loadingSessions ? 'Loading…' : 'Refresh'}
				</button>
			</div>
			{#if sessions.length === 0}
				<p class="text-sm text-zinc-500">No active sessions. Hit Refresh to load.</p>
			{:else}
				<div class="flex flex-col divide-y divide-white/10 rounded-2xl border border-white/10">
					{#each sessions as s (s.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<span class="font-mono text-lg font-bold tracking-widest">{s.code}</span>
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{s.mode}</span>
							<span class="text-xs text-zinc-400">{s.participant_count} participants</span>
							<span class="flex-1 text-xs text-zinc-500">
								expires {new Date(s.expires_at).toLocaleTimeString()}
							</span>
							<button
								onclick={() => endSession(s.id, s.code)}
								class="text-xs text-red-400 hover:text-red-300"
							>
								End
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</main>
