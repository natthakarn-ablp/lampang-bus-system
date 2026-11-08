-- Rollback for 058: drops the co-guardian tables. Turn FEATURE_CO_GUARDIAN off
-- first; co-guardian line_users rows are left as unverified mirrors.
DROP TABLE IF EXISTS line_co_guardians;
DROP TABLE IF EXISTS line_guardian_invites;
