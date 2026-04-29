import { json, error } from '@sveltejs/kit';
import { ADMIN_SECRET, GITHUB_TOKEN, GITHUB_REPO } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { secret, genre, playlist_url } = await request.json();

	if (secret !== ADMIN_SECRET) {
		throw error(401, 'Unauthorized');
	}

	if (!genre?.trim() || !playlist_url?.trim()) {
		throw error(400, 'genre and playlist_url are required');
	}

	const res = await fetch(
		`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/ingest.yml/dispatches`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${GITHUB_TOKEN}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				ref: 'main',
				inputs: { genre: genre.trim(), playlist_url: playlist_url.trim() }
			})
		}
	);

	if (!res.ok) {
		const text = await res.text();
		throw error(502, `GitHub API error: ${res.status} ${text}`);
	}

	return json({ ok: true });
};
