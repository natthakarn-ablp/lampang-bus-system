-- ============================================================
-- Migration: 019_add_lampang_affiliations.sql
-- Phase:     10.1A
-- Date:      2026-05-14
-- Purpose:   Add the Lampang education-agency master rows that
--            were missing from the affiliations table.
-- ============================================================
--
-- Background
-- ----------
-- Pre-migration state (from `SELECT id, name, is_deleted, created_at
-- FROM affiliations ORDER BY id`):
--
--     AFF001  สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 1   is_deleted=0
--
-- The `users` table, however, already contained five active
-- affiliation accounts whose scope_id pointed at AFF001–AFF005,
-- so the master table had been lagging the auth table.
-- This migration adds the three missing master rows the operator
-- explicitly confirmed (AFF002 / AFF003 / AFF004).
--
-- AFF005 (สำนักงานศึกษาธิการจังหวัดลำปาง) is intentionally NOT
-- inserted here. It is associated with the `lpgpeo` user but is
-- outside the operator's confirmed master list for Phase 10.1A.
-- A follow-up phase can either add AFF005 or deactivate `lpgpeo`
-- based on the operator's decision.
--
-- Safety properties
-- -----------------
--   - Idempotent: re-running has no effect after the first apply,
--     because of ON DUPLICATE KEY UPDATE on the primary key.
--   - Existing AFF001 is preserved. Its name is re-anchored to
--     the operator-confirmed text (currently already matches —
--     this clause is a no-op in steady state).
--   - is_deleted is reset to FALSE so a previously soft-deleted
--     row (recovery scenario) is revived without losing history.
--   - No schema change.
--   - No DELETE.
--   - No FK breakage: schools.affiliation_id currently references
--     only AFF001 (verified pre-migration); the new rows have no
--     dependents to disturb.
--
-- Application
-- -----------
-- Apply with the schoolbus app DB user (no root privileges
-- required). Replace <DB_USER> and <DB_NAME> with the values
-- from backend/.env — DO NOT paste the password into the
-- command line; export it via MYSQL_PWD in a subshell instead.
--
--   MYSQL_PWD="$(grep -oP '^DB_PASSWORD=\K.*' backend/.env)" \
--     mysql -h127.0.0.1 \
--           -u"$(grep -oP '^DB_USER=\K.*' backend/.env)" \
--           "$(grep -oP '^DB_NAME=\K.*' backend/.env)" \
--           < backend/migrations/019_add_lampang_affiliations.sql
--
-- Verification (run after apply)
-- ------------------------------
--   SELECT id, name, is_deleted FROM affiliations ORDER BY id;
-- Expected: 4 rows, AFF001–AFF004, all is_deleted=0.
--
-- Rollback (only if the operator wants to revert)
-- -----------------------------------------------
--   -- Soft delete (preferred — preserves history):
--   UPDATE affiliations SET is_deleted = TRUE, deleted_at = NOW()
--     WHERE id IN ('AFF002','AFF003','AFF004');
--   -- Or hard delete (only if no schools FK any of these — they
--   -- currently don't):
--   DELETE FROM affiliations WHERE id IN ('AFF002','AFF003','AFF004');
--
-- Runtime impact
-- --------------
-- None. The province.service.js `getAffiliations()` reads the
-- table on every API call (no in-memory cache), so the new rows
-- are visible to the frontend on the next request. No PM2 reload,
-- no service restart required.
-- ============================================================

SET NAMES utf8mb4;

INSERT INTO affiliations (id, name, is_deleted) VALUES
  ('AFF001', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 1', FALSE),
  ('AFF002', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 2', FALSE),
  ('AFF003', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 3', FALSE),
  ('AFF004', 'สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาลำปาง ลำพูน',  FALSE)
ON DUPLICATE KEY UPDATE
  name       = VALUES(name),
  is_deleted = VALUES(is_deleted);
