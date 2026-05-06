#!/usr/bin/env bash
# Re-run on the Pi to pick up new commits.
#   bash deploy/deploy.sh
#
# Aborts if the working tree is dirty or has unpushed commits, so a
# forgotten `git push` can't cause us to deploy stale code from origin.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/tyler/mt-toolkit}"
cd "$APP_DIR"

echo "==> Checking git state"
git fetch --quiet origin

if ! git diff-index --quiet HEAD --; then
	echo "ERROR: working tree has uncommitted changes. Commit or stash first." >&2
	git status --short >&2
	exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
ahead="$(git rev-list --count "origin/${branch}..HEAD")"
if [ "$ahead" -gt 0 ]; then
	echo "ERROR: local ${branch} is ${ahead} commit(s) ahead of origin/${branch}." >&2
	echo "       Push first, otherwise deploy would pull older code from origin." >&2
	exit 1
fi

echo "==> Pulling latest"
git pull --ff-only

echo "==> Installing deps + building"
npm install
npm run build

echo "==> Restarting service"
sudo systemctl restart mt-toolkit

echo "==> Done. Tail logs with: journalctl -u mt-toolkit -f"
