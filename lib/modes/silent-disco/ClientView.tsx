import { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useStreamingAudio } from '@/hooks/useStreamingAudio';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, EqBars, StyledInput } from '@/components/ui';
import { KickedScreen } from '@/components/KickedScreen';
import type { ModeProps } from '@/lib/modes';

export default function SilentDiscoClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join, kicked } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [readyForRound, setReadyForRound] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const participantIdRef = useLatest(participantId);
  const trackIdRef = useLatest(trackId);
  const readyForRoundRef = useLatest(readyForRound);

  const { prime, loadTrack, play, pause, restartCurrentBuffer } = useStreamingAudio();

  async function loadTrackForId(tid: string) {
    // Resolve the signed URL via JSON instead of relying on a 302 redirect.
    // iOS Safari blocks cross-origin redirects from fetch(), so we get the
    // direct Supabase URL and fetch audio from it (proper CORS headers).
    const res = await fetch(`/api/audio/${tid}?session=${session.id}&json=1`);
    if (!res.ok) return;
    const { url } = await res.json();
    return loadTrack(url);
  }

  useRealtimeTable(`sd-client:${session.id}`, [
    {
      event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`,
      onPayload: async (payload) => {
        // Defensive: if we were kicked between the event being broadcast and
        // received, the participantId ref will be null. Don't react.
        if (!participantIdRef.current) { pause(); return; }
        const newState = payload.new.playback_state;
        setPlaybackState(newState);
        if (newState === 'playing') {
          const pid = participantIdRef.current;
          if (pid && !trackIdRef.current) await loadCurrentRound(pid);
          play();
        } else {
          pause();
        }
      },
    },
    {
      event: 'INSERT', table: 'silent_disco_rounds', filter: `session_id=eq.${session.id}`,
      onPayload: async (payload) => {
        const pid = participantIdRef.current;
        if (!pid) return;
        const wasPlaying = playbackStateRef.current === 'playing';
        const newRound = (payload.new as any).round as number;
        const newTrackId = (payload.new as any).track_id as string | null;
        // Pre-mark ready for the new round if this client has already readied
        // up at least once — their audio context is primed, no fresh tap
        // needed. Late joiners (readyForRound === null) still see the ready
        // prompt for their very first track. Updating both states in the same
        // render avoids flashing the ready screen.
        const hasReadiedBefore = readyForRoundRef.current !== null;
        await loadCurrentRound(pid, hasReadiedBefore ? newRound : null);
        if (wasPlaying && newTrackId && newTrackId === trackIdRef.current) {
          restartCurrentBuffer();
        }
      },
    },
  ], !!participantId);

  useEffect(() => {
    if (!participantId) return;
    loadCurrentRound(participantId);
  }, [participantId]);

  useEffect(() => {
    if (!trackId) return;
    loadTrackForId(trackId).then(() => {
      if (playbackStateRef.current === 'playing') play();
    });
  }, [trackId]);

  async function loadCurrentRound(_pid: string, readyOverride: number | null | undefined = undefined) {
    const { data: round } = await supabase
      .from('silent_disco_rounds')
      .select('round, track_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round?.track_id) return;
    const { data: track } = await supabase.from('tracks').select('id, title').eq('id', round.track_id).single();
    // Batch the state updates so the next render sees a consistent view of
    // currentRound + readyForRound and doesn't flash the ready screen.
    setCurrentRound(round.round);
    if (readyOverride !== undefined) setReadyForRound(readyOverride);
    if (track) { setTrackId(track.id); setTrackTitle(track.title); }
  }

  async function markReady() {
    if (!participantId || readyForRound === currentRound) return;
    // Unlock the AudioContext within the user gesture so subsequent host-driven
    // play/skip works without further taps (especially on iOS Safari). This
    // MUST stay synchronous before any await — awaiting drops us out of the
    // gesture window on iOS and audio won't start later.
    prime();
    setReadyForRound(currentRound);
    await supabase.from('participants').update({ ready: true }).eq('id', participantId);
  }

  async function handleJoin() {
    if (!nameInput.trim()) return;
    setSubmitting(true);
    await join(nameInput);
    setSubmitting(false);
  }

  if (participantLoading) return null;

  if (kicked) {
    pause();
    return <KickedScreen />;
  }

  if (!participantId) {
    return (
      <Screen avoidKeyboard>
        <Shell style={{ justifyContent: 'center' }}>
          <PanelStrong style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={s.emoji}>🎧</Text>
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

  if (!trackId) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker>MT Toolkit</Kicker>
            <Text style={s.bigTitle}>Hi, {name}!</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 16, marginTop: 8, textAlign: 'center' }}>Waiting for the host to queue a track…</Text>
          </PanelStrong>
          <EqBars />
        </Shell>
      </Screen>
    );
  }

  // Ready check — once per queued track
  if (readyForRound !== currentRound) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%', gap: 10 }}>
            <Text style={s.emoji}>🎵</Text>
            <Kicker>Get ready</Kicker>
            <Text style={s.trackTitle}>{trackTitle}</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginTop: 4 }}>
              Headphones in — tap when you're ready and the host will start the music.
            </Text>
          </PanelStrong>
          <GlowButton onPress={markReady} style={{ width: '100%' }}>
            <Text style={s.btnText}>I'm Ready</Text>
          </GlowButton>
        </Shell>
      </Screen>
    );
  }

  // Ready, waiting for host to play
  if (playbackState === 'paused') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker style={{ color: '#34d399' }}>Ready!</Kicker>
            <Text style={s.trackTitle}>{trackTitle}</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 15, marginTop: 8, textAlign: 'center' }}>
              Waiting for host to start…
            </Text>
          </PanelStrong>
          <EqBars />
        </Shell>
      </Screen>
    );
  }

  // Playing
  return (
    <Screen>
      <Shell style={{ justifyContent: 'center' }}>
        <PanelStrong style={{ alignItems: 'center' }}>
          <Kicker style={{ color: '#34d399' }}>Now playing</Kicker>
          <Text style={s.trackTitle}>{trackTitle}</Text>
        </PanelStrong>
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 48, marginBottom: 12, textAlign: 'center' },
  bigTitle: { color: '#fff', fontSize: 36, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  trackTitle: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 6, lineHeight: 34 },
});
