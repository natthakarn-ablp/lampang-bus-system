# Deploy record — `14f30bc..ccb7d12`

Range from the last recorded production deploy (`14f30bcaab72cb3be51bcbf72d31996c7e5a4a12`, see `deploy-2026-10-13-high-risk.md`) to the current head of `feat/tracking-security-hardening`, `ccb7d124a1ca852820dbb037d857f98950d56938` (merge of PR #35).

This record was written from the repository only. Nothing below was read from the server or the production database. Every field that needs server evidence reads "(รอกรอก)" (to be filled) and must be filled by whoever holds that evidence. "(รอกรอก)" means "not known", not "did not happen".

**Production status of migrations 052/053: ยังไม่ยืนยัน (unconfirmed).**

## Range contents

31 first-parent merges, PR #5 to #35 (merged 13–24 October 2026). There is no PR #4 in this range; it is the `14f30bc` merge itself.

| PR | Merged | Title |
|---|---|---|
| #5 | 2026-10-13 | Retry incident alerts and order backup transfer filters |
| #6 | 2026-10-13 | Move CI to Node 22 and prepare reversible runtime rollout |
| #7 | 2026-10-13 | Retry complete check-in transactions after deadlocks |
| #8 | 2026-10-13 | Update backend test tools and remove nodemon dependency chain |
| #9 | 2026-10-13 | Patch multipart upload parser and reject unsafe field expansion |
| #10 | 2026-10-13 | Separate database runtime and backup actors safely |
| #11 | 2026-10-13 | Recover interrupted database switch safely |
| #12 | 2026-10-14 | Patch frontend source-map build dependency |
| #13 | 2026-10-14 | feat(ops): version encrypted snapshot and cipher-only transfer tools |
| #14 | 2026-10-15 | fix(ops): withhold raw PM2 log records from health output |
| #15 | 2026-10-15 | fix(ops): use current routes and JSON health evidence in UAT |
| #16 | 2026-10-15 | fix(reports): count pending PDF rides per session |
| #17 | 2026-10-15 | fix(ui): report user and inspection load failures with retry |
| #18 | 2026-10-15 | fix(ui): respect grade-teacher vehicle permissions and retry failures |
| #19 | 2026-10-16 | fix(ui): preserve page headings beside header actions |
| #20 | 2026-10-17 | Simplify school pupil setup and daily attendance |
| #21 | 2026-10-17 | Publish reviewed frontend through locked deploy with rollback |
| #22 | 2026-10-17 | Align transport certification status and add vehicle-only export |
| #23 | 2026-10-18 | Deploy labelled role-based policy drafts for stakeholder review |
| #24 | 2026-10-18 | Prepare policy notices for 21 October meeting |
| #25 | 2026-10-18 | Add repeatable transport permission audit |
| #26 | 2026-10-18 | Add repeatable driver permission audit |
| #27 | 2026-10-19 | แก้หน้าความยินยอมคนขับให้ตรงกับ feature flag |
| #28 | 2026-10-20 | fix(ui): stabilize first-load dialogs on mobile |
| #29 | 2026-10-21 | feat(transport): audited vehicle and pupil incident view |
| #30 | 2026-10-21 | fix(transport): simplify incident lookup and full-name display |
| #31 | 2026-10-22 | Hide meeting-pilot dialogs for all staff roles |
| #32 | 2026-10-22 | Measure aggregate route latency before index tuning |
| #33 | 2026-10-22 | Add isolated six-role capacity rehearsal |
| #34 | 2026-10-24 | docs(manual): เขียนคู่มือทุกบทบาทใหม่เป็นภาษาง่าย + แก้ข้อบกพร่องที่พบ |
| #35 | 2026-10-24 | docs(manual): ภาพจริงของหน้าผู้ปกครองที่ผูกบัญชีแล้ว |

## Migrations in this range

Both arrived in PR #23 and are the only files added under `backend/migrations/` in this range.

| Migration | Added in | Creates | Production status |
|---|---|---|---|
| `052_policy_acknowledgements.sql` | `e976175` (PR #23) | `policy_acknowledgements` (FK `users.id`) | ยังไม่ยืนยัน |
| `053_policy_action_evidence.sql` | `548f528` (PR #23) | `policy_action_evidence` (FK `users.id`) | ยังไม่ยืนยัน |

`scripts/deploy-backend.sh` does not run migrations (`deploy-runbook-051-shared-security-state.md` §2). A code deploy of this range therefore says nothing about whether 052/053 were applied; that has to be checked against the database itself. 053 states it must be applied together with 052.

The PR #23 title says "Deploy …". That is the PR's intent, not evidence of a production deploy or of the migrations being applied.

## Production operations (UTC)

To be filled from server evidence only. Write "(รอกรอก)" (to be filled) rather than estimate a value.

| Time | Evidence |
|---|---|
| (รอกรอก) | Pre-deploy `/health` commit: (รอกรอก) |
| (รอกรอก) | Deploy lock absent in `deploy-state`: (รอกรอก) |
| (รอกรอก) | Pre-release database backup (file name, verified how): (รอกรอก) |
| (รอกรอก) | SHA-256 of `deploy-state/deploy-backend.sh` matches repo `scripts/deploy-backend.sh`: (รอกรอก) |
| (รอกรอก) | Migration 052 applied (how verified, `schema_migrations` row / DDL comparison): (รอกรอก) |
| (รอกรอก) | Migration 053 applied (how verified, `schema_migrations` row / DDL comparison): (รอกรอก) |
| (รอกรอก) | Backend deploy result (`deploy-history.log` line, server test count): (รอกรอก) |
| (รอกรอก) | Frontend publish result (`DEPLOY_FRONTEND=1`, `dist.prev-*` backup path): (รอกรอก) |
| (รอกรอก) | Post-deploy `/health` commit: (รอกรอก) |
| (รอกรอก) | Post-deploy health smoke (PASS / WARN / FAIL counts): (รอกรอก) |
| (รอกรอก) | `/manual/` and a protected API returning 401: (รอกรอก) |

Deployed commit: (รอกรอก)
Deploy date: (รอกรอก)
Operator: (รอกรอก)

## Verification limits and remaining work

- Whether any commit after `14f30bc` is live in production is not established by this record. External evidence recorded in `deploy-658f908.md` points to `658f908`, which contains this whole range, being live on 26 October 2026; the server-side rows above are still (รอกรอก).
- The status of 052/053 on production stays **ยังไม่ยืนยัน** until the rows above are filled from the database. Until then no build that requires those tables should be deployed.
- No server, database, LINE channel or production data was touched to write this record.

This record is not a PDPA certification or a guarantee that every risk is closed.
