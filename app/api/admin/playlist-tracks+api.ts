import { adminClient, checkAuth } from '@/lib/supabase-server';

// POST: assign a track to a playlist
export async function POST(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const { playlist_id, track_id } = await request.json();
  if (!playlist_id || !track_id) {
    return Response.json({ error: 'playlist_id and track_id required' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('playlist_tracks')
    .upsert({ playlist_id, track_id }, { onConflict: 'playlist_id,track_id' });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE: remove a track from a playlist
export async function DELETE(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const { playlist_id, track_id } = await request.json();
  if (!playlist_id || !track_id) {
    return Response.json({ error: 'playlist_id and track_id required' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlist_id)
    .eq('track_id', track_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
