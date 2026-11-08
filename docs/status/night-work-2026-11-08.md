# Night work 2026-11-08 — task tracker (checkpoint)

Source: owner brief 2026-11-08 night + `SYSTEM_AUDIT_2026-11-08_1325.md` (kept outside the repo, `worktrees/arch-audit/audit-reports/`).
Work clone: `D:\Projects\SchoolBus-Lampang\worktrees\night-1108` (LF, `core.autocrlf=false`). Main checkout untouched.

## Starting state (verified 2026-11-08 ~20:10 ICT)
- Production `/health` commit `ebea699` (= `origin/feat/tracking-security-hardening` HEAD ebea6997b523394d8a2e727f4abe6992370d970b).
- Migrations 052/053 not applied (deliberate). Do not apply.
- Health-smoke systemd timer runs `health-smoke.sh` every 30 min; `health-smoke-alert.sh` (LINE to TECH target) is NOT wired.

## Owner answers (asked once at start)
1. Backup alerts → reuse the existing TECH LINE target in `/etc/schoolbus/health-alert.env`; **no real test send** — mock only, enabling steps prepared.
2. Backup-status cron → **prepare only, do not install** tonight.
3. Restore drill → **synthetic data in CI only**; real-backup restore stays unproven.

## Tasks
| ID | Status | Branch / PR | Evidence | Remaining |
|---|---|---|---|---|
| DATA-001 | merged; deploy pending CI of merge SHA | PR #147 → merge `07a7e4f507d67b01e73a7a2c103702199a6f16c5` | PR CI runs 42484151024/42484169643 green; synthetic round trip 62 tables 0 mismatch (backup 0.5 s, restore 2.1 s); `test-backup-status.py` 21/21; prod read-only run: local/offhost/readback OK, restore UNPROVEN | cron+alert install (owner), rclone own client_id (owner Google login), real-backup restore in isolated env, CRON_TZ finding |
| DOC-001 | in progress (module drafts by one Sonnet agent) | branch `docs/doc-001-system-index` | | |
| PERF-001 | PR open, label needs-owner, NOT merged | PR #148 (`6861b79`) | local unit 8/8 + related 78/78; CI pending | owner: merge, apply 059, enable dispatch |
| PERF-002 | todo (PR only, no merge) | | | |

## Log
- 20:10 start; tracker created.
- 20:20 owner answers recorded (defaults).
- 20:14 prod read-only backup_status run OK (see DATA-001).
- Finding: prod cron ignores CRON_TZ (host UTC) → backup 09:30 ICT. Not changed.
- Finding: no LINE dispatcher scheduled on prod (no cron/timer/dispatch.log).
- Prod DB aggregate query (notification counts) was DENIED by the session's safety classifier → table sizes unmeasured.
- 21:0x PR #147 merged → 07a7e4f. PR #148 opened (needs-owner).
