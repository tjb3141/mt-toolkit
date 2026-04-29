import { json, error } from '@sveltejs/kit';
import { ADMIN_SECRET, SUPABASE_SERVICE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const POST: RequestHandler = async ({ request }) => {
	const { secret, genre, filename } = await request.json();

	if (secret !== ADMIN_SECRET) throw error(401, 'Unauthorized');
	if (!genre?.trim() || !filename?.trim()) throw error(400, 'genre and filename required');

	const slug = genre.trim().toLowerCase().replace(/\s+/g, '_');
	const path = `${slug}/${crypto.randomUUID()}.mp3`;

	const { data, error: err } = await admin.storage.from('tracks').createSignedUploadUrl(path);
	if (err) throw error(500, err.message);

	return json({ path, signedUrl: data.signedUrl, token: data.token });
};
