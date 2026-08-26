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
| capture: horizontal overflow | 0 |
| capture: sub-44px tap targets | 0 |
| capture: sub-16px mobile inputs | 0 |
| capture: console errors | only `05-admin-error-desktop` (deliberate) |

## 2. Measured results

| metric | before | after |
|---|---|---|
| Captures | 23 | 46 |
| Sub-44×44px tap targets | **370** | **0** |
| Horizontal overflow (390/768/1280/1920) | 0 | 0 |
| Sub-16px inputs on mobile | — | 0 |
| Console errors (excluding the failure scenario) | 8 | 0 |
| Routes | 89 | 89 |
| Menu entries across 6 roles | 74 | 74 |
| Menu entries outside a role's `allowedRoles` | 0 | 0 |

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
2. **Not every page is migrated.** See §5. Un-migrated pages still work and
   still inherit the shell, tokens and contrast fixes; they have not had their
   tables and forms moved onto the shared primitives.
3. **Backend tests were not run** — they need a MySQL instance. No backend file
   was modified in this branch, so they should be unaffected, but that is an
   inference, not a measurement.
4. **`/api/visits` analytics ping** is public by design; unchanged here.
5. **PDPA item for the data controller:** the vehicle roster pairs a pupil's
   name with their guardian's name and phone number for both province and
   affiliation scope. The backend authorises it and workflows may depend on it,
   so it is rendered as before and marked with
   `// TODO: ตรวจสอบกับผู้เชี่ยวชาญ` in `VehicleRosterCard`. Whether every
   scope needs the guardian phone column is a data-minimisation decision, not a
   UI one.

## 5. Page migration status

**Fully migrated** onto PageHeader / DataTable / FilterBar / Modal / ConfirmDialog:

`admin/UserManagement` · `admin/AdminDashboard` · `admin/StudentTransferRequests` ·
`admin/VehicleRequests` · `province/ProvSchoolList` · `province/ProvAffiliationList` ·
`province/ProvStudentSearch` · `province/ProvVehicleList` · `affiliation/AffStudentSearch` ·
`affiliation/AffTransferRequests` · `affiliation/AffVehicleRequests` ·
`affiliation/AffVehicleList` · `transport/TransportVehicleList` ·
`components/AuditLogTable` (backs the admin/school/affiliation/province audit pages) ·
`components/VehicleRosterCard`

**Shell + tokens + contrast only** (working, consistent, but tables and forms not
yet on the shared primitives):

`school/*` (dashboard migrated to PageHeader; StudentSearch, VehicleList,
SchoolTeacherAccounts, VehicleVerification, SchoolApprovals, bulk-vehicles,
registration-review remain) · `province/ProvDailyStatus` ·
`province/DeploymentReadiness` · `affiliation/SchoolList` ·
`affiliation/AffSchoolAccounts` · `affiliation/AffDailyStatus` ·
`admin/AdminGeofences` · `admin/AdminPickupPointManagement` ·
`admin/ResearchMetrics` · `admin/EvaluationDashboard` ·
`admin/MeasurementFramework` · `admin/SystemHealth` · `admin/TermSettings` ·
`admin/DriverIntegrity` · `reports/*` (header band and tabs done; tables remain) ·
`driver/*` · `parent/ParentStatus` (tokens + LIFF safe area done)

## 6. Recommended order before merge

1. Run the automated checks in §1 — they are fast and catch regressions cheaply
2. Walk §3.1 and §3.2 for all six roles — this is where a redesign breaks things
3. Walk §3.3 and §3.4 — the highest-consequence flows
4. Confirm §3.5 exports byte-for-byte against the current production output
5. Only then consider a staging deploy
