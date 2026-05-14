# Phase 10.3C — Operator UAT Results

*Status date: 2026-05-14*
*Source commit: `5eaa00f`*

This document records the **actual** outcome of the 5 behavior-UAT items defined in [phase-10-3b-behavior-uat-checklist.md](phase-10-3b-behavior-uat-checklist.md). Source-side verdicts are carried over verbatim. Every *Actual result* field below is **NEEDS_OPERATOR_UAT** because no operator browser/LINE pass has been executed yet.

> **How to update this document**
> After the operator runs each test, replace the matching `NEEDS_OPERATOR_UAT` line with one of:
> - `PASS` — observed behavior matches the source verdict
> - `WARN` — observed behavior is acceptable but worth documenting in the manual
> - `FAIL` — observed behavior diverges from source verdict (open a follow-up phase)
> and fill in the *Actual notes* field below it. Do **not** edit the source verdict.

## Legend

| Marker | Meaning |
|---|---|
| `NEEDS_OPERATOR_UAT` | Operator has not yet executed the browser/LINE flow |
| `PASS` | Operator observed result matches source verdict |
| `WARN` | Acceptable behavior with caveats — document in manual |
| `FAIL` | Behavior diverges from source verdict — needs follow-up |

---

## UAT-1 · Admin uses affiliation school-account import with `?affiliation_id=AFF002`

