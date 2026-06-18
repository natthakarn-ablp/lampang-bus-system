# Security Follow-up Backlog — 2026-06-18

Tracking residual items from the 2026-06-18 security audit of the Lampang Bus System.
No secrets and no raw phone numbers appear in this document.

---

## #5 — LINE account binding hardening  ✅ Implemented (Phase 10.13C-4A)

**LINE binding does not use OTP by design. The credential is `parent_phone + student_code`.
Implemented credential-level throttling/lockout and audit logging. Future policy options
C/D remain deferred: manual approval gate after import, or adding another school-issued
verification field.**

Delivered:
- **Credential-level lockout** (`backend/src/services/lineBindGuard.js`) — in-memory, hashed
  keys, keyed on phone / student_code / phone+student pair / LINE sub. A brute force can no
  longer be bypassed by rotating IP, because the lock follows the credential, not the request.
  Thresholds: pair 5 / 10 min, phone 10 / 10 min, student_code 10 / 10 min, sub 12 / 10 min;
  lockout 30 min. The existing per-IP limiter (12 / 10 min) is retained on top.
- **Credential = `student_code`** (`findLinkablePhoneByStudentAndPhone`) — matches the VISIBLE
  รหัสนักเรียน first, with the legacy internal id as a backward-compatible fallback. No
  studentId-only bind path exists; binding still requires phone + an APPROVED parent_student link.
- **Audit** (`line.service.auditBind` → `line_message_logs`) for every outcome:
  `LINE_BIND_PREVIEW_FAILED`, `LINE_BIND_CONFIRM_FAILED`, `LINE_BIND_LOCKED`,
  `LINE_BIND_SUCCESS`, `LINE_BIND_DUPLICATE_OR_ALREADY_BOUND`. Phone is masked (`081****222`);
  LINE sub / IP / user-agent are short sha fingerprints; the id_token is never logged.
- Applied to all three bind paths: LIFF `bind-preview`, LIFF `bind-confirm`, and the OA chat flow.

**OTP/SMS is explicitly NOT part of the design. Do not propose OTP unless school policy
changes.** Parents have no app account; they enter the phone + student code printed on the
school form.

### Deferred policy/UX decisions (require a school-side decision — NOT in this phase)
- **C — Approval gate after import.** Today the importer auto-sets `parent_student.approved = TRUE`
  (`school.routes.js` ~line 1370), so "approved" is not a deliberate per-parent vetting step.
  Option: require a school staffer to approve a parent before a phone+student_code can bind.
- **D — Optional extra school-issued verification field** (e.g. a one-time claim code) added to
  the bind form to raise credential entropy without OTP. Changes the form + `findLinkable` query.

---

## Other residual items (from the 2026-06-18 audit pass — for reference)

### Operational (code ready, action required before/at deploy)
- **Timezone (#3)** — pool pinned to `+07:00`; verify on the live DB after deploy
  (`SELECT CURDATE(), NOW(), @@session.time_zone;`).
- **cid_hash HMAC (#6)** — opt-in via `CID_HASH_PEPPER`; run `backend/scripts/rehash-cid.js --apply`
  then deploy. Off by default to avoid breaking lookups against legacy SHA-256 rows.
- **Backend bind host (#13)** — now binds `127.0.0.1` by default; set `HOST=0.0.0.0` only if an
  off-box monitor must reach `:3000` directly.

### Partially mitigated (full fix is a larger change)
- **Refresh-token rotation/replay (#7 remainder)** — access tokens are now invalidated on
  password change; refresh tokens are still not rotated on use.
- **Export rate-limit coverage (#27)** — applied to `/api/reports`; embedded export/import
  endpoints in school/admin/affiliation/province still uncovered.
- **Export streaming (#15)** — report/CSV/Excel still buffer the full dataset in memory.
- **Token storage (#32)** — access/refresh tokens in localStorage; CSP added as mitigation,
  httpOnly-cookie auth deferred.

### Operational features (design + schedule)
- **Retention/archival (#41)** for `audit_logs` / `checkin_logs`.
- **Term rollover (#42)** — `CURRENT_TERM` read once at startup.
- **Force-rotate legacy `1234` passwords (#18)** — policy now enforced on change; existing
  weak passwords not force-rotated.

### Single-instance caveat
- Login lockout, webhook dedup, LINE linking-state, and the new bind lockout are in-memory
  (pm2 fork, one instance). Move to Redis/DB if the deployment ever scales to multiple instances.
