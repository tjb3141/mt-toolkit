# Silent Disco — CLAUDE.md

useless text

## What this project is

A Kahoot-style session-based "silent disco" web app for a therapy/wellness context. Riley (the host) creates a session; patients/clients join on their own mobile browsers via a 6-character code or QR code. Each client picks a music genre, listens through their own headphones, and controls their own volume. Riley controls master play/pause for all clients simultaneously via Supabase Realtime.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | SvelteKit + TypeScript + Tailwind CSS (Svelte 5 runes mode) |
| Deployment | Vercel (auto-deploys on push to `main`) |
| Database + Realtime | Supabase (Postgres + Realtime channels) |
| File storage | Supabase Storage (`tracks` bucket) |
| Music pipeline | Python 3 script using yt-dlp + ffmpeg (run locally) |

Live URL: `https://mt-toolkit.vercel.app`
GitHub: `https://github.com/tjb3141/mt-toolkit`
Supabase project: `https://ouxfgdbpdkykovbsifbr.supabase.co`

## Project structure

```
/
├── src/
│   ├── lib/
│   │   └── supabase.ts        # Supabase client (uses PUBLIC_ env vars)
│   └── routes/
│       ├── +layout.svelte
│       └── +page.svelte       # Placeholder, will become home/entry screen
├── ingestion/
│   ├── ingest.py              # Python script: YouTube → MP3 → Supabase Storage
│   ├── requirements.txt       # yt-dlp, requests
│   ├── venv/                  # Python venv (gitignored)
│   ├── .env                   # SUPABASE_URL + SUPABASE_SERVICE_KEY (gitignored)
│   └── .env.example           # Placeholder template
├── supabase/
│   └── schema.sql             # Full DB schema (run once in Supabase SQL editor)
├── .env.local                 # PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_ANON_KEY (gitignored)
└── .env.example               # Placeholder template
```

## Database schema

Three tables in Supabase:

- **`sessions`** — `id, code (6-char unique), playback_state (playing|paused|ended), created_at, expires_at`
- **`genres`** — `id, name, display_order` — static config, curated manually
- **`tracks`** — `id, genre_id, title, storage_path, duration_seconds` — populated by ingestion script

RLS is enabled on all tables with open read policies (no auth required for clients). Sessions also allow insert/update by anyone. Realtime is enabled on the `sessions` table.

## Environment variables

**SvelteKit app** (`.env.local`, also set in Vercel dashboard):
- `PUBLIC_SUPABASE_URL` — Supabase project URL
- `PUBLIC_SUPABASE_ANON_KEY` — public anon key (safe to expose)

**Ingestion script** (`ingestion/.env`, never committed):
- `SUPABASE_URL` — same Supabase project URL
- `SUPABASE_SERVICE_KEY` — service role key (admin access, keep secret)

## Svelte conventions

- Project runs in **Svelte 5 runes mode** (enforced in `svelte.config.js`)
- Use `$state()` for reactive variables — plain `let` is not reactive in runes mode
- Use `$derived()` instead of `$:` reactive statements
- Import Supabase client as `import { supabase } from '$lib/supabase'`
- Import env vars as `import { PUBLIC_SUPABASE_URL } from '$env/static/public'`

## Music / ingestion pipeline

- Music source: YouTube (extracted offline, not streamed at runtime)
- Tool: `yt-dlp` + `ffmpeg` — download audio, convert to 128kbps MP3
- Upload: to Supabase Storage bucket `tracks`, path `{genre}/{uuid}.mp3`
- Runtime: plain HTML5 `<audio>` element streaming from Supabase Storage URLs
- No YouTube at runtime — no ads, no foreground requirement, no IFrame

**To run the ingestion script:**
```
cd ingestion
.\venv\Scripts\activate        # Windows
python ingest.py "Genre Name" https://youtu.be/VIDEO_ID
```
Requires ffmpeg on PATH and `ingestion/.env` with credentials.

## Planned app routes

- `/` or `/join` — client entry: enter session code
- `/join/[code]` — client session: genre picker + audio player
- `/host` — Riley's host view: create session, see code/QR, play/pause control

## Realtime sync pattern

Host writes `playback_state` to the `sessions` row → Supabase Realtime broadcasts to all subscribers → each client's JS handler calls `audio.play()` or `audio.pause()` on their local HTML5 audio element. Target latency: under 1 second, which is easily achievable with this pattern.

## Key decisions (don't relitigate without reason)

- **No native app** — web-only, clients stay in browser the whole session
- **No YouTube IFrame at runtime** — extracted MP3s only
- **No crossfade** — hard cuts between tracks for v1
- **Per-client shuffle** — each client hears tracks in their own random order
- **Riley is the only host** — no multi-host auth for now
- **Supabase anon key in frontend** — intentional, it's the public key designed for this
- **Service role key only in ingestion script** — never in frontend or committed files
