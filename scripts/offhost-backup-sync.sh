#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Off-host Database Backup Sync
#
# Copies the *.sql.gz + *.sql.gz.sha256 artifacts from the local
# backup directory (/home/schoolbus/backups/lampang-bus) to an
# off-host destination configured via environment variables.
#
# Supported methods:
#   - rclone : OFFHOST_BACKUP_METHOD=rclone
#              OFFHOST_RCLONE_REMOTE=remote:path
#   - rsync  : OFFHOST_BACKUP_METHOD=rsync
#              OFFHOST_RSYNC_TARGET=user@host:/path
#              (optional)  OFFHOST_SSH_KEY=/home/schoolbus/.ssh/offhost_id_ed25519
#
# Config file (optional, not committed):
#   $APP_DIR/scripts/offhost-backup-sync.env
#   See scripts/offhost-backup-sync.env.example for the template.
#
# Usage:
#   ./scripts/offhost-backup-sync.sh           # real sync
#   DRY_RUN=1 ./scripts/offhost-backup-sync.sh # show what would happen
#
# Output:
#   - Logs to stdout/stderr (cron should redirect to offhost-sync.log)
#   - On success, writes /home/schoolbus/backups/lampang-bus/.last_offhost_sync
#     (timestamp marker for future health-check integration)
#
# Security:
#   - Uploads ONLY lampang_bus_*.sql.gz and lampang_bus_*.sql.gz.sha256
#   - Refuses to touch .env, *.log, .partial, or anything outside the
#     two include patterns. No secrets are read or printed.
#   - Local checksum is verified before any upload.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
BACKUP_DIR="${BACKUP_DIR:-/home/schoolbus/backups/lampang-bus}"
CONFIG_FILE="${OFFHOST_BACKUP_CONFIG:-$APP_DIR/scripts/offhost-backup-sync.env}"
MARKER_FILE="$BACKUP_DIR/.last_offhost_sync"
DRY_RUN="${DRY_RUN:-0}"

# 1. Load optional config file if present (must be chmod 600, not in git)
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$CONFIG_FILE"; set +a
fi

OFFHOST_BACKUP_METHOD="${OFFHOST_BACKUP_METHOD:-}"

if [ -z "$OFFHOST_BACKUP_METHOD" ]; then
  echo "[offhost-sync] ERROR: OFFHOST_BACKUP_METHOD not set" >&2
  echo "[offhost-sync] expected 'rclone' or 'rsync' via env or $CONFIG_FILE" >&2
  exit 1
fi

# 2. Locate latest local backup pair
LATEST="$(ls -1t "$BACKUP_DIR"/lampang_bus_*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "[offhost-sync] ERROR: no lampang_bus_*.sql.gz in $BACKUP_DIR" >&2
  exit 1
fi
SUMFILE="${LATEST}.sha256"
if [ ! -f "$SUMFILE" ]; then
  echo "[offhost-sync] ERROR: checksum sidecar missing: $SUMFILE" >&2
  exit 1
fi

# 3. Verify local checksum + gzip BEFORE attempting upload
( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$SUMFILE")" >/dev/null ) || {
  echo "[offhost-sync] ERROR: local sha256 mismatch — refusing to upload corrupt backup" >&2
  exit 1
}
gzip -t "$LATEST" || {
  echo "[offhost-sync] ERROR: local gzip integrity failed — refusing to upload" >&2
  exit 1
}

echo "[offhost-sync] $(date -Iseconds) start  method=$OFFHOST_BACKUP_METHOD  dry_run=$DRY_RUN"
echo "[offhost-sync] file:     $(basename "$LATEST") ($(du -h "$LATEST" | cut -f1))"
echo "[offhost-sync] sha256:   OK"
echo "[offhost-sync] gzip:     OK"

# 4. Dispatch by method
case "$OFFHOST_BACKUP_METHOD" in
  rclone)
    if ! command -v rclone >/dev/null 2>&1; then
      echo "[offhost-sync] ERROR: rclone selected but not installed" >&2
      exit 1
    fi
    REMOTE="${OFFHOST_RCLONE_REMOTE:-}"
    if [ -z "$REMOTE" ]; then
      echo "[offhost-sync] ERROR: OFFHOST_RCLONE_REMOTE not set" >&2
      exit 1
    fi
    echo "[offhost-sync] remote:   $REMOTE"

    RCLONE_FLAGS=( --include "lampang_bus_*.sql.gz" --include "lampang_bus_*.sql.gz.sha256" --exclude "*" )
    if [ "$DRY_RUN" = "1" ]; then
      RCLONE_FLAGS+=( --dry-run )
    fi
    # Copy entire backup directory (filtered) — captures latest + any
    # backfill needed for hosts that missed previous days.
    rclone copy "$BACKUP_DIR" "$REMOTE" "${RCLONE_FLAGS[@]}"
    echo "[offhost-sync] remote listing (filtered):"
    rclone ls "$REMOTE" --include "lampang_bus_*.sql.gz" || true
    ;;

  rsync)
    REMOTE="${OFFHOST_RSYNC_TARGET:-}"
    if [ -z "$REMOTE" ]; then
      echo "[offhost-sync] ERROR: OFFHOST_RSYNC_TARGET not set" >&2
      exit 1
    fi
    echo "[offhost-sync] remote:   $REMOTE"

    # Build rsync flags. Filters ensure ONLY backup artifacts cross the wire.
    RSYNC_FLAGS=( -avz --prune-empty-dirs
                  --include="lampang_bus_*.sql.gz"
                  --include="lampang_bus_*.sql.gz.sha256"
                  --exclude="*.log"
                  --exclude=".env*"
                  --exclude="*.partial"
                  --exclude=".last_offhost_sync"
                  --exclude="*" )
    if [ "$DRY_RUN" = "1" ]; then
      RSYNC_FLAGS+=( --dry-run )
    fi
    SSH_OPTS=( -o BatchMode=yes -o StrictHostKeyChecking=accept-new )
    if [ -n "${OFFHOST_SSH_KEY:-}" ]; then
      SSH_OPTS+=( -i "$OFFHOST_SSH_KEY" )
    fi
    # shellcheck disable=SC2029
    rsync "${RSYNC_FLAGS[@]}" -e "ssh ${SSH_OPTS[*]}" "$BACKUP_DIR/" "$REMOTE/"
    ;;

  *)
    echo "[offhost-sync] ERROR: unsupported OFFHOST_BACKUP_METHOD='$OFFHOST_BACKUP_METHOD'" >&2
    echo "[offhost-sync] expected 'rclone' or 'rsync'" >&2
    exit 1
    ;;
esac

# 5. Marker file (only on a real, non-dry-run success)
if [ "$DRY_RUN" != "1" ]; then
  date -Iseconds > "$MARKER_FILE"
  chmod 600 "$MARKER_FILE" 2>/dev/null || true
  echo "[offhost-sync] marker:   $MARKER_FILE"
fi

echo "[offhost-sync] $(date -Iseconds) done"
