-- freeze_dance_rounds: one row per round, one track for the whole session
create table if not exists freeze_dance_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  round integer not null,
  track_id uuid not null references tracks(id),
  created_at timestamptz not null default now(),
  unique (session_id, round)
);

alter table freeze_dance_rounds enable row level security;
create policy "open read" on freeze_dance_rounds for select using (true);
create policy "anon insert" on freeze_dance_rounds for insert with check (true);

-- Realtime: clients subscribe to INSERT to know a new round started
alter publication supabase_realtime add table freeze_dance_rounds;

-- freeze_dance_eliminations: one row per eliminated participant per session
-- Deleted (all rows for session) on round reset; re-inserted as host marks people out
create table if not exists freeze_dance_eliminations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, participant_id)
);

alter table freeze_dance_eliminations enable row level security;
create policy "open read" on freeze_dance_eliminations for select using (true);
create policy "anon insert" on freeze_dance_eliminations for insert with check (true);
create policy "anon delete" on freeze_dance_eliminations for delete using (true);

-- REPLICA IDENTITY FULL so DELETE events carry the old row (needed for client-side filtering)
alter table freeze_dance_eliminations replica identity full;

alter publication supabase_realtime add table freeze_dance_eliminations;
