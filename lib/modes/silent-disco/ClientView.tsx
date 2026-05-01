import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, IconTile, StyledInput, C } from '@/components/ui';
import type { ModeProps } from '@/lib/modes';
import type { Playlist, Track } from '@/lib/types';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function SilentDiscoClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [genres, setGenres] = useState<Playlist[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [submitting, setSubmitting] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const tracksRef = useLatest(tracks);
  const currentIndexRef = useLatest(currentIndex);

  const nextTrack = useCallback(() => { setCurrentIndex((i) => (i + 1) % tracksRef.current.length); }, []);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: false, onEnd: nextTrack });

  useEffect(() => {
    supabase.from('playlists').select('id, name').order('display_order').then(({ data }) => setGenres(data ?? []));
  }, []);

  useRealtimeTable(`session:${session.id}`, [
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => { const s = p.new.playback_state; setPlaybackState(s); if (s === 'playing') play(); else pause(); } },
  ]);

  useEffect(() => {
    if (tracks.length === 0) return;
    loadTrack(tracks[currentIndex].id, session.id).then(() => { if (playbackStateRef.current === 'playing') play(); });
  }, [tracks, currentIndex]);

  useEffect(() => {
    if (!participantId || tracks.length === 0) return;
    supabase.from('participants').update({ current_track: tracks[currentIndex].title }).eq('id', participantId).then(() => {});
  }, [participantId, tracks, currentIndex]);

  async function selectGenre(genre: Playlist) {
    setSelectedGenre(genre);
    if (participantId) await supabase.from('participants').update({ playlist_id: genre.id }).eq('id', participantId);
    const { data } = await supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('playlist_id', genre.id);
    setTracks(shuffle(data ?? []));
    setCurrentIndex(0);
  }

  function prevTrack() { setCurrentIndex((i) => (i - 1 + tracks.length) % tracks.length); }

  async function handleJoin() {
    if (!nameValue.trim()) return;
    setSubmitting(true);
    await join(nameValue);
    setSubmitting(false);
  }

  if (participantLoading) return null;

  if (!participantId) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center' }}>
          <PanelStrong style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={s.emoji}>🎧</Text>
            <Kicker>MT Toolkit</Kicker>
            <Text style={s.bigTitle}>What's your name?</Text>
          </PanelStrong>
          <Panel style={{ gap: 12 }}>
            <StyledInput value={nameValue} onChangeText={setNameValue} placeholder="Your name" maxLength={32} autoFocus onSubmitEditing={handleJoin} />
            <GlowButton onPress={handleJoin} disabled={submitting || !nameValue.trim()}>
              <Text style={s.btnText}>{submitting ? 'Joining…' : "Let's go"}</Text>
            </GlowButton>
          </Panel>
        </Shell>
      </Screen>
    );
  }

  if (!selectedGenre) {
    return (
      <Screen>
        <Shell>
          <PanelStrong>
            <Kicker>MT Toolkit</Kicker>
            <Text style={s.bigTitle}>Pick your vibe,{'\n'}{name}</Text>
          </PanelStrong>
          <View style={{ gap: 10 }}>
            {genres.map((genre) => (
              <Pressable key={genre.id} onPress={() => selectGenre(genre)} style={({ pressed }) => [s.genreRow, pressed && { opacity: 0.8 }]}>
                <IconTile>
                  <Svg viewBox="0 0 24 24" fill="none" stroke="#fff" width={26} height={26}>
                    <Path d="M9 18V5l11-2v13" strokeWidth={2.25} strokeLinejoin="round" />
                    <Circle cx={6} cy={18} r={3} strokeWidth={2.25} />
                    <Circle cx={17} cy={16} r={3} strokeWidth={2.25} />
                  </Svg>
                </IconTile>
                <Text style={s.genreName}>{genre.name}</Text>
              </Pressable>
            ))}
          </View>
        </Shell>
      </Screen>
    );
  }

  if (tracks.length === 0) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#71717a' }}>Loading tracks…</Text>
        </Shell>
      </Screen>
    );
  }

  const isPlaying = playbackState === 'playing';
  const isEnded = playbackState === 'ended';

  return (
    <Screen>
      <Shell style={{ justifyContent: 'space-between' }}>
        <View>
          <Kicker>MT Toolkit</Kicker>
          <Text style={s.genreTag}>{selectedGenre.name}</Text>
        </View>

        <PanelStrong>
          <Kicker style={{ color: isEnded ? '#52525b' : isPlaying ? '#34d399' : '#71717a' }}>
            {isEnded ? 'Session ended' : isPlaying ? 'Now playing' : 'Waiting for host…'}
          </Kicker>
          <Text style={s.trackTitle}>{tracks[currentIndex].title}</Text>
          <Text style={s.trackCount}>Track {currentIndex + 1} of {tracks.length}</Text>
        </PanelStrong>

        <View style={{ gap: 14 }}>
          <View style={s.navRow}>
            <Pressable onPress={prevTrack} style={s.navBtn}>
              <Text style={s.navBtnText}>← Prev</Text>
            </Pressable>
            <Pressable onPress={nextTrack} style={s.navBtn}>
              <Text style={s.navBtnText}>Skip →</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => { setSelectedGenre(null); setTracks([]); }} style={{ alignSelf: 'center' }}>
            <Text style={s.changeLink}>Change playlist</Text>
          </Pressable>
        </View>
      </Shell>
    </Screen>
  );
}

const PANEL_BG = 'rgba(18,18,31,0.88)';
const PANEL_BORDER = 'rgba(255,255,255,0.10)';

const s = StyleSheet.create({
  emoji: { fontSize: 48, marginBottom: 12, textAlign: 'center' },
  bigTitle: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  genreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: PANEL_BG, borderRadius: 18, borderWidth: 1, borderColor: PANEL_BORDER, paddingHorizontal: 18, paddingVertical: 18 },
  genreName: { color: '#fff', fontSize: 22, fontWeight: '900' },
  genreTag: { color: '#71717a', fontSize: 13, marginTop: 2 },
  trackTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 6, lineHeight: 34 },
  trackCount: { color: '#52525b', fontSize: 13, marginTop: 4 },
  navRow: { flexDirection: 'row', gap: 10 },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: PANEL_BORDER, backgroundColor: PANEL_BG, paddingVertical: 18 },
  navBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  changeLink: { color: '#52525b', fontSize: 13, textDecorationLine: 'underline' },
});
