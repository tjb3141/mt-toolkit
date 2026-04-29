import { json, error } from '@sveltejs/kit';
import { ADMIN_SECRET, SUPABASE_SERVICE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const POST: RequestHandler = async ({ request }) => {
	const { secret, genre_name, title, storage_path, duration_seconds } = await request.json();

	if (secret !== ADMIN_SECRET) throw error(401, 'Unauthorized');

	const { data: existing } = await admin
		.from('genres')
		.select('id')
		.eq('name', genre_name.trim())
		.maybeSingle();

	let genre_id = existing?.id;

	if (!genre_id) {
		const { data: created, error: gErr } = await admin
			.from('genres')
			.insert({ name: genre_name.trim(), display_order: 0 })
			.select('id')
			.single();
		if (gErr) throw error(500, gErr.message);
		genre_id = created.id;
	}

	const { error: tErr } = await admin.from('tracks').insert({
		genre_id,
		title,
		storage_path,
		duration_seconds
	});
	if (tErr) throw error(500, tErr.message);

	return json({ ok: true });
};
