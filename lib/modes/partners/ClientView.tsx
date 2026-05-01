import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import type { ModeProps } from '@/lib/modes';
import type { Track } from '@/lib/types';

type PairData = { id: string; track_id: string | null; found: boolean };

export default function PartnersClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [pair, setPair] = useState<PairData | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const playbackStateRef = useLatest(playbackState);
  const pairChannelRef = useRef<any>(null);
  const { loadTrack, play, pause } = useAudioPlayer({ loop: true });

  // Subscribe to session updates
  useRealtimeTable(`partners-client:${session.id}`, [
    {
      event: 'UPDATE',
      table: 'sessions',
      filter: `id=eq.${session.id}`,
      onPayload: async (payload) => {
        const newState = payload.new.playback_state;
        setPlaybackState(newState);
        if (newState === 'playing' && participantId) {
          await loadPair();
        }
      },
    },
  ], !!participantId);

  useEffect(() => {
    if (participantId && playbackState === 'playing') {
      loadPair();
    }
  }, [participantId]);

  async function loadPair() {
    if (!participantId) return;

    const { data } = await supabase
      .from('partners_pairs')
      .select('id, track_id, found')
      .eq('session_id', session.id)
      .or(`participant_1_id.eq.${participantId},participant_2_id.eq.${participantId}`)
      .maybeSingle();

    if (!data) return;
    setPair(data);

    if (data.track_id) {
      const { data: trackData } = await supabase
        .from('tracks')
        .select('id, title, storage_path, duration_seconds')
        .eq('id', data.track_id)
        .single();
      if (trackData) {
        setTrack(trackData);
        await loadTrack(trackData.id, session.id);
        if (playbackStateRef.current === 'playing' && !data.found) play();
      }
    }

    // Subscribe to this specific pair for updates
    if (pairChannelRef.current) supabase.removeChannel(pairChannelRef.current);
    const ch = supabase
      .channel(`pair-client:${data.id}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `id=eq.${data.id}` }, (payload: any) => {
        const newTrackId = payload.new.track_id;
        const newFound = payload.new.found;
        setPair((prev) => prev ? { ...prev, found: newFound, track_id: newTrackId } : prev);

        if (newFound) {
          pause();
        } else if (newTrackId) {
          // New track assigned — load and play
          supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', newTrackId).single().then(({ data: t }) => {
            if (t) {
              setTrack(t);
              loadTrack(t.id, session.id).then(() => play());
            }
          });
        }
      })
      .subscribe();
    pairChannelRef.current = ch;
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
          <Text className="music-kicker mb-2">MT Toolkit Partners</Text>
          <Text className="stage-title text-4xl font-black text-white text-center">What's your name?</Text>
        </View>
        <View className="music-panel rounded-2xl p-5 gap-4">
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="Your name"
            placeholderTextColor="#52525b"
            maxLength={32}
            autoFocus
            onSubmitEditing={handleJoin}
            className="w-full rounded-xl border-2 border-white/10 bg-black/30 px-6 py-4 text-center text-2xl font-bold text-white focus:border-cyan-300"
          />
          <Pressable onPress={handleJoin} disabled={submitting || !nameInput.trim()} className={`primary-glow w-full rounded-xl py-4 items-center ${!nameInput.trim() || submitting ? 'opacity-30' : ''}`}>
            <Text className="text-lg font-black text-white">{submitting ? 'Joining...' : "Let's go"}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Waiting
  if (playbackState === 'paused') {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8">
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          <Text className="music-kicker mb-3">MT Toolkit Partners</Text>
          <Text className="stage-title text-4xl font-black text-white">Hi, {name}!</Text>
          <Text className="mt-3 text-lg text-zinc-300 text-center">Waiting for the host to start the game...</Text>
        </View>
        <View className="equalizer">
          <View /><View /><View /><View /><View />
        </View>
      </View>
    );
  }

  // Playing — found
  if (playbackState === 'playing' && pair?.found) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-8">
        <View className="record-mark" />
        <Text className="stage-title text-4xl font-black text-white">You've been found!</Text>
        <Text className="text-lg text-zinc-300">Your partner found you. Nice moves!</Text>
      </View>
    );
  }

  // Playing — searching
  if (playbackState === 'playing') {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8">
        <Text className="music-kicker">MT Toolkit Partners</Text>

        <View className="music-panel-strong rounded-2xl p-6">
          <Text className="music-kicker text-emerald-300">Now playing</Text>
          {track ? (
            <Text className="stage-title mt-3 text-3xl leading-tight font-black text-white">{track.title}</Text>
          ) : (
            <Text className="mt-3 text-zinc-400">Loading track...</Text>
          )}
          <Text className="mt-4 text-xl font-semibold text-zinc-200">
            Find who else is dancing to the same song!
          </Text>
        </View>

        <View className="music-panel rounded-2xl p-5">
          <Text className="text-sm text-zinc-300">Listen and look around. Your partner hears this exact song.</Text>
        </View>
      </View>
    );
  }

  // Ended
  return (
    <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Text className="music-kicker">MT Toolkit Partners</Text>
      <Text className="stage-title text-3xl font-black text-white">Session ended</Text>
      <Text className="text-zinc-400">Thanks for playing!</Text>
    </View>
  );
}
