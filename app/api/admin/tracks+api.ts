import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const admin = adminClient();
  const { playlist_name, title, storage_path, duration_seconds } = await request.json();

  const { data: track, error: tErr } = await admin
    .from('tracks')
    .insert({ title, storage_path, duration_seconds })
    .select('id')
    .single();

  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });

  if (playlist_name?.trim()) {
    const { data: existing } = await admin
      .from('playlists')
      .select('id')
      .eq('name', playlist_name.trim())
      .maybeSingle();

    let playlist_id = existing?.id;

    if (!playlist_id) {
      const { data: created, error: gErr } = await admin
        .from('playlists')
        .insert({ name: playlist_name.trim(), display_order: 0 })
        .select('id')
        .single();
      if (gErr) return Response.json({ error: gErr.message }, { status: 500 });
      playlist_id = created.id;
    }

    const { error: ptErr } = await admin
      .from('playlist_tracks')
      .upsert({ playlist_id, track_id: track.id }, { onConflict: 'playlist_id,track_id' });

    if (ptErr) return Response.json({ error: ptErr.message }, { status: 500 });

    return Response.json({ ok: true, id: track.id, playlist_id });
  }

  return Response.json({ ok: true, id: track.id });
}
