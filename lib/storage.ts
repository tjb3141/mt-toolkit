import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getParticipant(sessionId: string) {
  const saved = await AsyncStorage.getItem(`participant:${sessionId}`);
  if (!saved) return null;
  return JSON.parse(saved) as { id: string; n: string };
}

export async function setParticipant(sessionId: string, id: string, name: string) {
  await AsyncStorage.setItem(
    `participant:${sessionId}`,
    JSON.stringify({ id, n: name })
  );
}
