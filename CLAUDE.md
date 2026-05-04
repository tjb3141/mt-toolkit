# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Kahoot-style session-based "silent disco" app for a therapy/wellness context. Riley (the host) creates a session; clients join on mobile via a 6-character code. Each client picks a music playlist and listens through their own headphones. Riley controls the experience for all clients simultaneously via Supabase Realtime.

GitHub: `https://github.com/tjb3141/mt-toolkit`
Supabase project: `https://ouxfgdbpdkykovbsifbr.supabase.co`
EAS project ID: `f57a9cac-eef7-4747-a989-57e86f0d0149`

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native + Expo Router (file-based, `app/` directory) |
| Styling | NativeWind (Tailwind) for layout; `StyleSheet.create()` + `expo-linear-gradient` for visual styling |
| Deployment | EAS Build (iOS/Android), EAS Hosting (web) |
| Database + Realtime | Supabase (Postgres + Realtime channels) |
| File storage | Supabase Storage (`tracks` bucket, **private**) |
| Audio | `expo-audio` — `createAudioPlayer`, `player.play/pause/remove()` |
| Local utilities | Python 3 + yt-dlp + ffmpeg + FastAPI/uvicorn + Playwright |

## Development commands

```bash
npm run dev          # expo start --web
npm run start        # expo start (all platforms)
npm run ios          # expo start --ios
npm run android      # expo start --android
npm run build        # expo export --platform web
npm run ts:check     # tsc --noEmit
```

```bash
# EAS builds
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest build -p android --profile production
npx eas-cli@latest build -p ios --profile development   # for Expo Go / dev client

# EAS web hosting
npx expo export -p web
npx eas-cli@latest deploy --prod
```

```bash
# Local utility server (downloads YouTube playlists to local_utils/downloads/)
cd local_utils
.\venv\Scripts\activate   # Windows
uvicorn app:app --reload --port 8765
# then open http://mt-toolkit.expo.app/:8765

# Playwright helpers — join a live session with fake clients
python test_silent_disco.py ABC123
python test_partners.py ABC123
python test_imposter.py ABC123
python test_freeze_dance.py ABC123
# optional: python test_*.py ABC123 http://mt-toolkit.expo.app/:8081 [client_count]
```

## Architecture

### Route structure

Expo Router file-based routing under `app/`:

```
app/index.tsx                      → join screen (6-char code entry) + host link
app/host/index.tsx                 → mode picker, creates session, redirects to /host/[code]
app/host/[code].tsx                → host view — renders mode's HostControls component
app/join/[code].tsx                → client view — renders mode's ClientView component
app/admin/index.tsx                → library management + active session control (secret-gated)
app/api/audio/[trackId]+api.ts    → server: validates session, returns 302 → signed storage URL
app/api/admin/sessions+api.ts     → GET: list active sessions
app/api/admin/sessions/[id]+api.ts → DELETE: end session
app/api/admin/playlists+api.ts    → POST: create playlist
app/api/admin/playlists/[id]+api.ts → PATCH/DELETE: rename/delete playlist
app/api/admin/tracks+api.ts       → POST: register uploaded track
app/api/admin/tracks/[id]+api.ts  → PATCH/DELETE: rename/delete track
app/api/admin/sign-upload+api.ts  → POST: get signed upload URL for Supabase Storage
```

### Mode system

`lib/modes/index.ts` is the registry. Each mode exports a `ClientView` and `HostControls` React Native component. Adding a new mode = add an entry to `modes`, create the two components. The host and join pages dynamically render whichever component corresponds to the session's `mode` column.

**Current modes:**
- `silent_disco` — client picks playlist, shuffles tracks, host plays/pauses all
- `partners` — clients are paired; each pair hears the same track and must find each other
- `imposter` — one client hears a different track; others must identify them; host picks town + imposter playlists
- `freeze_dance` — host picks a playlist, a random track plays for all; host play/pauses; clients who move when paused are marked out; last one standing wins

### Shared UI primitives

