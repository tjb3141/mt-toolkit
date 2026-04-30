-- Sessions: created by Riley (host), joined by clients
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  mode text not null default 'silent_disco',
  playback_state text not null default 'paused' check (playback_state in ('playing', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

-- Playlists: curated by Riley, static config
create table playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null default 0
);

-- Tracks: populated by local utility scripts and the admin UI
create table tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  title text not null,
  storage_path text not null,
  duration_seconds integer
);

-- Allow anyone to read sessions, playlists, and tracks (clients join without auth)
alter table sessions enable row level security;
alter table playlists enable row level security;
alter table tracks enable row level security;

create policy "sessions readable by all" on sessions for select using (true);
create policy "sessions insertable by all" on sessions for insert with check (true);
create policy "sessions updatable by all" on sessions for update using (true);

create policy "playlists readable by all" on playlists for select using (true);

create policy "tracks readable by all" on tracks for select using (true);

-- Enable realtime for sessions table
alter publication supabase_realtime add table sessions;

-- Make tracks bucket publicly readable (required for HTML5 audio src)
update storage.buckets set public = true where id = 'tracks';

-- Participants: clients who join a session
create table participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  playlist_id uuid references playlists(id),
  joined_at timestamptz not null default now()
);

alter table participants enable row level security;
create policy "participants readable by all" on participants for select using (true);
create policy "participants insertable by all" on participants for insert with check (true);
create policy "participants updatable by all" on participants for update using (true);

alter publication supabase_realtime add table participants;

-- Migration: add current_track column
-- alter table participants add column if not exists current_track text;

-- Partners pairs: one row per pair per game round
create table partners_pairs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_1_id uuid not null references participants(id),
  participant_2_id uuid not null references participants(id),
  track_id uuid references tracks(id),
  found boolean not null default false,
  created_at timestamptz not null default now()
);
alter table partners_pairs enable row level security;
create policy "partners_pairs readable by all" on partners_pairs for select using (true);
create policy "partners_pairs insertable by all" on partners_pairs for insert with check (true);
create policy "partners_pairs updatable by all" on partners_pairs for update using (true);
create policy "partners_pairs deletable by all" on partners_pairs for delete using (true);
alter publication supabase_realtime add table partners_pairs;
alter table partners_pairs replica identity full;

-- Auto-expire sessions after 2 hours via pg_cron (run once in Supabase SQL editor)
-- Requires pg_cron extension to be enabled in the Supabase dashboard first:
--   Dashboard → Database → Extensions → pg_cron → Enable
--
-- select cron.schedule(
--   'expire-old-sessions',
--   '*/5 * * * *',
--   $$
--     update public.sessions
--     set playback_state = 'ended'
--     where playback_state <> 'ended'
--       and expires_at < now();
--   $$
-- );

-- Make the tracks storage bucket private (run once in Supabase SQL editor):
-- update storage.buckets set public = false where name = 'tracks';
