import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { modes } from '@/lib/modes';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function modeHelp(key: string) {
  if (key === 'partners') return 'Pair people up by matching songs.';
  if (key === 'imposter') return 'One person hears a different song — spot the odd one out.';
  if (key === 'freeze_dance') return 'Dance when music plays, freeze when it stops.';
  return 'Everyone listens solo while you control play and pause.';
}

function ModeIcon({ modeKey }: { modeKey: string }) {
  const p = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff' };
  if (modeKey === 'silent_disco') return (
    <Svg {...p}>
      <Path d="M4 13a8 8 0 0 1 16 0" strokeWidth={2.25} strokeLinecap="round" />
      <Path d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z" strokeWidth={2.25} strokeLinejoin="round" />
    </Svg>
  );
  if (modeKey === 'partners') return (
    <Svg {...p}>
      <Path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth={2.25} />
      <Path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth={2.25} />
      <Path d="M3.5 20a4.5 4.5 0 0 1 9 0" strokeWidth={2.25} strokeLinecap="round" />
      <Path d="M11.5 20a4.5 4.5 0 0 1 9 0" strokeWidth={2.25} strokeLinecap="round" />
    </Svg>
  );
  if (modeKey === 'imposter') return (
    <Svg {...p}>
      <Circle cx={12} cy={8} r={3} strokeWidth={2.25} />
      <Path d="M6 20a6 6 0 0 1 12 0" strokeWidth={2.25} strokeLinecap="round" />
    </Svg>
  );
  // freeze_dance — full snowflake with ticks
  return (
    <Svg {...p}>
      <Line x1={12} y1={2} x2={12} y2={22} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={2} y1={12} x2={22} y2={12} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={4.93} y1={4.93} x2={19.07} y2={19.07} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={19.07} y1={4.93} x2={4.93} y2={19.07} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={12} y1={2} x2={9} y2={5} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={12} y1={2} x2={15} y2={5} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={12} y1={22} x2={9} y2={19} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={12} y1={22} x2={15} y2={19} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={2} y1={12} x2={5} y2={9} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={2} y1={12} x2={5} y2={15} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={22} y1={12} x2={19} y2={9} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={22} y1={12} x2={19} y2={15} strokeWidth={2.25} strokeLinecap="round" />
    </Svg>
  );
}

function EqualizerBars() {
  return (
    <View style={styles.eqRow}>
      {[38, 72, 52, 88, 46].map((h, i) => (
        <LinearGradient
          key={i}
          colors={['#8b5cf6', '#22d3ee']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={[styles.eqBar, { height: `${h}%` as any }]}
        />
      ))}
    </View>
  );
}

export default function HostModePicker() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState('silent_disco');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function createSession() {
    setCreating(true);
    setError('');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { data, error: dbErr } = await supabase
        .from('sessions')
        .insert({ code, mode: selectedMode, playback_state: 'paused', expires_at: expiresAt })
        .select()
        .single();
      if (!dbErr && data) { router.push(`/host/${data.code}` as any); return; }
      if (dbErr?.code !== '23505') { setError(dbErr?.message ?? 'Unknown error'); break; }
    }
    setCreating(false);
  }

  return (
    <LinearGradient
      colors={['#070712', '#101021', '#09090b']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.root}
    >
      <View style={styles.glowCyan} />
      <View style={styles.glowPink} />

      <View style={styles.shell}>
        {/* Top bar: home + equalizer */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.replace('/')} style={styles.homeBtn}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2}>
              <Path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
            </Svg>
          </Pressable>
          <EqualizerBars />
        </View>

        {/* Hero */}
        <LinearGradient
          colors={['rgba(139,92,246,0.22)', 'rgba(34,211,238,0.07)', 'rgba(18,18,31,0.92)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.kicker}>Host Booth</Text>
          <Text style={styles.heroTitle}>Pick the vibe</Text>
          <Text style={styles.heroSub}>
            Choose a mode, then the app gives you a giant room code and QR screen.
          </Text>
        </LinearGradient>

        {/* Mode list */}
        <View style={styles.modeSection}>
          <Text style={styles.kicker}>Mode</Text>
          {Object.entries(modes).map(([key, m]) => {
            const selected = selectedMode === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedMode(key)}
                style={[styles.modeRow, selected && styles.modeRowSelected]}
              >
                <View style={styles.iconTile}>
                  <ModeIcon modeKey={key} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeLabel}>{m.label}</Text>
                  <Text style={styles.modeSub}>{modeHelp(key)}</Text>
                </View>
                {selected && (
                  <View style={styles.onBadge}>
                    <Text style={styles.onBadgeText}>On</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* CTA */}
        <Pressable
          onPress={createSession}
          disabled={creating}
          style={{ borderRadius: 20, overflow: 'hidden', opacity: creating ? 0.4 : 1 }}
        >
          <LinearGradient
            colors={['#7c3aed', '#0891b2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGrad}
          >
            <Text style={styles.ctaText}>{creating ? 'Making room…' : 'Make the Room'}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const PANEL_BG = 'rgba(18,18,31,0.85)';
const PANEL_BORDER = 'rgba(255,255,255,0.10)';

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%' as any },
  glowCyan: { position: 'absolute', width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(34,211,238,0.15)', top: -120, left: -80 },
  glowPink: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(244,114,182,0.12)', top: -60, right: -60 },
  shell: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 40, gap: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  homeBtn: { padding: 8 },
  eqRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 40 },
  eqBar: { width: 7, minHeight: 6, borderRadius: 999 },
  hero: { borderRadius: 20, borderWidth: 1, borderColor: PANEL_BORDER, padding: 24 },
  kicker: { color: '#67e8f9', fontSize: 11, fontWeight: '900', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 10 },
  heroTitle: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1 },
  heroSub: { color: '#a1a1aa', fontSize: 13, lineHeight: 20, marginTop: 8 },
  modeSection: { gap: 10 },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: PANEL_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 16,
  },
  modeRowSelected: {
    borderColor: 'rgba(34,211,238,0.7)',
    backgroundColor: 'rgba(34,211,238,0.08)',
  },
  iconTile: { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modeLabel: { color: '#fff', fontSize: 18, fontWeight: '900' },
  modeSub: { color: '#71717a', fontSize: 13, marginTop: 2 },
  onBadge: { backgroundColor: '#22d3ee', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  onBadgeText: { color: '#09090b', fontSize: 12, fontWeight: '900' },
  ctaGrad: { paddingVertical: 20, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  errorBox: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.1)', paddingHorizontal: 12, paddingVertical: 8 },
  errorText: { color: '#fca5a5', fontSize: 13 },
});
