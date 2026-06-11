# Release 10.13B — Admin-Free Core

**Tag:** `release-10.13B-admin-free-core` · **Commit:** `eba05f5`
**Date:** 2026-06-11 · **System:** ระบบรถรับส่งนักเรียนจังหวัดลำปาง

The 10.13B line removes the manual-SQL / admin dependency from normal school and
operator workflows. Schools self-serve imports, corrections, and requests; admins
approve through UI/API; operations are monitored daily. No business workflow in
this release requires SSH or raw SQL.

## Phase summary

| Phase | Commit | What it delivered |
|-------|--------|-------------------|
| 10.13B-1 | 245e384 | Security/PDPA hardening — retained-file chmod, CSV formula-injection neutralize, audit PII redaction, generic disabled-login, cleanup cron |
| 10.13B-2 | a749f6f | Atomic student-id allocator (`id_sequences`) — race-proof inserts |
| 10.13B-3 | 61d22ca | DB-level vehicle canonical identity + one-active-driver-per-vehicle (generated cols + UNIQUE) |
| 10.13B-4 | 568eae5 | Import self-service apply modes — guardian update + soft-deleted reactivation (confirmed) |
| 10.13B-5 | 547bb54 | Import history, rollback & correction center + duplicate-row-in-file detection |
| 10.13B-6 | 7ccf079 | Student transfer / wrong-school request→approve workflow (Option B) |
| 10.13B-7 | a2aed40 | Vehicle restore / shared-fleet request→approve workflow |
| 10.13B-8 | 06a7dfd | Driver lifecycle & assignment wizard (preflight, restore, reassign, deactivate) |
| 10.13B-9 | eba05f5 | Operations monitoring (integrity-monitor + cron), health endpoint, restore/off-host readiness |

## Release baseline counts (2026-06-11)

- active students **980** · active drivers **35** · active vehicles **35** · soft-deleted vehicles **58**
- orphan active assignments **0** · duplicate (school_id, student_code) **0**
- active canonical vehicle duplicates **0** · duplicate active assignment per vehicle **0**
- integrity monitor: **WARN, 0 CRITICAL** · latest backup: **PASS** · migrations: **0 untracked / 0 drift**

## Admin-free capability matrix

Legend: **School** = school user self-service · **Admin-UI** = admin via UI/API · **Infra** = SSH/config (one-time).

| # | Workflow | Path |
|---|----------|------|
| 1 | Student import preview | School |
| 2 | Import apply new rows | School |
| 3 | Cross-school same student_code as separate student | School (auto, no transfer) |
| 4 | Same-school duplicate handling (skip) | School |
| 5 | Guardian mismatch confirmed update | School (confirm) |
| 6 | Same-school soft-deleted student reactivation | School (confirm) |
| 7 | Import history reopen | School |
| 8 | Import report download after modal close | School |
| 9 | Import rollback of inserted rows | School |
| 10 | Duplicate-row-in-file detection | School (auto) |
| 11 | Student transfer / wrong-school request | School (request) |
| 12 | Transfer approve / reject | Admin-UI |
| 13 | Soft-deleted vehicle restore request | School (request, also from import row) |
| 14 | Vehicle restore approve / reject | Admin-UI |
| 15 | Shared-fleet use request (informational) | School (request) / Admin-UI |
| 16 | Vehicle canonical duplicate prevention | DB-enforced (automatic) |
| 17 | Active driver-vehicle assignment duplicate prevention | DB-enforced (automatic) |
| 18 | Driver preflight | Admin-UI |
| 19 | Driver restore (canonical) | Admin-UI |
| 20 | Driver reassignment | Admin-UI |
| 21 | Driver deactivation | Admin-UI |
| 22 | Driver integrity dashboard | Admin-UI |
| 23 | Operations health endpoint | Admin-UI |
| 24 | Daily integrity monitor | Automatic (cron 03:15) |
| 25 | Backup verification | Automatic + script |
| 26 | Restore-test readiness | Script (Infra to enable real test) |
| 27 | Off-host backup readiness | Script (Infra to enable) |
| 28 | PM2 ecosystem adoption | Infra (planned window) |

**Normal school workflows (1–11, 13, 15) require no SQL.** Admin approvals (12, 14, 18–23)
are UI/API. DB constraints (16, 17) are automatic. Only infrastructure items (26–28) need SSH/config.

## Known warnings (expected, non-blocking)

The integrity monitor reports **WARN** at release, with **0 CRITICAL**. The WARNs are known:

- `vehicle_no_driver` = 1 — a vehicle awaiting a driver assignment.
- `driver_no_profile` = 5 — hold/unlinked driver accounts from earlier dedupe.
- `inactive_dup_candidates` = 58 — deactivated duplicate driver accounts (kept, not deleted).
- `blocked_reactivation_24h` — reactivation attempts blocked by the 23C guard (incl. QA smoke).
- `import_all_failed_7d` = 5 — legacy fully-failed import batches (historical).

See [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) for how to act on WARN vs CRITICAL.

## Deferred infrastructure (documented, safe)

1. **Off-host backup** — deferred until `scripts/offhost-backup-sync.env` is created; enablement path in the runbook.
2. **Real restore test** — deferred until a dedicated test DB + defaults-file exist (`restore-test-readiness.sh` is safe and ready).
3. **PM2 ecosystem adoption** — `ecosystem.config.js` added; adopt in a planned maintenance window.

## Pending operator data actions (not code)

- **บ้านบอม (52020147):** re-upload the 5-row student file via import preview.
- **ไหล่หิน (52020039):** provide the 4th vehicle plate + the 76-row file.
