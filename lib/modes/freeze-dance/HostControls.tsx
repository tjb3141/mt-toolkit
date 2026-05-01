import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { HomeButton } from '@/components/HomeButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type Phase = 'lobby' | 'setup' | 'playing' | 'ended';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function FreezeDanceHostControls({ session }: ModeProps) {
  const initialPhase: Phase = session.playback_state === 'ended' ? 'ended' : 'lobby';
  const [localPhase, setLocalPhase] = useState<Phase>(initialPhase);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [eliminatedIds, setEliminatedIds] = useState<Set<string>>(new Set());
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentTrackTitle, setCurrentTrackTitle] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [starting, setStarting] = useState(false);

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';

  const activeParticipants = useMemo(
    () => participants.filter((p) => !eliminatedIds.has(p.id)),
    [participants, eliminatedIds]
  );
  const eliminatedParticipants = useMemo(
    () => participants.filter((p) => eliminatedIds.has(p.id)),
    [participants, eliminatedIds]
  );

  useEffect(() => {
    Promise.all([
      supabase.from('participants').select('id, name, joined_at').eq('session_id', session.id).order('joined_at'),
      supabase.from('playlists').select('id, name').order('display_order'),
    ]).then(([{ data: pData }, { data: plData }]) => {
      setParticipants(pData ?? []);
      setPlaylists(plData ?? []);
    });

    loadCurrentRoundState();
  }, [session.id]);

  useRealtimeTable(`freeze-host:${session.id}`, [
    {
      event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`,
      onPayload: (payload) => setParticipants((prev) => [...prev, payload.new as Participant]),
    },
    {
      event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`,
      onPayload: (payload) => {
        setPlaybackState(payload.new.playback_state);
        if (payload.new.playback_state === 'ended') setLocalPhase('ended');
      },
    },
    {
      event: 'INSERT', table: 'freeze_dance_eliminations',
      onPayload: (payload) => {
        if (payload.new.session_id !== session.id) return;
        setEliminatedIds((prev) => new Set([...prev, payload.new.participant_id]));
      },
    },
    {
      event: 'DELETE', table: 'freeze_dance_eliminations',
      onPayload: () => reloadEliminations(),
    },
  ]);

  async function loadCurrentRoundState() {
    const { data: round } = await supabase
      .from('freeze_dance_rounds')
      .select('round, track_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (round) {
      setCurrentRound(round.round);
      const { data: track } = await supabase
        .from('tracks')
        .select('title, playlist_id')
        .eq('id', round.track_id)
        .single();
      if (track?.playlist_id) setSelectedPlaylistId(track.playlist_id);
      if (track?.title) setCurrentTrackTitle(track.title);
      setLocalPhase('playing');
    }
    await reloadEliminations();
  }

  async function reloadEliminations() {
    const { data } = await supabase
      .from('freeze_dance_eliminations')
      .select('participant_id')
      .eq('session_id', session.id);
    setEliminatedIds(new Set((data ?? []).map((r) => r.participant_id)));
  }

  async function startRound() {
    if (!selectedPlaylistId) return;
    setStarting(true);

    const { data: trackRows } = await supabase
      .from('tracks')
      .select('id, title')
      .eq('playlist_id', selectedPlaylistId);

    const track = shuffle(trackRows ?? [])[0];
    if (!track) { setStarting(false); return; }
    setCurrentTrackTitle(track.title);

    const nextRound = currentRound + 1;

    await supabase.from('freeze_dance_eliminations').delete().eq('session_id', session.id);
    await supabase.from('freeze_dance_rounds').insert({
      session_id: session.id,
      round: nextRound,
      track_id: track.id,
    });
    await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);

    setEliminatedIds(new Set());
    setCurrentRound(nextRound);
    setPlaybackState('paused');
    setLocalPhase('playing');
    setStarting(false);
  }

  async function togglePlayback() {
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
    setPlaybackState(next);
  }

  async function markOut(participantId: string) {
    await supabase.from('freeze_dance_eliminations').insert({
      session_id: session.id,
      participant_id: participantId,
    });
    setEliminatedIds((prev) => new Set([...prev, participantId]));
  }

  async function restoreAll() {
    await supabase.from('freeze_dance_eliminations').delete().eq('session_id', session.id);
    setEliminatedIds(new Set());
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setPlaybackState('ended');
    setLocalPhase('ended');
  }

  // LOBBY
  if (localPhase === 'lobby') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="items-center gap-6">
        <View className="flex-row w-full items-center justify-between gap-4">
          <Text className="music-kicker">Freeze Dance Host</Text>
          <HomeButton />
        </View>
        <View className="music-panel-strong w-full rounded-2xl p-6 items-center">
          <Text className="music-kicker mb-3">Room Code</Text>
          <Text className="stage-title text-7xl font-black tracking-widest text-white">{session.code}</Text>
          <Text className="mt-4 text-sm font-semibold text-cyan-100">Get everyone into the room first</Text>
        </View>
        {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}
        <View className="music-panel w-full rounded-2xl p-5">
          <Text className="music-kicker mb-3">Participants ({participants.length})</Text>
          {participants.length === 0 ? (
            <Text className="text-sm text-zinc-400">No one has joined yet.</Text>
          ) : (
            <View className="gap-2">
              {participants.map((p) => (
                <View key={p.id} className="rounded-xl bg-white/5 px-5 py-4">
                  <Text className="font-semibold text-white">{p.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {participants.length >= 1 ? (
          <Pressable onPress={() => setLocalPhase('setup')} className="primary-glow w-full max-w-sm rounded-2xl py-5 items-center active:scale-95">
            <Text className="text-xl font-black text-white">Pick a playlist & start</Text>
          </Pressable>
        ) : (
          <View className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
            <Text className="text-sm text-zinc-300">Waiting for participants...</Text>
          </View>
        )}
        <Pressable onPress={endSession}>
          <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // SETUP
  if (localPhase === 'setup') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row items-start justify-between gap-4">
          <View>
            <Text className="music-kicker">Freeze Dance Host</Text>
            <Text className="stage-title mt-2 text-4xl font-black text-white">
              {currentRound > 0 ? `Round ${currentRound + 1}` : 'Pick a playlist'}
            </Text>
          </View>
          <HomeButton />
        </View>
        <View className="music-panel rounded-2xl p-5">
          <Text className="music-kicker mb-3">Playlist</Text>
          <Text className="mb-3 text-sm text-zinc-400">Everyone hears the same random track.</Text>
          <View className="flex-row flex-wrap gap-2">
            {playlists.map((pl) => (
              <Pressable key={pl.id} onPress={() => setSelectedPlaylistId(pl.id)} className={`rounded-xl px-4 py-2 ${selectedPlaylistId === pl.id ? 'bg-cyan-600' : 'bg-zinc-800'}`}>
                <Text className="text-sm font-semibold text-white">{pl.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View className="flex-row gap-3 mt-auto">
          <Pressable onPress={() => setLocalPhase(currentRound > 0 ? 'playing' : 'lobby')} className="music-panel flex-1 rounded-2xl py-4 items-center">
            <Text className="font-bold text-white">Back</Text>
          </Pressable>
          <Pressable onPress={startRound} disabled={starting || !selectedPlaylistId} className={`flex-1 rounded-2xl bg-emerald-600 py-4 items-center ${starting || !selectedPlaylistId ? 'opacity-30' : ''}`}>
            <Text className="text-lg font-black text-white">
              {starting ? 'Starting...' : currentRound > 0 ? 'Start Next Round' : 'Start Round'}
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={endSession}>
          <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // PLAYING
  if (localPhase === 'playing') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="gap-5">
        <View className="flex-row w-full items-center justify-between gap-4">
          <View>
            <Text className="music-kicker">Freeze Dance Host</Text>
            <Text className="text-xs text-zinc-500">Round {currentRound}</Text>
          </View>
          <HomeButton />
        </View>

        {activeParticipants.length === 1 ? (
          <View className="music-panel-strong w-full rounded-2xl p-6 items-center">
            <Text className="music-kicker text-yellow-300">Winner!</Text>
            <Text className="stage-title mt-2 text-5xl font-black text-white">{activeParticipants[0].name}</Text>
            <Text className="mt-3 text-zinc-400">Last one standing</Text>
          </View>
        ) : (
          <>
            <View className="items-center gap-4">
              <Pressable onPress={togglePlayback} className={`h-44 w-44 rounded-full items-center justify-center shadow-2xl active:scale-95 ${playbackState === 'playing' ? 'bg-red-500' : 'bg-emerald-500'}`}>
                <Text className="text-3xl font-black text-white">{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
              </Pressable>
              {playbackState === 'paused' ? (
                <Text className="text-sm font-semibold text-red-400">Music stopped — mark anyone who moved</Text>
              ) : (
                <Text className="text-sm font-semibold text-emerald-400">Music playing</Text>
              )}
              {currentTrackTitle && <Text className="text-sm text-zinc-400">{currentTrackTitle}</Text>}
            </View>

            <View className="music-panel w-full rounded-2xl p-5">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="music-kicker">Still in ({activeParticipants.length})</Text>
                {playbackState === 'paused' && eliminatedIds.size > 0 && (
                  <Pressable onPress={restoreAll}>
                    <Text className="text-xs text-zinc-500 underline underline-offset-4">Restore all</Text>
                  </Pressable>
                )}
              </View>
              <View className="gap-2">
                {activeParticipants.map((p) => (
                  <View key={p.id} className="flex-row items-center justify-between rounded-xl bg-white/5 px-5 py-4">
                    <Text className="font-semibold text-white">{p.name}</Text>
                    {playbackState === 'paused' && (
                      <Pressable onPress={() => markOut(p.id)} className="rounded-full bg-red-900/60 px-3 py-1">
                        <Text className="text-xs font-bold text-red-300">Mark out</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {eliminatedParticipants.length > 0 && (
          <View className="music-panel w-full rounded-2xl p-5">
            <Text className="music-kicker mb-3 text-zinc-500">Out ({eliminatedParticipants.length})</Text>
            <View className="gap-2">
              {eliminatedParticipants.map((p) => (
                <View key={p.id} className="flex-row items-center gap-3 rounded-xl bg-white/5 px-5 py-4">
                  <Text className="text-xl">🧊</Text>
                  <Text className="font-semibold text-zinc-400">{p.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className="mt-auto gap-3">
          <Pressable onPress={() => setLocalPhase('setup')} className="w-full rounded-2xl bg-cyan-600 py-4 items-center active:scale-95">
            <Text className="text-lg font-black text-white">Next Round</Text>
          </Pressable>
          <Pressable onPress={endSession}>
            <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ENDED
  return (
    <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Text className="music-kicker">Freeze Dance Host</Text>
      <Text className="stage-title text-4xl font-black text-white">Session complete</Text>
      <Text className="text-zinc-500">Thanks for playing!</Text>
      <HomeButton />
    </View>
  );
}
