# Hosting on the Pi

Self-hosted alternative to EAS Hosting. Runs the Expo server build on the
Raspberry Pi, fronted by Caddy and exposed publicly via the existing
Cloudflare tunnel at `mt-toolkit.thebeacheshome.com`.

Supabase (Postgres / Realtime / Storage) stays managed — only the
frontend bundle and API routes move to the Pi.

## One-time Pi setup

SSH into the Pi (`ssh pi@10.0.0.42`), then:

```bash
git clone https://github.com/tjb3141/mt-toolkit.git ~/mt-toolkit
cd ~/mt-toolkit
bash deploy/install-pi.sh
```

The first run stops after creating `.env` from `.env.example`. Edit it:

```bash
nano ~/mt-toolkit/.env
```

Fill in `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_KEY`, and `ADMIN_SECRET`. Same values you currently
have in EAS secrets — grab them from the Supabase dashboard and your
Vercel/EAS env if you've forgotten.

Then re-run `bash deploy/install-pi.sh`. This time it installs deps,
builds, and starts both the Node server and Caddy.

## Cloudflare tunnel + DNS

**1. DNS** — in the Cloudflare dashboard for `thebeacheshome.com`, add a
CNAME record:

```
Name:    mt-toolkit
Target:  <your-tunnel-id>.cfargotunnel.com
Proxied: yes (orange cloud)
```

If you set up the tunnel via the Zero Trust dashboard, you can do this
automatically by adding a public hostname to the tunnel — that creates
the CNAME for you.

**2. Tunnel ingress** — add a public hostname / ingress rule:

```
Subdomain: mt-toolkit
Domain:    thebeacheshome.com
Service:   http://localhost:80
```

If you're editing `~/.cloudflared/config.yml` by hand, that's:

```yaml
ingress:
  - hostname: mt-toolkit.thebeacheshome.com
    service: http://localhost:80
  # …existing rules below
  - service: http_status:404
```

Then `sudo systemctl restart cloudflared` (or whatever you used to
register the tunnel).

That's it. Caddy serves the static client bundle and reverse-proxies
`/api/*` and `/_expo/*` to the Node server on `127.0.0.1:3000`.

## Updating

After pushing changes to GitHub:

```bash
ssh pi@10.0.0.42 'bash ~/mt-toolkit/deploy/deploy.sh'
```

That pulls, installs, builds, and restarts the service.

## Service management

```bash
sudo systemctl status mt-toolkit       # is it running?
sudo systemctl restart mt-toolkit      # restart after env change
journalctl -u mt-toolkit -f            # tail logs
sudo systemctl reload caddy            # after editing /etc/caddy/Caddyfile
```

## Files

| Path | Purpose |
|------|---------|
| `deploy/server.mjs` | Node entry — runs `@expo/server` against `dist/` |
| `deploy/Caddyfile` | Reverse proxy config — copied to `/etc/caddy/Caddyfile` |
| `deploy/mt-toolkit.service` | systemd unit — copied to `/etc/systemd/system/` |
| `deploy/install-pi.sh` | First-time setup |
| `deploy/deploy.sh` | Re-run to deploy updates |
| `.env.example` | Template; copy to `.env` on the Pi |

## Troubleshooting

**App returns 502 from Caddy** — Node server isn't running. Check
`systemctl status mt-toolkit` and `journalctl -u mt-toolkit -e`.

**API routes 404** — Caddy is serving `/api/*` as a static path instead
of proxying. Check `/etc/caddy/Caddyfile` matches `deploy/Caddyfile`,
then `sudo systemctl reload caddy`.

**Audio won't play** — same as before: signed-URL endpoint
(`/api/audio/[trackId]`) needs `SUPABASE_SERVICE_KEY` set in `.env`.
Confirm with `curl http://localhost:3000/api/audio/SOME_TRACK_ID?session=SOME_SESSION`.

**Realtime disconnects** — Cloudflare tunnel handles WebSockets fine,
but make sure you didn't add `cf-no-websocket` flags. Realtime goes
direct to Supabase, not through the Pi.
