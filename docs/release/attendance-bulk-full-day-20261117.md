# Release: bulk attendance time and full-day leave (2026-11-17)

- School and grade-scoped accounts: the classroom attendance page offers one bulk time action for all rooms of the selected grade or one room, for today's selected round. Only existing bus/SELF events are corrected; pending pupils and leaves are excluded.
- Each correction retains the existing per-event audit, time-window, future-time and event-order checks. The batch checks the displayed timestamp and round, enforces school/grade on the server, and commits all corrections/audits together. Any conflict rolls back the entire batch. Max 1,000 events; choose individual rooms above that.
- Leave defaults to `both` (full day), excluding the pupil from morning and evening attendance. An explicit current-round option supports half-day leave. Grade teachers may record/cancel their own full-day leave today, within their own grade. Existing attendance/SELF or overlapping leave prevents a full-day leave.
- Existing morning-only leaves remain morning-only; no historical conversion or backfill. A mistaken full-day leave may be cancelled and re-entered for only one round.
- No SQL migration, no feature-flag change, no notification sent by time correction, no production attendance test records.

## Verification and deployment
Pending completion; record exact commit, CI, guarded script result, backup and rollback evidence outside the public repository. Deploy through `scripts/deploy-backend.sh` on `feat/tracking-security-hardening` using the exact CI-green `DEPLOY_TARGET_SHA`, with `DEPLOY_FRONTEND=1`. Never detach HEAD. Verify health commit equals first seven target characters and public JS/CSS after publishing. Preserve the frontend dist backup and backend rollback ref recorded by the script.
