# Shared Vehicle and Driver Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly prohibited commits and pushes; all commit steps are omitted.

**Goal:** Build an API-optional shared vehicle dossier, school-issued inspection request, DLT officer checklist workflow, eligibility engine, and pre-authorized many-to-many driver pool with per-shift driver attribution.

**Architecture:** Additive MySQL migrations preserve the current `vehicles`, `vehicle_inspections`, and `driver_vehicle_assignments` contracts. New focused services own application snapshots, checklist finalization, eligibility, and operating-shift conflicts; Express routes expose role-scoped workflows, while React pages provide school and transport queues. External DLT verification is represented by a provider field so a future central API can be added without replacing the workflow.

**Tech Stack:** Node.js 20, Express 4, mysql2, Jest/Supertest, React 18, Vite, Tailwind CSS, PDFKit, QR tokens.

---

## File map

**Create**

- `backend/migrations/038_shared_vehicle_verification.sql` — applications, school snapshots, checklist templates/results, evidence metadata, eligibility fields.
- `backend/migrations/039_driver_pool_and_shifts.sql` — driver qualification fields, enriched assignments, operating shifts.
- `backend/src/services/vehicleVerification.service.js` — request snapshots, list/detail, inspection finalization, eligibility.
- `backend/src/services/driverShift.service.js` — many-to-many driver authorization and transactional shift lifecycle.
- `backend/src/routes/verification.routes.js` — role-scoped school/transport/admin endpoints.
- `backend/tests/vehicleVerification.test.js` — isolated service tests.
- `backend/tests/verificationRoutes.test.js` — isolated route permission and response tests.
- `backend/tests/driverShift.test.js` — isolated conflict and eligibility tests.
- `frontend/src/pages/school/VehicleVerification.jsx` — school request, consolidated preview, printable referral.
- `frontend/src/pages/transport/VerificationQueue.jsx` — transport queue and checklist/result workflow.
- `frontend/src/pages/driver/DriverShift.jsx` — authorized vehicle selection and shift start/end.

**Modify**

- `backend/src/app.js` — mount verification routes.
- `backend/src/services/transport.service.js` — expose eligibility and current verification status without student PII.
- `backend/src/services/qrAccess.service.js` — use shared verification summary for public status.
- `backend/src/routes/driver.routes.js` — expose shift endpoints through the focused service.
- `frontend/src/App.jsx` — add school, transport, and driver routes.
- `frontend/src/components/Sidebar.jsx` — add navigation links.
- `frontend/src/pages/transport/InspectionForm.jsx` — retain legacy inspection history while linking users to the new queue.
- `docs/user-manual.md` — document shared referral, DLT verification, and driver pool behavior.

---

### Task 1: Add the shared-verification schema

- [ ] **Step 1: Write migration contract tests**

Create a test that reads `038_shared_vehicle_verification.sql` and asserts the migration defines `vehicle_inspection_applications`, `inspection_application_schools`, `inspection_attempts`, `inspection_checklist_templates`, `inspection_checklist_items`, and `inspection_checklist_results`, plus unique active-request and QR-token constraints.

