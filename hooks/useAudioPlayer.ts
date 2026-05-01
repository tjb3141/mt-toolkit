import { useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';

type AudioOptions = {
  loop?: boolean;
  onEnd?: () => void;
};

export function useAudioPlayer(options?: AudioOptions) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const currentUriRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const loadTrack = useCallback(
    async (trackId: string, sessionId: string) => {
      const uri = `/api/audio/${trackId}?session=${sessionId}`;
      if (currentUriRef.current === uri) return;

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, isLooping: options?.loop ?? false }
      );

      if (options?.onEnd) {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
            options.onEnd!();
          }
        });
      }

      soundRef.current = sound;
      currentUriRef.current = uri;
    },
    [options?.loop, options?.onEnd]
  );

  const play = useCallback(async () => {
    try {
      await soundRef.current?.playAsync();
    } catch {}
  }, []);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
  }, []);

  const unload = useCallback(async () => {
    await soundRef.current?.unloadAsync();
    soundRef.current = null;
    currentUriRef.current = null;
  }, []);

  return { loadTrack, play, pause, unload, soundRef };
}
