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

type PairData = { id: string; track_id: string | null; found: boolean; mySlot: 'p1' | 'p2' | 'p3' };

export default function PartnersClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [pair, setPair] = useState<PairData | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  // readyForTrackId: which track ID the client has tapped ready for.
  // Survives pause/play. Only resets when a new track is assigned.
  const [readyForTrackId, setReadyForTrackId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const pairRef = useLatest(pair);
  const trackRef = useLatest(track);
  const pairChannelRef = useRef<any>(null);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  useRealtimeTable(`partners-client:${session.id}`, [
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: async (payload) => {
      const newState = payload.new.playback_state;
      setPlaybackState(newState);
      if (newState === 'playing') {
        if (participantId && !pairRef.current) await loadPair();
        else play();
      } else if (newState === 'paused') {
        pause();
      } else {
        pause();
      }
    }},
    { event: 'INSERT', table: 'partners_pairs', filter: `session_id=eq.${session.id}`, onPayload: async () => {
      // Always reload on new pairs — handles both first round and reassign
      await loadPair();
    }},
  ], !!participantId);

  useEffect(() => {
    if (participantId && (playbackState === 'playing' || playbackState === 'paused')) loadPair();
  }, [participantId]);

  async function loadPair() {
    if (!participantId) return;
    const { data } = await supabase
      .from('partners_pairs')
      .select('id, track_id, found, participant_1_id, participant_2_id, participant_3_id')
      .eq('session_id', session.id)
      .or(`participant_1_id.eq.${participantId},participant_2_id.eq.${participantId},participant_3_id.eq.${participantId}`)
      .maybeSingle();
    if (!data) return;

    const mySlot: 'p1' | 'p2' | 'p3' =
      data.participant_1_id === participantId ? 'p1' :
      data.participant_2_id === participantId ? 'p2' : 'p3';

    // New pair (reassign) — clear ready state
    if (data.id !== pairRef.current?.id) {
      setReadyForTrackId(null);
      setTrack(null);
    }

    setPair({ id: data.id, track_id: data.track_id, found: data.found, mySlot });

    if (data.track_id && data.track_id !== trackRef.current?.id) {
      const { data: t } = await supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', data.track_id).single();
      if (t) {
        setTrack(t);
        await loadTrack(t.id, session.id);
        if (playbackStateRef.current === 'playing' && !data.found) play();
      }
    }

    if (pairChannelRef.current) supabase.removeChannel(pairChannelRef.current);
    const ch = supabase.channel(`pair-client:${data.id}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `id=eq.${data.id}` }, (payload: any) => {
        const { track_id: newTrackId, found: newFound } = payload.new;
        const currentTrackId = trackRef.current?.id;
        setPair((prev) => prev ? { ...prev, found: newFound, track_id: newTrackId } : prev);
        if (newFound) {
          pause();
        } else if (newTrackId && newTrackId !== currentTrackId) {
          // New round — new track assigned, reset ready and reload
          setReadyForTrackId(null);
          supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', newTrackId).single().then(({ data: t }) => {
            if (t) { setTrack(t); loadTrack(t.id, session.id, true).then(() => { if (playbackStateRef.current === 'playing') play(); }); }
          });
        }
        // Same track update (ready flag wrote) — do nothing
      }).subscribe();
    pairChannelRef.current = ch;
  }

  async function markReady() {
    if (!pair || !track || readyForTrackId === track.id) return;
    // Prime iOS audio session within this user gesture
    play();
    pause();
    setReadyForTrackId(track.id);
    const col = `${pair.mySlot}_ready`;
    await supabase.from('partners_pairs').update({ [col]: true }).eq('id', pair.id);
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
      <Screen avoidKeyboard>
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

  if (playbackState === 'ended') {
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

  if (!track) {
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

  if (pair?.found) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <Text style={{ fontSize: 80 }}>🎉</Text>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker style={{ color: '#34d399' }}>You found each other!</Kicker>
            <Text style={s.bigTitle}>Nice moves!</Text>
          </PanelStrong>
        </Shell>
      </Screen>
    );
  }

  const isReadyThisRound = readyForTrackId === track.id;

  // Ready check — shown once per track until tapped
  if (!isReadyThisRound) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%', gap: 10 }}>
            <Text style={s.emoji}>🎵</Text>
            <Kicker>Your track</Kicker>
            <Text style={s.trackTitle}>{track.title}</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginTop: 4 }}>
              Put your headphones in — this is your song.
            </Text>
          </PanelStrong>
          <GlowButton onPress={markReady} style={{ width: '100%' }}>
            <Text style={s.btnText}>I'm Ready</Text>
          </GlowButton>
        </Shell>
      </Screen>
    );
  }

  // Playing or paused (round active)
  const isPlaying = playbackState === 'playing';
  if (isPlaying) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'space-between' }}>
          <Kicker>MT Toolkit Partners</Kicker>
          <PanelStrong>
            <Kicker style={{ color: '#34d399' }}>Now playing</Kicker>
            <Text style={s.trackTitle}>{track.title}</Text>
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

  // Paused after being played (round_active=true, just paused)
  return (
    <Screen>
      <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
        <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
          <Kicker style={{ color: '#34d399' }}>Ready!</Kicker>
          <Text style={s.trackTitle}>{track.title}</Text>
          <Text style={{ color: '#a1a1aa', fontSize: 15, marginTop: 8, textAlign: 'center' }}>
            Waiting for host to start…
          </Text>
        </PanelStrong>
        <EqBars />
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 4 },
  bigTitle: { color: '#fff', fontSize: 34, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  trackTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 6, lineHeight: 32, textAlign: 'center' },
});
