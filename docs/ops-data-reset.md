# Operations — Operational Data Reset (Students + Vehicles)

> ระบบรถรับส่งนักเรียนจังหวัดลำปาง — runbook สำหรับการรีเซ็ตข้อมูลปฏิบัติการ
> Phase 10.10H-B • Last updated: 2026-06-02

---

## 1. Purpose

เอกสารนี้อธิบายขั้นตอนการ **ซ่อน (soft-delete)** ข้อมูลนักเรียนและรถ
ทั้งหมดในระบบ พร้อมยกเลิกการมอบหมายคนขับ-รถที่ active อยู่
ใช้สำหรับ:

- เคลียร์ข้อมูลก่อนเริ่มภาคเรียนใหม่
- ทดสอบ flow ทั้งระบบกับ data set ว่าง
- ย้ายระบบไปยังโรงเรียนใหม่/สังกัดใหม่
- หลังเสร็จ pilot/POC

🟢 **ปลอดภัย ย้อนกลับได้**: ทุกอย่างเป็น soft-delete (อัพเดต `is_deleted=TRUE`)
ประวัติเดิมยังอยู่ในฐานข้อมูลครบ และสามารถกู้คืนได้ผ่าน backup หรือกลับ
ค่า `is_deleted=FALSE` (ดู §9)

🔴 **ไม่ใช่ hard delete**: ข้อมูลไม่ถูกทำลายถาวร — เฉพาะถูกซ่อนจากการ
แสดงผลและ business queries เท่านั้น

---

## 2. What the reset does

| Step | Action | SQL |
|---|---|---|
| 1 | Soft-delete all active students + clear their vehicle link | `UPDATE students SET is_deleted=TRUE, deleted_at=NOW(), vehicle_id=NULL WHERE is_deleted=FALSE` |
| 2 | End all active driver-vehicle assignments | `UPDATE driver_vehicle_assignments SET is_active=FALSE, end_date=NOW() WHERE is_active=TRUE` |
| 3 | Soft-delete all active vehicles | `UPDATE vehicles SET is_deleted=TRUE, deleted_at=NOW() WHERE is_deleted=FALSE` |
| 4 (optional) | Delete `student_pickup_points` rows for the affected students — only when `INCLUDE_PICKUP_JUNCTION=1` | `DELETE FROM student_pickup_points WHERE student_id IN (...)` |
| 5 | Append one summary row to `audit_logs` (action=`DELETE`, entity_type=`reset_operational_data`) | `INSERT INTO audit_logs ...` |

**Everything in one MySQL transaction.** Either all 5 steps succeed and commit, or none stick.

---

## 3. What the reset does NOT delete

🚫 The script **never touches** any of these tables:

- `checkin_logs` — operational/audit record
- `daily_status` — operational state
- `notifications` — message history
- `emergency_logs` — safety record (regulatory)
- `vehicle_inspections` — compliance record
- `parents` — out of scope (parents may still be useful for re-onboarding)
- `parent_student` — junction kept intact so re-activation works
- `line_users` — out of scope
- `line_bindings` — out of scope (LINE OA bindings stay)
- `roster_change_requests` — historical
- `student_leaves` — historical
- `vehicle_attendants` — out of scope
- `vehicle_latest_locations` — operational cache (safe to leave)
- `audit_logs` — only **append** one summary row, never delete

If you need to also reset any of these tables, **don't add to this
script** — do a separate scoped operation with its own review.

---

## 4. Backup requirement

🚨 **The script will refuse to run without a fresh backup.**

It checks for the latest file matching
`/home/schoolbus/backups/lampang-bus/lampang_bus_*.sql.gz` and requires:
- File age < **24 hours**
- `sha256sum -c` of the sidecar passes
- `gzip -t` passes

If any check fails, the script exits non-zero before reading the DB.

**Always run a fresh backup right before a real reset**:
```bash
./scripts/backup-db.sh
ls -lh /home/schoolbus/backups/lampang-bus/ | tail -3
```

This narrows the rollback window to a few seconds.

---

## 5. Dry-run command

The script is **dry-run by default**. Running it without env flags
inspects the DB read-only, prints planned actions, and exits.

