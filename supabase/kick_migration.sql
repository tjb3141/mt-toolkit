-- DELETE policies needed for the host "kick participant" flow.
-- Without these, anon-role DELETEs silently affect 0 rows under RLS.
create policy "participants deletable by all" on public.participants for delete using (true);
create policy "imposter_rounds deletable by all" on public.imposter_rounds for delete using (true);
