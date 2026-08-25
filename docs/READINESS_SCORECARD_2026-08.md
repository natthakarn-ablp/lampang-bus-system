# Readiness Scorecard 2026-08 — School Safe Connect ลำปาง

วันที่ปรับปรุง: 2026-08-25
สถานะ: controlled rollout ready after approval; not yet 100% production green

## Summary

| Phase | Readiness | Evidence | Remaining Gate |
|---|---:|---|---|
| Phase 0 Baseline & Guardrail | 100% | production/read-only baseline recorded in plan files | none |
| Phase 1 Login + RBAC | 86% | source audit, unit tests, UAT matrix, protected-route rate-limit wiring test | stakeholder UAT with real/test role accounts |
| Phase 2 Master Data | 63% | aggregate DB audit, data-quality report | schools/data owners must correct missing/dirty records |
| Phase 3 Daily Operation | 66% | source/retention audit, existing backend tests, UAT checklist | sandbox driver check-in/out/emergency UAT |
| Phase 4 LINE Parent | 58% | LIFF routes build/smoke, LINE policy doc updated | LINE OA/LIFF test-account UAT and adoption campaign |
| Phase 5 Reports & Executive | 82% | monthly exports implemented, export tests, build/audit pass | role UAT and live/pilot data freshness |
| Phase 6 Training & Rollout | 80% | Training Pack 2026-08, UAT sign-off sheet, operator checklist | real training attendance and sign-off |
| Phase 7 Governance & Ops | 80% | governance checklist, incident/PDPA SOP, backup/off-host evidence, runbook, health commit resolver + monitor patch, global API rate-limit floor patch | restore drill, custom rclone client, deploy approval |
| Overall | 80% | local verification green, no production writes | UAT + restore drill + approved deployment |

## What Is Ready To Use Now

- Login/RBAC code paths are covered by existing technical audit and tests, with role UAT ready to run.
- Dashboard, master data, daily operation, reports, audit, LINE/LIFF, and training workflows have documented UAT steps.
- Monthly report export now uses monthly aggregate endpoints for CSV/Excel/PDF and avoids student-level PII.
- Routine parent status policy is documented as LIFF pull first; LINE push remains for important exceptions/emergencies unless policy changes.
- Operator runbook now reflects the current production cron set, local backup, off-host sync, restore drill gate, and health commit gate.
- Incident/PDPA SOP exists with severity, containment, evidence, communication, and DPO/legal decision flow.
- `/health.data.commit` now prefers the checkout's git HEAD over stale `GIT_COMMIT` env when a git checkout is present, with env fallback for non-git builds.
- `scripts/health-check.sh` now warns when `/health.data.commit` differs from git HEAD.
- The generic 120/min UI API rate-limit floor is now mounted before protected authenticated routers, including feature-protected rollout routes (`documents`, `eta`, `geofences`, `route-deviations`), while auth, LINE, parent LIFF, reports, and visits keep their specialized handling.
- `scripts/production-readiness-gate.sh` now groups local, public external, production read-only, and postdeploy gates into one repeatable operator command; production mode uses read-only off-host validation plus log evidence, and restore drill remains an explicit approved action.
- `scripts/collect-phase9-evidence.sh` now creates timestamped Phase 9 evidence packs for owner/operator sign-off without running deploys, restore drills, or production writes.
- `docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md` packages the exact approval scope, safety limits, and run order for the final owner/operator gate.
- `scripts/validate-go-live-signoff.js` now validates that UAT rows, owner/operator approvals, dates, signatures, and evidence are complete before anyone can call the rollout 100%.
- `scripts/verify-100-readiness.js` now aggregates required files, Phase 9 evidence validation, UAT evidence pack validation, sign-off validation, scorecard status, and production-safety wording into one non-mutating final verifier.
- `scripts/create-uat-evidence-pack.js` now creates a timestamped, role-by-role UAT evidence pack so testers can capture evidence without writing production data or storing secrets/PII.
- `scripts/validate-uat-evidence-pack.js` now validates the UAT evidence pack itself before results are transferred into the final sign-off document.
- `scripts/create-go-live-bundle.js` now creates a non-mutating owner/operator bundle with executive brief, operator commands, sign-off index, source-state approval list, action plan by role/section, CSV/JSON action items for assignment, validator logs, file hashes, and readiness report references.
- `scripts/validate-go-live-bundle.js` now validates the generated bundle files, safety flags, action items, logs, and pending/fail state before attaching it to sign-off.
- `scripts/create-restore-drill-evidence-pack.js` now creates a non-mutating restore drill evidence template so operator results can be captured without touching production data.
- `scripts/validate-restore-drill-evidence.js` now validates restore target, approval evidence, backup sha256/gzip result, restore log patterns, row-count review, production-unchanged proof, and operator sign-off before the restore drill gate can count as PASS.

## Local Verification Evidence

