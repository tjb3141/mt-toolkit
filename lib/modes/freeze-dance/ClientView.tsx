import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, EqBars, StyledInput } from '@/components/ui';
import type { ModeProps } from '@/lib/modes';

export default function FreezeDanceClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState<string | null>(null);
  const [isEliminated, setIsEliminated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const participantIdRef = useLatest(participantId);
  const trackIdRef = useLatest(trackId);
  const isEliminatedRef = useLatest(isEliminated);
  const elimChannelRef = useRef<any>(null);

  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  useRealtimeTable(`freeze-client:${session.id}`, [
    {
      event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`,
      onPayload: async (payload) => {
        const newState = payload.new.playback_state;
        setPlaybackState(newState);
        if (newState === 'playing') {
          const pid = participantIdRef.current;
          if (pid && !trackIdRef.current) await loadCurrentRound(pid);
          if (!isEliminatedRef.current) play();
        } else {
          pause();
        }
      },
    },
    {
      event: 'INSERT', table: 'freeze_dance_rounds', filter: `session_id=eq.${session.id}`,
      onPayload: async () => {
        const pid = participantIdRef.current;
        if (!pid) return;
        setIsEliminated(false);
        await loadCurrentRound(pid);
        if (playbackStateRef.current === 'playing') play();
      },
    },
  ], !!participantId);

  useEffect(() => {
    if (!participantId) return;
    const ch = supabase
      .channel(`freeze-elim:${session.id}:${participantId}`)
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'freeze_dance_eliminations', filter: `participant_id=eq.${participantId}` }, () => { setIsEliminated(true); pause(); })
      .on('postgres_changes' as any, { event: 'DELETE', schema: 'public', table: 'freeze_dance_eliminations' }, async () => {
        const pid = participantIdRef.current;
        if (!pid) return;
        const stillEliminated = await checkElimination(pid);
        if (!stillEliminated && playbackStateRef.current === 'playing') play();
      })
      .subscribe();
    elimChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [participantId]);

  useEffect(() => {
    if (!participantId) return;
    if (playbackState === 'playing' || playbackState === 'paused') {
      loadCurrentRound(participantId).then(() => checkElimination(participantId));
    }
  }, [participantId]);

  useEffect(() => {
    if (!trackId) return;
    loadTrack(trackId, session.id).then(() => {
      if (playbackStateRef.current === 'playing' && !isEliminatedRef.current) play();
    });
  }, [trackId]);

  async function loadCurrentRound(pid: string) {
    const { data: round } = await supabase.from('freeze_dance_rounds').select('track_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).maybeSingle();
    if (!round?.track_id) return;
    const { data: track } = await supabase.from('tracks').select('id, title').eq('id', round.track_id).single();
    if (track) { setTrackId(track.id); setTrackTitle(track.title); }
    await checkElimination(pid);
  }

  async function checkElimination(pid: string): Promise<boolean> {
    const { data } = await supabase.from('freeze_dance_eliminations').select('id').eq('session_id', session.id).eq('participant_id', pid).maybeSingle();
    const eliminated = !!data;
    setIsEliminated(eliminated);
    return eliminated;
  }

  async function handleJoin() {
    if (!nameInput.trim()) return;
    setSubmitting(true);
    await join(nameInput);
    setSubmitting(false);
  }

  if (participantLoading) return null;

  if (!participantId) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center' }}>
          <PanelStrong style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={s.emoji}>🎵</Text>
            <Kicker>MT Toolkit</Kicker>
            <Text style={s.bigTitle}>What's your name?</Text>
          </PanelStrong>
          <Panel style={{ gap: 12 }}>
            <StyledInput value={nameInput} onChangeText={setNameInput} placeholder="Your name" maxLength={32} autoFocus onSubmitEditing={handleJoin} />
            <GlowButton onPress={handleJoin} disabled={submitting || !nameInput.trim()}>
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
          <Kicker>MT Toolkit</Kicker>
          <Text style={s.bigTitle}>Session ended</Text>
          <Text style={{ color: '#71717a', marginTop: 8 }}>Thanks for playing!</Text>
        </Shell>
      </Screen>
    );
  }

  if (isEliminated) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 96, lineHeight: 112 }}>🧊</Text>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker style={{ color: '#93c5fd' }}>You're out!</Kicker>
            <Text style={s.bigTitle}>You didn't freeze</Text>
            <Text style={{ color: '#71717a', marginTop: 8 }}>Watch the others finish the round.</Text>
          </PanelStrong>
        </Shell>
      </Screen>
    );
  }

  if (!trackId) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker>MT Toolkit</Kicker>
            <Text style={s.bigTitle}>Hi, {name}!</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 16, marginTop: 8, textAlign: 'center' }}>Waiting for the host to start…</Text>
          </PanelStrong>
          <EqBars />
        </Shell>
      </Screen>
    );
  }

  const isPlaying = playbackState === 'playing';
  return (
    <Screen>
      <Shell style={{ justifyContent: 'space-between' }}>
        <Kicker>MT Toolkit</Kicker>

        <View style={{ alignItems: 'center', gap: 16 }}>
          <LinearGradient
            colors={isPlaying ? ['#059669', '#34d399'] : ['#b91c1c', '#f87171']}
            style={s.stateCircle}
          >
            <Text style={s.stateEmoji}>{isPlaying ? '🟢' : '🔴'}</Text>
          </LinearGradient>
          <Text style={[s.stateLabel, { color: isPlaying ? '#34d399' : '#f87171' }]}>
            {isPlaying ? 'DANCE!' : 'FREEZE!'}
          </Text>
        </View>

        <PanelStrong style={{ alignItems: 'center' }}>
          <Kicker style={{ color: isPlaying ? '#34d399' : '#71717a' }}>
            {isPlaying ? 'Now playing' : 'Paused — don\'t move!'}
          </Kicker>
          <Text style={s.trackTitle}>{trackTitle}</Text>
        </PanelStrong>
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 48, marginBottom: 12 },
  bigTitle: { color: '#fff', fontSize: 36, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  stateCircle: { width: 180, height: 180, borderRadius: 90, alignItems: 'center', justifyContent: 'center' },
  stateEmoji: { fontSize: 72 },
  stateLabel: { fontSize: 36, fontWeight: '900', letterSpacing: 2 },
  trackTitle: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 6, lineHeight: 30 },
});
