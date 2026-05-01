import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
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

  // Subscribe to session updates + new rounds
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

  // Subscribe to eliminations for this specific participant
  useEffect(() => {
    if (!participantId) return;

    const ch = supabase
      .channel(`freeze-elim:${session.id}:${participantId}`)
      .on('postgres_changes' as any, {
        event: 'INSERT', schema: 'public', table: 'freeze_dance_eliminations',
        filter: `participant_id=eq.${participantId}`,
      }, () => {
        setIsEliminated(true);
        pause();
      })
      .on('postgres_changes' as any, {
        event: 'DELETE', schema: 'public', table: 'freeze_dance_eliminations',
      }, async () => {
        const pid = participantIdRef.current;
        if (!pid) return;
        const stillEliminated = await checkElimination(pid);
        if (!stillEliminated && playbackStateRef.current === 'playing') play();
      })
      .subscribe();

    elimChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [participantId]);

  // On join, load current state
  useEffect(() => {
    if (!participantId) return;
    if (playbackState === 'playing' || playbackState === 'paused') {
      loadCurrentRound(participantId).then(() => checkElimination(participantId));
    }
  }, [participantId]);

  // Load audio when track changes
  useEffect(() => {
    if (!trackId) return;
    loadTrack(trackId, session.id).then(() => {
      if (playbackStateRef.current === 'playing' && !isEliminatedRef.current) play();
    });
  }, [trackId]);

  async function loadCurrentRound(pid: string) {
    const { data: round } = await supabase
      .from('freeze_dance_rounds')
      .select('track_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!round?.track_id) return;

    const { data: track } = await supabase
      .from('tracks')
      .select('id, title')
      .eq('id', round.track_id)
      .single();

    if (track) {
      setTrackId(track.id);
      setTrackTitle(track.title);
    }

    await checkElimination(pid);
  }

  async function checkElimination(pid: string): Promise<boolean> {
    const { data } = await supabase
      .from('freeze_dance_eliminations')
      .select('id')
      .eq('session_id', session.id)
      .eq('participant_id', pid)
      .maybeSingle();
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

  // Ended
  if (playbackState === 'ended') {
    return (
      <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <Text className="music-kicker">MT Toolkit</Text>
        <Text className="stage-title text-3xl font-black text-white">Session ended</Text>
        <Text className="text-zinc-400">Thanks for playing!</Text>
      </View>
    );
  }

  // Eliminated
  if (isEliminated) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-5 py-8">
        <Text className="text-9xl">🧊</Text>
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          <Text className="music-kicker text-blue-300">You're out!</Text>
          <Text className="stage-title mt-2 text-4xl font-black text-white">You didn't freeze</Text>
          <Text className="mt-3 text-zinc-400">Watch the others finish the round.</Text>
        </View>
      </View>
    );
  }

  // Waiting (no track loaded yet)
  if (!trackId) {
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

  // Playing / Paused (DANCE / FREEZE)
  return (
    <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-between gap-8 px-5 py-10">
      <View className="w-full">
        <Text className="music-kicker">MT Toolkit</Text>
      </View>

      {playbackState === 'playing' ? (
        <View className="items-center gap-4">
          <Text className="text-[9rem] leading-none">🟢</Text>
          <Text className="text-3xl font-black text-emerald-300">DANCE!</Text>
        </View>
      ) : (
        <View className="items-center gap-4">
          <Text className="text-[9rem] leading-none">🔴</Text>
          <Text className="text-3xl font-black text-red-400">FREEZE!</Text>
        </View>
      )}

      <View className="music-panel-strong w-full rounded-2xl p-5 items-center">
        {playbackState === 'playing' ? (
          <Text className="music-kicker text-emerald-300">Now playing</Text>
        ) : (
          <Text className="music-kicker text-zinc-500">Paused — don't move!</Text>
        )}
        <Text className="stage-title mt-2 text-2xl leading-tight font-black text-white">{trackTitle}</Text>
      </View>
    </View>
  );
}
