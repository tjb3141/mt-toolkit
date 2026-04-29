-- Sessions: created by Riley (host), joined by clients
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  mode text not null default 'silent_disco',
  playback_state text not null default 'paused' check (playback_state in ('playing', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours'
);

-- Genres: curated by Riley, static config
create table genres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null default 0
);

-- Tracks: populated by the Python ingestion script
create table tracks (
  id uuid primary key default gen_random_uuid(),
  genre_id uuid not null references genres(id) on delete cascade,
  title text not null,
  storage_path text not null,
  duration_seconds integer
);

-- Allow anyone to read sessions, genres, and tracks (clients join without auth)
alter table sessions enable row level security;
alter table genres enable row level security;
alter table tracks enable row level security;

create policy "sessions readable by all" on sessions for select using (true);
create policy "sessions insertable by all" on sessions for insert with check (true);
create policy "sessions updatable by all" on sessions for update using (true);

create policy "genres readable by all" on genres for select using (true);

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
  genre_id uuid references genres(id),
  joined_at timestamptz not null default now()
);

alter table participants enable row level security;
create policy "participants readable by all" on participants for select using (true);
create policy "participants insertable by all" on participants for insert with check (true);
create policy "participants updatable by all" on participants for update using (true);

alter publication supabase_realtime add table participants;
