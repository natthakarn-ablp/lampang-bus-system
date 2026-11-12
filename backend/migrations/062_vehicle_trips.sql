-- 062_vehicle_trips.sql
-- Several trips per round (owner decision 2026-11-12): a bus that cannot carry
-- every child at once drops the first group, then the driver taps "เริ่มเที่ยว
-- ถัดไป" and picks a reason. One row per extra trip (trip_no >= 2); trip 1 is
-- implicit. A check-in belongs to the trip whose started_at it follows, so
-- checkin_logs is not altered.
--
-- ADDITIVE ONLY. One new table; nothing reads or writes it until
-- FEATURE_MULTI_TRIP=true (index.js refuses to boot with the flag on and this
-- table missing).
-- Rollback: rollback/062_vehicle_trips_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
CREATE TABLE IF NOT EXISTS vehicle_trips (
  id           INT                         NOT NULL AUTO_INCREMENT,
  vehicle_id   VARCHAR(20)                 NOT NULL,
  check_date   DATE                        NOT NULL,
  session      ENUM('morning','evening')   NOT NULL,
  trip_no      TINYINT UNSIGNED            NOT NULL,
  reason_code  VARCHAR(30)                 NOT NULL,
  reason_text  VARCHAR(200)                NULL,
  started_by   INT                         NULL,
  started_at   TIMESTAMP                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_trip (vehicle_id, check_date, session, trip_no),
  INDEX idx_vehicle_trips_date (check_date),
  CONSTRAINT fk_vehicle_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  CONSTRAINT chk_vehicle_trips_no CHECK (trip_no BETWEEN 2 AND 9)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
