import { supabase } from '$lib/supabase';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const { data: session } = await supabase
		.from('sessions')
		.select('*')
		.eq('code', params.code.toUpperCase())
		.gt('expires_at', new Date().toISOString())
		.maybeSingle();

	if (!session) throw redirect(303, '/?error=invalid');

	return { session };
};
