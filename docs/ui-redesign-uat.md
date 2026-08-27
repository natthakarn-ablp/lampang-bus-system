# UI Redesign — UAT Plan

**Branch:** `codex/full-ui-redesign` · **Base:** `d9485ec`
**Nothing here has been pushed or deployed.**

All figures below come from `outputs/ui-redesign/{before,after}/report.json`,
produced by `scripts/ui-redesign/capture.mjs`. Every capture stubs `/api/**`
with synthetic Thai fixtures, so no backend, database or production data is
involved at any point.

---

## 1. Automated checks — run these first

```bash
cd frontend && npm run build
cd frontend && npm run check:labels
node scripts/ui-redesign/nav-snapshot.mjs --compare outputs/ui-redesign/nav-before.json
node scripts/ui-redesign/permission-check.mjs
node scripts/ui-redesign/page-status.mjs
node scripts/ui-redesign/route-matrix.mjs --gate
```

Then, with the dev server running:

```bash
cd frontend && npx vite --port 5173
node scripts/ui-redesign/capture.mjs --tag after
```

| check | expected |
|---|---|
| `npm run build` | passes |
| `npm run check:labels` | PASSED |
| `nav-snapshot --compare` | ✓ PASS — no route or menu entry lost |
| `permission-check` | ✓ PASS — 0 leaks, 0 dead links (exit 0) |
| `page-status` | Partial 0 (exits non-zero while any page is Partial) |
| `route-matrix --gate` | reconciles to 89, exit 0 |
| capture: horizontal overflow | 0 |
| capture: sub-44px tap targets | 0 |
| capture: sub-16px mobile text inputs | 0 |
| capture: render loops | 0 |
| capture: failed captures | 0 — every page's `expect` selectors present |
| capture: console errors | only `05-admin-error-desktop` (deliberate all-fail scenario) |

**A passing build is not a passing page.** Vite does not resolve identifiers, so
a missing import inside a modal body compiles cleanly and throws when the modal
opens. That is why every capture carries `expect` selectors and why the modals
are opened by `act` rather than photographed from the page behind them — three
real defects in this branch were found only that way.

## 2. Measured results

| metric | before | after |
|---|---|---|
| Captures | 23 | **112** |
| Sub-44×44px tap targets | **370** | **0** |
| Horizontal overflow (390/768/1280/1920) | 0 | 0 |
| Sub-16px text inputs on mobile | — | 0 |
| React render loops | 1 (DriverPretrip) | **0** |
| Console errors (excluding the failure scenario) | 8 | **0** |
| Failed captures (missing expected content) | — | **0** |
| Routes | 89 | 89 |
| Menu entries across 6 roles | 74 | 74 |
| Menu entries outside a role's `allowedRoles` | 0 | **0** (now checked, not assumed) |
| Unnamed keyboard scroll regions | — | 0 |
| Pages Partial | 28 | **0** |

Tap targets and overflow are measured at 390 / 768 / 1280 / 1920.

### Target-size measurement — what is and is not counted

- A checkbox or radio inside a `<label>` is measured at the **label's** size,
  because that is the region a tap actually hits.
- Leaflet's marker pins (25×41) and its attribution links are **excluded**, under
  the WCAG 2.5.8 "essential" exception — a pin's size is its position, and the
  attribution is required link text. Leaflet's 30px zoom buttons are **not**
  exempt and were restyled to 44px.
- Sub-16px is measured only on controls that raise a text keyboard, since that
  is what triggers the iOS zoom this guards against.

### Print output

Reports are printed, and `DataTable` renders a desktop `<table>` and a mobile
card list from one column definition. The harness re-measures the printed pages
under `media: print`:

| page | screen | print |
|---|---|---|
| `/reports/daily` (1280) | 2 tables, 0 card lists | 2 tables, 0 card lists |
| `/admin/users` (1280) | 1 table, 0 card lists | 1 table, 0 card lists |
| `/admin/users` (390) | 0 tables, 1 card list | 0 tables, 1 card list |

Exactly one rendering is visible at any width, and print emulation does not
change it. A4 portrait is ≈794 CSS px, above the `md` breakpoint (768px), so the
printed page gets the table. `SummaryPrintView` is untouched; `ExecutivePrint`
keeps its ruled A4 tables and is exempted in `page-status.mjs` with the reason
recorded there.

