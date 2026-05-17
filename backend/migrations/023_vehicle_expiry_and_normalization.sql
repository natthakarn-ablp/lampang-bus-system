-- Migration 023 — Vehicle expiry tracking + plate normalization (Phase 10.6A)
--
-- Adds expiry columns for registration / พ.ร.บ. (compulsory motor insurance) /
-- annual road tax, plus a `normalized_plate` column to enable accurate
-- duplicate-prevention in Phase 10.6B. Existing UNIQUE(plate_no) is preserved
-- — this migration ONLY adds the new column and a non-unique index for it.
--
-- UNIQUE constraint on normalized_plate is DEFERRED to Phase 10.6B
-- after the duplicate report (Phase 10.6A audit) is reviewed and approved.
-- Phase 10.6A audit confirmed 0 duplicates across 51 active vehicles, so
-- 10.6B will be able to add the UNIQUE safely — but we add it in a separate
-- migration to keep the blast radius of this one minimal.
--
-- All operations are metadata-only or backfill on a 51-row table. Expected
-- runtime: <1 second total. No locking concern.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Add columns
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
  ADD COLUMN normalized_plate            VARCHAR(100) NULL AFTER plate_no,
  ADD COLUMN registration_expiry         DATE         NULL AFTER insurance_expiry,
  ADD COLUMN compulsory_insurance_expiry DATE         NULL AFTER registration_expiry,
  ADD COLUMN tax_expiry                  DATE         NULL AFTER compulsory_insurance_expiry;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Add indexes (non-unique on normalized_plate; UNIQUE deferred to 10.6B)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
  ADD KEY idx_vehicles_normalized_plate            (normalized_plate),
  ADD KEY idx_vehicles_insurance_expiry            (insurance_expiry),
  ADD KEY idx_vehicles_registration_expiry         (registration_expiry),
  ADD KEY idx_vehicles_compulsory_insurance_expiry (compulsory_insurance_expiry),
  ADD KEY idx_vehicles_tax_expiry                  (tax_expiry);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Backfill normalized_plate
--    Rule: trim, strip spaces and ASCII hyphens, lowercase. Applies to ACTIVE
--    rows only — soft-deleted rows are left NULL so the future UNIQUE in
--    10.6B doesn't have to worry about historical noise.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE vehicles
SET    normalized_plate = LOWER(REPLACE(REPLACE(TRIM(plate_no), ' ', ''), '-', ''))
WHERE  normalized_plate IS NULL
  AND  is_deleted = FALSE;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Verification (read-only — meant to be run manually after applying)
-- ───────────────────────────────────────────────────────────────────────────

-- SELECT COUNT(*) AS backfilled FROM vehicles WHERE normalized_plate IS NOT NULL;
-- -- Expected: 51

-- SELECT normalized_plate, COUNT(*) AS n
--   FROM vehicles WHERE is_deleted = FALSE
--   GROUP BY normalized_plate HAVING n > 1;
-- -- Expected: 0 rows (precondition for Phase 10.6B UNIQUE)

-- SHOW CREATE TABLE vehicles;
