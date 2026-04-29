import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

function adminClient() {
	const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
	return createClient(PUBLIC_SUPABASE_URL, serviceKey);
}

function checkAuth(request: Request) {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) throw error(401, 'Unauthorized');
}

export const PATCH: RequestHandler = async ({ request, params }) => {
	checkAuth(request);
	const { title } = await request.json();
	if (!title?.trim()) throw error(400, 'title required');

	const { error: err } = await adminClient().from('tracks').update({ title: title.trim() }).eq('id', params.id);
	if (err) throw error(500, err.message);

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	checkAuth(request);

	const admin = adminClient();

	const { data: track } = await admin
		.from('tracks')
		.select('storage_path')
		.eq('id', params.id)
		.single();

	if (track) {
		await admin.storage.from('tracks').remove([track.storage_path]);
	}

	const { error: err } = await admin.from('tracks').delete().eq('id', params.id);
	if (err) throw error(500, err.message);

	return json({ ok: true });
};
