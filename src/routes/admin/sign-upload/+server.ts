import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
	const admin = createClient(PUBLIC_SUPABASE_URL, serviceKey);

	const { secret, genre, filename } = await request.json();

	if (!adminSecret || secret !== adminSecret) throw error(401, 'Unauthorized');
	if (!genre?.trim() || !filename?.trim()) throw error(400, 'genre and filename required');

	const slug = genre.trim().toLowerCase().replace(/\s+/g, '_');
	const path = `${slug}/${crypto.randomUUID()}.mp3`;

	const { data, error: err } = await admin.storage.from('tracks').createSignedUploadUrl(path);
	if (err) throw error(500, err.message);

	return json({ path, signedUrl: data.signedUrl, token: data.token });
};
