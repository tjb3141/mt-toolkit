import { Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Shell, PanelStrong, Kicker } from '@/components/ui';

export function KickedScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Shell style={{ justifyContent: 'center', alignItems: 'center' }}>
        <PanelStrong style={{ alignItems: 'center', width: '100%', paddingVertical: 32 }}>
          <Text style={s.emoji}>👋</Text>
          <Kicker>Removed by host</Kicker>
          <Text style={s.title}>You've been removed</Text>
          <Text style={s.sub}>The host removed you from this session.</Text>
        </PanelStrong>
        <Pressable onPress={() => router.replace('/')} style={s.homeBtn}>
          <Text style={s.homeText}>Back to home</Text>
        </Pressable>
      </Shell>
    </Screen>
  );
}

const s = StyleSheet.create({
  emoji: { fontSize: 56, marginBottom: 12 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  sub: { color: '#a1a1aa', fontSize: 14, marginTop: 10, textAlign: 'center' },
  homeBtn: { marginTop: 24, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 22, paddingVertical: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  homeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
