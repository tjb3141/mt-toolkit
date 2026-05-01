import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { HomeButton } from '@/components/HomeButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type Phase = 'lobby' | 'setup' | 'playing' | 'revealed' | 'ended';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function ImposterHostControls({ session }: ModeProps) {
  const initialPhase: Phase = session.playback_state === 'playing' ? 'playing' : session.playback_state === 'ended' ? 'ended' : 'lobby';
  const [localPhase, setLocalPhase] = useState<Phase>(initialPhase);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [townPlaylistId, setTownPlaylistId] = useState<string | null>(null);
  const [imposterPlaylistId, setImposterPlaylistId] = useState<string | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'auto' | 'manual' | null>(null);
  const [selectedImposterId, setSelectedImposterId] = useState<string | null>(null);
  const [imposterParticipantId, setImposterParticipantId] = useState<string | null>(null);
  const [currentRoundNumber, setCurrentRoundNumber] = useState(0);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [starting, setStarting] = useState(false);

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';
  const imposterName = participants.find((p) => p.id === imposterParticipantId)?.name ?? null;

  useEffect(() => {
    Promise.all([
      supabase.from('participants').select('id, name, joined_at').eq('session_id', session.id).order('joined_at'),
      supabase.from('playlists').select('id, name').order('display_order'),
    ]).then(([{ data: pData }, { data: plData }]) => {
      setParticipants(pData ?? []);
      setPlaylists(plData ?? []);
    });

    if (initialPhase === 'playing') loadLatestRound();
  }, [session.id]);

  useRealtimeTable(`imposter-host:${session.id}`, [
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
  ]);

  async function loadLatestRound() {
    const { data } = await supabase
      .from('imposter_rounds')
      .select('round, imposter_participant_id, town_playlist_id, imposter_playlist_id')
      .eq('session_id', session.id)
      .order('round', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setCurrentRoundNumber(data.round);
      setImposterParticipantId(data.imposter_participant_id);
      setTownPlaylistId(data.town_playlist_id);
      setImposterPlaylistId(data.imposter_playlist_id);
      if (localPhase === 'lobby') setLocalPhase('playing');
    }
  }

  function goToSetup(mode: 'auto' | 'manual') {
    setAssignmentMode(mode);
    setSelectedImposterId(null);
    setLocalPhase('setup');
  }

  async function startRound() {
    if (!townPlaylistId || !imposterPlaylistId) return;
    if (assignmentMode === 'manual' && !selectedImposterId) return;
    setStarting(true);

    const imposterId = assignmentMode === 'auto' ? shuffle(participants)[0].id : selectedImposterId!;
    const [{ data: townTracks }, { data: imposterTracks }] = await Promise.all([
      supabase.from('tracks').select('id').eq('playlist_id', townPlaylistId),
      supabase.from('tracks').select('id').eq('playlist_id', imposterPlaylistId),
    ]);

    const townTrack = shuffle(townTracks ?? [])[0];
    const imposterTrack = shuffle(imposterTracks ?? [])[0];
    const nextRound = currentRoundNumber + 1;

    await supabase.from('imposter_rounds').insert({
      session_id: session.id, round: nextRound,
      town_playlist_id: townPlaylistId, imposter_playlist_id: imposterPlaylistId,
      imposter_participant_id: imposterId,
      town_track_id: townTrack?.id ?? null, imposter_track_id: imposterTrack?.id ?? null,
    });

    await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);
    setCurrentRoundNumber(nextRound);
    setImposterParticipantId(imposterId);
    setPlaybackState('paused');
    setLocalPhase('playing');
    setStarting(false);
  }

  async function togglePlayback() {
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
    setPlaybackState(next);
  }

  async function reveal() {
    await supabase.from('sessions').update({ playback_state: 'revealed' as any }).eq('id', session.id);
    setPlaybackState('revealed' as any);
    setLocalPhase('revealed');
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setLocalPhase('ended');
  }

  // LOBBY
  if (localPhase === 'lobby') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="items-center gap-6">
        <View className="flex-row w-full items-center justify-between gap-4">
          <Text className="music-kicker">Imposter Host</Text>
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
        {participants.length >= 2 ? (
          <View className="w-full max-w-sm gap-3">
            <Pressable onPress={() => goToSetup('auto')} className="primary-glow rounded-2xl py-5 items-center active:scale-95">
              <Text className="text-xl font-black text-white">Auto-pick Imposter</Text>
            </Pressable>
            <Pressable onPress={() => goToSetup('manual')} className="music-panel rounded-2xl py-5 items-center active:scale-95">
              <Text className="text-xl font-black text-white">Pick Imposter Manually</Text>
            </Pressable>
          </View>
        ) : (
          <View className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
            <Text className="text-sm text-zinc-300">Waiting for at least 2 participants...</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // SETUP
  if (localPhase === 'setup') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row items-start justify-between gap-4">
          <View>
            <Text className="music-kicker">Imposter Host</Text>
            <Text className="stage-title mt-2 text-4xl font-black text-white">Set up the round</Text>
          </View>
          <HomeButton />
        </View>
        <View className="music-panel rounded-2xl p-5">
          <Text className="music-kicker mb-3">Town playlist</Text>
          <Text className="mb-3 text-sm text-zinc-400">Everyone except the imposter hears a track from this.</Text>
          <View className="flex-row flex-wrap gap-2">
            {playlists.map((pl) => (
              <Pressable key={pl.id} onPress={() => setTownPlaylistId(pl.id)} className={`rounded-xl px-4 py-2 ${townPlaylistId === pl.id ? 'bg-cyan-600' : 'bg-zinc-800'}`}>
                <Text className="text-sm font-semibold text-white">{pl.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View className="music-panel rounded-2xl p-5">
          <Text className="music-kicker mb-3">Imposter playlist</Text>
          <Text className="mb-3 text-sm text-zinc-400">The imposter hears a random track from this instead.</Text>
          <View className="flex-row flex-wrap gap-2">
            {playlists.map((pl) => (
              <Pressable key={pl.id} onPress={() => setImposterPlaylistId(pl.id)} className={`rounded-xl px-4 py-2 ${imposterPlaylistId === pl.id ? 'bg-red-600' : 'bg-zinc-800'}`}>
                <Text className="text-sm font-semibold text-white">{pl.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {assignmentMode === 'manual' ? (
          <View className="music-panel rounded-2xl p-5">
            <Text className="music-kicker mb-3">Pick the imposter</Text>
            <View className="flex-row flex-wrap gap-2">
              {participants.map((p) => (
                <Pressable key={p.id} onPress={() => setSelectedImposterId(p.id)} className={`rounded-xl px-4 py-3 ${selectedImposterId === p.id ? 'bg-red-600' : 'bg-zinc-800'}`}>
                  <Text className="font-semibold text-white">{p.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View className="music-panel rounded-2xl p-5">
            <Text className="music-kicker mb-1">Imposter selection</Text>
            <Text className="text-sm text-zinc-400">A random participant will be chosen when you start.</Text>
          </View>
        )}
        <View className="flex-row gap-3 mt-auto">
          <Pressable onPress={() => setLocalPhase('lobby')} className="music-panel flex-1 rounded-2xl py-4 items-center">
            <Text className="font-bold text-white">Back</Text>
          </Pressable>
          <Pressable onPress={startRound} disabled={starting || !townPlaylistId || !imposterPlaylistId || (assignmentMode === 'manual' && !selectedImposterId)} className={`flex-1 rounded-2xl bg-emerald-600 py-4 items-center ${starting || !townPlaylistId || !imposterPlaylistId ? 'opacity-30' : ''}`}>
            <Text className="text-lg font-black text-white">{starting ? 'Starting...' : 'Start Round'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // PLAYING
  if (localPhase === 'playing') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row w-full items-center justify-between gap-4">
          <View>
            <Text className="music-kicker">Imposter Host</Text>
            <Text className="text-xs text-zinc-500">Round {currentRoundNumber}</Text>
          </View>
          <HomeButton />
        </View>
        <View className="items-center gap-4">
          <Pressable onPress={togglePlayback} className={`h-40 w-40 rounded-full items-center justify-center shadow-2xl active:scale-95 ${playbackState === 'playing' ? 'bg-red-500' : 'bg-emerald-500'}`}>
            <Text className="text-2xl font-black text-white">{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
          </Pressable>
        </View>
        <View className="music-panel w-full rounded-2xl p-5">
          <Text className="music-kicker mb-3">Participants ({participants.length})</Text>
          <View className="gap-2">
            {participants.map((p) => (
              <View key={p.id} className="flex-row items-center justify-between rounded-xl bg-white/5 px-5 py-4">
                <Text className="font-semibold text-white">{p.name}</Text>
                {p.id === imposterParticipantId ? (
                  <View className="rounded-full bg-red-900/60 px-3 py-1">
                    <Text className="text-xs font-bold text-red-300">Imposter</Text>
                  </View>
                ) : (
                  <View className="rounded-full bg-zinc-800 px-3 py-1">
                    <Text className="text-xs font-semibold text-zinc-400">Townsperson</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
        <View className="gap-3">
          <Pressable onPress={reveal} className="w-full rounded-2xl bg-violet-600 py-5 items-center active:scale-95">
            <Text className="text-xl font-black text-white">Reveal Imposter</Text>
          </Pressable>
          <Pressable onPress={endSession}>
            <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // REVEALED
  if (localPhase === 'revealed') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-lg px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row w-full items-center justify-between gap-4">
          <Text className="music-kicker">Imposter Host — Revealed</Text>
          <HomeButton />
        </View>
        <View className="music-panel-strong rounded-2xl p-8 items-center">
          <Text className="music-kicker mb-4">The imposter was...</Text>
          <Text className="stage-title text-5xl font-black text-red-400">{imposterName ?? '...'}</Text>
        </View>
        <View className="music-panel rounded-2xl p-5 gap-3">
          <Text className="music-kicker mb-3">Play again?</Text>
          <Text className="text-sm text-zinc-400">Same participants, same playlists — pick a new imposter.</Text>
          <Pressable onPress={() => goToSetup('auto')} className="primary-glow rounded-2xl py-4 items-center active:scale-95">
            <Text className="text-lg font-black text-white">Auto-pick new imposter</Text>
          </Pressable>
          <Pressable onPress={() => goToSetup('manual')} className="music-panel rounded-2xl py-4 items-center active:scale-95">
            <Text className="text-lg font-black text-white">Pick imposter manually</Text>
          </Pressable>
        </View>
        <Pressable onPress={endSession}>
          <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ENDED
  return (
    <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Text className="music-kicker">Imposter Host</Text>
      <Text className="stage-title text-4xl font-black text-white">Session complete</Text>
      <Text className="text-zinc-500">Thanks for playing!</Text>
      <HomeButton />
    </View>
  );
}
