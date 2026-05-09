-- Add certifying school field to vehicle inspections
ALTER TABLE vehicle_inspections ADD COLUMN certifying_school_id VARCHAR(10) NULL AFTER notes;
ALTER TABLE vehicle_inspections ADD CONSTRAINT fk_vi_cert_school FOREIGN KEY (certifying_school_id) REFERENCES schools(id);
