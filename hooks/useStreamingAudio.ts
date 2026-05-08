import { useCallback, useEffect, useRef, useState } from 'react';

// WebAudio-based audio hook. Used by silent_disco's ClientView so the host
// can swap tracks (Skip / auto-advance) without the iOS Safari "fresh element
// needs a user gesture" problem that an HTMLAudioElement-based player hits.
//
// The trick: iOS gates audio playback on the AudioContext, not on individual
// BufferSource nodes. Once the context is unlocked by a user gesture (Ready),
// we can start arbitrarily many decoded buffers through it without further
// interaction. Source changes never re-gate.
//
// Usage:
//   const { prime, loadTrack, play, pause, isPlaying } = useStreamingAudio({ onEnd });
//   // call prime() inside a user gesture (button onPress) before first play.
//   await loadTrack(uri); play();
type Options = {
  onEnd?: () => void;
};

type State = {
  ctx: AudioContext | null;
  output: GainNode | null;
  keepAlive: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  startedAt: number;        // ctx.currentTime when current source started
  pauseOffset: number;      // seconds into the buffer when paused
  currentUri: string | null; // uri of the loaded buffer
  pendingUri: string | null; // newest uri requested by loadTrack (cancels older loads)
  isPlaying: boolean;
};

export function useStreamingAudio(options?: Options) {
  const stateRef = useRef<State>({
    ctx: null,
    output: null,
    keepAlive: null,
    buffer: null,
    source: null,
    startedAt: 0,
    pauseOffset: 0,
    currentUri: null,
    pendingUri: null,
    isPlaying: false,
  });
  const onEndRef = useRef(options?.onEnd);
  onEndRef.current = options?.onEnd;
  // Inline debug visible to the user — needed because iOS Safari has no console
  // and audio failures here are hard to diagnose otherwise.
  const [debug, setDebug] = useState<string>('idle');

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      try { s.source?.stop(); } catch {}
      try { s.keepAlive?.stop(); } catch {}
      try { s.ctx?.close(); } catch {}
      s.source = null;
      s.keepAlive = null;
      s.ctx = null;
      s.output = null;
    };
  }, []);

  const ensureContext = useCallback(() => {
    const s = stateRef.current;
    if (!s.ctx) {
      const Ctor = (typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as any).webkitAudioContext)
        : null) as typeof AudioContext | null;
      if (!Ctor) { setDebug('no AudioContext ctor'); return null; }
      s.ctx = new Ctor();
      s.output = s.ctx.createGain();
      s.output.gain.value = 1;
      s.output.connect(s.ctx.destination);
      setDebug(`ctx created (${s.ctx.state}, ${s.ctx.sampleRate}Hz)`);
    }
    return s.ctx;
  }, []);

  function startKeepAlive() {
    const s = stateRef.current;
    if (!s.ctx || s.keepAlive) return;
    // Keep a non-zero, effectively inaudible signal flowing. iOS Safari is
    // much more reliable after a gesture when the unlocked AudioContext has an
    // active graph instead of a one-shot silent click that immediately ends.
    try {
      const buf = s.ctx.createBuffer(1, s.ctx.sampleRate, s.ctx.sampleRate);
      const data = buf.getChannelData(0);
      data[0] = 0.000001;
      const node = s.ctx.createBufferSource();
      node.buffer = buf;
      node.loop = true;
      const gain = s.ctx.createGain();
      gain.gain.value = 0.000001;
      node.connect(gain);
      gain.connect(s.output ?? s.ctx.destination);
      node.start(0);
      s.keepAlive = node;
    } catch {}
  }

  // Must be called inside a user gesture (e.g. button onPress) before the
  // first play(). Stays synchronous so iOS Safari counts the work as
  // "happened during the gesture". Idempotent.
  const prime = useCallback(() => {
    const ctx = ensureContext();
    if (!ctx) return;
    startKeepAlive();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => setDebug(`primed (${ctx.state})`)).catch((e) => setDebug(`resume err: ${e?.message ?? e}`));
    }
    const s = stateRef.current;
    let burstFired = false;
    if (s.buffer) {
      try {
        const burst = s.ctx!.createBufferSource();
        burst.buffer = s.buffer;
        burst.connect(s.output ?? s.ctx!.destination);
        burst.start(0, 0, 0.01);
        burstFired = true;
      } catch (e: any) {
        setDebug(`burst err: ${e?.message ?? e}`);
      }
    }
    setDebug(`primed (${ctx.state}, burst=${burstFired ? 'y' : 'n'})`);
  }, [ensureContext]);

  const ensureRunning = useCallback(() => {
    const ctx = ensureContext();
    if (!ctx) return;
    startKeepAlive();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  }, [ensureContext]);

  const restartCurrentBuffer = useCallback(() => {
    const s = stateRef.current;
    if (!s.ctx || !s.buffer) return;
    try { s.source?.stop(); } catch {}
    s.source = null;
    s.pauseOffset = 0;
    startSource(0);
  }, []);

  const loadTrack = useCallback(async (uri: string) => {
    const s = stateRef.current;
    if (s.currentUri === uri && s.buffer) return;
    const ctx = ensureContext();
    if (!ctx) return;
    startKeepAlive();
    s.pendingUri = uri;
    setDebug('fetching…');
    let res: Response;
    try {
      res = await fetch(uri);
    } catch (e: any) {
      setDebug(`fetch threw: ${e?.message ?? e}`);
      return;
    }
    if (s.pendingUri !== uri) return;
    if (!res.ok) { setDebug(`fetch ${res.status}`); return; }
    setDebug(`fetched ${res.headers.get('content-length') ?? '?'}B, decoding…`);
    let bytes: ArrayBuffer;
    try { bytes = await res.arrayBuffer(); }
    catch (e: any) { setDebug(`arrayBuffer threw: ${e?.message ?? e}`); return; }
    if (s.pendingUri !== uri) return;
    let buffer: AudioBuffer;
    try {
      buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        s.ctx!.decodeAudioData(bytes, resolve, reject);
      });
    } catch (e: any) {
      setDebug(`decode err: ${e?.message ?? e ?? 'null'}`);
      return;
    }
    if (s.pendingUri !== uri) return;
    s.buffer = buffer;
    s.currentUri = uri;
    s.pauseOffset = 0;
    setDebug(`buffer ready (${buffer.duration.toFixed(1)}s, ${buffer.sampleRate}Hz)`);
    if (s.isPlaying) {
      try { s.source?.stop(); } catch {}
      s.source = null;
      startSource(0);
    }
  }, [ensureContext]);

  function startSource(offsetSeconds: number) {
    const s = stateRef.current;
    if (!s.ctx || !s.buffer) return;
    const src = s.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.connect(s.output ?? s.ctx.destination);
    src.onended = () => {
      // Was this the natural end (not a manual stop)?
      if (s.source === src) {
        s.source = null;
        s.isPlaying = false;
        s.pauseOffset = 0;
        onEndRef.current?.();
      }
    };
    src.start(0, offsetSeconds);
    s.source = src;
    s.startedAt = s.ctx.currentTime - offsetSeconds;
    s.isPlaying = true;
  }

  const play = useCallback(() => {
    const s = stateRef.current;
    if (!s.ctx) { setDebug('play: no ctx'); return; }
    if (!s.buffer) { setDebug('play: no buffer'); return; }
    ensureRunning();
    if (s.isPlaying) return;
    startSource(s.pauseOffset);
    setDebug(`playing (${s.ctx.state})`);
  }, [ensureRunning]);

  const pause = useCallback(() => {
    const s = stateRef.current;
    if (!s.isPlaying || !s.ctx || !s.source) return;
    s.pauseOffset = Math.max(0, s.ctx.currentTime - s.startedAt);
    try { s.source.stop(); } catch {}
    s.source = null;
    s.isPlaying = false;
  }, []);

  return { prime, loadTrack, play, pause, restartCurrentBuffer, debug };
}
