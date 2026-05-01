import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type Phase = 'lobby' | 'setup' | 'playing' | 'revealed' | 'ended';

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

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
    ]).then(([{ data: pData }, { data: plData }]) => { setParticipants(pData ?? []); setPlaylists(plData ?? []); });
    if (initialPhase === 'playing') loadLatestRound();
  }, [session.id]);

  useRealtimeTable(`imposter-host:${session.id}`, [
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => { setPlaybackState(p.new.playback_state); if (p.new.playback_state === 'ended') setLocalPhase('ended'); } },
  ]);

  async function loadLatestRound() {
    const { data } = await supabase.from('imposter_rounds').select('round, imposter_participant_id, town_playlist_id, imposter_playlist_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).maybeSingle();
    if (data) { setCurrentRoundNumber(data.round); setImposterParticipantId(data.imposter_participant_id); setTownPlaylistId(data.town_playlist_id); setImposterPlaylistId(data.imposter_playlist_id); if (localPhase === 'lobby') setLocalPhase('playing'); }
  }

  function goToSetup(mode: 'auto' | 'manual') { setAssignmentMode(mode); setSelectedImposterId(null); setLocalPhase('setup'); }

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
    await supabase.from('imposter_rounds').insert({ session_id: session.id, round: nextRound, town_playlist_id: townPlaylistId, imposter_playlist_id: imposterPlaylistId, imposter_participant_id: imposterId, town_track_id: townTrack?.id ?? null, imposter_track_id: imposterTrack?.id ?? null });
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

  if (localPhase === 'ended') {
    return (
      <Screen><Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Kicker>Imposter Host</Kicker>
        <Text style={s.bigTitle}>Session complete</Text>
        <Text style={s.sub}>Thanks for playing!</Text>
        <HomeButton />
      </Shell></Screen>
    );
  }

  if (localPhase === 'lobby') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.topBar}><Kicker style={{ marginBottom: 0 }}>Imposter Host</Kicker><HomeButton /></View>
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
              <GlowButton onPress={() => goToSetup('auto')}><Text style={s.ctaText}>Auto-pick Imposter</Text></GlowButton>
              <Pressable onPress={() => goToSetup('manual')} style={s.outlineBtn}><Text style={s.ctaText}>Pick Imposter Manually</Text></Pressable>
            </View>
          ) : (
            <View style={s.waitBadge}><Text style={{ color: '#a1a1aa', fontSize: 13 }}>Waiting for at least 2 participants…</Text></View>
          )}
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'setup') {
    const canStart = !!townPlaylistId && !!imposterPlaylistId && !(assignmentMode === 'manual' && !selectedImposterId);
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Imposter Host</Kicker>
              <Text style={s.setupTitle}>Set up the round</Text>
            </View>
            <HomeButton />
          </View>

          <Panel>
            <Kicker>Town playlist</Kicker>
            <Text style={s.sub}>Everyone except the imposter hears a track from this.</Text>
            <View style={s.pillRow}>
              {playlists.map((pl) => (
                <Pressable key={pl.id} onPress={() => setTownPlaylistId(pl.id)} style={[s.pill, townPlaylistId === pl.id && s.pillCyan]}>
                  <Text style={s.pillText}>{pl.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>

          <Panel>
            <Kicker>Imposter playlist</Kicker>
            <Text style={s.sub}>The imposter hears a random track from this instead.</Text>
            <View style={s.pillRow}>
              {playlists.map((pl) => (
                <Pressable key={pl.id} onPress={() => setImposterPlaylistId(pl.id)} style={[s.pill, imposterPlaylistId === pl.id && s.pillRed]}>
                  <Text style={s.pillText}>{pl.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>

          {assignmentMode === 'manual' ? (
            <Panel>
              <Kicker>Pick the imposter</Kicker>
              <View style={s.pillRow}>
                {participants.map((p) => (
                  <Pressable key={p.id} onPress={() => setSelectedImposterId(p.id)} style={[s.pill, selectedImposterId === p.id && s.pillRed]}>
                    <Text style={s.pillText}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </Panel>
          ) : (
            <Panel>
              <Kicker>Imposter selection</Kicker>
              <Text style={s.sub}>A random participant will be chosen when you start.</Text>
            </Panel>
          )}

          <View style={s.rowBtns}>
            <Pressable onPress={() => setLocalPhase('lobby')} style={s.backBtn}><Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text></Pressable>
            <GlowButton onPress={startRound} disabled={starting || !canStart} style={{ flex: 1 }}>
              <Text style={s.ctaText}>{starting ? 'Starting…' : 'Start Round'}</Text>
            </GlowButton>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'playing') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Imposter Host</Kicker>
              <Text style={s.sub}>Round {currentRoundNumber}</Text>
            </View>
            <HomeButton />
          </View>

          <View style={{ alignItems: 'center' }}>
            <Pressable onPress={togglePlayback} style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : '#10b981' }]}>
              <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
            </Pressable>
          </View>

          <Panel>
            <Kicker>Participants ({participants.length})</Kicker>
            <View style={{ gap: 8, marginTop: 4 }}>
              {participants.map((p) => (
                <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                  <Text style={s.name}>{p.name}</Text>
                  {p.id === imposterParticipantId
                    ? <View style={s.imposterBadge}><Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '700' }}>Imposter</Text></View>
                    : <View style={s.townBadge}><Text style={{ color: '#a1a1aa', fontSize: 12 }}>Townsperson</Text></View>
                  }
                </ListRow>
              ))}
            </View>
          </Panel>

          <Pressable onPress={reveal} style={s.revealBtn}>
            <Text style={s.ctaText}>Reveal Imposter</Text>
          </Pressable>
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  // REVEALED
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.topBar}><Kicker style={{ marginBottom: 0 }}>Imposter Host — Revealed</Kicker><HomeButton /></View>
        <PanelStrong style={{ alignItems: 'center', paddingVertical: 36 }}>
          <Kicker>The imposter was…</Kicker>
          <Text style={[s.bigTitle, { color: '#f87171', fontSize: 48 }]}>{imposterName ?? '…'}</Text>
        </PanelStrong>
        <Panel style={{ gap: 12 }}>
          <Kicker>Play again?</Kicker>
          <Text style={s.sub}>Same participants, same playlists — pick a new imposter.</Text>
          <GlowButton onPress={() => goToSetup('auto')}><Text style={s.ctaText}>Auto-pick new imposter</Text></GlowButton>
          <Pressable onPress={() => goToSetup('manual')} style={s.outlineBtn}><Text style={s.ctaText}>Pick imposter manually</Text></Pressable>
        </Panel>
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
  sub: { color: '#71717a', fontSize: 13, marginTop: 4 },
  empty: { color: '#71717a', fontSize: 14 },
  ctaText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#27272a' },
  pillCyan: { backgroundColor: '#0e7490' },
  pillRed: { backgroundColor: '#991b1b' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', gap: 10 },
  backBtn: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.05)' },
  outlineBtn: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.04)', marginTop: 4 },
  waitBadge: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  bigBtn: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  imposterBadge: { borderRadius: 999, backgroundColor: 'rgba(127,29,29,0.6)', paddingHorizontal: 10, paddingVertical: 4 },
  townBadge: { borderRadius: 999, backgroundColor: '#27272a', paddingHorizontal: 10, paddingVertical: 4 },
  revealBtn: { borderRadius: 18, backgroundColor: '#7c3aed', paddingVertical: 20, alignItems: 'center' },
});
