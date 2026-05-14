# Phase 10.3B — Screenshot Capture Plan

*Audit date: 2026-05-14*
*Source commit: `d6497a4`*

Practical re-organization of the **~85 screenshots** catalogued in `phase-10-3a-screenshot-checklist.md` into 10 shooting batches. Each batch can be completed in a single sitting by one operator and minimizes account-switching. IDs (e.g. `S-01`, `A-04`) refer to the master checklist.

## Universal pre-flight

Before any batch:

1. **Browser:** Chrome or Firefox, latest stable, zoom 100 %, no extensions visible.
2. **Devtools:** closed.
3. **Resolution:**
   - Desktop captures: 1440 × 900 viewport
   - Mobile captures (driver chapter): 390 × 844 (iPhone 12/13 emulation)
4. **Data prep:**
   - Phase 10.1A/B migrations applied (5 affiliations in DB)
   - Phase 10.2A bulk import endpoint reachable (PM2 on `db9ca0e` or newer)
   - At least 1 driver actively sending GPS; live-vehicles map shows ≥ 3 vehicles
5. **Redaction rules** (re-stated from Phase 10.3A):
   - Real names → `นาย/นาง [ตัวอย่าง]`
   - Phone → `08X-XXX-XXXX`
   - LINE user-id → `Uxxx…xxx` (first 3 + last 3 only)
   - School code → `XXXXXX`
   - LINE access token / DB password / JWT — **never appears in any UI**, but still scan before posting
6. **File naming:** `<ID>-<short-slug>.png` (e.g. `A-04-create-user-modal.png`, `F-07-import-preview.png`).
7. **Output dir:** `docs/manual/screenshots/<batch-N>/` (created during manual-write phase, not in this audit).

---

## Batch 1 — Shared login / password (≈ 10 min)

**Goal:** Capture login states and the forced password-change flow that every role hits.

| Order | ID | Path | Account / state | Capture | Redact |
|---|---|---|---|---|---|
| 1 | S-01 | `/login` desktop | logged out | empty form | — |
| 2 | S-02 | `/login` mobile (390 × 844) | logged out | empty form | — |
| 3 | E-02 | `/login` after wrong password | logged out | error toast in Thai | — |
| 4 | S-03 | `/change-password` desktop | a fresh-imported school account (from Batch 4) OR an admin-reset account | force-redirect target page | username only — no password chars |

**Account prep:** create one disposable school account via Phase 10.2A bulk import (1 row), or have admin reset a test account just before this batch.

**Time:** ~10 min including login round-trips.

---

## Batch 2 — Admin (≈ 25 min)

**Account:** admin user (whose password the operator manages).

| Order | ID | Path | Setup | Capture | Mobile? |
|---|---|---|---|---|---|
| 1 | A-01 | `/admin` | seed data | full dashboard with KPI cards | no |
| 2 | A-02 | `/admin` | — | sidebar expanded showing 4 groups (จัดการระบบ / ตรวจสอบ / มุมมองจังหวัด / รายงาน) | no |
| 3 | A-03 | `/admin/users` | ≥ 10 users mixed roles | list + filter bar | no |
| 4 | A-04 | `/admin/users` → Create User modal | — | modal open with role=affiliation, organization dropdown showing all 5 AFFs (Phase 10.1A/B proof) | no |
| 5 | A-05 | `/admin/users` → Reset Password modal | pick any test user | confirmation modal copy | no |
| 6 | A-06 | `/admin/audit-logs` | ≥ 20 mixed log rows | filter UI + table | no |
| 7 | A-07 | `/admin/pickup-points` | ≥ 3 points / 2 vehicles | list + create form | no |
| 8 | A-08 | `/admin/live-vehicles` desktop | ≥ 5 active GPS | map + filter chips + plate-search popover | no |
| 9 | A-09 | `/admin/live-vehicles` mobile | same | stacked filter chips (Phase 9.12 Hotfix 2 proof) | **yes** |
| 10 | A-10 | `/admin/system-health` | live system | operational metrics view | no |
| 11 | A-11 | `/admin/research-export` | snapshots already computed | date range + preview counts | no |

**Time:** ~25 min including modal-open captures.

---

## Batch 3 — Province (≈ 20 min)

**Account:** province user (e.g. seed `lpg` or whatever exists).

