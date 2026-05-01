import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { HomeButton } from '@/components/HomeButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type PendingPair = { p1: Participant; p2: Participant };
type LivePair = {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  track_id: string | null;
  found: boolean;
  p1Name: string;
  p2Name: string;
  trackTitle: string;
};

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function PartnersHostControls({ session }: ModeProps) {
  const initialPhase = session.playback_state === 'playing' ? 'playing' : session.playback_state === 'ended' ? 'ended' : 'lobby';
  const [localPhase, setLocalPhase] = useState<'lobby' | 'assigning' | 'playing' | 'ended'>(initialPhase);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [genres, setGenres] = useState<Playlist[]>([]);
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);
  const [pendingPairs, setPendingPairs] = useState<PendingPair[]>([]);
  const [unpaired, setUnpaired] = useState<Participant[]>([]);
  const [selecting, setSelecting] = useState<Participant | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'auto' | 'manual' | null>(null);
  const [pairs, setPairs] = useState<LivePair[]>([]);
  const [startingGame, setStartingGame] = useState(false);

  const pairsChannelRef = useRef<any>(null);
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';
  const allFound = pairs.length > 0 && pairs.every((p) => p.found);

  useEffect(() => {
    Promise.all([
      supabase.from('participants').select('id, name, joined_at').eq('session_id', session.id).order('joined_at'),
      supabase.from('playlists').select('id, name').order('display_order'),
    ]).then(([{ data: pData }, { data: gData }]) => {
      setParticipants(pData ?? []);
      setGenres(gData ?? []);
    });

    if (initialPhase === 'playing') loadLivePairs();
  }, [session.id]);

  useRealtimeTable(`host-partners:${session.id}`, [
    {
      event: 'INSERT',
      table: 'participants',
      filter: `session_id=eq.${session.id}`,
      onPayload: (payload) => setParticipants((prev) => [...prev, payload.new as Participant]),
    },
    {
      event: 'UPDATE',
      table: 'sessions',
      filter: `id=eq.${session.id}`,
      onPayload: (payload) => {
        if (payload.new.playback_state === 'ended') setLocalPhase('ended');
      },
    },
  ]);

  function subscribeToPairs() {
    if (pairsChannelRef.current) supabase.removeChannel(pairsChannelRef.current);
    const ch = supabase
      .channel(`pairs:${session.id}:${Date.now()}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `session_id=eq.${session.id}` }, (payload: any) => {
        setPairs((prev) => prev.map((p) => p.id === payload.new.id ? { ...p, found: payload.new.found } : p));
      })
      .subscribe();
    pairsChannelRef.current = ch;
  }

  async function loadLivePairs() {
    const { data: pairData } = await supabase.from('partners_pairs').select('id, participant_1_id, participant_2_id, track_id, found').eq('session_id', session.id);
    if (!pairData || pairData.length === 0) return;

    const participantIds = [...new Set(pairData.flatMap((p) => [p.participant_1_id, p.participant_2_id]))];
    const trackIds = [...new Set(pairData.map((p) => p.track_id).filter(Boolean))] as string[];

    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('participants').select('id, name').in('id', participantIds),
      trackIds.length > 0 ? supabase.from('tracks').select('id, title').in('id', trackIds) : Promise.resolve({ data: [] }),
    ]);

    const pMap = Object.fromEntries((pData ?? []).map((p) => [p.id, p.name]));
    const tMap = Object.fromEntries(((tData as any[]) ?? []).map((t) => [t.id, t.title]));

    setPairs(pairData.map((p) => ({
      ...p,
      p1Name: pMap[p.participant_1_id] ?? '?',
      p2Name: pMap[p.participant_2_id] ?? '?',
      trackTitle: p.track_id ? (tMap[p.track_id] ?? '?') : '-',
    })));
    subscribeToPairs();
  }

  function startAssigning(mode: 'auto' | 'manual') {
    setAssignmentMode(mode);
    setSelecting(null);

    if (mode === 'auto') {
      const shuffled = shuffle([...participants]);
      const newPairs: PendingPair[] = [];
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        newPairs.push({ p1: shuffled[i], p2: shuffled[i + 1] });
      }
      setPendingPairs(newPairs);
      setUnpaired(shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : []);
    } else {
      setPendingPairs([]);
      setUnpaired([...participants]);
    }

    setLocalPhase('assigning');
  }

  function manualSelect(p: Participant) {
    if (!selecting) {
      setSelecting(p);
    } else if (selecting.id === p.id) {
      setSelecting(null);
    } else {
      setPendingPairs((prev) => [...prev, { p1: selecting!, p2: p }]);
      setUnpaired((prev) => prev.filter((u) => u.id !== selecting!.id && u.id !== p.id));
      setSelecting(null);
    }
  }

  function removePair(idx: number) {
    const pair = pendingPairs[idx];
    setPendingPairs((prev) => prev.filter((_, i) => i !== idx));
    setUnpaired((prev) => [...prev, pair.p1, pair.p2]);
  }

  async function startGame() {
    setStartingGame(true);
    const trackQuery = supabase.from('tracks').select('id, title');
    if (selectedGenreId) trackQuery.eq('playlist_id', selectedGenreId);
    const { data: trackData } = await trackQuery;
    const shuffledTracks = shuffle(trackData ?? []);
    const trackMap = Object.fromEntries((trackData ?? []).map((t) => [t.id, t.title]));

    const pairRows = pendingPairs.map((pair, i) => ({
      session_id: session.id,
      participant_1_id: pair.p1.id,
      participant_2_id: pair.p2.id,
      track_id: shuffledTracks[i % shuffledTracks.length]?.id ?? null,
      found: false,
    }));

    const { data: inserted } = await supabase.from('partners_pairs').insert(pairRows).select('id, participant_1_id, participant_2_id, track_id, found');
    await supabase.from('sessions').update({ playback_state: 'playing' }).eq('id', session.id);

    const p1Map = Object.fromEntries(pendingPairs.map((p) => [p.p1.id, p]));
    setPairs((inserted ?? []).map((row) => ({
      ...row,
      p1Name: p1Map[row.participant_1_id]?.p1.name ?? '?',
      p2Name: p1Map[row.participant_1_id]?.p2.name ?? '?',
      trackTitle: row.track_id ? (trackMap[row.track_id] ?? '?') : '-',
    })));

    subscribeToPairs();
    setLocalPhase('playing');
    setStartingGame(false);
  }

  async function markFound(pairId: string) {
    await supabase.from('partners_pairs').update({ found: true }).eq('id', pairId);
    setPairs((prev) => prev.map((p) => (p.id === pairId ? { ...p, found: true } : p)));
  }

  async function restartSamePairs() {
    setStartingGame(true);
    const trackQuery = supabase.from('tracks').select('id, title');
    if (selectedGenreId) trackQuery.eq('playlist_id', selectedGenreId);
    const { data: trackData } = await trackQuery;
    const shuffledTracks = shuffle(trackData ?? []);
    const trackMap = Object.fromEntries((trackData ?? []).map((t) => [t.id, t.title]));

    const assignments = pairs.map((pair, i) => ({
      id: pair.id,
      trackId: shuffledTracks[i % shuffledTracks.length]?.id ?? null,
    }));

    await Promise.all(
      assignments.map(({ id, trackId }) =>
        supabase.from('partners_pairs').update({ found: false, track_id: trackId }).eq('id', id).then()
      )
    );

    setPairs((prev) => prev.map((pair, i) => ({
      ...pair,
      found: false,
      track_id: assignments[i].trackId,
      trackTitle: assignments[i].trackId ? (trackMap[assignments[i].trackId!] ?? '?') : '-',
    })));

    subscribeToPairs();
    setStartingGame(false);
  }

  async function reassignPairs() {
    await supabase.from('partners_pairs').delete().eq('session_id', session.id);
    await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);
    setPairs([]);
    setPendingPairs([]);
    setUnpaired([...participants]);
    setSelecting(null);
    setAssignmentMode(null);
    setLocalPhase('lobby');
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
          <Text className="music-kicker">Partners Host</Text>
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
            <Pressable onPress={() => startAssigning('auto')} className="primary-glow rounded-2xl py-5 items-center active:scale-95">
              <Text className="text-xl font-black text-white">Auto Assign Partners</Text>
            </Pressable>
            <Pressable onPress={() => startAssigning('manual')} className="music-panel rounded-2xl py-5 items-center active:scale-95">
              <Text className="text-xl font-black text-white">Assign Manually</Text>
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

  // ASSIGNING
  if (localPhase === 'assigning') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-2xl px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row items-start justify-between gap-4">
          <View>
            <Text className="music-kicker">Partners Host</Text>
            <Text className="stage-title mt-2 text-4xl font-black text-white">Pair the room</Text>
            <Text className="mt-1 text-sm text-zinc-500">
              {assignmentMode === 'auto' ? 'Auto-assigned. Remove pairs to adjust.' : 'Tap two participants to pair them.'}
            </Text>
          </View>
          <HomeButton />
        </View>

        {assignmentMode === 'manual' && (
          <View>
            <Text className="mb-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">Unpaired ({unpaired.length})</Text>
            <View className="flex-row flex-wrap gap-2">
              {unpaired.map((p) => (
                <Pressable key={p.id} onPress={() => manualSelect(p)} className={`rounded-xl px-4 py-3 ${selecting?.id === p.id ? 'bg-violet-600' : 'bg-zinc-800'}`}>
                  <Text className="font-semibold text-white">{p.name}</Text>
                </Pressable>
              ))}
            </View>
            {selecting && <Text className="mt-3 text-sm text-violet-400">Now tap someone to pair with {selecting.name}</Text>}
          </View>
        )}

        <View className="music-panel rounded-2xl p-5">
          <Text className="music-kicker mb-3">Pairs ({pendingPairs.length})</Text>
          {pendingPairs.length === 0 ? (
            <Text className="text-sm text-zinc-400">No pairs yet.</Text>
          ) : (
            <View className="gap-2">
              {pendingPairs.map((pair, i) => (
                <View key={i} className="flex-row items-center justify-between rounded-xl bg-white/5 px-5 py-4">
                  <Text className="font-semibold text-white">{pair.p1.name} + {pair.p2.name}</Text>
                  <Pressable onPress={() => removePair(i)}>
                    <Text className="text-sm text-zinc-600">Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className="music-panel rounded-2xl p-5">
          <Text className="music-kicker mb-3">Playlist</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable onPress={() => setSelectedGenreId(null)} className={`rounded-xl px-4 py-2 ${selectedGenreId === null ? 'bg-violet-600' : 'bg-zinc-800'}`}>
              <Text className="text-sm font-semibold text-white">All playlists</Text>
            </Pressable>
            {genres.map((g) => (
              <Pressable key={g.id} onPress={() => setSelectedGenreId(g.id)} className={`rounded-xl px-4 py-2 ${selectedGenreId === g.id ? 'bg-violet-600' : 'bg-zinc-800'}`}>
                <Text className="text-sm font-semibold text-white">{g.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="flex-row gap-3 mt-auto">
          <Pressable onPress={() => setLocalPhase('lobby')} className="music-panel flex-1 rounded-2xl py-4 items-center">
            <Text className="font-bold text-white">Back</Text>
          </Pressable>
          <Pressable onPress={startGame} disabled={pendingPairs.length === 0 || startingGame} className={`flex-1 rounded-2xl bg-emerald-600 py-4 items-center ${pendingPairs.length === 0 || startingGame ? 'opacity-30' : ''}`}>
            <Text className="text-lg font-black text-white">{startingGame ? 'Starting...' : 'Start Game'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // PLAYING
  if (localPhase === 'playing') {
    return (
      <ScrollView className="stage-shell mx-auto min-h-screen w-full max-w-2xl px-5 py-6" contentContainerClassName="gap-6">
        <View className="flex-row items-center justify-between">
          <Text className="music-kicker">Find Your Match</Text>
          <View className="flex-row items-center gap-4">
            <Text className="text-xs text-zinc-500">{pairs.filter((p) => p.found).length}/{pairs.length} found</Text>
            <HomeButton />
          </View>
        </View>

        {allFound && (
          <View className="music-panel-strong rounded-2xl px-6 py-5 gap-4">
            <Text className="text-center text-2xl font-black text-emerald-400">All pairs found!</Text>
            <View>
              <Text className="mb-2 text-xs font-semibold tracking-widest text-zinc-400 uppercase">Playlist for next round</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable onPress={() => setSelectedGenreId(null)} className={`rounded-xl px-3 py-2 ${selectedGenreId === null ? 'bg-violet-600' : 'bg-zinc-800'}`}>
                  <Text className="text-sm font-semibold text-white">All playlists</Text>
                </Pressable>
                {genres.map((g) => (
                  <Pressable key={g.id} onPress={() => setSelectedGenreId(g.id)} className={`rounded-xl px-3 py-2 ${selectedGenreId === g.id ? 'bg-violet-600' : 'bg-zinc-800'}`}>
                    <Text className="text-sm font-semibold text-white">{g.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View className="flex-row gap-3">
              <Pressable onPress={restartSamePairs} disabled={startingGame} className={`flex-1 rounded-xl bg-emerald-600 py-3 items-center ${startingGame ? 'opacity-30' : ''}`}>
                <Text className="text-sm font-bold text-white">{startingGame ? 'Starting...' : 'Same pairs, new songs'}</Text>
              </Pressable>
              <Pressable onPress={reassignPairs} className="flex-1 rounded-xl bg-zinc-700 py-3 items-center">
                <Text className="text-sm font-bold text-white">New pairs</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View className="gap-3">
          {pairs.map((pair) => (
            <View key={pair.id} className={`music-panel rounded-2xl px-5 py-4 ${pair.found ? 'opacity-40' : ''}`}>
              <View className="flex-row items-center justify-between gap-4">
                <View className="min-w-0 flex-1">
                  <Text className="font-bold text-white">{pair.p1Name} + {pair.p2Name}</Text>
                  <Text className="text-sm text-zinc-500" numberOfLines={1}>{pair.trackTitle}</Text>
                </View>
                {!pair.found ? (
                  <Pressable onPress={() => markFound(pair.id)} className="rounded-xl bg-emerald-600 px-4 py-2 active:scale-95">
                    <Text className="text-sm font-bold text-white">Found!</Text>
                  </Pressable>
                ) : (
                  <Text className="text-sm font-bold text-emerald-400">Found</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Pressable onPress={endSession} className="mt-auto">
          <Text className="text-sm text-zinc-600 underline underline-offset-4">End session</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ENDED
  return (
    <View className="stage-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Text className="music-kicker">Partners Host</Text>
      <Text className="stage-title text-4xl font-black text-white">Session complete</Text>
      <Text className="text-zinc-500">All pairs found. Great session!</Text>
      <HomeButton />
    </View>
  );
}
