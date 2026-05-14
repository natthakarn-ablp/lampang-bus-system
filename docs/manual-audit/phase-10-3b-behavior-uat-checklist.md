# Phase 10.3B — Behavior UAT Checklist

*Audit date: 2026-05-14*
*Source commit: `d6497a4`*

Five behavior questions from Phase 10.3A §6 ("Permissions/behaviors needing confirmation"). Each item lists the **source-side verification** I could do without a browser, plus the **browser UAT steps** the operator must run to fill in the *Actual result* column. Do not mark PASS until the operator runs the UAT and writes the result back into this file.

## Legend

| Column | Meaning |
|---|---|
| **Source verdict** | What the code says will happen (read-only verification) |
| **Actual result** | What the operator observes in the browser (fill in during UAT) |
| **PASS / WARN / FAIL** | Operator decision after running UAT |

---

## UAT-1 · Admin uses affiliation school-account import with `?affiliation_id=`

- **Role / account:** admin
- **Path / command:** `/affiliation/accounts` with admin login; affiliation context passed via URL query, e.g. `/affiliation/accounts?affiliation_id=AFF002`
- **Setup needed:** at least one admin account; pick an AFF in `AFF001`–`AFF005`
- **Source verdict (VERIFIED):** `resolveAffiliationId(req)` at [backend/src/routes/affiliation.routes.js:137-139](backend/src/routes/affiliation.routes.js#L137) returns `req.query.affiliation_id` when `req.user.role === 'admin'`. Therefore admin **can** use the import endpoints by passing `?affiliation_id=` (or by having the page resolve it from the route segment if the frontend does so). Source contract is solid.
- **Browser UAT:**
  1. Log in as admin
  2. Navigate to `/affiliation/accounts` directly
  3. Open Section B, download template, prepare a 2-row file (1 valid, 1 dup)
  4. Click "ตรวจสอบข้อมูล" → confirm preview renders
  5. Note: the frontend page (`AffSchoolAccounts.jsx`) doesn't appear to expose an affiliation-selector to admins — so the practical admin path may be (a) login *as* an affiliation user, or (b) for admin to use the `/admin/users` UI for creating school accounts one at a time
- **Expected result (source-derived):** preview + commit work; `affiliationId` resolves to whichever affiliation the admin was scoped into via query
- **Actual result:** _(operator to fill in)_
- **PASS / WARN / FAIL:** _(operator)_
- **Manual chapter affected:** §5.2 (admin guide) — caveat to add: "Admin who wants to bulk-import schools should typically log in as the target affiliation user, or pass `?affiliation_id=AFFNNN`. The single-school flow on `/admin/users` is also available."

---

## UAT-2 · Bulk-imported school account is forced to change password on first login

- **Role / account:** a school account just created via Phase 10.2A bulk import
- **Path / command:** `/login` → enter the imported username + `initial_password` (defaults to `school_code`)
- **Setup needed:** run Phase 10.2A bulk import for ≥ 1 row using affiliation account
- **Source verdict (VERIFIED — multi-layer):**
  1. Bulk insert at `commitSchoolImport()` sets `must_change_password=TRUE` (Phase 10.2A code).
  2. `/api/auth/login` returns the field in the response body: `must_change_password: !!user.must_change_password` at [backend/src/routes/auth.routes.js:157](backend/src/routes/auth.routes.js#L157).
  3. Frontend `Login.jsx:24` reads the field and redirects to `/change-password` if true.
  4. `/api/auth/change-password` clears it: `UPDATE users SET … must_change_password = FALSE, password_changed_at = NOW()` at [auth.routes.js:223](backend/src/routes/auth.routes.js#L223).
  
  → Full chain is wired end-to-end.
- **Browser UAT:**
  1. Run a Phase 10.2A bulk import as affiliation user (1 new school)
  2. Log out, then log in with the imported school's username + its school_code as password
  3. Confirm immediate redirect to `/change-password`
  4. Enter a new password; confirm redirect to the school dashboard
  5. Log out again, log in with the new password → confirm no forced redirect this time
- **Expected result (source-derived):** Step 3 redirect occurs; step 5 lands on dashboard directly
- **Actual result:** _(operator)_
- **PASS / WARN / FAIL:** _(operator)_
- **Manual chapter affected:** §3 (Login & Password), §7.5.4, §13.2

---

## UAT-3 · LINE OA bind handles siblings

- **Role / account:** a LINE OA user who is a parent of ≥ 2 students in the same school
- **Path / command:** LINE OA chat with the bot
- **Setup needed:** two student rows in the same school where the operator can map both to the same parent_phone; the bot account must be in the same LINE OA as the test user
- **Source verdict (VERIFIED via source + schema):**
  - The `parent_student` table is a many-to-many junction (per CLAUDE.md schema): primary key `(parent_id, student_id)`.
  - `tryLinkByPhoneAndStudentId(lineUserId, phone, studentId)` at [backend/src/services/line.service.js:63](backend/src/services/line.service.js#L63) links *one* student at a time. The text-based bind flow handles ONE student per invocation.
  - Therefore: siblings = **run the bind flow N times** (once per child). The schema does NOT prevent multiple `parent_student` rows for the same `parent_id`.
- **Browser UAT (LINE app):**
  1. Add bot as friend; trigger first bind: `ผูกบัญชี` → phone → student-id #1 → ✅
  2. Trigger second bind: `ผูกบัญชี` again
     - **Question:** does the bot allow re-binding? Looking at [line.routes.js:191-211](backend/src/routes/line.routes.js) — if `getLinkedParentId(lineUserId)` returns a non-null parentId, the bot replies `"⚠️ บัญชี LINE นี้ผูกอยู่แล้ว"` and shows the linked children. **So a parent of siblings must use a different flow: "เปลี่ยนบัญชี" + re-bind doesn't add siblings, it replaces.**
  3. **Likely true behavior:** today's LINE flow does **NOT** support adding a sibling once a parent is linked; the operator needs the school to use the existing `parent_student` row and either (a) approve a second student via the school's approval flow, or (b) re-bind via `เปลี่ยนบัญชี` (which loses the first child).
- **Expected result (source-derived):** the FIRST bind works fine; the SECOND bind via `ผูกบัญชี` is blocked with the "already linked" message. **There is currently no LINE chat command to add a sibling to an already-linked parent.**
- **Actual result:** _(operator)_
- **PASS / WARN / FAIL:** **likely WARN** — flag this as a feature-gap in the manual, not a bug
- **Manual chapter affected:** §11.2 — **document the limitation**: parents of siblings must coordinate with the school admin to link multiple students; the current LINE chat supports one child per LINE account. (This may be a candidate for a future micro-phase: "add sibling" command.)

---

## UAT-4 · Grade-teacher tries `/school/audit-log`

- **Role / account:** a school-role user whose `gradeScope` is set (e.g. `ป.4`)
- **Path / command:** direct browser navigation to `/school/audit-log`
- **Setup needed:** create a grade-teacher account via `/school/teacher-accounts` (full-school account creates it)
- **Source verdict (VERIFIED):**
  - Sidebar hides the entry — checked in Phase 10.3A inventory.
  - If user navigates directly to the URL: the React route is allowed (PrivateRoute admits school role). The page mounts and calls `GET /api/school/audit-logs`.
  - Backend has `requireFullSchoolScope` on the route at [school.routes.js:881](backend/src/routes/school.routes.js#L881): the middleware returns `sendError(res, '...', [], 403)` because `req.user.gradeScope` is truthy.
  - The frontend `SchoolAuditLog.jsx` will receive a 403 JSON and display an error state (probably a toast + empty content).
- **Browser UAT:**
  1. Log in as a grade-teacher
  2. Manually type `/school/audit-log` in the address bar
  3. Observe: is it (a) a friendly Thai 403 toast/page, (b) an empty grid, (c) a stack-trace-like console error?
- **Expected result (source-derived):** backend returns JSON 403 with Thai message `"ฟังก์ชันนี้เปิดให้เฉพาะบัญชีหลักของโรงเรียน..."` (or similar — confirm exact wording in `requireFullSchoolScope` source). Frontend behavior depends on the page's catch handler.
- **Actual result:** _(operator)_
- **PASS / WARN / FAIL:** _(operator)_ — likely PASS but worth a visual capture
- **Manual chapter affected:** §8.9 — "ข้อจำกัดของบัญชีครูประจำสายชั้น": list which sidebar items are hidden AND what happens if someone bookmarks the direct URL (graceful 403, no crash).

---

## UAT-5 · Phase 10.2A import endpoints rate-limit posture

- **Role / account:** any affiliation user
- **Path / command:** `POST /api/affiliation/school-accounts/import/preview` and `/import/commit`
- **Setup needed:** none — this is a static analysis
- **Source verdict (VERIFIED):**
  - `grep -nE "rate-?limit|express-rate-limit|rateLimit" backend/src/routes/affiliation.routes.js` → **no matches**. No explicit per-endpoint rate-limiter.
  - However, three natural ceilings exist:
    1. **multer file-size limit 5 MB** ([affiliation.routes.js:32](backend/src/routes/affiliation.routes.js#L32)) — caps individual uploads.
    2. **bcrypt cost 12** in `commitSchoolImport()` (~50 ms/row on modern hardware) — caps throughput to ~50 rows/sec. A 100-row import = ~5 s of CPU.
    3. **JWT auth guard** — the route is behind `requireRole('affiliation','admin')`, so unauthenticated abuse is impossible. Auth is itself rate-limited via the login endpoint.
  - There is also no in-flight concurrency limit. A malicious affiliation user with valid creds could fire repeated 5 MB uploads. The natural ceiling above means worst-case ~250 rows/sec per affiliation account, well below MySQL/Node practical limits.
- **Browser UAT:** none required — static analysis is sufficient. If the operator wants empirical reassurance, run a 100-row import and time it (~5–10 s expected).
- **Expected result:** import completes within ~10 s for 100 rows; no rate-limit error; no MySQL contention.
- **Actual result (operator if desired):** _(can be left blank)_
- **PASS / WARN / FAIL:** **WARN (carry-forward)** — the manual should explain the natural rate-limit; if abuse becomes a real concern, add an `express-rate-limit` in a future micro-phase. Document in §13 (Bulk Imports) as a known characteristic and in the appendix.
- **Manual chapter affected:** §13.2 + appendix §16.x — add a "Performance note" callout: "Phase 10.2A import processes ≤ 5 MB Excel files and uses bcrypt cost 12, so a 100-row commit completes in ~5–10 seconds. Do not run multiple imports simultaneously from different browser tabs."

---

## Operator UAT plan (≈ 30 min total)

1. **UAT-2** (5 min) — import 1 row, log in as the new account, observe forced password change
2. **UAT-4** (3 min) — log in as grade-teacher, type `/school/audit-log` in URL bar
3. **UAT-3** (8 min) — full LINE OA bind + try sibling-bind to confirm "already linked" path
4. **UAT-1** (10 min) — log in as admin, try `/affiliation/accounts?affiliation_id=AFF002` import end-to-end
5. **UAT-5** (5 min, optional) — time a 100-row import for the manual's performance note

## Summary

| Item | Source verdict | Browser UAT needed? | Likely outcome |
|---|---|---|---|
| UAT-1 admin scope | VERIFIED | YES — confirm UX path | PASS or WARN (frontend may not expose admin affiliation selector) |
| UAT-2 must-change-password | VERIFIED | YES — visual confirmation | PASS |
| UAT-3 LINE sibling bind | VERIFIED (limitation found) | YES — confirm "already linked" message | WARN — manual must document limitation |
| UAT-4 grade-teacher /audit-log | VERIFIED (backend 403) | YES — observe frontend UX | PASS likely |
| UAT-5 rate-limit posture | VERIFIED (no explicit rate-limit; natural ceilings adequate) | OPTIONAL | WARN (carry-forward) |

**Net new finding** during this audit: **UAT-3 (sibling bind) is a documented LIMITATION**, not a bug. The manual §11.2 needs to explicitly state that one LINE account = one student today; siblings require school-admin coordination. A future "add-sibling" chat command is a Phase 10.x candidate.
