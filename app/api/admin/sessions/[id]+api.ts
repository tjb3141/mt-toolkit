import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function DELETE(request: Request, { id }: { id: string }) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();

  const { error } = await admin
    .from('sessions')
    .update({ playback_state: 'ended' })
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