`components/ui.tsx` exports all shared styled components: `Screen`, `Shell`, `Panel`, `PanelStrong`, `Kicker`, `Title`, `GlowButton`, `IconTile`, `HomeButton`, `EqBars`, `StyledInput`, `CyanBadge`, `ListRow`, `ErrorBox`, `EndLink`. Use these instead of CSS class names — NativeWind className strings don't work for box-shadow, backdrop-filter, gradients, or pseudo-elements on React Native Web.

### Styling rules

- Use `StyleSheet.create()` + inline styles for all visual styling (colors, shadows, gradients, borders)
- Use `expo-linear-gradient` for gradient backgrounds and buttons
- NativeWind `className` is acceptable for layout utilities (flex, gap, padding) but avoid it for visual properties
- `ScrollView` inside a `Screen` component must have `style={{ flex: 1 }}` so it fills the bounded viewport and scrolls on web

### Phase pattern (multi-phase modes)

Imposter, partners, and freeze_dance all use a `localPhase` state variable (`'lobby' | 'setup' | 'playing' | 'ended'` etc.) rather than relying solely on `session.playback_state`. On mount they always start at `'lobby'`, then call a `loadLatestRound` / `loadCurrentRoundState` function which checks the DB and bumps `localPhase` to `'playing'` if a round is already in progress. This handles mid-session page reloads.

### Realtime pattern

Host writes to the `sessions` row → Supabase Realtime `postgres_changes` broadcasts to all subscribers → each client reacts. For freeze_dance, the sequence on `startRound` is:
1. DELETE eliminations for session
2. INSERT into `freeze_dance_rounds`
3. UPDATE `sessions.playback_state = 'paused'`

Clients subscribe to both `freeze_dance_rounds` INSERT (to load the new track) and `sessions` UPDATE (to play/pause audio). Order matters: rounds INSERT fires before sessions UPDATE so the track is loaded before play is called.

Tables with `REPLICA IDENTITY FULL` (needed for DELETE events to carry old row data): `partners_pairs`, `freeze_dance_eliminations`.

### Audio

Uses `expo-audio` (SDK 54+). The `useAudioPlayer` hook lives at `hooks/useAudioPlayer.ts`.

```ts
import { createAudioPlayer } from 'expo-audio';
const player = createAudioPlayer({ uri });
player.loop = true;
player.addListener('playbackStatusUpdate', (status) => {
  if (status.didJustFinish && !player.loop) onEnd();
});
player.play();
player.pause();
player.remove(); // cleanup
```

### Audio security

The `tracks` bucket is **private**. Audio is never served via public URLs. Flow:
1. Client sets audio source to `/api/audio/${trackId}?session=${sessionId}`
2. Server validates the session is active and not expired
3. Server generates a 2-hour Supabase signed URL and returns HTTP 302
4. Client follows redirect; audio streams from Supabase Storage

The audio proxy is a server route (`+api.ts`) — it works on web but not in native Expo Go builds. Native builds will need a client-side signed URL strategy.

### Admin authentication

All `/api/admin/*` server routes check `process.env.ADMIN_SECRET` via the `x-admin-secret` request header. The `/admin` page is reached via a hidden 7-tap gesture on the "MT Toolkit" label.

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

**Expo / EAS** (`.env.local` + EAS secrets):
- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL (client-accessible)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — public anon key (client-accessible)
- `ADMIN_SECRET` — admin gate password (server-only, `process.env`)
- `SUPABASE_SERVICE_KEY` — service role key (server-only, `process.env`)

**Local utilities** (`local_utils/.env`, never committed):
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `YOUTUBE_COOKIES_FILE` — optional path to cookies file for age-restricted content

## Key decisions

- **React Native + Expo Router** — runs on iOS, Android, and web from one codebase
- **No YouTube IFrame at runtime** — extracted MP3s only; no ads or foreground requirement
- **No crossfade** — hard cuts between tracks
- **Per-client shuffle** — each client hears tracks in their own random order (silent disco mode)
- **Riley is the only host** — no multi-host auth
- **Private storage bucket + signed URLs** — audio URLs expire after 2 hours; leaked URLs are useless after that
- **`playlists` is the DB table** — the word "genre" may appear in old code as an alias but the canonical term and table name is `playlists`, FK column is `playlist_id`
