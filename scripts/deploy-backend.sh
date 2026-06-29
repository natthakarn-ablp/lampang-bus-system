#!/usr/bin/env bash
# Safe backend deploy script for schoolbus project.
# Phase 10.15B — validates syntax and unit tests before reloading PM2,
# so a broken code change cannot take the backend down.
set -euo pipefail

PROJECT_DIR=/home/schoolbus/apps/lampang-bus-system
BACKEND_DIR=$PROJECT_DIR/backend
ECOSYSTEM=$PROJECT_DIR/ecosystem.config.js
APP_NAME=schoolbus-backend

echo "[deploy] Pulling latest code..."
cd $PROJECT_DIR
git pull origin $(git branch --show-current) || true

echo "[deploy] Running backend syntax checks..."
cd $BACKEND_DIR
for f in $(find src -name '*.js' -not -path '*/node_modules/*'); do
  node -c "$f" || { echo "[deploy] Syntax error in $f"; exit 1; }
done
echo "[deploy] All backend JS files pass syntax check"

echo "[deploy] Running unit tests..."
npx jest --config jest.unit.config.js --runInBand --forceExit || { echo "[deploy] Unit tests failed"; exit 1; }

echo "[deploy] Reloading PM2..."
pm2 reload $ECOSYSTEM

echo "[deploy] Waiting for health check..."
for i in {1..12}; do
  if curl -fs http://localhost:3000/health >/dev/null 2>&1; then
    echo "[deploy] Health check OK"
    exit 0
  fi
  sleep 2
done

echo "[deploy] Health check failed after reload — status:"
pm2 describe $APP_NAME
exit 1
