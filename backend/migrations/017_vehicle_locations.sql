-- Phase 7.2 — Live Vehicle Location Dashboard (MVP: latest-only)
-- One row per vehicle. Driver POSTs UPSERT; viewers read.
-- No history table in MVP — privacy-minimal, can be added later as
-- vehicle_location_history without touching this table.
--
-- status='ACTIVE' = driver toggle is on (still pushing OR recently was)
-- status='PAUSED' = driver explicitly hit Stop; row kept so viewers
--                   can show "หยุดส่งแล้ว" instead of "offline."

CREATE TABLE IF NOT EXISTS vehicle_latest_locations (
  vehicle_id        VARCHAR(20)   PRIMARY KEY,
  driver_id         INT           NOT NULL,
  latitude          DECIMAL(10,8) NOT NULL,
  longitude         DECIMAL(11,8) NOT NULL,
  accuracy_meters   INT           NULL,
  speed_mps         FLOAT         NULL,
  heading_deg       FLOAT         NULL,
  recorded_at       TIMESTAMP(3)  NOT NULL,
  received_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source            ENUM('web','line') NOT NULL DEFAULT 'web',
  status            ENUM('ACTIVE','PAUSED') NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vll_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_vll_driver  FOREIGN KEY (driver_id)  REFERENCES drivers(id),
  INDEX idx_vll_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phase 7.2 — extend audit action enum so aggregate viewers
-- (affiliation/province/admin) can log VIEW events on the live-vehicle
-- dashboard. School/driver self-views are not audited.
ALTER TABLE audit_logs
  MODIFY COLUMN action
  ENUM('CREATE','UPDATE','DELETE','EXPORT','LOGIN','IMPORT','APPROVE','VIEW') NOT NULL;
