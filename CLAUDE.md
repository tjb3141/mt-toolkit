# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Kahoot-style session-based "silent disco" web app for a therapy/wellness context. Riley (the host) creates a session; clients join on mobile browsers via a 6-character code. Each client picks a music playlist and listens through their own headphones. Riley controls the experience for all clients simultaneously via Supabase Realtime.

Live URL: `https://mt-toolkit.vercel.app`
GitHub: `https://github.com/tjb3141/mt-toolkit`
Supabase project: `https://ouxfgdbpdkykovbsifbr.supabase.co`

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | SvelteKit 2 + TypeScript + Tailwind CSS 4 |
| Runtime | Svelte 5 runes mode (enforced in `svelte.config.js`) |
| Deployment | Vercel — auto-deploys on push to `main` |
| Database + Realtime | Supabase (Postgres + Realtime channels) |
| File storage | Supabase Storage (`tracks` bucket, **private**) |
| Local utilities | Python 3 + yt-dlp + ffmpeg + FastAPI/uvicorn + Playwright |

## Development commands

```bash
npm run dev          # start dev server
npm run build        # production build
npm run check        # svelte-check + tsc
npm run lint         # prettier + eslint
npm run format       # prettier --write
```

```bash
# Local utility server (downloads YouTube playlists to local_utils/downloads/)
cd local_utils
.\venv\Scripts\activate   # Windows
uvicorn app:app --reload --port 8765
# then open http://localhost:8765

# Playwright helpers — join a live session with fake clients
python test_silent_disco.py ABC123
python test_partners.py ABC123
python test_imposter.py ABC123
python test_freeze_dance.py ABC123
# optional: python test_*.py ABC123 http://localhost:5173 [client_count]
```

## Architecture

### Route structure

```
/                        → join screen (6-char code entry) + host link
/host                    → mode picker, creates session, redirects to /host/[code]
/host/[code]             → host view — delegates entirely to mode's HostControls component
/join/[code]             → client view — delegates entirely to mode's ClientView component
/admin                   → library management + active session control (secret-gated)
/api/audio/[trackId]     → server: validates session, returns 302 → signed storage URL
/admin/sessions          → GET: list active sessions (admin auth)
/admin/sessions/[id]     → DELETE: end session (admin auth)
/admin/playlists         → POST: create playlist
/admin/playlists/[id]    → PATCH/DELETE: rename/delete playlist
/admin/tracks            → POST: register uploaded track
/admin/tracks/[id]       → PATCH/DELETE: rename/delete track
/admin/sign-upload       → POST: get signed upload URL for Supabase Storage
```

Note: `/admin/genres/*` routes also exist as aliases but the DB table is `playlists`.

### Mode system

`src/lib/modes/index.ts` is the registry. Each mode exports a `ClientView` and `HostControls` Svelte component. Adding a new mode = add an entry to `modes`, create the two components. The host and join pages dynamically render whichever component corresponds to the session's `mode` column.

**Current modes:**
- `silent_disco` — client picks playlist, shuffles tracks, host plays/pauses all
- `partners` — clients are paired; each pair hears the same track and must find each other
- `imposter` — one client hears a different track; others must identify them; host picks town + imposter playlists
- `freeze_dance` — host picks a playlist, a random track plays for all; host play/pauses; clients who move when paused are marked out; last one standing wins

### Phase pattern (multi-phase modes)

Imposter, partners, and freeze_dance all use a `localPhase` state variable (`'lobby' | 'setup' | 'playing' | 'ended'` etc.) rather than relying solely on `session.playback_state`. On mount they always start at `'lobby'`, then call a `loadLatestRound` / `loadCurrentRoundState` function which checks the DB and bumps `localPhase` to `'playing'` if a round is already in progress. This handles mid-session page reloads.

### Realtime pattern

Host writes to the `sessions` row → Supabase Realtime `postgres_changes` broadcasts to all subscribers → each client reacts. For freeze_dance, the sequence on `startRound` is:
1. DELETE eliminations for session
2. INSERT into `freeze_dance_rounds`
3. UPDATE `sessions.playback_state = 'paused'`

