-- Phase 6: Pickup points + student-to-point junction.
-- Greenfield — no ALTER on existing tables in v1.
-- students.dropoff_address (existing TEXT) is preserved as a fallback
-- narrative field; coordinates live on the new pickup_points table.

CREATE TABLE IF NOT EXISTS pickup_points (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id  VARCHAR(20)   NOT NULL,
  sequence    INT           NOT NULL DEFAULT 0,
  label       VARCHAR(100)  NOT NULL,
  latitude    DECIMAL(10,8) NOT NULL,
  longitude   DECIMAL(11,8) NOT NULL,
  session     ENUM('morning','evening','both') NOT NULL DEFAULT 'both',
  notes       VARCHAR(255)  NULL,
  is_deleted  BOOLEAN       NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMP     NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pp_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_pp_vehicle (vehicle_id, is_deleted),
  INDEX idx_pp_session (session, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_pickup_points (
  student_id      INT NOT NULL,
  pickup_point_id INT NOT NULL,
  term_id         VARCHAR(10) NULL,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, pickup_point_id),
  CONSTRAINT fk_spp_student FOREIGN KEY (student_id)      REFERENCES students(id),
  CONSTRAINT fk_spp_point   FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id),
  INDEX idx_spp_point (pickup_point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
