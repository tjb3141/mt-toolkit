import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => {
	const provided = request.headers.get('x-admin-secret') ?? '';
	const stored = process.env.ADMIN_SECRET ?? '';
	return json({
		storedLength: stored.length,
		storedSet: stored.length > 0,
		providedLength: provided.length,
		match: provided === stored
	});
};
