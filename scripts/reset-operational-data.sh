#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Lampang Bus System — Operational Data Reset (students + vehicles)
#
# Soft-deletes all active students and vehicles and ends all active
# driver_vehicle_assignments. Optionally cleans the
# student_pickup_points junction. Wrapped in a single transaction.
# Historical tables (checkin_logs, daily_status, audit_logs,
# notifications, emergency_logs, vehicle_inspections, parents,
# parent_student, line_users, line_bindings) are NEVER touched.
#
# Safety guards:
#   1. DRY_RUN=1 by default — no UPDATE/DELETE issued.
#   2. Latest local backup must be < 24 hours old (sha256 verified).
#   3. Real run requires BOTH:
#        DRY_RUN=0
#        RESET_CONFIRM=RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES
#   4. Target DB must be 'lampang_bus' unless RESET_DB_OVERRIDE=1.
#   5. Credentials passed via a mode-600 temp defaults-extra-file,
#      cleaned on EXIT/INT/TERM. Password never on argv / environ.
#
# Usage:
#   ./scripts/reset-operational-data.sh                       # dry-run
#   DRY_RUN=0 RESET_CONFIRM=RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES \
#     ./scripts/reset-operational-data.sh                     # real run
#   INCLUDE_PICKUP_JUNCTION=1 ./scripts/reset-operational-data.sh
#     # also clean student_pickup_points rows for the reset students
#
# Rollback:
#   Restore from /home/schoolbus/backups/lampang-bus/<latest>.sql.gz
#   OR manually UPDATE … SET is_deleted=FALSE, deleted_at=NULL for
#   the affected rows (vehicle_id won't auto-restore — keep notes).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
ENV_FILE="${APP_DIR}/backend/.env"
BACKUP_DIR="/home/schoolbus/backups/lampang-bus"
BACKUP_MAX_AGE_HOURS=24
EXPECTED_DB_NAME="lampang_bus"
CONFIRM_PHRASE="RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES"

DRY_RUN="${DRY_RUN:-1}"
RESET_CONFIRM="${RESET_CONFIRM:-}"
INCLUDE_PICKUP_JUNCTION="${INCLUDE_PICKUP_JUNCTION:-0}"
RESET_DB_OVERRIDE="${RESET_DB_OVERRIDE:-0}"

# ─── 1. Load DB env safely ────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "[reset] ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi
DB_HOST="$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" || true)"
DB_PORT="$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" || true)"
DB_USER="$(grep -oP '^DB_USER=\K.*' "$ENV_FILE" || true)"
DB_PASSWORD="$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE" || true)"
DB_NAME="$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE" || true)"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"

if [ -z "${DB_USER:-}" ] || [ -z "${DB_PASSWORD:-}" ]; then
  echo "[reset] ERROR: DB_USER / DB_PASSWORD missing in $ENV_FILE" >&2
  exit 1
fi
if [ -z "${DB_NAME:-}" ]; then
  echo "[reset] ERROR: DB_NAME missing in $ENV_FILE" >&2
  exit 1
fi
if [ "$DB_NAME" != "$EXPECTED_DB_NAME" ] && [ "$RESET_DB_OVERRIDE" != "1" ]; then
  echo "[reset] ERROR: target DB is '$DB_NAME' but reset is only intended for '$EXPECTED_DB_NAME'." >&2
  echo "[reset]        If this is intentional, set RESET_DB_OVERRIDE=1." >&2
  exit 2
fi

# ─── 2. Backup freshness + integrity guard ────────────────────
LATEST_BACKUP="$(ls -1t "$BACKUP_DIR"/lampang_bus_*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_BACKUP" ]; then
  echo "[reset] ERROR: no backup found in $BACKUP_DIR. Run ./scripts/backup-db.sh first." >&2
  exit 1
