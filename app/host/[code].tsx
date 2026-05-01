import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/hooks/useSession';
import { modes } from '@/lib/modes';

export default function HostSession() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { session, loading, error } = useSession(code);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-stage">
        <ActivityIndicator color="#22d3ee" size="large" />
      </View>
    );
  }

  if (error || !session) {
    router.replace('/host' as any);
    return null;
  }

  const mode = modes[session.mode] ?? modes.silent_disco;
  const HostControls = mode.HostControls;

  return <HostControls session={session} />;
}
