import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type PendingPair = { p1: Participant; p2: Participant };
type LivePair = { id: string; participant_1_id: string; participant_2_id: string; track_id: string | null; found: boolean; p1Name: string; p2Name: string; trackTitle: string };

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

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
    ]).then(([{ data: pData }, { data: gData }]) => { setParticipants(pData ?? []); setGenres(gData ?? []); });
    if (initialPhase === 'playing') loadLivePairs();
  }, [session.id]);

  useRealtimeTable(`host-partners:${session.id}`, [
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => { if (p.new.playback_state === 'ended') setLocalPhase('ended'); } },
  ]);

  function subscribeToPairs() {
    if (pairsChannelRef.current) supabase.removeChannel(pairsChannelRef.current);
    const ch = supabase.channel(`pairs:${session.id}:${Date.now()}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `session_id=eq.${session.id}` }, (payload: any) => {
        setPairs((prev) => prev.map((p) => p.id === payload.new.id ? { ...p, found: payload.new.found } : p));
      }).subscribe();
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
    setPairs(pairData.map((p) => ({ ...p, p1Name: pMap[p.participant_1_id] ?? '?', p2Name: pMap[p.participant_2_id] ?? '?', trackTitle: p.track_id ? (tMap[p.track_id] ?? '?') : '-' })));
    subscribeToPairs();
  }

  function startAssigning(mode: 'auto' | 'manual') {
    setAssignmentMode(mode);
    setSelecting(null);
    if (mode === 'auto') {
      const shuffled = shuffle([...participants]);
      const newPairs: PendingPair[] = [];
      for (let i = 0; i + 1 < shuffled.length; i += 2) newPairs.push({ p1: shuffled[i], p2: shuffled[i + 1] });
      setPendingPairs(newPairs);
      setUnpaired(shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : []);
    } else {
      setPendingPairs([]);
      setUnpaired([...participants]);
    }
    setLocalPhase('assigning');
  }

  function manualSelect(p: Participant) {
    if (!selecting) { setSelecting(p); }
    else if (selecting.id === p.id) { setSelecting(null); }
    else {
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
    const pairRows = pendingPairs.map((pair, i) => ({ session_id: session.id, participant_1_id: pair.p1.id, participant_2_id: pair.p2.id, track_id: shuffledTracks[i % shuffledTracks.length]?.id ?? null, found: false }));
    const { data: inserted } = await supabase.from('partners_pairs').insert(pairRows).select('id, participant_1_id, participant_2_id, track_id, found');
    await supabase.from('sessions').update({ playback_state: 'playing' }).eq('id', session.id);
    const p1Map = Object.fromEntries(pendingPairs.map((p) => [p.p1.id, p]));
    setPairs((inserted ?? []).map((row) => ({ ...row, p1Name: p1Map[row.participant_1_id]?.p1.name ?? '?', p2Name: p1Map[row.participant_1_id]?.p2.name ?? '?', trackTitle: row.track_id ? (trackMap[row.track_id] ?? '?') : '-' })));
    subscribeToPairs();
    setLocalPhase('playing');
    setStartingGame(false);
  }

  async function markFound(pairId: string) {
    await supabase.from('partners_pairs').update({ found: true }).eq('id', pairId);
    setPairs((prev) => prev.map((p) => p.id === pairId ? { ...p, found: true } : p));
  }

  async function restartSamePairs() {
    setStartingGame(true);
    const trackQuery = supabase.from('tracks').select('id, title');
    if (selectedGenreId) trackQuery.eq('playlist_id', selectedGenreId);
    const { data: trackData } = await trackQuery;
    const shuffledTracks = shuffle(trackData ?? []);
    const trackMap = Object.fromEntries((trackData ?? []).map((t) => [t.id, t.title]));
    const assignments = pairs.map((pair, i) => ({ id: pair.id, trackId: shuffledTracks[i % shuffledTracks.length]?.id ?? null }));
    await Promise.all(assignments.map(({ id, trackId }) => supabase.from('partners_pairs').update({ found: false, track_id: trackId }).eq('id', id).then()));
    setPairs((prev) => prev.map((pair, i) => ({ ...pair, found: false, track_id: assignments[i].trackId, trackTitle: assignments[i].trackId ? (trackMap[assignments[i].trackId!] ?? '?') : '-' })));
    subscribeToPairs();
    setStartingGame(false);
  }

  async function reassignPairs() {
    await supabase.from('partners_pairs').delete().eq('session_id', session.id);
    await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);
    setPairs([]); setPendingPairs([]); setUnpaired([...participants]); setSelecting(null); setAssignmentMode(null);
    setLocalPhase('lobby');
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setLocalPhase('ended');
  }

  if (localPhase === 'ended') {
    return (
      <Screen><Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Kicker>Partners Host</Kicker>
        <Text style={s.bigTitle}>Session complete</Text>
        <Text style={s.sub}>All pairs found. Great session!</Text>
        <HomeButton />
      </Shell></Screen>
    );
  }

  if (localPhase === 'lobby') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.topBar}><Kicker style={{ marginBottom: 0 }}>Partners Host</Kicker><HomeButton /></View>
          <PanelStrong style={{ alignItems: 'center' }}>
            <Kicker>Room Code</Kicker>
            <Text style={s.roomCode}>{session.code}</Text>
            <Text style={s.codeSub}>Get everyone into the room first</Text>
          </PanelStrong>
          {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}
          <Panel>
            <Kicker>Participants ({participants.length})</Kicker>
            {participants.length === 0
              ? <Text style={s.empty}>No one has joined yet.</Text>
              : <View style={{ gap: 8 }}>{participants.map((p) => <ListRow key={p.id}><Text style={s.name}>{p.name}</Text></ListRow>)}</View>
            }
          </Panel>
          {participants.length >= 2 ? (
            <View style={{ gap: 10 }}>
              <GlowButton onPress={() => startAssigning('auto')}><Text style={s.ctaText}>Auto Assign Partners</Text></GlowButton>
              <Pressable onPress={() => startAssigning('manual')} style={s.outlineBtn}>
                <Text style={s.outlineBtnText}>Assign Manually</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.waitBadge}><Text style={{ color: '#a1a1aa', fontSize: 13 }}>Waiting for at least 2 participants…</Text></View>
          )}
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'assigning') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Partners Host</Kicker>
              <Text style={s.setupTitle}>Pair the room</Text>
              <Text style={s.sub}>{assignmentMode === 'auto' ? 'Auto-assigned. Remove pairs to adjust.' : 'Tap two participants to pair them.'}</Text>
            </View>
            <HomeButton />
          </View>

          {assignmentMode === 'manual' && (
            <View>
              <Text style={s.sectionLabel}>Unpaired ({unpaired.length})</Text>
              <View style={s.pillRow}>
                {unpaired.map((p) => (
                  <Pressable key={p.id} onPress={() => manualSelect(p)} style={[s.pill, selecting?.id === p.id && s.pillViolet]}>
                    <Text style={s.pillText}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
              {selecting && <Text style={{ color: '#a78bfa', fontSize: 13, marginTop: 8 }}>Tap someone to pair with {selecting.name}</Text>}
            </View>
          )}

          <Panel>
            <Kicker>Pairs ({pendingPairs.length})</Kicker>
            {pendingPairs.length === 0
              ? <Text style={s.empty}>No pairs yet.</Text>
              : <View style={{ gap: 8 }}>
                  {pendingPairs.map((pair, i) => (
                    <ListRow key={i} style={{ justifyContent: 'space-between' }}>
                      <Text style={s.name}>{pair.p1.name} + {pair.p2.name}</Text>
                      <Pressable onPress={() => removePair(i)}><Text style={{ color: '#52525b', fontSize: 13 }}>Remove</Text></Pressable>
                    </ListRow>
                  ))}
                </View>
            }
          </Panel>

          <Panel>
            <Kicker>Playlist</Kicker>
            <View style={s.pillRow}>
              <Pressable onPress={() => setSelectedGenreId(null)} style={[s.pill, selectedGenreId === null && s.pillViolet]}>
                <Text style={s.pillText}>All playlists</Text>
              </Pressable>
              {genres.map((g) => (
                <Pressable key={g.id} onPress={() => setSelectedGenreId(g.id)} style={[s.pill, selectedGenreId === g.id && s.pillViolet]}>
                  <Text style={s.pillText}>{g.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>

          <View style={s.rowBtns}>
            <Pressable onPress={() => setLocalPhase('lobby')} style={s.backBtn}><Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text></Pressable>
            <GlowButton onPress={startGame} disabled={pendingPairs.length === 0 || startingGame} style={{ flex: 1 }}>
              <Text style={s.ctaText}>{startingGame ? 'Starting…' : 'Start Game'}</Text>
            </GlowButton>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // PLAYING
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.topBar}>
          <Kicker style={{ marginBottom: 0 }}>Find Your Match</Kicker>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={s.sub}>{pairs.filter((p) => p.found).length}/{pairs.length} found</Text>
            <HomeButton />
          </View>
        </View>

        {allFound && (
          <PanelStrong style={{ gap: 14 }}>
            <Text style={{ color: '#34d399', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>All pairs found!</Text>
            <View>
              <Text style={s.sectionLabel}>Playlist for next round</Text>
              <View style={s.pillRow}>
                <Pressable onPress={() => setSelectedGenreId(null)} style={[s.pill, selectedGenreId === null && s.pillViolet]}><Text style={s.pillText}>All playlists</Text></Pressable>
                {genres.map((g) => <Pressable key={g.id} onPress={() => setSelectedGenreId(g.id)} style={[s.pill, selectedGenreId === g.id && s.pillViolet]}><Text style={s.pillText}>{g.name}</Text></Pressable>)}
              </View>
            </View>
            <View style={s.rowBtns}>
              <GlowButton onPress={restartSamePairs} disabled={startingGame} style={{ flex: 1 }}>
                <Text style={[s.ctaText, { fontSize: 14 }]}>{startingGame ? 'Starting…' : 'Same pairs, new songs'}</Text>
              </GlowButton>
              <Pressable onPress={reassignPairs} style={[s.backBtn, { flex: 1 }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>New pairs</Text></Pressable>
            </View>
          </PanelStrong>
        )}

        <View style={{ gap: 10 }}>
          {pairs.map((pair) => (
            <Panel key={pair.id} style={{ opacity: pair.found ? 0.45 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{pair.p1Name} + {pair.p2Name}</Text>
                  <Text style={s.sub} numberOfLines={1}>{pair.trackTitle}</Text>
                </View>
                {!pair.found
                  ? <Pressable onPress={() => markFound(pair.id)} style={s.foundBtn}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Found!</Text></Pressable>
                  : <Text style={{ color: '#34d399', fontSize: 13, fontWeight: '700' }}>Found ✓</Text>
                }
              </View>
            </Panel>
          ))}
        </View>

        <EndLink onPress={endSession} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scroll: { maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 36, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomCode: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: 8, textAlign: 'center' },
  codeSub: { color: '#a5f3fc', fontSize: 13, marginTop: 8 },
  bigTitle: { color: '#fff', fontSize: 36, fontWeight: '900', marginTop: 8, textAlign: 'center' },
  setupTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 4 },
  name: { color: '#fff', fontWeight: '600', fontSize: 15 },
  sub: { color: '#71717a', fontSize: 13, marginTop: 2 },
  empty: { color: '#71717a', fontSize: 14 },
  ctaText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sectionLabel: { color: '#52525b', fontSize: 11, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#27272a' },
  pillViolet: { backgroundColor: '#6d28d9' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', gap: 10 },
  backBtn: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.05)' },
  outlineBtn: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.04)' },
  outlineBtnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  waitBadge: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  foundBtn: { borderRadius: 12, backgroundColor: '#059669', paddingHorizontal: 14, paddingVertical: 8 },
});
