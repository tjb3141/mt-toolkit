import { adminClient, checkAuth } from '@/lib/supabase-server';

export async function PATCH(request: Request, { id }: { id: string }) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const { title } = await request.json();
  if (!title?.trim()) {
    return Response.json({ error: 'title required' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('tracks')
    .update({ title: title.trim() })
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

  const { data: track } = await admin
    .from('tracks')
    .select('storage_path')
    .eq('id', id)
    .single();

  if (track) {
    await admin.storage.from('tracks').remove([track.storage_path]);
  }

  await admin.from('partners_pairs').update({ track_id: null }).eq('track_id', id);
  await admin.from('imposter_rounds').update({ town_track_id: null }).eq('town_track_id', id);
  await admin.from('imposter_rounds').update({ imposter_track_id: null }).eq('imposter_track_id', id);

  const { error } = await admin.from('tracks').delete().eq('id', id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
