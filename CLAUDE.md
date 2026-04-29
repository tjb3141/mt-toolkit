# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Kahoot-style session-based "silent disco" web app for a therapy/wellness context. Riley (the host) creates a session; clients join on mobile browsers via a 6-character code. Each client picks a music genre and listens through their own headphones. Riley controls master play/pause for all clients simultaneously via Supabase Realtime.

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

# Manual browser helpers for a live session
python test_partners.py ABC123
python test_silent_disco.py ABC123
```

## Architecture

### Route structure

```
/                        → join screen (6-char code entry) + host link
/host                    → mode picker, creates session, redirects to /host/[code]
/host/[code]             → host view — QR, play/pause, mode-specific controls
/join/[code]             → client view — name entry, then mode-specific UI
/admin                   → library management + active session control (secret-gated)
/api/audio/[trackId]     → server: validates session, returns 302 → signed storage URL
/admin/sessions          → GET: list active sessions (admin auth)
/admin/sessions/[id]     → DELETE: end session (admin auth)
/admin/genres            → POST: create genre
/admin/genres/[id]       → PATCH/DELETE: rename/delete genre
/admin/tracks            → POST: register uploaded track
/admin/tracks/[id]       → PATCH/DELETE: rename/delete track
/admin/sign-upload       → POST: get signed upload URL for Supabase Storage
```

### Mode system

`src/lib/modes/index.ts` is the registry. Each mode exports a `ClientView` and `HostControls` Svelte component. Adding a new mode = add an entry to `modes`, create the two components. The host and join pages dynamically render whichever component corresponds to the session's `mode` column.

**Current modes:**
- `silent_disco` — client picks genre, shuffles tracks, host plays/pauses all
- `partners` — clients are paired; each pair hears the same track and must find each other

### Realtime pattern

Host writes `playback_state` to the `sessions` row → Supabase Realtime postgres_changes broadcasts to all subscribers → each client's handler calls `audio.play()` or `audio.pause()`. The `partners_pairs` table also has Realtime + `REPLICA IDENTITY FULL` so clients can filter updates by pair ID.

### Audio security

The `tracks` bucket is **private**. Audio is never served via public URLs. Flow:
1. Client sets `audioEl.src = /api/audio/${trackId}?session=${sessionId}`
2. Server validates the session is active and not expired
3. Server generates a 2-hour Supabase signed URL and returns HTTP 302
4. Browser follows redirect; audio streams from Supabase Storage

### Admin authentication

All `/admin/*` server routes use `process.env.ADMIN_SECRET` (not `$env/static/private` — that fails at Vercel build time with rolldown if the var isn't in `.env.local`). The secret is passed as `x-admin-secret` request header. The `/admin` page reaches it via a hidden 7-tap gesture on the "MT Toolkit" label.

### Session lifecycle

Sessions expire after 2 hours (`expires_at = now() + 2h`, set at creation). A pg_cron job in Supabase marks expired sessions `ended` every 5 minutes. Active sessions can also be ended manually from `/admin`. Clients subscribe to session updates and show an "ended" screen when `playback_state = 'ended'`.

## Database schema

```
sessions       — id, code (6-char), mode, playback_state (playing|paused|ended), created_at, expires_at
genres         — id, name, display_order
tracks         — id, genre_id, title, storage_path, duration_seconds
participants   — id, session_id, name, genre_id, current_track
partners_pairs — id, session_id, participant_1_id, participant_2_id, track_id, found
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
- **Per-client shuffle** — each client hears tracks in their own random order
- **Riley is the only host** — no multi-host auth
- **Private storage bucket + signed URLs** — audio URLs expire after 2 hours; leaked URLs are useless after that
