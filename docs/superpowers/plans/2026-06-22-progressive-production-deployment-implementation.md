# Progressive Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly prohibited commits and pushes; all commit steps are omitted.

**Goal:** Deploy the complete Lampang Bus software safely while real vehicle and driver data is collected progressively under observable, auditable safety gates.

**Architecture:** Add a pure safety-policy decision service and a read-only deployment-readiness service, expose the same decisions to driver operations and role-scoped dashboards, and keep activation in `OBSERVE` until a reviewed scope is ready for `ENFORCE`. Isolate destructive tests in a disposable database, validate migrations against a production clone, then recover and cut over Production through a manual approval gate.

**Tech Stack:** Node.js 20+, Express 4, mysql2, Jest/Supertest, MySQL 8, React 18, Vite, Tailwind CSS, GitHub Actions, PM2, nginx.

---

## Implementation status (updated 2026-06-22 — honesty pass)

> The `- [ ]` checkboxes below describe the FULL intended plan, not what is
> currently done. The list here is the authoritative record of what actually
> exists in the working tree. Nothing has been committed, pushed, or applied to
> Production.

**Implemented (in working tree, verified with `npm run test:unit` + `npm run build`):**

- Task 1 — disposable test-DB guard + `jest.unit.config.js` (`backend/src/utils/testDatabaseGuard.js`, tests).
- Task 3 — safety-policy + feature-dependency config validation in `backend/src/config/env.js`.
- Task 4 — pure safety-policy matrix `backend/src/services/safetyPolicy.service.js` + unit tests.
- Task 5 (service layer) — `assessDriverOperation()` DB-backed assessment with mock-pool tests. (Route wiring into `driver.routes.js` / `checkin.service.js` is owned by another agent and is not part of this change.)
- **Task 6 — readiness report + route (this change):** `backend/src/services/deploymentReadiness.service.js`, `backend/src/routes/readiness.routes.js` (`GET /api/readiness` + `/summary`, `requireRole('province','admin')`), mounted in `backend/src/app.js`, with `backend/tests/deploymentReadiness.unit.test.js` (mock pool, asserts shape, count mapping, and NO PII). NOTE: the readiness API is restricted to **province + admin** (not transport), and the report is **province-wide aggregate only**.
- **Task 7 — readiness screen (this change):** `frontend/src/pages/province/DeploymentReadiness.jsx`, lazy routes `/province/readiness` + `/admin/readiness` in `App.jsx`, sidebar entries for province and admin in `Sidebar.jsx`.
- **Migration-presence startup guard (#13, this change):** `backend/src/index.js` fails fast when `FEATURE_DRIVER_SHIFT_SELECTION=true` but migration-039 tables are absent.
- **Task 9 (partial) — CI workflow (this change):** `.github/workflows/full-quality.yml` runs backend `test:unit`, frontend `build`, and the UI label check.

**Deferred / NOT done in this change (do not assume complete):**

- **Task 8 — operationsAlert webhook delivery:** `backend/src/services/operationsAlert.service.js` was NOT built; WARN/CRITICAL alerts are not delivered externally. Intended integration point is `backend/scripts/integrity-monitor.js` (out of scope here). `operationsHealth.service.js` readiness/multi-driver edits are also not part of this change.
- **Task 9 — migration drift validator + DB integration in CI:** `validate-migration-baseline.js`, `legacy-drift-baseline.json`, and the MySQL-service `test:ci` job are NOT included. CI runs unit + build + labels only; `test:ci` runs locally per `backend/.env.test.example`.
- **School / affiliation readiness drill-down:** the readiness service and UI are province-wide aggregate only; per-school / per-affiliation RBAC-scoped drill-down is not implemented.
- **Tasks 10–13 — Staging validation, Production recovery, OBSERVE deploy, Pilot/Province ENFORCE:** operational tasks against real infrastructure; not performed (commit/push/Production changes are prohibited this session).

---

## File structure

### Create

- `backend/src/services/safetyPolicy.service.js` — pure policy matrix and DB-backed driver-operation assessment
- `backend/src/services/deploymentReadiness.service.js` — aggregate readiness report with no PII
- `backend/src/services/operationsAlert.service.js` — bounded webhook alert delivery for WARN/CRITICAL operations reports
- `backend/src/routes/readiness.routes.js` — role-protected readiness API
- `backend/tests/safetyPolicy.unit.test.js` — policy matrix tests without database setup
- `backend/tests/deploymentReadiness.unit.test.js` — aggregate service tests with a fake pool
- `backend/tests/operationsAlert.unit.test.js` — alert delivery tests with mocked fetch
- `backend/tests/testDatabaseGuard.unit.test.js` — destructive-test database guard tests
- `backend/src/utils/testDatabaseGuard.js` — exact-name guard for disposable databases
- `backend/scripts/prepare-test-db.js` — guarded recreation of `lampang_bus_test`
- `backend/jest.unit.config.js` — unit tests that do not run global DB setup/teardown
- `backend/tests/schema.sql` — schema-only snapshot of the 47-table local clone
- `backend/.env.test.example` — non-secret test configuration contract
- `frontend/src/pages/DeploymentReadiness.jsx` — shared admin/province/transport readiness screen
- `.github/workflows/full-quality.yml` — backend, frontend, labels, schema, and migration checks
- `backend/scripts/validate-migration-baseline.js` — migration drift validator
- `backend/migrations/legacy-drift-baseline.json` — reviewed historical drift allow-list, with full hashes
- `docs/PRODUCTION-RECOVERY-2026-06-22.md` — incident evidence, recovery validation, and cutover record
- `docs/PROGRESSIVE-ROLLOUT-RUNBOOK.md` — OBSERVE/Pilot ENFORCE/Province ENFORCE procedure

### Modify

- `backend/src/config/env.js` — parse and validate safety policy and feature dependencies
- `backend/.env.example` — document new non-secret configuration
- `backend/src/app.js` — mount readiness routes
- `backend/src/routes/driver.routes.js` — evaluate policy before safety-critical mutations
- `backend/src/services/checkin.service.js` — return resolved driver identity with the operational vehicle
- `backend/src/services/operationsHealth.service.js` — support multiple authorized drivers and add readiness checks
- `backend/scripts/integrity-monitor.js` — deliver bounded alerts instead of only reporting that delivery is absent
- `backend/tests/setup.js` — refuse to seed any non-test database
- `backend/tests/teardown.js` — refuse to delete from any non-test database
- `backend/tests/driverShift.test.js` — policy-aware shift start coverage
- `backend/tests/verificationRoutes.test.js` — OBSERVE/ENFORCE API expectations
- `backend/tests/operationsHealth.test.js` — multi-driver and readiness health expectations
- `backend/package.json` — unit, prepare-test, CI, and migration validation scripts
- `frontend/src/App.jsx` — readiness route
- `frontend/src/components/Sidebar.jsx` — readiness navigation for admin/province/transport
- `frontend/src/constants/uiLabels.js` — approved Thai labels if the checker requires additions
- `docs/UPDATE-2026-06-22.md` — final implementation and verification handoff

---

### Task 1: Protect real data from destructive tests

**Files:**
- Create: `backend/src/utils/testDatabaseGuard.js`
- Create: `backend/tests/testDatabaseGuard.unit.test.js`
- Create: `backend/jest.unit.config.js`
- Modify: `backend/tests/setup.js`
- Modify: `backend/tests/teardown.js`

- [ ] **Step 1: Write the guard unit tests**

```js
'use strict';

const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');

describe('assertDisposableTestDatabase', () => {
  test('accepts the exact disposable database contract', () => {
    expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME: 'lampang_bus_test', ALLOW_TEST_DB_RESET: 'true',
    })).not.toThrow();
  });

  test.each(['lampang_bus', 'lampang_bus_dev', '', undefined])(
    'rejects protected database %p',
    (DB_NAME) => expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME, ALLOW_TEST_DB_RESET: 'true',
    })).toThrow(/Refusing destructive test database access/)
  );

  test('requires an explicit reset acknowledgement', () => {
    expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME: 'lampang_bus_test', ALLOW_TEST_DB_RESET: 'false',
    })).toThrow(/ALLOW_TEST_DB_RESET/);
  });
});
```

- [ ] **Step 2: Add a Jest config that bypasses global database setup**

```js
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.unit.test.js'],
  testTimeout: 10000,
  runInBand: true,
};
```

- [ ] **Step 3: Run the new test and confirm it fails**

Run:

```powershell
npm --prefix backend exec -- jest --config jest.unit.config.js tests/testDatabaseGuard.unit.test.js
```

Expected: FAIL because `src/utils/testDatabaseGuard.js` does not exist.

- [ ] **Step 4: Implement the exact-name guard**

```js
'use strict';

function assertDisposableTestDatabase(source = process.env) {
  if (source.NODE_ENV !== 'test') {
    throw new Error('Refusing destructive test database access: NODE_ENV must be test');
  }
  if (source.DB_NAME !== 'lampang_bus_test') {
    throw new Error(`Refusing destructive test database access: DB_NAME=${source.DB_NAME || '(missing)'}`);
  }
  if (source.ALLOW_TEST_DB_RESET !== 'true') {
    throw new Error('ALLOW_TEST_DB_RESET=true is required');
  }
  return true;
}

module.exports = { assertDisposableTestDatabase };
```

- [ ] **Step 5: Call the guard at the first line of global setup and teardown**

Add after `require('dotenv').config()` in both files:

```js
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');
assertDisposableTestDatabase(process.env);
```

- [ ] **Step 6: Run the unit test and the protected-database negative check**

Run:

```powershell
npm --prefix backend exec -- jest --config jest.unit.config.js tests/testDatabaseGuard.unit.test.js
$env:NODE_ENV='test'; $env:DB_NAME='lampang_bus_dev'; $env:ALLOW_TEST_DB_RESET='true'; npm --prefix backend test
```

Expected: unit test PASS; full test command exits before seeding and prints `Refusing destructive test database access`.

---

### Task 2: Create a disposable test database workflow

**Files:**
- Create: `backend/scripts/prepare-test-db.js`
- Create: `backend/tests/schema.sql`
- Create: `backend/.env.test.example`
- Modify: `backend/package.json`

- [ ] **Step 1: Export a schema-only snapshot from the local production clone**

Run from WSL:

```bash
MYSQL_PWD=local_dev_2026_only mysqldump \
  -h127.0.0.1 -ulampang_dev \
  --no-data --routines --triggers --events --skip-comments \
  lampang_bus_dev > /mnt/e/งานพี่อร/lampang-bus-system/backend/tests/schema.sql
```

Expected: `backend/tests/schema.sql` contains 47 `CREATE TABLE` statements and no `INSERT INTO` statements.

- [ ] **Step 2: Implement guarded test database preparation**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');

async function main() {
  assertDisposableTestDatabase(process.env);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  await connection.query('DROP DATABASE IF EXISTS `lampang_bus_test`');
  await connection.query('CREATE DATABASE `lampang_bus_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.changeUser({ database: 'lampang_bus_test' });
  const schema = fs.readFileSync(path.join(__dirname, '../tests/schema.sql'), 'utf8');
  await connection.query(schema);
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='lampang_bus_test'"
  );
  if (Number(row.n) !== 47) throw new Error(`Expected 47 tables, found ${row.n}`);
  await connection.end();
  console.log('[test-db] ready: lampang_bus_test (47 tables)');
}

main().catch((error) => { console.error('[test-db]', error.message); process.exit(1); });
```

- [ ] **Step 3: Add the test environment example**

```env
NODE_ENV=test
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=lampang_bus_test
DB_USER=root
DB_PASSWORD=local-test-root-password
ALLOW_TEST_DB_RESET=true
JWT_SECRET=test-only-secret-at-least-32-characters-long
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
SAFETY_POLICY_MODE=observe
FEATURE_DRIVER_SHIFT_SELECTION=false
FEATURE_VEHICLE_QR=false
FEATURE_QR_LEVEL3=false
```

- [ ] **Step 4: Add package scripts**

```json
{
  "test:unit": "jest --config jest.unit.config.js --runInBand",
  "test:prepare": "node scripts/prepare-test-db.js",
  "test:ci": "npm run test:prepare && jest --testEnvironment=node --runInBand --forceExit"
}
```

- [ ] **Step 5: Prepare and run tests against only `lampang_bus_test`**

Run in a PowerShell session populated from local test credentials:

```powershell
$env:NODE_ENV='test'
$env:DB_NAME='lampang_bus_test'
$env:ALLOW_TEST_DB_RESET='true'
npm --prefix backend run test:prepare
npm --prefix backend run test:ci
```

Expected: preparation reports 47 tables; Jest never reads or writes `lampang_bus_dev`.

---

### Task 3: Validate policy configuration at startup

**Files:**
- Modify: `backend/src/config/env.js`
- Modify: `backend/.env.example`
- Test: `backend/tests/securityEnv.test.js`

- [ ] **Step 1: Add failing pure configuration tests**

```js
describe('parseSafetyPolicyConfig', () => {
  test('defaults to observe', () => {
    expect(parseSafetyPolicyConfig({})).toEqual({ mode: 'OBSERVE', enforcementAt: null });
  });

  test('accepts enforce and a valid ISO date', () => {
    expect(parseSafetyPolicyConfig({
      SAFETY_POLICY_MODE: 'enforce',
      SAFETY_ENFORCEMENT_AT: '2026-07-01T00:00:00+07:00',
    })).toEqual({ mode: 'ENFORCE', enforcementAt: '2026-07-01T00:00:00+07:00' });
  });

  test.each(['open', 'true', ''])('rejects explicit invalid mode %p', (mode) => {
    const source = mode === '' ? { SAFETY_POLICY_MODE: '' } : { SAFETY_POLICY_MODE: mode };
    if (mode === '') return expect(parseSafetyPolicyConfig(source)).toEqual({ mode: 'OBSERVE', enforcementAt: null });
    expect(() => parseSafetyPolicyConfig(source)).toThrow(/SAFETY_POLICY_MODE/);
  });

  test('rejects QR level 3 when vehicle QR is disabled', () => {
    expect(() => validateFeatureDependencies({ FEATURE_VEHICLE_QR: 'false', FEATURE_QR_LEVEL3: 'true' }))
      .toThrow(/FEATURE_QR_LEVEL3/);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm --prefix backend exec -- jest --config jest.unit.config.js tests/securityEnv.test.js
```

Expected: FAIL because the pure helpers are not exported.

- [ ] **Step 3: Implement and export pure parsers**

```js
function parseSafetyPolicyConfig(source = process.env) {
  const raw = String(source.SAFETY_POLICY_MODE || 'observe').trim().toUpperCase();
  if (!['OBSERVE', 'ENFORCE'].includes(raw)) {
    throw new Error('SAFETY_POLICY_MODE must be observe or enforce');
  }
  const enforcementAt = String(source.SAFETY_ENFORCEMENT_AT || '').trim() || null;
  if (enforcementAt && Number.isNaN(Date.parse(enforcementAt))) {
    throw new Error('SAFETY_ENFORCEMENT_AT must be ISO-8601');
  }
  return { mode: raw, enforcementAt };
}

function validateFeatureDependencies(source = process.env) {
  if (source.FEATURE_QR_LEVEL3 === 'true' && source.FEATURE_VEHICLE_QR !== 'true') {
    throw new Error('FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true');
  }
  return true;
}
```

Add to `env`:

```js
safetyPolicy: parseSafetyPolicyConfig(process.env),
```

Export both helpers for unit testing.

- [ ] **Step 4: Document the settings and run tests**

Add to `.env.example`:

```env
SAFETY_POLICY_MODE=observe
SAFETY_ENFORCEMENT_AT=
```

Run:

```powershell
npm --prefix backend run test:unit
```

Expected: configuration tests PASS.

---

### Task 4: Implement the safety policy decision matrix

**Files:**
- Create: `backend/src/services/safetyPolicy.service.js`
- Create: `backend/tests/safetyPolicy.unit.test.js`

- [ ] **Step 1: Write the policy matrix tests**

```js
'use strict';

const { evaluateSafetyPolicy } = require('../src/services/safetyPolicy.service');

const ready = {
  vehicleStatus: 'ELIGIBLE', vehicleReasons: [],
  qualificationStatus: 'VERIFIED', authorizationStatus: 'AUTHORIZED',
  requireActiveShift: false, hasActiveShift: false,
};

describe('evaluateSafetyPolicy', () => {
  test('allows ready data in both modes', () => {
    expect(evaluateSafetyPolicy({ ...ready, mode: 'OBSERVE' }).decision).toBe('ALLOW');
    expect(evaluateSafetyPolicy({ ...ready, mode: 'ENFORCE' }).decision).toBe('ALLOW');
  });

  test('warns for missing data in observe and blocks it in enforce', () => {
    const input = { ...ready, vehicleStatus: 'UNVERIFIED', qualificationStatus: null };
    expect(evaluateSafetyPolicy({ ...input, mode: 'OBSERVE' })).toMatchObject({
      decision: 'ALLOW_WITH_WARNING', audit_required: true,
    });
    expect(evaluateSafetyPolicy({ ...input, mode: 'ENFORCE' }).decision).toBe('BLOCK');
  });

  test.each([
    ['VEHICLE_SUSPENDED'], ['INSPECTION_FAILED'], ['INSPECTION_EXPIRED'],
    ['CAPACITY_EXCEEDED'], ['INSURANCE_EXPIRED'],
  ])('blocks explicit vehicle failure in observe: %s', (reason) => {
    expect(evaluateSafetyPolicy({
      ...ready, mode: 'OBSERVE', vehicleStatus: 'INELIGIBLE', vehicleReasons: [reason],
    }).decision).toBe('BLOCK');
  });

  test('requires a shift only when the feature is active', () => {
    expect(evaluateSafetyPolicy({
      ...ready, mode: 'ENFORCE', requireActiveShift: true, hasActiveShift: false,
    })).toMatchObject({ decision: 'BLOCK', reasons: ['ACTIVE_SHIFT_MISSING'] });
  });
});
```

- [ ] **Step 2: Run and confirm the module is missing**

Run:

```powershell
npm --prefix backend exec -- jest --config jest.unit.config.js tests/safetyPolicy.unit.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure evaluator**

```js
'use strict';

const EXPLICIT_VEHICLE_BLOCKERS = new Set([
  'VEHICLE_SUSPENDED', 'INSPECTION_FAILED', 'INSPECTION_NEEDS_FIX',
  'INSPECTION_EXPIRED', 'CAPACITY_EXCEEDED', 'INSURANCE_EXPIRED',
  'REGISTRATION_EXPIRED', 'COMPULSORY_INSURANCE_EXPIRED', 'TAX_EXPIRED',
]);
const EXPLICIT_QUALIFICATION_BLOCKERS = new Set(['EXPIRED', 'SUSPENDED', 'REVOKED']);
const EXPLICIT_AUTHORIZATION_BLOCKERS = new Set(['SUSPENDED', 'REVOKED']);

function evaluateSafetyPolicy(input = {}) {
  const mode = String(input.mode || 'OBSERVE').toUpperCase();
  if (!['OBSERVE', 'ENFORCE'].includes(mode)) throw new Error('Invalid safety policy mode');
  const reasons = [];
  const vehicleReasons = Array.isArray(input.vehicleReasons) ? input.vehicleReasons : [];
  const explicit = vehicleReasons.filter((reason) => EXPLICIT_VEHICLE_BLOCKERS.has(reason));
  if (EXPLICIT_QUALIFICATION_BLOCKERS.has(input.qualificationStatus)) explicit.push(`DRIVER_${input.qualificationStatus}`);
  if (EXPLICIT_AUTHORIZATION_BLOCKERS.has(input.authorizationStatus)) explicit.push(`ASSIGNMENT_${input.authorizationStatus}`);
  if (explicit.length) return { decision: 'BLOCK', policy_mode: mode, reasons: [...new Set(explicit)], audit_required: true };

  if (!['ELIGIBLE', 'EXPIRING'].includes(input.vehicleStatus)) reasons.push('VEHICLE_UNVERIFIED');
  if (input.qualificationStatus !== 'VERIFIED') reasons.push('DRIVER_QUALIFICATION_MISSING');
  if (input.authorizationStatus !== 'AUTHORIZED') reasons.push('DRIVER_ASSIGNMENT_MISSING');
  if (input.requireActiveShift && !input.hasActiveShift) reasons.push('ACTIVE_SHIFT_MISSING');

  if (!reasons.length) return { decision: 'ALLOW', policy_mode: mode, reasons: [], audit_required: false };
  return {
    decision: mode === 'OBSERVE' ? 'ALLOW_WITH_WARNING' : 'BLOCK',
    policy_mode: mode,
    reasons: [...new Set(reasons)],
    audit_required: true,
  };
}

module.exports = { evaluateSafetyPolicy, EXPLICIT_VEHICLE_BLOCKERS };
```

- [ ] **Step 4: Run the matrix**

Run:

```powershell
npm --prefix backend exec -- jest --config jest.unit.config.js tests/safetyPolicy.unit.test.js
```

Expected: all matrix tests PASS.

---

### Task 5: Assess and enforce driver operations

**Files:**
- Modify: `backend/src/services/safetyPolicy.service.js`
- Modify: `backend/src/services/checkin.service.js`
- Modify: `backend/src/routes/driver.routes.js`
- Test: `backend/tests/driverShift.test.js`
- Test: `backend/tests/verificationRoutes.test.js`

- [ ] **Step 1: Add failing assessment tests using a fake pool**

Test these exact contracts:

```js
test('OBSERVE returns a warning for unverified legacy data', async () => {
  const result = await assessDriverOperation(fakeSafetyPool({
    vehicleStatus: 'UNVERIFIED', qualificationStatus: null, authorizationStatus: 'AUTHORIZED',
  }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'OBSERVE' });
  expect(result).toMatchObject({ decision: 'ALLOW_WITH_WARNING', reasons: expect.any(Array) });
});

test('ENFORCE blocks the same operation', async () => {
  const result = await assessDriverOperation(fakeSafetyPool({
    vehicleStatus: 'UNVERIFIED', qualificationStatus: null, authorizationStatus: 'AUTHORIZED',
  }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'ENFORCE' });
  expect(result.decision).toBe('BLOCK');
});
```

- [ ] **Step 2: Implement DB-backed assessment**

Add to `safetyPolicy.service.js`:

```js
async function assessDriverOperation(pool, {
  vehicleId, driverId, mode, requireActiveShift = false,
}) {
  const [[vehicle]] = await pool.query(
    `SELECT verification_status, verification_reasons_json
       FROM vehicles WHERE id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`,
    [vehicleId]
  );
  const [[qualification]] = await pool.query(
    `SELECT qualification_status
       FROM driver_qualifications
      WHERE driver_id=? AND is_current=1
      ORDER BY id DESC LIMIT 1`,
    [driverId]
  );
  const [[assignment]] = await pool.query(
    `SELECT authorization_status
       FROM driver_vehicle_assignments
      WHERE driver_id=? AND vehicle_id=? AND is_active=1
      ORDER BY id DESC LIMIT 1`,
    [driverId, vehicleId]
  );
  const [[shift]] = requireActiveShift
    ? await pool.query(
      `SELECT id FROM vehicle_operating_shifts
        WHERE driver_id=? AND vehicle_id=? AND status='OPEN' AND ended_at IS NULL LIMIT 1`,
      [driverId, vehicleId]
    ) : [[null]];
  const rawReasons = vehicle?.verification_reasons_json;
  const vehicleReasons = Array.isArray(rawReasons)
    ? rawReasons
    : (() => { try { return JSON.parse(rawReasons || '[]'); } catch { return []; } })();
  return evaluateSafetyPolicy({
    mode,
    vehicleStatus: vehicle?.verification_status || 'UNVERIFIED',
    vehicleReasons,
    qualificationStatus: qualification?.qualification_status || null,
    authorizationStatus: assignment?.authorization_status || null,
    requireActiveShift,
    hasActiveShift: Boolean(shift),
  });
}
```

- [ ] **Step 3: Expose `driver_id` from operational vehicle resolution**

Ensure `checkinSvc.getDriverVehicle(pool, req.user)` returns:

```js
{
  vehicle_id: row.vehicle_id,
  plate_no: row.plate_no,
  driver_id: Number(row.driver_id || req.user.driver_id),
  shift_id: row.shift_id || null,
}
```

- [ ] **Step 4: Add one shared route helper**

```js
const safetyPolicySvc = require('../services/safetyPolicy.service');
const env = require('../config/env');

async function assessSafety(req, vehicle, operation, { emergency = false } = {}) {
  const policy = await safetyPolicySvc.assessDriverOperation(pool, {
    vehicleId: vehicle.vehicle_id,
    driverId: vehicle.driver_id || req.user.driver_id,
    mode: env.safetyPolicy.mode,
    requireActiveShift: env.features.driverShiftSelection,
  });
  if (policy.audit_required) {
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'safety_policy_decision',
      entityId: `${operation}:${req.user.id}:${Date.now()}`,
      newValue: { operation, vehicle_id: vehicle.vehicle_id, ...policy },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
  }
  if (policy.decision === 'BLOCK' && !emergency) {
    const error = new Error('ไม่สามารถดำเนินการได้ เนื่องจากข้อมูลความปลอดภัยยังไม่ผ่านเกณฑ์');
    error.statusCode = 409;
    error.errors = [{ code: 'SAFETY_POLICY_BLOCKED', reasons: policy.reasons }];
    throw error;
  }
  return policy;
}
```

- [ ] **Step 5: Call the helper before safety-critical mutations**

Apply it to:

- `POST /shifts/start`
- `POST /checkin`
- `POST /checkout`
- `POST /checkin-all`
- `POST /vehicle-location`
- `POST /pretrip`

Emergency reporting must call:

```js
const policy = await assessSafety(req, vehicle, 'EMERGENCY_REPORT', { emergency: true });
```

and must remain recordable even when the decision is `BLOCK`; include `policy` in its audit value.

- [ ] **Step 6: Run route and service tests**

Run:

```powershell
npm --prefix backend run test:unit
npm --prefix backend test -- --runTestsByPath tests/driverShift.test.js tests/verificationRoutes.test.js
```

Expected: OBSERVE mutation succeeds with policy warning; ENFORCE mutation returns 409; emergency remains 201.

---

### Task 6: Build the role-scoped readiness report

**Files:**
- Create: `backend/src/services/deploymentReadiness.service.js`
- Create: `backend/tests/deploymentReadiness.unit.test.js`
- Create: `backend/src/routes/readiness.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1: Write failing report-shape tests**

```js
test('returns aggregate counts and no PII', async () => {
  const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
  expect(report).toMatchObject({
    policy_mode: 'OBSERVE',
    sections: {
      vehicles: { total: 182, ready: 0, missing: 182 },
      drivers: { total: 158, ready: 0, missing: 158 },
    },
    hard_gate_count: expect.any(Number),
  });
  expect(JSON.stringify(report)).not.toMatch(/first_name|last_name|phone|cid/i);
});
```

- [ ] **Step 2: Implement aggregate query helpers**

```js
'use strict';

function section(total, ready, warning = 0) {
  const t = Number(total) || 0;
  const r = Number(ready) || 0;
  return { total: t, ready: r, missing: Math.max(0, t - r), warning: Number(warning) || 0, pct: t ? Math.round((r / t) * 100) : 100 };
}

async function getDeploymentReadiness(pool, { mode = 'OBSERVE' } = {}) {
  const [[v]] = await pool.query(`
    SELECT COUNT(*) total,
           SUM(certified_capacity IS NOT NULL AND verification_status IN ('ELIGIBLE','EXPIRING')) ready,
           SUM(verification_status IN ('INELIGIBLE','SUSPENDED')) warning
      FROM vehicles WHERE COALESCE(is_deleted,0)=0`);
  const [[d]] = await pool.query(`
    SELECT COUNT(*) total,
           SUM(u.driver_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM driver_qualifications q
              WHERE q.driver_id=u.driver_id AND q.is_current=1
                AND q.qualification_status='VERIFIED' AND q.license_expiry>=CURDATE()
           )) ready,
           SUM(u.driver_id IS NULL) warning
      FROM users u WHERE u.role='driver' AND u.is_active=1 AND COALESCE(u.is_deleted,0)=0`);
  const [[a]] = await pool.query(`
    SELECT COUNT(DISTINCT v.id) total,
           COUNT(DISTINCT CASE WHEN dva.id IS NOT NULL THEN v.id END) ready,
           COUNT(DISTINCT CASE WHEN dva.assignment_role='BACKUP' THEN v.id END) backup_covered
      FROM vehicles v
      LEFT JOIN driver_vehicle_assignments dva ON dva.vehicle_id=v.id
       AND dva.is_active=1 AND dva.authorization_status='AUTHORIZED'
     WHERE COALESCE(v.is_deleted,0)=0`);
  const [[c]] = await pool.query(`SELECT COUNT(*) total FROM consent_records WHERE consent_status='GRANTED'`);
  const sections = {
    vehicles: section(v.total, v.ready, v.warning),
    drivers: section(d.total, d.ready, d.warning),
    assignments: section(a.total, a.ready, Number(a.total) - Number(a.backup_covered)),
    consents: { granted: Number(c.total) || 0 },
  };
  const hard_gate_count = sections.vehicles.missing + sections.drivers.missing + sections.assignments.missing;
  return { policy_mode: mode, generated_at: new Date().toISOString(), sections, hard_gate_count };
}

module.exports = { section, getDeploymentReadiness };
```

- [ ] **Step 3: Add the protected readiness API**

```js
'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { pool } = require('../config/database');
const env = require('../config/env');
const { sendSuccess } = require('../utils/response');
const { getDeploymentReadiness } = require('../services/deploymentReadiness.service');

const router = express.Router();
router.use(authenticate, requireRole('admin', 'province', 'transport'));
router.get('/', async (_req, res, next) => {
  try { return sendSuccess(res, await getDeploymentReadiness(pool, { mode: env.safetyPolicy.mode })); }
  catch (error) { return next(error); }
});
module.exports = router;
```

Mount with:

```js
app.use('/api/readiness', require('./routes/readiness.routes'));
```

- [ ] **Step 4: Run unit and route tests**

Expected: allowed roles receive aggregate-only data; school/driver receive 403; unauthenticated receives 401.

---

### Task 7: Add the readiness screen

**Files:**
- Create: `frontend/src/pages/DeploymentReadiness.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`

- [ ] **Step 1: Implement the page using existing UI primitives**

```jsx
import { useEffect, useState } from 'react';
import { ShieldCheck, Bus, UserRoundCheck, UsersRound } from 'lucide-react';
import api from '../api/axios';
import LoadingState from '../components/LoadingState';
import AlertBanner from '../components/ui/AlertBanner';
import CommandHero from '../components/ui/CommandHero';

const LABELS = {
  vehicles: ['รถผ่านความพร้อม', Bus],
  drivers: ['คนขับผ่านความพร้อม', UserRoundCheck],
  assignments: ['รถมีคนขับที่อนุญาต', UsersRound],
};

export default function DeploymentReadiness() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/readiness').then((r) => setData(r.data.data)).catch(() => setError('โหลดข้อมูลความพร้อมไม่สำเร็จ'));
  }, []);
  if (!data && !error) return <LoadingState />;
  return <div className="p-3 sm:p-6 max-w-6xl mx-auto pb-12">
    <CommandHero eyebrow="PRODUCTION READINESS" title="ความพร้อมเปิดใช้งานทั้งจังหวัด"
      description="ข้อมูลที่ยังไม่รับรองจะไม่ถูกแสดงว่าเป็นข้อมูลที่ผ่านแล้ว"
      statusLabel={data?.policy_mode || 'UNKNOWN'} statusTone={data?.policy_mode === 'ENFORCE' ? 'danger' : 'warn'} />
    {error && <AlertBanner variant="danger" title="ไม่สามารถประเมินความพร้อม">{error}</AlertBanner>}
    {data && data.hard_gate_count > 0 && <AlertBanner variant="warning" title="ยังมีเงื่อนไขบังคับที่ต้องปิด">
      {data.hard_gate_count.toLocaleString('th-TH')} รายการ
    </AlertBanner>}
    <div className="grid gap-4 md:grid-cols-3 mt-5">
      {Object.entries(LABELS).map(([key, [label, Icon]]) => {
        const item = data?.sections?.[key];
        return <section key={key} className="rounded-2xl border border-line bg-white p-5">
          <Icon className="h-5 w-5 text-accent" />
          <h2 className="mt-3 font-semibold text-ink">{label}</h2>
          <p className="mt-2 text-3xl font-bold text-ink">{item?.pct ?? 0}%</p>
          <p className="text-sm text-ink-muted">พร้อม {item?.ready ?? 0} จาก {item?.total ?? 0}</p>
          <p className="mt-3 text-sm text-amber-700">ต้องดำเนินการ {item?.missing ?? 0}</p>
        </section>;
      })}
    </div>
    <p className="mt-5 text-xs text-ink-muted flex items-center gap-2"><ShieldCheck className="h-4 w-4" />ข้อมูลสรุปเท่านั้น ไม่มีรายชื่อนักเรียนหรือข้อมูลติดต่อ</p>
  </div>;
}
```

- [ ] **Step 2: Add a lazy route allowed for three roles**

```jsx
const DeploymentReadiness = lazy(() => import('./pages/DeploymentReadiness'));

<Route path="/readiness" element={
  <PrivateRoute allowedRoles={['admin', 'province', 'transport']}>
    <Layout><DeploymentReadiness /></Layout>
  </PrivateRoute>
} />
```

- [ ] **Step 3: Add sidebar entries**

Use `{ to: '/readiness', icon: ShieldCheck, label: 'ความพร้อมเปิดใช้งาน' }` in admin, province, and transport navigation arrays.

- [ ] **Step 4: Validate frontend**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
npm --prefix frontend run check:labels
npm --prefix frontend run build
```

Expected: hybrid UI and build PASS; label check has no new warning from the readiness page.

---

### Task 8: Correct operations health and deliver alerts

**Files:**
- Modify: `backend/src/services/operationsHealth.service.js`
- Create: `backend/src/services/operationsAlert.service.js`
- Modify: `backend/scripts/integrity-monitor.js`
- Test: `backend/tests/operationsHealth.test.js`
- Create: `backend/tests/operationsAlert.unit.test.js`

- [ ] **Step 1: Replace the obsolete one-driver-per-vehicle health rule**

Replace grouping by only `vehicle_id` with duplicate active driver/vehicle pairs:

```js
const dupAsg = await q1(`
  SELECT COUNT(*) n FROM (
    SELECT 1 FROM driver_vehicle_assignments
     WHERE is_active=1
     GROUP BY driver_id, vehicle_id
    HAVING COUNT(*)>1
  ) t`);
add('dup_active_assignment', 'คนขับถูกมอบหมายรถคันเดิมซ้ำ', dupAsg > 0 ? 'CRITICAL' : 'OK', dupAsg);
```

- [ ] **Step 2: Add readiness as an operations-health check**

```js
const { getDeploymentReadiness } = require('./deploymentReadiness.service');
const readiness = await getDeploymentReadiness(pool, { mode: process.env.SAFETY_POLICY_MODE || 'OBSERVE' });
add(
  'deployment_readiness',
  'ความพร้อมเปิดบังคับใช้',
  readiness.policy_mode === 'ENFORCE' && readiness.hard_gate_count > 0 ? 'CRITICAL' : readiness.hard_gate_count > 0 ? 'WARN' : 'OK',
  readiness.hard_gate_count,
  `mode=${readiness.policy_mode}`
);
```

- [ ] **Step 3: Write alert service tests**

```js
test('posts one bounded alert for a critical report', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  await deliverOperationsAlert({ status: 'CRITICAL', timestamp: '2026-06-22T00:00:00Z', checks: [
    { key: 'database', severity: 'CRITICAL', label: 'ฐานข้อมูล', value: 'down' },
  ] }, { webhookUrl: 'https://alerts.example.test/hook' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(fetch.mock.calls[0][1])).not.toMatch(/password|token|phone|student/i);
});
```

- [ ] **Step 4: Implement bounded webhook delivery**

```js
'use strict';

async function deliverOperationsAlert(report, { webhookUrl = process.env.ALERT_LINE_WEBHOOK_URL } = {}) {
  if (!webhookUrl || !['WARN', 'CRITICAL'].includes(report?.status)) return { delivered: false, reason: 'disabled' };
  const critical = (report.checks || []).filter((c) => ['WARN', 'CRITICAL'].includes(c.severity)).slice(0, 8);
  const text = [`Lampang Bus: ${report.status}`, ...critical.map((c) => `${c.severity} ${c.label}: ${c.value ?? '-'}`)].join('\n').slice(0, 1800);
  const response = await fetch(webhookUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`alert HTTP ${response.status}`);
  return { delivered: true };
}

module.exports = { deliverOperationsAlert };
```

- [ ] **Step 5: Call alert delivery from the monitor**

Replace the existing delivery-not-implemented message with:

```js
const { deliverOperationsAlert } = require('../src/services/operationsAlert.service');
const alert = await deliverOperationsAlert(report);
if (['WARN', 'CRITICAL'].includes(report.status)) {
  console.log(`Alert: ${alert.delivered ? 'delivered' : alert.reason}`);
}
```

- [ ] **Step 6: Run health and alert tests**

Expected: multiple authorized drivers do not produce CRITICAL; duplicate driver/vehicle pairs do; alert payload contains no PII or secrets.

---

### Task 9: Add full CI and migration drift control

**Files:**
- Create: `.github/workflows/full-quality.yml`
- Create: `backend/scripts/validate-migration-baseline.js`
- Create: `backend/migrations/legacy-drift-baseline.json`
- Modify: `backend/package.json`

- [ ] **Step 1: Implement capture, static validation, and database validation**

Create `backend/scripts/validate-migration-baseline.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const migrationDir = path.join(__dirname, '../migrations');
const baselinePath = path.join(migrationDir, 'legacy-drift-baseline.json');
const mode = process.argv.includes('--capture') ? 'capture' : process.argv.includes('--db') ? 'db' : 'static';
const files = fs.readdirSync(migrationDir).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
const numberOf = (name) => Number(name.slice(0, 3));
const hashOf = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, name))).digest('hex');

function readBaseline() {
  if (!fs.existsSync(baselinePath)) throw new Error('legacy-drift-baseline.json is missing');
  const value = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  for (const [name, row] of Object.entries(value)) {
    if (numberOf(name) >= 38) throw new Error(`Baseline cannot include ${name}`);
    if (row.classification !== 'legacy-file-drift-do-not-reapply') throw new Error(`Invalid classification: ${name}`);
    if (!/^[a-f0-9]{64}$/.test(row.tracked_checksum) || !/^[a-f0-9]{64}$/.test(row.current_checksum)) {
      throw new Error(`Invalid checksum: ${name}`);
    }
    if (hashOf(name) !== row.current_checksum) throw new Error(`Repository drift changed again: ${name}`);
  }
  return value;
}

async function connection() {
  return mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
}

async function main() {
  if (new Set(files).size !== files.length) throw new Error('Duplicate migration filename');
  if (mode === 'static') {
    const baseline = readBaseline();
    console.log(`[migrations] static baseline OK (${Object.keys(baseline).length} approved legacy drift rows)`);
    return;
  }
  const db = await connection();
  const [trackedRows] = await db.query('SELECT filename, checksum FROM schema_migrations');
  await db.end();
  const tracked = Object.fromEntries(trackedRows.map((row) => [row.filename, row.checksum]));
  if (mode === 'capture') {
    const captured = {};
    for (const name of files.filter((file) => numberOf(file) <= 37)) {
      const current = hashOf(name);
      if (tracked[name] && tracked[name] !== current) captured[name] = {
        tracked_checksum: tracked[name], current_checksum: current,
        classification: 'legacy-file-drift-do-not-reapply',
      };
    }
    fs.writeFileSync(baselinePath, JSON.stringify(captured, null, 2) + '\n');
    console.log(`[migrations] captured ${Object.keys(captured).length} legacy drift rows`);
    return;
  }
  const baseline = readBaseline();
  const errors = [];
  for (const name of files) {
    const current = hashOf(name);
    const stored = tracked[name];
    if (!stored) errors.push(`${name}: untracked`);
    else if (stored !== current) {
      const approved = baseline[name];
      if (!approved || approved.tracked_checksum !== stored || approved.current_checksum !== current) {
        errors.push(`${name}: unapproved checksum drift`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`[migrations] database tracking OK (${files.length} files)`);
}

main().catch((error) => { console.error('[migrations]', error.message); process.exit(1); });
```

- [ ] **Step 2: Capture and review actual full hashes**

Run `node scripts/validate-migration-baseline.js --capture` against the restored production clone. Review the generated JSON and confirm it contains only migrations 001–037 and exactly the already-observed historical drift rows. Never hand-edit hashes.

- [ ] **Step 3: Run static and database validation**

Run:

```powershell
npm --prefix backend run check:migrations
node backend/scripts/validate-migration-baseline.js --db
```

Expected: static validation accepts only the captured historical baseline; database validation reports 33 tracked migration files after 038–039 are applied.

Add package script:

```json
"check:migrations": "node scripts/validate-migration-baseline.js"
```

- [ ] **Step 4: Create the full CI workflow**

```yaml
name: Full Quality
on:
  pull_request:
  push:
    branches: [main, security/audit-fixes-2026-06-18]

jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test-root-password
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping -h127.0.0.1 -uroot -ptest-root-password"
          --health-interval=5s --health-timeout=5s --health-retries=20
    env:
      NODE_ENV: test
      DB_HOST: 127.0.0.1
      DB_PORT: 3306
      DB_NAME: lampang_bus_test
      DB_USER: root
      DB_PASSWORD: test-root-password
      ALLOW_TEST_DB_RESET: 'true'
      JWT_SECRET: test-only-secret-at-least-32-characters-long
      JWT_EXPIRES_IN: 24h
      JWT_REFRESH_EXPIRES_IN: 7d
      SAFETY_POLICY_MODE: observe
      FEATURE_DRIVER_SHIFT_SELECTION: 'false'
      FEATURE_VEHICLE_QR: 'false'
      FEATURE_QR_LEVEL3: 'false'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'backend/package-lock.json' }
      - run: npm ci --prefix backend
      - run: npm ci --prefix frontend
      - run: npm --prefix backend run test:unit
      - run: npm --prefix backend run test:ci
      - run: npm --prefix backend run check:migrations
      - run: npm --prefix frontend run check:labels:strict
      - run: npm --prefix frontend run check:hybrid-ui
      - run: npm --prefix frontend run build
```

- [ ] **Step 5: Validate the workflow locally where equivalent commands exist**

Expected: all checks pass with `lampang_bus_test`; no check uses `lampang_bus_dev`.

---

### Task 10: Validate Staging with the real-data clone

**Files:**
- Modify: `docs/UPDATE-2026-06-22.md`
- Create: `docs/PROGRESSIVE-ROLLOUT-RUNBOOK.md`

- [ ] **Step 1: Recreate a clean staging candidate from the verified dump**

Create `lampang_bus_staging_20260622`, restore the verified backup, and apply migrations 038–039 exactly once. Do not use `lampang_bus_dev` because it contains local demo accounts.

- [ ] **Step 2: Record schema and aggregate validation**

Required results:

- base restore: 38 tables
- after migrations: 47 tables
- active schools, students, vehicles, drivers match the verified backup
- no student names, phone numbers, or CID values are copied into logs or documentation
- migration 038 checklist seed has exactly one active template version and nine checklist items
- migration 039 preserves all 147 active historical assignments

- [ ] **Step 3: Run smoke flows in `OBSERVE`**

Verify:

- school creates and prints a shared inspection application
- transport records checklist results and finalizes an attempt
- explicit failed inspection blocks a driver operation
- missing inspection produces `ALLOW_WITH_WARNING`
- emergency reporting remains available
- readiness endpoint reports aggregate-only values

- [ ] **Step 4: Run rollback rehearsal**

Stop staging backend, drop only `lampang_bus_staging_20260622`, restore the same dump, reapply migrations, and confirm the same aggregate hashes. Record duration and commands in the rollout runbook.

---

### Task 11: Recover Production through a manual approval gate

**Files:**
- Create: `docs/PRODUCTION-RECOVERY-2026-06-22.md`

> This task changes Production and must not start until the operator explicitly approves the recovery window and confirms a VPS snapshot exists.

- [ ] **Step 1: Freeze Production changes and preserve evidence**

Capture without printing secrets:

```bash
date -Is
hostname
pm2 status
systemctl status mysql --no-pager
sudo journalctl -u mysql --since '2026-06-22 08:00:00' --no-pager > /home/schoolbus/logs/mysql-incident-20260622.log
pm2 logs schoolbus-backend --lines 500 --nostream > /home/schoolbus/logs/backend-incident-20260622.log
sudo tar -C /var/lib -czf /home/schoolbus/backups/mysql-datadir-incident-20260622.tar.gz mysql
```

Take the provider-level VPS snapshot before restore.

- [ ] **Step 2: Verify the recovery candidate again**

```bash
cd /home/schoolbus/backups/lampang-bus
sha256sum -c lampang_bus_20260622_090627.sql.gz.sha256
gzip -t lampang_bus_20260622_090627.sql.gz
```

Expected: both commands succeed.

- [ ] **Step 3: Restore into an isolated recovery database**

```bash
pm2 stop schoolbus-backend
sudo mysql -e "DROP DATABASE IF EXISTS lampang_bus_recovery_20260622; CREATE DATABASE lampang_bus_recovery_20260622 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat /home/schoolbus/backups/lampang-bus/lampang_bus_20260622_090627.sql.gz \
  | sudo mysql lampang_bus_recovery_20260622
sudo mysql -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='lampang_bus_recovery_20260622';"
```

Expected: 38 tables.

- [ ] **Step 4: Validate aggregate counts and foreign keys**

Run counts for schools, users, students, vehicles, drivers, assignments, and `CHECK TABLE` for every table. Compare with the local verified clone. Do not write PII to the incident document.

- [ ] **Step 5: Restore the validated dump to the canonical database name**

Only after isolated validation:

```bash
sudo mysql -e "CREATE DATABASE lampang_bus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat /home/schoolbus/backups/lampang-bus/lampang_bus_20260622_090627.sql.gz | sudo mysql lampang_bus
```

Confirm `schoolbus_db` retains the required grants with `SHOW GRANTS`; regrant only `lampang_bus.*` if required.

- [ ] **Step 6: Restart the current backend before deploying new code**

```bash
pm2 restart schoolbus-backend --update-env
curl -fsS http://127.0.0.1:3000/health
pm2 logs schoolbus-backend --lines 50 --nostream
```

Expected: database connected is true and `Unknown database` stops.

- [ ] **Step 7: Record RPO and root-cause evidence**

Record the backup time (09:06 UTC / 16:06 Thailand), recovery cutover time, the first missing-database error, the last known successful write, and the evidence-based root cause. If root cause remains unknown, state `ยังสรุปสาเหตุไม่ได้จากหลักฐานที่มี` rather than guessing.

---

### Task 12: Deploy code in `OBSERVE`

**Files:**
- Modify: `docs/PROGRESSIVE-ROLLOUT-RUNBOOK.md`
- Modify: `docs/UPDATE-2026-06-22.md`

- [ ] **Step 1: Take a fresh post-recovery backup and verify checksum**

- [ ] **Step 2: Apply migrations 038 and 039 to Production once**

Before execution, query `information_schema` to prove the new tables/columns are absent. After execution, insert full checksums into `schema_migrations` with status `applied` and the deployed commit hash.

- [ ] **Step 3: Set safe Production configuration**

```env
HOST=127.0.0.1
SAFETY_POLICY_MODE=observe
SAFETY_ENFORCEMENT_AT=
FEATURE_DRIVER_SHIFT_SELECTION=false
FEATURE_VEHICLE_QR=false
FEATURE_QR_LEVEL3=false
```

- [ ] **Step 4: Build, restart, and run smoke checks**

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm --prefix frontend run build
pm2 restart schoolbus-backend --update-env
curl -fsS http://127.0.0.1:3000/health
./scripts/health-smoke.sh
```

Expected: health and DB connected; existing school/driver flows work; missing safety data is warning-only; explicit failed/suspended states block.

- [ ] **Step 5: Configure external alert delivery and off-host backup**

Set `ALERT_LINE_WEBHOOK_URL` in the protected Production environment and configure the existing rclone/rsync off-host script with an operator-owned destination. Run one alert probe and one off-host restore drill before declaring this task complete.

---

### Task 13: Pilot and Province-wide enforcement

**Files:**
- Modify: `docs/PROGRESSIVE-ROLLOUT-RUNBOOK.md`
- Modify: `docs/UPDATE-2026-06-22.md`

- [ ] **Step 1: Select pilot scope without changing province-wide policy**

Choose 3–5 schools and produce a readiness export containing counts only. Every operating pilot vehicle must have capacity, valid passed inspection, valid documents, one authorized driver, and a verified current qualification.

- [ ] **Step 2: Run five-role UAT**

Test school, transport, driver, province, and admin flows on mobile and desktop. Include failed inspection, expired document, missing shift, backup driver, emergency, and temporary network failure.

- [ ] **Step 3: Activate shift selection after driver data is ready**

Set `FEATURE_DRIVER_SHIFT_SELECTION=true`, restart, and verify active shift attribution. Keep `SAFETY_POLICY_MODE=observe` until all pilot UAT results are signed.

- [ ] **Step 4: Activate `ENFORCE` at the signed maintenance window**

Copy the ISO-8601 timestamp verbatim from the signed activation record into `SAFETY_ENFORCEMENT_AT`, set `SAFETY_POLICY_MODE=enforce`, restart with `--update-env`, and run the blocking matrix. The deployment command must abort if the signed record or timestamp is absent.

- [ ] **Step 5: Expand only after the province report has no hard-gate gaps**

Province-wide enforcement requires 100% of active operating vehicles and active operating drivers to pass hard gates. Backup-driver coverage remains a warning metric, not a blocker.

- [ ] **Step 6: Final verification**

Run:

```bash
./scripts/health-smoke.sh
cd backend && node scripts/integrity-monitor.js --json
```

Verify external alert delivery, off-host backup, restore evidence, migration status, audit decisions, and role-based UAT. Update `docs/UPDATE-2026-06-22.md` with final command outputs and known limitations.

---

## Completion checkpoint

The initiative is complete only when:

- Production is recovered and root-cause evidence is recorded
- no destructive test can address `lampang_bus` or `lampang_bus_dev`
- CI passes backend, frontend, labels, schema, and migration checks
- OBSERVE never renders unknown data as safe
- explicit safety failures block in both modes
- emergencies remain reportable
- pilot ENFORCE passes all roles
- off-host restore and external alert delivery are verified
- province-wide hard-gate count is zero before province-wide ENFORCE
- no commit or push has been performed during this workspace session
