import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

export function HomeButton() {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.replace('/')}
      className="absolute top-6 left-5 z-10 p-2"
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2}>
        <Path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
      </Svg>
    </Pressable>
  );
}
