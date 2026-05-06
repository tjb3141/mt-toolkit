import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { HomeButton } from '@/components/HomeButton';
import { C } from '@/components/ui';

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

function ah(secret: string) {
  return { 'Content-Type': 'application/json', 'x-admin-secret': secret };
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s > 0 ? `${s}s` : ''}`.trim();
  return `${s}s`;
}

function getDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.addEventListener('loadedmetadata', () => { URL.revokeObjectURL(url); resolve(Math.round(audio.duration) || 0); });
    audio.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0); });
    audio.src = url;
  });
}

async function fetchTracksForPlaylist(playlistId: string): Promise<Track[]> {
  const { data } = await supabase
    .from('playlist_tracks')
    .select('tracks(id, title, storage_path, duration_seconds)')
    .eq('playlist_id', playlistId);
  return ((data ?? []).map((r: any) => r.tracks).flat().filter(Boolean) as Track[])
    .sort((a, b) => a.title.localeCompare(b.title));
}

export default function AdminPage() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [genres, setGenres] = useState<Genre[]>([]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [poolExpanded, setPoolExpanded] = useState(false);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);

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
  // trackId -> playlistId being assigned (shows inline playlist picker)
  const [assigningTrackId, setAssigningTrackId] = useState<string | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function unlock() {
    setLoading(true);
    const { data, error } = await supabase.from('playlists').select('id, name, display_order').order('display_order');
    if (error) { setLoading(false); alert('Failed to load playlists.'); return; }
    const playlistsData = data ?? [];

    // Auto-load tracks for all playlists
    const withTracks = await Promise.all(
      playlistsData.map(async (g) => ({ ...g, tracks: await fetchTracksForPlaylist(g.id) }))
    );
    setLoading(false);
    setGenres(withTracks);
    setExpandedIds(new Set()); // all collapsed by default
    setUnlocked(true);
  }

  async function togglePlaylist(id: string) {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  async function togglePool() {
    if (!poolExpanded && allTracks.length === 0) {
      setLoadingPool(true);
      const { data } = await supabase.from('tracks').select('id, title, storage_path, duration_seconds').order('title');
      setAllTracks(data ?? []);
      setLoadingPool(false);
    }
    setPoolExpanded((v) => !v);
  }

  async function createGenre() {
    if (!newGenreName.trim()) return;
    setCreatingGenre(true);
    const res = await fetch('/api/admin/playlists', { method: 'POST', headers: ah(secret), body: JSON.stringify({ name: newGenreName.trim() }) });
    setCreatingGenre(false);
    if (!res.ok) { alert(await res.text()); return; }
    const genre = await res.json();
    setGenres((prev) => [...prev, { ...genre, tracks: [] }]);
    setNewGenreName('');
  }

  async function saveGenreName(id: string) {
    const res = await fetch(`/api/admin/playlists/${id}`, { method: 'PATCH', headers: ah(secret), body: JSON.stringify({ name: editingGenreName }) });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) => g.id === id ? { ...g, name: editingGenreName } : g));
    setEditingGenreId(null);
  }

  async function moveGenre(id: string, direction: 'up' | 'down') {
    const idx = genres.findIndex((g) => g.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= genres.length) return;
    const a = genres[idx], b = genres[swapIdx];
    const newOrderA = b.display_order, newOrderB = a.display_order;
    setGenres((prev) => {
      const next = [...prev];
      next[idx] = { ...a, display_order: newOrderA };
      next[swapIdx] = { ...b, display_order: newOrderB };
      return next.sort((x, y) => x.display_order - y.display_order);
    });
    await Promise.all([
      fetch(`/api/admin/playlists/${a.id}`, { method: 'PATCH', headers: ah(secret), body: JSON.stringify({ display_order: newOrderA }) }),
      fetch(`/api/admin/playlists/${b.id}`, { method: 'PATCH', headers: ah(secret), body: JSON.stringify({ display_order: newOrderB }) }),
    ]);
  }

  async function deleteGenre(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its tracks? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/playlists/${id}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.filter((g) => g.id !== id));
    setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function saveTrackTitle(genreId: string, trackId: string) {
    const res = await fetch(`/api/admin/tracks/${trackId}`, { method: 'PATCH', headers: ah(secret), body: JSON.stringify({ title: editingTrackTitle }) });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) => g.id === genreId ? { ...g, tracks: g.tracks?.map((t) => t.id === trackId ? { ...t, title: editingTrackTitle } : t) } : g));
    setAllTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, title: editingTrackTitle } : t));
    setEditingTrackId(null);
  }

  async function assignTrackToPlaylist(track: Track, playlistId: string) {
    const playlist = genres.find((g) => g.id === playlistId);
    if (!playlist) return;
    // Check not already in this playlist
    if (playlist.tracks?.some((t) => t.id === track.id)) {
      setAssigningTrackId(null);
      return;
    }
    const res = await fetch('/api/admin/playlist-tracks', {
      method: 'POST',
      headers: ah(secret),
      body: JSON.stringify({ playlist_id: playlistId, track_id: track.id }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setGenres((prev) => prev.map((g) => g.id === playlistId
      ? { ...g, tracks: [...(g.tracks ?? []), track].sort((a, b) => a.title.localeCompare(b.title)) }
      : g
    ));
    setAssigningTrackId(null);
  }

  async function deleteTrack(genreId: string | null, trackId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    const res = await fetch(`/api/admin/tracks/${trackId}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    if (genreId) setGenres((prev) => prev.map((g) => g.id === genreId ? { ...g, tracks: g.tracks?.filter((t) => t.id !== trackId) } : g));
    setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
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
        const signRes = await fetch('/api/admin/sign-upload', { method: 'POST', headers: ah(secret), body: JSON.stringify({ playlist: genreName, filename: file.name }) });
        if (!signRes.ok) throw new Error(await signRes.text());
        const { path, token } = await signRes.json();
        const { error: upErr } = await supabase.storage.from('tracks').uploadToSignedUrl(path, token, file, { contentType: 'audio/mpeg' });
        if (upErr) throw new Error(upErr.message);
        const trackRes = await fetch('/api/admin/tracks', { method: 'POST', headers: ah(secret), body: JSON.stringify({ playlist_name: genreName, title, storage_path: path, duration_seconds: duration }) });
        if (!trackRes.ok) throw new Error(await trackRes.text());
        const { id } = await trackRes.json();
        newTracks.push({ id, title, storage_path: path, duration_seconds: duration });
        results[i] = { ...results[i], status: 'done', message: fmtDuration(duration) };
      } catch (err) {
        results[i] = { ...results[i], status: 'error', message: String(err) };
      }
      setUploadResults((prev) => ({ ...prev, [genreId]: [...results] }));
    }
    setUploading(false);
    if (newTracks.length > 0) {
      setGenres((prev) => prev.map((g) => g.id === genreId ? { ...g, tracks: [...(g.tracks ?? []), ...newTracks].sort((a, b) => a.title.localeCompare(b.title)) } : g));
      setAllTracks((prev) => [...prev, ...newTracks].sort((a, b) => a.title.localeCompare(b.title)));
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
    if (!confirm(`End session ${code}?`)) return;
    const res = await fetch(`/api/admin/sessions/${id}`, { method: 'DELETE', headers: ah(secret) });
    if (!res.ok) { alert(await res.text()); return; }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function TrackRow({ track, genreId }: { track: Track; genreId: string | null }) {
    const isAssigning = assigningTrackId === track.id;
    return (
      <View style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
        <View style={s.row}>
        {editingTrackId === track.id ? (
          <>
            <TextInput value={editingTrackTitle} onChangeText={setEditingTrackTitle} onSubmitEditing={() => genreId && saveTrackTitle(genreId, track.id)} style={[s.textInput, { flex: 1, fontSize: 13, paddingVertical: 4, textAlign: 'left' }]} />
            <Pressable onPress={() => genreId && saveTrackTitle(genreId, track.id)} style={{ marginLeft: 8 }}><Text style={[s.saveText, { fontSize: 12 }]}>Save</Text></Pressable>
            <Pressable onPress={() => setEditingTrackId(null)} style={{ marginLeft: 8 }}><Text style={[s.mutedText, { fontSize: 12 }]}>Cancel</Text></Pressable>
          </>
        ) : (
          <>
            <Text style={[s.bodyText, { flex: 1, fontSize: 13 }]} numberOfLines={1}>{track.title}</Text>
            {track.duration_seconds != null && <Text style={[s.mutedText, { fontSize: 12 }]}>{fmtDuration(track.duration_seconds)}</Text>}
            {genreId === null && (
              <Pressable onPress={() => setAssigningTrackId(isAssigning ? null : track.id)} style={{ marginLeft: 8 }}>
                <Text style={[{ fontSize: 12, color: isAssigning ? '#a78bfa' : '#60a5fa' }]}>{isAssigning ? 'Cancel' : '+ Playlist'}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => { setEditingTrackId(track.id); setEditingTrackTitle(track.title); }} style={{ marginLeft: 8 }}><Text style={[s.mutedText, { fontSize: 12 }]}>Rename</Text></Pressable>
            <Pressable onPress={() => deleteTrack(genreId, track.id, track.title)} style={{ marginLeft: 8 }}><Text style={[s.deleteText, { fontSize: 12 }]}>Delete</Text></Pressable>
          </>
        )}
        </View>
        {isAssigning && genreId === null && (
          <View style={[s.row, { flexWrap: 'wrap', paddingTop: 6, paddingBottom: 4, gap: 6 }]}>
            {genres.map((g) => {
              const alreadyIn = g.tracks?.some((t) => t.id === track.id);
              return (
                <Pressable
                  key={g.id}
                  onPress={() => !alreadyIn && assignTrackToPlaylist(track, g.id)}
                  style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: alreadyIn ? '#27272a' : '#1e3a5f', opacity: alreadyIn ? 0.4 : 1 }}
                >
                  <Text style={{ color: '#fff', fontSize: 11 }}>{g.name}{alreadyIn ? ' ✓' : ''}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  if (!unlocked) {
    return (
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={s.heroPanel}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>Backstage</Text>
            <Text style={s.heroTitle}>Music Library</Text>
            <Text style={s.heroSub}>Tracks, playlists, and active rooms.</Text>
          </View>
          <HomeButton />
        </View>
        <View style={[s.panel, s.loginPanel]}>
          <Text style={s.fieldLabel}>Admin secret</Text>
          <TextInput value={secret} onChangeText={setSecret} secureTextEntry autoComplete="current-password" onSubmitEditing={unlock} placeholderTextColor="#52525b" style={s.textInput} />
          <Pressable onPress={unlock} disabled={loading} style={[s.btn, loading && s.btnDisabled]}>
            <Text style={s.btnText}>{loading ? 'Loading...' : 'Unlock'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
      <View style={s.heroPanel}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Backstage</Text>
          <Text style={s.heroTitle}>Music Library</Text>
          <Text style={s.heroSub}>Tracks, playlists, and active rooms.</Text>
        </View>
        <HomeButton />
      </View>

      {/* Track Pool */}
      <View style={[s.panel, { padding: 0, overflow: 'hidden' }]}>
        <Pressable onPress={togglePool} style={[s.row, { paddingHorizontal: 16, paddingVertical: 14 }]}>
          <Text style={{ color: '#71717a', fontSize: 12, marginRight: 4 }}>{poolExpanded ? '▼' : '▶'}</Text>
          <Text style={[s.bodyText, { flex: 1, fontWeight: '700' }]}>Track Pool</Text>
          <Text style={[s.mutedText, { fontSize: 12 }]}>{allTracks.length > 0 ? `${allTracks.length} tracks` : 'all uploaded tracks'}</Text>
        </Pressable>
        {poolExpanded && (
          <View style={[s.divider, { backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 16, paddingVertical: 12 }]}>
            {loadingPool ? (
              <Text style={s.mutedText}>Loading...</Text>
            ) : allTracks.length === 0 ? (
              <Text style={s.mutedText}>No tracks in pool.</Text>
            ) : (
              <View style={{ gap: 2 }}>
                {allTracks.map((track) => (
                  <TrackRow key={track.id} track={track} genreId={null} />
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* New playlist */}
      <View style={[s.panel, s.row]}>
        <TextInput value={newGenreName} onChangeText={setNewGenreName} placeholder="New playlist name..." placeholderTextColor="#52525b" onSubmitEditing={createGenre} style={[s.textInput, { flex: 1, textAlign: 'left', fontSize: 14, paddingVertical: 10 }]} />
        <Pressable onPress={createGenre} disabled={creatingGenre || !newGenreName.trim()} style={[s.btn, (creatingGenre || !newGenreName.trim()) && s.btnDisabled, { paddingHorizontal: 16, paddingVertical: 10 }]}>
          <Text style={s.btnText}>{creatingGenre ? 'Creating...' : '+ Playlist'}</Text>
        </Pressable>
      </View>

      {/* Playlists */}
      {genres.length === 0 ? (
        <Text style={s.mutedText}>No playlists yet.</Text>
      ) : (
        <View style={[s.panel, { padding: 0, overflow: 'hidden' }]}>
          {genres.map((genre, idx) => (
            <View key={genre.id} style={idx > 0 ? s.divider : undefined}>
              <View style={[s.row, { paddingHorizontal: 16, paddingVertical: 12 }]}>
                <Pressable onPress={() => togglePlaylist(genre.id)} style={{ marginRight: 4 }}>
                  <Text style={{ color: '#71717a', fontSize: 12 }}>{expandedIds.has(genre.id) ? '▼' : '▶'}</Text>
                </Pressable>
                <View style={{ flexDirection: 'column', gap: 1, marginRight: 4 }}>
                  <Pressable onPress={() => moveGenre(genre.id, 'up')} disabled={idx === 0} style={[s.orderBtn, idx === 0 && { opacity: 0.2 }]}><Text style={s.orderBtnText}>▲</Text></Pressable>
                  <Pressable onPress={() => moveGenre(genre.id, 'down')} disabled={idx === genres.length - 1} style={[s.orderBtn, idx === genres.length - 1 && { opacity: 0.2 }]}><Text style={s.orderBtnText}>▼</Text></Pressable>
                </View>
                {editingGenreId === genre.id ? (
                  <>
                    <TextInput value={editingGenreName} onChangeText={setEditingGenreName} onSubmitEditing={() => saveGenreName(genre.id)} style={[s.textInput, { flex: 1, fontSize: 14, paddingVertical: 6, textAlign: 'left' }]} />
                    <Pressable onPress={() => saveGenreName(genre.id)} style={{ marginLeft: 8 }}><Text style={s.saveText}>Save</Text></Pressable>
                    <Pressable onPress={() => setEditingGenreId(null)} style={{ marginLeft: 8 }}><Text style={s.mutedText}>Cancel</Text></Pressable>
                  </>
                ) : (
                  <>
                    <Text style={[s.bodyText, { flex: 1, fontWeight: '600' }]}>{genre.name}</Text>
                    {genre.tracks != null ? (
                      <Text style={[s.mutedText, { fontSize: 12 }]}>
                        {genre.tracks.length} tracks
                        {genre.tracks.length > 0 ? ` · ${fmtDuration(genre.tracks.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0))}` : ''}
                      </Text>
                    ) : (
                      <Text style={[s.mutedText, { fontSize: 12 }]}>...</Text>
                    )}
                    <Pressable onPress={() => { setEditingGenreId(genre.id); setEditingGenreName(genre.name); }} style={{ marginLeft: 8 }}><Text style={[s.mutedText, { fontSize: 12 }]}>Rename</Text></Pressable>
                    <Pressable onPress={() => deleteGenre(genre.id, genre.name)} style={{ marginLeft: 8 }}><Text style={[s.deleteText, { fontSize: 12 }]}>Delete</Text></Pressable>
                  </>
                )}
              </View>

              {expandedIds.has(genre.id) && (
                <View style={[s.divider, { backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 16, paddingVertical: 12 }]}>
                  {!genre.tracks || genre.tracks.length === 0 ? (
                    <Text style={[s.mutedText, { marginBottom: 12 }]}>No tracks yet.</Text>
                  ) : (
                    <View style={{ marginBottom: 16, gap: 2 }}>
                      {genre.tracks.map((track) => (
                        <TrackRow key={track.id} track={track} genreId={genre.id} />
                      ))}
                    </View>
                  )}
                  <View style={[s.row, { gap: 8 }]}>
                    <input type="file" accept="audio/mpeg,.mp3" multiple ref={(el) => { fileInputRefs.current[genre.id] = el; }} style={{ flex: 1, fontSize: 12, color: '#d4d4d8' }} />
                    <Pressable onPress={() => uploadToGenre(genre.id, genre.name)} disabled={uploading} style={[s.btn, uploading && s.btnDisabled, { paddingHorizontal: 12, paddingVertical: 6 }]}>
                      <Text style={[s.btnText, { fontSize: 12 }]}>Upload</Text>
                    </Pressable>
                  </View>
                  {uploadResults[genre.id]?.length > 0 && (
                    <View style={{ marginTop: 8, gap: 4 }}>
                      {uploadResults[genre.id].map((r, i) => (
                        <View key={i} style={[s.row, { gap: 8 }]}>
                          <Text style={{ fontSize: 12, color: r.status === 'done' ? '#34d399' : r.status === 'error' ? '#f87171' : r.status === 'uploading' ? '#60a5fa' : '#71717a' }}>
                            {r.status === 'done' ? '✓' : r.status === 'error' ? '✗' : r.status === 'uploading' ? '↑' : '–'}
                          </Text>
                          <Text style={[s.bodyText, { flex: 1, fontSize: 12 }]} numberOfLines={1}>{r.name}</Text>
                          {r.message ? <Text style={[s.mutedText, { fontSize: 12 }]}>{r.message}</Text> : null}
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
      <View style={[s.panel, { padding: 20 }]}>
        <View style={[s.row, { marginBottom: 16 }]}>
          <Text style={[s.bodyText, { flex: 1, fontSize: 18, fontWeight: '700' }]}>Active Sessions</Text>
          <Pressable onPress={loadSessions} disabled={loadingSessions} style={[s.btnSecondary, loadingSessions && s.btnDisabled]}>
            <Text style={[s.btnText, { fontSize: 12 }]}>{loadingSessions ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        </View>
        {sessions.length === 0 ? (
          <Text style={s.mutedText}>No active sessions. Hit Refresh to load.</Text>
        ) : (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            {sessions.map((session, idx) => (
              <View key={session.id} style={[s.row, { paddingHorizontal: 16, paddingVertical: 12, gap: 12 }, idx > 0 && s.divider]}>
                <Text style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: 4 }}>{session.code}</Text>
                <View style={{ backgroundColor: '#27272a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={[s.mutedText, { fontSize: 12 }]}>{session.mode}</Text>
                </View>
                <Text style={[s.mutedText, { fontSize: 12 }]}>{session.participant_count} participants</Text>
                <Text style={[s.mutedText, { flex: 1, fontSize: 12 }]}>expires {new Date(session.expires_at).toLocaleTimeString()}</Text>
                <Pressable onPress={() => endSession(session.id, session.code)}>
                  <Text style={[s.deleteText, { fontSize: 12 }]}>End</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { maxWidth: 768, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  heroPanel: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(27,25,44,0.92)', padding: 20 },
  panel: { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: C.panelBg, padding: 16 },
  loginPanel: { maxWidth: 400, gap: 12 },
  kicker: { color: C.kickerColor, fontSize: 11, fontWeight: '900', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 6 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
  heroSub: { color: '#a1a1aa', fontSize: 13, marginTop: 4 },
  fieldLabel: { color: '#a1a1aa', fontSize: 13, fontWeight: '500' },
  textInput: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 14, width: '100%' },
  btn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  btnSecondary: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#3f3f46', alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  bodyText: { color: '#e4e4e7', fontSize: 14 },
  mutedText: { color: '#71717a', fontSize: 13 },
  saveText: { color: '#34d399', fontSize: 13 },
  deleteText: { color: '#f87171', fontSize: 13 },
  orderBtn: { paddingHorizontal: 3, paddingVertical: 1 },
  orderBtnText: { color: '#52525b', fontSize: 9, lineHeight: 10 },
});
