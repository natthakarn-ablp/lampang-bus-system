#!/usr/bin/env bash
# Safe backend deploy script for schoolbus project.
# Phase 10.15B — validates syntax and unit tests before reloading PM2,
# so a broken code change cannot take the backend down.
#
# 2026-09-05 (deploy record docs/ops/deploy-2026-09-05-c0b0d49.md §6): the
# pull used to be `git pull … || true`, so a failed pull let the script
# "deploy" whatever was already checked out and report success. Now the
# script fetches, requires a real branch (and the expected one when
# EXPECTED_BRANCH is set), refuses a dirty worktree, fast-forwards only,
# stops on any failure BEFORE touching PM2, installs dependencies only when
# the lockfile moved, and records before/after commits so the deploy history
# says what actually changed.
#
# Every path and command below can be overridden by environment for an
# isolated test run (backend/tests/deployBackendScript.unit.test.js drives
# this against a throwaway repository with stub pm2/npx/npm/curl on PATH).
# The defaults are the production server's.
#
# Usage:  bash scripts/deploy-backend.sh
# Env:    PROJECT_DIR, BACKEND_DIR, ECOSYSTEM, APP_NAME, DEPLOY_REMOTE,
#         EXPECTED_BRANCH, HEALTH_URL, DEPLOY_LOG, DEPLOY_INSTALL=auto|always|never
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/schoolbus/apps/lampang-bus-system}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_DIR/backend}"
ECOSYSTEM="${ECOSYSTEM:-$PROJECT_DIR/ecosystem.config.js}"
APP_NAME="${APP_NAME:-schoolbus-backend}"
REMOTE="${DEPLOY_REMOTE:-origin}"
EXPECTED_BRANCH="${EXPECTED_BRANCH:-}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"
# Outside the checkout on purpose: a log inside it would be an untracked file
# in the deployed tree. /home/schoolbus/logs is where the other logs live.
DEPLOY_LOG="${DEPLOY_LOG:-$(dirname "$(dirname "$PROJECT_DIR")")/logs/deploy-history.log}"
DEPLOY_INSTALL="${DEPLOY_INSTALL:-auto}"

fail() { echo "[deploy] ABORT: $*" >&2; exit 1; }
now() { date -Is; }

[ -d "$PROJECT_DIR" ] || fail "project dir not found: $PROJECT_DIR"
[ -d "$BACKEND_DIR" ] || fail "backend dir not found: $BACKEND_DIR"
cd "$PROJECT_DIR"

# ── 1. Which branch, and is the tree clean ───────────────────────────────────
BRANCH="$(git symbolic-ref --short -q HEAD || true)"
[ -n "$BRANCH" ] || fail "detached HEAD — check out the deploy branch first"
if [ -n "$EXPECTED_BRANCH" ] && [ "$BRANCH" != "$EXPECTED_BRANCH" ]; then
  fail "on branch '$BRANCH' but EXPECTED_BRANCH='$EXPECTED_BRANCH'"
fi
# Modified or staged TRACKED files block the deploy: a fast-forward over them
# would either fail or silently carry a server-side edit into the release.
# Untracked files (a dist backup, a log) are reported but do not block —
# the first run of this script stopped on its own backup directory.
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | head -10 >&2
  fail "worktree has modified tracked files — a deploy must start from the committed tree (see above)"
fi
UNTRACKED="$(git status --porcelain --untracked-files=normal | grep '^??' || true)"
[ -z "$UNTRACKED" ] || echo "[deploy] note: untracked files present (not blocking): $(echo "$UNTRACKED" | sed 's/^?? //' | tr '\n' ' ')"
BEFORE="$(git rev-parse --short HEAD)"
echo "[deploy] branch=$BRANCH before=$BEFORE remote=$REMOTE"

# ── 2. Fetch and fast-forward; any failure stops here, PM2 untouched ────────
echo "[deploy] Fetching $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH" || fail "git fetch failed — nothing was deployed (still at $BEFORE)"
TARGET="$(git rev-parse --short FETCH_HEAD)"
if ! git merge --ff-only FETCH_HEAD; then
  fail "cannot fast-forward $BEFORE -> $TARGET (local commits or a diverged branch) — resolve by hand; still at $BEFORE"
fi
AFTER="$(git rev-parse --short HEAD)"
if [ "$AFTER" = "$BEFORE" ]; then
  echo "[deploy] already up to date at $AFTER (re-running checks and reload)"
else
  echo "[deploy] fast-forwarded $BEFORE -> $AFTER"
fi
{
  mkdir -p "$(dirname "$DEPLOY_LOG")" && echo "$(now) branch=$BRANCH before=$BEFORE after=$AFTER by=$(whoami)" >> "$DEPLOY_LOG"
} || echo "[deploy] WARNING: could not append to $DEPLOY_LOG"
echo "[deploy] rollback reference: previous commit was $BEFORE (recorded in $DEPLOY_LOG)"

# ── 3. Dependencies, only when the lockfile moved (or DEPLOY_INSTALL=always) ─
cd "$BACKEND_DIR"
LOCK_CHANGED=0
if [ "$AFTER" != "$BEFORE" ] && ! git diff --quiet "$BEFORE" "$AFTER" -- package.json package-lock.json; then
  LOCK_CHANGED=1
fi
case "$DEPLOY_INSTALL" in
  always) DO_INSTALL=1 ;;
  never)  DO_INSTALL=0 ;;
  auto)   DO_INSTALL=$LOCK_CHANGED ;;
  *) fail "DEPLOY_INSTALL must be auto, always or never (got '$DEPLOY_INSTALL')" ;;
esac
if [ "$DO_INSTALL" -eq 1 ]; then
  echo "[deploy] Installing backend dependencies (npm ci) — lockfile changed or DEPLOY_INSTALL=$DEPLOY_INSTALL..."
  npm ci || fail "npm ci failed — PM2 not reloaded; code is at $AFTER, previous $BEFORE"
else
  echo "[deploy] Dependencies unchanged since $BEFORE; skipping npm ci"
fi

# ── 4. Syntax check every source file ────────────────────────────────────────
echo "[deploy] Running backend syntax checks..."
while IFS= read -r -d '' f; do
  node -c "$f" || fail "syntax error in $f — PM2 not reloaded"
done < <(find src -name '*.js' -not -path '*/node_modules/*' -print0)
echo "[deploy] All backend JS files pass syntax check"

# ── 5. Unit tests (DB-free) ──────────────────────────────────────────────────
echo "[deploy] Running unit tests..."
npx jest --config jest.unit.config.js --runInBand --forceExit || fail "unit tests failed — PM2 not reloaded; code is at $AFTER, previous $BEFORE"

# ── 6. Reload, then prove it answers ────────────────────────────────────────
echo "[deploy] Reloading PM2..."
pm2 reload "$ECOSYSTEM" || fail "pm2 reload failed — check 'pm2 describe $APP_NAME'"

echo "[deploy] Waiting for health check..."
for i in {1..12}; do
  if curl -fs "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[deploy] Health check OK — running $AFTER (was $BEFORE)"
    exit 0
  fi
  sleep 2
done

echo "[deploy] Health check failed after reload — status:" >&2
pm2 describe "$APP_NAME" || true
echo "[deploy] previous commit was $BEFORE — roll back by checking it out, then: pm2 reload \"$ECOSYSTEM\"" >&2
exit 1
