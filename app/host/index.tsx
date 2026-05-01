import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { modes } from '@/lib/modes';
import { HomeButton } from '@/components/HomeButton';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function modeHelp(key: string) {
  if (key === 'partners') return 'Pair people up by matching songs.';
  if (key === 'imposter') return 'One person hears a different song \u2014 spot the odd one out.';
  if (key === 'freeze_dance') return 'Dance when music plays, freeze when it stops.';
  return 'Everyone listens solo while you control play and pause.';
}

function ModeIcon({ modeKey }: { modeKey: string }) {
  const props = { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
  if (modeKey === 'silent_disco') {
    return (
      <Svg {...props}>
        <Path d="M4 13a8 8 0 0 1 16 0" strokeWidth={2.25} strokeLinecap="round" />
        <Path d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm11 0h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3v-6Z" strokeWidth={2.25} strokeLinejoin="round" />
      </Svg>
    );
  }
  if (modeKey === 'partners') {
    return (
      <Svg {...props}>
        <Path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth={2.25} />
        <Path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth={2.25} />
        <Path d="M3.5 20a4.5 4.5 0 0 1 9 0" strokeWidth={2.25} strokeLinecap="round" />
        <Path d="M11.5 20a4.5 4.5 0 0 1 9 0" strokeWidth={2.25} strokeLinecap="round" />
      </Svg>
    );
  }
  if (modeKey === 'imposter') {
    return (
      <Svg {...props}>
        <Circle cx={12} cy={8} r={3} strokeWidth={2.25} />
        <Path d="M6 20a6 6 0 0 1 12 0" strokeWidth={2.25} strokeLinecap="round" />
      </Svg>
    );
  }
  // freeze_dance
  return (
    <Svg {...props}>
      <Line x1={12} y1={2} x2={12} y2={22} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={2} y1={12} x2={22} y2={12} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={4.93} y1={4.93} x2={19.07} y2={19.07} strokeWidth={2.25} strokeLinecap="round" />
      <Line x1={19.07} y1={4.93} x2={4.93} y2={19.07} strokeWidth={2.25} strokeLinecap="round" />
    </Svg>
  );
}

export default function HostModePicker() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState('silent_disco');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function createSession() {
    setCreating(true);
    setError('');

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { data, error: err } = await supabase
        .from('sessions')
        .insert({ code, mode: selectedMode, playback_state: 'paused', expires_at: expiresAt })
        .select()
        .single();

      if (!err && data) {
        router.push(`/host/${data.code}` as any);
        return;
      }
      if (err?.code !== '23505') {
        setError(err?.message ?? 'Unknown error');
        break;
      }
    }

    setCreating(false);
  }

  return (
    <View className="stage-shell mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-5 py-8">
      <HomeButton />

      <View className="music-panel-strong rounded-2xl p-6">
        <Text className="music-kicker mb-3">Host Booth</Text>
        <Text className="stage-title text-5xl font-black tracking-tight text-white">
          Pick the vibe
        </Text>
        <Text className="mt-3 text-sm leading-6 text-zinc-300">
          Choose a mode, then the app gives you a giant room code and QR screen.
        </Text>
      </View>

      <View className="gap-3">
        <Text className="music-kicker">Mode</Text>
        {Object.entries(modes).map(([key, m]) => (
          <Pressable
            key={key}
            onPress={() => setSelectedMode(key)}
            className={`music-panel flex-row items-center gap-4 rounded-2xl p-5 ${
              selectedMode === key ? 'border-cyan-300/80 bg-cyan-300/10' : ''
            }`}
          >
            <View className="icon-tile">
              <ModeIcon modeKey={key} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-black text-white">{m.label}</Text>
              <Text className="text-sm text-zinc-400">{modeHelp(key)}</Text>
            </View>
            {selectedMode === key && (
              <View className="rounded-full bg-cyan-300 px-3 py-1">
                <Text className="text-xs font-black text-zinc-950">On</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {error ? (
        <View className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <Text className="text-sm text-red-200">{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={createSession}
        disabled={creating}
        className={`primary-glow w-full rounded-2xl py-5 items-center active:scale-95 ${creating ? 'opacity-30' : ''}`}
      >
        <Text className="text-2xl font-black text-white">
          {creating ? 'Making room...' : 'Make the Room'}
        </Text>
      </Pressable>
    </View>
  );
}
