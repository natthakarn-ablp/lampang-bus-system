# Operator Runbook — Lampang Bus System (2026-08)

Day-to-day operations. All paths relative to `/home/schoolbus/apps/lampang-bus-system`.
No raw SQL needed for normal operations.

## Scheduled jobs (cron)

Production snapshot checked on 2026-08-25. Verify the active server with `crontab -l`.

| Time | Job | Log |
|------|-----|-----|
| every 5 min | `scripts/health-check.sh` | `/home/schoolbus/backups/lampang-bus/health-check.log` |
| 02:30 | `scripts/backup-db.sh` (local backup + sha256) | `/home/schoolbus/backups/lampang-bus/backup.log` |
| 02:50 | `scripts/offhost-backup-sync.sh` (copy latest verified backup off-host) | `/home/schoolbus/logs/offhost-sync.log` |
| 03:00 | `backend/scripts/cleanup-revoked-tokens.js --apply` | `/home/schoolbus/logs/cleanup-revoked-tokens.log` |
| 03:15 | `backend/scripts/integrity-monitor.js --write-json ...` | `/home/schoolbus/logs/integrity-monitor.log` |
| 03:30 | `backend/scripts/cleanup-expired-imports.js --apply` | `/home/schoolbus/logs/import-cleanup.log` |
| 03:45 | `backend/scripts/cleanup-old-logs.js --apply ...` | `/home/schoolbus/logs/cleanup-old-logs.log` |

