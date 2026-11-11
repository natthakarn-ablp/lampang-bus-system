-- Rollback for 059. Deploy the previous dispatcher code first (it ignores these
-- columns, so the order only matters for the new code). Rows already ACCEPTED
-- keep sent = TRUE, so nothing is re-sent after rollback.
ALTER TABLE notifications
  DROP INDEX idx_notif_queue,
  DROP COLUMN delivery_state,
  DROP COLUMN line_request_id,
  DROP COLUMN attempt_count,
  DROP COLUMN claimed_until,
  DROP COLUMN claim_token,
  DROP COLUMN first_attempt_at,
  DROP COLUMN retry_key;
