import { View, Text } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

type Props = {
  url: string;
  code: string;
};

export function QRCodeDisplay({ url, code }: Props) {
  return (
    <View className="items-center gap-4">
      <View className="bg-zinc-900 rounded-2xl p-4">
        <QRCode
          value={url}
          size={160}
          backgroundColor="#18181b"
          color="#ffffff"
          quietZone={8}
        />
      </View>
      <View className="items-center">
        <Text className="text-zinc-400 text-xs uppercase tracking-widest">Room Code</Text>
        <Text className="text-white text-3xl font-black tracking-[0.3em] mt-1">
          {code}
        </Text>
      </View>
    </View>
  );
}
