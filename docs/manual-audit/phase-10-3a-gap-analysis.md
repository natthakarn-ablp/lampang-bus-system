# Phase 10.3A — Gap Analysis Before Writing the Manual

*Audit date: 2026-05-14*
*Source commit: `db9ca0e`*

The audit revealed eight categories of gaps that should be resolved (or explicitly accepted as carry-forward) **before** writing the final user manual. Items are listed in rough priority order within each category.

## 1. Missing or unclear menu labels

| # | Item | Where | Severity | Suggested fix |
|---|---|---|---|---|
| 1.1 | `/province/status` and `/affiliation/status` have **no entry in the sidebar** — users land here only via deep links or dashboard cards | Sidebar (province, affiliation groups) | Low | Add "สถานะรายวัน" entry to both sidebars, or document in chapter 6/7 that this is a drill-down only |
| 1.2 | `/driver/roster` is not in the driver sidebar — it is reached via the dashboard "View roster" link only | Driver sidebar | Low | Either add to sidebar or document the navigation path in chapter 9 |
| 1.3 | `/driver/pretrip` has no clearly-labelled sidebar entry | Driver sidebar | Low | Add entry or document |
| 1.4 | Admin sidebar includes cross-role links (e.g. "จัดการโรงเรียน" → `/school`) that route the admin into the school UI — operators may not realize they're "seeing as a school" | Admin sidebar | Med | Add a banner on `/school` when role=admin so the user knows they're in cross-role view; doc the behavior in chapter 5 |

## 2. Inconsistent menu names across roles

| # | Item | Severity | Suggested fix |
|---|---|---|---|
| 2.1 | Same page-concept has different Thai labels in different sidebars — e.g. ตำแหน่งปัจจุบัน (affiliation/province) vs ตรวจสอบตำแหน่งรถ (admin); แผนที่จุดรับส่ง (school/affiliation/province/driver) vs ตรวจสอบจุดรับส่ง (admin) | Med | Standardize in the manual via the chapter-4 vocabulary table; consider a follow-up phase to unify sidebar labels |
| 2.2 | "จัดการบัญชีโรงเรียน" appears in **admin sidebar** but the route is `/affiliation/accounts`, which after Phase 10.2A is titled "เพิ่มโรงเรียนใหม่" — there's a sidebar/title mismatch | Med | Either rename the sidebar entry to "เพิ่มโรงเรียนใหม่" or update the page title back to "จัดการบัญชีโรงเรียน" + reposition Phase 10.2A as a section inside. The audit recommends the **sidebar rename** to match the new page focus |
| 2.3 | "รายงาน" sidebar entry on multiple roles points to `/reports/daily` — no breadcrumb shows which scope context the user is in | Low | Doc the scope-from-JWT behavior in chapter 12 |

## 3. Pages without clear empty-state copy

The manual will need screenshots of these states. If the copy is too terse, the manual will look bad.

| # | Page | Current empty state | Suggested copy |
|---|---|---|---|
| 3.1 | `/school/students` with no students | likely a thin "ยังไม่มีนักเรียน" | Add "เริ่มต้นนำเข้านักเรียน" CTA |
| 3.2 | `/school/approvals` with no pending | needs verification | "ไม่มีคำขอที่รอดำเนินการ" |
| 3.3 | `/admin/users-needing-action` empty | needs verification | "ทุกบัญชีอยู่ในสถานะปกติ" |
| 3.4 | `/affiliation/accounts` Section C with no accounts yet | already shows "ยังไม่มีบัญชีโรงเรียน" (Phase 10.2A) | OK |
| 3.5 | `/parent` LIFF before bind | needs verification | "ยังไม่ได้ผูกบัญชี — พิมพ์ "ผูกบัญชี" ใน LINE" |
| 3.6 | `/transport/inspections` empty | needs verification | "ยังไม่มีบันทึกการตรวจสภาพ" |

**Action:** verify these by viewing each page on a fresh test account; if any copy is missing, file a follow-up phase. Do not block manual writing — use placeholder copy if needed and footnote.

## 4. Flows that need screenshots from a real demo dataset

| # | Flow | What test data is needed |
|---|---|---|
| 4.1 | Driver checkin → parent LINE push | One linked parent + LINE OA test account |
| 4.2 | Affiliation bulk import (Phase 10.2A) | An Excel file with exactly 1 valid / 1 duplicate / 1 missing-name row |
| 4.3 | Province trend chart | At least 7 days of `daily_status` data |
| 4.4 | Transport inspection lifecycle | A vehicle in `PENDING` → `NEEDS_FIX` → `PASSED` chain |
| 4.5 | School roster-change-request approve | A driver-submitted request first |
| 4.6 | Pickup-map student bulk-link | ≥ 8 students unassigned + 2 points |

## 5. Test-data preparation script gap

There is no single script that prepares a "manual-screenshot ready" dataset. Operators currently rely on production-like data. **Recommendation:** consider a small `scripts/manual-screenshot-seed.sh` as a future phase that:
- creates 3–4 test schools across 2 affiliations
- creates 20 demo students
- creates 5 vehicles with assorted inspection statuses
- creates 1 driver, 1 grade-teacher, 1 transport, 1 parent
- does NOT touch production tables (idempotent UPSERT with `_demo_` prefix)

