# Phase 9 Closeout — Production Hardening Series

*Closed: 2026-05-14*
*Final production HEAD: `b520d58`*

---

## 1. Executive Summary

Phase 9 was a 21-step production hardening series that took the Lampang Bus
System from "running but fragile" to "monitored, alertable, and
operationally documented." The series began as a triage of a disk-pressure
incident on 2026-05-13 and grew into the full operator surface that runs
the service today:

- Frontend reachability + backend `/health` enrichment with safe
  operational metadata (service / version / commit / env / DB-connected).
- A read-only smoke script (`scripts/health-smoke.sh`) that exits 0 on
  PASS/BASELINE/WARN and 1 on FAIL, with a documented `[BASELINE]`
  category for known historical signals so steady-state runs stay silent.
- A passive systemd watchdog (every 30 min) that records every smoke run
  to the journal.
- A FAIL-only LINE alerter with 6-hour debounce on identical signatures,
  optional recovery notification, and a weekly heartbeat that proves the
  alert pipeline itself is still alive.
- A weekly housekeeping timer for journal/apt vacuum, plus a one-time
  LVM expansion (11 GB → 22 GB) and tmpdir / lock-contention triage.
- UX / UI polish across plate-search autocomplete, dropdown auto-flip,
  responsive layouts, label standardization, and cross-role visual
  consistency.

The closing run of `bash scripts/health-smoke.sh` returns
`PASS: 14   BASELINE: 3   WARN: 0   FAIL: 0   SKIP: 0` with verdict
`HEALTH SMOKE PASSED WITH BASELINED OBSERVATIONS` and exit code 0. All
four systemd timers (`-smoke`, `-alert`, `-heartbeat`, `housekeeping`)
report `active`. Operator browser UAT (14 rows in Section 5 below) is
14/14 PASS.

Phase 9 is **CLOSED**. The system is ready for maintenance mode or
Phase 10 planning at the operator's discretion.

---

## 2. Final Production State

| Item | Value |
|---|---|
| Git HEAD | `b520d58` — `chore(ops): add alert debounce and weekly heartbeat` |
| Working tree | clean except `.claude/settings.json` (allowlisted, never staged) |
| Frontend | `https://schoolbus.503200.xyz` → HTTP/2 200 via Cloudflare |
| Backend `/health` | `success=true`, `service=lampang-bus-backend`, `version=1.0.0`, `environment=production`, `node_version=v20.20.2`, `commit=b520d58` (matches HEAD), `database.connected=true`, `uptime≈850 s` |
| Smoke result | `PASS: 14   BASELINE: 3   WARN: 0   FAIL: 0   SKIP: 0` → `HEALTH SMOKE PASSED WITH BASELINED OBSERVATIONS` (exit 0) |
| `schoolbus-health-smoke.timer` | active, fires every 30 min |
| `schoolbus-health-alert.timer` | active, fires every 30 min (5 min offset from smoke) |
| `schoolbus-health-heartbeat.timer` | active, `OnCalendar=Mon 08:00 UTC` |
| `schoolbus-housekeeping.timer` | active, weekly (Sun 03:30 UTC) |
| LINE alert — PASS path | silent (verified — last 2 alerter runs logged `"No alert sent (smoke exit 0)"`) |
| LINE alert — FAIL path | delivers (verified during Phase 9.18 — `ALERT DELIVERED via LINE push (HTTP 200)`) |
| LINE alert — heartbeat | delivers (verified during Phase 9.19 — `HEARTBEAT DELIVERED via LINE push (HTTP 200)`) |
| Disk `/` | 22 GB total / 9.2 GB used / 12 GB avail / **45 %** used |
| Inode `/` | **14 %** used |
| PM2 | `schoolbus-backend` pid `624304`, online, restart count 87 (controlled reloads only — no crash restarts), 53.9 MB RSS |
| MySQL | `Innodb_row_lock_current_waits=0`, `Innodb_row_lock_waits=16` lifetime (= baseline), `tmpdir=/tmp`, `Created_tmp_disk_tables=4`, `Uptime≈2 992 000 s` (~34.6 days) |

---

## 3. Phase 9 Inventory

