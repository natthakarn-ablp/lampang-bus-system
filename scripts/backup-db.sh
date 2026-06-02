#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Automated Daily Database Backup
#
# Dumps the lampang_bus MySQL database to a gzipped file under
# /home/schoolbus/backups/lampang-bus/ with a sha256 checksum and
# 7-day retention. Suitable for unattended cron execution.
#
# Usage:    scripts/backup-db.sh
# Cron ex:  30 2 * * * /home/schoolbus/apps/lampang-bus-system/scripts/backup-db.sh \
#             >> /home/schoolbus/backups/lampang-bus/backup.log 2>&1
#
# Security notes:
#   - DB credentials are read from backend/.env (chmod 600 expected).
#   - The MySQL password is written to a private temp defaults-file
#     (mode 600, cleaned on EXIT/INT/TERM) and passed via
#     --defaults-extra-file so it never appears on the command line
#     or in /proc/<pid>/environ.
#   - Backup files are written 600; the backup directory is 700.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
BACKUP_DIR="/home/schoolbus/backups/lampang-bus"
ENV_FILE="${APP_DIR}/backend/.env"
RETENTION_DAYS=7

if [ ! -f "$ENV_FILE" ]; then
  echo "[backup-db] ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

DB_HOST="$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" || true)"
DB_PORT="$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" || true)"
DB_USER="$(grep -oP '^DB_USER=\K.*' "$ENV_FILE" || true)"
DB_PASSWORD="$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE" || true)"
DB_NAME="$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE" || true)"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"

if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ] || [ -z "${DB_PASSWORD:-}" ]; then
  echo "[backup-db] ERROR: DB_USER / DB_NAME / DB_PASSWORD missing in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
TMP_FILE="${BACKUP_FILE}.partial"

DEFAULTS_FILE="$(mktemp -t lampang_bus_mysqldump.XXXXXX)"
chmod 600 "$DEFAULTS_FILE"
cleanup() {
  rm -f "$DEFAULTS_FILE" "$TMP_FILE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cat > "$DEFAULTS_FILE" <<EOF
[client]
host=${DB_HOST}
port=${DB_PORT}
user=${DB_USER}
password=${DB_PASSWORD}
EOF

# Unset so password no longer lives in this shell after the file is written
unset DB_PASSWORD

echo "[backup-db] $(date -Iseconds) start  db=${DB_NAME} host=${DB_HOST}:${DB_PORT}"

if ! mysqldump --defaults-extra-file="$DEFAULTS_FILE" \
      --single-transaction --quick \
      --routines --triggers --events \
      --no-tablespaces \
      "$DB_NAME" | gzip -c > "$TMP_FILE"; then
  echo "[backup-db] ERROR: mysqldump pipeline failed" >&2
  exit 1
fi

mv "$TMP_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE" 2>/dev/null || true

if ! gzip -t "$BACKUP_FILE"; then
  echo "[backup-db] ERROR: gzip integrity check failed for $BACKUP_FILE" >&2
  exit 1
fi

( cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$CHECKSUM_FILE" )
chmod 600 "$CHECKSUM_FILE" 2>/dev/null || true

SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"

REMOVED_DUMPS=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz"        -mtime +${RETENTION_DAYS} -print -delete | wc -l)
REMOVED_SUMS=$(find  "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz.sha256" -mtime +${RETENTION_DAYS} -print -delete | wc -l)

KEPT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz" | wc -l)

echo "[backup-db] OK   ${BACKUP_FILE} (${SIZE})"
echo "[backup-db] sha  ${CHECKSUM_FILE}"
echo "[backup-db] retention=${RETENTION_DAYS}d  kept=${KEPT}  removed_dumps=${REMOVED_DUMPS}  removed_sums=${REMOVED_SUMS}"
echo "[backup-db] $(date -Iseconds) done"
