-- Rollback for 062: drops the extra-trip records. Turn FEATURE_MULTI_TRIP off
-- first (the app refuses to boot with the flag on and the table missing). The
-- trip numbers and reasons drivers recorded are lost; check-ins are not touched.
DROP TABLE IF EXISTS vehicle_trips;
