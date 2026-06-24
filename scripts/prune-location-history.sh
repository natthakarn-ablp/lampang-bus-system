#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lampang Bus System — Prune vehicle_location_history (Phase 11A)
#
# Purpose:  Delete GPS history rows older than LOCATION_HISTORY_RETENTION_DAYS
#           (default 30). Keeps the table bounded — at ~5 pings/min per active
#           vehicle the table grows ~132k rows/day, so pruning is essential.
#
#           Also prunes geofence_events older than the same window (they are
#           only useful for baseline learning within the window) and
#           eta_predictions for past dates.
#
#           route_baselines is NOT pruned — it is the learned summary and is
#           upserted in place by refresh-route-baselines.js.
#
# Usage:    bash scripts/prune-location-history.sh
#           bash scripts/prune-location-history.sh --dry-run
#
# Schedule (crontab -e):
#           15 3 * * *  bash /home/schoolbus/apps/lampang-bus-system/scripts/prune-location-history.sh >> \
#                       /home/schoolbus/logs/prune-history.log 2>&1
#
# Env:      LOCATION_HISTORY_RETENTION_DAYS (default 30)
#           DB credentials read from backend/.env via mysql defaults file
#
# Exit:     0  OK (or dry-run completed)
#           1  error
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
RETENTION_DAYS="${LOCATION_HISTORY_RETENTION_DAYS:-30}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Locate repo root (allow running from anywhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[prune-history] FAIL: backend/.env not found at $ENV_FILE" >&2
  exit 1
fi

# Parse DB credentials from .env (handles KEY=value and quoted values)
DB_NAME="$(grep -E '^DB_NAME='    "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"')"
DB_USER="$(grep -E '^DB_USER='    "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"')"
DB_PASS="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"')"
DB_HOST="$(grep -E '^DB_HOST='    "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"')"
DB_PORT="$(grep -E '^DB_PORT='    "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"')"
DB_PORT="${DB_PORT:-3306}"

if [[ -z "$DB_NAME" || -z "$DB_USER" ]]; then
  echo "[prune-history] FAIL: DB_NAME / DB_USER missing from .env" >&2
  exit 1
fi

# Build a temporary defaults file so the password never appears on the CLI.
MY_CNF="$(mktemp)"
trap 'rm -f "$MY_CNF"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
  "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASS" > "$MY_CNF"
chmod 600 "$MY_CNF"

MYSQL="mysql --defaults-file=$MY_CNF --database=$DB_NAME -N -B"

echo "[prune-history] retention=${RETENTION_DAYS}d dry_run=${DRY_RUN} db=${DB_NAME}"

# ── 1. vehicle_location_history ──────────────────────────────────────────────
# Batched DELETE (LIMIT 5000 per iteration) to avoid long table locks on prod
# — the first run after a long downtime could have millions of rows.
BATCH_SIZE=5000
COUNT_BEFORE_HIST="$($MYSQL -e "SELECT COUNT(*) FROM vehicle_location_history WHERE recorded_at < DATE_SUB(NOW(), INTERVAL $RETENTION_DAYS DAY);" 2>/dev/null || echo 0)"
echo "[prune-history] vehicle_location_history rows older than ${RETENTION_DAYS}d: ${COUNT_BEFORE_HIST}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[prune-history] DRY-RUN — would DELETE ${COUNT_BEFORE_HIST} rows from vehicle_location_history"
else
  DELETED_HIST=0
  while true; do
    AFFECTED="$($MYSQL -e "DELETE FROM vehicle_location_history WHERE recorded_at < DATE_SUB(NOW(), INTERVAL $RETENTION_DAYS DAY) LIMIT ${BATCH_SIZE}; SELECT ROW_COUNT();" 2>/dev/null | tail -1)"
    AFFECTED="${AFFECTED:-0}"
    DELETED_HIST=$((DELETED_HIST + AFFECTED))
    [[ "$AFFECTED" -lt "$BATCH_SIZE" ]] && break
    sleep 0.1  # yield between batches to reduce lock contention
  done
  echo "[prune-history] vehicle_location_history pruned (${DELETED_HIST} rows in batches of ${BATCH_SIZE})"
