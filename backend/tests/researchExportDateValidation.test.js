'use strict';

/**
 * A1-11 finding S6 — the research export took `from` and `to` on trust.
 *
 * THE DEFECT
 * ----------
 * admin.routes.js read them as
 *
 *     const from = req.query.from || '2020-01-01';
 *     const to   = req.query.to   || <today>;
 *
 * with no validation of any kind, while /api/reports has validated its dates
 * since it was written. The two values do not stay inside the query. They are
 * written into
 *
 *   1. the exported dataset's own `meta.date_range`,
 *   2. the `entity_id` of the EXPORT audit row — `${from}_to_${to}` — which
 *      the dataset then reads back and republishes as `export_evidence`,
 *      i.e. as its own proof that it was exported,
 *   3. the Content-Disposition filename.
 *
 * Every query is parameterised (CLAUDE.md §12 rule 14), so this is not
 * injection. It is evidence integrity: a research dataset declares a period
 * it was never checked against, and the audit trail meant to corroborate it
 * records the same unchecked string. At review time the two agree with each
 * other and neither is anchored to anything.
 *
 * WHAT THIS TEST PROVES
 * ---------------------
 * Every assertion in the first describe would have failed before the fix —
 * the route answered 200 for all of them.
 *
 * The last describe is the part the finding actually cares about: when the
 * input IS valid, the dataset's declared period and the audit row's entity_id
 * are the same string, so the two can be reconciled.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

// Own fixture, not one setup.js seeds: a suite that deletes a shared fixture
// takes out every other suite in the same run.
const ADMIN_USER = '__test_admin_s6_dates';
let token = null;
let adminId = null;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', 'admin', ?)
     ON DUPLICATE KEY UPDATE role = 'admin', is_active = TRUE, is_deleted = FALSE`,
    [ADMIN_USER, ADMIN_USER]
  );
  const [[u]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [ADMIN_USER]);
  adminId = u.id;
  // Signed rather than logged in: loginLimiter is 20/15min/IP with no test
  // skip, and the whole run shares that budget.
  token = jwt.sign(
    { sub: adminId, username: ADMIN_USER, role: 'admin', scopeType: null, scopeId: null,
      gradeScope: null, displayName: ADMIN_USER, mustChangePassword: false },
    env.jwt.secret, { expiresIn: '1h' }
  );
});

afterAll(async () => {
  // Delete by the same keys this file created, children before parent.
  if (adminId) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ?', [adminId]);
    await pool.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
  }
});

const get = (query) => request(app)
  .get(`/api/admin/research-export${query}`)
  .set('Authorization', `Bearer ${token}`);

describe('research export rejects a date that is not a date', () => {
  it('rejects a month that does not exist', async () => {
    const res = await get('?from=2026-13-01&to=2026-12-31');
    expect(`${res.status}`).toBe('400');
    expect(res.body.errors.map((e) => e.field)).toContain('from');
  });

  it('rejects a day that does not exist in that month', async () => {
    const res = await get('?from=2026-01-01&to=2026-02-30');
    expect(`${res.status}`).toBe('400');
    expect(res.body.errors.map((e) => e.field)).toContain('to');
  });

  it('rejects the wrong shape', async () => {
    for (const bad of ['01/01/2026', '2026-1-1', 'yesterday', '2026-01-01T00:00:00Z']) {
      const res = await get(`?from=${encodeURIComponent(bad)}&to=2026-12-31`);
      expect(`${bad} -> ${res.status}`).toBe(`${bad} -> 400`);
    }
  });

  it('rejects a value carrying a quote, which malformed the filename header', async () => {
    // Node rejects CR/LF in a header value with ERR_INVALID_CHAR, so this was
    // never response splitting — but a bare quote passed through into
    // Content-Disposition and malformed it.
    const res = await get(`?from=${encodeURIComponent('2026-01-01"x')}&to=2026-12-31`);
    expect(`${res.status}`).toBe('400');
  });

  it('rejects a reversed range', async () => {
    const res = await get('?from=2026-12-31&to=2026-01-01');
    expect(`${res.status}`).toBe('400');
    expect(res.body.message).toContain('ช่วงวันที่');
  });

  it('rejects a repeated parameter, which arrives as an array', async () => {
    // ?from=a&from=b gives the handler ['a','b']. A check that coerced with
    // String() would have accepted an array of one valid date.
    const res = await get('?from=2026-01-01&from=2026-01-02&to=2026-12-31');
    expect(`${res.status}`).toBe('400');
  });
});

describe('valid input still works', () => {
  it('accepts a real range and reports it back', async () => {
    const res = await get('?from=2026-01-01&to=2026-01-31&include=summary');
    expect(`${res.status}`).toBe('200');
    expect(res.body.data.meta.date_range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('accepts the defaults when neither is given', async () => {
    // The defaults are generated, not user input, so they must pass their own
    // check — a fix that validated only the supplied values would 400 here.
    const res = await get('?include=summary');
    expect(`${res.status}`).toBe('200');
  });

  it('accepts 29 February in a leap year', async () => {
    const res = await get('?from=2024-02-29&to=2024-03-01&include=summary');
    expect(`${res.status}`).toBe('200');
  });
});

describe('the dataset and its own audit row agree — the point of S6', () => {
  it('writes an EXPORT audit row whose entity_id is the declared period', async () => {
    const from = '2026-03-01';
    const to = '2026-03-31';
    const res = await get(`?from=${from}&to=${to}&include=summary`);
    expect(`${res.status}`).toBe('200');

    const [rows] = await pool.query(
      `SELECT entity_id FROM audit_logs
        WHERE user_id = ? AND action = 'EXPORT' AND entity_id = ?
        ORDER BY id DESC LIMIT 1`,
      [adminId, `${from}_to_${to}`]
    );
    // Floor: assert the row was found before asserting anything about it, so
    // an empty result cannot pass as agreement.
    expect(`audit rows found: ${rows.length}`).toBe('audit rows found: 1');
    expect(rows[0].entity_id).toBe(
      `${res.body.data.meta.date_range.from}_to_${res.body.data.meta.date_range.to}`
    );
  });

  it('no EXPORT audit row exists for a rejected request', async () => {
    // A 400 must leave no trace claiming an export happened.
    const before = await pool.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE user_id = ? AND action = 'EXPORT'", [adminId]);
    await get('?from=2026-13-01&to=2026-12-31').expect(400);
    const after = await pool.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE user_id = ? AND action = 'EXPORT'", [adminId]);
    expect(`${after[0][0].n - before[0][0].n}`).toBe('0');
    // Floor: this file has written at least one EXPORT row by now, so the
    // comparison is not between two zeroes.
    expect(before[0][0].n).toBeGreaterThan(0);
  });
});
