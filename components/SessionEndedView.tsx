import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PrimaryGlowButton } from './PrimaryGlowButton';

export function SessionEndedView() {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <Text className="text-white text-2xl font-bold">Session Ended</Text>
      <Text className="text-zinc-400 text-center">
        This session has ended. Thanks for participating!
      </Text>
      <PrimaryGlowButton title="Back to Home" onPress={() => router.replace('/')} />
    </View>
  );
}