All scheduled jobs should be present. If a cron entry is missing, pause deployment and restore the entry before go-live.

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
scripts/check-offhost-backup-config.sh
```
Backups live in `/home/schoolbus/backups/lampang-bus/` (`*.sql.gz` + `.sha256`).

Daily green state:

- Latest local backup is newer than 24 hours.
- `scripts/verify-latest-backup.sh` returns PASS for gzip, sha256, and expected content.
- Off-host sync log shows the latest backup filename on the remote destination.
- `scripts/check-offhost-backup-config.sh` returns PASS. This checker now includes `$HOME/.local/bin` in `PATH` because production rclone may be installed there.

Known follow-up: the current Google Drive/rclone warning about the shared rclone OAuth client must be resolved by configuring an organization-owned rclone client ID before the upstream retirement window in 2026.

## Import cleanup

```
cd backend && node scripts/cleanup-expired-imports.js --dry-run   # preview (default safe)
cd backend && node scripts/cleanup-expired-imports.js --apply     # delete expired retained files
```
Path-guarded; only removes expired import files inside the uploads dir.

## Restore-test readiness (one privileged step remaining)

```
scripts/restore-test-readiness.sh    # exit 0 ready / 1 not-ready / 2 unsafe
```
As of 2026-08-25 the config is staged on production, but the drill database does not exist yet:
- `scripts/restore-test.env` → `RESTORE_TEST_DB=lampang_bus_restore_drill` (a dedicated
  drill DB, never production), `RESTORE_TEST_MYSQL_DEFAULTS_FILE=/home/schoolbus/.restore-test.cnf`
  (chmod 600), `RESTORE_TEST_ALLOW_CREATE_DATABASE=false`.
- The app DB user already holds `ALL PRIVILEGES ON lampang_bus_restore_drill.*` but
  has **no global CREATE**, so it cannot create the DB itself. Backup dumps contain
  **no `USE`/`CREATE DATABASE`** line, so a restore into the drill DB can never reach production.

**One remaining step (privileged user, e.g. root):**
```
mysql -e "CREATE DATABASE lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
scripts/restore-test-readiness.sh                 # → READY (exit 0)
# then the safe drill (test DB only; production untouched):
zcat $(ls -t /home/schoolbus/backups/lampang-bus/*.sql.gz | head -1) \
  | mysql --defaults-file=/home/schoolbus/.restore-test.cnf lampang_bus_restore_drill
mysql --defaults-file=/home/schoolbus/.restore-test.cnf lampang_bus_restore_drill -e "SELECT COUNT(*) FROM students;"
# cleanup: DROP the drill tables (or the DB) afterward; verify production counts unchanged.
```

Do not mark backup governance FULL GREEN until at least one restore drill has completed and the production aggregate counts are confirmed unchanged afterward.

## Off-host backup monitoring

```
scripts/check-offhost-backup-config.sh   # exit 0 ok / 1 missing / 2 unsafe
```

Production currently uses the same gitignored config pattern as the template in `scripts/offhost-backup-sync.env.example`. Never commit the real config or rclone credentials.

Daily check:

1. Run `scripts/check-offhost-backup-config.sh`.
2. If the checker fails but cron log shows successful remote listing, confirm `rclone` is in `PATH`; the checker should include `$HOME/.local/bin`.
3. Inspect `/home/schoolbus/logs/offhost-sync.log` for the latest `done` entry and remote listing.
4. If sync fails, keep local backups, fix the off-host target, run `DRY_RUN=1 ./scripts/offhost-backup-sync.sh`, then run one real sync after the dry-run passes.

## PM2

```
pm2 status                         # process state
pm2 logs schoolbus-backend         # tail logs
pm2 restart schoolbus-backend --update-env
```
**Ecosystem: ADOPTED (10.13C-2).** The process now runs from `ecosystem.config.js`
(`node src/index.js`, cwd `backend/`, fork mode) with crash-loop backoff
(`max_restarts: 10`, `restart_delay: 5000`, `exp_backoff_restart_delay: 1000`,
`max_memory_restart: 500M`). Env still comes from `backend/.env`. PM2 dump saved
(`pm2 save`), so a reboot resurrects it.

Re-adopt / restart cleanly:
```
pm2 restart schoolbus-backend --update-env        # normal restart
pm2 delete schoolbus-backend && pm2 start ecosystem.config.js && pm2 save   # re-adopt
```
**Rollback to npm start** (if ever needed): `pm2 delete schoolbus-backend && cd backend && pm2 start npm --name schoolbus-backend -- start && pm2 save`.

## Health / deploy checks

```
curl -s http://127.0.0.1:3000/health
scripts/health-check.sh
scripts/production-readiness-gate.sh production
cd backend && node scripts/migration-status.js     # 0 untracked / 0 drift expected
git rev-parse --short HEAD                         # compare with /health data.commit
```

Deployment gate:

- `/health` must report `success: true` and `database.connected: true`.
- `/health.data.commit` should match `git rev-parse --short HEAD` after a deployment/restart.
- `scripts/health-check.sh` should report `health commit=<sha> matches git HEAD`; a mismatch is a WARN and means runtime version evidence is not clean yet.
- If the commit differs, do not treat the deploy as fully closed. The backend resolver should prefer the checkout's git HEAD when `.git` exists and only fall back to `GIT_COMMIT` when git metadata is unavailable; restart PM2 with the intended environment (`pm2 restart schoolbus-backend --update-env`) and re-run the smoke check.
- Public root should return HTTP 200.
- A no-token `GET /api/auth/me` request should return HTTP 401 JSON, not 500 and not HTML.

## Phase 9 production gate

Use the repeatable gate runner before owner sign-off and after deployment:

```
bash scripts/production-readiness-gate.sh local
BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public
BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public
node scripts/validate-phase9-evidence.js outputs/phase9-evidence/<timestamp> --require-mode public
node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp> --allow-pending
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>  # must PASS after UAT
node scripts/create-restore-drill-evidence-pack.js
node scripts/create-operator-gate-evidence-pack.js --base-url http://127.0.0.1:3000
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp> --allow-pending
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp> --allow-pending
node scripts/create-ops-signoff-draft.js --phase9-evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-go-live-signoff.js --allow-pending   # structure check before signatures
node scripts/validate-go-live-signoff.js                   # must PASS before 100%
node scripts/verify-100-readiness.js --allow-pending --evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/verify-100-readiness.js --evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>  # must PASS before declaring 100%
node scripts/create-go-live-bundle.js --allow-pending --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp> --allow-pending
node scripts/create-go-live-bundle.js --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>  # final bundle, no pending
node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp>  # final bundle validator, no pending
set -o pipefail
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh production 2>&1 | tee outputs/operator-gates/<timestamp>/production-gate.redacted.log
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh postdeploy 2>&1 | tee outputs/operator-gates/<timestamp>/postdeploy-gate.redacted.log
```

`public` mode runs only external HTTP guard checks and can be run from any workstation. `collect-phase9-evidence.sh` writes `outputs/phase9-evidence/<timestamp>/summary.md`, `manifest.json`, and logs for sign-off. Validate the evidence pack before attaching it. `create-uat-evidence-pack.js` writes role-by-role UAT templates under `outputs/uat-evidence/<timestamp>/` without calling APIs or writing any database. `validate-uat-evidence-pack.js` checks each role file for route smoke, role checks, evidence links, tester details, and sign-off; the non-`--allow-pending` command is expected to fail until testers have actually filled the pack. `create-restore-drill-evidence-pack.js` and `create-operator-gate-evidence-pack.js` reserve local folders for operator evidence only; they do not run gates, deploys, restore drills, or database writes. `validate-restore-drill-evidence.js` checks the restore-drill result and redacted log; `validate-operator-gate-evidence.js` checks production/postdeploy/monitor results and redacted logs. `create-ops-signoff-draft.js` uses phase9/restore/operator evidence to generate `OPS_SIGNOFF_DRAFT.md` and `ops-transfer.csv` for O1-O8 without editing the official sign-off. `validate-go-live-signoff.js` checks UAT results, evidence cells, owner/operator approval scopes, dates, and signatures; the non-`--allow-pending` command is expected to fail until people have actually signed. `verify-100-readiness.js` aggregates the evidence validator, UAT evidence pack validator, restore/operator evidence validators, sign-off validator, scorecard status, required files, and production-safety wording; the non-`--allow-pending` command must pass before declaring 100%. `create-go-live-bundle.js` creates the owner/operator review bundle under `outputs/go-live-bundle/<timestamp>/` with executive brief, operator commands, sign-off index, `SOURCE_STATE.md` for commit/deploy approval, `ACTION_PLAN.md` by role/section, `ACTION_ITEMS.csv/json` for assignment tracking, validator logs, file hashes, and readiness report references; it records paths and hashes instead of copying raw UAT screenshots or sensitive evidence. `validate-go-live-bundle.js` checks the bundle manifest, required files, safety flags, source-state file, action item CSV/JSON, logs, and pending/fail state before the bundle is attached. `production` and `postdeploy` modes are read-only against production DB. They call off-host config validation with `OFFHOST_CHECK_READ_ONLY=true`, verify the off-host sync log contains the latest backup filename, and call restore readiness with `RESTORE_TEST_FORCE_READ_ONLY=true`; the actual restore drill remains a separate approved operator action.

See `docs/PHASE9_PRODUCTION_GATE_2026-08.md` for the full closeout rule.
