-- ============================================
-- Phase 8 patch: Support "add new student" roster requests
-- ============================================

-- Allow student_id to be NULL for new-student requests (student doesn't exist yet)
ALTER TABLE roster_change_requests
  MODIFY COLUMN student_id INT NULL;

-- Store proposed new student data as JSON when request_type='add' and student doesn't exist
ALTER TABLE roster_change_requests
  ADD COLUMN new_student_data JSON NULL AFTER reason;

-- Add parent info columns for the new student request
-- (parent_name and parent_phone are part of the request, not stored in JSON for easier querying)
