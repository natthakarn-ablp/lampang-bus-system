# UI Redesign — Production Release Handoff

**Status:** release candidate verified for controlled production deployment.
Deployment is a separate operator action whose result must be verified against
the live `/api/health` response and the server's Git HEAD.
**Generated:** 2026-08-27

---

## 1. Git

| | |
|---|---|
| Branch | `codex/full-ui-redesign` |
| Worktree | `D:/Projects/lampang-bus-system-uiredesign` |
| Base commit | `d9485ec1e6769dc52aa61b3897d27cf8d840c0ee` — *feat: refresh production login branding* |
| Release commit | Current `codex/full-ui-redesign` tip — resolve with `git rev-parse HEAD` (the document intentionally does not attempt to contain its own commit hash) |
| Commits in range | **38** (`d9485ec..HEAD`) after the release-blocker fix commit |
| Upstream | **none** — cleared with `git branch --unset-upstream` |
| Remote target | Must be `origin/codex/full-ui-redesign`; verify with `git ls-remote` before advancing production |
| Rebase / squash / reset performed | **none** |

### Working tree

**Clean after the release commit.** The two files that were previously left
uncommitted and all targeted accessibility/release-blocker fixes are included
in the `d9485ec..HEAD` review range.

### Diffstat

```
123 files changed, 12465 insertions(+), 7162 deletions(-)
```

| change | count |
|---|---|
| Added | 20 |
| Modified | 103 |
| **Deleted** | **0** |

**Added (20):**

*Shared components (11)* — `components/PickupPointFields.jsx`,
`components/StudentStatusTable.jsx`, `components/VehicleRosterCard.jsx`,
`components/ui/{AttentionQueue,ConfirmDialog,DailyOperationStatus,DataTable,FilterBar,FormField,Modal,ResponsiveDrawer}.jsx`

*Verification tooling (5)* — `scripts/ui-redesign/{capture,nav-snapshot,page-status,permission-check,route-matrix}.mjs`

*Docs (4)* — `docs/ui-design-system.md`, `docs/ui-redesign-plan.md`,
`docs/ui-redesign-uat.md`, `docs/ui-redesign-handoff.md`

### Scope guards — all verified against the diff

| guard | result |
|---|---|
| `backend/**` files changed | **0** |
| `frontend/src/App.jsx` changed | **0** |
| schema / migration / `.sql` files changed | **0** |
| `package.json` / lockfile changed | **0** |
| `api/axios.js` changed | **0** |
| `hooks/useAuth` changed | **0** |
| `components/Sidebar.jsx` changed | 1 — expected; the shell/nav redesign. Menu entries still 74 across 6 roles. |

### Push hazard — found and resolved

This branch's upstream had been pointing at **the production branch**:

```
branch.codex/full-ui-redesign.remote = origin                                  ← before
branch.codex/full-ui-redesign.merge  = refs/heads/feat/tracking-security-hardening
```

A bare `git push` would have been refused (the names differ), but `git pull`
would have pulled production into this branch. Cleared, in this worktree only:

```bash
git branch --unset-upstream
```

Now:

```
upstream = none · remote = unset · merge = unset
```

Other branches were **not** touched. Note for later: `codex/production-100-phasework`
still tracks `origin/feat/tracking-security-hardening`. That is the user's
branch and outside this Goal's scope — flagged, not changed.

**When a push is eventually approved**, the remote branch must be named
`codex/full-ui-redesign` and nothing else:

```bash
git push -u origin codex/full-ui-redesign      # only after explicit approval
```

---

## 2. Completion matrix

### Routes — reconciles to 89 exactly

| status | count |
|---|---|
| Complete | 67 |
| N/A (non-page route) | 17 |
| N/A (reasoned exemption) | 5 |
| **Partial** | **0** |
| **Unclassified** | **0** |
| **Total** | **89** ✓ |

### Pages

