import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export function useParticipant(sessionId: string) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [kicked, setKicked] = useState(false);

  const storageKey = `participant:${sessionId}`;

  const clear = useCallback(async () => {
    await AsyncStorage.removeItem(storageKey);
    setParticipantId(null);
    setName('');
  }, [storageKey]);

  // Watch for the host kicking us: row goes away from public.participants.
  useEffect(() => {
    if (!participantId) return;
    const channel = supabase
      .channel(`kick-watch:${participantId}`)
      .on(
        'postgres_changes' as any,
        { event: 'DELETE', schema: 'public', table: 'participants' },
        async (payload: any) => {
          if (payload.old?.id !== participantId) return;
          await AsyncStorage.removeItem(storageKey);
          setKicked(true);
          // Clearing the id disables any consumer subscriptions gated on
          // !!participantId so kicked devices stop reacting to session events.
          setParticipantId(null);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [participantId, storageKey]);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved) {
        const { id, n } = JSON.parse(saved);
        setParticipantId(id);
        setName(n);
      }
      setLoading(false);
    });
  }, [storageKey]);

  const join = useCallback(
    async (playerName: string) => {
      const { data, error } = await supabase
        .from('participants')
        .insert({ session_id: sessionId, name: playerName.trim() })
        .select('id')
        .single();

      if (error || !data) return false;

      setParticipantId(data.id);
      setName(playerName.trim());
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ id: data.id, n: playerName.trim() })
      );
      return true;
    },
    [sessionId, storageKey]
  );

  return { participantId, name, loading, join, setName, kicked, clear };
}