### Contrast (WCAG 2.2 AA, 1.4.3 — 4.5:1 for body text)

| pair | before | after |
|---|---|---|
| success text on `success-soft` | 2.24 ✗ | **4.84** ✓ |
| warn text on `warn-soft` | 1.93 ✗ | **6.37** ✓ |
| danger text on `danger-soft` | 3.08 ✗ | **5.30** ✓ |
| info text on `info-soft` | 2.42 ✗ | **5.17** ✓ |
| KPI success on white | 2.54 ✗ | **5.48** ✓ |
| KPI warn on white | 2.15 ✗ | **7.09** ✓ |
| KPI danger on white | 3.76 ✗ | **6.47** ✓ |

---

## 3. Manual UAT — what a human still has to check

The capture harness cannot log in, cannot exercise a real approval, and cannot
verify that an export opens. These need a person against a **local** database
seeded with demo data (`backend/scripts/seed-demo-users.js`), never production.

### 3.1 Authentication (all roles)
- [ ] Login succeeds and lands on the correct role home
- [ ] Login with a wrong password shows the error, keeps the username
- [ ] Show/hide password toggle
- [ ] `must-change-password` still forces the change-password screen
- [ ] Logout returns to `/login` and the back button does not re-enter
- [ ] A protected route while logged out redirects to `/login`
- [ ] A role opening another role's route sees "ไม่มีสิทธิ์เข้าถึง"
- [ ] Token refresh across a session boundary

### 3.2 Navigation (per role: admin, province, affiliation, school, transport, driver)
- [ ] Every sidebar entry opens a real page
- [ ] The active entry is the one you are on, including nested routes
- [ ] Collapsing the sidebar to the icon rail keeps every entry reachable, with tooltips
- [ ] The collapsed state survives a reload
- [ ] On a phone: the drawer opens, Escape closes it, focus returns to the menu button, the page behind does not scroll
- [ ] Driver bottom navigation reaches the four primary tasks

### 3.3 Approval workflows — the highest-risk area
For each of the four queues (admin transfer, admin vehicle, affiliation
transfer, affiliation vehicle):
- [ ] Approve applies the change and the row moves out of รออนุมัติ
- [ ] Reject records the reason and the row moves to ไม่อนุมัติ
- [ ] The note is required where it was required before, optional where it was optional
- [ ] A restore request blocked by an active canonical plate cannot be approved
- [ ] The action appears in the audit log with the right actor and note
- [ ] Double-clicking Approve does not submit twice

### 3.4 Destructive actions
- [ ] Deleting a user shows the account name in the dialog
- [ ] Escape and Cancel both abort; focus returns to the row
- [ ] Enter immediately after the dialog opens does **not** delete (focus starts on Cancel)
- [ ] The deletion is recorded in the audit log

### 3.5 Reports and exports — must not regress
- [ ] Daily / Monthly / Summary / Policy each load
- [ ] CSV, Excel and PDF each download and open
- [ ] The PDF renders Thai text correctly
- [ ] The printed layout is still usable

### 3.6 LINE / LIFF
- [ ] The parent page opens inside the LINE webview
- [ ] Account linking still completes
- [ ] A parent sees only their own children
- [ ] The unlinked and no-children states render

### 3.7 Screen reader / keyboard (spot check)
- [ ] Tab order follows the visual order on a list page
- [ ] The focus ring is visible on every control, including on the navy sidebar
- [ ] A dialog traps focus and returns it on close
- [ ] Table column headers are announced with their cells
- [ ] Status badges read as text, not as colour

---

## 4. Known limitations

1. **No live-data verification.** Everything visual was validated against
   synthetic fixtures. Real-data edge cases — very long real school names, an
   unusual plate format, a role with an unexpected scope — remain unverified.
2. **Migration is complete; judgement calls are documented, not hidden.**
   Partial is 0. Six pages carry a recorded exemption for a specific pattern
   (login, the LIFF parent pages, the public QR page, the branded report bands,
   and `ExecutivePrint`, which is the print artifact rather than a screen page).
   Each reason is in `EXEMPT` in `page-status.mjs` where it can be argued with.
   No page was moved to N/A to clear the gate.
3. **Backend tests were not run** — they need a MySQL instance. No backend file
   was modified in this branch (`git diff --name-only d9485ec..HEAD` matches
   nothing under `backend/`, and `App.jsx` is untouched), so they should be
   unaffected — but that is an inference from the diff, not a measurement.
