import { createClient } from '@supabase/supabase-js';

export function adminClient() {
  const url = process.env.PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
  return createClient(url, serviceKey);
}

export function checkAuth(request: Request): Response | null {
  const adminSecret = process.env.ADMIN_SECRET ?? '';
  if (!adminSecret || request.headers.get('x-admin-secret') !== adminSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
