import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
	const admin = createClient(PUBLIC_SUPABASE_URL, serviceKey);

	if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) throw error(401, 'Unauthorized');
	const { playlist_name, title, storage_path, duration_seconds } = await request.json();

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
		if (gErr) throw error(500, gErr.message);
		playlist_id = created.id;
	}

	const { data: track, error: tErr } = await admin
		.from('tracks')
		.insert({ playlist_id, title, storage_path, duration_seconds })
		.select('id')
		.single();
	if (tErr) throw error(500, tErr.message);

	return json({ ok: true, id: track.id, playlist_id });
};
