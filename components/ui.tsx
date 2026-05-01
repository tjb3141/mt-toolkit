/**
 * Shared styled primitives — replaces CSS class names that don't work in React Native Web.
 * Use these everywhere instead of music-panel / music-panel-strong / primary-glow / etc.
 */
import { View, Text, Pressable, StyleSheet, TextInput as RNTextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import type { ViewStyle, TextStyle, PressableStateCallbackType } from 'react-native';

export const C = {
  cyan: '#22d3ee',
  violet: '#8b5cf6',
  pink: '#f472b6',
  panelBg: 'rgba(18,18,31,0.88)',
  panelBorder: 'rgba(255,255,255,0.10)',
  kickerColor: '#67e8f9',
};

/** Full-screen gradient background with glow blobs */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient
      colors={['#070712', '#101021', '#09090b']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[s.screen, style]}
    >
      <View style={s.glowCyan} />
      <View style={s.glowPink} />
      {children}
    </LinearGradient>
  );
}

/** Centred, max-width shell */
export function Shell({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.shell, style]}>{children}</View>;
}

/** Dark glass panel */
export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

/** Violet→cyan hero panel */
export function PanelStrong({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient
      colors={['rgba(139,92,246,0.22)', 'rgba(34,211,238,0.07)', 'rgba(18,18,31,0.92)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.panel, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Cyan ALL-CAPS kicker label */
export function Kicker({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.kicker, style]}>{children}</Text>;
}

/** Large bold title */
export function Title({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.title, style]}>{children}</Text>;
}

/** Gradient primary button */
export function GlowButton({
  onPress,
  disabled,
  children,
  style,
}: {
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.glowBtnWrap, { opacity: disabled ? 0.35 : 1 }, style]}
    >
      <LinearGradient
        colors={['#7c3aed', '#0891b2']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={s.glowBtnGrad}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

/** Square icon container */
export function IconTile({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.iconTile, style]}>{children}</View>;
}

/** Home icon button — navigates to / */
export function HomeButton() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.replace('/')} style={s.homeBtn}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2}>
        <Path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
      </Svg>
    </Pressable>
  );
}

/** Animated equalizer bars */
export function EqBars() {
  return (
    <View style={s.eqRow}>
      {[38, 72, 52, 88, 46].map((h, i) => (
        <LinearGradient
          key={i}
          colors={['#8b5cf6', '#22d3ee']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={[s.eqBar, { height: `${h}%` as any }]}
        />
      ))}
    </View>
  );
}

/** Styled code / name text input */
export function StyledInput(props: React.ComponentProps<typeof RNTextInput>) {
  return (
    <RNTextInput
      placeholderTextColor="#3f3f46"
      {...props}
      style={[s.input, props.style]}
    />
  );
}

/** Cyan pill badge */
export function CyanBadge({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.cyanBadge}>
      <Text style={s.cyanBadgeText}>{children}</Text>
    </View>
  );
}

/** List item row inside a panel */
export function ListRow({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.listRow, style]}>{children}</View>;
}

/** Error box */
export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={s.errorBox}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

/** "End session" text link */
export function EndLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignSelf: 'center' }}>
      <Text style={s.endLink}>End session</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, minHeight: '100%' as any },
  glowCyan: { position: 'absolute', width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(34,211,238,0.15)', top: -120, left: -80 },
  glowPink: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(244,114,182,0.12)', top: -60, right: -60 },
  shell: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 36, gap: 14 },
  panel: { backgroundColor: C.panelBg, borderRadius: 20, borderWidth: 1, borderColor: C.panelBorder, padding: 20 },
  kicker: { color: C.kickerColor, fontSize: 11, fontWeight: '900', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 8 },
  title: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1 },
  glowBtnWrap: { borderRadius: 18, overflow: 'hidden' },
  glowBtnGrad: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  iconTile: { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  homeBtn: { padding: 8 },
  eqRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 40 },
  eqBar: { width: 7, minHeight: 6, borderRadius: 999 },
  input: { width: '100%', borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 20, paddingVertical: 16, textAlign: 'center', fontSize: 28, fontWeight: '900', color: '#fff' },
  cyanBadge: { backgroundColor: C.cyan, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  cyanBadgeText: { color: '#09090b', fontSize: 12, fontWeight: '900' },
  listRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  errorBox: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  errorText: { color: '#fca5a5', fontSize: 13 },
  endLink: { color: '#52525b', fontSize: 13, textDecorationLine: 'underline' },
});
