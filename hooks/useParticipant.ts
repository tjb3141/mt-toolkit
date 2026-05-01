import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export function useParticipant(sessionId: string) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  const storageKey = `participant:${sessionId}`;

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

  return { participantId, name, loading, join, setName };
}
