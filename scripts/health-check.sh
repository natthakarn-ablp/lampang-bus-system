#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Production Health & Backup Monitor
#
# Lightweight smoke check intended for cron (every 5 minutes).
# Verifies:
#   - /health endpoint returns success=true with DB connected
#   - latest backup exists, is fresh, and sha256 verifies
#   - disk usage below threshold
#   - PM2 app + logrotate module online
#
# Exit code:
#   0  — all critical checks pass
#   1  — at least one critical check failed
#
# Optional env:
#   HEALTH_URL=http://127.0.0.1:3000/health
#   BACKUP_DIR=/home/schoolbus/backups/lampang-bus
#   BACKUP_GLOB=lampang_bus_*.sql.gz
#   BACKUP_MAX_AGE_HOURS=36
#   DISK_THRESHOLD=85
#   DISK_MOUNT=/
# ─────────────────────────────────────────────────────────────
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
BACKUP_DIR="${BACKUP_DIR:-/home/schoolbus/backups/lampang-bus}"
BACKUP_GLOB="${BACKUP_GLOB:-lampang_bus_*.sql.gz}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
DISK_MOUNT="${DISK_MOUNT:-/}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

TS="$(date -Iseconds)"
EXIT_CODE=0
WARN_COUNT=0
FAIL_COUNT=0

emit_ok()   { echo "[ok]   $*"; }
emit_warn() { echo "[warn] $*"; WARN_COUNT=$((WARN_COUNT+1)); }
emit_fail() { echo "[fail] $*"; FAIL_COUNT=$((FAIL_COUNT+1)); EXIT_CODE=1; }

echo "[health-check] $TS start"

# 1. /health endpoint
HEALTH_BODY="$(curl -sS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
if [ -z "$HEALTH_BODY" ]; then
  emit_fail "health endpoint unreachable: $HEALTH_URL"
else
  if echo "$HEALTH_BODY" | grep -q '"success":true'; then
    emit_ok "health endpoint success=true"
  else
    emit_fail "health endpoint success!=true"
  fi
  HEALTH_COMMIT="$(echo "$HEALTH_BODY" | grep -oE '"commit":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  if [ -n "$HEALTH_COMMIT" ]; then
    GIT_HEAD="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
    if [ -n "$GIT_HEAD" ]; then
      if [ "$HEALTH_COMMIT" = "$GIT_HEAD" ]; then
        emit_ok "health commit=$HEALTH_COMMIT matches git HEAD"
      else
        emit_warn "health commit=$HEALTH_COMMIT differs from git HEAD=$GIT_HEAD"
      fi
    else
      emit_ok "health commit=$HEALTH_COMMIT (git HEAD unavailable)"
    fi
  else
    emit_warn "health commit not reported"
  fi
  if echo "$HEALTH_BODY" | grep -q '"connected":true'; then
    emit_ok "database connected=true"
  else
    emit_fail "database connected!=true"
  fi
fi

# 2. Backup freshness
if [ ! -d "$BACKUP_DIR" ]; then
  emit_fail "backup directory missing: $BACKUP_DIR"
else
  LATEST="$(ls -1t "$BACKUP_DIR"/$BACKUP_GLOB 2>/dev/null | head -1 || true)"
  if [ -z "$LATEST" ]; then
    emit_fail "no backup files matching $BACKUP_GLOB in $BACKUP_DIR"
  else
    AGE_SEC=$(( $(date +%s) - $(stat -c %Y "$LATEST") ))
    AGE_H=$(( AGE_SEC / 3600 ))
    if [ "$AGE_H" -le "$BACKUP_MAX_AGE_HOURS" ]; then
      emit_ok "backup age=${AGE_H}h (<=${BACKUP_MAX_AGE_HOURS}h)  $(basename "$LATEST")"
    else
      emit_fail "backup age=${AGE_H}h (>${BACKUP_MAX_AGE_HOURS}h)  $(basename "$LATEST")"
    fi

    # 3. Backup checksum
    SUMFILE="${LATEST}.sha256"
    if [ -f "$SUMFILE" ]; then
      if ( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$SUMFILE")" >/dev/null 2>&1 ); then
        emit_ok "backup sha256 verifies"
      else
        emit_fail "backup sha256 MISMATCH"
      fi
    else
      emit_warn "backup checksum sidecar missing"
    fi
  fi
fi

# 4. Disk usage
DISK_USE_PCT="$(df -P "$DISK_MOUNT" | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [ -z "$DISK_USE_PCT" ]; then
  emit_warn "could not read disk usage for $DISK_MOUNT"
else
  if [ "$DISK_USE_PCT" -lt "$DISK_THRESHOLD" ]; then
    emit_ok "disk $DISK_MOUNT use=${DISK_USE_PCT}% (<${DISK_THRESHOLD}%)"
  else
    emit_fail "disk $DISK_MOUNT use=${DISK_USE_PCT}% (>=${DISK_THRESHOLD}%)"
  fi
fi

# 5. PM2 backend
if command -v pm2 >/dev/null 2>&1; then
  PM2_JSON="$(pm2 jlist 2>/dev/null || echo '[]')"
  BACKEND_STATUS="$(echo "$PM2_JSON" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  try {
    const j = JSON.parse(d);
    const p = j.find(x => x.name === 'schoolbus-backend');
    process.stdout.write(p ? p.pm2_env.status : 'missing');
  } catch (e) { process.stdout.write('parse_error'); }
});" 2>/dev/null || echo 'unknown')"
  if [ "$BACKEND_STATUS" = "online" ]; then
    emit_ok "pm2 schoolbus-backend=online"
  else
    emit_fail "pm2 schoolbus-backend=$BACKEND_STATUS"
  fi
  LOGROTATE_STATUS="$(echo "$PM2_JSON" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  try {
    const j = JSON.parse(d);
    const p = j.find(x => x.name === 'pm2-logrotate');
    process.stdout.write(p ? p.pm2_env.status : 'missing');
  } catch (e) { process.stdout.write('parse_error'); }
});" 2>/dev/null || echo 'unknown')"
  if [ "$LOGROTATE_STATUS" = "online" ]; then
    emit_ok "pm2 pm2-logrotate=online"
  elif [ "$LOGROTATE_STATUS" = "missing" ]; then
    emit_warn "pm2 pm2-logrotate=missing"
  else
    emit_warn "pm2 pm2-logrotate=$LOGROTATE_STATUS"
  fi
else
  emit_warn "pm2 binary not found in PATH"
fi

echo "[health-check] $(date -Iseconds) done  warn=$WARN_COUNT  fail=$FAIL_COUNT  exit=$EXIT_CODE"
exit "$EXIT_CODE"