4. **`/api/visits` analytics ping** is public by design; unchanged here.
5. **PDPA item for the data controller:** the vehicle roster pairs a pupil's
   name with their guardian's name and phone number for both province and
   affiliation scope. The backend authorises it and workflows may depend on it,
   so it is rendered as before and marked with
   `// TODO: ตรวจสอบกับผู้เชี่ยวชาญ` in `VehicleRosterCard`. Whether every
   scope needs the guardian phone column is a data-minimisation decision, not a
   UI one.
6. **The permission check reads the UI, not the server.**
   `permission-check.mjs` proves no role's menu offers a route that role's own
   route guard excludes, and that no menu entry is dead. Server-side
   authorisation is the control that actually matters; it is untouched by this
   branch and was exercised separately against production earlier in this
   engagement.

## 5. Page migration status

Derived from source by `scripts/ui-redesign/page-status.mjs`, not hand-kept. A
page is Complete when, for every pattern it actually contains, it uses the shared
primitive for that pattern. A page with no table is N/A for `table`, not
penalised for it. Exemptions are listed in `EXEMPT` in that file with the reason
each one is legitimate.

| page | status | gaps |
|---|---|---|
| `components/AuditLogTable.jsx` | Complete | — |
| `components/consent/DriverConsentForm.jsx` | Complete | — |
| `components/PickupPointFields.jsx` | Complete | — |
| `components/VehicleRosterCard.jsx` | Complete | — |
| `pages/admin/AdminAuditLog.jsx` | N/A | — |
| `pages/admin/AdminDashboard.jsx` | Complete | — |
| `pages/admin/AdminGeofences.jsx` | Complete | — |
| `pages/admin/AdminLiveVehicles.jsx` | Complete | — |
| `pages/admin/AdminPickupPointManagement.jsx` | Complete | — |
| `pages/admin/AdminRouteDeviations.jsx` | Complete | — |
| `pages/admin/AdminVehicleQr.jsx` | Complete | — |
| `pages/admin/DriverIntegrity.jsx` | Complete | — |
| `pages/admin/EvaluationDashboard.jsx` | Complete | — |
| `pages/admin/ExecutivePrint.jsx` | Complete | — |
| `pages/admin/ExecutiveSummary.jsx` | Complete | — |
| `pages/admin/MeasurementFramework.jsx` | N/A (reasoned) | — |
| `pages/admin/ResearchExport.jsx` | Complete | — |
| `pages/admin/ResearchMetrics.jsx` | Complete | — |
| `pages/admin/StudentTransferRequests.jsx` | Complete | — |
| `pages/admin/SystemHealth.jsx` | Complete | — |
| `pages/admin/TermSettings.jsx` | Complete | — |
| `pages/admin/UserManagement.jsx` | Complete | — |
| `pages/admin/VehicleRequests.jsx` | Complete | — |
| `pages/affiliation/AffAuditLog.jsx` | N/A | — |
| `pages/affiliation/AffDailyStatus.jsx` | Complete | — |
| `pages/affiliation/AffEmergencyList.jsx` | Complete | — |
| `pages/affiliation/AffiliationDashboard.jsx` | Complete | — |
| `pages/affiliation/AffiliationLiveVehicles.jsx` | Complete | — |
| `pages/affiliation/AffiliationPickupMap.jsx` | Complete | — |
| `pages/affiliation/AffSchoolAccounts.jsx` | Complete | — |
| `pages/affiliation/AffStudentSearch.jsx` | Complete | — |
| `pages/affiliation/AffTransferRequests.jsx` | Complete | — |
| `pages/affiliation/AffVehicleList.jsx` | Complete | — |
| `pages/affiliation/AffVehicleRequests.jsx` | Complete | — |
| `pages/affiliation/SchoolList.jsx` | Complete | — |
| `pages/ChangePassword.jsx` | Complete | — |
| `pages/driver/CheckinPanel.jsx` | N/A | — |
| `pages/driver/DriverApplications.jsx` | Complete | — |
| `pages/driver/DriverDashboard.jsx` | Complete | — |
| `pages/driver/DriverPickupMap.jsx` | Complete | — |
| `pages/driver/DriverPretrip.jsx` | Complete | — |
| `pages/driver/DriverProfile.jsx` | Complete | — |
| `pages/driver/DriverRosterRequests.jsx` | Complete | — |
| `pages/driver/DriverShift.jsx` | Complete | — |
| `pages/driver/DriverVehicleRegistration.jsx` | Complete | — |
| `pages/driver/EmergencyPage.jsx` | Complete | — |
| `pages/driver/StudentList.jsx` | Complete | — |
| `pages/Login.jsx` | N/A (reasoned) | — |
| `pages/parent/ParentLink.jsx` | Complete | — |
| `pages/parent/ParentStatus.jsx` | N/A (reasoned) | — |
| `pages/province/DeploymentReadiness.jsx` | Complete | — |
| `pages/province/ProvAffiliationList.jsx` | Complete | — |
| `pages/province/ProvAuditLog.jsx` | N/A | — |
| `pages/province/ProvDailyStatus.jsx` | Complete | — |
| `pages/province/ProvEmergencyList.jsx` | Complete | — |
| `pages/province/ProvinceDashboard.jsx` | Complete | — |
| `pages/province/ProvinceLiveVehicles.jsx` | Complete | — |
| `pages/province/ProvincePickupMap.jsx` | Complete | — |
| `pages/province/ProvSchoolList.jsx` | Complete | — |
| `pages/province/ProvStudentSearch.jsx` | Complete | — |
| `pages/province/ProvVehicleList.jsx` | Complete | — |
| `pages/qr/VehicleQr.jsx` | N/A (reasoned) | — |
| `pages/reports/DailyReport.jsx` | Complete | — |
| `pages/reports/MonthlyReport.jsx` | Complete | — |
| `pages/reports/PolicyReport.jsx` | Complete | — |
| `pages/reports/SummaryReport.jsx` | Complete | — |
| `pages/school/EmergencyList.jsx` | Complete | — |
| `pages/school/ImportHistoryModal.jsx` | Complete | — |
| `pages/school/ImportPreviewModal.jsx` | Complete | — |
| `pages/school/SchoolApprovals.jsx` | Complete | — |
| `pages/school/SchoolAuditLog.jsx` | N/A (reasoned) | — |
| `pages/school/SchoolBulkVehicles.jsx` | Complete | — |
| `pages/school/SchoolDashboard.jsx` | Complete | — |
| `pages/school/SchoolLiveVehicles.jsx` | Complete | — |
| `pages/school/SchoolPickupMap.jsx` | Complete | — |
| `pages/school/SchoolRegistrationReview.jsx` | Complete | — |
| `pages/school/SchoolTeacherAccounts.jsx` | Complete | — |
| `pages/school/StudentSearch.jsx` | Complete | — |
| `pages/school/StudentTransferModal.jsx` | Complete | — |
| `pages/school/VehicleList.jsx` | Complete | — |
| `pages/school/VehicleVerification.jsx` | Complete | — |
| `pages/transport/InspectionForm.jsx` | Complete | — |
| `pages/transport/TransportDashboard.jsx` | Complete | — |
| `pages/transport/TransportPickupMap.jsx` | Complete | — |
| `pages/transport/TransportVehicleList.jsx` | Complete | — |
| `pages/transport/VerificationQueue.jsx` | Complete | — |

