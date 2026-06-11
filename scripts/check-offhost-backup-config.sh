#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Off-host backup config checker  (Phase 10.13B-9)
#
# READ-ONLY. Validates scripts/offhost-backup-sync.env and (if it looks safe)
# runs the sync in DRY_RUN mode. NEVER uploads a real backup. Keeps off-host
# backup safely deferred until the config exists and a dry-run passes.
#
# Exit: 0 = config valid + dry-run OK, 1 = config missing, 2 = unsafe/invalid.
# ─────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/scripts/offhost-backup-sync.env"
note() { echo "[offhost-check] $*"; }

if [ ! -f "$CFG" ]; then
  cat <<EOF
[offhost-check] CONFIG MISSING — off-host backup remains deferred.

Create $CFG (chmod 600). Choose ONE method:

  # rclone (cloud: S3/Drive/B2/…)
  OFFHOST_BACKUP_METHOD=rclone
  OFFHOST_RCLONE_REMOTE=myremote:lampang-bus-backups

  # …or rsync (remote host over SSH)
  OFFHOST_BACKUP_METHOD=rsync
  OFFHOST_RSYNC_TARGET=backup@host:/srv/lampang-bus-backups
  OFFHOST_SSH_KEY=/home/schoolbus/.ssh/offhost_id_ed25519

Then:
  chmod 600 $CFG
  DRY_RUN=1 ./scripts/offhost-backup-sync.sh        # verify it lists files
  ./scripts/check-offhost-backup-config.sh          # re-run this checker
  # only after a clean dry-run, add the cron (printed below on success).
EOF
  exit 1
fi

# Permissions.
perm="$(stat -c '%a' "$CFG" 2>/dev/null || echo '')"
[ "$perm" = "600" ] || { note "UNSAFE: $CFG must be chmod 600 (found ${perm:-?})  →  chmod 600 $CFG"; exit 2; }

# Load + validate.
# shellcheck disable=SC1090
set -a; . "$CFG"; set +a
: "${OFFHOST_BACKUP_METHOD:=}"
case "$OFFHOST_BACKUP_METHOD" in
  rclone)
    [ -n "${OFFHOST_RCLONE_REMOTE:-}" ] || { note "UNSAFE: rclone method requires OFFHOST_RCLONE_REMOTE"; exit 2; }
    command -v rclone >/dev/null 2>&1 || { note "UNSAFE: rclone not installed"; exit 2; }
    note "method=rclone remote=${OFFHOST_RCLONE_REMOTE%%:*}:[…]" ;;
  rsync)
    [ -n "${OFFHOST_RSYNC_TARGET:-}" ] || { note "UNSAFE: rsync method requires OFFHOST_RSYNC_TARGET"; exit 2; }
    command -v rsync >/dev/null 2>&1 || { note "UNSAFE: rsync not installed"; exit 2; }
    [ -z "${OFFHOST_SSH_KEY:-}" ] || [ -f "${OFFHOST_SSH_KEY}" ] || { note "UNSAFE: OFFHOST_SSH_KEY not found: ${OFFHOST_SSH_KEY}"; exit 2; }
    note "method=rsync target=${OFFHOST_RSYNC_TARGET%%:*}:[…]" ;;
  *)
    note "UNSAFE: OFFHOST_BACKUP_METHOD must be 'rclone' or 'rsync' (found '${OFFHOST_BACKUP_METHOD}')"; exit 2 ;;
esac

# Safe dry-run (never uploads).
note "running DRY_RUN sync…"
if DRY_RUN=1 "$ROOT/scripts/offhost-backup-sync.sh" >/tmp/offhost-dryrun.$$ 2>&1; then
  note "DRY_RUN: PASS"
  echo "[offhost-check] Recommended cron (only after this clean dry-run):"
  echo "  45 2 * * * cd $ROOT && ./scripts/offhost-backup-sync.sh >> /home/schoolbus/logs/offhost-sync.log 2>&1"
  rm -f /tmp/offhost-dryrun.$$
  exit 0
else
  note "UNSAFE: DRY_RUN failed:"; sed 's/^/    /' /tmp/offhost-dryrun.$$; rm -f /tmp/offhost-dryrun.$$
  exit 2
fi
