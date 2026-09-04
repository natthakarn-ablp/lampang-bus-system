'use strict';

/**
 * An over-long field is bad input, not a server fault.
 *
 * MySQL runs in STRICT_TRANS_TABLES, so a value longer than its column is an
 * error rather than a silent truncation. Every route that writes a
 * user-supplied string without its own length check therefore reached the global
 * error handler, which had no case for ER_DATA_TOO_LONG and answered 500.
 *
 * That is wrong twice. The caller is told nothing it can act on — in production
 * the message is masked to "Internal server error" — and the error log records a
 * server problem that is really a form field that needs shortening.
 *
 * Proven against the sandbox first: PUT /api/school/students/371 with a
 * 150-character ผู้ปกครอง returned 500. The route had a LEN_LIMITS list covering
 * prefix, first_name, last_name, grade and classroom, and parent_name — the one
 * field there that writes to a different table (parents.name, varchar 100) — was
 * missing from it.
 *
 * NOT a finding: the raw MySQL text ("Data too long for column 'name' at row 1")
 * visible in that 500. The handler already masks err.message outside production,
 * so that was the sandbox's NODE_ENV=test showing, not a leak users would see.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const httpMocks = { };

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const errorHandler = require('../src/middleware/errorHandler');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TEST_STUDENT_ID = 99999;
// Signed rather than logged in: loginLimiter is 20 per 15 minutes per IP with no
// test skip, and the whole run shares it.
const ADMIN_USER = '__test_admin_toolong';
const TRANSPORT_USER = '__test_transport_toolong';
const CREATED_USER = '__test_created_toolong';
const PROBE_PLATE = 'ขข 7351 ลำปาง';

let token = '';
let adminToken = '';
let transportToken = '';

const thaiChars = (n) => 'ก'.repeat(n);

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send(SCHOOL);
  expect(`login -> ${res.status}`).toBe('login -> 200');
  token = res.body.data.access_token;

  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', 'admin', NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE role = 'admin', is_active = TRUE, is_deleted = FALSE`,
    [ADMIN_USER, ADMIN_USER]
  );
  const [[a]] = await pool.query('SELECT id, username, role FROM users WHERE username = ?', [ADMIN_USER]);
  adminToken = jwt.sign(
    {
      sub: a.id, username: a.username, role: a.role, scopeType: null, scopeId: null,
      gradeScope: null, displayName: a.username, mustChangePassword: false,
    },
    env.jwt.secret, { expiresIn: '1h' }
  );

  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', 'transport', NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE role = 'transport', is_active = TRUE, is_deleted = FALSE`,
    [TRANSPORT_USER, TRANSPORT_USER]
  );
  const [[t]] = await pool.query('SELECT id, username, role FROM users WHERE username = ?', [TRANSPORT_USER]);
  transportToken = jwt.sign(
    {
      sub: t.id, username: t.username, role: t.role, scopeType: null, scopeId: null,
      gradeScope: null, displayName: t.username, mustChangePassword: false,
    },
    env.jwt.secret, { expiresIn: '1h' }
  );
});

afterAll(async () => {
  // The route always inserts a fresh parent row, so the probes leave their own.
  await pool.query(
    `DELETE ps FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE p.phone = '0899999999'`
  );
  await pool.query(`DELETE FROM parents WHERE phone = '0899999999'`);
  await pool.query('DELETE FROM users WHERE username IN (?, ?, ?)',
    [ADMIN_USER, CREATED_USER, TRANSPORT_USER]);
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'vehicle' AND entity_id IN (SELECT id FROM vehicles WHERE plate_no = ?)", [PROBE_PLATE]);
  await pool.query('DELETE FROM vehicles WHERE plate_no = ?', [PROBE_PLATE]);
});

const putStudent = (body) => request(app)
  .put(`/api/school/students/${TEST_STUDENT_ID}`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

describe('over-long fields are rejected with 400, not 500', () => {
  it('rejects a guardian name longer than parents.name', async () => {
    const res = await putStudent({
      classroom: '1', parent_name: thaiChars(150), parent_phone: '0899999999',
    });
    expect(`status ${res.status}`).toBe('status 400');
    expect(res.body.message).toContain('ชื่อผู้ปกครอง');
    expect(res.body.errors).toEqual([{ field: 'parent_name', message: 'ไม่เกิน 100 ตัวอักษร' }]);
  });

  it('accepts a guardian name of exactly the column width', async () => {
    // The boundary is the half of this that a naive `> max` check gets wrong in
    // the other direction, so it is asserted rather than assumed.
    const res = await putStudent({
      classroom: '1', parent_name: thaiChars(100), parent_phone: '0899999999',
    });
    expect(`status ${res.status}`).toBe('status 200');

    const [[row]] = await pool.query(
      `SELECT p.name FROM parent_student ps JOIN parents p ON p.id = ps.parent_id
        WHERE ps.student_id = ? ORDER BY p.id DESC LIMIT 1`,
      [TEST_STUDENT_ID]
    );
    expect(`stored length: ${Array.from(row.name).length}`).toBe('stored length: 100');
  });

  it('counts code points, not UTF-16 units', async () => {
    // VARCHAR(n) counts characters. String(v).length reports 2 for anything
    // outside the BMP, so a 60-emoji name would have been rejected as 120 while
    // MySQL would have stored it happily.
    const res = await putStudent({
      classroom: '1', parent_name: '👩'.repeat(60), parent_phone: '0899999999',
    });
    expect(`status ${res.status}`).toBe('status 200');
  });

  it('still rejects the other fields the list already covered', async () => {
    const res = await putStudent({ classroom: thaiChars(21) });
    expect(`status ${res.status}`).toBe('status 400');
    expect(res.body.message).toContain('ห้อง');
  });
});

describe('the global handler turns a column overflow into a 400', () => {
  // The safety net for the write paths that have no length check of their own —
  // the roster-request apply path inserts a guardian name straight from a stored
  // request. Exercised directly because reaching it through HTTP would mean
  // building a whole roster request to make one assertion about error mapping.
  function run(err) {
    const captured = {};
    const res = {
      status(code) { captured.status = code; return this; },
      json(body) { captured.body = body; return this; },
      headersSent: false,
    };
    errorHandler(err, { ip: '127.0.0.1', headers: {} }, res, () => {});
    return captured;
  }

  it('maps ER_DATA_TOO_LONG to 400 with an actionable Thai message', () => {
    const err = new Error("Data too long for column 'name' at row 1");
    err.code = 'ER_DATA_TOO_LONG';
    err.sqlMessage = "Data too long for column 'name' at row 1";

    const out = run(err);
    expect(`status ${out.status}`).toBe('status 400');
    expect(out.body.message).toBe('ข้อมูลบางช่องยาวเกินที่ระบบรองรับ กรุณาย่อให้สั้นลงแล้วบันทึกใหม่');
    expect(out.body.errors).toEqual([{ code: 'FIELD_TOO_LONG' }]);
  });

  it('does not put the column name in the response', () => {
    // sqlMessage names the column but not the table, so it cannot be turned into
    // a field label without guessing — and echoing it would hand out schema
    // detail. Routes that know the field say so before the query runs.
    const err = new Error("Data too long for column 'name' at row 1");
    err.code = 'ER_DATA_TOO_LONG';
    err.sqlMessage = "Data too long for column 'name' at row 1";

    const out = run(err);
    expect(JSON.stringify(out.body)).not.toContain('column');
    expect(JSON.stringify(out.body)).not.toContain('Data too long');
  });

  it('answers 400 on a real route that has no length check of its own', async () => {
    // The synthetic tests above prove the mapping; this proves the mapping is
    // reached. POST /api/transport/vehicles writes vehicle_type into a
    // varchar(50) and validates only the plate — one of thirteen routes in
    // src/routes that take a string from req.body and write it without a length
    // check. Before the handler learned this error code, all of them answered
    // 500.
    //
    // It used to be POST /api/admin/users. That route now has its own check and
    // names the field, which is the better answer and the wrong test: this one
    // has to be a route the handler is genuinely standing in for.
    const res = await request(app)
      .post('/api/transport/vehicles')
      .set('Authorization', `Bearer ${transportToken}`)
      .send({ plate_no: PROBE_PLATE, vehicle_type: thaiChars(120) });

    expect(`status ${res.status}`).toBe('status 400');
    expect(res.body.errors).toEqual([{ code: 'FIELD_TOO_LONG' }]);

    const [[created]] = await pool.query(
      'SELECT COUNT(*) AS n FROM vehicles WHERE plate_no = ?', [PROBE_PLATE]);
    expect(`vehicle created anyway: ${created.n > 0}`).toBe('vehicle created anyway: false');
  });

  it('leaves an unclassified error as a 500', () => {
    // The point is to classify one specific MySQL error, not to turn every
    // failure into a 400.
    const out = run(Object.assign(new Error('boom'), { code: 'ER_SOMETHING_ELSE' }));
    expect(`status ${out.status}`).toBe('status 500');
  });
});

void httpMocks;

describe('the routes people type into name the field themselves', () => {
  // Three handlers gained the shared check this round. The point is not that an
  // over-long value is rejected — the global handler already did that — but that
  // the caller is told which box to shorten instead of "some field somewhere".
  const cases = [
    {
      what: 'admin POST /users, display_name',
      send: (v) => request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
        .send({ username: CREATED_USER, password: 'Abcd1234!x', role: 'school', scope_id: '__TSCH', display_name: v }),
      field: 'display_name', max: 200, label: 'ชื่อที่แสดง',
    },
    {
      what: 'admin POST /users, username',
      send: (v) => request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
        .send({ username: v, password: 'Abcd1234!x', role: 'school', scope_id: '__TSCH' }),
      field: 'username', max: 100, label: 'ชื่อผู้ใช้',
    },
    {
      what: 'school POST /teacher-accounts, display_name',
      send: (v) => request(app).post('/api/school/teacher-accounts').set('Authorization', `Bearer ${token}`)
        .send({ username: '__probe_teacher', password: 'Abcd1234!x', display_name: v, grade_scope: 'ป.1-3' }),
      field: 'display_name', max: 200, label: 'ชื่อที่แสดง',
    },
  ];

  for (const c of cases) {
    it(`${c.what} — over the column width names the field`, async () => {
      const res = await c.send(thaiChars(c.max + 50));
      expect(`${c.what} -> ${res.status}`).toBe(`${c.what} -> 400`);
      expect(res.body.message).toContain(c.label);
      expect(res.body.errors).toEqual([{ field: c.field, message: `ไม่เกิน ${c.max} ตัวอักษร` }]);
    });

    it(`${c.what} — exactly the column width is not rejected for length`, async () => {
      // The boundary. A later failure (duplicate username, password policy) is
      // fine and expected; what must not happen is this field being called too
      // long at exactly the width the column holds.
      const res = await c.send(thaiChars(c.max));
      const rejectedForLength = res.status === 400
        && Array.isArray(res.body.errors)
        && res.body.errors.some((e) => e.field === c.field);
      expect(`${c.what} rejected at exactly ${c.max}: ${rejectedForLength}`)
        .toBe(`${c.what} rejected at exactly ${c.max}: false`);
    });
  }

  it('admin PUT /users/:id names the field too', async () => {
    // Changed in the same round as the POST, so asserted in the same round.
    const created = await request(app).post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: CREATED_USER, password: 'Abcd1234!x', role: 'school', scope_id: '__TSCH' });
    expect(`create -> ${created.status}`).toBe('create -> 201');
    const id = created.body.data.id;

    const res = await request(app).put(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ display_name: thaiChars(250) });
    expect(`update -> ${res.status}`).toBe('update -> 400');
    expect(res.body.message).toContain('ชื่อที่แสดง');
    expect(res.body.errors).toEqual([{ field: 'display_name', message: 'ไม่เกิน 200 ตัวอักษร' }]);

    const [[row]] = await pool.query('SELECT display_name FROM users WHERE id = ?', [id]);
    expect(`stored name unchanged: ${row.display_name !== thaiChars(250)}`)
      .toBe('stored name unchanged: true');
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE username IN (?, ?)', [CREATED_USER, '__probe_teacher']);
  });
});
