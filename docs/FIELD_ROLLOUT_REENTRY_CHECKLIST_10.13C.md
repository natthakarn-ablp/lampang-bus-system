# Field Rollout Re-Entry Checklist — 10.13C-1 (rerun)

Use this when the three field inputs arrive (บ้านบอม file · ไหล่หิน 4th plate ·
ไหล่หิน 76-row file). No manual SQL. All actions through the UI/API.

## 0. Pre-flight (must all be green before touching data)
```
curl -s http://127.0.0.1:3000/health                 # GREEN
scripts/health-check.sh                                # warn=0 fail=0
cd backend && node scripts/migration-status.js         # 0 untracked / 0 drift
cd backend && node scripts/integrity-monitor.js        # 0 CRITICAL (WARN ok)
scripts/verify-latest-backup.sh                        # PASS
git status --short                                     # clean
```

## A. บ้านบอม (52020147)
1. ☐ Confirm the school uploaded the file (preview shows it).
2. ☐ Open import **preview**.
3. ☐ Confirm row count (~43, or at least the 5 codes).
4. ☐ Confirm the five codes appear: **3307, 3314, 3316, 3317, 3319**.
5. ☐ Confirm classifications — the 5 expected `CROSS_SCHOOL_SAME_CODE_ALLOWED` and `can_apply`; new rows `INSERT_NEW`; in-file repeats `DUPLICATE_ROW_IN_FILE` (cannot apply).
6. ☐ Apply **`insert_ready`** only (do **not** auto-apply guardian/reactivate/transfer rows — select explicitly if intended).
7. ☐ Confirm count **38 → 43** (if all 5 inserted; otherwise delta = rows applied).
8. ☐ Confirm **แม่ถอด stays 55** (unless unrelated operator activity, which is documented).
9. ☐ Confirm import **history** shows the batch and the **report** downloads.

## B. ไหล่หิน (52020039) — vehicle first
1. ☐ Get the 4th vehicle plate: prefix + number + province (+ type).
2. ☐ Run check-plate / `node backend/scripts/diagnose-plate.js <prefix> <number> <province> 52020039`.
3. ☐ `VALID_NEW_VEHICLE` → add via the **structured vehicle form** (never auto-create from import).
4. ☐ `SOFT_DELETED_VEHICLE_EXISTS` → create a **vehicle restore request** (admin approves); do not add a duplicate.
5. ☐ `PROVINCE_ALIAS_DUPLICATE` / `SAME_ACTIVE_VEHICLE_*` → use existing / request; do **not** add a duplicate.
6. ☐ After add/restore: confirm `canonical_plate` populated and **active canonical duplicates = 0**.

## C. ไหล่หิน — student import (after the vehicle exists)
7. ☐ Confirm the 76-row file uploaded.
8. ☐ Open **preview**; review totals / ready / duplicate-in-file / guardian / reactivate / **vehicle blockers**.
9. ☐ Resolve any `VEHICLE_NOT_FOUND` / `VEHICLE_SOFT_DELETED` rows via the vehicle workflow **before** applying.
10. ☐ Apply only eligible rows (`insert_ready`, plus explicitly selected guardian/reactivate).
11. ☐ Confirm import **history** + **report**.
12. ☐ Confirm **duplicate (school_id, student_code) = 0** and **orphan active assignments = 0**.
13. ☐ Reconcile ไหล่หิน count: before 50 → after (= 50 + rows applied).

## D. After rerun
```
scripts/health-check.sh
cd backend && node scripts/integrity-monitor.js        # 0 CRITICAL
scripts/verify-latest-backup.sh                        # PASS
pm2 logs schoolbus-backend --lines 30 --nostream | grep -iE ': 500|uncaught|unhandled'   # none
```
- ☐ Count reconciliation (students/vehicles/orphan/canonical-dup/code-dup).
- ☐ Update `docs/FIELD_ROLLOUT_10.13C_1.md` with the actual results (files used, applied/blocked rows, before/after counts, operator notes).
- ☐ Commit docs only (no student files / PII): `10.13C-1 field rollout completed`.
