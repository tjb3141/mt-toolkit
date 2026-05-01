import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type SubscriptionConfig = {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  table: string;
  filter?: string;
  onPayload: (payload: RealtimePostgresChangesPayload<any>) => void;
};

export function useRealtimeTable(
  channelName: string,
  configs: SubscriptionConfig[],
  enabled = true
) {
  const handlersRef = useRef(configs.map((c) => c.onPayload));
  handlersRef.current = configs.map((c) => c.onPayload);

  useEffect(() => {
    if (!enabled || !channelName) return;

    let channel: RealtimeChannel = supabase.channel(channelName);

    configs.forEach((config, i) => {
      channel = channel.on(
        'postgres_changes' as any,
        {
          event: config.event,
          schema: 'public',
          table: config.table,
          ...(config.filter ? { filter: config.filter } : {}),
        },
        (payload: any) => {
          handlersRef.current[i](payload);
        }
      );
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, enabled]);
}
