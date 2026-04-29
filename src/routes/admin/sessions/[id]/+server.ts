import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

function checkAuth(request: Request) {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) throw error(401, 'Unauthorized');
}

export const DELETE: RequestHandler = async ({ request, params }) => {
	checkAuth(request);
	const admin = createClient(PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY ?? '');

	const { error: err } = await admin
		.from('sessions')
		.update({ playback_state: 'ended' })
		.eq('id', params.id);

	if (err) throw error(500, err.message);
	return json({ ok: true });
};
