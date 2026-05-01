import { useRef, useCallback, useEffect } from 'react';
import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

type AudioOptions = {
  loop?: boolean;
  onEnd?: () => void;
};

export function useAudioPlayer(options?: AudioOptions) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const currentUriRef = useRef<string | null>(null);
  const onEndRef = useRef(options?.onEnd);
  onEndRef.current = options?.onEnd;

  useEffect(() => {
    return () => {
      playerRef.current?.remove();
    };
  }, []);

  const loadTrack = useCallback(
    async (trackId: string, sessionId: string) => {
      const uri = `/api/audio/${trackId}?session=${sessionId}`;
      if (currentUriRef.current === uri) return;

      playerRef.current?.remove();

      const player = createAudioPlayer({ uri });
      player.loop = options?.loop ?? false;

      if (onEndRef.current) {
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish && !player.loop) {
            onEndRef.current?.();
          }
        });
      }

      playerRef.current = player;
      currentUriRef.current = uri;
    },
    [options?.loop]
  );

  const play = useCallback(() => {
    try { playerRef.current?.play(); } catch {}
  }, []);

  const pause = useCallback(() => {
    try { playerRef.current?.pause(); } catch {}
  }, []);

  const unload = useCallback(() => {
    playerRef.current?.remove();
    playerRef.current = null;
    currentUriRef.current = null;
  }, []);

  return { loadTrack, play, pause, unload, playerRef };
}
