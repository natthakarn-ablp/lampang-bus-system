-- Migration 024 — Enforce uniqueness on vehicles.normalized_plate (Phase 10.6B)
--
-- Phase 10.6A added the column (NULLable, non-unique). Phase 10.6B is the
-- second half: every backend write path now populates normalized_plate via
-- the shared utils/vehiclePlate.normalizePlate helper, the live backend has
-- been restarted with that code, and a duplicate report against the current
-- 51 active rows returns 0. This migration locks the invariant at the DB
-- level so the only way to reach a duplicate state is to bypass the helper
-- entirely (e.g. raw SQL from a future migration), which will then fail
-- loudly instead of silently introducing dupes.
--
-- Pre-flight (already done manually, NOT enforced in SQL):
--   1. backend code restarted with normalizePlate in all write paths
--   2. SELECT COUNT(*) FROM vehicles WHERE is_deleted = FALSE
--      AND (normalized_plate IS NULL OR TRIM(normalized_plate) = '')  -- expect 0
--   3. SELECT normalized_plate, COUNT(*) FROM vehicles
--      GROUP BY normalized_plate HAVING COUNT(*) > 1                  -- expect 0
--
-- The backfill below is a safety net for any soft-deleted historical rows
-- that 023 left NULL. It uses a slightly broader rule than 023 (also strips
-- en dash U+2013 and em dash U+2014) to match the JS helper exactly.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Safety-net backfill for any remaining NULL rows (e.g. soft-deleted ones)
-- ───────────────────────────────────────────────────────────────────────────

UPDATE vehicles
SET    normalized_plate = LOWER(
         REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(TRIM(plate_no), ' ', ''),
             '-', ''),
           '–', ''),
         '—', '')
       )
WHERE  normalized_plate IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Drop the non-unique index added in 023 — it's replaced by UNIQUE below
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
  DROP INDEX idx_vehicles_normalized_plate;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Tighten the column to NOT NULL (every row now has a value)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
  MODIFY normalized_plate VARCHAR(100) NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Add the UNIQUE constraint — this is the production invariant
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
  ADD UNIQUE KEY uq_vehicles_normalized_plate (normalized_plate);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Verification (manual, after applying)
-- ───────────────────────────────────────────────────────────────────────────

-- SHOW CREATE TABLE vehicles;
-- -- Expected: `normalized_plate` varchar(100) NOT NULL
--             UNIQUE KEY `uq_vehicles_normalized_plate` (`normalized_plate`)
--             (and the old non-unique idx_vehicles_normalized_plate is GONE)

-- SELECT COUNT(*) FROM vehicles
--   WHERE normalized_plate IS NULL OR TRIM(normalized_plate) = '';
-- -- Expected: 0