```bash
cd /home/schoolbus/apps/lampang-bus-system
./scripts/reset-operational-data.sh
```

To also preview the optional junction cleanup:
```bash
INCLUDE_PICKUP_JUNCTION=1 ./scripts/reset-operational-data.sh
```

---

## 6. Real-run command

Real run is gated behind **two** env vars simultaneously:

```bash
DRY_RUN=0 \
RESET_CONFIRM=RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES \
./scripts/reset-operational-data.sh
```

Add `INCLUDE_PICKUP_JUNCTION=1` to also clean the `student_pickup_points` junction.

After the operator pause (5 s), the SQL transaction fires. Total wall-clock
time on the production dataset is sub-second.

---

## 7. Confirmation phrase

The exact string the script accepts:
```
RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES
```

No quotes around the value. No leading/trailing whitespace. Any other value
(including the empty string) is rejected with exit code 2.

The phrase is **never stored** in the audit_logs row — only the fact that
the operation ran is logged.

---

## 8. Expected output

### Dry-run
```
[reset] 2026-06-02T09:00:00+00:00 start
[reset] mode:       DRY-RUN (no data changed)
[reset] database:   lampang_bus
[reset] backup:     lampang_bus_20260602_064612.sql.gz (3h old, sha256 OK, gzip OK)
[reset] junction:   INCLUDE_PICKUP_JUNCTION=0 (student_pickup_points)

[reset] ─── current counts ───
[reset]   active students                              : 289
[reset]   active vehicles                              : 53
[reset]   active driver_vehicle_assignments            : 53
[reset]   active students with vehicle_id set          : 270
[reset]   student_pickup_points linked to active stu.  : 12

[reset] ─── planned actions ───
[reset]   would soft-delete 289 active students (set is_deleted=TRUE, deleted_at=NOW(), vehicle_id=NULL)
[reset]   would end 53 active driver_vehicle_assignments (set is_active=FALSE, end_date=NOW())
[reset]   would soft-delete 53 active vehicles (set is_deleted=TRUE, deleted_at=NOW())
[reset]   would NOT touch student_pickup_points (set INCLUDE_PICKUP_JUNCTION=1 to enable)
[reset]   would NOT touch: checkin_logs, daily_status, notifications, emergency_logs, ...

[reset] DRY_RUN=1 — no data changed.
[reset] To actually run:
[reset]   DRY_RUN=0 RESET_CONFIRM=RESET_LAMPANG_BUS_STUDENTS_AND_VEHICLES ./scripts/reset-operational-data.sh
[reset] 2026-06-02T09:00:01+00:00 done
```

### Real run (additional lines after the planned-actions block)
```
[reset] *** REAL RUN ACKNOWLEDGED ***
[reset] Backup verified: /home/schoolbus/backups/lampang-bus/lampang_bus_...sql.gz
[reset] Affected: students=289, vehicles=53, assignments=53
[reset] Pausing 5 seconds — Ctrl-C now to abort...
[reset] executing transactional reset...
[reset] result:
[reset]   students_affected  vehicles_affected  assignments_affected  junction_affected
[reset]   289                53                 53                    0

[reset] ─── after counts ───
[reset]   active students                              : 0
[reset]   active vehicles                              : 0
[reset]   active driver_vehicle_assignments            : 0

[reset] Rollback options if needed: ...
[reset] 2026-06-02T09:00:06+00:00 done
```

---

## 9. Rollback warning

🚨 The operation is reversible but **not** trivially.

### Option A — Full DB restore (cleanest, recommended)
1. Identify the pre-reset backup printed in the script output (e.g.
   `lampang_bus_20260602_064612.sql.gz`).
2. Verify it loads cleanly into the drill DB first:
   ```bash
   ./scripts/restore-drill-db.sh /home/schoolbus/backups/lampang-bus/<file>.sql.gz
   ```
3. If happy, restore into production using
   [`scripts/restore.sh`](../scripts/restore.sh) (the operator-confirmation
   tool) — **never** `mysql … < backup.sql` directly into the live DB.

