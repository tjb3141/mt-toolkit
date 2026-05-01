import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { supabase } from '@/lib/supabase';
import { HomeButton } from '@/components/HomeButton';

type Track = { id: string; title: string; storage_path: string; duration_seconds: number | null };
type Genre = { id: string; name: string; display_order: number; tracks?: Track[] };
type SessionRow = {
  id: string;
  code: string;
  mode: string;
  playback_state: string;
  created_at: string;
  expires_at: string;
  participant_count: number;
};

function ah(secret: string, extra?: Record<string, string>) {
  return { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...extra };
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

export default function AdminPage() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [genres, setGenres] = useState<Genre[]>([]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingTracksFor, setLoadingTracksFor] = useState<string | null>(null);

  const [editingGenreId, setEditingGenreId] = useState<string | null>(null);
  const [editingGenreName, setEditingGenreName] = useState('');
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackTitle, setEditingTrackTitle] = useState('');

  const [newGenreName, setNewGenreName] = useState('');
  const [creatingGenre, setCreatingGenre] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [uploadResults, setUploadResults] = useState<Record<string, { name: string; status: string; message: string }[]>>({});
  const [uploading, setUploading] = useState(false);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function unlock() {
    setLoading(true);
    const { data, error } = await supabase
      .from('playlists')
      .select('id, name, display_order')
      .order('display_order');
    setLoading(false);
    if (error) {
      alert('Failed to load playlists — check your secret is set in Vercel env vars.');
      return;
    }
    setGenres(data ?? []);
    setUnlocked(true);
  }

  async function togglePlaylist(id: string) {
    if (expandedIds.has(id)) {
      setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    setExpandedIds((prev) => new Set([...prev, id]));
    const genre = genres.find((g) => g.id === id);
    if (genre?.tracks) return;
    setLoadingTracksFor(id);
    const { data } = await supabase
      .from('tracks')
      .select('id, title, storage_path, duration_seconds')
      .eq('playlist_id', id)
      .order('title');
    setLoadingTracksFor(null);
    setGenres((prev) => prev.map((g) => (g.id === id ? { ...g, tracks: data ?? [] } : g)));
  }

  async function createGenre() {
    if (!newGenreName.trim()) return;
    setCreatingGenre(true);
    const res = await fetch('/api/admin/playlists', {
      method: 'POST',
      headers: ah(secret),
      body: JSON.stringify({ name: newGenreName.trim() }),
    });
    setCreatingGenre(false);
    if (!res.ok) { alert(await res.text()); return; }
    const genre = await res.json();
    setGenres((prev) => [...prev, { ...genre, tracks: [] }]);
    setNewGenreName('');
  }

  async function saveGenreName(id: string) {
    const res = await fetch(`/api/admin/playlists/${id}`, {
      method: 'PATCH',
      headers: ah(secret),
      body: JSON.stringify({ name: editingGenreName }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) => (g.id === id ? { ...g, name: editingGenreName } : g)));
    setEditingGenreId(null);
  }

  async function deleteGenre(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its tracks? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/playlists/${id}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.filter((g) => g.id !== id));
    setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function saveTrackTitle(genreId: string, trackId: string) {
    const res = await fetch(`/api/admin/tracks/${trackId}`, {
      method: 'PATCH',
      headers: ah(secret),
      body: JSON.stringify({ title: editingTrackTitle }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) =>
      g.id === genreId
        ? { ...g, tracks: g.tracks?.map((t) => (t.id === trackId ? { ...t, title: editingTrackTitle } : t)) }
        : g
    ));
    setEditingTrackId(null);
  }

  async function deleteTrack(genreId: string, trackId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    const res = await fetch(`/api/admin/tracks/${trackId}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) =>
      g.id === genreId ? { ...g, tracks: g.tracks?.filter((t) => t.id !== trackId) } : g
    ));
  }

  async function uploadToGenre(genreId: string, genreName: string) {
    const input = fileInputRefs.current[genreId];
    const files = input?.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const results = Array.from(files).map((f) => ({ name: f.name, status: 'pending', message: '' }));
    setUploadResults((prev) => ({ ...prev, [genreId]: results }));

    const newTracks: Track[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const title = file.name.replace(/\.[^/.]+$/, '');
      results[i] = { ...results[i], status: 'uploading' };
      setUploadResults((prev) => ({ ...prev, [genreId]: [...results] }));

      try {
        const duration = await getDuration(file);

        const signRes = await fetch('/api/admin/sign-upload', {
          method: 'POST',
          headers: ah(secret),
          body: JSON.stringify({ playlist: genreName, filename: file.name }),
        });
        if (!signRes.ok) throw new Error(await signRes.text());
        const { path, token } = await signRes.json();

        const { error: upErr } = await supabase.storage
          .from('tracks')
          .uploadToSignedUrl(path, token, file, { contentType: 'audio/mpeg' });
        if (upErr) throw new Error(upErr.message);

        const trackRes = await fetch('/api/admin/tracks', {
          method: 'POST',
          headers: ah(secret),
          body: JSON.stringify({ playlist_name: genreName, title, storage_path: path, duration_seconds: duration }),
        });
        if (!trackRes.ok) throw new Error(await trackRes.text());
        const { id } = await trackRes.json();

        newTracks.push({ id, title, storage_path: path, duration_seconds: duration });
        results[i] = { ...results[i], status: 'done', message: `${duration}s` };
      } catch (err) {
        results[i] = { ...results[i], status: 'error', message: String(err) };
      }
      setUploadResults((prev) => ({ ...prev, [genreId]: [...results] }));
    }

    setUploading(false);
    if (newTracks.length > 0) {
      setGenres((prev) => prev.map((g) =>
        g.id === genreId
          ? { ...g, tracks: [...(g.tracks ?? []), ...newTracks].sort((a, b) => a.title.localeCompare(b.title)) }
          : g
      ));
    }
    if (input) input.value = '';
  }

  async function loadSessions() {
    setLoadingSessions(true);
    const res = await fetch('/api/admin/sessions', { headers: ah(secret) });
    setLoadingSessions(false);
    if (res.ok) setSessions(await res.json());
  }

  async function endSession(id: string, code: string) {
    if (!confirm(`End session ${code}? All connected clients will see "Session ended".`)) return;
    const res = await fetch(`/api/admin/sessions/${id}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function trackCount(genre: Genre) {
    return genre.tracks != null ? genre.tracks.length : '...';
  }

  // LOCKED
  if (!unlocked) {
    return (
      <ScrollView className="stage-shell mx-auto max-w-3xl p-5">
        <View className="music-panel-strong mb-6 flex-row items-center justify-between gap-4 rounded-2xl p-5">
          <View>
            <Text className="music-kicker mb-2">Backstage</Text>
            <Text className="stage-title text-3xl font-black text-white">Music Library</Text>
            <Text className="mt-1 text-sm text-zinc-300">Tracks, playlists, and active rooms.</Text>
          </View>
          <HomeButton />
        </View>
        <View className="music-panel max-w-sm gap-4 rounded-2xl p-5">
          <Text className="text-sm font-medium text-zinc-300">Admin secret</Text>
          <TextInput
            value={secret}
            onChangeText={setSecret}
            secureTextEntry
            autoComplete="current-password"
            onSubmitEditing={unlock}
            className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white"
          />
          <Pressable onPress={unlock} disabled={loading} className={`primary-glow rounded-xl px-4 py-3 items-center ${loading ? 'opacity-50' : ''}`}>
            <Text className="text-sm font-black text-white">{loading ? 'Loading...' : 'Unlock'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // UNLOCKED
  return (
    <ScrollView className="stage-shell mx-auto max-w-3xl p-5" contentContainerClassName="gap-6">
      <View className="music-panel-strong flex-row items-center justify-between gap-4 rounded-2xl p-5">
        <View>
          <Text className="music-kicker mb-2">Backstage</Text>
          <Text className="stage-title text-3xl font-black text-white">Music Library</Text>
          <Text className="mt-1 text-sm text-zinc-300">Tracks, playlists, and active rooms.</Text>
        </View>
        <HomeButton />
      </View>

      {/* New playlist */}
      <View className="music-panel flex-row gap-2 rounded-2xl p-4">
        <TextInput
          value={newGenreName}
          onChangeText={setNewGenreName}
          placeholder="New playlist name..."
          placeholderTextColor="#71717a"
          onSubmitEditing={createGenre}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
        />
        <Pressable onPress={createGenre} disabled={creatingGenre || !newGenreName.trim()} className={`primary-glow rounded-xl px-4 py-2 items-center ${creatingGenre || !newGenreName.trim() ? 'opacity-40' : ''}`}>
          <Text className="text-sm font-black text-white">{creatingGenre ? 'Creating...' : '+ Playlist'}</Text>
        </Pressable>
      </View>

      {/* Playlist list */}
      {genres.length === 0 ? (
        <Text className="text-sm text-zinc-400">No playlists yet.</Text>
      ) : (
        <View className="music-panel rounded-2xl overflow-hidden">
          {genres.map((genre, idx) => (
            <View key={genre.id} className={idx > 0 ? 'border-t border-white/10' : ''}>
              {/* Genre row */}
              <View className="flex-row items-center gap-2 px-4 py-3">
                <Pressable onPress={() => togglePlaylist(genre.id)} className={`mr-1 ${expandedIds.has(genre.id) ? 'rotate-90' : ''}`}>
                  <Text className="text-zinc-400">▶</Text>
                </Pressable>

                {editingGenreId === genre.id ? (
                  <>
                    <TextInput
                      value={editingGenreName}
                      onChangeText={setEditingGenreName}
                      onSubmitEditing={() => saveGenreName(genre.id)}
                      className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm font-semibold text-white"
                    />
                    <Pressable onPress={() => saveGenreName(genre.id)}>
                      <Text className="text-sm text-emerald-400">Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingGenreId(null)}>
                      <Text className="text-sm text-zinc-400">Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text className="flex-1 font-semibold text-white">{genre.name}</Text>
                    <Text className="text-xs text-zinc-500">{trackCount(genre)} tracks</Text>
                    <Pressable onPress={() => { setEditingGenreId(genre.id); setEditingGenreName(genre.name); }}>
                      <Text className="text-xs text-zinc-400">Rename</Text>
                    </Pressable>
                    <Pressable onPress={() => deleteGenre(genre.id, genre.name)}>
                      <Text className="text-xs text-red-400">Delete</Text>
                    </Pressable>
                  </>
                )}
              </View>

              {/* Expanded: tracks + upload */}
              {expandedIds.has(genre.id) && (
                <View className="border-t border-white/10 bg-black/20 px-4 py-3">
                  {loadingTracksFor === genre.id ? (
                    <Text className="text-sm text-zinc-400">Loading...</Text>
                  ) : !genre.tracks || genre.tracks.length === 0 ? (
                    <Text className="mb-3 text-sm text-zinc-400">No tracks yet.</Text>
                  ) : (
                    <View className="mb-4 gap-0.5">
                      {genre.tracks.map((track) => (
                        <View key={track.id} className="flex-row items-center gap-2 rounded px-2 py-1.5">
                          {editingTrackId === track.id ? (
                            <>
                              <TextInput
                                value={editingTrackTitle}
                                onChangeText={setEditingTrackTitle}
                                onSubmitEditing={() => saveTrackTitle(genre.id, track.id)}
                                className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-white"
                              />
                              <Pressable onPress={() => saveTrackTitle(genre.id, track.id)}>
                                <Text className="text-xs text-emerald-400">Save</Text>
                              </Pressable>
                              <Pressable onPress={() => setEditingTrackId(null)}>
                                <Text className="text-xs text-zinc-400">Cancel</Text>
                              </Pressable>
                            </>
                          ) : (
                            <>
                              <Text className="flex-1 text-sm text-zinc-100" numberOfLines={1}>{track.title}</Text>
                              {track.duration_seconds && (
                                <Text className="text-xs text-zinc-500">{track.duration_seconds}s</Text>
                              )}
                              <Pressable onPress={() => { setEditingTrackId(track.id); setEditingTrackTitle(track.title); }}>
                                <Text className="text-xs text-zinc-400">Rename</Text>
                              </Pressable>
                              <Pressable onPress={() => deleteTrack(genre.id, track.id, track.title)}>
                                <Text className="text-xs text-red-400">Delete</Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Upload — web only using native input */}
                  <View className="flex-row items-center gap-2">
                    <input
                      type="file"
                      accept="audio/mpeg,.mp3"
                      multiple
                      ref={(el) => { fileInputRefs.current[genre.id] = el; }}
                      style={{ flex: 1, fontSize: 12, color: '#d4d4d8' }}
                    />
                    <Pressable onPress={() => uploadToGenre(genre.id, genre.name)} disabled={uploading} className={`rounded bg-indigo-600 px-3 py-1.5 ${uploading ? 'opacity-40' : ''}`}>
                      <Text className="text-xs font-semibold text-white">Upload</Text>
                    </Pressable>
                  </View>

                  {/* Upload results */}
                  {uploadResults[genre.id]?.length > 0 && (
                    <View className="mt-2 gap-1">
                      {uploadResults[genre.id].map((r, i) => (
                        <View key={i} className="flex-row items-center gap-2">
                          <Text className={`text-xs ${r.status === 'done' ? 'text-emerald-400' : r.status === 'error' ? 'text-red-400' : r.status === 'uploading' ? 'text-blue-400' : 'text-zinc-500'}`}>
                            {r.status === 'done' ? '✓' : r.status === 'error' ? '✗' : r.status === 'uploading' ? '↑' : '–'}
                          </Text>
                          <Text className="flex-1 text-xs text-zinc-300" numberOfLines={1}>{r.name}</Text>
                          {r.message ? <Text className="text-xs text-zinc-500">{r.message}</Text> : null}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Active sessions */}
      <View className="music-panel rounded-2xl p-5">
        <View className="flex-row items-center gap-4 mb-4">
          <Text className="text-lg font-bold text-white">Active Sessions</Text>
          <Pressable onPress={loadSessions} disabled={loadingSessions} className={`rounded bg-zinc-700 px-3 py-1 ${loadingSessions ? 'opacity-40' : ''}`}>
            <Text className="text-xs font-semibold text-white">{loadingSessions ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        </View>
        {sessions.length === 0 ? (
          <Text className="text-sm text-zinc-500">No active sessions. Hit Refresh to load.</Text>
        ) : (
          <View className="rounded-2xl border border-white/10 overflow-hidden">
            {sessions.map((s, idx) => (
              <View key={s.id} className={`flex-row items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-white/10' : ''}`}>
                <Text className="font-mono text-lg font-bold tracking-widest text-white">{s.code}</Text>
                <View className="rounded bg-zinc-800 px-2 py-0.5">
                  <Text className="text-xs text-zinc-400">{s.mode}</Text>
                </View>
                <Text className="text-xs text-zinc-400">{s.participant_count} participants</Text>
                <Text className="flex-1 text-xs text-zinc-500">
                  expires {new Date(s.expires_at).toLocaleTimeString()}
                </Text>
                <Pressable onPress={() => endSession(s.id, s.code)}>
                  <Text className="text-xs text-red-400">End</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
