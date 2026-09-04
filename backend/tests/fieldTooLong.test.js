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
const CREATED_USER = '__test_created_toolong';

let token = '';
let adminToken = '';

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
});

afterAll(async () => {
  // The route always inserts a fresh parent row, so the probes leave their own.
  await pool.query(
    `DELETE ps FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE p.phone = '0899999999'`
  );
  await pool.query(`DELETE FROM parents WHERE phone = '0899999999'`);
  await pool.query('DELETE FROM users WHERE username IN (?, ?)', [ADMIN_USER, CREATED_USER]);
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
    // actually reached. POST /api/admin/users writes display_name into
    // users.display_name (varchar 200) and validates nothing about its length —
    // one of sixteen routes in src/routes that take a string from req.body and
    // write it without a check of their own. Before the handler learned this
    // error code, every one of them answered 500.
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: CREATED_USER,
        password: 'Abcd1234!x',
        role: 'school',
        scope_type: 'SCHOOL',
        scope_id: '__TSCH',
        display_name: thaiChars(300),
      });

    expect(`status ${res.status}`).toBe('status 400');
    expect(res.body.errors).toEqual([{ code: 'FIELD_TOO_LONG' }]);

    const [[created]] = await pool.query(
      'SELECT COUNT(*) AS n FROM users WHERE username = ?', [CREATED_USER]);
    expect(`user created anyway: ${created.n > 0}`).toBe('user created anyway: false');
  });

  it('leaves an unclassified error as a 500', () => {
    // The point is to classify one specific MySQL error, not to turn every
    // failure into a 400.
    const out = run(Object.assign(new Error('boom'), { code: 'ER_SOMETHING_ELSE' }));
    expect(`status ${out.status}`).toBe('status 500');
  });
});

void httpMocks;
