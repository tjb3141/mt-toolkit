import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { kickParticipant, kickFromPartnersRound } from '@/lib/kickParticipant';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type PendingPair = { p1: Participant; p2: Participant; p3?: Participant };
type LivePair = { id: string; participant_1_id: string; participant_2_id: string; participant_3_id: string | null; track_id: string | null; found: boolean; p1Name: string; p2Name: string; p3Name?: string; trackTitle: string; p1_ready: boolean; p2_ready: boolean; p3_ready: boolean };

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

async function fetchTracksForPlaylist(playlistId: string | null): Promise<{ id: string; title: string }[]> {
  const q = supabase.from('playlist_tracks').select('tracks(id, title)');
  if (playlistId) q.eq('playlist_id', playlistId);
  const { data } = await q;
  return (data ?? []).map((r: any) => r.tracks).flat().filter(Boolean) as { id: string; title: string }[];
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
  const [addingThirdToPairIdx, setAddingThirdToPairIdx] = useState<number | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'auto' | 'manual' | null>(null);
  const [pairs, setPairs] = useState<LivePair[]>([]);
  const [startingGame, setStartingGame] = useState(false);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [roundActive, setRoundActive] = useState(session.playback_state === 'playing');
  const pairsChannelRef = useRef<any>(null);

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';
  const allFound = pairs.length > 0 && pairs.every((p) => p.found);
  const allReady = pairs.length > 0 && pairs.every((p) =>
    p.p1_ready && p.p2_ready && (!p.participant_3_id || p.p3_ready)
  );

  useEffect(() => {
    Promise.all([
      supabase.from('participants').select('id, name, joined_at').eq('session_id', session.id).order('joined_at'),
      supabase.from('playlists').select('id, name').order('display_order'),
    ]).then(([{ data: pData }, { data: gData }]) => { setParticipants(pData ?? []); setGenres(gData ?? []); });
    if (initialPhase === 'playing') loadLivePairs();
  }, [session.id]);

  useRealtimeTable(`host-partners:${session.id}`, [
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'DELETE', table: 'participants', onPayload: (p) => setParticipants((prev) => prev.filter((x) => x.id !== (p.old as any).id)) },
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => {
      setPlaybackState(p.new.playback_state);
      if (p.new.round_active) setRoundActive(true);
      if (p.new.playback_state === 'ended') setLocalPhase('ended');
    }},
  ]);

  async function kick(p: Participant) {
    if (!confirm(`Remove ${p.name} from the session?`)) return;
    setParticipants((prev) => prev.filter((x) => x.id !== p.id));
    await kickParticipant(p.id, session.id);
  }

  async function kickFromRound(participantId: string, participantName: string) {
    if (!confirm(`Remove ${participantName}? This will end the current round and return everyone to the lobby for re-pairing.`)) return;
    setParticipants((prev) => prev.filter((x) => x.id !== participantId));
    setPairs([]);
    setRoundActive(false);
    setPlaybackState('paused');
    setLocalPhase('lobby');
    await kickFromPartnersRound(participantId, session.id);
  }

  function subscribeToPairs() {
    if (pairsChannelRef.current) supabase.removeChannel(pairsChannelRef.current);
    const ch = supabase.channel(`pairs:${session.id}:${Date.now()}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'partners_pairs', filter: `session_id=eq.${session.id}` }, (payload: any) => {
        setPairs((prev) => prev.map((p) => p.id === payload.new.id
          ? { ...p, found: payload.new.found, p1_ready: payload.new.p1_ready, p2_ready: payload.new.p2_ready, p3_ready: payload.new.p3_ready }
          : p));
      }).subscribe();
    pairsChannelRef.current = ch;
  }

  async function loadLivePairs() {
    const { data: pairData } = await supabase.from('partners_pairs').select('id, participant_1_id, participant_2_id, participant_3_id, track_id, found').eq('session_id', session.id);
    if (!pairData || pairData.length === 0) return;
    const participantIds = [...new Set(pairData.flatMap((p) => [p.participant_1_id, p.participant_2_id, p.participant_3_id].filter(Boolean)))] as string[];
    const trackIds = [...new Set(pairData.map((p) => p.track_id).filter(Boolean))] as string[];
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('participants').select('id, name').in('id', participantIds),
      trackIds.length > 0 ? supabase.from('tracks').select('id, title').in('id', trackIds) : Promise.resolve({ data: [] }),
    ]);
    const pMap = Object.fromEntries((pData ?? []).map((p) => [p.id, p.name]));
    const tMap = Object.fromEntries(((tData as any[]) ?? []).map((t) => [t.id, t.title]));
    setPairs(pairData.map((p) => ({ ...p, p1Name: pMap[p.participant_1_id] ?? '?', p2Name: pMap[p.participant_2_id] ?? '?', p3Name: p.participant_3_id ? pMap[p.participant_3_id] : undefined, trackTitle: p.track_id ? (tMap[p.track_id] ?? '?') : '-', p1_ready: (p as any).p1_ready ?? false, p2_ready: (p as any).p2_ready ?? false, p3_ready: (p as any).p3_ready ?? false })));
    setLocalPhase('playing');
    subscribeToPairs();
  }

  function startAssigning(mode: 'auto' | 'manual') {
    setAssignmentMode(mode);
    setSelecting(null);
    setAddingThirdToPairIdx(null);
    if (mode === 'auto') {
      const shuffled = shuffle([...participants]);
      const newPairs: PendingPair[] = [];
      for (let i = 0; i + 1 < shuffled.length; i += 2) newPairs.push({ p1: shuffled[i], p2: shuffled[i + 1] });
      if (shuffled.length % 2 === 1) {
        const randomIdx = Math.floor(Math.random() * newPairs.length);
        newPairs[randomIdx] = { ...newPairs[randomIdx], p3: shuffled[shuffled.length - 1] };
      }
      setPendingPairs(newPairs);
      setUnpaired([]);
    } else {
      setPendingPairs([]);
      setUnpaired([...participants]);
    }
    setLocalPhase('assigning');
  }

  function manualSelect(p: Participant) {
    if (addingThirdToPairIdx !== null) {
      setPendingPairs((prev) => prev.map((pair, i) => i === addingThirdToPairIdx ? { ...pair, p3: p } : pair));
      setUnpaired((prev) => prev.filter((u) => u.id !== p.id));
      setAddingThirdToPairIdx(null);
      return;
    }
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
    setUnpaired((prev) => [...prev, pair.p1, pair.p2, ...(pair.p3 ? [pair.p3] : [])]);
  }

  async function startGame() {
    setStartingGame(true);
    const trackData = await fetchTracksForPlaylist(selectedGenreId);
    const shuffledTracks = shuffle(trackData);
    const trackMap = Object.fromEntries(trackData.map((t) => [t.id, t.title]));
    const pairRows = pendingPairs.map((pair, i) => ({
      session_id: session.id,
      participant_1_id: pair.p1.id,
      participant_2_id: pair.p2.id,
      participant_3_id: pair.p3?.id ?? null,
      track_id: shuffledTracks[i % shuffledTracks.length]?.id ?? null,
      found: false,
      p1_ready: false,
      p2_ready: false,
      p3_ready: false,
    }));
    const { data: inserted } = await supabase.from('partners_pairs').insert(pairRows).select('id, participant_1_id, participant_2_id, participant_3_id, track_id, found, p1_ready, p2_ready, p3_ready');
    await supabase.from('sessions').update({ playback_state: 'paused', round_active: false }).eq('id', session.id);
    setPlaybackState('paused');
    setRoundActive(false);
    const pByP1 = Object.fromEntries(pendingPairs.map((p) => [p.p1.id, p]));
    setPairs((inserted ?? []).map((row) => ({ ...row, p1Name: pByP1[row.participant_1_id]?.p1.name ?? '?', p2Name: pByP1[row.participant_1_id]?.p2.name ?? '?', p3Name: pByP1[row.participant_1_id]?.p3?.name, trackTitle: row.track_id ? (trackMap[row.track_id] ?? '?') : '-', p1_ready: false, p2_ready: false, p3_ready: false })));
    subscribeToPairs();
    setLocalPhase('playing');
    setStartingGame(false);
  }

  async function togglePlayback() {
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    const updates: any = { playback_state: next };
    if (next === 'playing') updates.round_active = true;
    await supabase.from('sessions').update(updates).eq('id', session.id);
    setPlaybackState(next);
    if (next === 'playing') setRoundActive(true);
  }

  async function markFound(pairId: string) {
    await supabase.from('partners_pairs').update({ found: true }).eq('id', pairId);
    setPairs((prev) => prev.map((p) => p.id === pairId ? { ...p, found: true } : p));
  }

  async function restartSamePairs() {
    setStartingGame(true);
    const trackData = await fetchTracksForPlaylist(selectedGenreId);
    const shuffledTracks = shuffle(trackData);
    const trackMap = Object.fromEntries(trackData.map((t) => [t.id, t.title]));
    const assignments = pairs.map((pair, i) => ({ id: pair.id, trackId: shuffledTracks[i % shuffledTracks.length]?.id ?? null }));
    await Promise.all(assignments.map(({ id, trackId }) => supabase.from('partners_pairs').update({ found: false, track_id: trackId, p1_ready: false, p2_ready: false, p3_ready: false }).eq('id', id)));
    await supabase.from('sessions').update({ playback_state: 'paused', round_active: false }).eq('id', session.id);
    setPlaybackState('paused');
    setRoundActive(false);
    setPairs((prev) => prev.map((pair, i) => ({ ...pair, found: false, track_id: assignments[i].trackId, trackTitle: assignments[i].trackId ? (trackMap[assignments[i].trackId!] ?? '?') : '-', p1_ready: false, p2_ready: false, p3_ready: false })));
    subscribeToPairs();
    setStartingGame(false);
  }

  async function reassignPairs() {
    await supabase.from('partners_pairs').delete().eq('session_id', session.id);
    await supabase.from('sessions').update({ playback_state: 'paused', round_active: false }).eq('id', session.id);
    setPlaybackState('paused');
    setRoundActive(false);
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
        <Text style={s.sub}>Great session!</Text>
        <HomeButton />
      </Shell></Screen>
    );
  }

  if (localPhase === 'lobby') {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
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
              : <View style={{ gap: 8 }}>{participants.map((p) => (
                  <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                    <Text style={s.name}>{p.name}</Text>
                    <Pressable onPress={() => kick(p)} style={s.kickBtn}>
                      <Text style={s.kickText}>Kick</Text>
                    </Pressable>
                  </ListRow>
                ))}</View>
            }
          </Panel>
          {participants.length >= 3 ? (
            <View style={{ gap: 10 }}>
              <GlowButton onPress={() => startAssigning('auto')}><Text style={s.ctaText}>Auto Assign Partners</Text></GlowButton>
              <Pressable onPress={() => startAssigning('manual')} style={s.outlineBtn}>
                <Text style={s.outlineBtnText}>Assign Manually</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.waitBadge}><Text style={{ color: '#a1a1aa', fontSize: 13 }}>Waiting for at least 3 participants…</Text></View>
          )}
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'assigning') {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
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
              {addingThirdToPairIdx !== null
                ? <Text style={{ color: '#f59e0b', fontSize: 13, marginTop: 8 }}>Tap someone to add as 3rd member</Text>
                : selecting
                  ? <Text style={{ color: '#a78bfa', fontSize: 13, marginTop: 8 }}>Tap someone to pair with {selecting.name}</Text>
                  : null
              }
            </View>
          )}

          <Panel>
            <Kicker>Pairs ({pendingPairs.length})</Kicker>
            {pendingPairs.length === 0
              ? <Text style={s.empty}>No pairs yet.</Text>
              : <View style={{ gap: 8 }}>
                  {pendingPairs.map((pair, i) => (
                    <ListRow key={i} style={{ justifyContent: 'space-between' }}>
                      <Text style={s.name}>{pair.p1.name} + {pair.p2.name}{pair.p3 ? ` + ${pair.p3.name}` : ''}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {!pair.p3 && unpaired.length > 0 && assignmentMode === 'manual' && (
                          <Pressable onPress={() => { setSelecting(null); setAddingThirdToPairIdx(addingThirdToPairIdx === i ? null : i); }}>
                            <Text style={{ color: addingThirdToPairIdx === i ? '#f59e0b' : '#a78bfa', fontSize: 13 }}>
                              {addingThirdToPairIdx === i ? 'Cancel' : '+3rd'}
                            </Text>
                          </Pressable>
                        )}
                        <Pressable onPress={() => { removePair(i); if (addingThirdToPairIdx === i) setAddingThirdToPairIdx(null); }}>
                          <Text style={{ color: '#52525b', fontSize: 13 }}>Remove</Text>
                        </Pressable>
                      </View>
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
  const canPlay = roundActive || allReady;
  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
        <View style={s.topBar}>
          <Kicker style={{ marginBottom: 0 }}>Find Your Match</Kicker>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={s.sub}>{pairs.filter((p) => p.found).length}/{pairs.length} found</Text>
            <HomeButton />
          </View>
        </View>

        <View style={{ alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={canPlay ? togglePlayback : undefined}
            style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : canPlay ? '#10b981' : '#27272a', opacity: canPlay ? 1 : 0.5 }]}
          >
            <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
          </Pressable>
          {!canPlay && (
            <Text style={{ color: '#71717a', fontSize: 13, textAlign: 'center' }}>
              Waiting for everyone to tap ready…
            </Text>
          )}
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
          {pairs.map((pair) => {
            const slotCount = pair.participant_3_id ? 3 : 2;
            const readyCount = (pair.p1_ready ? 1 : 0) + (pair.p2_ready ? 1 : 0) + (pair.participant_3_id && pair.p3_ready ? 1 : 0);
            const pairAllReady = pair.p1_ready && pair.p2_ready && (!pair.participant_3_id || pair.p3_ready);
            const showReadyKick = !roundActive && !pair.found;
            const members: { id: string; name: string; ready: boolean }[] = [
              { id: pair.participant_1_id, name: pair.p1Name, ready: pair.p1_ready },
              { id: pair.participant_2_id, name: pair.p2Name, ready: pair.p2_ready },
              ...(pair.participant_3_id ? [{ id: pair.participant_3_id, name: pair.p3Name ?? '?', ready: pair.p3_ready }] : []),
            ];
            return (
              <Panel key={pair.id} style={{ opacity: pair.found ? 0.45 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{pair.p1Name} + {pair.p2Name}{pair.p3Name ? ` + ${pair.p3Name}` : ''}</Text>
                    <Text style={s.sub} numberOfLines={1}>{pair.trackTitle}</Text>
                  </View>
                  {pair.found
                    ? <Text style={{ color: '#34d399', fontSize: 13, fontWeight: '700' }}>Found ✓</Text>
                    : roundActive
                      ? <Pressable onPress={() => markFound(pair.id)} style={s.foundBtn}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Found!</Text></Pressable>
                      : <Text style={{ color: pairAllReady ? '#34d399' : '#71717a', fontSize: 13, fontWeight: '700' }}>{readyCount}/{slotCount} ready</Text>
                  }
                </View>
                {showReadyKick && (
                  <View style={{ gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                    {members.map((m) => (
                      <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: m.ready ? '#34d399' : '#52525b', fontSize: 13 }}>{m.ready ? '✓' : '○'}</Text>
                          <Text style={{ color: '#a1a1aa', fontSize: 14 }}>{m.name}</Text>
                        </View>
                        <Pressable onPress={() => kickFromRound(m.id, m.name)} style={s.kickBtn}>
                          <Text style={s.kickText}>Kick</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </Panel>
            );
          })}
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
  bigBtn: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  kickBtn: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', paddingHorizontal: 12, paddingVertical: 4 },
  kickText: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
});
