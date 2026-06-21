#!/usr/bin/env bash
#
# VM-side deploy script for the Maestro Azure box.
#
# Triggered by the GitHub Actions workflow (.github/workflows/deploy.yml) on every
# push to main: it pulls the latest code, installs deps, rebuilds backend + frontend,
# and restarts the backend service. Safe to run by hand too:
#
#   bash /opt/maestro/scripts/deploy.sh
#
# Assumes:
#   - /opt/maestro is a git checkout tracking origin/main (public repo, no creds)
#   - .env, data/, node_modules/ are gitignored and therefore preserved across pulls
#   - azureuser has passwordless sudo for `systemctl restart maestro-backend`
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/maestro}
SERVICE=${SERVICE:-maestro-backend}
# Building Chromium for puppeteer on every deploy is slow and unnecessary here.
export PUPPETEER_SKIP_DOWNLOAD=1
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

echo "[deploy] $(date -Is) starting"
cd "$APP_DIR"

echo "[deploy] fetching origin/main"
git fetch --prune origin main
git reset --hard origin/main
echo "[deploy] now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

echo "[deploy] backend: install + build"
npm --prefix backend install --no-audit --no-fund
# tsc currently emits valid JS despite some pre-existing HeyGen/video type warnings,
# so a non-zero tsc exit must not abort the deploy. We verify the emit below instead.
npm --prefix backend run build || echo "[deploy] tsc reported type errors; JS emitted, continuing"
test -f backend/dist/server.js || { echo "[deploy] FATAL: backend/dist/server.js missing after build"; exit 1; }

echo "[deploy] frontend: install + build"
npm --prefix frontend install --no-audit --no-fund
npm --prefix frontend run build
test -f frontend/dist/index.html || { echo "[deploy] FATAL: frontend/dist/index.html missing after build"; exit 1; }

echo "[deploy] restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 5
if systemctl is-active --quiet "$SERVICE"; then
  echo "[deploy] $SERVICE active"
else
  echo "[deploy] FATAL: $SERVICE not active after restart"
  sudo systemctl status "$SERVICE" --no-pager -l | tail -n 20 || true
  exit 1
fi

echo "[deploy] health check"
curl -fsS http://127.0.0.1:3001/api/health || { echo "[deploy] FATAL: health check failed"; exit 1; }
echo
echo "[deploy] $(date -Is) done"
