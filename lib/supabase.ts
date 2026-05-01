import { createClient } from '@supabase/supabase-js';

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  process.env.PUBLIC_SUPABASE_URL ??
  '';

const key =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder');
