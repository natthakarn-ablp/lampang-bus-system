# Phase 10.14 — Screenshot Checklist (Driver registration + Documents + 28 มิ.ย. deploy)

*Audit date: 2026-06-28 · Source commit: `2f40e34`*

Addendum to [phase-10-3a-screenshot-checklist.md](phase-10-3a-screenshot-checklist.md) for the screens added since
that checklist: **driver-initiated vehicle registration**, **vehicle/driver documents**, and the **28 มิ.ย. self-service round**
(dynamic term, transport document review). Same rules as 10-3A:

> Capture at 1440×900 desktop, **390×844** for driver/mobile. **No real passwords, no real PII** — use seed test accounts;
> **redact** every real student name / ID / phone / plate / LINE id before committing. Feature flag `FEATURE_DRIVER_REGISTRATION`
> must be **ON** (it is, on prod) for the registration/document screens to exist.

## Account legend
Same table as 10-3A (admin / province / affiliation / school-full / school-grade-teacher / driver=plate / transport).
Passwords live in the operator's password manager — never paste in chat.

## Data prep (one disposable vehicle + driver, non-production where possible)
1. A driver account (plate login) with an **active vehicle assignment** to a vehicle.
2. That driver adds 2–3 roster students (one with a student code that auto-matches a real student, one with a near/ambiguous name, one that won't match) — see UAT-D1.
3. That driver attaches one vehicle document (PDF/image, e.g. a blank/sample เล่มทะเบียน) and one ใบขับขี่ — use a NON-PII sample file.
4. The issuing school account (full-scope) is linked to that vehicle's registration application.

---

## New screenshots

| ID | Page (path) | What to capture | Account | Viewport | Data prep | Redact | Manual ch. |
|---|---|---|---|---|---|---|---|
| **D-16** | `/driver/registrations` | รายชื่อเด็กในรถ — empty state + the big "เพิ่มชื่อเด็ก" button | driver | 390×844 | none (empty) | — | Driver |
| **D-17** | `/driver/registrations` (form open) | The 3-field add form (ชื่อเด็ก / โรงเรียน / รอบ) + "ใส่ชั้น/รหัส" expander | driver | 390×844 | tap เพิ่มชื่อเด็ก | — | Driver |
| **D-18** | `/driver/registrations` (saved list) | Students grouped by school with the approval pills (รอโรงเรียนตรวจ / โรงเรียนรับแล้ว) | driver | 390×844 | D1 roster | student names | Driver |
| **D-19** | `/driver/registrations` (เอกสารรถและคนขับ) | The documents section: type picker + attached list with status pill (รอตรวจ / ผ่านแล้ว / ไม่ผ่าน—แนบใหม่) + ดู/ลบ | driver | 390×844 | D3 documents | original filename | Driver |
| **H-13** | `/school/registrations` | ตรวจสอบคำขอขึ้นทะเบียนรถ — queue with filter tabs (รอตรวจสอบ/อนุมัติแล้ว/ส่งกลับ) + per-row counts | school (full) | 1440×900 | D1 application | plate | School |
| **H-14** | `/school/registrations/:id` (detail) | Roster review — auto-match suggestion + ค้นหาเอง + the "อนุมัติทั้งหมด / ส่งกลับแก้ไข" action bar | school (full) | 1440×900 | D1 with 1 unmatched | student names | School |
| **H-15** | `/school/registrations/:id` (documents) | The **เอกสารรถและคนขับ** panel (DocumentReviewPanel): doc rows + ดูไฟล์ + ผ่าน/ไม่ผ่าน + expiry/reason | school (full) | 1440×900 | D3 documents | filename, expiry | School |
| **H-16** | `/school/registrations/:id` (grade-teacher) | Same detail as **read-only** — no action buttons + "บัญชีครูประจำสายชั้นดูได้อย่างเดียว" footer | school grade-teacher | 1440×900 | D1 application | student names | School |
| **T-05** | `/transport/verification` (detail) | The transport document panel inside the verification detail (AppCard "เอกสารรถและคนขับ (หลักฐานประกอบ)") | transport | 1440×900 | D3 documents | filename | Transport |
| **A-16** | `/admin/term-settings` | ภาคเรียนปัจจุบัน — term list with the green "ปัจจุบัน" pill + "ตั้งเป็นปัจจุบัน" + "เพิ่มภาคเรียน" form | admin | 1440×900 | ≥1 term row (046 seeds 2568-2) | — | Admin |

## Optional (open/empty states — opportunistic)
| ID | Page | Capture |
|---|---|---|
| E-08 | `/driver/registrations` document section, no docs | "ยังไม่มีเอกสารแนบ" |
| E-09 | `/school/registrations` queue empty | "ไม่พบคำขอตามเงื่อนไขที่เลือก" |

## Suggested file placement (continue existing numbering)
```
driver/16-registration-empty.png      driver/17-registration-form.png
driver/18-registration-list.png       driver/19-documents.png
school/19-registration-queue.png      school/20-registration-detail.png
school/21-registration-documents.png  school/22-registration-readonly.png
transport/05-documents.png            admin/16-term-settings.png
```
After capturing + redacting, append each to `docs/manual-html/screenshots/_captured.txt` with a Thai description.

## Capture options
- **Operator (recommended, real data):** log in with the seed accounts above, follow the data-prep, capture + redact. Matches the 10-3A/B process.
- **Automated (synthetic data, no login):** `scripts/browser-review.mjs` injects a mock auth/user and mocks API payloads against a `vite` dev server (`localhost:5173`) — extend it with the 10.14 routes + mock payloads. Produces non-PII synthetic screenshots. **Do NOT run the dev server + headless chromium on the production host during peak**; use a dev machine or off-peak window (needs `npm install --no-save playwright` first; chromium binaries are already cached).