fi
BACKUP_AGE_S=$(( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP") ))
BACKUP_AGE_H=$(( BACKUP_AGE_S / 3600 ))
if [ "$BACKUP_AGE_H" -ge "$BACKUP_MAX_AGE_HOURS" ]; then
  echo "[reset] ERROR: latest backup is ${BACKUP_AGE_H}h old (limit ${BACKUP_MAX_AGE_HOURS}h)." >&2
  echo "[reset]        Run ./scripts/backup-db.sh first." >&2
  exit 1
fi
CHECKSUM_FILE="${LATEST_BACKUP}.sha256"
if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "[reset] ERROR: checksum sidecar missing for $LATEST_BACKUP" >&2
  exit 1
fi
( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$CHECKSUM_FILE")" >/dev/null ) || {
  echo "[reset] ERROR: sha256 checksum mismatch — backup may be corrupt." >&2; exit 1; }
gzip -t "$LATEST_BACKUP" || {
  echo "[reset] ERROR: gzip integrity check failed — backup may be corrupt." >&2; exit 1; }

# ─── 3. Stage MySQL credentials ───────────────────────────────
DEFAULTS_FILE="$(mktemp -t lampang_bus_reset.XXXXXX)"
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

MYSQL_RUN() { mysql --defaults-extra-file="$DEFAULTS_FILE" --batch --skip-column-names "$@"; }

# ─── 4. Print preamble ────────────────────────────────────────
echo "[reset] $(date -Iseconds) start"
echo "[reset] mode:       $([ "$DRY_RUN" = "1" ] && echo 'DRY-RUN (no data changed)' || echo 'REAL RUN')"
echo "[reset] database:   $DB_NAME"
echo "[reset] backup:     $(basename "$LATEST_BACKUP") (${BACKUP_AGE_H}h old, sha256 OK, gzip OK)"
echo "[reset] junction:   INCLUDE_PICKUP_JUNCTION=$INCLUDE_PICKUP_JUNCTION (student_pickup_points)"

# ─── 5. Snapshot current counts ───────────────────────────────
ACTIVE_STUDENTS=$(MYSQL_RUN "$DB_NAME" -e   "SELECT COUNT(*) FROM students  WHERE COALESCE(is_deleted, FALSE) = FALSE;")
ACTIVE_VEHICLES=$(MYSQL_RUN "$DB_NAME" -e   "SELECT COUNT(*) FROM vehicles  WHERE COALESCE(is_deleted, FALSE) = FALSE;")
ACTIVE_ASSIGNMENTS=$(MYSQL_RUN "$DB_NAME" -e "SELECT COUNT(*) FROM driver_vehicle_assignments WHERE is_active = TRUE;")
STUDENT_VEHICLE_LINKS=$(MYSQL_RUN "$DB_NAME" -e "SELECT COUNT(*) FROM students WHERE COALESCE(is_deleted, FALSE) = FALSE AND vehicle_id IS NOT NULL;")
JUNCTION_LINKED=$(MYSQL_RUN "$DB_NAME" -e "
  SELECT COUNT(*) FROM student_pickup_points spp
  JOIN students s ON s.id = spp.student_id
  WHERE COALESCE(s.is_deleted, FALSE) = FALSE;
")

echo ""
echo "[reset] ─── current counts ───"
printf "[reset]   active students                              : %s\n" "$ACTIVE_STUDENTS"
printf "[reset]   active vehicles                              : %s\n" "$ACTIVE_VEHICLES"
printf "[reset]   active driver_vehicle_assignments            : %s\n" "$ACTIVE_ASSIGNMENTS"
printf "[reset]   active students with vehicle_id set          : %s\n" "$STUDENT_VEHICLE_LINKS"
printf "[reset]   student_pickup_points linked to active stu.  : %s\n" "$JUNCTION_LINKED"

echo ""
echo "[reset] ─── planned actions ───"
printf "[reset]   would soft-delete %s active students (set is_deleted=TRUE, deleted_at=NOW(), vehicle_id=NULL)\n" "$ACTIVE_STUDENTS"
printf "[reset]   would end %s active driver_vehicle_assignments (set is_active=FALSE, end_date=NOW())\n" "$ACTIVE_ASSIGNMENTS"
printf "[reset]   would soft-delete %s active vehicles (set is_deleted=TRUE, deleted_at=NOW())\n" "$ACTIVE_VEHICLES"
if [ "$INCLUDE_PICKUP_JUNCTION" = "1" ]; then
  printf "[reset]   would DELETE %s student_pickup_points rows linked to the reset students\n" "$JUNCTION_LINKED"
else
  printf "[reset]   would NOT touch student_pickup_points (set INCLUDE_PICKUP_JUNCTION=1 to enable)\n"
fi
echo "[reset]   would NOT touch: checkin_logs, daily_status, notifications, emergency_logs,"
echo "[reset]                    vehicle_inspections, parents, parent_student, line_users,"
echo "[reset]                    line_bindings, roster_change_requests, student_leaves,"
echo "[reset]                    vehicle_attendants, vehicle_latest_locations"

# ─── 6. Dry-run exit ──────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "[reset] DRY_RUN=1 — no data changed."
  echo "[reset] To actually run:"
  echo "[reset]   DRY_RUN=0 RESET_CONFIRM=$CONFIRM_PHRASE ./scripts/reset-operational-data.sh"
  echo "[reset]   (add INCLUDE_PICKUP_JUNCTION=1 to also clean student_pickup_points)"
  echo "[reset] $(date -Iseconds) done"
  exit 0
fi

# ─── 7. Real-run confirmation gate ────────────────────────────
if [ "$RESET_CONFIRM" != "$CONFIRM_PHRASE" ]; then
  echo ""
  echo "[reset] ERROR: real run blocked — RESET_CONFIRM must equal '$CONFIRM_PHRASE'." >&2
  echo "[reset]        You set: '${RESET_CONFIRM:-<empty>}'" >&2
  exit 2
fi

# ─── 8. Final operator pause ──────────────────────────────────
echo ""
echo "[reset] *** REAL RUN ACKNOWLEDGED ***"
echo "[reset] Backup verified: $LATEST_BACKUP"
echo "[reset] Affected: students=$ACTIVE_STUDENTS, vehicles=$ACTIVE_VEHICLES, assignments=$ACTIVE_ASSIGNMENTS"
echo "[reset] Pausing 5 seconds — Ctrl-C now to abort..."
sleep 5
echo ""

# ─── 9. Transactional reset ───────────────────────────────────
# Build a SQL block. Notes:
#  - One transaction; either everything sticks or nothing does.
#  - Audit summary row uses action='DELETE' (closest valid enum value;
#    action='RESET' would require a schema migration which is out of scope
#    for an ops script). entity_type='reset_operational_data' makes the
#    row uniquely findable in audit_logs.
#  - INCLUDE_PICKUP_JUNCTION gates the student_pickup_points DELETE.
JUNCTION_SQL=""
if [ "$INCLUDE_PICKUP_JUNCTION" = "1" ]; then
  JUNCTION_SQL=$'DELETE FROM student_pickup_points\n  WHERE student_id IN (SELECT id FROM students WHERE is_deleted = TRUE AND deleted_at >= @reset_started_at);'
fi

RESET_SQL=$(cat <<EOF
SET autocommit = 0;
START TRANSACTION;

SET @reset_started_at = NOW();

-- Step 1: soft-delete active students (null out their vehicle_id)
UPDATE students
   SET is_deleted = TRUE,
       deleted_at = @reset_started_at,
       vehicle_id = NULL
 WHERE COALESCE(is_deleted, FALSE) = FALSE;
SET @students_affected = ROW_COUNT();

-- Step 2: end active driver-vehicle assignments
UPDATE driver_vehicle_assignments
   SET is_active = FALSE,
       end_date  = COALESCE(end_date, @reset_started_at)
 WHERE is_active = TRUE;
SET @assignments_affected = ROW_COUNT();

-- Step 3: soft-delete active vehicles
UPDATE vehicles
   SET is_deleted = TRUE,
       deleted_at = @reset_started_at
 WHERE COALESCE(is_deleted, FALSE) = FALSE;
SET @vehicles_affected = ROW_COUNT();

-- Step 4 (optional): junction cleanup
${JUNCTION_SQL}
SET @junction_affected = ROW_COUNT();

-- Step 5: audit summary row
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
VALUES (NULL, 'DELETE', 'reset_operational_data', NULL,
        NULL,
        JSON_OBJECT(
          'op', 'reset_operational_data',
          'students_soft_deleted',     @students_affected,
          'vehicles_soft_deleted',     @vehicles_affected,
          'assignments_ended',         @assignments_affected,
          'junction_rows_deleted',     @junction_affected,
          'include_pickup_junction',   ${INCLUDE_PICKUP_JUNCTION},
          'backup_file',               '$(basename "$LATEST_BACKUP")',
          'started_at',                CAST(@reset_started_at AS CHAR)
        ),
        NULL, 'reset-operational-data.sh', @reset_started_at);

COMMIT;

SELECT @students_affected     AS students_affected,
       @vehicles_affected     AS vehicles_affected,
       @assignments_affected  AS assignments_affected,
       @junction_affected     AS junction_affected;
EOF
)

echo "[reset] executing transactional reset..."
RESULT=$(printf '%s\n' "$RESET_SQL" | mysql --defaults-extra-file="$DEFAULTS_FILE" --batch "$DB_NAME")
echo "[reset] result:"
echo "$RESULT" | sed 's/^/[reset]   /'

# ─── 10. Post-counts ──────────────────────────────────────────
POST_ACTIVE_STUDENTS=$(MYSQL_RUN "$DB_NAME" -e "SELECT COUNT(*) FROM students  WHERE COALESCE(is_deleted, FALSE) = FALSE;")
POST_ACTIVE_VEHICLES=$(MYSQL_RUN "$DB_NAME" -e "SELECT COUNT(*) FROM vehicles  WHERE COALESCE(is_deleted, FALSE) = FALSE;")
POST_ACTIVE_ASSIGNMENTS=$(MYSQL_RUN "$DB_NAME" -e "SELECT COUNT(*) FROM driver_vehicle_assignments WHERE is_active = TRUE;")

echo ""
echo "[reset] ─── after counts ───"
printf "[reset]   active students                              : %s\n" "$POST_ACTIVE_STUDENTS"
printf "[reset]   active vehicles                              : %s\n" "$POST_ACTIVE_VEHICLES"
printf "[reset]   active driver_vehicle_assignments            : %s\n" "$POST_ACTIVE_ASSIGNMENTS"

echo ""
echo "[reset] Rollback options if needed:"
echo "[reset]   • Restore the full DB from: $LATEST_BACKUP"
echo "[reset]     (use scripts/restore-drill-db.sh to verify into a test DB first)"
echo "[reset]   • OR manually clear flags:"
echo "[reset]       UPDATE students SET is_deleted=FALSE, deleted_at=NULL WHERE deleted_at >= '<reset_ts>';"
echo "[reset]       UPDATE vehicles SET is_deleted=FALSE, deleted_at=NULL WHERE deleted_at >= '<reset_ts>';"
echo "[reset]       UPDATE driver_vehicle_assignments SET is_active=TRUE, end_date=NULL WHERE end_date >= '<reset_ts>';"
echo "[reset]     (students.vehicle_id will remain NULL — re-link manually)"
echo "[reset] $(date -Iseconds) done"
