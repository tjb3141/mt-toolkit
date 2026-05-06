#!/usr/bin/env bash
# One-time setup on the Pi. Run as the `pi` user:
#   curl -sL https://raw.githubusercontent.com/tjb3141/mt-toolkit/main/deploy/install-pi.sh | bash
# or after cloning:
#   bash deploy/install-pi.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tjb3141/mt-toolkit.git}"
APP_DIR="${APP_DIR:-/home/pi/mt-toolkit}"
NODE_MAJOR=20

echo "==> Installing system packages"
sudo apt-get update
sudo apt-get install -y curl ca-certificates git

echo "==> Installing Node ${NODE_MAJOR} (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
	curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
	sudo apt-get install -y nodejs
fi

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null; then
	sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
	sudo apt-get update
	sudo apt-get install -y caddy
fi

echo "==> Cloning / updating repo at ${APP_DIR}"
if [ ! -d "$APP_DIR/.git" ]; then
	git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
git pull --ff-only

if [ ! -f "$APP_DIR/.env" ]; then
	echo "==> Creating .env from .env.example (you must edit this with real secrets)"
	cp "$APP_DIR/.env.example" "$APP_DIR/.env"
	chmod 600 "$APP_DIR/.env"
	echo "    Edit $APP_DIR/.env now, then re-run this script."
	exit 0
fi

echo "==> Installing npm deps and building"
npm install
npm run build

echo "==> Installing systemd unit"
sudo cp "$APP_DIR/deploy/mt-toolkit.service" /etc/systemd/system/mt-toolkit.service
sudo systemctl daemon-reload
sudo systemctl enable mt-toolkit
sudo systemctl restart mt-toolkit

echo "==> Installing Caddyfile"
sudo cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo systemctl reload caddy || sudo systemctl restart caddy

echo
echo "==> Done."
echo "    App:   http://127.0.0.1:3000   (systemctl status mt-toolkit)"
echo "    Caddy: http://127.0.0.1:80     (systemctl status caddy)"
echo
echo "Point your Cloudflare tunnel at http://127.0.0.1:80 to publish at thebeacheshome.com."
