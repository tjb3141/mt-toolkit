import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, HomeButton, EndLink, ListRow, C } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant } from '@/lib/types';

export default function SilentDiscoHostControls({ session }: ModeProps) {
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';

  useEffect(() => {
    supabase.from('playlists').select('id, name').then(({ data }) => {
      setGenreMap(Object.fromEntries((data ?? []).map((g) => [g.id, g.name])));
    });
    supabase.from('participants').select('id, name, playlist_id, current_track, joined_at').eq('session_id', session.id).order('joined_at').then(({ data }) => {
      setParticipants(data ?? []);
    });
  }, [session.id]);

  useRealtimeTable(`participants:${session.id}`, [
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'UPDATE', table: 'participants', onPayload: (p) => { if (p.new.session_id !== session.id) return; setParticipants((prev) => prev.map((x) => x.id === p.new.id ? p.new as Participant : x)); } },
  ]);

  async function toggle() {
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
    setPlaybackState(next);
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setPlaybackState('ended');
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent}>
        <View style={s.topBar}>
          <Kicker style={{ marginBottom: 0 }}>Silent Disco Host</Kicker>
          <HomeButton />
        </View>

        <PanelStrong style={{ alignItems: 'center' }}>
          <Kicker>Room Code</Kicker>
          <Text style={s.roomCode}>{session.code}</Text>
          <View style={s.codePill}>
            <Text style={{ color: '#a5f3fc', fontSize: 13, fontWeight: '600' }}>Guests scan or type this code</Text>
          </View>
        </PanelStrong>

        {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

        {playbackState !== 'ended' ? (
          <>
            <View style={{ alignItems: 'center' }}>
              <Pressable onPress={toggle} style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : '#10b981' }]}>
                <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
              </Pressable>
            </View>
            <EndLink onPress={endSession} />
          </>
        ) : (
          <Text style={{ color: '#52525b', textAlign: 'center' }}>Session ended.</Text>
        )}

        <Panel>
          <Kicker>Participants ({participants.length})</Kicker>
          {participants.length === 0
            ? <Text style={s.empty}>No one has joined yet.</Text>
            : <View style={{ gap: 8 }}>
                {participants.map((p) => (
                  <ListRow key={p.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                      <Text style={s.name}>{p.name}</Text>
                      <Text style={s.genreTag}>{p.playlist_id ? (genreMap[p.playlist_id] ?? '…') : 'picking…'}</Text>
                    </View>
                    {p.current_track ? <Text style={s.trackLine} numberOfLines={1}>{p.current_track}</Text> : null}
                  </ListRow>
                ))}
              </View>
          }
        </Panel>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scrollContent: { maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 36, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomCode: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: 8, textAlign: 'center' },
  codePill: { marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.04)' },
  bigBtn: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  name: { color: '#fff', fontWeight: '600', fontSize: 15 },
  genreTag: { color: '#52525b', fontSize: 12 },
  trackLine: { color: '#71717a', fontSize: 13 },
  empty: { color: '#71717a', fontSize: 14 },
});