Clients subscribe to both `freeze_dance_rounds` INSERT (to load the new track) and `sessions` UPDATE (to play/pause audio). Order matters: rounds INSERT fires before sessions UPDATE so the track is loaded before play is called.

Tables with `REPLICA IDENTITY FULL` (needed for DELETE events to carry old row data): `partners_pairs`, `freeze_dance_eliminations`.

### Audio security

The `tracks` bucket is **private**. Audio is never served via public URLs. Flow:
1. Client sets `audioEl.src = /api/audio/${trackId}?session=${sessionId}`
2. Server validates the session is active and not expired
3. Server generates a 2-hour Supabase signed URL and returns HTTP 302
4. Browser follows redirect; audio streams from Supabase Storage

Play/pause is `audioEl.play()` / `audioEl.pause()` — resumes position, never resets `src`. `src` is only reassigned when `trackId` changes (i.e. a new round starts).

### Admin authentication

All `/admin/*` server routes use `process.env.ADMIN_SECRET` (not `$env/static/private` — that fails at Vercel build time with rolldown if the var isn't in `.env.local`). The secret is passed as `x-admin-secret` request header. The `/admin` page reaches it via a hidden 7-tap gesture on the "MT Toolkit" label.

### Session lifecycle

Sessions expire after 2 hours (`expires_at = now() + 2h`, set at creation). A pg_cron job in Supabase marks expired sessions `ended` every 5 minutes. Active sessions can also be ended manually from `/admin`. Clients subscribe to session updates and show an "ended" screen when `playback_state = 'ended'`.

`playback_state` has a DB check constraint: `playing | paused | ended` only.

## Database schema

```
sessions               — id, code (6-char), mode, playback_state (playing|paused|ended), created_at, expires_at
playlists              — id, name, display_order
tracks                 — id, playlist_id, title, storage_path, duration_seconds
participants           — id, session_id, name, playlist_id, current_track, joined_at
partners_pairs         — id, session_id, participant_1_id, participant_2_id, track_id, found
imposter_rounds        — id, session_id, round, town_playlist_id, imposter_playlist_id, imposter_participant_id, town_track_id, imposter_track_id
freeze_dance_rounds    — id, session_id, round, track_id, created_at
freeze_dance_eliminations — id, session_id, participant_id, created_at
```

RLS is open-read on all tables (no client auth). Sessions allow anonymous insert/update. Admin operations use the service role key server-side, bypassing RLS.

## Environment variables

**SvelteKit / Vercel** (`.env.local` + Vercel dashboard):
- `PUBLIC_SUPABASE_URL` — Supabase project URL
- `PUBLIC_SUPABASE_ANON_KEY` — public anon key
- `ADMIN_SECRET` — admin gate password (server-only, via `process.env`)
- `SUPABASE_SERVICE_KEY` — service role key (server-only, via `process.env`)

**Local utilities** (`local_utils/.env`, never committed):
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `YOUTUBE_COOKIES_FILE` — optional path to cookies file for age-restricted content

## Svelte 5 conventions

- Reactive variables: `$state()` — plain `let` is not reactive
- Derived values: `$derived()` — not `$:`
- Read state without tracking: `untrack(() => someState)`
- `$state(() => fn)` stores the function itself — use a ternary or IIFE for computed initial values
- Supabase query builders are **lazy** — always `await` them or call `.then()`, or they never execute

## Key decisions

- **No native app** — web-only
- **No YouTube IFrame at runtime** — extracted MP3s only; no ads or foreground requirement
- **No crossfade** — hard cuts between tracks
- **Per-client shuffle** — each client hears tracks in their own random order (silent disco mode)
- **Riley is the only host** — no multi-host auth
- **Private storage bucket + signed URLs** — audio URLs expire after 2 hours; leaked URLs are useless after that
- **`playlists` is the DB table** — the word "genre" may appear in old code/routes as an alias but the canonical term and table name is `playlists`, FK column is `playlist_id`
