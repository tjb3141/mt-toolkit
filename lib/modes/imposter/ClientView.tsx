import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import type { ModeProps } from '@/lib/modes';

export default function ImposterClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [assignedTrackId, setAssignedTrackId] = useState<string | null>(null);
  const [assignedTrackTitle, setAssignedTrackTitle] = useState<string | null>(null);
  const [isImposter, setIsImposter] = useState<boolean | null>(null);
  const [imposterName, setImposterName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const participantIdRef = useLatest(participantId);
  const assignedTrackIdRef = useLatest(assignedTrackId);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  // Subscribe to session updates
  useRealtimeTable(`imposter-client:${session.id}`, [
    {
      event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`,
      onPayload: async (payload) => {
        const newState = payload.new.playback_state;
        setPlaybackState(newState);
        if (newState === 'playing') {
          const pid = participantIdRef.current;
          if (pid && !assignedTrackIdRef.current) await loadCurrentRound(pid);
          play();
        } else if (newState === 'paused') {
          pause();
        } else {
          pause();
          if (newState === 'revealed') await loadRevealInfo();
        }
      },
    },
  ], !!participantId);

  // Subscribe to new rounds
  useRealtimeTable(`imposter-rounds:${session.id}`, [
    {
      event: 'INSERT', table: 'imposter_rounds', filter: `session_id=eq.${session.id}`,
      onPayload: async () => {
        const pid = participantIdRef.current;
        if (!pid) return;
        // Reset state for new round
        setAssignedTrackId(null);
        setAssignedTrackTitle(null);
        setIsImposter(null);
        await loadCurrentRound(pid);
        if (playbackStateRef.current === 'playing') play();
      },
    },
  ], !!participantId);

  useEffect(() => {
    if (participantId && (playbackState === 'playing' || playbackState === 'paused')) {
      loadCurrentRound(participantId);
    } else if (participantId && playbackState === 'revealed') {
      loadRevealInfo();
    }
  }, [participantId]);

  // Load audio when track changes
  useEffect(() => {
    if (!assignedTrackId) return;
    loadTrack(assignedTrackId, session.id).then(() => {
      if (playbackStateRef.current === 'playing') play();
    });
  }, [assignedTrackId]);

  async function loadCurrentRound(pid: string) {
    const { data: round } = await supabase
      .from('imposter_rounds')
      .select('town_track_id, imposter_track_id, imposter_participant_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round) return;

    const roleIsImposter = round.imposter_participant_id === pid;
    const trackId = roleIsImposter ? round.imposter_track_id : round.town_track_id;
    if (!trackId) return;

    const { data: track } = await supabase.from('tracks').select('id, title').eq('id', trackId).single();
    setIsImposter(roleIsImposter);
    if (track) {
      setAssignedTrackId(track.id);
      setAssignedTrackTitle(track.title);
    }
  }

  async function loadRevealInfo() {
    const { data: round } = await supabase
      .from('imposter_rounds')
      .select('imposter_participant_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .single();
    if (!round) return;
    const { data: p } = await supabase.from('participants').select('name').eq('id', round.imposter_participant_id).single();
    if (p) setImposterName(p.name);
  }

  async function handleJoin() {
    if (!nameInput.trim()) return;
    setSubmitting(true);
    const ok = await join(nameInput);
    setSubmitting(false);
  }

  if (participantLoading) return null;

  // Name entry
  if (!participantId) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          <View className="record-mark mx-auto mb-6" />
          <Text className="music-kicker mb-2">MT Toolkit</Text>
          <Text className="stage-title text-4xl font-black text-white text-center">What's your name?</Text>
        </View>
        <View className="music-panel rounded-2xl p-5 gap-4">
          <TextInput value={nameInput} onChangeText={setNameInput} placeholder="Your name" placeholderTextColor="#52525b" maxLength={32} autoFocus onSubmitEditing={handleJoin} className="w-full rounded-xl border-2 border-white/10 bg-black/30 px-6 py-4 text-center text-2xl font-bold text-white focus:border-cyan-300" />
          <Pressable onPress={handleJoin} disabled={submitting || !nameInput.trim()} className={`primary-glow w-full rounded-xl py-4 items-center ${!nameInput.trim() || submitting ? 'opacity-30' : ''}`}>
            <Text className="text-lg font-black text-white">{submitting ? 'Joining...' : "Let's go"}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Waiting
  if (playbackState === 'paused' && !assignedTrackId) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8">
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          <Text className="music-kicker mb-3">MT Toolkit</Text>
          <Text className="stage-title text-4xl font-black text-white">Hi, {name}!</Text>
          <Text className="mt-3 text-lg text-zinc-300 text-center">Waiting for the host to start...</Text>
        </View>
        <View className="equalizer"><View /><View /><View /><View /><View /></View>
      </View>
    );
  }

  // Playing
  if (playbackState === 'playing' || (playbackState === 'paused' && assignedTrackId)) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8">
        <Text className="music-kicker">MT Toolkit</Text>
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          {playbackState === 'playing' ? (
            <Text className="music-kicker text-emerald-300">Now playing</Text>
          ) : (
            <Text className="music-kicker text-zinc-500">Paused</Text>
          )}
          <Text className="stage-title mt-3 text-3xl leading-tight font-black text-white text-center">
            {assignedTrackTitle ?? 'Loading...'}
          </Text>
          <Text className="mt-4 text-zinc-400">Listen through your headphones.</Text>
        </View>
        {isImposter !== null && (
          <View className="items-center">
            {isImposter ? (
              <View className="rounded-full bg-red-900/60 px-5 py-2">
                <Text className="text-sm font-bold text-red-300">You are the Imposter</Text>
              </View>
            ) : (
              <View className="rounded-full bg-zinc-800 px-5 py-2">
                <Text className="text-sm font-bold text-zinc-300">You are a Townsperson</Text>
              </View>
            )}
          </View>
        )}
        <View className="music-panel rounded-2xl p-5">
          <Text className="text-sm text-zinc-300 text-center">Watch the room. Is everyone moving to the same beat?</Text>
        </View>
      </View>
    );
  }

  // Revealed
  if (playbackState === 'revealed') {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8">
        {imposterName ? (
          <View className="music-panel-strong rounded-2xl p-8 items-center">
            <Text className="music-kicker mb-4">The imposter was...</Text>
            <Text className="stage-title text-5xl font-black text-red-400">{imposterName}</Text>
            <Text className="mt-4 text-lg text-zinc-300">
              {imposterName === name ? 'That was you! Did you fool them?' : 'Did you call it?'}
            </Text>
          </View>
        ) : (
          <Text className="text-zinc-400">Loading reveal...</Text>
        )}
      </View>
    );
  }

  // Ended
  return (
    <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Text className="music-kicker">MT Toolkit</Text>
      <Text className="stage-title text-3xl font-black text-white">Session ended</Text>
      <Text className="text-zinc-400">Thanks for playing!</Text>
    </View>
  );
}
