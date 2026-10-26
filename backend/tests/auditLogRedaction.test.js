'use strict';

/**
 * audit_logs.old_value / new_value carry PII, and every role that can read them
 * must get the masked form.
 *
 * WHAT WAS WRONG
 * --------------
 * Four handlers return audit rows as JSON: school, affiliation, province and
 * admin. Three of them redact. school did not, and returned the values exactly
 * as stored. Verified against the sandbox before changing anything — an audit
 * row carrying a guardian phone and a LINE id came back as
 *
 *   school       {"parent_phone":"0812345678","line_user_id":"U1234567890abcdef"}
 *   admin        {"parent_phone":"089****777","line_user_id":"U1234567…[redacted]"}
 *   affiliation  the same masked form
 *
 * The phone is not new exposure to a school — it already sees its own students'
 * guardian phones through /api/school/students. line_user_id is: it is surfaced
 * to this role nowhere else, and the scope filter admits transfer and roster
 * rows whose values describe another school's record.
 *
 * WHY A SWEEP ACROSS ALL FOUR
 * ---------------------------
 * The same shape has now appeared three times: the CSV path redacting while the
 * JSON path did not (province H1), an export limiter on three of four audit-log
 * endpoints, and this. One role drifting from three is not something code review
 * catches reliably, so the assertion covers all four together and fails on
 * whichever one drifts next.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const TEST_STUDENT_ID = 99999;
const RAW_PHONE_OLD = '0812345678';
const RAW_PHONE_NEW = '0898887777';
const RAW_LINE_ID = 'U1234567890abcdef';
const PROBE_AGENT = '__audit-redaction-probe';
const ADMIN_USER = '__test_admin_redaction';

const tokens = {};
let probeId = null;

function mint(u) {
  return jwt.sign(
    {
      sub: u.id, username: u.username, role: u.role,
      scopeType: u.scope_type, scopeId: u.scope_id,
      gradeScope: null, displayName: u.username, mustChangePassword: false,
    },
    env.jwt.secret, { expiresIn: '1h' }
  );
}

/** Signed, not logged in: loginLimiter is 20/15min/IP and the run shares it. */
async function tokenFor(username, role, scopeType, scopeId) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = TRUE, is_deleted = FALSE`,
    [username, role, scopeType, scopeId, username]
  );
  const [[u]] = await pool.query(
    'SELECT id, username, role, scope_type, scope_id FROM users WHERE username = ? LIMIT 1', [username]
  );
  return mint(u);
}

beforeAll(async () => {
  tokens.school = await tokenFor('__test_school', 'school', 'SCHOOL', '__TSCH');
  tokens.affiliation = await tokenFor('__test_affiliation', 'affiliation', 'AFFILIATION', '__TAFF');
  tokens.province = await tokenFor('__test_province', 'province', 'PROVINCE', 'LPG');
  tokens.admin = await tokenFor(ADMIN_USER, 'admin', null, null);

  const [r] = await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
     VALUES (NULL, 'UPDATE', 'student', ?, ?, ?, '127.0.0.1', ?)`,
    [
      String(TEST_STUDENT_ID),
      JSON.stringify({ parent_phone: RAW_PHONE_OLD, parent_name: 'เดิม' }),
      JSON.stringify({ parent_phone: RAW_PHONE_NEW, line_user_id: RAW_LINE_ID }),
      PROBE_AGENT,
    ]
  );
  probeId = r.insertId;
});

afterAll(async () => {
  if (probeId) await pool.query('DELETE FROM audit_logs WHERE id = ?', [probeId]);
  await pool.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
});

const ROUTES = {
  school: '/api/school/audit-logs?per_page=50',
  affiliation: '/api/affiliation/audit-logs?per_page=50',
  province: '/api/province/audit-logs?per_page=50',
  admin: '/api/admin/audit-logs?per_page=50',
};

async function fetchRows(role) {
  const res = await request(app).get(ROUTES[role]).set('Authorization', `Bearer ${tokens[role]}`);
  expect(`${role} -> ${res.status}`).toBe(`${role} -> 200`);
  const data = res.body.data;
  const rows = Array.isArray(data) ? data : (data && data.logs) || [];
  return { res, rows };
}

/** The probe row as this role sees it, serialized. Both shapes are in use:
 *  admin and school parse the redacted JSON back to an object, affiliation and
 *  province leave it as a string, and the frontend handles either. */
function probeText(rows) {
  const row = rows.find((r) => String(r.entity_id) === String(TEST_STUDENT_ID)
    && JSON.stringify(r).includes('parent_phone'));
  return row ? JSON.stringify(row) : null;
}

describe('every role that can read audit values gets the masked form', () => {
  for (const role of Object.keys(ROUTES)) {
    it(`${role} sees the probe row at all`, async () => {
      // Without this the redaction assertion below would pass on a response that
      // simply does not contain the row — the failure mode that let the province
      // and affiliation date bugs sit behind a green test.
      const { rows } = await fetchRows(role);
      expect(`${role} found the probe row: ${probeText(rows) !== null}`)
        .toBe(`${role} found the probe row: true`);
    });

    it(`${role} does not receive the raw phone or LINE id`, async () => {
      const { rows } = await fetchRows(role);
      const text = probeText(rows);
      const leaks = [RAW_PHONE_OLD, RAW_PHONE_NEW, RAW_LINE_ID].filter((v) => text.includes(v));
      expect(`${role} leaked: ${leaks.join(', ') || 'nothing'}`).toBe(`${role} leaked: nothing`);
    });

    it(`${role} receives the masked values, not empty ones`, async () => {
      // Redaction that dropped the fields entirely would also pass the test
      // above while making the audit trail useless to read.
      const { rows } = await fetchRows(role);
      const text = probeText(rows);
      expect(`${role} masked phone present: ${text.includes('081****678') && text.includes('089****777')}`)
        .toBe(`${role} masked phone present: true`);
      expect(`${role} masked line id present: ${text.includes('[redacted]')}`)
        .toBe(`${role} masked line id present: true`);
    });
  }

  it('the CSV branch still answers, after sharing the helper with the JSON branch', async () => {
    // Declaring the redactor inside the handler shadows the module import for the
    // whole function and puts the CSV branch above it in a temporal dead zone —
    // which is how this exact change once turned ?format=csv into a 500 in
    // admin.routes.js. The comment there records it; this asserts it.
    for (const role of ['school', 'affiliation', 'province', 'admin']) {
      const res = await request(app)
        .get(`${ROUTES[role].split('?')[0]}?format=csv&per_page=5`)
        .set('Authorization', `Bearer ${tokens[role]}`);
      expect(`${role} csv -> ${res.status}`).toBe(`${role} csv -> 200`);
      expect(`${role} csv leaked: ${res.text.includes(RAW_PHONE_NEW) || res.text.includes(RAW_LINE_ID)}`)
        .toBe(`${role} csv leaked: false`);
    }
  });
});
