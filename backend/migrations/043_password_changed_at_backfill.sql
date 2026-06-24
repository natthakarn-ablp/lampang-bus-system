-- Migration 043: password_changed_at backfill + NOT NULL default
-- Addresses Medium issue: password_changed_at was NULL for migrated users
-- who never changed their password, causing the token-invalidation guard in
-- auth.js to silently skip (if (dbUser.password_changed_at && ...) = false).
-- This backfills NULL values to created_at and sets a NOT NULL default so
-- the guard always runs.

-- Step 1: backfill NULL values to created_at (best approximation of when
-- the password was last set for migrated accounts).
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;

-- Step 2: make the column NOT NULL with a sensible default so future
-- inserts always have a value. ALGORITHM=COPY for fail-fast.
ALTER TABLE users
  MODIFY COLUMN password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALGORITHM=COPY;
