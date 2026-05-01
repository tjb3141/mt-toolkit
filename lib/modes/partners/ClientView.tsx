import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, EqBars, StyledInput } from '@/components/ui';
import type { ModeProps } from '@/lib/modes';
import type { Track } from '@/lib/types';

type PairData = { id: string; track_id: string | null; found: boolean };

export default function PartnersClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [pair, setPair] = useState<PairData | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const pairChannelRef = useRef<any>(null);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  useRealtimeTable(`partners-client:${session.id}`, [
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: async (payload) => { const newState = payload.new.playback_state; setPlaybackState(newState); if (newState === 'playing' && participantId) await loadPair(); } },
  ], !!participantId);

  useEffect(() => { if (participantId && playbackState === 'playing') loadPair(); }, [participantId]);

  async function loadPair() {
    if (!participantId) return;
    const { data } = await supabase.from('partners_pairs').select('id, track_id, found').eq('session_id', session.id).or(`participant_1_id.eq.${participantId},participant_2_id.eq.${participantId}`).maybeSingle();
    if (!data) return;
    setPair(data);
    if (data.track_id) {
      const { data: trackData } = await supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', data.track_id).single();
      if (trackData) {
        setTrack(trackData);
        await loadTrack(trackData.id, session.id);
        if (playbackStateRef.current === 'playing' && !data.found) play();
      }
    }
    if (pairChannelRef.current) supabase.removeChannel(pairChannelRef.current);
    const ch = supabase.channel(`pair-client:${data.id}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `id=eq.${data.id}` }, (payload: any) => {
        const { track_id: newTrackId, found: newFound } = payload.new;
        setPair((prev) => prev ? { ...prev, found: newFound, track_id: newTrackId } : prev);
        if (newFound) { pause(); }
        else if (newTrackId) {
          supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', newTrackId).single().then(({ data: t }) => {
            if (t) { setTrack(t); loadTrack(t.id, session.id).then(() => play()); }
          });
        }
      }).subscribe();
    pairChannelRef.current = ch;
  }

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
            <Text style={s.emoji}>👥</Text>
            <Kicker>MT Toolkit Partners</Kicker>
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

  if (playbackState === 'paused') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker>MT Toolkit Partners</Kicker>
            <Text style={s.bigTitle}>Hi, {name}!</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 16, marginTop: 8, textAlign: 'center' }}>Waiting for the host to start…</Text>
          </PanelStrong>
          <EqBars />
        </Shell>
      </Screen>
    );
  }

  if (playbackState === 'playing' && pair?.found) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <Text style={{ fontSize: 80 }}>🎉</Text>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker style={{ color: '#34d399' }}>You found each other!</Kicker>
            <Text style={s.bigTitle}>Nice moves!</Text>
            <Text style={{ color: '#a1a1aa', marginTop: 8 }}>Your partner found you.</Text>
          </PanelStrong>
        </Shell>
      </Screen>
    );
  }

  if (playbackState === 'playing') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'space-between' }}>
          <Kicker>MT Toolkit Partners</Kicker>
          <PanelStrong>
            <Kicker style={{ color: '#34d399' }}>Now playing</Kicker>
            <Text style={s.trackTitle}>{track ? track.title : 'Loading track…'}</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 16, marginTop: 12, fontWeight: '600' }}>
              Find who else is dancing to the same song!
            </Text>
          </PanelStrong>
          <Panel>
            <Text style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center' }}>
              Listen and look around. Your partner hears this exact song.
            </Text>
          </Panel>
        </Shell>
      </Screen>
    );
  }

  return (
    <Screen>
      <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Kicker>MT Toolkit Partners</Kicker>
        <Text style={s.bigTitle}>Session ended</Text>
        <Text style={{ color: '#71717a', marginTop: 8 }}>Thanks for playing!</Text>
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 12 },
  bigTitle: { color: '#fff', fontSize: 34, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  trackTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 6, lineHeight: 34 },
});
