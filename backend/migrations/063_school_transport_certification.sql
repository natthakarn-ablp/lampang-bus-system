-- 063_school_transport_certification.sql
-- "ล้อที่ 3 ระบบการรับรองรถโรงเรียน" (คู่มือการจัดระบบรถโรงเรียนให้ปลอดภัยและ
-- เป็นธรรม, มพบ. 2564; owner request 2026-11-14): the school checks a driver's
-- documents and ISSUES "หนังสือรับรองการรับส่งนักเรียน" before the vehicle goes
-- to the provincial DLT. The DLT pass is valid for at most one semester; a
-- failed vehicle gets 15 days to fix and resubmit. Schools may ask DLT to
-- inspect all their vehicles at the school on one day.
--
-- ADDITIVE ONLY:
--   * four new tables (certificates, intake windows, inspection-day
--     appointments + their vehicles);
--   * vehicles.caretaker_name / caretaker_phone (NULL for every existing row);
--   * vehicle_inspection_applications.fix_deadline (NULL for every existing row);
--   * doc_type ENUMs gain ID_CARD (driver) and VEHICLE_PHOTO (vehicle) —
--     existing values unchanged;
--   * vehicle_inspection_applications.status gains PENDING_SCHOOL_REVIEW and
--     REJECTED **only if they are missing** (the driver-application code writes
--     them but no earlier migration declared them) — guarded, a no-op when the
--     column already has them;
--   * checklist template LAMPANG_SCHOOLBUS version 2 = every version-1 item plus
--     six มพบ. vehicle-standard items. Version 1 is left untouched and stays
--     active; the app uses version 2 only while FEATURE_SCHOOL_CERTIFICATION=true
--     (vehicleVerification.service resolveChecklistTemplate), so attempts already
--     started keep the template they began with.
-- Nothing reads or writes the new tables/columns until
-- FEATURE_SCHOOL_CERTIFICATION=true (index.js refuses to boot with the flag on
-- and this migration missing).
-- Rollback: rollback/063_school_transport_certification_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
-- Runbook: docs/ops/apply-063.md

