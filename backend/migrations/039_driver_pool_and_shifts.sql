-- 039_driver_pool_and_shifts.sql
-- Allow a vehicle to keep an authorized pool of primary/backup drivers and
-- record the actual driver for each operating shift.

-- Migration 030 protected data by allowing only one active driver per vehicle.
-- The shared-driver design deliberately replaces that rule with one active row
-- per driver+vehicle pair; concurrent use is enforced on operating shifts.
ALTER TABLE driver_vehicle_assignments
  DROP INDEX uq_dva_active_vehicle;

ALTER TABLE driver_vehicle_assignments
  ADD COLUMN assignment_role ENUM('PRIMARY','BACKUP') NOT NULL DEFAULT 'PRIMARY' AFTER vehicle_id,
  ADD COLUMN authorization_status ENUM('PENDING','AUTHORIZED','SUSPENDED','REVOKED') NOT NULL DEFAULT 'AUTHORIZED' AFTER assignment_role,
  ADD COLUMN valid_from DATE NULL AFTER authorization_status,
  ADD COLUMN valid_until DATE NULL AFTER valid_from,
  ADD COLUMN authorized_by INT NULL AFTER valid_until,
  ADD COLUMN authorized_at TIMESTAMP NULL AFTER authorized_by,
  ADD COLUMN active_driver_vehicle_key VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE WHEN is_active = 1 AND authorization_status = 'AUTHORIZED'
        THEN CONCAT(driver_id, '|', vehicle_id)
        ELSE NULL
      END
    ) STORED,
  ADD UNIQUE KEY uq_dva_active_driver_vehicle (active_driver_vehicle_key),
  ADD INDEX idx_dva_driver_authorized (driver_id, authorization_status, is_active),
  ADD CONSTRAINT fk_dva_authorized_by FOREIGN KEY (authorized_by) REFERENCES users(id);

CREATE TABLE IF NOT EXISTS driver_qualifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  license_no VARCHAR(80) NOT NULL,
  license_type VARCHAR(80) NULL,
  license_expiry DATE NOT NULL,
  qualification_status ENUM('PENDING','VERIFIED','EXPIRED','SUSPENDED','REVOKED') NOT NULL DEFAULT 'PENDING',
  provider_type ENUM('DLT_OFFICER','PAO_OFFICER','SIGNED_DOCUMENT','DLT_CENTRAL_API') NOT NULL DEFAULT 'DLT_OFFICER',
  provider_reference VARCHAR(120) NULL,
  verified_by INT NULL,
  verified_at TIMESTAMP NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_driver_qualification_current (driver_id, is_current, qualification_status, license_expiry),
  CONSTRAINT fk_driver_qualification_driver FOREIGN KEY (driver_id) REFERENCES drivers(id),
  CONSTRAINT fk_driver_qualification_verifier FOREIGN KEY (verified_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_operating_shifts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  vehicle_id VARCHAR(20) NOT NULL,
  assignment_id INT NOT NULL,
  session ENUM('MORNING','EVENING','OTHER') NOT NULL,
  status ENUM('OPEN','CLOSED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  started_by INT NOT NULL,
  ended_by INT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  start_note VARCHAR(500) NULL,
  end_note VARCHAR(500) NULL,
  open_driver_id INT
    GENERATED ALWAYS AS (CASE WHEN status = 'OPEN' AND ended_at IS NULL THEN driver_id ELSE NULL END) STORED,
  open_vehicle_id VARCHAR(20)
    GENERATED ALWAYS AS (CASE WHEN status = 'OPEN' AND ended_at IS NULL THEN vehicle_id ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_open_shift_driver (open_driver_id),
  UNIQUE KEY uq_open_shift_vehicle (open_vehicle_id),
  INDEX idx_operating_shift_vehicle_time (vehicle_id, started_at),
  INDEX idx_operating_shift_driver_time (driver_id, started_at),
  CONSTRAINT fk_operating_shift_driver FOREIGN KEY (driver_id) REFERENCES drivers(id),
  CONSTRAINT fk_operating_shift_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_operating_shift_assignment FOREIGN KEY (assignment_id) REFERENCES driver_vehicle_assignments(id),
  CONSTRAINT fk_operating_shift_started_by FOREIGN KEY (started_by) REFERENCES users(id),
  CONSTRAINT fk_operating_shift_ended_by FOREIGN KEY (ended_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
