#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Verify the latest database backup
# Phase 10.13A-27
#
# Finds the most recent *.sql.gz in the backup directory and verifies:
#   - the file exists and is non-empty (size threshold)
#   - gzip integrity (gzip -t)
#   - sha256 matches its .sha256 sidecar
#   - the gzip stream contains a plausible mysqldump header
#
# Exits 0 on success, non-zero on any failure. Read-only — never restores,
# never touches production data.
#
# Usage:  scripts/verify-latest-backup.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="/home/schoolbus/backups/lampang-bus"
MIN_BYTES=10240          # 10 KB floor — a real dump is far larger
RETENTION_DAYS=7

fail() { echo "[verify-backup] FAIL: $*" >&2; exit 1; }

[ -d "$BACKUP_DIR" ] || fail "backup directory not found: $BACKUP_DIR"

LATEST="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || fail "no .sql.gz backups found in $BACKUP_DIR"

SIZE="$(stat -c %s "$LATEST" 2>/dev/null || echo 0)"
AGE_SECS=$(( $(date +%s) - $(stat -c %Y "$LATEST" 2>/dev/null || echo 0) ))
AGE_HOURS=$(( AGE_SECS / 3600 ))

echo "[verify-backup] latest : $LATEST"
echo "[verify-backup] size   : $SIZE bytes"
echo "[verify-backup] age    : ${AGE_HOURS}h"

[ "$SIZE" -ge "$MIN_BYTES" ] || fail "backup smaller than ${MIN_BYTES} bytes (size=$SIZE) — likely truncated"

gzip -t "$LATEST" || fail "gzip integrity check failed"
echo "[verify-backup] gzip   : OK"

if [ -f "${LATEST}.sha256" ]; then
  ( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$LATEST").sha256" >/dev/null ) || fail "sha256 mismatch"
  echo "[verify-backup] sha256 : OK"
else
  fail "checksum sidecar missing: ${LATEST}.sha256"
fi

# Plausibility: the decompressed head should look like a mysqldump. Capture into
# a variable (with || true) so the SIGPIPE from head closing the stream early
# does not trip `set -o pipefail`.
HEAD_CONTENT="$(gzip -dc "$LATEST" 2>/dev/null | head -c 4096 || true)"
if printf '%s' "$HEAD_CONTENT" | grep -qiE "MySQL dump|CREATE TABLE|INSERT INTO|DROP TABLE"; then
  echo "[verify-backup] content: OK (mysqldump markers present)"
else
  fail "decompressed content does not look like a mysqldump"
fi

# Retention visibility (informational; does not delete here — backup-db.sh prunes).
COUNT="$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
OLD="$(find "$BACKUP_DIR" -name '*.sql.gz' -mtime +"$RETENTION_DAYS" 2>/dev/null | wc -l | tr -d ' ')"
echo "[verify-backup] retain : ${COUNT} backups present, ${OLD} older than ${RETENTION_DAYS}d (pruned by backup-db.sh)"

echo "[verify-backup] RESULT : PASS"
exit 0
