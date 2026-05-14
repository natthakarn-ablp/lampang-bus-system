-- ============================================================
-- Migration: 020_add_lampang_peo_affiliation.sql
-- Phase:     10.1B
-- Date:      2026-05-14
-- Purpose:   Add the Lampang Provincial Education Office (AFF005)
--            master row that was deferred from Phase 10.1A.
-- ============================================================
--
-- Background
-- ----------
-- Phase 10.1A (commit d8ce16c) populated AFF001-AFF004. AFF005
-- was intentionally deferred because the operator's master list
-- contained only the four primary/secondary education zone
-- offices.
--
-- A pre-existing affiliation user account, `lpgpeo` (users.id 63,
-- scope_id='AFF005', is_active=1), was created earlier but has
-- been orphaned without a master row. That user can log in but
-- their dashboard JOINs against `affiliations` return nothing
-- for AFF005.
--
-- The operator has now confirmed that AFF005 should resolve to:
--
--     สำนักงานศึกษาธิการจังหวัดลำปาง
--     (Lampang Provincial Education Office)
--
-- This migration adds exactly that one row and fixes the
-- lpgpeo orphan in a single idempotent INSERT.
--
-- Safety properties
-- -----------------
--   - Idempotent: ON DUPLICATE KEY UPDATE on the primary key.
--     Re-running has no effect after the first apply.
--   - Single row insertion. AFF001-AFF004 are NOT touched.
--   - No schema change.
--   - No DELETE.
--   - No FK breakage: nothing references AFF005 other than the
--     lpgpeo user row, which welcomes the matching master.
--   - No service restart required: getAffiliations() reads the
--     table on every API call (no in-memory cache), so the new
--     row is visible to /admin/users dropdown on the next page
--     load.
--
-- Application
-- -----------
--   MYSQL_PWD="$(grep -oP '^DB_PASSWORD=\K.*' backend/.env)" \
--     mysql -h127.0.0.1 \
--           -u"$(grep -oP '^DB_USER=\K.*' backend/.env)" \
--           "$(grep -oP '^DB_NAME=\K.*' backend/.env)" \
--           < backend/migrations/020_add_lampang_peo_affiliation.sql
--
-- Verification (run after apply)
-- ------------------------------
--   SELECT id, name, is_deleted FROM affiliations ORDER BY id;
-- Expected: 5 rows, AFF001-AFF005, all is_deleted=0.
--
-- Rollback (only if the operator wants to revert)
-- -----------------------------------------------
--   -- Preferred (soft delete — preserves history):
--   UPDATE affiliations SET is_deleted = TRUE, deleted_at = NOW()
--     WHERE id = 'AFF005';
--   -- Or hard delete (FK-safe today — no schools reference AFF005):
--   DELETE FROM affiliations WHERE id = 'AFF005';
-- ============================================================

SET NAMES utf8mb4;

INSERT INTO affiliations (id, name, is_deleted) VALUES
  ('AFF005', 'สำนักงานศึกษาธิการจังหวัดลำปาง', FALSE)
ON DUPLICATE KEY UPDATE
  name       = VALUES(name),
  is_deleted = VALUES(is_deleted);
