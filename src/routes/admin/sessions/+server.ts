import { json, error } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

function adminClient() {
	return createClient(PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY ?? '');
}

function checkAuth(request: Request) {
	const adminSecret = process.env.ADMIN_SECRET ?? '';
	if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) throw error(401, 'Unauthorized');
}

export const GET: RequestHandler = async ({ request }) => {
	checkAuth(request);
	const admin = adminClient();

	const { data: sessions, error: err } = await admin
		.from('sessions')
		.select('id, code, mode, playback_state, created_at, expires_at')
		.neq('playback_state', 'ended')
		.order('created_at', { ascending: false });

	if (err) throw error(500, err.message);

	const withCounts = await Promise.all(
		(sessions ?? []).map(async (s) => {
			const { count } = await admin
				.from('participants')
				.select('id', { count: 'exact', head: true })
				.eq('session_id', s.id);
			return { ...s, participant_count: count ?? 0 };
		})
	);

	return json(withCounts);
};