| status | count |
|---|---|
| Complete | 77 |
| N/A | 4 |
| N/A (reasoned) | 5 |
| **Partial** | **0** |

### The 17 non-page routes, by kind

| kind | n | routes |
|---|---|---|
| index | 6 | `/driver` `/school` `/affiliation` `/province` `/reports` `/transport` — layout index routes that render the role's dashboard |
| redirect | 5 | `/driver/leaves` `/school/status` `/school/missing` (folded into dashboards, paths kept so old links resolve) · `/` (RootRedirect per role) · `/*` (catch-all) |
| alias | 2 | `/parent/link/link` and `/link` — LIFF endpoint defences; LINE rewrites the endpoint by appending `/link`, and these absorb the double segment |
| external | 1 | `/manual/*` — redirects out of the SPA to the published static manual |
| page wrapper | 3 | `/admin/audit-logs` `/affiliation/audit-log` `/province/audit-log` — five-line files that render `<AuditLogTable apiPath=… title=… />` and nothing else. They carry no pattern of their own, so N/A is the accurate answer; the work lives in `components/AuditLogTable.jsx`, which is **Complete**. |

The 14 index/redirect/alias/external routes carry their reason in `NON_PAGE` in
`route-matrix.mjs`; the 3 wrappers are derived from source. All are printed by
`node scripts/ui-redesign/route-matrix.mjs --md`.

The 5 reasoned exemptions at route level are `/login`, `/school/audit-log`,
`/admin/measurement`, `/qr/:token` and `/parent` — each detailed in the table
below.

### Two different things are being counted — keep them apart

| | what it is | count |
|---|---|---|
| **Non-page routes** | index / redirect / alias / external / page-wrapper. These have no UI of their own to migrate. Listed in the table above. | **17 routes** |
| **UI-pattern exemptions** | real pages that *do* have UI, where one specific pattern legitimately does not apply. Listed below. | **12 pages / 15 patterns** |

The two are disjoint. A route in the first group was never a candidate for
migration; a page in the second group **was** migrated, with one pattern
excused for a stated reason.

### UI-pattern exemptions — **12 pages, 15 pattern-level exemptions**

> **Correction.** An earlier summary said "six documented exemptions". That was
> wrong: it counted *groups*, not files. The real figures are **12 exempted
> pages** carrying **15 pattern-level exemptions**. Of those 12, five end up
> `N/A (reasoned)` (every applicable pattern was exempt) and seven remain
> `Complete` (they had other applicable patterns, which they satisfy).

| page | pattern | reason |
|---|---|---|
| `pages/Login.jsx` | header | production-approved login page (commit `d9485ec`); deliberately branded and outside the shell |
| | form | the login form *is* the page; fields already carry autocomplete and wired labels, verified in the baseline audit |
| | modal | the contact-admin panel is inline on the page, not a dialog |
| `pages/ChangePassword.jsx` | header | rendered outside the shell, before a session is fully established |
| `pages/parent/ParentStatus.jsx` | header | LIFF webview with no app shell; its `<h1>`s are the not-linked and no-children states plus the LINE-style app bar |
| `pages/qr/VehicleQr.jsx` | header | public QR scan page, rendered standalone for unauthenticated scanners |
| `pages/school/SchoolAuditLog.jsx` | header | the `<h1>` is the permission-denied state for grade-teacher accounts; the real header is `PageHeader` inside `AuditLogTable` |
| `pages/admin/ExecutiveSummary.jsx` | header | branded print-oriented header band; it *is* the page header, just not the shell variant |
| `pages/admin/MeasurementFramework.jsx` | header | branded print-oriented header band, matching the reports pages |
| `pages/reports/DailyReport.jsx` | header | branded report band carrying title + period; matches the printed output |
| `pages/reports/MonthlyReport.jsx` | header | ″ |
| `pages/reports/SummaryReport.jsx` | header | ″ |
| `pages/reports/PolicyReport.jsx` | header | ″ |
| `pages/admin/ExecutivePrint.jsx` | header | branded print header band carrying title, baseline date and generation time |
| | table | A4 print tables with ruled cells; the *screen* path for these reports already renders through `DataTable` |

