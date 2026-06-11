# Operator Runbook — Lampang Bus System (10.13B)

Day-to-day operations. All paths relative to `/home/schoolbus/apps/lampang-bus-system`.
No raw SQL needed for normal operations.

## Scheduled jobs (cron)

| Time | Job | Log |
|------|-----|-----|
| 02:30 | `scripts/backup-db.sh` (local backup + sha256) | `backups/lampang-bus/backup.log` |
| every 5 min | `scripts/health-check.sh` | `backups/lampang-bus/health-check.log` |
| 03:15 | `backend/scripts/integrity-monitor.js --write-json …` | `logs/integrity-monitor.log` |
| 03:30 | `backend/scripts/cleanup-expired-imports.js --apply` | `logs/import-cleanup.log` |

Verify with `crontab -l`. All four should be present.

## Daily monitoring

**Integrity monitor** (read-only, no PII):
```
cd backend && node scripts/integrity-monitor.js          # human output, exit 0/1/2
cd backend && node scripts/integrity-monitor.js --json    # machine output
```
Latest snapshot: `logs/integrity-monitor-latest.json`. Admins can also open
**สุขภาพระบบ** in the UI (`GET /api/admin/operations/health`).

### What to do on WARN vs CRITICAL

- **OK (exit 0):** nothing to do.
- **WARN (exit 1):** review the listed checks. The release baseline WARNs
  (`vehicle_no_driver`, `driver_no_profile`, `inactive_dup_candidates`,
  `blocked_reactivation_24h`, `import_all_failed_7d`) are expected. Act only if a
  count grows unexpectedly (e.g. a new vehicle with no driver → assign one in the
  driver wizard).
- **CRITICAL (exit 2):** act now. Each maps to a fix:
  - `dup_student_code` / `students_missing_identity` → data integrity; investigate the latest import, rollback if needed.
  - `orphan_assignment` / `dup_active_assignment` → driver wizard: end the bad assignment.
  - `canonical_vehicle_dup` → should be impossible (DB-enforced); escalate.
  - `backup` (sha256 mismatch / no backup) → run `scripts/backup-db.sh` then `scripts/verify-latest-backup.sh`.
  - `migration` (drift) → a migration file changed after apply; reconcile with `migration-status.js`.
  - `disk` (≥90%) → free space (old backups/logs).

## Backups

```
scripts/backup-db.sh                # manual backup
scripts/verify-latest-backup.sh     # gzip + sha256 verify (read-only)
```
Backups live in `/home/schoolbus/backups/lampang-bus/` (`*.sql.gz` + `.sha256`).

## Import cleanup

```
cd backend && node scripts/cleanup-expired-imports.js --dry-run   # preview (default safe)
cd backend && node scripts/cleanup-expired-imports.js --apply     # delete expired retained files
```
Path-guarded; only removes expired import files inside the uploads dir.

## Restore-test readiness (deferred)

```
scripts/restore-test-readiness.sh    # exit 0 ready / 1 not-ready / 2 unsafe
```
Currently **NOT READY** (no test DB). To enable: create `scripts/restore-test.env`
(chmod 600) with `RESTORE_TEST_DB` (never the production DB), a chmod-600
`RESTORE_TEST_MYSQL_DEFAULTS_FILE`, and `RESTORE_TEST_ALLOW_CREATE_DATABASE`. The
script never touches production.

## Off-host backup enablement (deferred)

```
scripts/check-offhost-backup-config.sh   # exit 0 ok / 1 missing / 2 unsafe
```
Currently **CONFIG MISSING**. To enable:
1. Create `scripts/offhost-backup-sync.env` (chmod 600) — rclone (`OFFHOST_BACKUP_METHOD=rclone` + `OFFHOST_RCLONE_REMOTE`) or rsync (`OFFHOST_BACKUP_METHOD=rsync` + `OFFHOST_RSYNC_TARGET` [+ `OFFHOST_SSH_KEY`]).
2. `DRY_RUN=1 ./scripts/offhost-backup-sync.sh` — confirm it lists files, uploads nothing.
3. Re-run the checker; only after a clean dry-run, add the cron it prints (`45 2 * * *`).

## PM2

```
pm2 status                         # process state
pm2 logs schoolbus-backend         # tail logs
pm2 restart schoolbus-backend --update-env
```
**Ecosystem adoption (deferred):** `ecosystem.config.js` adds crash-loop backoff
(`max_restarts`, `restart_delay`, `exp_backoff_restart_delay`). Adopt in a planned
window: `pm2 delete schoolbus-backend && pm2 start ecosystem.config.js && pm2 save`,
then confirm `/health` GREEN. Env still comes from `backend/.env`.

## Health / deploy checks

```
curl -s http://127.0.0.1:3000/health
scripts/health-check.sh
cd backend && node scripts/migration-status.js     # 0 untracked / 0 drift expected
```
