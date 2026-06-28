-- 046_seed_current_term.sql
-- Seed the current academic term so term.service.getCurrentTerm() resolves from
-- the DB (terms.is_current) instead of the env fallback. Matches the env default
-- CURRENT_TERM = '2568-2'. ADDITIVE + IDEMPOTENT — re-runnable, no schema change.
--
-- Before this runs, getCurrentTerm() falls back to env.app.currentTerm, so the
-- code can deploy ahead of this migration with zero behaviour change.

INSERT INTO terms (id, name, start_date, end_date, is_current)
VALUES ('2568-2', 'ภาคเรียนที่ 2/2568', NULL, NULL, TRUE)
ON DUPLICATE KEY UPDATE is_current = VALUES(is_current);

-- Collapse any accidental multi-current state to a single source of truth.
UPDATE terms SET is_current = FALSE WHERE id <> '2568-2';