| Phase | Commit | Type | Purpose | Production status | Notes |
|---|---|---|---|---|---|
| 9.1 | `44be400` | security fix | Rate-limit proxy handling (trust proxy = 1 for Cloudflare → nginx → backend chain) | LIVE | First commit of the series |
| 9.2 | *(ops action — no commit)* | infra | LVM root expansion 11 GB → 22 GB via operator SSH | LIVE | Triggered by 2026-05-13 ENOSPC incident |
| 9.3 | `d2ad677` | search UX | Prefer human-readable search fields | LIVE | — |
| 9.4 | `85b7e34` | search UX | Searchable filter dropdowns | LIVE | — |
| 9.5 | `33c7359` | search UX | Improve mobile dropdown popover layout | LIVE | — |
| 9.6 | `6b5334a` | test alignment | Align backend tests with current API contract | LIVE | 166/166 tests passing |
| 9.7 | `af34b4b` | docs/ops | Triage user + disk rotation runbook | LIVE | `docs/phase-9-ops-notes.md` born here |
| 9.8B | `bd8401f` | search UX | Auto-flip searchable dropdown popover | LIVE | — |
| 9.9 | `b9d9264` | search UX | Plate-number autocomplete (`PlateSearchInput`) | LIVE | — |
| 9.10A | *(ops action — no commit)* | ops | Triage MySQL user provisioning + housekeeping timer install | LIVE | Executed Phase 9.7 runbook |
| 9.11 | `66d82d8` | search UX | Daily-status plate autocomplete | LIVE | — |
| 9.12 | `54349f6` | search UX | Admin live-vehicle autocomplete | LIVE | — |
| 9.12 Hotfix 1 | `190237b` | search UX | Prevent admin live-vehicle search collapse on mobile | LIVE | — |
| 9.12 Hotfix 2 | `58e184a` | search UX | Stabilize admin live-vehicle mobile filters + simplify chips (7→5) | LIVE | — |
| 9.13 | *(UAT/static regression — no commit)* | regression | Static + manual regression closeout | PASSED | — |
| 9.14 | `6315344` | health | Enrich backend `/health` diagnostics (service / version / commit / env / DB-connected) | LIVE | Adds `backend/src/utils/health.js`, 3 new tests |
| 9.15 | `19a5c37` | ops script | Production health smoke script | LIVE | `scripts/health-smoke.sh` (Phase 9.15 banner) |
| 9.16 | `2c02aaf` | ops script | Baseline known smoke warnings (new `[BASELINE]` category) | LIVE | `BASELINE_INNODB_ROW_LOCK_WAITS=16`, `BASELINE_PM2_CRITICAL_MATCHES=7`, `BASELINE_MYSQL_UPTIME_GUARD_SECONDS=86400` |
| 9.17 | `70a995b` | systemd | Smoke watchdog timer (passive monitoring) | LIVE | `ops/systemd/schoolbus-health-smoke.{service,timer}` |
| 9.18 | `efbf49c` | systemd | FAIL-only LINE alerting | LIVE | `scripts/health-smoke-alert.sh` + `ops/systemd/schoolbus-health-alert.{service,timer}` + `/etc/schoolbus/health-alert.env` |
| 9.19 | `b520d58` | systemd | Alert debounce + weekly heartbeat | LIVE | 6h debounce, recovery notification, `scripts/health-smoke-heartbeat.sh`, `OnCalendar=Mon 08:00`, state dir `/var/lib/schoolbus/health-alert/` |
| 9.20 | *(final regression — no commit)* | regression | Final production regression with baselined observations | PASSED | 17/17 areas PASS in regression matrix |
| 9.21 | *(this document)* | docs | Phase 9 series closeout | THIS COMMIT | `docs/phase-9-closeout.md` |

**Counts:** 18 commits + 4 ops/UAT phases without commits + 1 closeout
doc commit = **21 phases shipped**.

---

## 4. Monitoring and Operations Runbook Quick Reference

One-liner per artifact. For full detail see `docs/phase-9-ops-notes.md`
(the live runbook).

