import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink, C } from '@/components/ui';
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
  const activeParticipants = useMemo(() => participants.filter((p) => !eliminatedIds.has(p.id)), [participants, eliminatedIds]);
  const eliminatedParticipants = useMemo(() => participants.filter((p) => eliminatedIds.has(p.id)), [participants, eliminatedIds]);

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
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => { setPlaybackState(p.new.playback_state); if (p.new.playback_state === 'ended') setLocalPhase('ended'); } },
    { event: 'INSERT', table: 'freeze_dance_eliminations', onPayload: (p) => { if (p.new.session_id !== session.id) return; setEliminatedIds((prev) => new Set([...prev, p.new.participant_id])); } },
    { event: 'DELETE', table: 'freeze_dance_eliminations', onPayload: () => reloadEliminations() },
  ]);

  async function loadCurrentRoundState() {
    const { data: round } = await supabase.from('freeze_dance_rounds').select('round, track_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).maybeSingle();
    if (round) {
      setCurrentRound(round.round);
      const { data: track } = await supabase.from('tracks').select('title, playlist_id').eq('id', round.track_id).single();
      if (track?.playlist_id) setSelectedPlaylistId(track.playlist_id);
      if (track?.title) setCurrentTrackTitle(track.title);
      setLocalPhase('playing');
    }
    await reloadEliminations();
  }

  async function reloadEliminations() {
    const { data } = await supabase.from('freeze_dance_eliminations').select('participant_id').eq('session_id', session.id);
    setEliminatedIds(new Set((data ?? []).map((r) => r.participant_id)));
  }

  async function startRound() {
    if (!selectedPlaylistId) return;
    setStarting(true);
    const { data: trackRows } = await supabase.from('tracks').select('id, title').eq('playlist_id', selectedPlaylistId);
    const track = shuffle(trackRows ?? [])[0];
    if (!track) { setStarting(false); return; }
    setCurrentTrackTitle(track.title);
    const nextRound = currentRound + 1;
    await supabase.from('freeze_dance_eliminations').delete().eq('session_id', session.id);
    await supabase.from('freeze_dance_rounds').insert({ session_id: session.id, round: nextRound, track_id: track.id });
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
    await supabase.from('freeze_dance_eliminations').insert({ session_id: session.id, participant_id: participantId });
    setEliminatedIds((prev) => new Set([...prev, participantId]));
  }

  async function restoreAll() {
    await supabase.from('freeze_dance_eliminations').delete().eq('session_id', session.id);
    setEliminatedIds(new Set());
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setLocalPhase('ended');
  }

  if (localPhase === 'ended') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Kicker>Freeze Dance</Kicker>
          <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900', marginTop: 8 }}>Session complete</Text>
          <Text style={{ color: '#71717a', marginTop: 8 }}>Thanks for playing!</Text>
          <HomeButton />
        </Shell>
      </Screen>
    );
  }

  if (localPhase === 'lobby') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.topBar}>
            <Kicker style={{ marginBottom: 0 }}>Freeze Dance Host</Kicker>
            <HomeButton />
          </View>

          <PanelStrong style={{ alignItems: 'center' }}>
            <Kicker>Room Code</Kicker>
            <Text style={s.roomCode}>{session.code}</Text>
            <Text style={{ color: '#a5f3fc', fontSize: 13, marginTop: 8 }}>Get everyone into the room first</Text>
          </PanelStrong>

          {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

          <Panel>
            <Kicker>Participants ({participants.length})</Kicker>
            {participants.length === 0
              ? <Text style={s.empty}>No one has joined yet.</Text>
              : <View style={{ gap: 8 }}>{participants.map((p) => <ListRow key={p.id}><Text style={s.name}>{p.name}</Text></ListRow>)}</View>
            }
          </Panel>

          {participants.length >= 1
            ? <GlowButton onPress={() => setLocalPhase('setup')}><Text style={s.ctaText}>Pick a playlist &amp; start</Text></GlowButton>
            : <View style={s.waitingBadge}><Text style={{ color: '#a1a1aa', fontSize: 13 }}>Waiting for participants…</Text></View>
          }
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'setup') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Freeze Dance Host</Kicker>
              <Text style={s.setupTitle}>{currentRound > 0 ? `Round ${currentRound + 1}` : 'Pick a playlist'}</Text>
            </View>
            <HomeButton />
          </View>

          <Panel>
            <Kicker>Playlist</Kicker>
            <Text style={s.subText}>Everyone hears the same random track.</Text>
            <View style={s.pillRow}>
              {playlists.map((pl) => (
                <Pressable key={pl.id} onPress={() => setSelectedPlaylistId(pl.id)} style={[s.pill, selectedPlaylistId === pl.id && s.pillActive]}>
                  <Text style={s.pillText}>{pl.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>

          <View style={s.rowBtns}>
            <Pressable onPress={() => setLocalPhase(currentRound > 0 ? 'playing' : 'lobby')} style={s.backBtn}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text>
            </Pressable>
            <GlowButton onPress={startRound} disabled={starting || !selectedPlaylistId} style={{ flex: 1 }}>
              <Text style={s.ctaText}>{starting ? 'Starting…' : currentRound > 0 ? 'Start Next Round' : 'Start Round'}</Text>
            </GlowButton>
          </View>
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  // PLAYING
  const isWinner = activeParticipants.length === 1;
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.topBar}>
          <View>
            <Kicker style={{ marginBottom: 0 }}>Freeze Dance Host</Kicker>
            <Text style={s.roundLabel}>Round {currentRound}</Text>
          </View>
          <HomeButton />
        </View>

        {isWinner ? (
          <PanelStrong style={{ alignItems: 'center' }}>
            <Kicker style={{ color: '#fde047' }}>Winner!</Kicker>
            <Text style={[s.roomCode, { fontSize: 40 }]}>{activeParticipants[0].name}</Text>
            <Text style={s.subText}>Last one standing</Text>
          </PanelStrong>
        ) : (
          <>
            <View style={{ alignItems: 'center', gap: 16 }}>
              <Pressable onPress={togglePlayback} style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : '#10b981' }]}>
                <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
              </Pressable>
              {playbackState === 'paused'
                ? <Text style={{ color: '#f87171', fontSize: 13, fontWeight: '600' }}>Music stopped — mark anyone who moved</Text>
                : <Text style={{ color: '#34d399', fontSize: 13, fontWeight: '600' }}>Music playing</Text>
              }
              {currentTrackTitle && <Text style={s.subText}>{currentTrackTitle}</Text>}
            </View>

            <Panel>
              <View style={s.rowBetween}>
                <Kicker style={{ marginBottom: 0 }}>Still in ({activeParticipants.length})</Kicker>
                {playbackState === 'paused' && eliminatedIds.size > 0 && (
                  <Pressable onPress={restoreAll}><Text style={{ color: '#52525b', fontSize: 12, textDecorationLine: 'underline' }}>Restore all</Text></Pressable>
                )}
              </View>
              <View style={{ gap: 8, marginTop: 10 }}>
                {activeParticipants.map((p) => (
                  <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                    <Text style={s.name}>{p.name}</Text>
                    {playbackState === 'paused' && (
                      <Pressable onPress={() => markOut(p.id)} style={s.markOutBtn}>
                        <Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '700' }}>Mark out</Text>
                      </Pressable>
                    )}
                  </ListRow>
                ))}
              </View>
            </Panel>
          </>
        )}

        {eliminatedParticipants.length > 0 && (
          <Panel>
            <Kicker style={{ color: '#52525b' }}>Out ({eliminatedParticipants.length})</Kicker>
            <View style={{ gap: 8, marginTop: 8 }}>
              {eliminatedParticipants.map((p) => (
                <ListRow key={p.id} style={{ gap: 10 }}>
                  <Text style={{ fontSize: 20 }}>🧊</Text>
                  <Text style={[s.name, { color: '#71717a' }]}>{p.name}</Text>
                </ListRow>
              ))}
            </View>
          </Panel>
        )}

        <GlowButton onPress={() => setLocalPhase('setup')}>
          <Text style={s.ctaText}>Next Round</Text>
        </GlowButton>
        <EndLink onPress={endSession} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scrollContent: { maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 36, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomCode: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: 8, textAlign: 'center' },
  setupTitle: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 4 },
  roundLabel: { color: '#52525b', fontSize: 12, marginTop: 2 },
  name: { color: '#fff', fontWeight: '600', fontSize: 15 },
  empty: { color: '#71717a', fontSize: 14 },
  subText: { color: '#71717a', fontSize: 13, marginTop: 4 },
  ctaText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  waitingBadge: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#27272a' },
  pillActive: { backgroundColor: '#0e7490' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', gap: 10 },
  backBtn: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.05)' },
  bigBtn: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markOutBtn: { borderRadius: 999, backgroundColor: 'rgba(127,29,29,0.6)', paddingHorizontal: 12, paddingVertical: 4 },
});