### No page was flipped to N/A to clear the gate — evidence

1. **Exemptions were added mid-stream, with the migration they belong to** —
   commits **#17**, **#20** and **#30** of 35, not in a closing sweep.
2. **The last five commits (#31–#35) added zero exemptions.** Partial went to 0
   through migration, not reclassification.
3. **7 of the 12 exempted pages are still `Complete`**, meaning the exemption
   covered one pattern while the page still had to satisfy its others — a
   blanket pass would have shown them all as N/A.
4. `ExecutivePrint`'s `states` gap was **not** exempted and *was* fixed; only
   `header` and `table` are exempt there.

Every reason lives in `EXEMPT` in `scripts/ui-redesign/page-status.mjs`, next to
the code it excuses, where it can be argued with.

---

## 3. Verification

### Static gates — all exit 0

| gate | command | result |
|---|---|---|
| Build | `cd frontend && npm run build` | ✓ passes |
| Labels | `cd frontend && npm run check:labels` | ✓ PASSED — 0 violations, 151 files |
| Page status | `node scripts/ui-redesign/page-status.mjs` | ✓ Partial 0 (exit 0) |
| Route matrix | `node scripts/ui-redesign/route-matrix.mjs --gate` | ✓ 89, reconciles (exit 0) |
| Navigation | `node scripts/ui-redesign/nav-snapshot.mjs --compare outputs/ui-redesign/nav-before.json` | ✓ 89 routes / 74 menus, none lost |
| Permissions | `node scripts/ui-redesign/permission-check.mjs` | ✓ 0 leaks, 0 dead links (exit 0) |

Menu entries per role, unchanged from baseline:
`driver 8 · school 13 · affiliation 12 · province 12 · transport 4 · admin 25 = 74`

### Runtime smoke — 122 captures at 390 / 768 / 1280 / 1920

| metric | result |
|---|---|
| **Sub-44px tap targets** | **0** |
| Horizontal page overflow | **0** |
| Render loops | **0** |
| Unexpected console errors | **0** (only `05-admin-error-desktop`, the deliberate all-fail scenario) |
| Failed captures (missing expected content) | **0** |
| Sub-16px mobile text inputs | **0** |
| Unnamed keyboard scroll regions | **0** |
| Focus ring visible on keyboard focus | **116 / 116** elements carrying `.focus-ring` |

The runtime harness now exits non-zero for failed captures, overflow,
unexpected console errors, render loops, sub-44px controls, sub-16px mobile
inputs, unnamed keyboard scroll regions, or an invisible shared focus ring.
It also types through a rerendering modal and checks native `required`
validation, covering the two release-blocking regressions found in review.

### Post-freeze accessibility fixes — what was actually wrong

The parent/LIFF and public-QR experiences had **no captures at all** until this
handoff, so the earlier "tap targets < 44px = 0" was true only of what had been
measured. Once measured, the first pass found one control. Widening the QR
fixture to level 2 and opening the privacy notice found **three**, and a source
audit of the LIFF views — which automation cannot reach — found **five more**.

| # | route / surface | file : line | element | measured / computed |
|---|---|---|---|---|
| 1 | `/qr/:token` | `pages/qr/VehicleQr.jsx:167` | privacy `<button>` "ความเป็นส่วนตัว" | **80 × 16** *(measured)* |
| 2 | `/qr/:token` | `pages/qr/VehicleQr.jsx:212` | `<a href="tel:">` emergency contact | **78 × 18** *(measured — only renders at level ≥ 2, which the level-1 fixture never showed)* |
| 3 | `/qr/:token` → notice | `components/consent/PublicPrivacyNotice.jsx:18` | "รับทราบ" dismiss | **316 × 40** / **398 × 40** *(measured — only exists once the notice opens)* |
| 4 | `/qr/:token` → consent | `components/consent/ParentConsentModal.jsx:43` | "ยืนยันความยินยอม" | 40 px *(computed)* |
| 5 | `/qr/:token` → consent | `components/consent/ParentConsentModal.jsx:46` | "ไม่ใช่ตอนนี้" | ~20 px *(computed — no vertical padding at all)* |
| 6 | `/parent` | `pages/parent/ParentStatus.jsx:205` | LIFF app-bar "รีเฟรช" | 36 px *(computed)* |
| 7 | `/parent` | `pages/parent/ParentStatus.jsx:200` | LIFF app-bar "กลับ" | 44 px exactly, no margin *(computed)* |
| 8 | `/parent` | `pages/parent/ParentStatus.jsx:412` | "รีเฟรช ETA" | 44 px exactly, no margin *(computed)* |

Computed sizes were validated against the measured ones — the same Tailwind
arithmetic that predicted 40 px for "รับทราบ" matched the measurement exactly,
which is why #4–#8 can be trusted without a capture.

**All eight fixed by class and markup only.** Handler parity was verified: the
set of `onClick` expressions before and after the diff is identical, and no
`href`, API call, state hook or displayed value changed. The two inline links
(#1, #2) keep their inline appearance — the hit box grows via padding with a
matching negative margin, so surrounding rows keep their original height.

> Inline links have a WCAG 2.5.8 exception, but this project's acceptance
> criteria set a flat 44 px, so they were fixed rather than excused.

### ⚠ A separate defect this uncovered — the focus ring never rendered

Checking the privacy link with a real keyboard (not `element.focus()`, which
does not trigger `:focus-visible`) showed `:focus-visible` matching but
`outline-style: none`. The cause was in `index.css`:

```css
.focus-ring:focus-visible { outline: 2px solid …; }   /* written first  */
.focus-ring:focus         { outline: none; }          /* written second */
```

Equal specificity, so source order decides — and every `:focus-visible` element
also matches `:focus`. The reset silently won. **No keyboard user has ever seen
a focus ring anywhere in this application.** The reset now comes first.

Verified after the fix, at 390 and 1280: Tab reaches the privacy link, it
reports `:focus-visible`, its computed outline is `solid 2px rgb(37, 99, 235)`
at 2 px offset, its box is 96 × 44, and Enter opens the notice.

The harness now records this per capture (`metrics.focusRing`), so it cannot be
lost silently again: **114 of 114** elements carrying `.focus-ring` show a
visible outline; **0** invisible.

Two captures report no focusable element on the first Tab — both are
`90-parent-status`, whose unlinked screen has **zero** interactive controls by
design. It is onboarding text directing the reader back to the LINE chat, and
nothing is missing from it.

### Print output — verified, not assumed

`DataTable` renders a desktop `<table>` and a mobile card list from one column
definition. The harness re-measures under `media: print`:

| capture | screen | print |
|---|---|---|
| `/reports/daily` @1280 | 2 tables, 0 card lists | 2 tables, 0 card lists |
| `/admin/users` @1280 | 1 table, 0 card lists | 1 table, 0 card lists |
| `/admin/users` @390 | 0 tables, 1 card list | 0 tables, 1 card list |

Exactly one rendering is visible at any width and print emulation changes
neither. A4 portrait is ≈794 CSS px, above the `md` breakpoint (768 px), so the
printed page gets the table. Report pages carry 2 named keyboard scroll regions,
0 unnamed. `SummaryPrintView` is untouched.

### DriverPretrip safety gate — verified at runtime

Driven with Playwright at 390 px against `/driver`:

| probe | result |
|---|---|
| Dialog present on load | 1 |
| Close ("ปิด") buttons inside the dialog | **0** |
| Dialog still present after **Escape** | **yes** |
| Dialog still present after **backdrop click** | **yes** |

The only exit is answering the checklist. `Modal` gained `dismissible={false}`
specifically so this gate could gain dialog semantics, a focus trap and a scroll
lock **without** gaining a way to skip it.

---

## 4. Artifacts

### Absolute paths

| what | path |
|---|---|
| Before (baseline) | `D:\Projects\lampang-bus-system-uiredesign\outputs\ui-redesign\before\` |
| After (current) | `D:\Projects\lampang-bus-system-uiredesign\outputs\ui-redesign\after\` |
| Machine-readable report | `D:\Projects\lampang-bus-system-uiredesign\outputs\ui-redesign\after\report.json` |
| Baseline nav snapshot | `D:\Projects\lampang-bus-system-uiredesign\outputs\ui-redesign\nav-before.json` |
| Route matrix (markdown) | `D:\Projects\lampang-bus-system-uiredesign\outputs\ui-redesign\route-matrix.md` |
| Interim phases | `…\outputs\ui-redesign\{phase2,phase3,phase4}\` |
| UAT plan | `D:\Projects\lampang-bus-system-uiredesign\docs\ui-redesign-uat.md` |
| This handoff | `D:\Projects\lampang-bus-system-uiredesign\docs\ui-redesign-handoff.md` |

`outputs/` is gitignored (`.gitignore:33`), so none of it is in the commit range.

### Capture count reconciliation — `after/` now balances exactly

| | count |
|---|---|
| Rows in `after/report.json` | **120** |
| `.png` files in `after/` | **120** |
| Difference | **0** ✓ |

**The orphan.** `26-transfer-modal-desktop.png` (written 2026-08-26 19:37) came
from a scenario id that no longer exists in `capture.mjs` — it was renamed
mid-session. It has **no row in `report.json`** and contributed to no metric;
this was confirmed by matching every file on disk against the report's row
names before touching anything.

It was **not deleted**. It now lives in
`outputs\ui-redesign\orphans\26-transfer-modal-desktop.png`, alongside a
`README.txt` explaining its provenance, so `after/` reconciles 1:1 with the
report.

**How the count grew:** 112 → 118 when the three uncaptured experiences were
added (parent status, parent link, public QR = 6 captures), then 118 → 120 with
`93-public-qr-notice` at two viewports. Every earlier figure was correct for
what had been measured at the time.

### Curated review set — 7 experiences at 390 and 1280

All under `…\outputs\ui-redesign\after\`:

| experience | 390 (mobile) | 1280 (desktop) |
|---|---|---|
| Admin | `02-admin-dash-mobile.png` | `02-admin-dash-desktop.png` |
| Province | `07-province-mobile.png` | `07-province-desktop.png` |
| Affiliation | `08-affiliation-mobile.png` | `08-affiliation-desktop.png` |
| School | `09-school-mobile.png` | `09-school-desktop.png` |
| Transport | `85-transport-dash-mobile.png` | `85-transport-dash-desktop.png` |
| Driver | `11-driver-mobile.png` | `11-driver-tablet.png` † |
| Parent / LIFF | `91-parent-link-mobile.png` | `91-parent-link-desktop.png` |
| Public QR (LINE-adjacent) | `92-public-qr-mobile.png` | `92-public-qr-desktop.png` |

† The driver dashboard is captured at mobile + tablet by design — drivers use
phones, and a desktop capture would misrepresent the real use. Driver pages that
*are* captured at 1280: `64-driver-pickup-desktop`, `66-driver-pickup-edit-desktop`,
`89-driver-vehicle-reg-desktop`.

Worth a look beyond the dashboards:

- `66-driver-pickup-edit-mobile.png` / `67-school-pickup-edit-mobile.png` — the shared editor
- `79-import-preview-mobile.png` / `81-import-history-detail-desktop.png` — the import workflows
- `82-student-transfer-desktop.png` — the modal that was previously inert
- `90-parent-status-mobile.png` — the LIFF refusal state (correct behaviour outside LINE)
- `92-public-qr-mobile.png` / `93-public-qr-notice-mobile.png` — the fixed
  privacy link (now 96 × 44) and the notice it opens
- `05-admin-error-desktop.png` — the deliberate all-fail scenario

---

## 5. Human UAT checklist

**Rules for this pass:** local backend and UAT seed data only. Do **not** point
the frontend at the production API, and do **not** use real pupil, guardian or
driver records in anything captured or shared.

```bash
# terminal 1 — local backend against the UAT database
cd backend && npm run dev

# terminal 2 — frontend against localhost only
cd frontend && npx vite --port 5173
```

Confirm before starting: the frontend's API base resolves to localhost, and the
seeded database is **not** a production dump.

### 5.1 Login / logout / must-change-password

- [ ] Log in as each of the six roles; each lands on its own home
- [ ] Wrong password shows an error, not a blank page
- [ ] A seeded account with `must_change_password` is forced to `/change-password`
- [ ] Changing the password logs the session out and requires a fresh login
      *(the backend invalidates all prior tokens — this is expected)*
- [ ] The browser password manager offers to save; the three fields are
      current-password / new-password / new-password
- [ ] Logout clears the session and back-button does not restore it

### 5.2 Admin dashboard and the ผู้ใช้งาน KPI

- [ ] The ผู้ใช้งาน KPI shows the **total** user count, not the suspended count
      *(this was the original bug: it displayed 643 when the true total was 276)*
- [ ] Cross-check the number against the database
- [ ] Attention queue items link to the right place; a failed load reads
      "ไม่ทราบสถานะ", never "เรียบร้อย"

### 5.3 School import — all three workflows

- [ ] **Preview:** upload a seeded `.xlsx` and a `.csv`; every classification
      renders (ready / duplicate / guardian mismatch / reactivation / vehicle
      blocker / error)
- [ ] Preview writes **nothing** — confirm the pupil count is unchanged after
- [ ] Tick "อัปเดตผู้ปกครอง" and "กู้คืนนักเรียน" per row; confirm only the
      ticked rows are affected
- [ ] Apply, then verify the counts in the pupil list
- [ ] **History:** open a past batch, download the CSV report, open it in Excel —
      confirm a cell starting with `=` is text, not a formula
- [ ] **Rollback:** requires a reason; rolls back only the selected rows;
      soft-delete only — the pupils still exist in the database
- [ ] **Transfer request:** the "ขอโอนย้ายนักเรียน" button opens the dialog
      *(this was completely inert before — it must work now)*
- [ ] A transfer request changes no pupil data until an admin approves it

### 5.4 Driver — pre-trip and pickup editor

On a real phone if possible, not just a narrow browser window.

- [ ] The pre-trip gate appears before check-in and **cannot** be dismissed —
      no close button, Escape does nothing, tapping outside does nothing
- [ ] "ทุกรายการปกติ" and the per-item fail path both record correctly
- [ ] A failed item requires/accepts a note and the record reaches the backend
- [ ] Pickup editor: create a point, place it on the map, confirm the saved
      latitude/longitude match what was placed
- [ ] Select pupils in the editor; confirm the right ones are attached
- [ ] Delete a point — the confirmation names the point; pupils are **not** deleted
- [ ] Closing a half-filled editor asks before discarding
- [ ] Every control is comfortably thumb-sized in real use

### 5.5 Approval and destructive flows

For each, confirm the dialog **names the specific record** and that Cancel is
focused first:

- [ ] Close / reopen a school account (`/affiliation/accounts`)
- [ ] Bulk-import school accounts
- [ ] Change the current term (`/admin/term-settings`) — verify new check-ins
      land in the new term
- [ ] Delete a geofence, and seed default geofences
- [ ] Delete an inspection record — verify the vehicle status recomputes
- [ ] Abort a part-completed verification attempt
- [ ] Withdraw a required driver consent — verify the public display suspends
- [ ] Bulk-delete pickup points — check the progress count and the failure path
- [ ] Cancel a pupil's leave — verify they return to today's run

### 5.6 Reports — print and export

- [ ] Each report renders with seeded data
- [ ] **Print preview** shows the ruled table, not mobile cards
- [ ] `/admin/executive-print` prints on one A4 portrait page as expected
- [ ] CSV and Excel exports open cleanly; Thai text is not mojibake
- [ ] **Compare an export byte-for-byte against current production output** —
      the export path was not intended to change
- [ ] The research dataset export downloads and its counts match the preview

### 5.7 Parent / LIFF — **required, and not substitutable by automation**

> **Why this section cannot be automated, and must not be made automatable.**
> `ParentStatus` takes its identity only from a verified LIFF `id_token`.
> Unlike the user-id helper, `getLiffIdToken()` has **no query-param fallback**
> — by design. Outside LINE the page therefore renders its unlinked state and
> shows no pupil data.
>
> The automated capture (`90-parent-status`) asserts exactly that refusal, and
> **a refusal is the pass condition, not a failure.** No query-param identity
> fallback may be added, and the verified `id_token` must not be bypassed, to
> make this testable. The populated view stays a human check inside LINE —
> this checklist is where it gets covered.

Must be tested **inside the LINE client**.

- [ ] `/parent/link` inside LINE: bind with a seeded phone + pupil code
- [ ] The preview screen shows the right pupil before confirming
- [ ] `/parent` shows today's status for the linked pupil
- [ ] Outside LINE, `/parent` refuses with the not-linked guidance and leaks
      **no** pupil data *(automated capture `90-parent-status` asserts this)*
- [ ] Status wording is legible and unambiguous without relying on colour
- [ ] Public QR scan `/qr/:token` shows the right level for an anonymous
      scanner, and a staff scan is recorded in the audit log
- [ ] On a real phone, the privacy link, the emergency-contact number and the
      notice's dismiss button are all comfortably tappable
- [ ] Tab to the privacy link with a keyboard: a blue focus ring is clearly
      visible, and Enter opens the notice
- [ ] The parent consent dialog's two buttons are tappable and keyboard
      operable *(reachable only inside LINE, so unmeasured by automation)*
- [ ] LIFF app bar: "กลับ" and "รีเฟรช" are comfortably tappable one-handed

### 5.8 Permissions — all six roles

- [ ] For each role, every sidebar entry opens *(automated: 0 dead links)*
- [ ] For each role, **deep-link by hand** to a route belonging to another role
      and confirm it is refused — e.g. as `driver`, type `/admin/users`
- [ ] Confirm the refusal is server-side, not merely a hidden menu item
- [ ] A school account sees only its own school; an affiliation only its own
      affiliation *(scope, not just role)*
- [ ] A grade-teacher account sees the restricted school views

> The automated `permission-check` proves the **UI** offers no route a role
> cannot open. It says nothing about the server. §5.8 is where the server-side
> guard actually gets tested, and it is the one that matters.

---

## 6. Known decisions and limitations

### External policy decision — guardian phone column (PDPA)

`components/VehicleRosterCard.jsx` renders a pupil's name alongside their
guardian's name and phone number, for both province and affiliation scope.

**Unchanged in this branch, deliberately.** The backend authorises it and
operational workflows may depend on it, so it renders exactly as before and
carries `// TODO: ตรวจสอบกับผู้เชี่ยวชาญ` in the source.

Whether every scope needs the guardian phone column is a **data-minimisation
decision for the data controller**, not a UI one. It needs a ruling from someone
with the authority to make it, and that ruling should be recorded. Nothing here
narrowed, redacted or removed the data on its own initiative.

The same principle was applied to the research dataset export, which carries
user-level audit rows: an on-screen notice was added, the data was not altered.

### Known limitations

1. **No live-data verification.** Everything visual was validated against
   synthetic Thai fixtures. Long real school names, unusual plate formats and
   unexpected role scopes remain unverified — §5 is where that gets covered.
2. **Backend tests were not run** — they need a MySQL instance. The diff touches
   no backend file, so they should be unaffected; that is an inference from the
   diff, not a measurement.
3. **The permission check reads the UI, not the server.** See the note at §5.8.
4. **LIFF pages cannot be automated end-to-end — and must stay that way.**
   `/parent` refuses outside the LINE client by design; only its refusal state
   is captured, and that refusal is the assertion. Adding a query-param
   identity fallback or bypassing the verified `id_token` to make it testable
   is explicitly out of bounds. The populated view is a **human check inside
   LINE** — §5.7. It is not an automated failure.
5. **Five of the eight tap-target fixes are computed, not captured.** The parent
   consent dialog and the LIFF app bar are only reachable inside LINE. The
   Tailwind arithmetic was validated against three measured controls on the
   same flow before being trusted for the rest, but a human should still
   confirm them on a real phone — §5.7 covers it.
6. **A passing build is not a passing page.** Vite does not resolve identifiers,
   so a missing import inside a modal body compiles cleanly and throws when the
   modal opens. Three real defects in this branch were found only by the runtime
   smoke — including a button that had never worked. Keep the `expect`
   assertions in `capture.mjs` alive; they are the reason the gate means
   anything.
7. **A measurement only covers what it renders.** The public QR page reported
   one sub-44px control until the fixture was widened to level 2 and the notice
   was opened — then it reported three. Two lessons are baked into the harness:
   fixtures must exercise the *branches* a page has, and modals must be opened
   by `act` before they can be judged.
8. **`codex/production-100-phasework` still tracks the production branch.**
   Flagged during the upstream cleanup; it is outside this Goal's scope and was
   deliberately left alone.

---

## 7. Working tree

**Clean.** `git status --short` returns nothing.

The files that were uncommitted at the previous handoff have been reviewed and
committed. All were produced by this Goal — none belonged to the user or sat
outside scope, so nothing was discarded, checked out or deleted:

| file | disposition |
|---|---|
| `scripts/ui-redesign/capture.mjs` | Goal tooling → committed (#36 and #37) |
| `docs/ui-redesign-handoff.md` | Goal docs → committed (#37) |
| `frontend/src/pages/qr/VehicleQr.jsx` | targeted fix → #36 |
| `frontend/src/pages/parent/ParentStatus.jsx` | targeted fix → #36 |
| `frontend/src/components/consent/PublicPrivacyNotice.jsx` | targeted fix → #36 |
| `frontend/src/components/consent/ParentConsentModal.jsx` | targeted fix → #36 |
| `frontend/src/index.css` | focus-ring cascade fix → #36 |

`outputs/` is gitignored throughout and never enters a commit.

---

## 8. Recommended review commands — read-only/local verification

```bash
cd D:/Projects/lampang-bus-system-uiredesign

# what changed, and confirmation of scope
git log --oneline d9485ec..HEAD
git diff --stat d9485ec..HEAD
git diff --name-only d9485ec..HEAD | grep -E '^backend/|App\.jsx' | wc -l   # expect 0

# read the diff a commit at a time — the commit messages carry the reasoning
git log -p --reverse d9485ec..HEAD

# re-run every static gate (fast, no server needed)
cd frontend && npm run build && npm run check:labels && cd ..
node scripts/ui-redesign/page-status.mjs
node scripts/ui-redesign/route-matrix.mjs --gate
node scripts/ui-redesign/nav-snapshot.mjs --compare outputs/ui-redesign/nav-before.json
node scripts/ui-redesign/permission-check.mjs

# re-run the visual + runtime smoke (needs the dev server)
cd frontend && npx vite --port 5173     # terminal 1
node scripts/ui-redesign/capture.mjs --tag codex-release   # terminal 2
```

Deployment is intentionally kept out of this local verification block. The
approved operator path advances production only by fast-forward (never force),
builds to `frontend/dist-new`, atomically swaps the live `dist`, retains the
previous bundle for rollback, and then runs the postdeploy/public gates.
