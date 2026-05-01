import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session } from '@/lib/types';

export function useSession(code: string | undefined) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError(true);
      return;
    }

    supabase
      .from('sessions')
      .select('*')
      .eq('code', code.toUpperCase())
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
      .then(({ data }) => {
        setSession(data);
        setError(!data);
        setLoading(false);
      });
  }, [code]);

  return { session, loading, error };
}
