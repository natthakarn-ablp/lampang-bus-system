#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lampang Bus System - production readiness gate runner
#
# Modes:
#   local       - run local pre-deploy checks in a developer/worktree checkout
#   public      - run external public-surface checks from any machine
#   production  - run read-only production checks on the server
#   postdeploy  - run production checks and require runtime commit evidence
#
# Default mode is local. Production/postdeploy modes never write production DB.
# Restore-drill execution remains a separate, explicit operator action.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-${MODE:-local}}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"
TMP_DIR="${TMPDIR:-/tmp}"
TMP_BODY="$TMP_DIR/lampang-readiness-gate-body.$$"
TMP_HEALTH_BODY="$TMP_DIR/lampang-readiness-gate-health.$$"
TMP_BACKEND_AUDIT="$TMP_DIR/lampang-backend-audit.$$"
TMP_FRONTEND_AUDIT="$TMP_DIR/lampang-frontend-audit.$$"

PASS=0
WARN=0
FAIL=0
SKIP=0

cleanup() {
  rm -f "$TMP_BODY" "$TMP_HEALTH_BODY" "$TMP_BACKEND_AUDIT" "$TMP_FRONTEND_AUDIT" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pass() { echo "[pass] $*"; PASS=$((PASS + 1)); }
warn() { echo "[warn] $*"; WARN=$((WARN + 1)); }
fail() { echo "[fail] $*"; FAIL=$((FAIL + 1)); }
skip() { echo "[skip] $*"; SKIP=$((SKIP + 1)); }

run_check() {
  local label="$1"
  shift
  echo "[gate] $label"
  if "$@"; then
    pass "$label"
  else
    fail "$label"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

check_http() {
  local label="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local body="${5:-}"
  local code
  local args=(-sS --max-time 10 -o "$TMP_BODY" -w "%{http_code}" -X "$method")
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  code="$(curl "${args[@]}" "$BASE_URL$path" 2>/dev/null || echo "curl_error")"
  if [ "$code" = "$expected" ]; then
    pass "$label ($code)"
  else
    fail "$label expected=$expected actual=$code"
  fi
}

check_health_body() {
  if ! need_cmd curl; then
    fail "curl is required for HTTP checks"
    return
  fi
  local code
  code="$(curl -sS --max-time 10 -o "$TMP_HEALTH_BODY" -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "curl_error")"
  if [ "$code" != "200" ]; then
    fail "health endpoint expected=200 actual=$code"
    return
  fi
  if grep -q '"success":true' "$TMP_HEALTH_BODY" && grep -q '"connected":true' "$TMP_HEALTH_BODY"; then
    pass "health success=true and database connected=true"
  else
    fail "health body missing success=true or database.connected=true"
  fi
}

check_health_commit_match() {
  if [ ! -f "$TMP_HEALTH_BODY" ]; then
    HEALTH_COMMIT_MESSAGE="health body unavailable for commit comparison"
    return 2
  fi
  local health_commit
  local git_head
  health_commit="$(grep -oE '"commit":"[^"]*"' "$TMP_HEALTH_BODY" | head -1 | cut -d'"' -f4 || true)"
  git_head="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  if [ -z "$health_commit" ]; then
    HEALTH_COMMIT_MESSAGE="health.data.commit missing"
    return 1
  elif [ -z "$git_head" ]; then
    HEALTH_COMMIT_MESSAGE="git HEAD unavailable; health commit=$health_commit"
    return 2
  elif [ "$health_commit" = "$git_head" ]; then
    HEALTH_COMMIT_MESSAGE="health.data.commit matches git HEAD ($health_commit)"
    return 0
  else
    HEALTH_COMMIT_MESSAGE="health.data.commit=$health_commit differs from git HEAD=$git_head"
    return 1
  fi
}

check_health_commit_optional() {
  check_health_commit_match
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "$HEALTH_COMMIT_MESSAGE"
  else
    warn "$HEALTH_COMMIT_MESSAGE"
  fi
}

check_health_commit_required() {
  check_health_commit_match
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "$HEALTH_COMMIT_MESSAGE"
  else
    fail "$HEALTH_COMMIT_MESSAGE"
  fi
}

check_offhost_log_latest() {
  local backup_dir="${BACKUP_DIR:-/home/schoolbus/backups/lampang-bus}"
  local log_file="${OFFHOST_SYNC_LOG:-/home/schoolbus/logs/offhost-sync.log}"
  local latest
  latest="$(ls -1t "$backup_dir"/lampang_bus_*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] || return 1
  [ -f "$log_file" ] || return 1
  grep -F "$(basename "$latest")" "$log_file" >/dev/null 2>&1
}

check_git_clean() {
  if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "not a git worktree"
    return 0
  fi
  [ -z "$(git -C "$ROOT" status --porcelain)" ]
}

run_local_mode() {
  echo "[gate] mode=local root=$ROOT"
  run_check "backend unit tests" bash -c "cd '$ROOT/backend' && npm run test:unit"
  run_check "backend npm audit" bash -c "cd '$ROOT/backend' && npm audit --json >'$TMP_BACKEND_AUDIT'"
  run_check "frontend npm audit" bash -c "cd '$ROOT/frontend' && npm audit --json >'$TMP_FRONTEND_AUDIT'"
  run_check "frontend production build" bash -c "cd '$ROOT/frontend' && npm run build"
  run_check "frontend UI labels" bash -c "cd '$ROOT/frontend' && npm run check:labels"
  run_check "frontend hybrid UI guard" bash -c "cd '$ROOT/frontend' && npm run check:hybrid-ui"
  run_check "git diff whitespace check" git -C "$ROOT" diff --check
  run_check "shell syntax: health-check" bash -n "$ROOT/scripts/health-check.sh"
  run_check "shell syntax: offhost checker" bash -n "$ROOT/scripts/check-offhost-backup-config.sh"
  run_check "shell syntax: restore readiness" bash -n "$ROOT/scripts/restore-test-readiness.sh"
  run_check "shell syntax: restore drill" bash -n "$ROOT/scripts/restore-drill-db.sh"
  run_check "shell syntax: readiness gate" bash -n "$ROOT/scripts/production-readiness-gate.sh"
}

run_public_mode() {
  echo "[gate] mode=public base=$BASE_URL"
  if ! need_cmd curl; then
    fail "curl is required"
    return
  fi
  check_http "public root returns HTTP 200" GET "/" 200
  check_http "auth/me without token returns HTTP 401" GET "/api/auth/me" 401
  check_http "reports require authentication" GET "/api/reports/monthly" 401
  check_http "parent page loads" GET "/parent" 200
  check_http "parent link page loads" GET "/parent/link" 200
}

run_production_mode() {
  echo "[gate] mode=$MODE root=$ROOT base=$BASE_URL"
  if ! need_cmd curl; then
    fail "curl is required"
  else
    check_health_body
    check_http "public root returns HTTP 200" GET "/" 200
    check_http "auth/me without token returns HTTP 401" GET "/api/auth/me" 401
    check_http "reports require authentication" GET "/api/reports/monthly" 401
    check_http "parent page loads" GET "/parent" 200
    check_http "parent link page loads" GET "/parent/link" 200
  fi

  run_check "deployed git worktree clean" check_git_clean
  run_check "health-check monitor" "$ROOT/scripts/health-check.sh"
  run_check "latest backup verification" "$ROOT/scripts/verify-latest-backup.sh"
  run_check "off-host backup checker (read-only)" bash -c "OFFHOST_CHECK_READ_ONLY=true '$ROOT/scripts/check-offhost-backup-config.sh'"
  run_check "off-host sync log contains latest backup" check_offhost_log_latest
  run_check "restore-test readiness (forced read-only)" bash -c "RESTORE_TEST_FORCE_READ_ONLY=true '$ROOT/scripts/restore-test-readiness.sh'"

  if [ "$MODE" = "postdeploy" ]; then
    check_health_commit_required
  else
    check_health_commit_optional
  fi
}

case "$MODE" in
  local)
    run_local_mode
    ;;
  public)
    run_public_mode
    ;;
  production|postdeploy)
    run_production_mode
    ;;
  *)
    echo "Usage: $0 [local|public|production|postdeploy]" >&2
    exit 2
    ;;
esac

echo "[gate] summary pass=$PASS warn=$WARN fail=$FAIL skip=$SKIP"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
