import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useParticipant } from '@/hooks/useParticipant';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useLatest } from '@/hooks/useLatest';
import type { ModeProps } from '@/lib/modes';
import type { Playlist, Track } from '@/lib/types';
import Svg, { Path, Circle } from 'react-native-svg';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function SilentDiscoClientView({ session }: ModeProps) {
  const { participantId, name, loading: participantLoading, join } = useParticipant(session.id);
  const [genres, setGenres] = useState<Playlist[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [submitting, setSubmitting] = useState(false);

  const playbackStateRef = useLatest(playbackState);
  const tracksRef = useLatest(tracks);
  const currentIndexRef = useLatest(currentIndex);

  const nextTrack = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % tracksRef.current.length);
  }, []);

  const { loadTrack, play, pause } = useAudioPlayer({ loop: false, onEnd: nextTrack });

  // Load playlists on mount
  useEffect(() => {
    supabase.from('playlists').select('id, name').order('display_order').then(({ data }) => {
      setGenres(data ?? []);
    });
  }, []);

  // Subscribe to session playback state changes
  useRealtimeTable(`session:${session.id}`, [
    {
      event: 'UPDATE',
      table: 'sessions',
      filter: `id=eq.${session.id}`,
      onPayload: (payload) => {
        const newState = payload.new.playback_state;
        setPlaybackState(newState);
        if (newState === 'playing') play();
        else pause();
      },
    },
  ]);

  // Load audio when track changes
  useEffect(() => {
    if (tracks.length === 0) return;
    loadTrack(tracks[currentIndex].id, session.id).then(() => {
      if (playbackStateRef.current === 'playing') play();
    });
  }, [tracks, currentIndex]);

  // Report current track to host
  useEffect(() => {
    if (!participantId || tracks.length === 0) return;
    supabase
      .from('participants')
      .update({ current_track: tracks[currentIndex].title })
      .eq('id', participantId)
      .then(() => {});
  }, [participantId, tracks, currentIndex]);

  async function selectGenre(genre: Playlist) {
    setSelectedGenre(genre);
    if (participantId) {
      await supabase.from('participants').update({ playlist_id: genre.id }).eq('id', participantId);
    }
    const { data } = await supabase
      .from('tracks')
      .select('id, title, storage_path, duration_seconds')
      .eq('playlist_id', genre.id);
    setTracks(shuffle(data ?? []));
    setCurrentIndex(0);
  }

  function prevTrack() {
    setCurrentIndex((i) => (i - 1 + tracks.length) % tracks.length);
  }

  async function handleJoin(playerName: string) {
    setSubmitting(true);
    const ok = await join(playerName);
    setSubmitting(false);
    return ok;
  }

  // Name entry screen
  if (participantLoading) return null;

  if (!participantId) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <View className="music-panel-strong rounded-2xl p-6 items-center">
          <View className="record-mark mx-auto mb-6" />
          <Text className="music-kicker mb-2">MT Toolkit</Text>
          <Text className="stage-title text-4xl font-black text-white text-center">
            What's your name?
          </Text>
        </View>
        <View className="music-panel rounded-2xl p-5">
          <NameInput onSubmit={handleJoin} submitting={submitting} />
        </View>
      </View>
    );
  }

  // Playlist selection screen
  if (!selectedGenre) {
    return (
      <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-8">
        <View className="music-panel-strong rounded-2xl p-6">
          <Text className="music-kicker">MT Toolkit</Text>
          <Text className="stage-title mt-2 text-4xl leading-tight font-black text-white">
            Pick your vibe, {name}
          </Text>
        </View>
        <View className="gap-3">
          {genres.map((genre) => (
            <Pressable
              key={genre.id}
              onPress={() => selectGenre(genre)}
              className="music-panel flex-row items-center gap-4 rounded-2xl px-6 py-6 active:scale-95"
            >
              <View className="icon-tile">
                <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width={28} height={28}>
                  <Path d="M9 18V5l11-2v13" strokeWidth={2.25} strokeLinejoin="round" />
                  <Circle cx={6} cy={18} r={3} strokeWidth={2.25} />
                  <Circle cx={17} cy={16} r={3} strokeWidth={2.25} />
                </Svg>
              </View>
              <Text className="text-2xl font-black text-white tracking-tight">{genre.name}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // Loading tracks
  if (tracks.length === 0) {
    return (
      <View className="stage-shell flex min-h-screen items-center justify-center">
        <Text className="text-zinc-400">Loading tracks...</Text>
      </View>
    );
  }

  // Now playing screen
  return (
    <View className="stage-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-between gap-8 px-5 py-8">
      <View>
        <Text className="music-kicker">MT Toolkit</Text>
        <Text className="mt-1 text-sm text-zinc-400">{selectedGenre.name}</Text>
      </View>

      <View className="music-panel-strong rounded-2xl p-6">
        {playbackState === 'playing' ? (
          <Text className="music-kicker text-emerald-300">Now playing</Text>
        ) : playbackState === 'ended' ? (
          <Text className="music-kicker text-zinc-500">Session ended</Text>
        ) : (
          <Text className="music-kicker text-zinc-500">Waiting for host...</Text>
        )}
        <Text className="stage-title mt-3 text-3xl leading-tight font-black text-white">
          {tracks[currentIndex].title}
        </Text>
        <Text className="text-sm text-zinc-500">
          Track {currentIndex + 1} of {tracks.length}
        </Text>
      </View>

      <View className="gap-6">
        <View className="flex-row gap-4">
          <Pressable
            onPress={prevTrack}
            className="music-panel flex-1 items-center justify-center rounded-2xl py-5 active:scale-95"
          >
            <Text className="text-lg font-bold text-white">Prev</Text>
          </Pressable>
          <Pressable
            onPress={nextTrack}
            className="music-panel flex-1 items-center justify-center rounded-2xl py-5 active:scale-95"
          >
            <Text className="text-lg font-bold text-white">Skip</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setSelectedGenre(null);
            setTracks([]);
          }}
        >
          <Text className="text-sm text-zinc-500 underline underline-offset-4">Change playlist</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Inline name input component
function NameInput({ onSubmit, submitting }: { onSubmit: (name: string) => Promise<boolean>; submitting: boolean }) {
  const [value, setValue] = useState('');
  const { TextInput } = require('react-native');

  return (
    <View className="gap-4">
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Your name"
        placeholderTextColor="#52525b"
        maxLength={32}
        autoFocus
        onSubmitEditing={() => value.trim() && onSubmit(value)}
        className="w-full rounded-xl border-2 border-white/10 bg-black/30 px-6 py-4 text-center text-2xl font-bold text-white focus:border-cyan-300"
      />
      <Pressable
        onPress={() => value.trim() && onSubmit(value)}
        disabled={submitting || !value.trim()}
        className={`primary-glow w-full rounded-xl py-4 items-center ${!value.trim() || submitting ? 'opacity-30' : ''}`}
      >
        <Text className="text-lg font-black text-white">
          {submitting ? 'Joining...' : "Let's go"}
        </Text>
      </Pressable>
    </View>
  );
}
