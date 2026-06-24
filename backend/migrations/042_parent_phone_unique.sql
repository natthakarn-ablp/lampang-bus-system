-- Migration 042: parents.phone unique key
-- Addresses the check-then-insert race in studentImportPreview.service.js
-- where concurrent imports create duplicate parent rows for the same phone.
--
-- The unique key is on (phone, is_deleted=FALSE) via a generated column
-- pattern consistent with the rest of the schema (soft-delete aware).
-- NULL phones are allowed (multiple parents without a phone).

-- Add a generated column that is NULL for soft-deleted rows so the unique
-- constraint only applies to active parents.
ALTER TABLE parents
  ADD COLUMN active_phone VARCHAR(20) GENERATED ALWAYS AS
    (CASE WHEN is_deleted = FALSE AND phone IS NOT NULL AND TRIM(phone) <> ''
          THEN TRIM(phone) ELSE NULL END) STORED;

-- Unique index on the active phone — prevents duplicate active parents.
ALTER TABLE parents
  ADD INDEX uq_parents_active_phone (active_phone);
