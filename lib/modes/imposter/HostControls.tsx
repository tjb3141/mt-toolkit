import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink } from '@/components/ui';
import { HostHeader } from '@/components/HostHeader';
import { kickParticipant, kickFromImposterRound } from '@/lib/kickParticipant';
import { confirm } from '@/lib/confirm';
import { shuffle } from '@/lib/shuffle';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist } from '@/lib/types';

type Phase = 'lobby' | 'setup' | 'playing' | 'revealed' | 'ended';

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
  const [roundActive, setRoundActive] = useState(session.playback_state === 'playing');
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

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
    { event: 'DELETE', table: 'participants', onPayload: (p) => {
      const oldId = (p.old as any).id;
      setParticipants((prev) => prev.filter((x) => x.id !== oldId));
      setReadyIds((prev) => { const s = new Set(prev); s.delete(oldId); return s; });
    }},
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => {
      setPlaybackState(p.new.playback_state);
      if (p.new.round_active) setRoundActive(true);
      if (p.new.playback_state === 'ended') setLocalPhase('ended');
    }},
    { event: 'UPDATE', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => {
      if (p.new.ready) setReadyIds((prev) => new Set([...prev, p.new.id]));
    }},
  ]);

  const canKick = playbackState !== 'playing';

  async function kick(p: Participant) {
    const isActiveImposter = imposterParticipantId === p.id && (localPhase === 'playing' || localPhase === 'revealed');
    const message = isActiveImposter
      ? `Remove ${p.name}? They are the imposter — this round will end and you'll need to pick a new imposter.`
      : `Remove ${p.name} from the session?`;
    if (!await confirm(message)) return;
    setParticipants((prev) => prev.filter((x) => x.id !== p.id));
    setReadyIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
    if (selectedImposterId === p.id) setSelectedImposterId(null);
    if (isActiveImposter) {
      // Reset round state and route Riley back to a re-pick screen.
      setImposterParticipantId(null);
      setPlaybackState('paused');
      setRoundActive(false);
      setLocalPhase('lobby');
      await kickFromImposterRound(p.id, session.id);
    } else {
      if (imposterParticipantId === p.id) setImposterParticipantId(null);
      await kickParticipant(p.id, session.id);
    }
  }

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
    const [{ data: townPt }, { data: imposterPt }] = await Promise.all([
      supabase.from('playlist_tracks').select('track_id').eq('playlist_id', townPlaylistId),
      supabase.from('playlist_tracks').select('track_id').eq('playlist_id', imposterPlaylistId),
    ]);
    const townTracks = (townPt ?? []).map((r) => ({ id: r.track_id }));
    const imposterTracks = (imposterPt ?? []).map((r) => ({ id: r.track_id }));
    const townTrack = shuffle(townTracks ?? [])[0];
    const imposterTrack = shuffle(imposterTracks ?? [])[0];
    const nextRound = currentRoundNumber + 1;
    await supabase.from('imposter_rounds').insert({ session_id: session.id, round: nextRound, town_playlist_id: townPlaylistId, imposter_playlist_id: imposterPlaylistId, imposter_participant_id: imposterId, town_track_id: townTrack?.id ?? null, imposter_track_id: imposterTrack?.id ?? null });
    await supabase.from('participants').update({ ready: false }).eq('session_id', session.id);
    await supabase.from('sessions').update({ playback_state: 'paused', round_active: false }).eq('id', session.id);
    setCurrentRoundNumber(nextRound);
    setImposterParticipantId(imposterId);
    setPlaybackState('paused');
    setRoundActive(false);
    setReadyIds(new Set());
    setLocalPhase('playing');
    setStarting(false);
  }

  async function togglePlayback() {
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    const updates: any = { playback_state: next };
    if (next === 'playing') updates.round_active = true;
    await supabase.from('sessions').update(updates).eq('id', session.id);
    setPlaybackState(next);
    if (next === 'playing') setRoundActive(true);
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
          <HostHeader code={session.code} label="Imposter Host" />
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
          <HostHeader code={session.code} label={`Imposter Host · Round ${currentRoundNumber}`} />

          {(() => {
            const allReady = participants.length > 0 && participants.every((p) => readyIds.has(p.id));
            const canPlay = roundActive || allReady;
            return (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Pressable
                  onPress={canPlay ? togglePlayback : undefined}
                  style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : canPlay ? '#10b981' : '#27272a', opacity: canPlay ? 1 : 0.5 }]}
                >
                  <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
                </Pressable>
                {!canPlay && (
                  <Text style={{ color: '#71717a', fontSize: 13 }}>{readyIds.size}/{participants.length} ready</Text>
                )}
              </View>
            );
          })()}

          <Panel>
            <Kicker>Participants ({participants.length})</Kicker>
            <View style={{ gap: 8, marginTop: 4 }}>
              {participants.map((p) => (
                <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                  <Text style={s.name}>{p.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {!roundActive && readyIds.has(p.id) && (
                      <Text style={{ color: '#34d399', fontSize: 12, fontWeight: '700' }}>Ready</Text>
                    )}
                    {p.id === imposterParticipantId
                      ? <View style={s.imposterBadge}><Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '700' }}>Imposter</Text></View>
                      : <View style={s.townBadge}><Text style={{ color: '#a1a1aa', fontSize: 12 }}>Townsperson</Text></View>
                    }
                    {canKick && (
                      <Pressable onPress={() => kick(p)} style={s.kickBtn}>
                        <Text style={s.kickText}>Kick</Text>
                      </Pressable>
                    )}
                  </View>
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
        <HostHeader code={session.code} label="Imposter Host · Revealed" />
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
  kickBtn: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', paddingHorizontal: 12, paddingVertical: 4 },
  kickText: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
});
