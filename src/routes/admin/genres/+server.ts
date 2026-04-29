import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
	const admin = createClient(PUBLIC_SUPABASE_URL, serviceKey);

	if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) throw error(401, 'Unauthorized');
	const { name } = await request.json();
	if (!name?.trim()) throw error(400, 'name required');

	const { data, error: err } = await admin
		.from('genres')
		.insert({ name: name.trim(), display_order: 0 })
		.select('id, name, display_order')
		.single();
	if (err) throw error(500, err.message);

	return json(data);
};
