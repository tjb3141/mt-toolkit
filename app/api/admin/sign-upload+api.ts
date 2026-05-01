import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();
  const { playlist, filename } = await request.json();
  if (!playlist?.trim() || !filename?.trim()) {
    return Response.json({ error: 'playlist and filename required' }, { status: 400 });
  }

  const slug = playlist.trim().toLowerCase().replace(/\s+/g, '_');
  const path = `${slug}/${crypto.randomUUID()}.mp3`;

  const { data, error } = await admin.storage
    .from('tracks')
    .createSignedUploadUrl(path);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ path, signedUrl: data.signedUrl, token: data.token });
}
