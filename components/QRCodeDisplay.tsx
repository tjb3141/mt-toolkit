import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

export function QRCodeDisplay({ url, code }: { url: string; code: string }) {
  return (
    <View style={s.wrap}>
      <View style={s.qrBox}>
        <QRCode value={url} size={160} backgroundColor="#18181b" color="#ffffff" quietZone={8} />
      </View>
      <Text style={s.label}>Room Code</Text>
      <Text style={s.code}>{code}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  qrBox: { backgroundColor: '#18181b', borderRadius: 16, padding: 16 },
  label: { color: '#71717a', fontSize: 11, fontWeight: '900', letterSpacing: 4, textTransform: 'uppercase' },
  code: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: 10, marginTop: 2 },
});
