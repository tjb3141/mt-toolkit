import { useState, useEffect } from 'react';
import { View, Text, Pressable, FlatList } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import { HomeButton } from '@/components/HomeButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant } from '@/lib/types';

export default function SilentDiscoHostControls({ session }: ModeProps) {
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});

  const participantsRef = useLatest(participants);
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';

  useEffect(() => {
    supabase.from('playlists').select('id, name').then(({ data }) => {
      setGenreMap(Object.fromEntries((data ?? []).map((g) => [g.id, g.name])));
    });

    supabase
      .from('participants')
      .select('id, name, playlist_id, current_track, joined_at')
      .eq('session_id', session.id)
      .order('joined_at')
      .then(({ data }) => {
        setParticipants(data ?? []);
      });
  }, [session.id]);

  useRealtimeTable(`participants:${session.id}`, [
    {
      event: 'INSERT',
      table: 'participants',
      filter: `session_id=eq.${session.id}`,
      onPayload: (payload) => {
        setParticipants((prev) => [...prev, payload.new as Participant]);
      },
    },
    {
      event: 'UPDATE',
      table: 'participants',
      onPayload: (payload) => {
        if (payload.new.session_id !== session.id) return;
        setParticipants((prev) =>
          prev.map((p) => (p.id === payload.new.id ? (payload.new as Participant) : p))
        );
      },
    },
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
    <View className="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col items-center gap-6 px-5 py-6">
      <View className="flex-row w-full items-center justify-between gap-4">
        <Text className="music-kicker">Silent Disco Host</Text>
        <HomeButton />
      </View>

      <View className="music-panel-strong w-full rounded-2xl p-6 items-center">
        <Text className="music-kicker mb-3">Room Code</Text>
        <Text className="stage-title text-7xl font-black tracking-widest text-white">
          {session.code}
        </Text>
        <View className="mt-5 rounded-full border border-white/10 bg-white/5 px-4 py-2">
          <Text className="text-sm font-bold text-cyan-100">Guests scan or type this code</Text>
        </View>
      </View>

      {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

      <Text className="max-w-sm text-center text-xs text-zinc-400">{joinUrl}</Text>

      {playbackState !== 'ended' ? (
        <>
          <Pressable
            onPress={toggle}
            className={`h-44 w-44 rounded-full items-center justify-center shadow-2xl active:scale-95 ${
              playbackState === 'playing' ? 'bg-red-500' : 'bg-emerald-500'
            }`}
          >
            <Text className="text-3xl font-black text-white">
              {playbackState === 'playing' ? 'Pause' : 'Play'}
            </Text>
          </Pressable>
          <Pressable onPress={endSession}>
            <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
          </Pressable>
        </>
      ) : (
        <Text className="text-zinc-500">Session ended.</Text>
      )}

      <View className="music-panel w-full rounded-2xl p-5">
        <Text className="music-kicker mb-3">Participants ({participants.length})</Text>
        {participants.length === 0 ? (
          <Text className="text-sm text-zinc-400">No one has joined yet.</Text>
        ) : (
          <View className="gap-2">
            {participants.map((p) => (
              <View key={p.id} className="rounded-xl bg-white/5 px-5 py-4 gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-white">{p.name}</Text>
                  <Text className="text-xs text-zinc-500">
                    {p.playlist_id ? (genreMap[p.playlist_id] ?? '...') : 'picking...'}
                  </Text>
                </View>
                {p.current_track ? (
                  <Text className="text-sm text-zinc-400" numberOfLines={1}>
                    {p.current_track}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