Complete 77 · Partial 0 · N/A 4

### Per-route status

Derived by `scripts/ui-redesign/route-matrix.mjs`, which joins App.jsx's route
list to the page each route renders. Index, redirect, alias and external routes
carry a reason rather than a status.

| route | kind | status | page / reason | gaps |
|---|---|---|---|---|
| `/login` | page | N/A (reasoned) | pages/Login.jsx | — |
| `/change-password` | page | Complete | pages/ChangePassword.jsx | — |
| `/manual/*` | external | N/A | redirects out of the SPA to the published static manual | — |
| `/driver` | index | N/A | DriverLayout index route — renders DriverDashboard | — |
| `/driver/roster` | page | Complete | pages/driver/StudentList.jsx | — |
| `/driver/emergency` | page | Complete | pages/driver/EmergencyPage.jsx | — |
| `/driver/profile` | page | Complete | pages/driver/DriverProfile.jsx | — |
| `/driver/leaves` | redirect | N/A | <Navigate to="/driver"> — the leaves feature folded into the dashboard; the path is kept so old links still resolve | — |
| `/driver/requests` | page | Complete | pages/driver/DriverRosterRequests.jsx | — |
| `/driver/pretrip` | page | Complete | pages/driver/DriverPretrip.jsx | — |
| `/driver/pickup-map` | page | Complete | pages/driver/DriverPickupMap.jsx | — |
| `/driver/shift` | page | Complete | pages/driver/DriverShift.jsx | — |
| `/driver/applications` | page | Complete | pages/driver/DriverApplications.jsx | — |
| `/driver/vehicle-registration` | page | Complete | pages/driver/DriverVehicleRegistration.jsx | — |
| `/school` | index | N/A | SchoolLayout index route — renders SchoolDashboard | — |
| `/school/students` | page | Complete | pages/school/StudentSearch.jsx | — |
| `/school/vehicles` | page | Complete | pages/school/VehicleList.jsx | — |
| `/school/vehicle-verification` | page | Complete | pages/school/VehicleVerification.jsx | — |
| `/school/status` | redirect | N/A | <Navigate to="/school"> — daily status folded into the school dashboard | — |
| `/school/emergencies` | page | Complete | pages/school/EmergencyList.jsx | — |
| `/school/missing` | redirect | N/A | <Navigate to="/school"> — retired view, path kept for old links | — |
| `/school/approvals` | page | Complete | pages/school/SchoolApprovals.jsx | — |
| `/school/bulk-vehicles` | page | Complete | pages/school/SchoolBulkVehicles.jsx | — |
| `/school/audit-log` | page | N/A (reasoned) | pages/school/SchoolAuditLog.jsx | — |
| `/school/pickup-map` | page | Complete | pages/school/SchoolPickupMap.jsx | — |
| `/school/live-vehicles` | page | Complete | pages/school/SchoolLiveVehicles.jsx | — |
| `/school/teacher-accounts` | page | Complete | pages/school/SchoolTeacherAccounts.jsx | — |
| `/school/registration-review` | page | Complete | pages/school/SchoolRegistrationReview.jsx | — |
| `/affiliation` | index | N/A | AffiliationLayout index route — renders AffiliationDashboard | — |
| `/affiliation/schools` | page | Complete | pages/affiliation/SchoolList.jsx | — |
| `/affiliation/students` | page | Complete | pages/affiliation/AffStudentSearch.jsx | — |
| `/affiliation/vehicles` | page | Complete | pages/affiliation/AffVehicleList.jsx | — |
| `/affiliation/status` | page | Complete | pages/affiliation/AffDailyStatus.jsx | — |
| `/affiliation/emergencies` | page | Complete | pages/affiliation/AffEmergencyList.jsx | — |
| `/affiliation/accounts` | page | Complete | pages/affiliation/AffSchoolAccounts.jsx | — |
| `/affiliation/audit-log` | page | N/A | pages/affiliation/AffAuditLog.jsx | — |
| `/affiliation/live-vehicles` | page | Complete | pages/affiliation/AffiliationLiveVehicles.jsx | — |
| `/affiliation/pickup-map` | page | Complete | pages/affiliation/AffiliationPickupMap.jsx | — |
| `/affiliation/transfer-requests` | page | Complete | pages/affiliation/AffTransferRequests.jsx | — |
| `/affiliation/vehicle-requests` | page | Complete | pages/affiliation/AffVehicleRequests.jsx | — |
| `/province` | index | N/A | ProvinceLayout index route — renders ProvinceDashboard | — |
| `/province/affiliations` | page | Complete | pages/province/ProvAffiliationList.jsx | — |
| `/province/schools` | page | Complete | pages/province/ProvSchoolList.jsx | — |
| `/province/students` | page | Complete | pages/province/ProvStudentSearch.jsx | — |
| `/province/vehicles` | page | Complete | pages/province/ProvVehicleList.jsx | — |
| `/province/status` | page | Complete | pages/province/ProvDailyStatus.jsx | — |
| `/province/emergencies` | page | Complete | pages/province/ProvEmergencyList.jsx | — |
| `/province/audit-log` | page | N/A | pages/province/ProvAuditLog.jsx | — |
| `/province/live-vehicles` | page | Complete | pages/province/ProvinceLiveVehicles.jsx | — |
| `/province/pickup-map` | page | Complete | pages/province/ProvincePickupMap.jsx | — |
| `/province/readiness` | page | Complete | pages/province/DeploymentReadiness.jsx | — |
| `/reports` | index | N/A | ReportsLayout index route — renders DailyReport | — |
| `/reports/daily` | page | Complete | pages/reports/DailyReport.jsx | — |
| `/reports/monthly` | page | Complete | pages/reports/MonthlyReport.jsx | — |
| `/reports/summary` | page | Complete | pages/reports/SummaryReport.jsx | — |
| `/reports/policy` | page | Complete | pages/reports/PolicyReport.jsx | — |
| `/transport` | index | N/A | TransportLayout index route — renders TransportDashboard | — |
| `/transport/vehicles` | page | Complete | pages/transport/TransportVehicleList.jsx | — |
| `/transport/inspections` | page | Complete | pages/transport/InspectionForm.jsx | — |
| `/transport/verification` | page | Complete | pages/transport/VerificationQueue.jsx | — |
| `/transport/pickup-map` | page | Complete | pages/transport/TransportPickupMap.jsx | — |
| `/admin` | page | Complete | pages/admin/AdminDashboard.jsx | — |
| `/admin/users` | page | Complete | pages/admin/UserManagement.jsx | — |
| `/admin/audit-logs` | page | N/A | pages/admin/AdminAuditLog.jsx | — |
| `/admin/transfer-requests` | page | Complete | pages/admin/StudentTransferRequests.jsx | — |
| `/admin/vehicle-requests` | page | Complete | pages/admin/VehicleRequests.jsx | — |
| `/admin/driver-integrity` | page | Complete | pages/admin/DriverIntegrity.jsx | — |
| `/admin/geofences` | page | Complete | pages/admin/AdminGeofences.jsx | — |
| `/admin/route-deviations` | page | Complete | pages/admin/AdminRouteDeviations.jsx | — |
| `/admin/vehicle-qr` | page | Complete | pages/admin/AdminVehicleQr.jsx | — |
| `/driver/consent` | page | Complete | components/consent/DriverConsentForm.jsx | — |
| `/admin/pickup-points` | page | Complete | pages/admin/AdminPickupPointManagement.jsx | — |
| `/admin/live-vehicles` | page | Complete | pages/admin/AdminLiveVehicles.jsx | — |
| `/admin/measurement` | page | N/A (reasoned) | pages/admin/MeasurementFramework.jsx | — |
| `/admin/research` | page | Complete | pages/admin/ResearchMetrics.jsx | — |
| `/admin/research-export` | page | Complete | pages/admin/ResearchExport.jsx | — |
| `/admin/evaluation` | page | Complete | pages/admin/EvaluationDashboard.jsx | — |
| `/admin/executive` | page | Complete | pages/admin/ExecutiveSummary.jsx | — |
| `/admin/system-health` | page | Complete | pages/admin/SystemHealth.jsx | — |
| `/admin/term-settings` | page | Complete | pages/admin/TermSettings.jsx | — |
| `/admin/readiness` | page | Complete | pages/province/DeploymentReadiness.jsx | — |
| `/admin/executive-print` | page | Complete | pages/admin/ExecutivePrint.jsx | — |
| `/qr/:token` | page | N/A (reasoned) | pages/qr/VehicleQr.jsx | — |
| `/parent` | page | N/A (reasoned) | pages/parent/ParentStatus.jsx | — |
| `/parent/link` | page | Complete | pages/parent/ParentLink.jsx | — |
| `/parent/link/link` | alias | N/A | LINE rewrites the LIFF endpoint by appending /link; this absorbs the double segment | — |
| `/link` | alias | N/A | same LIFF endpoint defence for the case where Endpoint URL is set to / | — |
| `/` | redirect | N/A | RootRedirect — sends each role to its own home | — |
| `/*` | redirect | N/A | catch-all back to / | — |

routes: 89
N/A (reasoned): 5  ·  Complete: 67  ·  N/A: 17
reconciles to 89: YES

---

## 6. Recommended order before merge

1. Run the automated checks in §1 — they are fast and catch regressions cheaply
2. Walk §3.1 and §3.2 for all six roles — this is where a redesign breaks things
3. Walk §3.3 and §3.4 — the highest-consequence flows
4. Confirm §3.5 exports byte-for-byte against the current production output
5. Only then consider a staging deploy
