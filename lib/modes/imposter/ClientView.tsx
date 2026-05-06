import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, EqBars, StyledInput } from '@/components/ui';
import type { ModeProps } from '@/lib/modes';

export default function ImposterClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [assignedTrackId, setAssignedTrackId] = useState<string | null>(null);
  const [assignedTrackTitle, setAssignedTrackTitle] = useState<string | null>(null);
  const [isImposter, setIsImposter] = useState<boolean | null>(null);
  const [imposterName, setImposterName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameValue, setNameValue] = useState('');
  // readyForRound: the round number the client has tapped ready for
  const [readyForRound, setReadyForRound] = useState<number | null>(null);
  const [currentRound, setCurrentRound] = useState<number | null>(null);

  const playbackStateRef = useLatest(playbackState);
  const participantIdRef = useLatest(participantId);
  const assignedTrackIdRef = useLatest(assignedTrackId);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  useRealtimeTable(`imposter-client:${session.id}`, [
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: async (payload) => {
      const newState = payload.new.playback_state;
      setPlaybackState(newState);
      if (newState === 'playing') {
        const pid = participantIdRef.current;
        if (pid && !assignedTrackIdRef.current) await loadCurrentRound(pid);
        else play();
      } else if (newState === 'paused') {
        pause();
      } else {
        pause();
        if (newState === 'revealed') await loadRevealInfo();
      }
    }},
  ], !!participantId);

  useRealtimeTable(`imposter-rounds:${session.id}`, [
    { event: 'INSERT', table: 'imposter_rounds', filter: `session_id=eq.${session.id}`, onPayload: async () => {
      const pid = participantIdRef.current;
      if (!pid) return;
      setAssignedTrackId(null); setAssignedTrackTitle(null); setIsImposter(null);
      await loadCurrentRound(pid);
    }},
  ], !!participantId);

  useEffect(() => {
    if (participantId && (playbackState === 'playing' || playbackState === 'paused')) loadCurrentRound(participantId);
    else if (participantId && playbackState === 'revealed') loadRevealInfo();
  }, [participantId]);

  useEffect(() => {
    if (!assignedTrackId) return;
    loadTrack(assignedTrackId, session.id).then(() => { if (playbackStateRef.current === 'playing') play(); });
  }, [assignedTrackId]);

  async function loadCurrentRound(pid: string) {
    const { data: round } = await supabase.from('imposter_rounds').select('round, town_track_id, imposter_track_id, imposter_participant_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).maybeSingle();
    if (!round) return;
    setCurrentRound(round.round);
    const roleIsImposter = round.imposter_participant_id === pid;
    const trackId = roleIsImposter ? round.imposter_track_id : round.town_track_id;
    if (!trackId) return;
    const { data: track } = await supabase.from('tracks').select('id, title').eq('id', trackId).single();
    setIsImposter(roleIsImposter);
    if (track) { setAssignedTrackId(track.id); setAssignedTrackTitle(track.title); }
  }

  async function loadRevealInfo() {
    const { data: round } = await supabase.from('imposter_rounds').select('imposter_participant_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).single();
    if (!round) return;
    const { data: p } = await supabase.from('participants').select('name').eq('id', round.imposter_participant_id).single();
    if (p) setImposterName(p.name);
  }

  async function markReady() {
    if (!participantId || readyForRound === currentRound) return;
    // Prime iOS audio session within this user gesture
    play();
    pause();
    setReadyForRound(currentRound);
    await supabase.from('participants').update({ ready: true }).eq('id', participantId);
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
            <Text style={s.emoji}>🕵️</Text>
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

  if (playbackState === 'paused' && !assignedTrackId) {
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

  if (playbackState === 'revealed') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          {imposterName ? (
            <PanelStrong style={{ alignItems: 'center', paddingVertical: 36, width: '100%' }}>
              <Kicker>The imposter was…</Kicker>
              <Text style={[s.bigTitle, { color: '#f87171', fontSize: 44 }]}>{imposterName}</Text>
              <Text style={{ color: '#a1a1aa', fontSize: 16, marginTop: 10 }}>
                {imposterName === name ? 'That was you! Did you fool them?' : 'Did you call it?'}
              </Text>
            </PanelStrong>
          ) : (
            <Text style={{ color: '#71717a' }}>Loading reveal…</Text>
          )}
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

  // Track assigned — show ready check if not yet ready for this round
  if (assignedTrackId && isImposter !== null && readyForRound !== currentRound) {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%', gap: 10 }}>
            <Text style={s.emoji}>{isImposter ? '🕵️' : '🏘'}</Text>
            <Kicker>{isImposter ? 'You are the Imposter' : 'You are a Townsperson'}</Kicker>
            <Text style={s.trackTitle}>{assignedTrackTitle ?? 'Loading…'}</Text>
            <Text style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginTop: 4 }}>
              {isImposter ? "Blend in — don't get caught." : 'Find the odd one out.'}
            </Text>
          </PanelStrong>
          <GlowButton onPress={markReady} style={{ width: '100%' }}>
            <Text style={s.btnText}>I'm Ready</Text>
          </GlowButton>
        </Shell>
      </Screen>
    );
  }

  // Ready — waiting for host or playing
  if (playbackState === 'paused') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          <PanelStrong style={{ alignItems: 'center', width: '100%' }}>
            <Kicker style={{ color: '#34d399' }}>Ready!</Kicker>
            <Text style={s.trackTitle}>{assignedTrackTitle ?? 'Loading…'}</Text>
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
      <Shell style={{ justifyContent: 'space-between' }}>
        <Kicker>MT Toolkit</Kicker>
        <PanelStrong style={{ alignItems: 'center' }}>
          <Kicker style={{ color: '#34d399' }}>Now playing</Kicker>
          <Text style={s.trackTitle}>{assignedTrackTitle ?? 'Loading…'}</Text>
          <Text style={{ color: '#71717a', marginTop: 8 }}>Listen through your headphones.</Text>
        </PanelStrong>
        {isImposter !== null && (
          <View style={{ alignItems: 'center' }}>
            <View style={isImposter ? s.imposterBadge : s.townBadge}>
              <Text style={isImposter ? s.imposterText : s.townText}>
                {isImposter ? '🕵️ You are the Imposter' : '🏘 You are a Townsperson'}
              </Text>
            </View>
          </View>
        )}
        <Panel>
          <Text style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center' }}>
            Watch the room. Is everyone moving to the same beat?
          </Text>
        </Panel>
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 12 },
  bigTitle: { color: '#fff', fontSize: 34, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  trackTitle: { color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 6, lineHeight: 32 },
  imposterBadge: { borderRadius: 999, backgroundColor: 'rgba(127,29,29,0.7)', paddingHorizontal: 18, paddingVertical: 8 },
  townBadge: { borderRadius: 999, backgroundColor: '#27272a', paddingHorizontal: 18, paddingVertical: 8 },
  imposterText: { color: '#fca5a5', fontSize: 14, fontWeight: '700' },
  townText: { color: '#a1a1aa', fontSize: 14, fontWeight: '600' },
});