| Order | ID | Path | Setup | Capture | Mobile? |
|---|---|---|---|---|---|
| 1 | P-01 | `/province` | seed | dashboard | no |
| 2 | P-02 | `/province` | — | sidebar — 6 groups visible | no |
| 3 | P-03 | `/province/affiliations` | 5 AFFs present | list + drill-down links | no |
| 4 | P-04 | `/province/schools` | ≥ 4 schools across 2 AFFs | list with affiliation filter | no |
| 5 | P-05 | `/province/students` | ≥ 30 students | search results + filter bar | no |
| 6 | P-06 | `/province/vehicles` | ≥ 5 vehicles mixed status | list + at-risk overlay | no |
| 7 | P-07 | `/province/status` (deep-link) | today's checkin data populated | daily status + plate autocomplete (Phase 9.11) | no |
| 8 | P-08 | `/province/live-vehicles` | live | live map | no |
| 9 | P-09 | `/province/pickup-map` | pickup points exist | read-only map + SearchableSelect filters | no |
| 10 | P-10 | `/province/audit-log` | logs present | audit + CSV export button | no |

**Time:** ~20 min.

---

## Batch 4 — Affiliation + bulk import (Phase 10.2A) (≈ 35 min — **headline batch**)

**Account:** one of `lpg1` / `lpg2` / `lpg3` / `lpglp` / `lpgpeo`. **Use a non-production affiliation** if available to avoid polluting real data.

