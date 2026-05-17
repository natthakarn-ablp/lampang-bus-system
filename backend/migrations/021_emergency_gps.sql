-- Phase 10.3E-HF2 — Emergency GPS Location
-- Capture driver's coordinates at the moment they hit the emergency button
-- so the LINE Flex card can deep-link the responder straight to Google Maps.
--
-- GPS is optional (driver may deny browser permission, indoor signal, etc.)
-- so all three columns are NULL-able and the existing rows stay valid.
--
-- Coordinate precision matches vehicle_latest_locations (017):
--   latitude  DECIMAL(10,8)  range [-90,  90],     ~1.1 mm
--   longitude DECIMAL(11,8)  range [-180, 180],    ~1.1 mm
--   accuracy  INT meters

ALTER TABLE emergency_logs
  ADD COLUMN latitude            DECIMAL(10,8) NULL AFTER note,
  ADD COLUMN longitude           DECIMAL(11,8) NULL AFTER latitude,
  ADD COLUMN location_accuracy_m INT           NULL AFTER longitude;
