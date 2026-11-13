'use strict';

// School self-management (2026-11-13):
//  1. School MAIN account: PATCH (grade / name / enable-disable), list deleted,
//     restore its OWN grade-teacher accounts. Teacher sub-accounts: 403.
//  2. School MAIN account: PUT /api/school/pickup-points/:id (label / coords /
//     notes) for points of its own pupils. Teacher sub-accounts: 403.
//  3. Admin PUT /api/admin/users/:id accepts grade_scope (teacher grade → grade).
//  4. Login on a disabled account says so ONLY after the password is verified.
// DB-free: every query is answered by a fake keyed on SQL text.
require('./loadTestEnv');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-school-self-manage-0123456789';

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { ...mockUser }; next(); },
}));
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...a) => mockQuery(...a), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('bcrypt', () => ({
  hashSync: () => 'dummy-hash',
  hash: jest.fn().mockResolvedValue('new-hash'),
  compare: jest.fn(async (pw, hash) => hash === `hash:${pw}`),
}));

const express = require('express');
const request = require('supertest');
const { logAudit } = require('../src/utils/audit');

const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use('/api/admin', require('../src/routes/admin.routes'));
app.use('/api/auth', require('../src/routes/auth.routes'));
app.use(require('../src/middleware/errorHandler'));

const SCHOOL_A = { id: 1, role: 'school', scopeId: 'SCH1', gradeScope: null };
const TEACHER_A = { id: 2, role: 'school', scopeId: 'SCH1', gradeScope: 'ป.1' };
const ADMIN = { id: 9, role: 'admin', scopeId: null, gradeScope: null };

const norm = (sql) => String(sql).replace(/\s+/g, ' ');
const calls = (re) => mockQuery.mock.calls.filter(c => re.test(norm(c[0])));

// Teachers in the fake DB. A lookup only matches when its scope_id param equals
// the row's school — so a school-B teacher is invisible to school A.
const TEACHERS = [
  { id: 20, username: 'SCH1-P1', display_name: 'ครู ป.1', grade_scope: 'ป.1', is_active: 1, school: 'SCH1', is_deleted: false },
  { id: 21, username: 'SCH1-P2', display_name: 'ครู ป.2', grade_scope: 'ป.2', is_active: 1, school: 'SCH1', is_deleted: true },
  { id: 30, username: 'SCH2-P1', display_name: 'ครู B', grade_scope: 'ป.1', is_active: 1, school: 'SCH2', is_deleted: false },
  { id: 31, username: 'SCH2-P2', display_name: 'ครู B2', grade_scope: 'ป.2', is_active: 1, school: 'SCH2', is_deleted: true },
];

const POINT = { id: 5, vehicle_id: 'V-aaaaaaaaaaaa', sequence: 1, label: 'P', latitude: 18.29, longitude: 99.49, session: 'both', notes: null };

