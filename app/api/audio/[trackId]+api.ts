import { adminClient } from '@/lib/supabase-server';

export async function GET(request: Request, { trackId }: { trackId: string }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  if (!sessionId) {
    return Response.json({ error: 'session required' }, { status: 400 });
  }

  const admin = adminClient();

  const { data: session } = await admin
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .neq('playback_state', 'ended')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!session) {
    return Response.json({ error: 'Invalid or expired session' }, { status: 403 });
  }

  const { data: track } = await admin
    .from('tracks')
    .select('storage_path')
    .eq('id', trackId)
    .single();

  if (!track) {
    return Response.json({ error: 'Track not found' }, { status: 404 });
  }

  const { data, error } = await admin.storage
    .from('tracks')
    .createSignedUrl(track.storage_path, 7200);

  if (error || !data) {
    return Response.json({ error: 'Failed to sign URL' }, { status: 500 });
  }

  return Response.redirect(data.signedUrl, 302);
}