- **Role / account:** admin
- **Path:** `/affiliation/accounts?affiliation_id=AFF002`
- **Source verdict (Phase 10.3B):** VERIFIED — `resolveAffiliationId(req)` returns `req.query.affiliation_id` when `req.user.role === 'admin'` ([affiliation.routes.js:137-139](../../backend/src/routes/affiliation.routes.js#L137)). Backend wiring works.
- **Setup needed:**
  1. Admin login
  2. Phase 10.1A/B already applied (AFF002 exists)
  3. A small Excel file with 1 valid + 1 dup row, prepared per Phase 10.3B Batch 4
- **Browser steps:**
  1. Log in as admin
  2. Navigate to `/affiliation/accounts?affiliation_id=AFF002`
  3. Section B → download template, edit, upload, click ตรวจสอบข้อมูล
  4. Confirm preview shows correct affiliation context (rows linked to AFF002 implicitly)
  5. Click commit
  6. Verify the new school's `affiliation_id` is `AFF002` via admin tools or `/province/schools`
- **Actual result:** **NEEDS_OPERATOR_UAT**
- **Actual notes:** _(to be filled by operator — include browser version, any unexpected UX surface like missing AFF selector)_
- **PASS / WARN / FAIL:** _(pending)_
- **Likely manual impact:** §5.2 caveat — "Admin who wants to bulk-import schools should either log in as the target affiliation user OR pass `?affiliation_id=AFFNNN` in the URL. The page itself does not currently surface an admin-side AFF picker." If UAT shows admin **cannot** trigger the import (e.g. button disabled / 403), upgrade to **WARN** and document the workaround.

---

## UAT-2 · Bulk-imported school account is forced to change password on first login

- **Role / account:** a school account just created via Phase 10.2A bulk import
- **Source verdict (Phase 10.3B):** VERIFIED — end-to-end chain confirmed:
  - `commitSchoolImport()` inserts `must_change_password=TRUE`
  - `/api/auth/login` returns the field in the response body ([auth.routes.js:157](../../backend/src/routes/auth.routes.js#L157))
  - `Login.jsx:24` redirects to `/change-password` when true
  - `/api/auth/change-password` clears the flag and sets `password_changed_at=NOW()` ([auth.routes.js:223](../../backend/src/routes/auth.routes.js#L223))
- **Setup needed:**
  1. Run Phase 10.2A bulk import as affiliation user (1 new school, e.g. `123456` / `โรงเรียนทดสอบ`)
  2. Log out
- **Browser steps:**
  1. Log in with the imported school's username + its school_code as password
  2. Confirm immediate redirect to `/change-password`
  3. Enter a new password (≥ 4 chars), submit
  4. Confirm redirect to `/school` dashboard
  5. Log out → log in again with the new password → confirm no forced redirect this time
- **Actual result:** **NEEDS_OPERATOR_UAT**
- **Actual notes:** _(to be filled — note any toast wording, redirect timing)_
- **PASS / WARN / FAIL:** _(pending — likely PASS)_
- **Likely manual impact:** §3 + §7.5.4 + §13.2 should each describe this redirect path. If observed PASS, just describe; if FAIL, the manual must be honest about the gap.

---

## UAT-3 · LINE OA bind handles siblings

- **Role / account:** a LINE OA user with ≥ 2 children at the same school sharing the same parent_phone
- **Source verdict (Phase 10.3B):** VERIFIED — and a **known limitation surfaced**:
  - `parent_student` schema is M2M (`PRIMARY KEY (parent_id, student_id)`) so DB allows siblings.
  - `tryLinkByPhoneAndStudentId()` links **one** student per invocation.
  - But the LINE chat command `ผูกบัญชี` is rejected when `getLinkedParentId(lineUserId)` returns non-null — see [line.routes.js:191-211](../../backend/src/routes/line.routes.js#L191): the bot replies `"⚠️ บัญชี LINE นี้ผูกอยู่แล้ว"` and lists existing children.
  - There is currently **no LINE chat command** to add a sibling to an already-linked parent.
- **Setup needed:**
  1. A test student in DB with a parent_phone matching the operator's LINE-bound phone
  2. A second student in same school sharing the same parent_phone
  3. The operator's LINE account must be able to add the bot as friend
- **LINE steps:**
  1. Add bot as friend → capture the welcome message
  2. Type `ผูกบัญชี` → enter phone → enter student id #1 → confirm success
  3. Type `ผูกบัญชี` again → observe the response
  4. (Expected: "⚠️ บัญชี LINE นี้ผูกอยู่แล้ว" with first child listed; no path to add sibling)
- **Actual result:** **NEEDS_OPERATOR_UAT**
- **Actual notes:** _(to be filled — confirm exact wording of the "already linked" message, capture if any sibling-add path exists today)_
- **PASS / WARN / FAIL:** **likely WARN** (the limitation IS the behavior; documenting it is the correct response)
- **Manual impact:** §11.2 must explicitly say "หนึ่งบัญชี LINE = บุตรหลานหนึ่งคน. ผู้ปกครองที่มีบุตรหลายคนต้องประสานกับโรงเรียนเพื่อผูกบัญชีให้ครบ." A future "add-sibling" chat command is flagged as Phase 10.x candidate.

---

## UAT-4 · Grade-teacher tries direct URL `/school/audit-log`

- **Role / account:** a school-role sub-account with `gradeScope` set (e.g. `ป.4`)
- **Source verdict (Phase 10.3B):** VERIFIED — backend at [school.routes.js:881](../../backend/src/routes/school.routes.js#L881) wraps the route in `requireFullSchoolScope` which returns JSON 403 with a Thai message for grade-teachers. Frontend hides the sidebar item; direct URL navigation triggers the page mount + API call + 403.
- **Setup needed:**
  1. Log in as full school account
  2. Create a grade-teacher account via `/school/teacher-accounts` (assign `grade_scope='ป.4'`)
  3. Log out
- **Browser steps:**
  1. Log in as the grade-teacher account just created
  2. Confirm `/school/audit-log` is NOT in the sidebar
  3. Manually type `https://schoolbus.503200.xyz/school/audit-log` in the address bar
  4. Observe the UX: friendly Thai 403 toast, empty grid, or broken page?
  5. Confirm the dashboard still works after (no orphaned error state)
- **Actual result:** **NEEDS_OPERATOR_UAT**
- **Actual notes:** _(to be filled — describe the exact UI state. Is there a redirect? A modal? An empty page? A clean toast?)_
- **PASS / WARN / FAIL:** _(pending — likely PASS but UX detail matters)_
- **Likely manual impact:** §8.9 should explicitly describe what happens. If a friendly 403 page renders, document the message and move on. If the user sees a broken layout, escalate to a small frontend fix in a follow-up phase.

---

## UAT-5 · Phase 10.2A import endpoints performance / rate-limit posture

- **Role / account:** any affiliation user
- **Path:** `POST /api/affiliation/school-accounts/import/preview` + `/commit`
- **Source verdict (Phase 10.3B):** VERIFIED (static analysis):
  - **No explicit `express-rate-limit`** on either endpoint (grep returned no matches).
  - Three natural ceilings: multer **5 MB cap**; bcrypt **cost 12** (~50 ms/row → ~50 rows/sec ceiling); JWT auth guard.
  - 100-row import expected to complete in ~5–10 s.
- **Setup needed:** an Excel file with ~100 valid rows
- **Browser steps (optional empirical confirmation):**
  1. Log in as affiliation user
  2. Upload the 100-row file, time the commit (from click to success toast)
  3. Note: if it takes > 30 s the natural ceiling estimate is wrong → investigate
- **Actual result:** **NEEDS_OPERATOR_UAT** (optional — static analysis is already sufficient for documentation)
- **Actual notes:** _(to be filled if empirical run is done — record observed time, server CPU/RAM during the import)_
- **PASS / WARN / FAIL:** **WARN (carry-forward)** — the manual should describe the ~5–10 s expectation per 100 rows and recommend operators not run multiple imports in parallel
- **Manual impact:** §13.2 + appendix §16.x — add a "Performance note" callout.

---

## Operator UAT plan summary

| Test | Estimated time | Priority |
|---|---|---|
| UAT-2 must-change-password | 5 min | **must run** |
| UAT-4 grade-teacher /audit-log | 3 min | **must run** |
| UAT-3 LINE sibling bind | 8 min | **must run** |
| UAT-1 admin scope override | 10 min | should run |
| UAT-5 import performance | 5 min (optional) | optional |
| **Total** | **~30 min** | |

## Summary

| Item | Source-verdict status | Operator-actual status |
|---|---|---|
| UAT-1 admin scope | VERIFIED | NEEDS_OPERATOR_UAT |
| UAT-2 must-change-password | VERIFIED | NEEDS_OPERATOR_UAT |
| UAT-3 LINE sibling bind | VERIFIED — limitation found | NEEDS_OPERATOR_UAT |
| UAT-4 grade-teacher audit-log | VERIFIED | NEEDS_OPERATOR_UAT |
| UAT-5 import rate-limit | VERIFIED | NEEDS_OPERATOR_UAT (optional) |

**Counts:**
- Source verdicts complete: **5 / 5**
- Operator UAT executed: **0 / 5**
- Estimated remaining time: **~30 min**

## When to mark this document complete

This file is considered **complete** when:
- All 5 *Actual result* fields are filled in (PASS / WARN / FAIL — not NEEDS_OPERATOR_UAT)
- All 5 *Actual notes* fields contain operator observations
- A footer with the executor's name and date is appended

After completion, this file becomes the source of truth for chapters 7.5.4 / 8.9 / 11.2 / 13.2 of the user manual.

## Execution attempt log

| Date | Executor | UATs executed | Result | Note |
|---|---|---|---|---|
| 2026-05-14 | AI agent (Phase 10.3D session) | **0 / 5** | **NONE** | The 5 UAT items require a real browser session (UAT-1/2/4), a real LINE OA + mobile app (UAT-3), or an authenticated 100-row import run (UAT-5). The AI agent in this CLI session has no browser/LINE driver and no privileged role credentials; per strict rules `"Do not fabricate results"`, every *Actual result* field remains `NEEDS_OPERATOR_UAT`. A human operator with a login session is required. |

**Next concrete action:** a human operator with admin / affiliation / school / driver / grade-teacher / parent-LINE credentials runs the 5 items per the *Browser steps* sections above (~30 min total), then edits this file to replace each `NEEDS_OPERATOR_UAT` with the observed result.
