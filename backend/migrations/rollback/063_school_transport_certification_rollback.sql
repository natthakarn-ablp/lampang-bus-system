-- Rollback for 063. Turn FEATURE_SCHOOL_CERTIFICATION off first (the app
-- refuses to boot with the flag on and these tables/columns missing).
-- Lost: issued certificates, intake windows, inspection-day appointments,
-- vehicle caretaker names/phones and fix deadlines. ID_CARD / VEHICLE_PHOTO
-- uploads are kept as doc_type OTHER (the files stay on disk).
-- Checklist version 2 is deactivated, not deleted: attempts finalized with it
-- reference its items (inspection_checklist_results FK).
-- The guarded PENDING_SCHOOL_REVIEW / REJECTED status values are NOT removed —
-- driver-initiated applications may already hold them.
DROP TABLE IF EXISTS inspection_appointment_vehicles;
DROP TABLE IF EXISTS inspection_appointments;
DROP TABLE IF EXISTS school_certification_windows;
DROP TABLE IF EXISTS school_transport_certificates;

ALTER TABLE vehicles
  DROP COLUMN caretaker_name,
  DROP COLUMN caretaker_phone;

ALTER TABLE vehicle_inspection_applications
  DROP COLUMN fix_deadline;

UPDATE driver_documents SET doc_type = 'OTHER' WHERE doc_type = 'ID_CARD';
ALTER TABLE driver_documents
  MODIFY doc_type ENUM('DRIVER_LICENCE','OTHER') NOT NULL;

UPDATE vehicle_documents SET doc_type = 'OTHER' WHERE doc_type = 'VEHICLE_PHOTO';
ALTER TABLE vehicle_documents
  MODIFY doc_type ENUM('VEHICLE_REGISTRATION','COMPULSORY_INSURANCE','TAX','INSURANCE','OTHER') NOT NULL;

UPDATE inspection_checklist_templates SET is_active = FALSE
 WHERE template_code = 'LAMPANG_SCHOOLBUS' AND version_no = 2;
