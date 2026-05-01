import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();

  const { data: sessions, error } = await admin
    .from('sessions')
    .select('id, code, mode, playback_state, created_at, expires_at')
    .neq('playback_state', 'ended')
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const withCounts = await Promise.all(
    (sessions ?? []).map(async (s) => {
      const { count } = await admin
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', s.id);
      return { ...s, participant_count: count ?? 0 };
    })
  );

  return Response.json(withCounts);
}
