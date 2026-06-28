# UAT — Phase 10.14 (Driver registration + Documents) + 28 มิ.ย. deploy

*Date: 2026-06-28 · Commit under test: `2f40e34` (deployed) · Flag: `FEATURE_DRIVER_REGISTRATION=true`*

Operator-run acceptance tests. Each case: do the **Steps**, confirm the **Expected**, mark **Result** (PASS/FAIL + note).
Use seed/disposable accounts (passwords in your password manager — never in chat). Prefer a **non-production vehicle/driver**
so UAT doesn't pollute real data; if you must use real data, soft-delete the test roster/documents afterwards.

> Backend logic is already covered by **208 unit tests** and the new routes are confirmed mounted (401 without auth).
> UAT here focuses on the human-facing acceptance flows that unit tests can't assert.

## Preconditions
- A **driver** account (plate login) with an **active vehicle assignment**.
- The **issuing school** (full-scope) account for that vehicle + one **grade-teacher** account at that school.
- A **transport** account and an **admin** account.
- 2 sample evidence files (PDF + image) that contain **no real PII**.

---

## A. Driver-initiated registration (roster)

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| D1 | driver | `/driver/registrations` → "เพิ่มชื่อเด็ก" → add 3 students: (a) name+code that matches a real student, (b) ambiguous/near name, (c) clearly non-existent. Pick a รอบ for each. | Each saves, grouped by school, pill = **รอโรงเรียนตรวจ**. Add form needs only ชื่อ+โรงเรียน (รอบ defaults). | |
| D2 | driver | Delete a not-yet-approved student (Trash) | Confirm dialog → removed; an **APPROVED** student shows **no** delete button | |

## B. School review (matching + approval)

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| H1 | school (full) | `/school/registrations` → tab รอตรวจสอบ → open the application | Detail lists the 3 roster rows; unmatched count shown | |
| H2 | school (full) | For (a): confirm the system "ระบบแนะนำ" suggestion (ตรงเลขประจำตัว) | Row → **จับคู่แล้ว ✓** | |
| H3 | school (full) | For (b): "ค้นหาเอง" → pick a student | Row matched | |
| H4 | school (full) | For (c): "ไม่ใช่เด็กของโรงเรียนนี้" | Row → ไม่ใช่เด็กที่นี่ | |
| H5 | school (full) | Try "อนุมัติทั้งหมด" **before** all rows resolved | Button disabled with "ตรวจให้ครบก่อน (เหลือ N)" | |
| H6 | school (full) | Resolve all → "อนุมัติทั้งหมด" | Success toast; application leaves the queue (approved) | |
| H7 | school (full) | On another app: "ส่งกลับแก้ไข" with a reason | Requires a reason; returns to driver as ต้องแก้ไข | |

## C. Documents (attach → review → lock → re-attach)

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| C1 | driver | `/driver/registrations` → เอกสารรถและคนขับ → แนบเอกสาร → pick "เล่มทะเบียนรถ" → choose the PDF | Uploads, appears with pill **รอตรวจ** | |
| C2 | driver | Attach an **ใบขับขี่** (image) | Appears under documents; pill รอตรวจ | |
| C3 | driver | Try a >5 MB file / a .txt renamed .pdf | Rejected (size / magic-byte) with a Thai error; nothing stored | |
| C4 | school (full) | `/school/registrations/:id` → เอกสารรถและคนขับ → **ดูไฟล์** | File opens in a new tab (inline PDF/image), served with auth | |
| C5 | school (full) | Press **ผ่าน** on the licence | Pill → **ผ่าน** | |
| C6 | school (full) | Press **ไม่ผ่าน** on the เล่มทะเบียน with no reason | Blocked — reason required | |
| C7 | school (full) | **ไม่ผ่าน** with a reason | Pill → **ไม่ผ่าน**; reason saved | |
| C8 | driver | Reload `/driver/registrations` documents | Rejected doc shows **ไม่ผ่าน — แนบใหม่** + the reason; can re-attach | |
| C9 | driver | Try to delete the **APPROVED** licence | No delete button (UI); a direct API DELETE → **403 APPROVED_LOCKED** | |
| C10 | transport | `/transport/verification` → open that vehicle → เอกสารรถและคนขับ (หลักฐานประกอบ) | Sees the same docs; can ดูไฟล์ + ผ่าน/ไม่ผ่าน | |
| C11 | driver (LINE-linked) | Have the school **ไม่ผ่าน** a doc for a driver whose LINE is verified-linked | Driver receives a LINE text: เอกสาร "<type>" ไม่ผ่าน + เหตุผล + กรุณาแนบใหม่. (Driver with no LINE link → review still succeeds, no error.) | |

## D. RBAC (grade-teacher = read-only)

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| R1 | school grade-teacher | Open `/school/registrations/:id` | Can VIEW roster + documents; **no** match/approve/reject/review buttons; footer "ดูได้อย่างเดียว" | |
| R2 | school grade-teacher | Direct API: POST `/api/school/registrations/:id/approve` (or `/documents/:kind/:id/review`) | **403 FULL_SCHOOL_SCOPE_REQUIRED** (backend-enforced, not just UI) | |
| R3 | province / affiliation | GET `/api/documents/:kind/:id/file` | **403** (not in the document allow-list) | |

## E. 28 มิ.ย. deploy — dynamic term + policy report

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| T1 | admin | `/admin/term-settings` → "เพิ่มภาคเรียน" `2569-1` → "ตั้งเป็นปัจจุบัน" | Only `2569-1` shows ปัจจุบัน; audit logged; **no restart** | |
| T2 | driver | Do a check-in after T1 | New `checkin_logs.term_id = 2569-1` (verify in DB) | |
| T3 | admin | Set current back to `2568-2` | Restores; old `2568-2` rows still queryable | |
| T4 | admin | POST `/api/admin/terms` with a bad id `abc` | 400 BAD_TERM_ID | |
| P1 | province | GET `/api/reports/policy` | 200 with province_totals + today + emergencies_30d + affiliations[] | |
| P2 | school | GET `/api/reports/policy` | 403 FORBIDDEN | |

## F. Regression / dark-flag

| ID | Steps | Expected | Result |
|---|---|---|---|
| X1 | (staging) set `FEATURE_DRIVER_REGISTRATION=false`, restart | `/api/driver/registrations`, `/api/documents/*`, transport doc routes → **404**; existing routers byte-for-byte unchanged | |
| X2 | Rate-limit: hit a school audit-logs **CSV export** > 40×/5 min | **429** after 40; normal JSON browsing of audit-logs unaffected | |

---

## Sign-off
| Section | Pass / Fail | Tester | Date |
|---|---|---|---|
| A Roster | | | |
| B School review | | | |
| C Documents | | | |
| D RBAC | | | |
| E Term + Policy | | | |
| F Regression | | | |

> File any FAIL as an issue with the case ID. Screenshots to capture during UAT: see
> [phase-10-14-screenshot-checklist.md](manual-audit/phase-10-14-screenshot-checklist.md).
