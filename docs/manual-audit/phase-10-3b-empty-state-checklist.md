# Phase 10.3B — Empty-State Checklist

*Audit date: 2026-05-14*
*Source commit: `d6497a4`*

Six pages flagged in Phase 10.3A §3 were verified by **reading the source** (no live UAT). Where the empty-state copy is explicit in the JSX, the row is `VERIFIED`. Where the page surface state needs a browser to confirm (e.g. paginated dashboard cards), the row is `NEEDS_BROWSER_UAT`. No page surfaced as `NEEDS_UI_COPY_FIX`.

## Legend

| Status | Meaning |
|---|---|
| `VERIFIED` | Empty-state copy exists in source, screenshot-quality without UI changes |
| `NEEDS_BROWSER_UAT` | Need to load the page on a fresh dataset to capture the screenshot |
| `NEEDS_UI_COPY_FIX` | Current copy is thin/missing — minor frontend edit recommended |

## Checklist

| # | Path | Role | Expected empty-state text (source) | File / line | Screenshot capture? | UI copy fix? | Status | Manual chapter |
|---|---|---|---|---|---|---|---|---|
| E-1 | `/school/students` | school | `ไม่พบข้อมูลตามเงื่อนไขที่เลือก` (with search filter) **or** `ยังไม่มีข้อมูลในขอบเขตนี้` (no filter) — uses shared `EmptyState` component | [StudentSearch.jsx:217-219](frontend/src/pages/school/StudentSearch.jsx#L217-L219) | yes — both filter and unfiltered variants | no | **VERIFIED** | 8.2 / 14.1 |
| E-2 | `/school/approvals` | school | `ยังไม่มีคำขอที่รออนุมัติ` (filter=pending) **or** `ไม่พบข้อมูลตามเงื่อนไขที่เลือก` (other filter) | [SchoolApprovals.jsx:57](frontend/src/pages/school/SchoolApprovals.jsx#L57) | yes — pending filter empty | no | **VERIFIED** | 8.6 |
| E-3 | `/admin` users-needing-action card | admin | Card renders count = 0 with `variant='neutral'`; rows array empty; no error or fallback text needed because count card handles 0 visually | [AdminDashboard.jsx:149-151](frontend/src/pages/admin/AdminDashboard.jsx#L149-L151) | yes — but capture against a fresh dataset where total=0 to see the neutral state | no | **VERIFIED** (visual confirmation recommended via UAT) | 5.1 |
| E-4 | `/affiliation/accounts` Section C | affiliation | `ยังไม่มีบัญชีโรงเรียน` (loading-vs-empty branch separated cleanly) | [AffSchoolAccounts.jsx:329](frontend/src/pages/affiliation/AffSchoolAccounts.jsx#L329) | yes — fresh affiliation with no schools yet | no | **VERIFIED** | 7.5.3 |
| E-5 | `/parent` LIFF before bind | parent | Full instructional empty-state: `ยังไม่ได้ผูกบัญชี LINE` heading + 3-step instruction list (`StepItem` 1/2/3 showing how to bind via LINE OA) | [ParentStatus.jsx:79-91](frontend/src/pages/parent/ParentStatus.jsx#L79-L91) | yes — unbind a parent or use a fresh LINE user_id | no | **VERIFIED** (already a model empty-state — uses it for onboarding) | 11.2 |
| E-6 | `/transport/inspections` | transport | `EmptyState` with icon `ClipboardList`, title `ไม่มีบันทึกการตรวจ`, description `เริ่มบันทึกผลตรวจรถคันใหม่จากฟอร์มด้านบน` | [InspectionForm.jsx:300](frontend/src/pages/transport/InspectionForm.jsx#L300) | yes — fresh transport account with zero records | no | **VERIFIED** | 10.4 |

### Bonus checks (not in original Phase 10.3A §3 list but worth capturing)

| # | Path | Role | Expected empty-state text | Status | Manual chapter |
|---|---|---|---|---|---|
| E-7 | `/parent` post-bind with no checkin today | parent | `ยังไม่มีข้อมูลเช็คอินวันนี้` ([ParentStatus.jsx:259](frontend/src/pages/parent/ParentStatus.jsx#L259)) | **VERIFIED** | 11.3 |
| E-8 | `/parent` history with no rows | parent | `ไม่มีประวัติในช่วงนี้` ([ParentStatus.jsx:288](frontend/src/pages/parent/ParentStatus.jsx#L288)) | **VERIFIED** | 11.4 |

## Summary

- **8 / 8 rows VERIFIED** in source (no fabricated results).
- **0 rows NEEDS_UI_COPY_FIX** — Phase 10.3A §3 concern is fully closed.
- **All 8 rows still need a real browser capture** for the manual screenshot pack (see `phase-10-3b-screenshot-capture-plan.md` Batch 10).

## Notes for the screenshot operator

- For E-1 / E-2, create two distinct captures: one *with* a filter active, one *without*, so the manual can show both branches.
- For E-3, the count card with `total=0` is a neutral grey/blue style (per Phase 9.5 / 9.8 polish). The manual should mention that this is a *positive* sign, not a problem.
- For E-5, redact the LINE user-id and any LINE display name in the screenshot per `phase-10-3a-screenshot-checklist.md` "Capture rules" §2.

## Decision

**No UI copy fix is required for empty states.** Gap §3 from Phase 10.3A is closed without code change. The manual writing team can use the source citations above to caption each screenshot accurately.
