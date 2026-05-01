import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/hooks/useSession';
import { modes } from '@/lib/modes';

export default function JoinSession() {
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
    router.replace('/?error=invalid');
    return null;
  }

  const mode = modes[session.mode] ?? modes.silent_disco;
  const ClientView = mode.ClientView;

  return <ClientView session={session} />;
}
