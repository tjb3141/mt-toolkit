#!/usr/bin/env bash
# Re-run on the Pi to pick up new commits.
#   bash deploy/deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/home/pi/mt-toolkit}"
cd "$APP_DIR"

echo "==> Pulling latest"
git pull --ff-only

echo "==> Installing deps + building"
npm install
npm run build

echo "==> Restarting service"
sudo systemctl restart mt-toolkit

echo "==> Done. Tail logs with: journalctl -u mt-toolkit -f"
