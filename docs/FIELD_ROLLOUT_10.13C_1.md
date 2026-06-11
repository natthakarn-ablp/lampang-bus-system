# Field Rollout 10.13C-1 — บ้านบอม + ไหล่หิน

**Status: BLOCKED on missing operator input. No data was mutated.**
**Release:** `release-10.13B-admin-free-core` · **Commit:** `eae5676` · **Date:** 2026-06-11

## 1. Release baseline (pre-rollout, read-only)

| Check | Result |
|-------|--------|
| HEAD / tag | `eae5676` · `release-10.13B-admin-free-core` points at HEAD |
| /health | GREEN (`eae5676`) |
| health-check | OK (warn=0 fail=0) |
| migration-status | 0 untracked / 0 drift |
| integrity-monitor | WARN, **0 CRITICAL** |
| backup verify | PASS |
| log scan | 0 concerning |

Baseline school counts: **บ้านบอม (52020147) = 38** · **แม่ถอด (52020082) = 55** · **ไหล่หิน (52020039) = 50**.
ไหล่หิน active vehicles in use: **3** — นข 3204 ลำปาง, นข 800 ลำปาง, นข 6150 ลำปาง.

## 2. บ้านบอม (52020147) — BLOCKED: import file not available

- **File availability:** NONE. `import_batches` has **0 entries** for school 52020147. No retained file in `backend/uploads/imports/` references school code `52020147` or the expected codes `3307/3314/3316/3317/3319`. The school's import user is `299`; no retained file is named for that uploader.
- **Preview / apply:** not run (no file).
- **Count:** unchanged at **38** (no delta). แม่ถอด unchanged at **55**.

### What the operator must provide
1. Log in as the บ้านบอม school account (scope `52020147`).
2. Open **จัดการนักเรียน → นำเข้า** and upload the real student file (Excel/CSV).
   - Expected ≈ **43 rows** total, or at minimum the **5 missing rows**: codes `3307, 3314, 3316, 3317, 3319`.
3. Review the **preview** — the 5 codes are expected to classify `CROSS_SCHOOL_SAME_CODE_ALLOWED` (they exist under แม่ถอด `52020082` as different students) and remain `can_apply`.
4. Apply `insert_ready`. แม่ถอด (`52020082`) is untouched by design.

> The original legacy file was deleted by the old importer. The 10.13B importer
> retains uploaded files going forward — but this school has not yet uploaded
> through the new workflow, so nothing is on the server to apply.

## 3. ไหล่หิน (52020039) — BLOCKED: 4th vehicle + student file not available

### 3a. 4th vehicle
- **Vehicle details provided:** NONE. This phase did not supply a plate prefix/number/province.
- **Current state:** ไหล่หิน uses exactly **3** vehicles (นข 3204, นข 800, นข 6150). There is **no 4th vehicle** and **no soft-deleted 4th candidate** in the system.
- **check-plate / diagnose:** not run (no plate to check).
- **Action taken:** none. Active vehicle count unchanged (35). Canonical duplicates remain **0**.

#### What the operator must provide
- The 4th vehicle's exact **plate prefix + number + province** (e.g. `นข NNNN ลำปาง`).
- Then run, via UI/API: `node backend/scripts/diagnose-plate.js <prefix> <number> <province> 52020039`
  (or check-plate in the vehicle form):
  - `VALID_NEW_VEHICLE` → add via the structured vehicle form (no auto-create from import).
  - `SOFT_DELETED_VEHICLE_EXISTS` / `PROVINCE_ALIAS_DUPLICATE` / `SAME_ACTIVE_VEHICLE_*` → use the vehicle restore/use request workflow; **do not** add a duplicate.
  - `AMBIGUOUS_PLATE_NEEDS_PROVINCE` → supply the province.

### 3b. Student file (76 rows)
- **File availability:** NONE. `import_batches` has **0 entries** for school 52020039; no retained file references `52020039`.
- **Preview / apply:** not run (no file; and the 4th vehicle blocker would gate VEHICLE_NOT_FOUND rows anyway).
- **Count:** unchanged at **50** (no delta).

#### What the operator must provide
- The **76-row** ไหล่หิน student file, uploaded via the import-preview UI **after** the 4th vehicle is added/confirmed (otherwise its rows would classify `VEHICLE_NOT_FOUND` and stay blocked, as designed).

## 4. Integrity after rollout attempt (unchanged — no writes)

duplicate (school_id, student_code) = **0** · orphan active assignments = **0** ·
active canonical vehicle duplicates = **0** · duplicate active assignment per vehicle = **0** ·
integrity monitor = **WARN / 0 CRITICAL**.

## 5. Operator friction / observations

- **No friction in the released workflows** — they were not reachable because the
  prerequisite real-world inputs (files, 4th plate) are not in hand. The blockers
  are purely data-availability, not UI/UX.
- **Root cause (บ้านบอม):** the legacy importer deleted the original upload; the new
  importer retains files, but a fresh upload is still required from the school.
- **Process recommendation:** collect the two files and the ไหล่หิน 4th plate from the
  schools (a short data-request to each school account holder), then re-run this
  rollout — it becomes a 10-minute UI task with no SQL.

## 6. Follow-up

- **Re-run 10.13C-1** once the operator supplies: (a) บ้านบอม file, (b) ไหล่หิน 4th plate, (c) ไหล่หิน 76-row file.
- Next phase options: **10.13C-2 infrastructure closure** (off-host backup config, restore-test DB, PM2 ecosystem adoption) can proceed independently of this data wait.
