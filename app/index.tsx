import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ImageBackground, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Line } from 'react-native-svg';

export default function Home() {
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  const [code, setCode] = useState('');
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalid = params.error === 'invalid';
  const canJoin = code.trim().length === 6;

  function join() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 6) router.push(`/join/${trimmed}` as any);
  }

  function secretAdminTap() {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapCountRef.current += 1;
    if (tapCountRef.current >= 7) {
      router.push('/admin' as any);
      return;
    }
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 1400);
  }

  return (
    <LinearGradient
      colors={['#070712', '#101021', '#09090b']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.root}
    >
      {/* Ambient glow blobs */}
      <View style={styles.glowCyan} />
      <View style={styles.glowPink} />

      <View style={styles.shell}>

        {/* ── Hero panel ── */}
        <LinearGradient
          colors={['rgba(139,92,246,0.22)', 'rgba(34,211,238,0.07)', 'rgba(18,18,31,0.92)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroPanelGrad}
        >
          <View style={styles.heroInner}>
            <View style={{ flex: 1 }}>
              <Pressable onPress={secretAdminTap}>
                <Text style={styles.kicker}>MT Toolkit</Text>
              </Pressable>
              <Text style={styles.heroTitle}>Music{'\n'}Booth</Text>
              <Text style={styles.heroSub}>
                Start the room, scan the code, and let the music do the heavy lifting.
              </Text>
            </View>
            <RecordMark />
          </View>
          <EqualizerBars />
        </LinearGradient>

        {/* ── Join panel ── */}
        <View style={styles.panel}>
          <View style={styles.panelRow}>
            <IconTile>
              <Svg viewBox="0 0 24 24" fill="none" stroke="#fff" width={28} height={28}>
                <Path d="M4 13a8 8 0 0 1 16 0" strokeWidth={2.25} strokeLinecap="round" />
                <Path d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z" strokeWidth={2.25} strokeLinejoin="round" />
              </Svg>
            </IconTile>
            <View>
              <Text style={styles.panelTitle}>Join</Text>
              <Text style={styles.panelSub}>Type the code from the host screen.</Text>
            </View>
          </View>

          {invalid && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Session not found or expired.</Text>
            </View>
          )}

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            placeholderTextColor="#3f3f46"
            onSubmitEditing={join}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            style={styles.codeInput}
          />

          <Pressable
            onPress={join}
            disabled={!canJoin}
            style={({ pressed }) => [styles.joinBtnBase, !canJoin && { opacity: 0.32 }, pressed && canJoin && { opacity: 0.85 }]}
          >
            <LinearGradient
              colors={['#7c3aed', '#0891b2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.joinBtnGrad}
            >
              <Text style={styles.joinBtnText}>Join Room</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── Host link ── */}
        <Pressable
          onPress={() => router.push('/host' as any)}
          style={({ pressed }) => [styles.panel, styles.hostRow, pressed && { opacity: 0.8 }]}
        >
          <IconTile>
            <Svg viewBox="0 0 24 24" fill="none" stroke="#fff" width={28} height={28}>
              <Circle cx={12} cy={12} r={8} strokeWidth={2.25} />
              <Circle cx={12} cy={12} r={2} strokeWidth={2.25} />
              <Line x1={18.5} y1={5.5} x2={21} y2={3} strokeWidth={2.25} strokeLinecap="round" />
            </Svg>
          </IconTile>
          <View style={{ flex: 1 }}>
            <Text style={styles.panelTitle}>Host</Text>
            <Text style={styles.panelSub}>Create a session</Text>
          </View>
          <View style={styles.startBadge}>
            <Text style={styles.startBadgeText}>Start</Text>
          </View>
        </Pressable>

      </View>
    </LinearGradient>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return <View style={styles.iconTile}>{children}</View>;
}

function RecordMark() {
  return (
    <View style={styles.recordOuter}>
      <LinearGradient
        colors={['#22d3ee', '#f472b6']}
        style={styles.recordDot}
      />
    </View>
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

const PANEL_BG = 'rgba(18,18,31,0.85)';
const PANEL_BORDER = 'rgba(255,255,255,0.10)';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: '100%' as any,
  },
  glowCyan: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(34,211,238,0.18)',
    top: -120,
    left: -80,
  },
  glowPink: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(244,114,182,0.14)',
    top: -60,
    right: -60,
  },
  shell: {
    flex: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    gap: 16,
  },
  // Hero
  heroPanelGrad: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 24,
    overflow: 'hidden',
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  kicker: {
    color: '#67e8f9',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 52,
    letterSpacing: -1,
  },
  heroSub: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  // Record
  recordOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#171827',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 8,
    borderColor: 'rgba(139,92,246,0.15)',
    flexShrink: 0,
  },
  recordDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  // Equalizer
  eqRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 48,
    marginTop: 20,
  },
  eqBar: {
    width: 8,
    minHeight: 8,
    borderRadius: 999,
  },
  // Panel shared
  panel: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 20,
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  panelTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  panelSub: {
    color: '#71717a',
    fontSize: 13,
    marginTop: 2,
  },
  iconTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  // Code input
  codeInput: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 20,
    paddingVertical: 18,
    textAlign: 'center',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 10,
    color: '#fff',
    textTransform: 'uppercase',
  },
  // Join button
  joinBtnBase: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
  },
  joinBtnGrad: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  // Host row
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  startBadge: {
    backgroundColor: '#22d3ee',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  startBadgeText: {
    color: '#09090b',
    fontSize: 13,
    fontWeight: '900',
  },
  // Error
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
});
