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
| DATA-001 | in progress | | | |
| DOC-001 | todo | | | |
| PERF-001 | todo (PR only, no merge) | | | |
| PERF-002 | todo (PR only, no merge) | | | |

## Log
- 20:10 start; tracker created.