fi

# ── 2. geofence_events (same window) ─────────────────────────────────────────
COUNT_BEFORE_GFE="$($MYSQL -e "SELECT COUNT(*) FROM geofence_events WHERE occurred_at < DATE_SUB(NOW(), INTERVAL $RETENTION_DAYS DAY);" 2>/dev/null || echo 0)"
echo "[prune-history] geofence_events rows older than ${RETENTION_DAYS}d: ${COUNT_BEFORE_GFE}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[prune-history] DRY-RUN — would DELETE ${COUNT_BEFORE_GFE} rows from geofence_events"
else
  DELETED_GFE=0
  while true; do
    AFFECTED="$($MYSQL -e "DELETE FROM geofence_events WHERE occurred_at < DATE_SUB(NOW(), INTERVAL $RETENTION_DAYS DAY) LIMIT ${BATCH_SIZE}; SELECT ROW_COUNT();" 2>/dev/null | tail -1)"
    AFFECTED="${AFFECTED:-0}"
    DELETED_GFE=$((DELETED_GFE + AFFECTED))
    [[ "$AFFECTED" -lt "$BATCH_SIZE" ]] && break
    sleep 0.1
  done
  echo "[prune-history] geofence_events pruned (${DELETED_GFE} rows in batches of ${BATCH_SIZE})"
fi

# ── 3. eta_predictions for past dates ────────────────────────────────────────
COUNT_BEFORE_ETA="$($MYSQL -e "SELECT COUNT(*) FROM eta_predictions WHERE eta_date < CURDATE();" 2>/dev/null || echo 0)"
echo "[prune-history] eta_predictions rows for past dates: ${COUNT_BEFORE_ETA}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[prune-history] DRY-RUN — would DELETE ${COUNT_BEFORE_ETA} rows from eta_predictions"
else
  DELETED_ETA=0
  while true; do
    AFFECTED="$($MYSQL -e "DELETE FROM eta_predictions WHERE eta_date < CURDATE() LIMIT ${BATCH_SIZE}; SELECT ROW_COUNT();" 2>/dev/null | tail -1)"
    AFFECTED="${AFFECTED:-0}"
    DELETED_ETA=$((DELETED_ETA + AFFECTED))
    [[ "$AFFECTED" -lt "$BATCH_SIZE" ]] && break
    sleep 0.1
  done
  echo "[prune-history] eta_predictions pruned (${DELETED_ETA} rows in batches of ${BATCH_SIZE})"
fi

# ── 4. route_deviations resolved > 90 days ago (audit retention) ─────────────
COUNT_BEFORE_DEV="$($MYSQL -e "SELECT COUNT(*) FROM route_deviations WHERE resolved_at IS NOT NULL AND resolved_at < DATE_SUB(NOW(), INTERVAL 90 DAY);" 2>/dev/null || echo 0)"
echo "[prune-history] route_deviations resolved > 90d: ${COUNT_BEFORE_DEV}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[prune-history] DRY-RUN — would DELETE ${COUNT_BEFORE_DEV} rows from route_deviations"
else
  DELETED_DEV=0
  while true; do
    AFFECTED="$($MYSQL -e "DELETE FROM route_deviations WHERE resolved_at IS NOT NULL AND resolved_at < DATE_SUB(NOW(), INTERVAL 90 DAY) LIMIT ${BATCH_SIZE}; SELECT ROW_COUNT();" 2>/dev/null | tail -1)"
    AFFECTED="${AFFECTED:-0}"
    DELETED_DEV=$((DELETED_DEV + AFFECTED))
    [[ "$AFFECTED" -lt "$BATCH_SIZE" ]] && break
    sleep 0.1
  done
  echo "[prune-history] route_deviations pruned (${DELETED_DEV} rows in batches of ${BATCH_SIZE})"
fi

echo "[prune-history] DONE"
exit 0
