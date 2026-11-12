-- Rollback for 061: drops the homeroom teacher list. Turn
-- FEATURE_HOMEROOM_TEACHERS off first (the app refuses to boot with the flag on
-- and the table missing). The names and phones entered by schools are lost —
-- export them first if they are still wanted.
DROP TABLE IF EXISTS homeroom_teachers;
