#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Database Restore Drill
#
# Restores a selected backup into an ISOLATED test database
# (default: lampang_bus_restore_drill) and prints row-count
# summary. Never touches the production database.
#
# Usage:
#   scripts/restore-drill-db.sh                       # latest backup
#   scripts/restore-drill-db.sh /path/to/dump.sql.gz  # specific backup
#
# Optional env:
#   RESTORE_DB=lampang_bus_restore_drill
#   CLEAN_RESTORE_DRILL=1   # drop test DB after the drill
#   APP_DIR / BACKUP_DIR / ENV_FILE  # override the server paths, e.g. to rehearse
#                                     # the drill against a synthetic dump in an
#                                     # isolated database (2026-09-05)
#
# Safety:
#   - Refuses to target lampang_bus, mysql, information_schema,
#     performance_schema, sys, or any DB literally named "production".
#   - Credentials are passed via a mode-600 temp defaults-file
#     (cleaned on exit). No password on argv or in environ.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/home/schoolbus/apps/lampang-bus-system}"
BACKUP_DIR="${BACKUP_DIR:-/home/schoolbus/backups/lampang-bus}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/backend/.env}"
RESTORE_DB="${RESTORE_DB:-lampang_bus_restore_drill}"

FORBIDDEN_DBS=(
  "lampang_bus"
  "production"
  "mysql"
  "information_schema"
  "performance_schema"
  "sys"
)
for forbidden in "${FORBIDDEN_DBS[@]}"; do
  if [ "$RESTORE_DB" = "$forbidden" ]; then
    echo "[restore-drill] ABORT: refuse to target reserved/production DB '$RESTORE_DB'" >&2
    exit 2
  fi
done

if [ ! -f "$ENV_FILE" ]; then
  echo "[restore-drill] ERROR: env file not found: $ENV_FILE" >&2
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
  echo "[restore-drill] ERROR: DB_USER / DB_NAME / DB_PASSWORD missing in $ENV_FILE" >&2
  exit 1
fi

# Belt-and-braces: the production DB from .env must not equal the restore target
if [ "$DB_NAME" = "$RESTORE_DB" ]; then
  echo "[restore-drill] ABORT: RESTORE_DB matches production DB_NAME=$DB_NAME" >&2
  exit 2
fi

# Resolve backup path
BACKUP_PATH="${1:-}"
if [ -z "$BACKUP_PATH" ]; then
  BACKUP_PATH="$(ls -1t "$BACKUP_DIR"/lampang_bus_*.sql.gz 2>/dev/null | head -1 || true)"
  if [ -z "$BACKUP_PATH" ]; then
    echo "[restore-drill] ERROR: no backups found in $BACKUP_DIR" >&2
    exit 1
  fi
fi
if [ ! -f "$BACKUP_PATH" ]; then
  echo "[restore-drill] ERROR: backup file not found: $BACKUP_PATH" >&2
  exit 1
fi

echo "[restore-drill] backup:   $BACKUP_PATH"
echo "[restore-drill] target:   $RESTORE_DB (host=$DB_HOST:$DB_PORT)"

# Verify checksum if sidecar exists
CHECKSUM_FILE="${BACKUP_PATH}.sha256"
if [ -f "$CHECKSUM_FILE" ]; then
  ( cd "$(dirname "$BACKUP_PATH")" && sha256sum -c "$(basename "$CHECKSUM_FILE")" >/dev/null ) \
    || { echo "[restore-drill] ERROR: sha256 checksum mismatch" >&2; exit 1; }
  echo "[restore-drill] sha256:   OK"
else
  echo "[restore-drill] sha256:   (no sidecar; skipping)"
fi

# Verify gzip integrity
gzip -t "$BACKUP_PATH" || { echo "[restore-drill] ERROR: gzip integrity check failed" >&2; exit 1; }
echo "[restore-drill] gzip:     OK"

# Prepare safe defaults file
DEFAULTS_FILE="$(mktemp -t lampang_bus_restore.XXXXXX)"
chmod 600 "$DEFAULTS_FILE"
cleanup() { rm -f "$DEFAULTS_FILE" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

cat > "$DEFAULTS_FILE" <<EOF
[client]
host=${DB_HOST}
port=${DB_PORT}
user=${DB_USER}
password=${DB_PASSWORD}
EOF
unset DB_PASSWORD

MYSQL() { mysql --defaults-extra-file="$DEFAULTS_FILE" --batch --skip-column-names "$@"; }

# Recreate test DB
echo "[restore-drill] (re)creating database $RESTORE_DB ..."
MYSQL -e "DROP DATABASE IF EXISTS \`$RESTORE_DB\`; CREATE DATABASE \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Restore
echo "[restore-drill] streaming restore ..."
START_TS=$(date +%s)
if ! gunzip -c "$BACKUP_PATH" | mysql --defaults-extra-file="$DEFAULTS_FILE" "$RESTORE_DB"; then
  echo "[restore-drill] ERROR: restore pipeline failed" >&2
  exit 1
fi
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo "[restore-drill] restore complete in ${ELAPSED}s"

# Post-restore inspection
TABLE_COUNT=$(MYSQL -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RESTORE_DB';")
PROD_TABLE_COUNT=$(MYSQL -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';")
echo "[restore-drill] tables restored=$TABLE_COUNT  production=$PROD_TABLE_COUNT"

echo "[restore-drill] --- row counts ---"
printf "%-22s %12s %12s\n" "table" "restored" "production"
KEY_TABLES=(users schools students vehicles parents line_users line_bindings notifications checkin_logs daily_status emergency_logs)
for t in "${KEY_TABLES[@]}"; do
  exists=$(MYSQL -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RESTORE_DB' AND table_name='$t';")
  if [ "$exists" = "1" ]; then
    r_count=$(MYSQL -e "SELECT COUNT(*) FROM \`$RESTORE_DB\`.\`$t\`;" 2>/dev/null || echo "?")
    p_count=$(MYSQL -e "SELECT COUNT(*) FROM \`$DB_NAME\`.\`$t\`;" 2>/dev/null || echo "?")
    printf "%-22s %12s %12s\n" "$t" "$r_count" "$p_count"
  else
    printf "%-22s %12s %12s\n" "$t" "(missing)" "?"
  fi
done

if [ "${CLEAN_RESTORE_DRILL:-0}" = "1" ]; then
  echo "[restore-drill] CLEAN_RESTORE_DRILL=1 → dropping $RESTORE_DB"
  MYSQL -e "DROP DATABASE IF EXISTS \`$RESTORE_DB\`;"
  echo "[restore-drill] dropped $RESTORE_DB"
else
  echo "[restore-drill] $RESTORE_DB kept for inspection (set CLEAN_RESTORE_DRILL=1 to remove)"
fi

echo "[restore-drill] $(date -Iseconds) done"