CREATE TABLE IF NOT EXISTS school_transport_certificates (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  cert_no         VARCHAR(40)   NOT NULL,              -- <school id>/<term id>/<0001>
  application_id  BIGINT        NOT NULL,
  vehicle_id      VARCHAR(20)   NOT NULL,
  school_id       VARCHAR(10)   NOT NULL,
  driver_id       INT           NULL,
  term_id         VARCHAR(10)   NOT NULL,              -- e.g. 2569-2 (terms.id, may be convention-only)
  issued_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until     DATE          NOT NULL,              -- last day of that term
  issued_by       INT           NOT NULL,
  revoked_at      TIMESTAMP     NULL,
  revoked_by      INT           NULL,
  revoke_reason   VARCHAR(500)  NULL,
  snapshot_json   JSON          NULL,                  -- pupil count, caretaker, documents checked (no pupil names)
  PRIMARY KEY (id),
  UNIQUE KEY uq_stc_cert_no (cert_no),
  INDEX idx_stc_application (application_id),
  INDEX idx_stc_vehicle (vehicle_id, valid_until),
  INDEX idx_stc_school_term (school_id, term_id),
  CONSTRAINT fk_stc_application FOREIGN KEY (application_id) REFERENCES vehicle_inspection_applications (id),
  CONSTRAINT fk_stc_vehicle     FOREIGN KEY (vehicle_id)     REFERENCES vehicles (id),
  CONSTRAINT fk_stc_school      FOREIGN KEY (school_id)      REFERENCES schools (id),
  CONSTRAINT fk_stc_driver      FOREIGN KEY (driver_id)      REFERENCES drivers (id),
  CONSTRAINT fk_stc_issued_by   FOREIGN KEY (issued_by)      REFERENCES users (id),
  CONSTRAINT fk_stc_revoked_by  FOREIGN KEY (revoked_by)     REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_certification_windows (
  school_id                     VARCHAR(10)  NOT NULL,
  term_id                       VARCHAR(10)  NOT NULL,
  opens_on                      DATE         NULL,
  closes_on                     DATE         NULL,
  criteria_note                 TEXT         NULL,
  require_compulsory_insurance  BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_by                    INT          NULL,
  updated_at                    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, term_id),
  CONSTRAINT fk_scw_school  FOREIGN KEY (school_id)  REFERENCES schools (id),
  CONSTRAINT fk_scw_user    FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_scw_range  CHECK (opens_on IS NULL OR closes_on IS NULL OR opens_on <= closes_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_appointments (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  school_id       VARCHAR(10)   NOT NULL,
  term_id         VARCHAR(10)   NOT NULL,
  proposed_date   DATE          NOT NULL,
  note            VARCHAR(500)  NULL,
  status          ENUM('REQUESTED','CONFIRMED','DONE','CANCELLED') NOT NULL DEFAULT 'REQUESTED',
  confirmed_date  DATE          NULL,
  confirmed_by    INT           NULL,
  created_by      INT           NOT NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ia_school (school_id, status),
  INDEX idx_ia_status (status, created_at),
  CONSTRAINT fk_ia_school       FOREIGN KEY (school_id)    REFERENCES schools (id),
  CONSTRAINT fk_ia_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id),
  CONSTRAINT fk_ia_created_by   FOREIGN KEY (created_by)   REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_appointment_vehicles (
  appointment_id  BIGINT  NOT NULL,
  application_id  BIGINT  NOT NULL,
  PRIMARY KEY (appointment_id, application_id),
  INDEX idx_iav_application (application_id),
  CONSTRAINT fk_iav_appointment FOREIGN KEY (appointment_id) REFERENCES inspection_appointments (id),
  CONSTRAINT fk_iav_application FOREIGN KEY (application_id) REFERENCES vehicle_inspection_applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE vehicles
  ADD COLUMN caretaker_name  VARCHAR(150) NULL,
  ADD COLUMN caretaker_phone VARCHAR(20)  NULL;

ALTER TABLE vehicle_inspection_applications
  ADD COLUMN fix_deadline DATE NULL;

ALTER TABLE driver_documents
  MODIFY doc_type ENUM('DRIVER_LICENCE','OTHER','ID_CARD') NOT NULL;

ALTER TABLE vehicle_documents
  MODIFY doc_type ENUM('VEHICLE_REGISTRATION','COMPULSORY_INSURANCE','TAX','INSURANCE','OTHER','VEHICLE_PHOTO') NOT NULL;

-- Guarded: add PENDING_SCHOOL_REVIEW / REJECTED to the application status only
-- when the column does not already allow them (superset, existing values kept).
SET @via_status_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspection_applications'
     AND column_name = 'status');
SET @via_status_sql = IF(
  @via_status_type LIKE '%PENDING_SCHOOL_REVIEW%' AND @via_status_type LIKE '%REJECTED%',
  'DO 0',
  "ALTER TABLE vehicle_inspection_applications MODIFY status ENUM('DRAFT','READY_TO_PRINT','SUBMITTED','INSPECTION_PENDING','NEEDS_FIX','PASSED','FAILED','EXPIRED','SUPERSEDED','CANCELLED','PENDING_SCHOOL_REVIEW','REJECTED') NOT NULL DEFAULT 'DRAFT'");
PREPARE via_status_stmt FROM @via_status_sql;
EXECUTE via_status_stmt;
DEALLOCATE PREPARE via_status_stmt;

-- Checklist version 2 (มพบ. 2564 vehicle standards). Created inactive-safe:
-- is_active = TRUE but only chosen by the app while the flag is on.
INSERT INTO inspection_checklist_templates (template_code, template_name, version_no, is_active)
VALUES ('LAMPANG_SCHOOLBUS', 'แบบตรวจรถรับส่งนักเรียนจังหวัดลำปาง (มาตรฐาน มพบ. 2564)', 2, TRUE)
ON DUPLICATE KEY UPDATE template_name = VALUES(template_name);

-- Copy every version-1 item into version 2.
INSERT INTO inspection_checklist_items
  (template_id, item_code, category, label_th, is_required, allows_na, fail_severity, sort_order)
SELECT t2.id, i.item_code, i.category, i.label_th, i.is_required, i.allows_na, i.fail_severity, i.sort_order
  FROM inspection_checklist_items i
  JOIN inspection_checklist_templates t1 ON t1.id = i.template_id
   AND t1.template_code = 'LAMPANG_SCHOOLBUS' AND t1.version_no = 1
  JOIN inspection_checklist_templates t2
    ON t2.template_code = 'LAMPANG_SCHOOLBUS' AND t2.version_no = 2
ON DUPLICATE KEY UPDATE label_th = VALUES(label_th);

INSERT INTO inspection_checklist_items
  (template_id, item_code, category, label_th, is_required, allows_na, fail_severity, sort_order)
SELECT t.id, seed.item_code, seed.category, seed.label_th, TRUE, seed.allows_na, seed.severity, seed.sort_order
FROM inspection_checklist_templates t
JOIN (
  SELECT 'SCHOOLBUS_SIGN_LIGHT' item_code, 'มาตรฐานรถโรงเรียน' category,
         'ป้ายรถโรงเรียนพื้นส้มอักษรดำ หน้า-ท้าย และไฟเหลืองอำพันกะพริบ' label_th,
         FALSE allows_na, 'CRITICAL' severity, 100 sort_order
  UNION ALL SELECT 'NO_TINT', 'มาตรฐานรถโรงเรียน', 'ไม่ติดฟิล์มกรองแสง', FALSE, 'MAJOR', 110
  UNION ALL SELECT 'NO_STANDING', 'มาตรฐานรถโรงเรียน', 'ไม่มีที่ยืนในห้องโดยสาร', FALSE, 'CRITICAL', 120
  UNION ALL SELECT 'REAR_GUARD', 'มาตรฐานรถโรงเรียน', 'รถสองแถวขึ้นลงท้าย มีประตู/ที่กั้นท้ายรถ', TRUE, 'CRITICAL', 130
  UNION ALL SELECT 'SEAT_LAYOUT', 'มาตรฐานรถโรงเรียน', 'รถตู้: ที่นั่งเป็นแถวตอนตามความกว้างรถ', TRUE, 'MAJOR', 140
  UNION ALL SELECT 'EMERGENCY_TOOLS', 'อุปกรณ์ฉุกเฉิน', 'ค้อนทุบกระจกและเหล็กชะแลง', FALSE, 'MAJOR', 150
) seed
WHERE t.template_code = 'LAMPANG_SCHOOLBUS' AND t.version_no = 2
ON DUPLICATE KEY UPDATE label_th = VALUES(label_th), allows_na = VALUES(allows_na),
  fail_severity = VALUES(fail_severity), sort_order = VALUES(sort_order);
