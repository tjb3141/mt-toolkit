import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function PATCH(request: Request, { id }: { id: string }) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!body.name?.trim()) return Response.json({ error: 'name required' }, { status: 400 });
    updates.name = body.name.trim();
  }
  if (body.display_order !== undefined) {
    updates.display_order = body.display_order;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('playlists')
    .update(updates)
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { id }: { id: string }) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();

  const { data: tracks } = await admin
    .from('tracks')
    .select('id, storage_path')
    .eq('playlist_id', id);

  if (tracks && tracks.length > 0) {
    const trackIds = tracks.map((t) => t.id);
    await admin.from('freeze_dance_rounds').delete().in('track_id', trackIds);
    await admin.from('partners_pairs').update({ track_id: null }).in('track_id', trackIds);
    await admin.from('tracks').delete().in('id', trackIds);
    await admin.storage.from('tracks').remove(tracks.map((t) => t.storage_path));
  }

  await admin.from('participants').update({ playlist_id: null }).eq('playlist_id', id);
  await admin.from('imposter_rounds').delete().or(`town_playlist_id.eq.${id},imposter_playlist_id.eq.${id}`);

  const { error } = await admin.from('playlists').delete().eq('id', id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
