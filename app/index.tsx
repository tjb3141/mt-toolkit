import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams, Link } from 'expo-router';
import Svg, { Path, Circle, Line } from 'react-native-svg';

export default function Home() {
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  const [code, setCode] = useState('');
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalid = params.error === 'invalid';

  function join() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 6) router.push(`/join/${trimmed}` as any);
  }

  function secretAdminTap() {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapCountRef.current += 1;

    if (tapCountRef.current >= 7) {
      router.push('/admin' as any);
      return;
    }

    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 1400);
  }

  return (
    <View className="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-5 py-8">
      {/* Hero panel */}
      <View className="music-panel-strong rounded-2xl p-6">
        <View className="flex-row items-center justify-between gap-5">
          <View className="flex-1">
            <Pressable onPress={secretAdminTap}>
              <Text className="music-kicker mb-3">MT Toolkit</Text>
            </Pressable>
            <Text className="stage-title text-5xl font-black tracking-tight text-white">
              Music Booth
            </Text>
            <Text className="mt-3 max-w-sm text-sm leading-6 text-zinc-300">
              Start the room, scan the code, and let the music do the heavy lifting.
            </Text>
          </View>
          <View className="hidden sm:block shrink-0">
            <View className="record-mark" />
          </View>
        </View>

        <View className="mt-6">
          <View className="equalizer">
            <View /><View /><View /><View /><View />
          </View>
        </View>
      </View>

      {/* Join panel */}
      <View className="music-panel rounded-2xl p-5">
        <View className="mb-4 flex-row items-center gap-4">
          <View className="icon-tile">
            <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width={32} height={32}>
              <Path d="M4 13a8 8 0 0 1 16 0" strokeWidth={2.25} strokeLinecap="round" />
              <Path d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z" strokeWidth={2.25} strokeLinejoin="round" />
            </Svg>
          </View>
          <View>
            <Text className="text-2xl font-black text-white">Join</Text>
            <Text className="text-sm text-zinc-400">Type the code from the host screen.</Text>
          </View>
        </View>

        {invalid && (
          <View className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 mb-3">
            <Text className="text-sm text-red-200">Session not found or expired.</Text>
          </View>
        )}

        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          maxLength={6}
          placeholder="ABC123"
          placeholderTextColor="#3f3f46"
          onSubmitEditing={join}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          className="w-full rounded-xl border-2 border-white/10 bg-black/35 px-5 py-5 text-center text-4xl font-black tracking-[0.3em] text-white uppercase focus:border-cyan-300"
        />

        <Pressable
          onPress={join}
          disabled={code.trim().length !== 6}
          className={`primary-glow w-full rounded-xl py-4 mt-3 items-center ${code.trim().length !== 6 ? 'opacity-30' : ''}`}
        >
          <Text className="text-xl font-black text-white">Join Room</Text>
        </Pressable>
      </View>

      {/* Host link */}
      <Link href={"/host" as any} asChild>
        <Pressable className="music-panel flex-row items-center justify-between gap-4 rounded-2xl p-5">
          <View className="flex-row items-center gap-4">
            <View className="icon-tile">
              <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width={32} height={32}>
                <Circle cx={12} cy={12} r={8} strokeWidth={2.25} />
                <Circle cx={12} cy={12} r={2} strokeWidth={2.25} />
                <Line x1={18.5} y1={5.5} x2={21} y2={3} strokeWidth={2.25} strokeLinecap="round" />
              </Svg>
            </View>
            <View>
              <Text className="text-2xl font-black text-white">Host</Text>
              <Text className="text-sm text-zinc-400">Create a session</Text>
            </View>
          </View>
          <View className="rounded-full bg-cyan-300 px-4 py-2">
            <Text className="text-sm font-black text-zinc-950">Start</Text>
          </View>
        </Pressable>
      </Link>
    </View>
  );
}