**Pre-capture data prep:**
1. Identify or create a crafted Excel file with **3 rows**:
   - Row 1: valid (`123456` / `โรงเรียนทดสอบ ก` / `123456` / blank password)
   - Row 2: duplicate school_code (use an existing AFF001 school's code → triggers `SCHOOL_CODE_EXISTS`)
   - Row 3: missing school_name (triggers `MISSING_SCHOOL_NAME`)
2. Save as `manual-demo-affiliation-import.xlsx`. Do **not** commit this file.

| Order | ID | Path / state | Capture | Mobile? |
|---|---|---|---|---|
| 1 | F-01 | `/affiliation` | dashboard | no |
| 2 | F-02 | `/affiliation` | sidebar — 6 groups | no |
| 3 | F-03 | `/affiliation/schools` | school list (own scope) | no |
| 4 | F-04 | `/affiliation/accounts` page header | "เพิ่มโรงเรียนใหม่" title + Section A collapsed | no |
| 5 | F-05 | `/affiliation/accounts` Section A expanded | manual form (3 fields + amber warning card) | no |
| 6 | F-06 | `/affiliation/accounts` Section B file chosen | file name + "ตรวจสอบข้อมูล" button enabled | no |
| 7 | F-07 | `/affiliation/accounts` Section B post-preview | 3 summary cards + preview table (1 PASS row, 2 FAIL rows with Thai messages) | no |
| 8 | F-08 | `/affiliation/accounts` Section B commit toast | "นำเข้าสำเร็จ: สร้าง 1 บัญชี, ข้าม 2 จาก 3 แถว" | no |
| 9 | F-09 | `/affiliation/accounts` Section C | "บัญชีที่สร้างล่าสุด" table with the new row | no |
| 10 | F-10 | `/affiliation/students` | search + filter | no |
| 11 | F-11 | `/affiliation/status` | daily status + plate autocomplete | no |
| 12 | F-12 | `/affiliation/live-vehicles` | live map | no |
| 13 | F-13 | `/affiliation/audit-log` | audit + CSV export button | no |

**Cleanup after batch:** if the demo row was inserted into production, optionally soft-delete it: `UPDATE schools SET is_deleted=TRUE WHERE id='123456'`. Do NOT do this without operator approval.

**Time:** ~35 min (longest batch).

---

## Batch 5 — School full account (≈ 25 min)

**Account:** school full-account (e.g. `test`).

| Order | ID | Path | Setup | Capture | Mobile? |
|---|---|---|---|---|---|
| 1 | H-01 | `/school` | seed | dashboard | no |
| 2 | H-02 | `/school` | — | sidebar — full account, 6 groups, all items | no |
| 3 | H-04 | `/school/students` | ≥ 20 students | search + filter + row-action menu | no |
| 4 | H-05 | `/school/students` import template download empty | — | "ยังไม่มีนักเรียน" + template link | no |
| 5 | H-06 | `/school/students` import preview table | crafted file with mix | validation results | no |
| 6 | H-07 | `/school/vehicles` | ≥ 3 vehicles | list with driver/student counts | no |
| 7 | H-08 | `/school/bulk-vehicles` | crafted file | bulk vehicle import preview | no |
| 8 | H-09 | `/school/pickup-map` | ≥ 2 points | map + create-point modal | no |
| 9 | H-10 | `/school/approvals` | submit a roster-change-request from driver first | pending list + approve modal | no |
| 10 | H-11 | `/school/teacher-accounts` | — | grade-teacher list + create modal | no |
| 11 | H-12 | `/school/audit-log` | logs present | audit + CSV export | no |

**Pre-batch dependency:** Batch 7 (Driver mobile) should be done before this batch's H-10 capture — a driver-submitted roster-change-request seeds the school approvals queue.

**Time:** ~25 min.

---

## Batch 6 — School grade-teacher (≈ 10 min)

**Account:** a school sub-account whose `gradeScope` is set (e.g. `ป.4`).

**Pre-batch dependency:** Batch 5 step 10 (creating the grade-teacher account via `/school/teacher-accounts`) must complete first.

| Order | ID | Path | Setup | Capture | Mobile? |
|---|---|---|---|---|---|
| 1 | H-03 | `/school` (grade-teacher session) | — | sidebar — **note the 3 hidden items**: no `บัญชีครูประจำสายชั้น`, no `เพิ่มรถรับส่ง`, no `ประวัติการแก้ไข` | no |
| 2 | UAT-4-result | `/school/audit-log` direct URL navigation | — | observe what happens — friendly 403 toast vs page-level error (per `phase-10-3b-behavior-uat-checklist.md` UAT-4) | no |

**Cross-link:** capture UAT-4 result here AND fill in `phase-10-3b-behavior-uat-checklist.md` UAT-4 *Actual result* row at the same time.

**Time:** ~10 min.

---

## Batch 7 — Driver mobile (≈ 30 min — **all mobile**)

**Account:** a driver login (e.g. `นข 1571 ลำปาง` per seed).
**Viewport:** 390 × 844 throughout — set the browser emulator before logging in.

| Order | ID | Path | Setup | Capture |
|---|---|---|---|---|
| 1 | D-01 | `/driver` | morning roster populated for today | dashboard with today's summary |
| 2 | D-02 | `/driver` | — | sidebar — 3 groups |
| 3 | D-03 | `/driver/roster` | morning session active | per-student checkin/out controls |
| 4 | D-04 | After tapping checkin for one student | — | toast + updated state |
| 5 | D-05 | `/driver/pickup-map` | ≥ 2 points exist | map with pickup points |
| 6 | D-06 | Pickup-point edit modal | open the modal from D-05 | SearchableSelect for students (Phase 9.4/9.5/9.8B auto-flip behavior) |
| 7 | D-07 | `/driver/emergency` | — | emergency form (don't submit unless safe to do so) |
| 8 | D-08 | `/driver/profile` | — | profile with photo-upload |
| 9 | D-09 | `/driver/requests` | submit one from parent/school workflow first | pending roster-change-request list |

**Pre-batch:** ensure the driver's vehicle has a fresh morning roster (use a school's bulk import or manual add to populate students).

**Time:** ~30 min including modal interaction captures.

---

## Batch 8 — Transport (≈ 15 min)

**Account:** transport user.

| Order | ID | Path | Setup | Capture | Mobile? |
|---|---|---|---|---|---|
| 1 | T-01 | `/transport` | ≥ 3 vehicles with mixed inspection statuses | dashboard KPI cards | no |
| 2 | T-02 | `/transport` | — | sidebar — 2 groups | no |
| 3 | T-03 | `/transport/vehicles` | filter=PENDING | vehicle list | no |
| 4 | T-04 | `/transport/vehicles` create-vehicle modal | — | new plate form | no |
| 5 | T-05 | `/transport/inspections` | several records | record list | no |
| 6 | T-06 | `/transport/inspections` create modal | — | inspection form with result dropdown showing 4 options (PASSED/FAILED/NEEDS_FIX/PENDING) | no |
| 7 | T-07 | `/transport/inspections` edit modal | existing inspection | form prefilled | no |

**Time:** ~15 min.

---

## Batch 9 — Parent LINE OA (≈ 30 min — requires a LINE friend account)

**Account:** a personal LINE friend account; the bot account must be `ADD-FRIEND`-able.

**Pre-batch:**
1. Create a test student in the DB with a known parent_phone matching the operator's LINE account profile.
2. Identify the LINE OA bot (must be set up in `/etc/schoolbus/health-alert.env` config + LINE Developers Console).
3. Use a non-production LINE user-id wherever possible.

| Order | ID | Surface | Capture |
|---|---|---|---|
| 1 | L-01 | LINE OA chat | welcome card after `Add Friend` |
| 2 | L-02 | LINE OA chat | full bind flow: `ผูกบัญชี` → phone → student id → ✅ success |
| 3 | L-03 | LINE OA chat | `สถานะ` command response (after L-02) |
| 4 | L-04 | LINE OA chat | `ข้อมูลบุตร` command response |
| 5 | L-05 | LINE OA chat | `ยกเลิกผูกบัญชี` flow with confirmation |
| 6 | UAT-3-result | LINE OA chat | **try to bind a sibling** after a successful bind — confirm the "⚠️ บัญชี LINE นี้ผูกอยู่แล้ว" message (per `phase-10-3b-behavior-uat-checklist.md` UAT-3) |
| 7 | L-06 | LIFF webview (`/parent`) | children list + status cards |
| 8 | L-07 | LIFF webview child history | 7-day history |
| 9 | L-08 | Auto-notification | trigger a checkin from Batch 7 → capture incoming LINE push card |
| 10 | L-09 | Auto-notification | trigger checkout / emergency → capture push card |

**Cross-link:** fill in `phase-10-3b-behavior-uat-checklist.md` UAT-3 *Actual result* row at step 6.

**Time:** ~30 min including back-and-forth.

---

## Batch 10 — Error / empty states (≈ 15 min)

| Order | ID | Where | Setup | Capture |
|---|---|---|---|---|
| 1 | E-01 | `/school/students` empty | fresh school with no students | "ยังไม่มีข้อมูลในขอบเขตนี้" |
| 2 | E-02 | `/login` wrong password | — | error toast |
| 3 | E-03 | 403 fallback | log in as school, navigate to `/admin/users` | page-level 403 |
| 4 | E-04 | Excel import duplicate row | crafted file from Batch 4 | red "ไม่ผ่าน" badge in preview table |
| 5 | E-05 | Excel import wrong format | upload a `.docx` | reject toast `รองรับเฉพาะไฟล์ .xlsx หรือ .csv` |
| 6 | E-06 | Driver location stale | wait for / simulate stale GPS | live-vehicles map "ไม่อัปเดตเกิน 5 นาที" chip |
| 7 | E-07 | `/health` `database.connected=false` (simulated) | optional — for ops appendix | smoke output |

E-01 / E-04 / E-05 / E-06 are quick re-uses of setups from earlier batches.

**Time:** ~15 min.

---

## Capture order recommendation

To minimize data setup churn:

1. **Batch 1** (login / password) — uses anyone; do first to confirm flow
2. **Batch 5 step 10** (create grade-teacher account) — sets up Batch 6
3. **Batch 4** (affiliation + bulk import) — generates 1 new school + 1 new account; useful as the bulk-imported account for Batch 1 step 4 if it didn't get done already
4. **Batch 5** (school full account) — uses the school created in Batch 4 if convenient
5. **Batch 7** (driver mobile) — submits a roster-change-request that Batch 5 step 9 needs
6. **Batch 2** (admin), **Batch 3** (province), **Batch 8** (transport) — independent
7. **Batch 6** (grade-teacher) — after Batch 5 step 10
8. **Batch 9** (parent LINE) — last; triggers checkin notifications and uses driver actions from Batch 7
9. **Batch 10** (errors) — pick up the captures opportunistically while doing the above

## Total time estimate

| Batch | Time |
|---|---|
| 1 Shared | ~10 min |
| 2 Admin | ~25 min |
| 3 Province | ~20 min |
| 4 Affiliation + bulk import | ~35 min |
| 5 School full | ~25 min |
| 6 School grade-teacher | ~10 min |
| 7 Driver mobile | ~30 min |
| 8 Transport | ~15 min |
| 9 Parent LINE OA | ~30 min |
| 10 Error / empty states | ~15 min |
| **Total** | **~3 h 35 min** |

Realistic with breaks and screen capture tooling overhead: **half-day of focused work**, or two half-days split across batches.

## Tooling notes

- A capture tool with delayed-shutter and viewport-presets (e.g. Chrome devtools "Capture full size screenshot", or Firefox screenshot, or [Playwright `--save-screenshot`](https://playwright.dev/docs/screenshots) for repeatable automation) is helpful but not required.
- For LINE OA captures, use LINE for desktop or take phone screenshots and crop to chat bubble area.
- Keep raw captures in a `_raw/` subfolder; commit only the redacted/cropped final images.

## Output deliverable for Phase 10.3C (or later)

After capture, the directory `docs/manual/screenshots/` will contain ~85 PNG files, all under 200 KB each (after compression to optimize for manual rendering). This pack is the input to the actual manual-writing phase.
