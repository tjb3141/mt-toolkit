-- silent_disco_rounds: one row per host-queued track for the session.
-- All participants hear the same track in sync; host advances by inserting a new row.
create table if not exists silent_disco_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  round integer not null,
  track_id uuid not null references tracks(id),
  created_at timestamptz not null default now(),
  unique (session_id, round)
);

alter table silent_disco_rounds enable row level security;
create policy "open read" on silent_disco_rounds for select using (true);
create policy "anon insert" on silent_disco_rounds for insert with check (true);

-- Realtime: clients subscribe to INSERT to know a new track was queued
alter publication supabase_realtime add table silent_disco_rounds;
