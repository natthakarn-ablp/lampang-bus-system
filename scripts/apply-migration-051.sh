#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Apply migration 051 (shared security state, task A1-9) to the
# database this deployment uses.
#
# WHY THIS SCRIPT EXISTS
#   scripts/deploy-backend.sh does NOT apply migrations. Migration 051's
#   tables are on the unconditional path — the login lockout is read on
#   every login attempt for every role — so deploying the new build before
#   these tables exist means nobody can sign in.
#
#   Running this FIRST is safe at any hour: 051 only creates three new
#   tables. It alters nothing, drops nothing, and the currently-running
#   (older) code does not know these tables exist, so it neither reads nor
#   writes them. There is no window in which a user notices anything.
#
# ORDER
#   1. this script          <- creates the tables (no user impact)
#   2. deploy-backend.sh    <- brings up the code that uses them
#   Rolling back is the reverse: roll the code back first, and leave the
#   tables in place — they are empty and unread by the old build.
#
# SAFETY
#   - Reads credentials from backend/.env the same way backup-db.sh does,
#     and passes them through a mode-600 temp defaults-file cleaned on exit.
#     No password on argv or in the environment.
#   - Refuses to run without a recent verified backup unless
#     SKIP_BACKUP_CHECK=1 is set deliberately.
#   - Idempotent: the migration is CREATE TABLE IF NOT EXISTS, and this
#     script reports what was already there before and after.
#   - Read-only until the single mysql invocation that applies the file,
#     and it prints exactly what it is about to do first.
#
# Usage (on the app server):
#   bash scripts/apply-migration-051.sh            # apply
#   DRY_RUN=1 bash scripts/apply-migration-051.sh  # check only, change nothing
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/home/schoolbus/apps/lampang-bus-system}"
BACKUP_DIR="${BACKUP_DIR:-/home/schoolbus/backups/lampang-bus}"
ENV_FILE="${APP_DIR}/backend/.env"
MIGRATION="${APP_DIR}/backend/migrations/051_shared_security_state.sql"
TABLES=(login_lockouts line_webhook_events_seen line_bind_lockouts)
DRY_RUN="${DRY_RUN:-0}"

say()  { echo "[051] $*"; }
fail() { echo "[051] ERROR: $*" >&2; exit 1; }

# ── 1. inputs exist ─────────────────────────────────────────────────────────
[ -f "$ENV_FILE" ]  || fail "env file not found: $ENV_FILE"
[ -f "$MIGRATION" ] || fail "migration not found: $MIGRATION (git pull first?)"

DB_HOST="$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" || true)"
DB_PORT="$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" || true)"
DB_USER="$(grep -oP '^DB_USER=\K.*' "$ENV_FILE" || true)"
DB_PASSWORD="$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE" || true)"
DB_NAME="$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE" || true)"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"

[ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ] && [ -n "${DB_PASSWORD:-}" ] \
  || fail "DB_USER / DB_NAME / DB_PASSWORD missing in $ENV_FILE"

say "target database: ${DB_NAME} on ${DB_HOST}:${DB_PORT} (user ${DB_USER})"

# ── 2. a recent backup must exist ───────────────────────────────────────────
# 051 is additive and needs no restore to undo, but a schema change without a
# usable backup behind it is a habit worth refusing.
if [ "${SKIP_BACKUP_CHECK:-0}" != "1" ]; then
  LATEST="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$LATEST" ] || fail "no backup found in $BACKUP_DIR — run scripts/backup-db.sh first (or set SKIP_BACKUP_CHECK=1)"
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
  say "latest backup: $(basename "$LATEST") (${AGE_H}h old)"
  [ "$AGE_H" -le 48 ] || fail "latest backup is ${AGE_H}h old — take a fresh one (or set SKIP_BACKUP_CHECK=1)"
fi

# ── 3. credentials via a mode-600 defaults-file ─────────────────────────────
DEFAULTS_FILE="$(mktemp -t lampang_bus_051.XXXXXX)"
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

mysql_q() { mysql --defaults-extra-file="$DEFAULTS_FILE" -N -B -e "$1"; }

count_tables() {
  mysql_q "SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema='${DB_NAME}'
              AND table_name IN ('${TABLES[0]}','${TABLES[1]}','${TABLES[2]}');"
}

# ── 4. state before ─────────────────────────────────────────────────────────
BEFORE="$(count_tables)" || fail "cannot query ${DB_NAME} — check credentials and connectivity"
say "tables present before: ${BEFORE} of 3"

if [ "$BEFORE" = "3" ]; then
  say "already applied — nothing to do. Safe to deploy the code."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN: would apply ${MIGRATION} to ${DB_NAME}. Nothing was changed."
  exit 0
fi

# ── 5. apply ────────────────────────────────────────────────────────────────
say "applying ${MIGRATION} to ${DB_NAME} ..."
mysql --defaults-extra-file="$DEFAULTS_FILE" "$DB_NAME" < "$MIGRATION"

AFTER="$(count_tables)"
say "tables present after: ${AFTER} of 3"
[ "$AFTER" = "3" ] || fail "expected 3 tables after applying, found ${AFTER} — do NOT deploy the code yet"

# ── 6. what the tables look like, so the log is evidence ────────────────────
mysql_q "SELECT table_name, table_rows FROM information_schema.tables
          WHERE table_schema='${DB_NAME}'
            AND table_name IN ('${TABLES[0]}','${TABLES[1]}','${TABLES[2]}')
          ORDER BY table_name;" | while read -r t r; do
  say "  ${t}: created, ${r:-0} rows"
done

say "done. The running (old) build is unaffected — it does not read these tables."
say "next: bash scripts/deploy-backend.sh"