| Artifact | One-liner |
|---|---|
| `scripts/health-smoke.sh` | Read-only post-deploy / post-incident smoke. Exits 0 on PASS/BASELINE/WARN, 1 on FAIL. Runs in ~3 s. **Run:** `bash scripts/health-smoke.sh` |
| `scripts/health-smoke-alert.sh` | Runs smoke; LINE push only on FAIL with 6h debounce + recovery on PASS-after-FAIL. **Run:** typically driven by `schoolbus-health-alert.timer`; manual `bash scripts/health-smoke-alert.sh` for dry-run (no creds in shell → safe no-op message) |
| `scripts/health-smoke-heartbeat.sh` | Weekly proof-of-life. Skipped during incidents. **Run:** via `systemctl start schoolbus-health-heartbeat.service` for one-shot |
| `schoolbus-health-smoke.timer` | Watchdog. Runs smoke every 30 min, logs to journal. **Status:** `systemctl status schoolbus-health-smoke.timer`. **Logs:** `journalctl -u schoolbus-health-smoke.service` |
| `schoolbus-health-alert.timer` | FAIL-only alerter, every 30 min, 5 min offset from watchdog. **Disable:** `sudo systemctl disable --now schoolbus-health-alert.timer` |
| `schoolbus-health-heartbeat.timer` | Weekly LINE heartbeat, Mon 08:00 UTC. **Disable:** `sudo systemctl disable --now schoolbus-health-heartbeat.timer` |
| `schoolbus-housekeeping.timer` | Weekly journal/apt vacuum, Sun 03:30 UTC. **Disable:** `sudo systemctl disable --now schoolbus-housekeeping.timer` |
| `/var/lib/schoolbus/health-alert/` | Debounce state dir. Owner `schoolbus:schoolbus` `0750`. Contains hashes + epoch ints + `PASS`/`FAIL` — never secrets. **Reset:** `sudo rm /var/lib/schoolbus/health-alert/last_*` |
| `/etc/schoolbus/health-alert.env` | LINE credentials for alerter + heartbeat. Owner `root:schoolbus` `0640`. **Outside the repo.** **Rotate:** edit file in SSH, then `sudo systemctl restart` either alert or heartbeat timer is **not** needed (env is re-read per fire). |
| Common journal greps | `journalctl -u schoolbus-health-alert.service --since '7 days ago' \| grep -E "DELIVERED\|NOT DELIVERED\|Duplicate FAIL\|recovery"` |
| Inspect debounce state (safe) | `for f in /var/lib/schoolbus/health-alert/*; do echo "=== $f ==="; cat "$f"; echo; done` |
| Full nuclear disable of outbound alerts | `sudo systemctl disable --now schoolbus-health-alert.timer schoolbus-health-heartbeat.timer` — passive watchdog keeps recording |

---

## 5. Browser UAT Sign-off

Operator-executed checklist on the production domain.

| # | Item | Result |
|---|---|---|
| 1 | `/login` with wrong password | **PASS** |
| 2 | `/login` with real admin credentials | **PASS** |
| 3 | `/admin` dashboard | **PASS** |
| 4 | `/admin/live-vehicles` (desktop) | **PASS** |
| 5 | `/admin/live-vehicles` (mobile) | **PASS** |
| 6 | `/affiliation/status` plate autocomplete | **PASS** |
| 7 | `/province/status` plate autocomplete | **PASS** |
| 8 | `/school/pickup-map` | **PASS** |
| 9 | `/affiliation/pickup-map` | **PASS** |
| 10 | `/driver/pickup-map` | **PASS** |
| 11 | Reports / export — Excel | **PASS** |
| 12 | Reports / export — CSV | **PASS** |
| 13 | Logout | **PASS** |
| 14 | Protected route after logout redirects to `/login` | **PASS** |

**Counts: 14 PASS / 0 WARN / 0 FAIL.**

---

## 6. Accepted Baselines

These signals are *expected* in steady state and have been promoted to
`[BASELINE]` in the smoke script (Phase 9.16). They do not trigger
alerts. If any of them moves past the recorded threshold the smoke
script automatically re-promotes the signal to `[WARN]` or `[FAIL]`.