### Option B — Manual flag-clear (only if you understand the consequences)
```sql
-- Pick the exact reset timestamp from audit_logs
SELECT created_at, new_value
  FROM audit_logs
 WHERE entity_type = 'reset_operational_data'
 ORDER BY id DESC
 LIMIT 1;

-- Then, using that timestamp as <RESET_TS>:
SET @RESET_TS = '<paste here>';

UPDATE students
   SET is_deleted = FALSE, deleted_at = NULL
 WHERE deleted_at = @RESET_TS;

UPDATE vehicles
   SET is_deleted = FALSE, deleted_at = NULL
 WHERE deleted_at = @RESET_TS;

UPDATE driver_vehicle_assignments
   SET is_active = TRUE, end_date = NULL
 WHERE end_date = @RESET_TS;
```

🟡 **Caveat for Option B**: `students.vehicle_id` was NULL'd during the
reset and is NOT recoverable from these UPDATE statements. You'd need
to re-link each student to a vehicle manually or by restoring from
backup. For datasets with > 50 students linked, Option A is strongly
preferred.

---

## 10. Tables preserved

| Table | Why preserved |
|---|---|
| `checkin_logs` | Operational + audit value; required for historical reports |
| `daily_status` | Snapshot of operational state |
| `notifications` | LINE message delivery history (auditable) |
| `emergency_logs` | Safety/regulatory record |
| `vehicle_inspections` | Compliance record (transport ตรวจสภาพ) |
| `parents` | Parent records may be reused for new students |
| `parent_student` | Junction kept intact so a future "un-reset" works |
| `student_pickup_points` | Junction; deletion gated behind `INCLUDE_PICKUP_JUNCTION=1` |
| `line_users` | LINE OA user records (out of scope) |
| `line_bindings` | Phone-based LINE bindings (out of scope) |
| `roster_change_requests` | Historical workflow records |
| `student_leaves` | Historical leave records |
| `vehicle_attendants` | Linked to vehicles but out of scope for this script |
| `vehicle_latest_locations` | Operational cache (safe to leave; will refresh on next GPS update) |
| `audit_logs` | Only **append** allowed — one summary row per reset |

---

## 11. Why hard delete is prohibited

1. **History matters.** The system is the only authoritative record of
   who-rode-which-bus-when. Hard-deleting students/vehicles destroys
   the foreign-key targets of `checkin_logs`, `notifications`,
   `emergency_logs`, etc., breaking historical queries silently.
2. **Audit requirement.** Education-sector and provincial-government
   audits require that records be **archivable**, not destroyable.
3. **Reversibility.** A mistaken hard-delete is unrecoverable without
   a full backup restore (which loses everything since the backup,
   including same-day check-ins). A soft-delete is `is_deleted=FALSE`
   away from being reactivated.
4. **PDPA alignment.** Soft-delete respects subject-access rights:
   on legitimate request, the operator can locate any record by ID,
   even after it has been "removed" from active queries.

If a stakeholder genuinely requires hard erasure of a specific
subject's data (PDPA right-to-erasure), that is a **separate,
scoped, person-by-person operation** — not a bulk system reset.

---

## 12. Operator pre-flight checklist (before running the real reset)

- [ ] Fresh backup taken within the last hour (`./scripts/backup-db.sh`)
- [ ] Backup sha256 + gzip verified by `./scripts/health-check.sh`
- [ ] Off-host backup is also fresh, OR you've manually copied the latest
      `.sql.gz` to a separate machine
- [ ] No active driver shifts in progress (avoid resetting mid-checkin)
- [ ] Project owner has approved in writing
- [ ] Operator has run the dry-run and reviewed the planned counts
- [ ] Operator has captured the script output to a file via `tee`:
      ```bash
      DRY_RUN=0 RESET_CONFIRM=... ./scripts/reset-operational-data.sh \
        2>&1 | tee /home/schoolbus/backups/lampang-bus/reset-$(date +%Y%m%d_%H%M%S).log
      ```
- [ ] After the reset, run `./scripts/health-check.sh` and verify backend
      still returns `success: true` on `/health`
- [ ] Confirm via SQL that target counts are 0 (active students, vehicles,
      assignments)
- [ ] Confirm via SQL that preserved tables are unchanged
      (`SELECT COUNT(*) FROM checkin_logs;` etc.)
