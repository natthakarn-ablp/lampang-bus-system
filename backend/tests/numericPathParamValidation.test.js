'use strict';

/**
 * numericPathParamValidation.test.js — regression for CS5-07.
 *
 * WHAT WENT WRONG TWICE
 * ---------------------
 * 1. Originally, a non-numeric :id / :batchId / :studentId reached the query
 *    layer as NaN, which mysql2 formats as the bare token `NaN`. MySQL read it
 *    as a column name and the request failed with
 *      500 {"message":"Unknown column 'NaN' in 'where clause'"}
 *
 * 2. The first fix guarded with
 *      const id = parseInt(req.params.id, 10);
 *      if (!Number.isInteger(id) || id <= 0) ...400
 *    Number.isInteger was applied to the ALREADY-COERCED value, so it could
 *    only ever reject input parseInt gave up on entirely. parseInt keeps the
 *    numeric prefix, so '1e5', '1abc', '1.9', ' 1', '+1' and '01' all passed
 *    and were answered as id 1. On DELETE /api/school/students/:id that
 *    returned 200 and soft-deleted a real student row from a malformed URL —
 *    worse than the 500 it replaced, because it destroys data silently.
 *
 * WHAT THIS FILE ASSERTS
 * ----------------------
 *   a. status  — a malformed path parameter is a CLIENT error (400), never a
 *      server fault (5xx) and never a success.
 *   b. message — the Thai message from utils/pathParams.js, so the test fails
 *      if some other 400 (a scope or body check) answers instead and the id
 *      guard is silently gone.
 *   c. body    — no storage-layer detail reaches the client.
 *   d. THE DATABASE — for the mutating school-student routes, the target row is
 *      read before and after the request and must be byte-identical. That is
 *      the assertion the previous version of this file lacked, and the only one
 *      that would have caught the coercion above: a 400 alone does not prove
 *      nothing was written, and a 200 on '99777abc' looks fine until you look
 *      at the row.
 *
 * Covers EVERY numeric path parameter in the four route files that carry them
 * — school, affiliation, admin, verification — including the ones that were
 * already correct, so the guarantee cannot silently regress on any one route.
 *
 * NO LOGIN: /api/auth/login is 20/IP/15min with no test skip. Tokens are minted
 * directly against seeded rows; authenticate() re-reads the user from the DB on
 * every request, so the accounts below must exist for the tokens to work.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

// Feature-dark routers 404 before their handler runs, so their expected status
// depends on the flag rather than on the guard.
const DOC_FEATURE_ON = env.features.driverRegistration;

// A student created by this file alone, so a regression that actually mutates
// the row cannot corrupt fixtures other suites depend on.
const PROBE_STUDENT_ID = 99777;
const PROBE_SCHOOL = '__TSCH';

const tokens = {};

function mint(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      scopeType: user.scope_type,
      scopeId: user.scope_id,
      gradeScope: null,
      displayName: user.username,
      mustChangePassword: false,
    },
    env.jwt.secret,
    { expiresIn: '1h' }
  );
}

async function ensureUser(username, role, scopeType, scopeId) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = TRUE, is_deleted = FALSE`,
    [username, role, scopeType, scopeId, username]
  );
  const [[row]] = await pool.query(
    'SELECT id, username, role, scope_type, scope_id FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return row;
}

beforeAll(async () => {
  // Start from a clean slate for this probe id. The suite asserts that a
  // rejected request wrote NO audit row for student 99777, which only holds if
  // no earlier row survives — and one does whenever a run is killed between
  // writing a row and reaching teardown. That happens regularly here: the jest
  // runner on this machine is killed mid-run with exit 127 and no FAIL line
  // roughly half the time, and the next run then fails on a count it did not
  // cause. Deleting our own rows up front makes the assertion depend on this
  // run only.
  await pool.query(
    "DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id = ?",
    [String(PROBE_STUDENT_ID)]
  );

  tokens.school = mint(await ensureUser('__test_school', 'school', 'SCHOOL', PROBE_SCHOOL));
  tokens.affiliation = mint(await ensureUser('__test_affiliation', 'affiliation', 'AFFILIATION', '__TAFF'));
  tokens.admin = mint(await ensureUser('__test_admin_cs507', 'admin', null, null));
  tokens.transport = mint(await ensureUser('__test_transport_cs507', 'transport', null, null));

  await pool.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom, school_id,
        morning_enabled, evening_enabled, term_id, is_deleted)
     VALUES (?, SHA2('9999999999999', 256), 'เด็กชาย', '__Probe', 'Student', 'ป.2', '3', ?,
             TRUE, TRUE, '2568-2', FALSE)
     ON DUPLICATE KEY UPDATE
       first_name = '__Probe', last_name = 'Student', grade = 'ป.2',
       classroom = '3', school_id = VALUES(school_id),
       is_deleted = FALSE, deleted_at = NULL`,
    [PROBE_STUDENT_ID, PROBE_SCHOOL]
  );
});

afterAll(async () => {
  // Audit rows first: teardown reaches a student's audit rows through the
  // students table, so deleting the student before its rows leaves them
  // unreachable for good.
  await pool.query(
    "DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id = ?",
    [String(PROBE_STUDENT_ID)]
  );
  await pool.query('DELETE FROM students WHERE id = ?', [PROBE_STUDENT_ID]);
  await pool.query('DELETE FROM users WHERE username IN (?, ?)', [
    '__test_admin_cs507',
    '__test_transport_cs507',
  ]);
});

// The Thai message the shared guard answers with. Imported rather than
// hard-coded so a deliberate wording change updates one place, but still
// asserted so an accidental fallback to some other 400 is caught.
const { INVALID_ID_MESSAGE } = require('../src/utils/pathParams');

// Anything that would betray the storage layer to the caller.
const SQL_LEAK = /unknown column|where clause|NaN|SQLSTATE|ER_[A-Z_]+|syntax.*MySQL|sqlMessage/i;

// Every shape a client can put in the path that must NOT address a row.
//   'abc'      — no digits at all (the original 500)
//   '0', '-1'  — numeric but not a positive id
//   'null'     — the JS/JSON literal a broken frontend sends
//   '1abc'     — leading digits: parseInt kept the 1 (the coercion hole)
//   '1e5'      — exponent: parseInt kept the 1, Number() would give 100000
//   '1.9'      — decimal: parseInt truncated to 1
//   ' 1'       — leading whitespace, sent as %20
//   '+1'       — signed
//   '01'       — non-canonical leading zero: same row under a second URL
// An EMPTY segment is deliberately absent: it changes the path shape, so
// Express answers 404 from the router rather than reaching any handler, and
// asserting 400 there would be asserting the wrong thing.
const BAD_IDS = ['abc', '0', '-1', 'null', '1abc', '1e5', '1.9', ' 1', '+1', '01'];

// Routes are [method, template, body, tokenRole]. `null` body = send nothing.
const ROUTES = {
  'school.routes.js': [
    ['delete', '/api/school/pickup-points/:id', null, 'school'],
    ['get', '/api/school/pickup-points/:id/assignable-students', null, 'school'],
    ['put', '/api/school/pickup-points/:id/students', { student_ids: [] }, 'school'],
    ['delete', '/api/school/leaves/:id', null, 'school'],
    ['put', '/api/school/roster-requests/:id', { status: 'rejected' }, 'school'],
    ['put', '/api/school/students/:id', { first_name: 'x', last_name: 'y', grade: 'ป.1' }, 'school'],
    ['delete', '/api/school/students/:id', null, 'school'],
    ['post', '/api/school/students/:id/restore', {}, 'school'],
    ['get', '/api/school/students/import/:id', null, 'school'],
    ['post', '/api/school/students/import/:id/apply', { mode: 'insert_ready' }, 'school'],
    ['get', '/api/school/students/import/:id/report', null, 'school'],
    ['post', '/api/school/students/import/:id/rollback', { reason: 'probe', selected_row_ids: [1] }, 'school'],
    ['post', '/api/school/students/transfer-requests/:id/cancel', {}, 'school'],
    ['post', '/api/school/students/:id/transfer-request', { destination_school_id: '__TSCH2', reason: 'probe' }, 'school'],
    ['get', '/api/school/vehicles/requests/:id', null, 'school'],
    ['post', '/api/school/vehicles/requests/:id/cancel', {}, 'school'],
    ['post', '/api/school/teacher-accounts/:id/reset-password', { password: 'Regression-Probe-1234' }, 'school'],
    ['delete', '/api/school/teacher-accounts/:id', null, 'school'],
    ['post', '/api/school/checkin/:id/void', { reason: 'regression probe' }, 'school'],
  ],

  'affiliation.routes.js': [
    ['post', '/api/affiliation/school-accounts/:id/reset-password', { password: 'Regression-Probe-1234' }, 'affiliation'],
    ['put', '/api/affiliation/school-accounts/:id', { is_active: true }, 'affiliation'],
    ['get', '/api/affiliation/transfer-requests/:id', null, 'affiliation'],
    ['post', '/api/affiliation/transfer-requests/:id/approve', {}, 'affiliation'],
    ['post', '/api/affiliation/transfer-requests/:id/reject', {}, 'affiliation'],
    ['get', '/api/affiliation/vehicle-requests/:id', null, 'affiliation'],
    ['post', '/api/affiliation/vehicle-requests/:id/approve', {}, 'affiliation'],
    ['post', '/api/affiliation/vehicle-requests/:id/reject', {}, 'affiliation'],
  ],

  'admin.routes.js': [
    ['put', '/api/admin/users/:id', { display_name: 'probe' }, 'admin'],
    ['post', '/api/admin/users/:id/reset-password', { password: 'Regression-Probe-1234' }, 'admin'],
    ['delete', '/api/admin/users/:id', null, 'admin'],
    ['post', '/api/admin/users/:id/restore', {}, 'admin'],
    ['put', '/api/admin/pickup-points/:id', { name: 'probe' }, 'admin'],
    ['delete', '/api/admin/pickup-points/:id', null, 'admin'],
    ['post', '/api/admin/pickup-points/:id/students', { student_id: 1 }, 'admin'],
    ['get', '/api/admin/pickup-points/:id/assignable-students', null, 'admin'],
    ['put', '/api/admin/pickup-points/:id/students', { student_ids: [] }, 'admin'],
    ['get', '/api/admin/student-transfer-requests/:id', null, 'admin'],
    ['post', '/api/admin/student-transfer-requests/:id/approve', {}, 'admin'],
    ['post', '/api/admin/student-transfer-requests/:id/reject', {}, 'admin'],
    ['get', '/api/admin/vehicle-requests/:id', null, 'admin'],
    ['post', '/api/admin/vehicle-requests/:id/approve', {}, 'admin'],
    ['post', '/api/admin/vehicle-requests/:id/reject', {}, 'admin'],
    ['post', '/api/admin/drivers/:id/restore', { reason: 'probe' }, 'admin'],
    ['post', '/api/admin/drivers/:id/deactivate', { reason: 'probe' }, 'admin'],
    ['post', '/api/admin/drivers/:id/reassign-vehicle', { vehicle_id: 'V-test000000ab', reason: 'probe' }, 'admin'],
    ['post', '/api/admin/driver-assignments/:id/end', { reason: 'probe' }, 'admin'],
    ['post', '/api/admin/verification/applications/:id/cancel', { reason: 'probe' }, 'admin'],
    ['post', '/api/admin/checkin/:id/void', { reason: 'regression probe' }, 'admin'],
    ['patch', '/api/admin/emergencies/:id', { result: 'RESOLVED' }, 'admin'],
    ['delete', '/api/admin/emergencies/:id', null, 'admin'],
  ],

  'verification.routes.js': [
    ['get', '/api/verification/applications/:id', null, 'school'],
    ['post', '/api/verification/applications/:id/ready', {}, 'school'],
    ['post', '/api/verification/applications/:id/cancel', {}, 'school'],
    ['post', '/api/verification/applications/:id/review', { approved: false }, 'school'],
    ['get', '/api/verification/applications/:id/timeline', null, 'school'],
    ['post', '/api/verification/transport/drivers/:id/qualification', { license_no: 'X', license_expiry: '2030-01-01' }, 'transport'],
    ['post', '/api/verification/transport/applications/:id/start', { inspection_date: '2026-01-01' }, 'transport'],
    ['post', '/api/verification/transport/attempts/:id/finalize', { result: 'PASSED' }, 'transport'],
    ['delete', '/api/verification/transport/attempts/:id', null, 'transport'],
  ],
};

// Both :id path params of DELETE /pickup-points/:id/students/:studentId, probed
// one at a time so each is proved to be guarded on its own.
const TWO_PARAM_ROUTES = [
  ['delete', '/api/admin/pickup-points/BAD/students/1', 'admin', 'id'],
  ['delete', '/api/admin/pickup-points/1/students/BAD', 'admin', 'studentId'],
];

// Dark unless FEATURE_DRIVER_REGISTRATION=true: requireDocFeature answers 404
// before the handler, so the guard is unreachable with the flag off.
const DOC_ROUTES = [
  ['get', '/api/verification/transport/documents/driver/:id', null, 'transport'],
  ['post', '/api/verification/transport/documents/driver/:id/review', { decision: 'APPROVED' }, 'transport'],
];

function fire(method, path, role, body) {
  const r = request(app)[method](path).set('Authorization', `Bearer ${tokens[role]}`);
  return body === null ? r : r.send(body);
}

function expectRejectedCleanly(res, label) {
  // 1. client error, never a server fault and never a success
  expect(`${label} -> ${res.status}`).toBe(`${label} -> 400`);
  // 2. it was the id guard that answered, not some unrelated 400
  expect(`${label} msg: ${res.body && res.body.message}`).toBe(`${label} msg: ${INVALID_ID_MESSAGE}`);
  // 3. no storage-layer detail in the body
  const body = JSON.stringify(res.body);
  expect(`${label} leaks SQL: ${SQL_LEAK.test(body)}`).toBe(`${label} leaks SQL: false`);
}

describe('CS5-07 — a malformed numeric path parameter is a 400, and touches nothing', () => {
  for (const [file, routes] of Object.entries(ROUTES)) {
    describe(file, () => {
      for (const [method, template, body, role] of routes) {
        test(`${method.toUpperCase()} ${template} rejects every malformed id`, async () => {
          for (const bad of BAD_IDS) {
            const path = template.replace(':id', encodeURIComponent(bad));
            const res = await fire(method, path, role, body);
            expectRejectedCleanly(res, `${method.toUpperCase()} ${path}`);
          }
        });
      }
    });
  }

  test('DELETE /api/admin/pickup-points/:id/students/:studentId guards BOTH parameters', async () => {
    for (const [method, template, role, field] of TWO_PARAM_ROUTES) {
      for (const bad of BAD_IDS) {
        const path = template.replace('BAD', encodeURIComponent(bad));
        const res = await fire(method, path, role, null);
        const label = `${method.toUpperCase()} ${path} (${field})`;
        expectRejectedCleanly(res, label);
        expect(`${label} field: ${res.body.errors && res.body.errors[0] && res.body.errors[0].field}`)
          .toBe(`${label} field: ${field}`);
      }
    }
  });

  test('the feature-dark document-review routes are guarded too (404 while the flag is off)', async () => {
    const expected = DOC_FEATURE_ON ? 400 : 404;
    for (const [method, template, body, role] of DOC_ROUTES) {
      for (const bad of BAD_IDS) {
        const path = template.replace(':id', encodeURIComponent(bad));
        const res = await fire(method, path, role, body);
        const label = `${method.toUpperCase()} ${path}`;
        expect(`${label} -> ${res.status}`).toBe(`${label} -> ${expected}`);
        expect(`${label} leaks SQL: ${SQL_LEAK.test(JSON.stringify(res.body))}`).toBe(`${label} leaks SQL: false`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The assertions that would have caught the coercion: read the row, not the
// status code. Each probe is built from the REAL id of an existing student, so
// a guard that still coerces addresses that exact row and the mutation shows up
// in the diff below. A test that only checked the status would pass either way.
// ─────────────────────────────────────────────────────────────────────────────

const COERCIBLE = [
  `${PROBE_STUDENT_ID}abc`, // parseInt keeps the digits before 'abc'
  `${PROBE_STUDENT_ID}e5`,  // exponent form
  `${PROBE_STUDENT_ID}.9`,  // decimal form
  ` ${PROBE_STUDENT_ID}`,   // leading whitespace
  `+${PROBE_STUDENT_ID}`,   // signed
  `0${PROBE_STUDENT_ID}`,   // non-canonical leading zero
];

async function readProbeRow() {
  const [[row]] = await pool.query(
    `SELECT id, prefix, first_name, last_name, grade, classroom, school_id,
            vehicle_id, morning_enabled, evening_enabled, is_deleted, deleted_at
       FROM students WHERE id = ?`,
    [PROBE_STUDENT_ID]
  );
  return JSON.stringify(row);
}

describe('CS5-07 — a coercible id must not reach a mutating handler', () => {
  test('DELETE /api/school/students/:id leaves the row it would have coerced to untouched', async () => {
    for (const bad of COERCIBLE) {
      const before = await readProbeRow();
      const res = await fire('delete', `/api/school/students/${encodeURIComponent(bad)}`, 'school', null);
      const after = await readProbeRow();
      const label = `DELETE /api/school/students/${bad}`;
      expect(`${label} -> ${res.status}`).toBe(`${label} -> 400`);
      expect(`${label} msg: ${res.body.message}`).toBe(`${label} msg: ${INVALID_ID_MESSAGE}`);
      // The row is the evidence: pre-fix this returned 200 with is_deleted=1.
      expect(`${label} row: ${after}`).toBe(`${label} row: ${before}`);
    }
  });

  test('PUT /api/school/students/:id leaves the row it would have coerced to untouched', async () => {
    for (const bad of COERCIBLE) {
      const before = await readProbeRow();
      const res = await fire('put', `/api/school/students/${encodeURIComponent(bad)}`, 'school', {
        first_name: 'HIJACKED', last_name: 'HIJACKED', grade: 'ป.6', classroom: '9',
      });
      const after = await readProbeRow();
      const label = `PUT /api/school/students/${bad}`;
      expect(`${label} -> ${res.status}`).toBe(`${label} -> 400`);
      expect(`${label} msg: ${res.body.message}`).toBe(`${label} msg: ${INVALID_ID_MESSAGE}`);
      // Pre-fix this returned 200 and first_name became 'HIJACKED'.
      expect(`${label} row: ${after}`).toBe(`${label} row: ${before}`);
    }
  });

  test('no audit_logs row was written for any rejected request', async () => {
    // A rejected request must not leave a DELETE/UPDATE trail against the row,
    // which would corrupt the evidence chain even if the row itself survived.
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM audit_logs
        WHERE entity_type = 'student' AND entity_id = ?`,
      [String(PROBE_STUDENT_ID)]
    );
    expect(`audit rows for student ${PROBE_STUDENT_ID}: ${n}`).toBe(`audit rows for student ${PROBE_STUDENT_ID}: 0`);
  });
});

describe('CS5-07 — the guard admits a well-formed id', () => {
  test('a syntactically valid but non-existent id reaches the handler, not the guard', async () => {
    // 999999999 must get past the guard and be answered by the handler's own
    // not-found/forbidden logic, proving the guard rejects only malformed input.
    const res = await request(app)
      .get('/api/affiliation/vehicle-requests/999999999')
      .set('Authorization', `Bearer ${tokens.affiliation}`);
    expect(res.status).not.toBe(400);
    expect([403, 404]).toContain(res.status);
  });

  test('the canonical id of a real row still mutates it on the same route the malformed ones were refused on', async () => {
    const res = await fire('put', `/api/school/students/${PROBE_STUDENT_ID}`, 'school', {
      first_name: '__Probe2', last_name: 'Student', grade: 'ป.2', classroom: '3',
    });
    expect(`PUT ${PROBE_STUDENT_ID} -> ${res.status}`).toBe(`PUT ${PROBE_STUDENT_ID} -> 200`);
    const [[row]] = await pool.query('SELECT first_name FROM students WHERE id = ?', [PROBE_STUDENT_ID]);
    expect(row.first_name).toBe('__Probe2');
  });
});
