#!/usr/bin/env bash
# DATA-001 synthetic restore round trip — CI only.
#
# Runs the PRODUCTION scripts unchanged (scripts/backup-db.sh, then
# scripts/restore-drill-db.sh) against the CI MySQL service: the source is the
# already-migrated synthetic test schema (lampang_bus_test) plus a generated
# fixture table; the target is the isolated lampang_bus_restore_drill. It then
# compares every table's row count and CHECKSUM TABLE value and prints timings.
#
# Proves the scripts and the restore mechanics. It does NOT prove that a real
# production backup restores — that needs an isolated environment the owner
# approves (see docs/ops/backup-restore-readiness.md).
#
# Guard rails: refuses unless ALLOW_RESTORE_ROUNDTRIP_TEST=synthetic-ci-only,
# the host is 127.0.0.1 and the source DB is lampang_bus_test.
set -euo pipefail
umask 077

[ "${ALLOW_RESTORE_ROUNDTRIP_TEST:-}" = synthetic-ci-only ] || { echo 'refusing: synthetic CI only' >&2; exit 2; }
[ "${DB_HOST:-}" = 127.0.0.1 ] || { echo 'refusing: DB_HOST must be 127.0.0.1' >&2; exit 2; }
[ "${DB_NAME:-}" = lampang_bus_test ] || { echo 'refusing: source must be lampang_bus_test' >&2; exit 2; }

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t restore-roundtrip-XXXXXX)"
RESTORE_DB=lampang_bus_restore_drill
FIXTURE_ROWS="${FIXTURE_ROWS:-20000}"

cat > "$WORK/db.env" <<EOF
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
EOF
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
  "$DB_HOST" "${DB_PORT:-3306}" "$DB_USER" "$DB_PASSWORD" > "$WORK/client.cnf"
SQL() { mysql --defaults-extra-file="$WORK/client.cnf" --batch --skip-column-names "$@"; }

SCHED_BEFORE="$(SQL -e 'SELECT @@GLOBAL.event_scheduler')"
cleanup() {
  SQL -e "DROP DATABASE IF EXISTS \`$RESTORE_DB\`; DROP TABLE IF EXISTS \`$DB_NAME\`.zz_restore_fixture;" || true
  SQL -e "SET GLOBAL event_scheduler = ${SCHED_BEFORE}" 2>/dev/null || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT
# Never let a restored copy fire scheduled events.
SQL -e 'SET GLOBAL event_scheduler = OFF'

# Synthetic fixture: Thai text, NULLs, JSON, timestamps — no real data.
SQL "$DB_NAME" <<EOF
SET SESSION cte_max_recursion_depth = ${FIXTURE_ROWS};
DROP TABLE IF EXISTS zz_restore_fixture;
CREATE TABLE zz_restore_fixture (
  id INT PRIMARY KEY, name VARCHAR(100), note TEXT NULL, meta JSON NULL,
  created_at TIMESTAMP(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO zz_restore_fixture
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${FIXTURE_ROWS})
SELECT n, CONCAT('นักเรียนสังเคราะห์ ', n), IF(n % 7 = 0, NULL, REPEAT('ข้อมูลทดสอบ ', n % 20)),
       JSON_OBJECT('n', n, 'tag', 'synthetic'), TIMESTAMP('2026-01-01') + INTERVAL n SECOND
FROM seq;
EOF

mkdir -p "$WORK/backups"
T0=$(date +%s.%N)
APP_DIR="$ROOT" BACKUP_DIR="$WORK/backups" ENV_FILE="$WORK/db.env" bash "$ROOT/scripts/backup-db.sh"
T1=$(date +%s.%N)
DUMP="$(ls -1 "$WORK"/backups/lampang_bus_test_*.sql.gz | head -1)"
# backup-db.sh names the dump after DB_NAME; restore-drill-db.sh looks for
# lampang_bus_*.sql.gz, so pass the dump path explicitly.
APP_DIR="$ROOT" BACKUP_DIR="$WORK/backups" ENV_FILE="$WORK/db.env" RESTORE_DB="$RESTORE_DB" \
  bash "$ROOT/scripts/restore-drill-db.sh" "$DUMP"
T2=$(date +%s.%N)

# Compare every base table: row count + CHECKSUM TABLE.
mismatch=0
tables=0
while read -r t; do
  tables=$((tables + 1))
  src="$(SQL -e "SELECT COUNT(*) FROM \`$DB_NAME\`.\`$t\`") $(SQL -e "CHECKSUM TABLE \`$DB_NAME\`.\`$t\`" | awk '{print $2}')"
  dst="$(SQL -e "SELECT COUNT(*) FROM \`$RESTORE_DB\`.\`$t\`" 2>/dev/null || echo missing) $(SQL -e "CHECKSUM TABLE \`$RESTORE_DB\`.\`$t\`" 2>/dev/null | awk '{print $2}')"
  if [ "$src" != "$dst" ]; then echo "MISMATCH $t source=[$src] restored=[$dst]"; mismatch=$((mismatch + 1)); fi
done < <(SQL -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE' ORDER BY table_name")
src_routines="$(SQL -e "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='$DB_NAME'")"
dst_routines="$(SQL -e "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='$RESTORE_DB'")"
src_triggers="$(SQL -e "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$DB_NAME'")"
dst_triggers="$(SQL -e "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$RESTORE_DB'")"
[ "$src_routines" = "$dst_routines" ] || { echo "MISMATCH routines $src_routines/$dst_routines"; mismatch=$((mismatch + 1)); }
[ "$src_triggers" = "$dst_triggers" ] || { echo "MISMATCH triggers $src_triggers/$dst_triggers"; mismatch=$((mismatch + 1)); }

BACKUP_S=$(awk "BEGIN{printf \"%.1f\", $T1-$T0}")
RESTORE_S=$(awk "BEGIN{printf \"%.1f\", $T2-$T1}")
SIZE=$(stat -c %s "$DUMP")
summary="synthetic restore round trip: tables=$tables mismatches=$mismatch fixture_rows=$FIXTURE_ROWS dump_bytes=$SIZE backup_s=$BACKUP_S restore_s=$RESTORE_S routines=$dst_routines triggers=$dst_triggers"
echo "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $summary" >> "$GITHUB_STEP_SUMMARY"
[ "$mismatch" -eq 0 ] && [ "$tables" -gt 10 ] || { echo 'restore round trip FAILED' >&2; exit 1; }
echo 'restore round trip PASS (synthetic data only; real backup restore NOT proven by this test)'
