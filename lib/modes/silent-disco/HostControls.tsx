import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Screen, Shell, Panel, PanelStrong, Kicker, GlowButton, HomeButton, ListRow, EndLink } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { kickParticipant } from '@/lib/kickParticipant';
import type { ModeProps } from '@/lib/modes';
import type { Participant, Playlist, Track } from '@/lib/types';

type Phase = 'lobby' | 'pickPlaylist' | 'pickTrack' | 'playing' | 'ended';

export default function SilentDiscoHostControls({ session }: ModeProps) {
  const initialPhase: Phase = session.playback_state === 'ended' ? 'ended' : 'lobby';
  const [localPhase, setLocalPhase] = useState<Phase>(initialPhase);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [tracksForPlaylist, setTracksForPlaylist] = useState<Track[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playbackState, setPlaybackState] = useState(session.playback_state);
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${session.code}` : '';
  const allReady = useMemo(
    () => participants.length > 0 && participants.every((p) => readyIds.has(p.id)),
    [participants, readyIds]
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

  useRealtimeTable(`sd-host:${session.id}`, [
    { event: 'INSERT', table: 'participants', filter: `session_id=eq.${session.id}`, onPayload: (p) => setParticipants((prev) => [...prev, p.new as Participant]) },
    { event: 'UPDATE', table: 'sessions', filter: `id=eq.${session.id}`, onPayload: (p) => {
      setPlaybackState(p.new.playback_state);
      if (p.new.playback_state === 'ended') setLocalPhase('ended');
    }},
    { event: 'UPDATE', table: 'participants', onPayload: (p) => {
      if (p.new.session_id !== session.id) return;
      if (p.new.ready) setReadyIds((prev) => new Set([...prev, p.new.id]));
    }},
    { event: 'DELETE', table: 'participants', onPayload: (p) => {
      const oldId = (p.old as any).id;
      setParticipants((prev) => prev.filter((x) => x.id !== oldId));
      setReadyIds((prev) => { const s = new Set(prev); s.delete(oldId); return s; });
    }},
  ]);

  const canKick = playbackState !== 'playing';

  async function kick(p: Participant) {
    if (!confirm(`Remove ${p.name} from the session?`)) return;
    setParticipants((prev) => prev.filter((x) => x.id !== p.id));
    setReadyIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
    await kickParticipant(p.id, session.id);
  }

  async function loadCurrentRoundState() {
    const { data: round } = await supabase.from('silent_disco_rounds').select('round, track_id').eq('session_id', session.id).order('round', { ascending: false }).limit(1).maybeSingle();
    if (round) {
      setCurrentRound(round.round);
      const { data: track } = await supabase.from('tracks').select('id, title, storage_path, duration_seconds').eq('id', round.track_id).single();
      if (track) setCurrentTrack(track as Track);
      setLocalPhase('playing');
    }
  }

  async function openPlaylistPicker() {
    setLocalPhase('pickPlaylist');
  }

  async function selectPlaylist(pl: Playlist) {
    setSelectedPlaylist(pl);
    setTracksLoading(true);
    setLocalPhase('pickTrack');
    const { data } = await supabase
      .from('playlist_tracks')
      .select('tracks(id, title, storage_path, duration_seconds)')
      .eq('playlist_id', pl.id);
    const trackRows = (data ?? []).map((r: any) => r.tracks).flat().filter(Boolean) as Track[];
    setTracksForPlaylist(trackRows);
    setTracksLoading(false);
  }

  async function queueTrack(track: Track) {
    if (starting) return;
    setStarting(true);
    const nextRound = currentRound + 1;
    await supabase.from('silent_disco_rounds').insert({ session_id: session.id, round: nextRound, track_id: track.id });
    await supabase.from('participants').update({ ready: false }).eq('session_id', session.id);
    await supabase.from('sessions').update({ playback_state: 'paused' }).eq('id', session.id);
    setCurrentRound(nextRound);
    setCurrentTrack(track);
    setReadyIds(new Set());
    setPlaybackState('paused');
    setLocalPhase('playing');
    setStarting(false);
  }

  async function togglePlayback() {
    if (playbackState !== 'playing' && !allReady) return;
    const next = playbackState === 'playing' ? 'paused' : 'playing';
    await supabase.from('sessions').update({ playback_state: next }).eq('id', session.id);
    setPlaybackState(next);
  }

  async function endSession() {
    await supabase.from('sessions').update({ playback_state: 'ended' }).eq('id', session.id);
    setLocalPhase('ended');
  }

  if (localPhase === 'ended') {
    return (
      <Screen>
        <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Kicker>Silent Disco</Kicker>
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent}>
          <View style={s.topBar}>
            <Kicker style={{ marginBottom: 0 }}>Silent Disco Host</Kicker>
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
              : <View style={{ gap: 8 }}>{participants.map((p) => (
                  <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                    <Text style={s.name}>{p.name}</Text>
                    {canKick && (
                      <Pressable onPress={() => kick(p)} style={s.kickBtn}>
                        <Text style={s.kickText}>Kick</Text>
                      </Pressable>
                    )}
                  </ListRow>
                ))}</View>
            }
          </Panel>

          {participants.length >= 1
            ? <GlowButton onPress={openPlaylistPicker}><Text style={s.ctaText}>Pick a playlist</Text></GlowButton>
            : <View style={s.waitingBadge}><Text style={{ color: '#a1a1aa', fontSize: 13 }}>Waiting for participants…</Text></View>
          }
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'pickPlaylist') {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Silent Disco Host</Kicker>
              <Text style={s.setupTitle}>Pick a playlist</Text>
            </View>
            <HomeButton />
          </View>

          <Panel>
            <Kicker>Playlist</Kicker>
            <Text style={s.subText}>Then choose a track to queue for everyone.</Text>
            <View style={s.pillRow}>
              {playlists.map((pl) => (
                <Pressable key={pl.id} onPress={() => selectPlaylist(pl)} style={s.pill}>
                  <Text style={s.pillText}>{pl.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>

          {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

          <View style={s.rowBtns}>
            <Pressable onPress={() => setLocalPhase(currentRound > 0 ? 'playing' : 'lobby')} style={s.backBtn}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text>
            </Pressable>
          </View>
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  if (localPhase === 'pickTrack') {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent}>
          <View style={s.topBar}>
            <View>
              <Kicker style={{ marginBottom: 0 }}>Silent Disco Host</Kicker>
              <Text style={s.setupTitle}>{selectedPlaylist?.name}</Text>
            </View>
            <HomeButton />
          </View>

          <Panel>
            <Kicker>Pick a track</Kicker>
            <Text style={s.subText}>Everyone hears the same track. Tap to queue it.</Text>
            {tracksLoading
              ? <Text style={[s.subText, { marginTop: 12 }]}>Loading tracks…</Text>
              : tracksForPlaylist.length === 0
                ? <Text style={[s.subText, { marginTop: 12 }]}>No tracks in this playlist.</Text>
                : <View style={{ gap: 8, marginTop: 10 }}>
                    {tracksForPlaylist.map((t) => (
                      <Pressable key={t.id} onPress={() => queueTrack(t)} disabled={starting} style={({ pressed }) => [s.trackRow, pressed && { opacity: 0.7 }]}>
                        <Text style={s.trackRowText} numberOfLines={2}>{t.title}</Text>
                      </Pressable>
                    ))}
                  </View>
            }
          </Panel>

          {joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

          <View style={s.rowBtns}>
            <Pressable onPress={() => setLocalPhase('pickPlaylist')} style={s.backBtn}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text>
            </Pressable>
          </View>
          <EndLink onPress={endSession} />
        </ScrollView>
      </Screen>
    );
  }

  // PLAYING
  const canPlay = playbackState === 'playing' || allReady;
  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent}>
        <View style={s.topBar}>
          <View>
            <Kicker style={{ marginBottom: 0 }}>Silent Disco Host</Kicker>
            <Text style={s.roundLabel}>Track {currentRound}</Text>
          </View>
          <HomeButton />
        </View>

        <PanelStrong style={{ alignItems: 'center' }}>
          <Kicker style={{ color: playbackState === 'playing' ? '#34d399' : '#71717a' }}>
            {playbackState === 'playing' ? 'Now playing' : 'Paused'}
          </Kicker>
          <Text style={s.trackTitle}>{currentTrack?.title ?? '—'}</Text>
        </PanelStrong>

        <View style={{ alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={canPlay ? togglePlayback : undefined}
            style={[s.bigBtn, { backgroundColor: playbackState === 'playing' ? '#ef4444' : canPlay ? '#10b981' : '#27272a', opacity: canPlay ? 1 : 0.5 }]}
          >
            <Text style={s.bigBtnText}>{playbackState === 'playing' ? 'Pause' : 'Play'}</Text>
          </Pressable>
          {playbackState === 'playing'
            ? <Text style={{ color: '#34d399', fontSize: 13, fontWeight: '600' }}>Music playing</Text>
            : <Text style={{ color: '#71717a', fontSize: 13 }}>{readyIds.size}/{participants.length} ready</Text>
          }
        </View>

        {playbackState !== 'playing' && joinUrl ? <QRCodeDisplay url={joinUrl} code={session.code} /> : null}

        <Panel>
          <Kicker>Participants ({participants.length})</Kicker>
          <View style={{ gap: 8, marginTop: 10 }}>
            {participants.map((p) => (
              <ListRow key={p.id} style={{ justifyContent: 'space-between' }}>
                <Text style={s.name}>{p.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: readyIds.has(p.id) ? '#34d399' : '#71717a', fontSize: 12, fontWeight: '700' }}>
                    {readyIds.has(p.id) ? 'Ready' : '…'}
                  </Text>
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

        <GlowButton onPress={openPlaylistPicker}>
          <Text style={s.ctaText}>Pick another track</Text>
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
  setupTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 4 },
  roundLabel: { color: '#52525b', fontSize: 12, marginTop: 2 },
  trackTitle: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 6, lineHeight: 30 },
  name: { color: '#fff', fontWeight: '600', fontSize: 15 },
  empty: { color: '#71717a', fontSize: 14 },
  subText: { color: '#71717a', fontSize: 13, marginTop: 4 },
  ctaText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  waitingBadge: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#27272a' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  trackRow: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 14, paddingVertical: 14 },
  trackRowText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowBtns: { flexDirection: 'row', gap: 10 },
  backBtn: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.05)' },
  bigBtn: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  kickBtn: { borderRadius: 999, backgroundColor: 'rgba(127,29,29,0.6)', paddingHorizontal: 12, paddingVertical: 4 },
  kickText: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
});
