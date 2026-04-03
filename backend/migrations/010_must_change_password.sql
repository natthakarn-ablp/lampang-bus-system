-- ============================================
-- Priority 3: Add must_change_password flag to users
-- ============================================

ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;
