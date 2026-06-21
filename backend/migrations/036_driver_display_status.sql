-- 036_driver_display_status.sql — Phase QR-1 (driver public display status)
-- Additive: the real flag behind the public "สถานะคนขับ ปกติ/ระงับ". Absence of a
-- row = derived 'normal'. Withdrawing a REQUIRED driver consent atomically upserts
-- this to 'suspended' (label "ระงับการแสดงผล"). Does NOT change drivers/users
-- semantics — login/assignment are unaffected; this only governs QR display.
--
-- Rollback: DROP TABLE driver_display_status;   (new table, empty)

CREATE TABLE IF NOT EXISTS driver_display_status (
  driver_id INT PRIMARY KEY,
  display_status ENUM('normal','suspended') NOT NULL DEFAULT 'normal',
  reason VARCHAR(255) NULL,
  changed_by INT NULL,                                -- users.id of the actor (NULL = system, e.g. consent cascade)
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
