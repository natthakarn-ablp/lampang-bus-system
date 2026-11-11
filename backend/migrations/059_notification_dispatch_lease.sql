-- 059_notification_dispatch_lease.sql
-- PERF-001 (architecture audit 2026-11-08): the LINE dispatcher held a
-- transaction and row locks on `notifications` while calling the LINE API.
-- The new dispatcher claims rows with a short lease, commits, sends outside any
-- transaction with a timeout, then records the result only if it still owns the
-- claim. These columns make that possible.
--
--   retry_key            X-Line-Retry-Key, generated and stored BEFORE the
--                        first send and reused for every retry of the row, so
--                        LINE de-duplicates (409) instead of delivering twice.
--   first_attempt_at     the key is valid for 24 h after the first request
--                        (LINE docs); rows past that are never re-sent
--                        automatically with a new key.
--   claim_token          fencing token of the worker that owns the row; a
--                        late worker whose lease expired cannot overwrite.
--   claimed_until        lease expiry; a crashed worker's rows become claimable
--                        again after it.
--   attempt_count        sends attempted (retry_count keeps its old meaning so
--                        old code keeps working).
--   line_request_id      x-line-request-id / x-line-accepted-request-id.
--   delivery_state       ACCEPTED means "LINE accepted the request", NOT "the
--                        parent received it" — LINE gives no delivery receipt.
--
-- Also adds the queue index (sent, retry_count, created_at) — PERF-002 does not
-- add it again.
--
-- ADDITIVE ONLY: nullable/defaulted columns + one index; no row is rewritten.
-- Old dispatcher code ignores the new columns. Rollback:
-- rollback/059_notification_dispatch_lease_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
ALTER TABLE notifications
  ADD COLUMN retry_key         CHAR(36)    NULL AFTER retry_count,
  ADD COLUMN first_attempt_at  TIMESTAMP   NULL AFTER retry_key,
  ADD COLUMN claim_token       CHAR(36)    NULL AFTER first_attempt_at,
  ADD COLUMN claimed_until     TIMESTAMP   NULL AFTER claim_token,
  ADD COLUMN attempt_count     INT         NOT NULL DEFAULT 0 AFTER claimed_until,
  ADD COLUMN line_request_id   VARCHAR(64) NULL AFTER attempt_count,
  ADD COLUMN delivery_state    ENUM('PENDING','ACCEPTED','FAILED','UNKNOWN','SKIPPED')
                               NOT NULL DEFAULT 'PENDING' AFTER line_request_id,
  ADD INDEX idx_notif_queue (sent, retry_count, created_at);
