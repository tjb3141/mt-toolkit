import { error, redirect } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = url.searchParams.get('session');
	if (!sessionId) throw error(400, 'session required');

	const admin = createClient(PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY ?? '');

	const { data: session } = await admin
		.from('sessions')
		.select('id')
		.eq('id', sessionId)
		.neq('playback_state', 'ended')
		.gt('expires_at', new Date().toISOString())
		.maybeSingle();

	if (!session) throw error(403, 'Invalid or expired session');

	const { data: track } = await admin
		.from('tracks')
		.select('storage_path')
		.eq('id', params.trackId)
		.single();

	if (!track) throw error(404, 'Track not found');

	const { data, error: signErr } = await admin.storage
		.from('tracks')
		.createSignedUrl(track.storage_path, 7200);

	if (signErr || !data) throw error(500, 'Failed to sign URL');

	return redirect(302, data.signedUrl);
};
