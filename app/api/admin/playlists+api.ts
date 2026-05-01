import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();
  const { name } = await request.json();
  if (!name?.trim()) {
    return Response.json({ error: 'name required' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('playlists')
    .insert({ name: name.trim(), display_order: 0 })
    .select('id, name, display_order')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