- [ ] **Step 2: Run the migration contract test and verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; npx jest --config '{"testEnvironment":"node"}' --runInBand tests/vehicleVerification.test.js
```

Expected: FAIL because migration 038 does not exist.

- [ ] **Step 3: Create migration 038**

Use additive tables and foreign keys. Application statuses are `DRAFT`, `READY_TO_PRINT`, `SUBMITTED`, `INSPECTION_PENDING`, `NEEDS_FIX`, `PASSED`, `FAILED`, `EXPIRED`, `SUPERSEDED`, `CANCELLED`. Store school snapshots as counts only; no student identifiers or names. Store `provider_type`, opaque `qr_token`, `version_no`, and `superseded_by_id`.

- [ ] **Step 4: Run the migration contract test**

Expected: PASS.

### Task 2: Implement pure eligibility and visibility rules

- [ ] **Step 1: Add failing tests**

Cover these cases in `vehicleVerification.test.js`:

```js
expect(computeEligibility({ inspection: validPass, documents: validDocs, capacity: 20, peakRiders: 18, validDriverCount: 2 })).toEqual({ status: 'ELIGIBLE', reasons: [] });
expect(computeEligibility({ inspection: expiredPass, documents: validDocs, capacity: 20, peakRiders: 18, validDriverCount: 2 }).status).toBe('INELIGIBLE');
expect(computeEligibility({ inspection: validPass, documents: validDocs, capacity: 10, peakRiders: 18, validDriverCount: 2 }).reasons).toContain('CAPACITY_EXCEEDED');
expect(buildTransportSnapshot(source)).not.toHaveProperty('students');
```

- [ ] **Step 2: Verify the tests fail**

Expected: FAIL because the service and exports do not exist.

- [ ] **Step 3: Implement `computeEligibility` and snapshot sanitizers**

`computeEligibility` must be deterministic and side-effect free. `buildTransportSnapshot` returns vehicle, school, AM/PM counts, peak count, pickup-area summary, drivers, and document status, but never student or parent identifiers.

- [ ] **Step 4: Run tests**

Expected: PASS.

### Task 3: Implement school-created consolidated applications

- [ ] **Step 1: Add failing service tests**

Test that a related school can create an application, an unrelated school gets 403, a second active application returns the existing request with 409 metadata, and the snapshot aggregates multiple schools by morning/evening without names.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement application methods**

Add:

```js
createApplication(pool, { vehicleId, issuingSchoolId, userId, currentTerm })
listSchoolApplications(pool, { schoolId })
getApplication(pool, { applicationId, viewer })
markReadyToPrint(pool, { applicationId, schoolId, userId })
cancelApplication(pool, { applicationId, schoolId, userId })
```

Use a transaction and `SELECT ... FOR UPDATE`. Generate a 32-character opaque QR token using `crypto.randomBytes(16).toString('hex')`. Snapshot counts with grouped SQL over current-term students and schools. Do not store student IDs in application tables.

- [ ] **Step 4: Run tests**

Expected: PASS.

### Task 4: Implement checklist and inspection attempts

- [ ] **Step 1: Add failing tests**

Test required checklist completion, rejection of unknown item codes, append-only attempts, `NEEDS_FIX` action text, and a passing attempt updating the compatibility `vehicle_inspections` summary.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement checklist methods**

Add:

```js
listChecklistTemplates(pool)
startInspection(pool, { applicationId, inspectorUserId })
finalizeInspection(pool, { attemptId, inspectorUserId, result, expiryDate, notes, items })
```

Finalization runs in a transaction, validates all required items, inserts immutable item results, updates the application, writes the legacy summary row, recalculates eligibility, and writes an audit entry.

- [ ] **Step 4: Run tests**

Expected: PASS.

### Task 5: Expose role-scoped verification APIs

- [ ] **Step 1: Add failing Supertest cases**

Required routes:

```text
POST /api/verification/school/applications
GET  /api/verification/school/applications
GET  /api/verification/applications/:id
POST /api/verification/applications/:id/ready
POST /api/verification/applications/:id/cancel
GET  /api/verification/transport/queue
POST /api/verification/transport/applications/:id/start
POST /api/verification/transport/attempts/:id/finalize
GET  /api/verification/transport/checklist
```

Test school scope, transport access, admin access, and province read-only summary. Confirm transport JSON contains no `student_id`, `student_name`, `parent`, or `cid_hash` keys.

- [ ] **Step 2: Verify route tests fail**

- [ ] **Step 3: Implement and mount `verification.routes.js`**

Apply `authenticate` globally and explicit role checks per route. Resolve admin school override using the same pattern as `school.routes.js`. Return standard `{ success, message, data }` envelopes.

- [ ] **Step 4: Run route tests**

Expected: PASS.

### Task 6: Add the school verification page

- [ ] **Step 1: Create the page with request states**

The page lists vehicles related to the school, displays consolidated school/rider counts, creates an application, and renders a printable referral view containing the request number and QR URL. Use existing loading, error, empty-state, badge, and toast components.

- [ ] **Step 2: Add route and navigation**

Add `/school/vehicle-verification` to `App.jsx` and `SCHOOL_NAV`. Grade-scoped teacher accounts must not see or access the create action.

- [ ] **Step 3: Build the frontend**

Run `npm run build` from `frontend`.

Expected: PASS.

### Task 7: Add the transport verification queue

- [ ] **Step 1: Create queue and detail workflow**

The queue filters by status, plate, and school. Detail shows vehicle, owner, driver pool, school counts, peak riders, pickup-area summary, documents, and versioned checklist. It never renders student names.

- [ ] **Step 2: Add inspection finalization UI**

Require every required item to be marked `PASS`, `FAIL`, or `NOT_APPLICABLE` where allowed. Require a note for `FAIL`. Submit `PASSED`, `FAILED`, `NEEDS_FIX`, or `PENDING` with expiry date.

- [ ] **Step 3: Add route and navigation**

Add `/transport/verification` and a `ตรวจรับรองรถ` navigation entry.

- [ ] **Step 4: Build the frontend**

Expected: PASS.

### Task 8: Add driver pool and operating-shift schema

- [ ] **Step 1: Add failing migration/service tests**

Assert migration 039 adds driver qualification fields, assignment role/validity, and `vehicle_operating_shifts` with indexes supporting one open shift per driver and vehicle.

- [ ] **Step 2: Create migration 039**

Extend `driver_vehicle_assignments` with `assignment_role`, `valid_from`, `valid_until`, and `authorization_status`. Create `driver_qualifications` and `vehicle_operating_shifts`. Use generated nullable lock keys or transaction checks compatible with MySQL 8 to enforce open-shift exclusivity.

- [ ] **Step 3: Run tests**

Expected: PASS.

### Task 9: Implement shift conflict and driver authorization service

- [ ] **Step 1: Add failing tests**

Cover authorized backup driver, one driver across multiple vehicles, unauthorized driver, expired license, ineligible vehicle, open driver conflict, open vehicle conflict, idempotent end, and audit attribution.

- [ ] **Step 2: Implement service**

Add:

```js
listAuthorizedVehicles(pool, { driverId, at })
startShift(pool, { driverId, vehicleId, session, userId })
getActiveShift(pool, { driverId })
endShift(pool, { driverId, shiftId, userId })
```

`startShift` uses `SELECT ... FOR UPDATE` on driver, vehicle, and open shifts; it validates assignment, qualification, eligibility, and conflicts in one transaction.

- [ ] **Step 3: Run tests**

Expected: PASS.

### Task 10: Add driver shift APIs and UI

- [ ] **Step 1: Add driver endpoints**

```text
GET  /api/driver/authorized-vehicles
GET  /api/driver/active-shift
POST /api/driver/shifts/start
POST /api/driver/shifts/:id/end
```

Require a relational `req.user.driver_id`. Legacy unlinked plate accounts receive `DRIVER_PROFILE_NOT_LINKED` and cannot start a new shift.

- [ ] **Step 2: Add `DriverShift.jsx`**

Show authorized vehicles, assignment role, vehicle eligibility, start/end controls, and blocking reasons. Add `/driver/shift` navigation.

- [ ] **Step 3: Gate operational endpoints**

Check-in, checkout, emergency, and vehicle-location writes must require an active shift matching the resolved vehicle after the rollout feature flag is enabled. Keep the flag disabled by default until account migration is complete.

- [ ] **Step 4: Build and test**

Expected: backend isolated suites PASS and frontend build PASS.

### Task 11: Integrate eligibility into QR and transport views

- [ ] **Step 1: Add tests for safe public output**

Public QR returns plate, vehicle type, eligibility, last inspection date, inspection expiry, and document summary. It must omit owner, drivers, students, and evidence URLs.

- [ ] **Step 2: Update QR and transport services**

Prefer the shared-verification latest result; fall back to legacy `vehicle_inspections` when no application exists.

- [ ] **Step 3: Run QR and transport tests**

Expected: PASS.

### Task 12: Documentation and verification

- [ ] **Step 1: Update the user manual**

Document school referral generation, DLT queue/checklist, consolidated counts, driver pool, and actual-driver shift selection.

- [ ] **Step 2: Run focused backend tests without live DB setup**

Set required dummy env values and run Jest with inline config against all new isolated suites plus existing vehicle, driver, auth, QR, and security suites.

- [ ] **Step 3: Run frontend checks**

```powershell
npm run check:labels
npm run build
```

- [ ] **Step 4: Review working tree**

Run `git diff --check`, inspect `git diff --stat`, and confirm no secrets, generated build output, commits, or pushes were introduced.