| Check | Result |
|---|---|
| Backend unit tests | PASS: 36 suites, 374 tests |
| Backend `npm audit --json` | 0 vulnerabilities |
| Frontend `npm audit --json` | 0 vulnerabilities |
| Frontend build | PASS |
| Frontend UI label check | PASS |
| Frontend hybrid UI check | PASS |
| `git diff --check` | PASS; Windows LF/CRLF warnings only |
| `bash -n scripts/check-offhost-backup-config.sh` after read-only mode patch | PASS via Git Bash |
| `bash -n scripts/health-check.sh` | PASS via Git Bash |
| `bash -n scripts/production-readiness-gate.sh` | PASS via Git Bash |
| `bash scripts/production-readiness-gate.sh local` | PASS: pass=12, warn=0, fail=0 |
| `BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public` | PASS: pass=5, warn=0, fail=0 |
| `BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public` | PASS: `outputs/phase9-evidence/20260825-201200/summary.md` + parseable `manifest.json` |
| `node scripts/validate-phase9-evidence.js outputs/phase9-evidence/20260825-201200 --require-mode public` | PASS |
| `node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com` | PASS: `outputs/uat-evidence/20260825-200054/` created for 9 roles |
| `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/20260825-200054 --allow-pending` | PASS: structure valid, 240 UAT evidence fields pending |
| `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/20260825-200054` | EXPECTED FAIL until role evidence/sign-off fields are completed |
| `node scripts/validate-go-live-signoff.js --allow-pending` | PASS: template structure valid, pending sign-offs detected |
| `node scripts/validate-go-live-signoff.js` | EXPECTED FAIL until UAT/approval/evidence fields are completed |
| `node scripts/create-restore-drill-evidence-pack.js` | PASS: creates `outputs/restore-drill/<timestamp>/` template only; no DB/API/deploy actions |
| `node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp> --allow-pending` | PASS/PENDING allowed until operator fills real restore drill evidence |
| `node scripts/verify-100-readiness.js --allow-pending` | PASS/PENDING allowed; restore drill evidence remains PENDING until operator evidence validator passes |
| `node scripts/verify-100-readiness.js` | EXPECTED FAIL until sign-off and scorecard are final 100% |
| `node scripts/create-go-live-bundle.js --allow-pending` | PASS/PENDING allowed: creates `summary.md`, `SOURCE_STATE.md`, `ACTION_PLAN.md`, and `ACTION_ITEMS.csv/json` without production writes |
| `node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp> --allow-pending` | PASS/PENDING allowed: validates bundle structure, action items, logs, and safety flags |

## Production Evidence Already Collected Read-only

| Item | Evidence |
|---|---|
| Backend process | PM2 online, restarts 0 at check time |
| Public site | root URL returned HTTP 200 at check time |
| Auth guard | Phase 9 gate uses no-token `/api/auth/me` 401 to avoid invalid-login audit writes |
| Public external gate | PASS: root 200, no-token auth 401, reports auth guard 401, parent pages 200 |
| Health | `/health` success true and DB connected |
| Local backup | latest backup verified gzip/sha256/content OK |
| Off-host backup | sync log showed latest backup on remote listing |
| Restore readiness | not ready because drill DB does not yet exist |
| Runtime version evidence | production mismatch observed; code patch now prefers git HEAD; deploy smoke still required |
| Phase 9 gate runner | local mode verified; production/postdeploy modes require operator execution on server |

## Stop Conditions Before Calling 100%

- UAT sign-off must be completed for admin, province, affiliation, school, driver, transport, parent/LINE, and operator.
- `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>` must PASS without `--allow-pending`.
- `node scripts/validate-go-live-signoff.js` must PASS without `--allow-pending`.
- `node scripts/verify-100-readiness.js` must PASS without `--allow-pending`.
- Restore drill must run against `lampang_bus_restore_drill` and prove production aggregate counts unchanged.
- `node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>` must PASS without `--allow-pending`.
- DPO/legal must sign off consent/QR/LINE policy before enabling gated privacy features.
- Owner must approve deployment and any feature flag change explicitly.
- Post-deploy smoke must prove `/health.data.commit` equals deployed git HEAD.

## Immediate Next Actions

1. Owner/operator reviews this scorecard, `docs/UAT_SIGNOFF_2026-08.md`, and `docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md`.
2. Operator creates `lampang_bus_restore_drill` with a privileged MySQL user.
3. Team creates UAT evidence pack with `node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com`, then runs sandbox UAT for all write workflows.
4. Owner approves deploy of the current worktree branch.
5. Run public external gate against `https://schoolbuslampang.com`.
6. Generate Phase 9 evidence pack and attach it to owner/operator sign-off.
7. Fill UAT evidence pack and run `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>`.
8. Transfer final PASS/evidence links into sign-off docs and run `node scripts/validate-go-live-signoff.js`.
9. Run `node scripts/verify-100-readiness.js --allow-pending` and attach the preliminary `outputs/go-live-readiness/<timestamp>/summary.md`.
10. Run `node scripts/create-restore-drill-evidence-pack.js` before the approved restore drill to reserve the evidence folder.
11. Run `bash scripts/production-readiness-gate.sh production`, then the approved restore drill with log captured into `outputs/restore-drill/<timestamp>/`, then `node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>`.
12. After approved deployment, run `bash scripts/production-readiness-gate.sh postdeploy`, role/LINE LIFF smoke, and 30-60 minute monitor.
13. Run `node scripts/create-go-live-bundle.js --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp>`, run `node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp>`, and attach `summary.md`, `SOURCE_STATE.md`, `ACTION_PLAN.md`, and `ACTION_ITEMS.csv`.
