import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';

type Props = {
  onSubmit: (name: string) => Promise<boolean> | boolean;
  submitting?: boolean;
};

export function NameEntryForm({ onSubmit, submitting }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setError(false);
    const ok = await onSubmit(name.trim());
    if (!ok) setError(true);
  };

  return (
    <View className="gap-4">
      <Text className="text-zinc-300 text-sm">Enter your name to join:</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor="#71717a"
        onSubmitEditing={handleSubmit}
        className="bg-black/35 border border-white/10 rounded-xl px-4 py-3 text-white text-base"
        autoCapitalize="words"
        autoFocus
      />
      {error && <Text className="text-red-400 text-sm">Failed to join. Try again.</Text>}
      <Pressable
        onPress={handleSubmit}
        disabled={!name.trim() || submitting}
        className={`primary-glow rounded-xl px-6 py-3 items-center ${!name.trim() || submitting ? 'opacity-50' : ''}`}
      >
        <Text className="text-white font-bold">
          {submitting ? 'Joining...' : 'Join'}
        </Text>
      </Pressable>
    </View>
  );
}
