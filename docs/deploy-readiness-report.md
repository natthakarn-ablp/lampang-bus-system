# Deploy Readiness Report — Lampang Bus System

**Generated:** 2026-04-03
**Branch:** main
**Git status:** Clean (committed)

## Infrastructure

| Component | Status |
|-----------|--------|
| MySQL 8.0 (Docker) | Running, healthy |
| Adminer | Running on :8080 |
| Backend (Node.js) | Local dev (nodemon) |
| Frontend (Vite) | Local dev |
| Dockerfile | NOT EXISTS |
| Nginx config | NOT EXISTS |
| Thai font (backend PDF) | NOT EXISTS |

## Migrations

| Migration | Content | Status |
|-----------|---------|--------|
| 001_initial_schema.sql | 22 tables + indexes | ✅ Applied |
| 008_phase8_leaves_requests.sql | student_leaves + roster_change_requests + photo_url | ✅ Applied |
| 009_roster_request_new_student.sql | student_id nullable + new_student_data JSON | ✅ Applied |
| 010_must_change_password.sql | users.must_change_password column | ✅ Applied |

## Accounts

| Role | Count | Password status |
|------|-------|----------------|
| admin | 1 | Changed (secure) |
| school | 3 | Default '1234' — RISK |
| driver | 57 | Default '1234' — RISK |
| affiliation | 5 | Default '1234' — RISK |
| province | 1 | Default '1234' — RISK |

## Smoke Test Results

| # | Test | Result |
|---|------|--------|
| 1 | Admin login | NOT VERIFIED (password unknown) |
| 2 | Force change password | NOT VERIFIED |
| 3 | Admin province dashboard | NOT VERIFIED |
| 4 | School login | ✅ PASS |
| 5 | Create vehicle + driver | ✅ PASS |
| 6 | Driver first login | ✅ PASS |
| 7 | PDF print summary | NOT VERIFIED (browser) |
| 8 | Audit log + filters | ✅ PASS (after collation fix) |
| 9 | Leave flow | NOT VERIFIED (browser) |
| 10 | Emergency count | ✅ PASS |

## Bugs Fixed During Audit

1. **Collation mismatch in audit-logs** — `CAST(s.id AS CHAR)` without explicit collation caused 500 error on school and affiliation audit endpoints. Fixed by adding `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`.

## Release Decision

**DEPLOY WITH CONDITIONS**

Conditions:
1. Admin password must be reset or known before production go-live
2. All seeded passwords should be changed for production
3. Browser-based tests (PDF, leave flow, UI navigation) must pass manually
4. Backend collation fix must be committed
