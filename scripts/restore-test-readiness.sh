#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Backup restore-test readiness  (Phase 10.13B-9)
#
# READ-ONLY. Reports whether a real restore test can be run safely.
# NEVER restores over production; never creates/drops a DB unless the operator
# has explicitly configured a dedicated test DB and allowed it.
#
# Exit: 0 = ready, 1 = not ready (missing config), 2 = unsafe/blocker.
#
# Config (optional file, chmod 600):  scripts/restore-test.env
#   RESTORE_TEST_DB=lampang_bus_restoretest
#   RESTORE_TEST_MYSQL_DEFAULTS_FILE=/home/schoolbus/.restore-test.cnf
#   RESTORE_TEST_ALLOW_CREATE_DATABASE=false
#
# Env:
#   RESTORE_TEST_FORCE_READ_ONLY=true  # never create the test DB even if config allows it
# ─────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROD_DB="lampang_bus"

note() { echo "[restore-readiness] $*"; }
notready() { note "NOT READY: $*"; exit 1; }
unsafe() { note "UNSAFE: $*"; exit 2; }

# 1. Latest backup must verify (gzip + sha256).
if ! "$ROOT/scripts/verify-latest-backup.sh" >/dev/null 2>&1; then
  note "latest backup verification FAILED — fix backups before restore testing"; exit 2
fi
note "latest backup verification: PASS"

# 2. mysql client present.
command -v mysql >/dev/null 2>&1 || notready "mysql client not found in PATH"

# 3. Load optional restore-test config.
CFG="$ROOT/scripts/restore-test.env"
if [ -f "$CFG" ]; then
  perm="$(stat -c '%a' "$CFG" 2>/dev/null || echo '')"
  [ "$perm" = "600" ] || unsafe "restore-test.env must be chmod 600 (found ${perm:-?})"
  # shellcheck disable=SC1090
  set -a; . "$CFG"; set +a
fi
: "${RESTORE_TEST_DB:=}"
: "${RESTORE_TEST_MYSQL_DEFAULTS_FILE:=}"
: "${RESTORE_TEST_ALLOW_CREATE_DATABASE:=false}"
: "${RESTORE_TEST_FORCE_READ_ONLY:=false}"

if [ "$RESTORE_TEST_FORCE_READ_ONLY" = "true" ]; then
  RESTORE_TEST_ALLOW_CREATE_DATABASE=false
fi

# 4. Guard: test DB must never be production.
if [ -n "$RESTORE_TEST_DB" ] && [ "$RESTORE_TEST_DB" = "$PROD_DB" ]; then
  unsafe "RESTORE_TEST_DB must NOT equal the production DB ($PROD_DB)"
fi

# 5. Config missing → report exact requirements.
if [ -z "$RESTORE_TEST_DB" ] || [ -z "$RESTORE_TEST_MYSQL_DEFAULTS_FILE" ]; then
  cat <<EOF
[restore-readiness] NOT READY — restore-test config missing.

To enable a safe restore test, create $CFG (chmod 600) with:
  RESTORE_TEST_DB=lampang_bus_restoretest          # a DEDICATED test DB, never '$PROD_DB'
  RESTORE_TEST_MYSQL_DEFAULTS_FILE=/home/schoolbus/.restore-test.cnf
  RESTORE_TEST_ALLOW_CREATE_DATABASE=false

And a MySQL defaults-file (chmod 600) with a user limited to the test DB:
  [client]
  user=restoretest
  password=...
  host=127.0.0.1

Then re-run this script. It will verify the user can connect and (only if
RESTORE_TEST_ALLOW_CREATE_DATABASE=true) create the test DB.
EOF
  exit 1
fi

# 6. Defaults-file must exist + be 600.
[ -f "$RESTORE_TEST_MYSQL_DEFAULTS_FILE" ] || notready "defaults-file not found: $RESTORE_TEST_MYSQL_DEFAULTS_FILE"
dperm="$(stat -c '%a' "$RESTORE_TEST_MYSQL_DEFAULTS_FILE" 2>/dev/null || echo '')"
[ "$dperm" = "600" ] || unsafe "defaults-file must be chmod 600 (found ${dperm:-?})"

# 7. Can the user connect? (read-only)
if ! mysql --defaults-file="$RESTORE_TEST_MYSQL_DEFAULTS_FILE" -e "SELECT 1" >/dev/null 2>&1; then
  notready "cannot connect with the configured defaults-file"
fi
note "test DB connection: OK"

# 8. Does the test DB exist / can it be created?
if mysql --defaults-file="$RESTORE_TEST_MYSQL_DEFAULTS_FILE" -e "USE \`$RESTORE_TEST_DB\`" >/dev/null 2>&1; then
  note "test DB '$RESTORE_TEST_DB' exists — READY to restore into it"
  exit 0
fi
if [ "$RESTORE_TEST_ALLOW_CREATE_DATABASE" = "true" ]; then
  if mysql --defaults-file="$RESTORE_TEST_MYSQL_DEFAULTS_FILE" -e "CREATE DATABASE IF NOT EXISTS \`$RESTORE_TEST_DB\` CHARACTER SET utf8mb4" >/dev/null 2>&1; then
    note "created test DB '$RESTORE_TEST_DB' — READY"; exit 0
  fi
  notready "user lacks CREATE DATABASE privilege; create '$RESTORE_TEST_DB' manually or grant the privilege"
fi
notready "test DB '$RESTORE_TEST_DB' does not exist and RESTORE_TEST_ALLOW_CREATE_DATABASE=false"