function fakeDb(opts = {}) {
  const o = { servesSchool: true, otherSchool: 0, ...opts };
  mockQuery.mockImplementation(async (sql, params = []) => {
    const s = norm(sql);
    // teacher-account lookups (school routes)
    if (/FROM users WHERE id = \? AND role = 'school'/.test(s) && /grade_scope IS NOT NULL/.test(s)) {
      const wantDeleted = /is_deleted = TRUE/.test(s);
      const row = TEACHERS.find(t => t.id === Number(params[0]) && t.school === params[1] && t.is_deleted === wantDeleted);
      return [row ? [row] : []];
    }
    if (/^UPDATE users SET/.test(s.trim())) return [{ affectedRows: 1 }];
    if (/FROM users WHERE role = 'school'/.test(s) && /is_deleted = TRUE/.test(s)) {
      return [TEACHERS.filter(t => t.school === params[0] && t.is_deleted)];
    }
    // pickup points
    if (/FROM pickup_points/.test(s) && !/student_pickup_points/.test(s)) return [[POINT]];
    if (/SELECT 1 FROM students WHERE vehicle_id = \? AND school_id = \?/.test(s)) return [o.servesSchool ? [{ 1: 1 }] : []];
    if (/COUNT\(\*\)/.test(s) && /<>/.test(s)) return [[{ n: o.otherSchool }]];
    if (/COUNT\(\*\)/.test(s)) return [[{ n: 1 }]];
    if (/UPDATE pickup_points SET/.test(s)) return [{ affectedRows: 1 }];
    return [[]];
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  logAudit.mockClear();
});

describe('teacher accounts — school main account', () => {
  test('PATCH changes grade and ends the teacher sessions', async () => {
    mockUser = SCHOOL_A; fakeDb();
    const res = await request(app).patch('/api/school/teacher-accounts/20').send({ grade_scope: 'ป.2' });
    expect(res.status).toBe(200);
    const [upd] = calls(/^UPDATE users SET/);
    expect(norm(upd[0])).toMatch(/grade_scope = \?/);
    expect(norm(upd[0])).toMatch(/password_changed_at = NOW\(\)/);
    expect(norm(upd[0])).toMatch(/scope_id = \? AND grade_scope IS NOT NULL/);
    expect(upd[1]).toEqual(['ป.2', 20, 'SCH1']);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'user', entityId: 20 }));
  });

  test('PATCH disables / re-enables without touching sessions', async () => {
    mockUser = SCHOOL_A; fakeDb();
    const res = await request(app).patch('/api/school/teacher-accounts/20').send({ is_active: false });
    expect(res.status).toBe(200);
    const [upd] = calls(/^UPDATE users SET/);
    expect(norm(upd[0])).toMatch(/is_active = \?/);
    expect(norm(upd[0])).not.toMatch(/password_changed_at/);
    expect(upd[1][0]).toBe(0);
  });

  test('PATCH rejects an invalid grade and a non-boolean is_active', async () => {
    mockUser = SCHOOL_A; fakeDb();
    expect((await request(app).patch('/api/school/teacher-accounts/20').send({ grade_scope: 'ป.9' })).status).toBe(400);
    expect((await request(app).patch('/api/school/teacher-accounts/20').send({ grade_scope: null })).status).toBe(400);
    expect((await request(app).patch('/api/school/teacher-accounts/20').send({ is_active: 'no' })).status).toBe(400);
    expect(calls(/^UPDATE users SET/)).toHaveLength(0);
  });

  test('school A cannot PATCH or restore a school-B teacher (404, no write)', async () => {
    mockUser = SCHOOL_A; fakeDb();
    expect((await request(app).patch('/api/school/teacher-accounts/30').send({ is_active: false })).status).toBe(404);
    expect((await request(app).post('/api/school/teacher-accounts/31/restore')).status).toBe(404);
    expect(calls(/^UPDATE users SET/)).toHaveLength(0);
  });

  test('deleted list is scoped to the caller school', async () => {
    mockUser = SCHOOL_A; fakeDb();
    const res = await request(app).get('/api/school/teacher-accounts/deleted');
    expect(res.status).toBe(200);
    expect(res.body.data.map(r => r.id)).toEqual([21]);
  });

  test('restore brings back a deleted teacher DISABLED', async () => {
    mockUser = SCHOOL_A; fakeDb();
    const res = await request(app).post('/api/school/teacher-accounts/21/restore');
    expect(res.status).toBe(200);
    const [upd] = calls(/^UPDATE users SET/);
    expect(norm(upd[0])).toMatch(/is_deleted = FALSE, deleted_at = NULL, is_active = FALSE/);
    expect(upd[1]).toEqual([21, 'SCH1']);
  });

  test('a grade-teacher sub-account cannot manage teacher accounts', async () => {
    mockUser = TEACHER_A; fakeDb();
    expect((await request(app).patch('/api/school/teacher-accounts/20').send({ is_active: false })).status).toBe(403);
    expect((await request(app).post('/api/school/teacher-accounts/21/restore')).status).toBe(403);
    expect((await request(app).get('/api/school/teacher-accounts/deleted')).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('pickup point edit — school main account', () => {
  const BODY = { label: 'หน้าวัด', latitude: 18.31, longitude: 99.51 };

  test('school edits label + coordinates of its own point', async () => {
    mockUser = SCHOOL_A; fakeDb();
    const res = await request(app).put('/api/school/pickup-points/5').send(BODY);
    expect(res.status).toBe(200);
    const [upd] = calls(/UPDATE pickup_points SET/);
    expect(upd[1]).toEqual(['หน้าวัด', 18.31, 99.51, 5]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'pickup_point' }));
  });

  test('school A cannot edit a point on a vehicle that does not serve it (403)', async () => {
    mockUser = SCHOOL_A; fakeDb({ servesSchool: false });
    const res = await request(app).put('/api/school/pickup-points/5').send(BODY);
    expect(res.status).toBe(403);
    expect(calls(/UPDATE pickup_points/)).toHaveLength(0);
  });

  test('a point shared with another school cannot be moved (409)', async () => {
    mockUser = SCHOOL_A; fakeDb({ otherSchool: 2 });
    const res = await request(app).put('/api/school/pickup-points/5').send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('POINT_SHARED_WITH_OTHER_SCHOOL');
    expect(calls(/UPDATE pickup_points/)).toHaveLength(0);
  });

  test('half a coordinate pair and session changes are not accepted', async () => {
    mockUser = SCHOOL_A; fakeDb();
    expect((await request(app).put('/api/school/pickup-points/5').send({ latitude: 18.3 })).status).toBe(400);
    expect((await request(app).put('/api/school/pickup-points/5').send({ session: 'morning' })).status).toBe(400);
    expect(calls(/UPDATE pickup_points/)).toHaveLength(0);
  });

  test('grade teacher keeps current rights only — no point edit (403)', async () => {
    mockUser = TEACHER_A; fakeDb();
    const res = await request(app).put('/api/school/pickup-points/5').send(BODY);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('admin PUT /users/:id grade_scope', () => {
  function adminDb(target) {
    mockQuery.mockImplementation(async (sql) => {
      const s = norm(sql);
      if (/FROM users WHERE id = \? AND is_deleted = FALSE/.test(s)) return [target ? [target] : []];
      if (/^UPDATE users SET/.test(s.trim())) return [{ affectedRows: 1 }];
      return [[]];
    });
  }

  test('moves a teacher to another grade and ends sessions', async () => {
    mockUser = ADMIN;
    adminDb({ id: 20, username: 't', role: 'school', scope_type: 'SCHOOL', scope_id: 'SCH1', grade_scope: 'ป.1', display_name: 't', is_active: 1 });
    const res = await request(app).put('/api/admin/users/20').send({ grade_scope: 'ป.2' });
    expect(res.status).toBe(200);
    const [upd] = calls(/^UPDATE users SET/);
    expect(norm(upd[0])).toMatch(/grade_scope = \?, password_changed_at = NOW\(\)/);
    expect(upd[1]).toEqual(['ป.2', 20]);
  });

  test('refuses grade_scope on a school MAIN account (no demotion/promotion)', async () => {
    mockUser = ADMIN;
    adminDb({ id: 1, username: 'SCH1', role: 'school', scope_type: 'SCHOOL', scope_id: 'SCH1', grade_scope: null, display_name: 's', is_active: 1 });
    const res = await request(app).put('/api/admin/users/1').send({ grade_scope: 'ป.1' });
    expect(res.status).toBe(400);
    expect(calls(/^UPDATE users SET/)).toHaveLength(0);
  });
});

describe('login on a disabled account', () => {
  function loginDb(user) {
    mockQuery.mockImplementation(async (sql) => {
      const s = norm(sql);
      if (/login_lockouts/.test(s)) return s.trim().startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }];
      if (/FROM users WHERE username = \?/.test(s)) return [[user]];
      return [[]];
    });
  }
  const DISABLED_TEACHER = { id: 20, username: 'SCH1-P1', password_hash: 'hash:Right-pass-1', role: 'school',
    scope_type: 'SCHOOL', scope_id: 'SCH1', grade_scope: 'ป.1', display_name: 'x', is_active: 0, is_deleted: 0,
    must_change_password: 0, driver_id: null };

  test('wrong password → the same generic 401 as any bad login', async () => {
    loginDb(DISABLED_TEACHER);
    const res = await request(app).post('/api/auth/login').send({ username: 'SCH1-P1', password: 'Wrong-pass-1' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  });

  test('correct password → ACCOUNT_DISABLED naming who to contact (teacher → school main account)', async () => {
    loginDb(DISABLED_TEACHER);
    const res = await request(app).post('/api/auth/login').send({ username: 'SCH1-P1', password: 'Right-pass-1' });
    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('ACCOUNT_DISABLED');
    expect(res.body.message).toMatch(/^บัญชีถูกปิดใช้งาน ติดต่อบัญชีหลักของโรงเรียน/);
    expect(res.body.data).toBeNull();
  });

  test('school main account is pointed at the affiliation office', async () => {
    loginDb({ ...DISABLED_TEACHER, grade_scope: null });
    const res = await request(app).post('/api/auth/login').send({ username: 'SCH1-P1', password: 'Right-pass-1' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/สำนักงานเขตพื้นที่การศึกษา/);
  });
});

describe('driver recent entries expose can_void for own latest taps only', () => {
  const { getStatusToday } = require('../src/services/checkin.service');
  const isRecent = (sql) => /FROM\s+checkin_logs cl/.test(sql);
  test('can_void is computed per row for the calling driver', async () => {
    const q = jest.fn(async (sql) => (isRecent(sql)
      ? [[{ id: 7, student_name: 'x', session: 'morning', status: 'CHECKED_IN', checked_at: null, can_void: 1 },
          { id: 6, student_name: 'y', session: 'morning', status: 'CANCELLED', checked_at: null, can_void: 0 }]]
      : [[{ total: 0 }]]));
    const out = await getStatusToday({ query: q }, 'V-1', { userId: 50 });
    const call = q.mock.calls.find(c => isRecent(c[0]));
    expect(norm(call[0])).toMatch(/cl\.checked_by = \?/);
    expect(norm(call[0])).toMatch(/c2\.id > cl\.id/);
    expect(call[1]).toEqual([50, 'V-1']);
    expect(out.recent.map(r => r.can_void)).toEqual([true, false]);
  });
  test('without a user nothing is voidable', async () => {
    const q = jest.fn(async (sql) => (isRecent(sql)
      ? [[{ id: 7, status: 'CHECKED_IN', can_void: 1 }]] : [[{ total: 0 }]]));
    const out = await getStatusToday({ query: q }, 'V-1');
    expect(out.recent[0].can_void).toBe(false);
  });
});
