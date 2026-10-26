-- Rollback for 050_participation_cases.sql
--
-- Safe to run ONLY while the feature has never been enabled in the target
-- environment, i.e. both tables are empty. 050 is purely additive — it creates
-- two tables and touches nothing else — so dropping them returns the schema to
-- its pre-050 state exactly.
--
-- ORDER MATTERS: participation_case_events holds a foreign key to
-- participation_cases, so the child table drops first.
--
-- BEFORE RUNNING, confirm both tables are empty. If either has rows, do NOT
-- run this: the rows are governance evidence, and the correct rollback is to
-- turn FEATURE_PARTICIPATION_CASES off and leave the data in place.
--
--   SELECT
--     (SELECT COUNT(*) FROM participation_case_events) AS events,
--     (SELECT COUNT(*) FROM participation_cases)       AS cases;
--
-- Expected: 0 and 0.

DROP TABLE IF EXISTS participation_case_events;
DROP TABLE IF EXISTS participation_cases;
