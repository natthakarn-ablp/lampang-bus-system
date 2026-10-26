# Phase 10.3C — Screenshot Capture Status

> **Historical snapshot (ติดป้าย 5 ก.ย. 2569):** "Captured = 0" และ "`docs/manual/screenshots/` was not created" เป็นสถานะ 2026-05-14; ปัจจุบันมีไฟล์ภาพจริง 83 ไฟล์ใต้ `docs/manual-html/screenshots/` แยกโฟลเดอร์ตามบทบาท ห้ามใช้ tracker นี้เป็นสถานะปัจจุบันจนกว่าจะ reconcile
> สถานะจริงล่าสุด: `docs/project-closure/handoff-2026-09-05.md` · เหตุผลที่ติดป้าย: `docs/project-closure/current-status-2026-09-04.md` §5 (#29)

*Status date: 2026-05-14*
*Source commit: `5eaa00f`*

This document tracks the **execution** of the 10-batch screenshot capture plan defined in [phase-10-3b-screenshot-capture-plan.md](phase-10-3b-screenshot-capture-plan.md). The plan itself is unchanged.

**Top-line status:** **0 / ~85 screenshots captured. NOT READY for manual writing.**

> **How to update this document**
> After each batch, the operator should:
> 1. Replace the batch's `Status` from `NOT_STARTED` to `IN_PROGRESS` or `COMPLETE`
> 2. Set `Captured` to the actual count
> 3. Add any deviation notes (skipped items, blockers, redaction issues)
> 4. Append the executor's initials + date in the audit trail at the bottom
> Do **not** edit the batch definition (that lives in 10-3b) or the screenshot IDs.

## Legend

| Status | Meaning |
|---|---|
| `NOT_STARTED` | Operator has not begun this batch |
| `IN_PROGRESS` | Some screenshots captured, some pending |
| `COMPLETE` | All batch screenshots captured + redacted |
| `BLOCKED` | Cannot proceed (data prep / access / dependency issue) |

## Batch status

| # | Batch | Planned IDs | Time est. | Captured | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | Shared login / password | S-01, S-02, S-03, E-02 (4 IDs) | ~10 min | 0 | **NOT_STARTED** | Requires one disposable bulk-imported school account for S-03 |
| 2 | Admin | A-01 → A-11 (11 IDs) | ~25 min | 0 | **NOT_STARTED** | A-09 needs mobile viewport 390×844; A-04 verifies Phase 10.1A/B (5 affiliations in dropdown) |
| 3 | Province | P-01 → P-10 (10 IDs) | ~20 min | 0 | **NOT_STARTED** | P-07 uses Phase 9.11 plate autocomplete |
| 4 | Affiliation + bulk import (**headline**) | F-01 → F-13 (13 IDs) | ~35 min | 0 | **NOT_STARTED** | Requires crafted 3-row Excel (valid / dup / missing-name) per 10-3b §Batch 4 |
| 5 | School full account | H-01, H-02, H-04 → H-12 (11 IDs) | ~25 min | 0 | **NOT_STARTED** | Depends on Batch 7 step D-09 to populate roster-change-request for H-10 |
| 6 | School grade-teacher | H-03 + UAT-4-result (2 IDs) | ~10 min | 0 | **NOT_STARTED** | Depends on Batch 5 step H-11 creating the grade-teacher account |
| 7 | Driver mobile (**all 390×844**) | D-01 → D-09 (9 IDs) | ~30 min | 0 | **NOT_STARTED** | Use viewport emulator; driver login = plate number e.g. `นข 1571 ลำปาง` |
| 8 | Transport | T-01 → T-07 (7 IDs) | ~15 min | 0 | **NOT_STARTED** | Result dropdown must show PASSED/FAILED/NEEDS_FIX/PENDING |
| 9 | Parent LINE OA | L-01 → L-09 + UAT-3-result (10 IDs) | ~30 min | 0 | **NOT_STARTED** | Requires LINE friend account + bot config; L-08/L-09 triggered by Batch 7 driver actions |
| 10 | Error / empty states | E-01, E-02, E-03, E-04, E-05, E-06, E-07 (7 IDs) | ~15 min | 0 | **NOT_STARTED** | Many captures can be picked up opportunistically during earlier batches |
| **Total** | | **~85 IDs** | **~3 h 35 min** | **0** | **NOT_STARTED** | |

## Ready for manual writing?

**NO.**

Per the Phase 10.3B plan, the manual cannot begin authoring until:

1. All 10 batches are `COMPLETE` (or explicit operator decision to defer specific batches)
2. The companion document [phase-10-3c-uat-results.md](phase-10-3c-uat-results.md) is filled in (UAT-3 result in particular feeds Batch 9 step 6, UAT-4 feeds Batch 6 step 2)
3. Captured images are stored under `docs/manual/screenshots/<batch-N>/` per Phase 10.3B naming convention (e.g. `A-04-create-user-modal.png`)
4. Redaction sweep complete (names / phone / LINE user-id / school code per Phase 10.3A § "Capture rules")

## Pre-flight checklist before Batch 1

The operator should confirm each item below before opening the first capture tool:

| # | Item | Verification |
|---|---|---|
| 1 | Browser at zoom 100 %, devtools closed | visual check |
| 2 | Desktop viewport 1440×900; mobile preset 390×844 ready (iPhone 12/13 emulator) | browser devtools settings |
| 3 | Phase 10.1A/B migrations applied → 5 affiliations visible | `MYSQL_PWD=… mysql -e "SELECT id, name FROM affiliations WHERE is_deleted=FALSE ORDER BY id"` shows 5 rows |
| 4 | Phase 10.2A endpoints reachable → live commit ≥ `db9ca0e` | `curl -s http://127.0.0.1:3000/health \| python3 -m json.tool \| grep commit` |
| 5 | ≥ 3 vehicles actively sending GPS for the live-vehicle batches | `/admin/live-vehicles` shows ≥ 3 active markers |
| 6 | Test accounts available (one per role) — passwords in operator's password manager only, never in chat | manual check |
| 7 | Local copy of `manual-demo-affiliation-import.xlsx` (3-row file) ready, not committed | per Phase 10.3B Batch 4 |
| 8 | Screenshot output dir created locally: `docs/manual/screenshots/` | `mkdir -p docs/manual/screenshots/{batch-1,batch-2,…,batch-10}` |
| 9 | Phase 9 monitoring still active (smoke timer + alert timer + heartbeat) | `systemctl is-active schoolbus-health-*.timer` |

## Batch-to-batch data dependency map

To avoid backtracking, the operator should follow this order (carried forward from Phase 10.3B §"Capture order recommendation"):

```
Batch 1 (Shared)
   └─ S-03 needs a fresh-imported school account → produced by Batch 4
       (do Batch 4 first if convenient, or use admin-reset on a test account)

Batch 4 (Affiliation + bulk import)  ← largest, do this when fresh
   ├─ produces a new school + account (Section C row)
   ├─ feeds Batch 1 step S-03
   └─ feeds Batch 5 step H-04/H-05 with student rows

Batch 5 (School full account)
   ├─ H-10 needs a pending roster-change-request → produced by Batch 7
   ├─ H-11 creates the grade-teacher account → feeds Batch 6
   └─ Run AFTER Batch 7 if H-10 is critical

Batch 7 (Driver mobile)
   ├─ submits one roster-change-request → feeds Batch 5 H-10
   ├─ driver checkin/checkout triggers LINE push → feeds Batch 9 L-08/L-09
   └─ Run BEFORE Batch 9

Batch 6 (Grade-teacher)
   └─ Run AFTER Batch 5 step H-11

Batches 2, 3, 8 (Admin, Province, Transport)
   └─ Independent; can be done any time

Batch 9 (Parent LINE OA)
   ├─ Needs Batch 7 to have triggered checkin events
   └─ Captures UAT-3 result alongside L-02

Batch 10 (Error / empty states)
   └─ Pick up opportunistically during the above batches
```

Following this order saves ~30 min of re-setup.

## Capture audit trail

| Date | Executor | Batches affected | Captured added | Status changes | Notes |
|---|---|---|---|---|---|
| 2026-05-14 | AI agent (Phase 10.3D session) | none | **0** | none | The 10 batches all require a real browser session (Batches 1-5, 8, 10), a real mobile-viewport browser (Batch 7), or a real LINE OA + mobile app (Batch 9). The AI agent in this CLI session cannot drive a browser, capture screen output, install Playwright/Puppeteer (not approved by this phase's strict rules + the long-standing "no npm dependencies" rule), or use LINE OA. Per the prompt's `"Do not mark COMPLETE unless screenshots exist and are redacted"` rule, every batch remains `NOT_STARTED` with Captured = 0. `docs/manual/screenshots/` was **not** created — no images exist to put there. A human operator following [phase-10-3b-screenshot-capture-plan.md](phase-10-3b-screenshot-capture-plan.md) is required. |
| 2026-06-28 | AI agent (Phase 10.14 session) | new **Batch 11 — Phase 10.14** | 0 | added checklist + UAT plan (handoff) | Phase 10.14 (driver registration + documents) + the 28 มิ.ย. self-service round (dynamic term, transport doc review, policy report) added a new screenshot batch: [phase-10-14-screenshot-checklist.md](phase-10-14-screenshot-checklist.md) (IDs D-16…19, H-13…16, T-05, A-16) + acceptance plan [UAT-phase-10-14.md](../UAT-phase-10-14.md). Same blocker as 2026-05-14 — operator-run with real seed accounts + PII redaction (live UAT also mutates prod). Captured = 0; **handed off to the operator**. |

## Snapshot summary

- **0 / ~85 captured**
- **0 / 10 batches complete**
- **Estimated remaining time: ~3 h 35 min** (one focused half-day, or two half-days)
- **Ready for manual writing: NO**

When this document reports `Total Captured: ≥ 80 / 85` AND all 10 batches show `COMPLETE` or explicitly-deferred, AND [phase-10-3c-uat-results.md](phase-10-3c-uat-results.md) reports `5/5 operator-executed`, Phase 10.3 is closed and the actual manual-writing phase (a future Phase 10.4) can begin.