Out of scope for Phase 10.3A; flagged here.

## 6. Permissions / behaviors that need confirmation

| # | Item | How to confirm | Why it matters |
|---|---|---|---|
| 6.1 | Does `admin` actually access `/api/affiliation/school-accounts/*` with a `?affiliation_id=` query? `resolveAffiliationId(req)` returns `req.query.affiliation_id` for admin — but is this documented and tested? | Run an integration test or manual UAT with admin token | Affects chapter 5 wording |
| 6.2 | Does `must_change_password` work on a fresh bulk-imported account in the same browser session that the import was committed in? | Manual UAT — log in as imported school account, expect forced password change | Section 7.5.4 / 13 |
| 6.3 | Does the LINE OA "ผูกบัญชี" flow handle the same phone number bound to two different students (siblings)? | LIFF test | Chapter 11.2 |
| 6.4 | Does a grade-teacher sub-account that tries `/school/audit-log` get a 403 toast or a 404 page? | UAT | Chapter 8.9 |
| 6.5 | Are the new Phase 10.2A endpoints rate-limited? | Inspect — currently NO explicit rate-limit on `/school-accounts/import/*`, but multer's 5 MB file limit + bcrypt cost 12 form a natural rate limit (~50 ms/row) | Chapter 13 + appendix |

**Action:** schedule a 30-min UAT block before chapter 5/7/8/13 are written, with the answers fed back into the manual.

## 7. Features that should NOT be documented yet

| # | Feature | Why |
|---|---|---|
| 7.1 | `POST /api/admin/snapshots/run` with `?baseline=1` | Privileged research-tooling; documenting in a user manual invites mis-use. Move to internal ops runbook (`docs/phase-9-ops-notes.md` or a separate `docs/research-ops.md`). |
| 7.2 | `POST /api/line/process-notifications` (cron-only, x-api-key gated) | Server-internal; not user-facing. |
| 7.3 | `POST /api/driver/location` (rate-limited GPS push) | Driver app handles automatically; documenting the endpoint invites manual fiddling. |
| 7.4 | `POST /api/visits/track` | Pure analytics; not user-facing. |
| 7.5 | Phase 9.x systemd watchdogs (`schoolbus-health-smoke.timer`, `-alert.timer`, `-heartbeat.timer`, `housekeeping.timer`) | Ops only — already documented in `docs/phase-9-ops-notes.md`. The user manual should cite that doc, not duplicate it. |
| 7.6 | Refresh-token internals + revoked-tokens table | Implementation detail; cite the change-password flow in chapter 3 instead. |

## 8. Features that are admin-only — should NOT appear in other role manuals

| # | Feature | Manual chapter that should NOT mention it |
|---|---|---|
| 8.1 | Creating / editing / deleting users | Province / Affiliation / School / Driver / Transport / Parent |
| 8.2 | `/admin/audit-logs` system-wide | Other roles get their own scope-filtered audit-log page |
| 8.3 | `/admin/research-export` | All non-admin roles |
| 8.4 | `/admin/system-health` | All non-admin roles |
| 8.5 | `/admin/pickup-points` cross-vehicle CRUD | Other roles can only see/edit pickup points for their own scope |
| 8.6 | `/admin/snapshots` and `evaluation-summary` | All non-admin roles |
| 8.7 | Cross-role views (admin viewing `/school`, `/province` directly) | Only admin chapter |

## 9. Cross-cutting notes that the manual should pick up

| # | Note |
|---|---|
| 9.1 | "Commit-drift WARN after a backend deploy" — purely a Phase 9 monitoring signal; do NOT surface to non-admin readers (admin chapter only, brief mention) |
| 9.2 | "Five Lampang affiliations" (AFF001–AFF005) as a fixed reference table — Phase 10.1A/B |
| 9.3 | Phase 10.2A is the **first** bulk-account-import flow in the system — operators may need extra hand-holding on the preview-then-commit pattern |
| 9.4 | LINE OA bind flow is **operator-confirmed** as the only path to enroll a parent today; future phases may add a web-based parent registration; **do not document that future state** |
| 9.5 | All Thai labels follow the Phase 8.4 canonical convention — no English placeholders in user-facing strings |

## Gap-resolution recommendation

Before writing chapter content, resolve:
- **§2.2** sidebar/title mismatch on `/affiliation/accounts` — small UI tweak or a documented note
- **§3** empty-state copy verification — 30-min UAT pass
- **§6** behavior confirmations — UAT pass (same 30 min if combined)

Items in §1, §4, §5, §7, §8, §9 are documentation-side and can be handled during writing.

## Out-of-scope-for-now (explicit acceptances)

- Light-mode-only design — no dark-mode screenshots
- No printable-PDF layout for chapter 16 — keep markdown source
- No video walkthroughs — separate phase if needed
- No bilingual EN/TH — manual is Thai-first