| Baseline | Recorded value | Constant in `scripts/health-smoke.sh` | Origin |
|---|---|---|---|
| `.claude/settings.json` untracked | always present, never staged | (allowlist hardcoded in Section A logic) | repo policy |
| `Innodb_row_lock_waits` lifetime | 16 | `BASELINE_INNODB_ROW_LOCK_WAITS=16` | 2026-05-13 ENOSPC / lock-wait incident; counter does not decay without MySQL restart |
| PM2 critical-pattern log matches | 7 | `BASELINE_PM2_CRITICAL_MATCHES=7` | Same incident; lines 712–718 of `schoolbus-backend-error.log` |
| MySQL uptime guard | ≥ 24 h | `BASELINE_MYSQL_UPTIME_GUARD_SECONDS=86400` | Safeguard: a freshly-started MySQL won't silently hide new contention behind the historical lock baseline |

Reset procedure (after operational events) is documented in
`docs/phase-9-ops-notes.md` Section 13.5.

---

## 7. Carry-forward Items

These are small, non-blocking observations that survived Phase 9 and
will be picked up in maintenance mode or a future phase.

| # | Item | Surface | Impact | Suggested fix |
|---|---|---|---|---|
| 1 | `schoolbus-housekeeping.service` line 3 `Documentation=` missing `file:` URI scheme | Every `systemd-analyze verify` prints a warning attributed to this line | None functional — the unit runs correctly. The warning is cosmetic. | One-line edit in `ops/systemd/schoolbus-housekeeping.service` (if the file is tracked there) plus `sudo install` + `sudo systemctl daemon-reload`. Defer to next maintenance window or fold into Phase 10. |
| 2 | Deploy script churn / cosmetic restart count | PM2 restart count is 87 after the 9.14–9.19 controlled reloads | None functional | Already mitigated in `docs/phase-9-ops-notes.md` Section 11; only matters if it grows during normal traffic (it does not). |
| 3 | Phase 9.16 baseline-fingerprint collision edge case | If exactly 7 historical PM2 lines rotate out *and* exactly 7 new critical lines appear between two runs, the count stays 7 | Theoretical only — never observed | Mitigated by daily smoke cadence (rotation events are weekly). Documented in `docs/phase-9-ops-notes.md` Section 13.6. |

---

## 8. Recommended Phase 10 Candidates

Not implementation — just options for the next planning round. None are
required to operate the system today; Phase 9 has it covered.

| Candidate | Rationale | Rough scope |
|---|---|---|
| **Incident severity tiering** | Distinguish "DB down" / "5xx flood" / "disk ≥ 90 %" from routine commit-drift WARN. Embed severity in the smoke output. | Smoke + alerter: parse failing-check name into a tag; map tag → per-tier debounce window |
| **Alerter escalation policy** | Unresolved FAIL > N hours → second LINE message with a different chat target / additional on-call ping | Alerter: track `first_seen_time` per signature; cross threshold → escalate |
| **Frontend build / version surface** | A small read-only `/admin/about` panel calling `/health` and rendering service / version / commit / env / DB. Phase 9.14 enriched the data, no UI surfaces it yet. | Frontend: one route, one card; reuses existing data |
| **Operational health dashboard** | Render journal aggregates (last 7 d of smoke runs, FAIL/PASS ratio, last alert timestamp) on a single page for non-CLI operators | Frontend + small `/api/ops/*` endpoints + journal-export job; sized for a sprint |
| **Broader browser E2E smoke** | Today's smoke covers infra. Adding a few headless Puppeteer/Playwright scripts (login → render dashboard → export Excel) would catch frontend regressions before users do. | New `scripts/health-smoke-e2e.sh` driven by a separate weekly timer; CI parity |
| **Housekeeping `Documentation=` hygiene** | Carry-forward #1 above. Smallest possible micro-phase. | One-line edit + daemon-reload |

---

## 9. Final Declaration

**Phase 9 is CLOSED with carry-forward.**

- Production health: ✅ all green
- Smoke verdict: ✅ `HEALTH SMOKE PASSED WITH BASELINED OBSERVATIONS`
- Browser UAT: ✅ 14/14 PASS
- Monitoring pipeline: ✅ end-to-end verified (PASS quiet / FAIL delivered / heartbeat delivered)
- Carry-forward: 3 small, documented, non-blocking items (Section 7)

The Lampang Bus System is operating in a **monitored, alertable,
documented** state suitable for production maintenance mode. The next
phase boundary (Phase 10 planning or formal maintenance) is at the
operator's discretion. No code or infra change is required to remain
in this state.

---

*Document created: 2026-05-14 (Phase 9.21 — series closeout)*
