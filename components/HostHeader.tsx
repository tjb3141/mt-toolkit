import { View, Text, StyleSheet } from 'react-native';
import { PanelStrong, Kicker, HomeButton } from '@/components/ui';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';

// Shared host header: room code + QR + Home button.
// Used at the top of every host screen except multi-step setup / queue-build
// phases where it would push the actionable controls below the fold.
export function HostHeader({ code, label }: { code: string; label?: string }) {
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : '';
  return (
    <View style={s.wrap}>
      <View style={s.topRow}>
        <Kicker style={{ marginBottom: 0 }}>{label ?? 'Host'}</Kicker>
        <HomeButton />
      </View>
      <PanelStrong style={{ alignItems: 'center' }}>
        <Kicker>Room Code</Kicker>
        <Text style={s.roomCode}>{code}</Text>
      </PanelStrong>
      {joinUrl ? <QRCodeDisplay url={joinUrl} code={code} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomCode: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: 8, textAlign: 'center' },
});
