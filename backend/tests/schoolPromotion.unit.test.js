'use strict';
require('./loadTestEnv');

// Synthetic pupils only. The fake db below is a tiny in-memory model of the
// three statements the service issues, so preview/apply can be checked for
// what they WRITE rather than for the SQL text.
const mockAudit = jest.fn();
jest.mock('../src/utils/audit', () => ({ logAudit: (...a) => mockAudit(...a) }));
const svc = require('../src/services/schoolPromotion.service');

function makeDb(initial, { promoted = [] } = {}) {
  const state = {
    students: initial.map((s) => ({ prefix: 'ด.ช.', last_name: 'ทดสอบ', classroom: '1', is_deleted: false, vehicle_id: 'V1', ...s })),
    promoted: [...promoted], writes: [], committed: 0, rolledBack: 0,
  };
  const conn = {
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => { state.committed += 1; }),
    rollback: jest.fn(async () => { state.rolledBack += 1; }),
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT academic_year FROM school_year_promotions')) return [state.promoted.map((y) => ({ academic_year: y }))];
      if (q.startsWith('SELECT id, student_code')) return [state.students.filter((s) => !s.is_deleted)];
      if (q.startsWith('SELECT id FROM students')) return [state.students.filter((s) => !s.is_deleted)];
      if (q.startsWith('INSERT INTO school_year_promotions')) {
        if (state.promoted.includes(params[1])) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        state.promoted.push(params[1]); state.writes.push('insert-promotion'); return [{ affectedRows: 1 }];
      }
      if (q.startsWith('UPDATE school_year_promotions')) return [{ affectedRows: 1 }];
      if (q.startsWith('UPDATE students SET grade')) {
        state.writes.push('grade');
        state.students.filter((s) => params[2].includes(s.id)).forEach((s) => { s.grade = params[0]; });
        return [{ affectedRows: params[2].length }];
      }
      if (q.startsWith('UPDATE students SET is_deleted = TRUE')) {
        state.writes.push('graduate');
        state.students.filter((s) => params[1].includes(s.id)).forEach((s) => { s.is_deleted = true; s.vehicle_id = null; });
        return [{ affectedRows: params[1].length }];
      }
      throw new Error(`unexpected sql: ${q}`);
    }),
  };
  return { state, conn, query: conn.query, getConnection: jest.fn(async () => conn) };
}

const YEAR = svc.currentBuddhistYear();
const roster = () => [
  { id: 1, first_name: 'เอ', grade: 'อ.1' },
  { id: 2, first_name: 'บี', grade: 'ป.2' },
  { id: 3, first_name: 'ซี', grade: 'ประถมศึกษาปีที่ 3' },
  { id: 4, first_name: 'ดี', grade: 'ป.6' },
  { id: 5, first_name: 'อี', grade: 'ม.3' },
  { id: 6, first_name: 'เอฟ', grade: 'ม.6' },
  { id: 7, first_name: 'จี', grade: 'ชั้นพิเศษ' },
  { id: 8, first_name: 'เอช', grade: 'ป.2' },
];

beforeEach(() => mockAudit.mockReset().mockResolvedValue());

test('preview writes nothing and groups by normalized grade with unreadable apart', async () => {
  const db = makeDb(roster());
  const out = await svc.previewPromotion(db, { schoolId: 'S1', academicYear: YEAR });
  expect(db.state.writes).toEqual([]);
  expect(db.getConnection).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
  const rows = Object.fromEntries(out.rows.map((r) => [r.from, [r.to, r.count]]));
  expect(rows).toMatchObject({ 'อ.1': ['อ.2', 1], 'ป.2': ['ป.3', 2], 'ป.3': ['ป.4', 1], 'ป.6': [null, 1], 'ม.3': [null, 1], 'ม.6': [null, 1] });
  expect(out.unreadable.map((p) => p.id)).toEqual([7]);
  expect(out.already_promoted).toBe(false);
});

test('apply moves each pupil exactly one grade, graduates are soft deleted and unassigned', async () => {
  const db = makeDb(roster());
  const out = await svc.applyPromotion(db, { schoolId: 'S1', academicYear: YEAR, actorId: 9 });
  const g = (id) => db.state.students.find((s) => s.id === id);
  expect([1, 2, 3, 8].map((i) => g(i).grade)).toEqual(['อ.2', 'ป.3', 'ป.4', 'ป.3']);
  for (const id of [4, 5, 6]) { expect(g(id).is_deleted).toBe(true); expect(g(id).vehicle_id).toBeNull(); }
  expect(g(7)).toMatchObject({ grade: 'ชั้นพิเศษ', is_deleted: false, vehicle_id: 'V1' });
  expect(out).toMatchObject({ promoted: 4, graduated: 3, excluded: 0, unreadable: 1 });
  expect(db.state.committed).toBe(1);
  // one summary + one row per moved pupil, all required
  expect(mockAudit).toHaveBeenCalledTimes(1 + 7);
  expect(mockAudit.mock.calls.every(([a]) => a.required === true && a.conn === db.conn)).toBe(true);
  const summary = mockAudit.mock.calls[0][0];
  expect(summary.newValue.per_grade.find((r) => r.from === 'ป.2')).toEqual({ from: 'ป.2', to: 'ป.3', count: 2, excluded: 0 });
});

test('excluded pupils keep grade and bus; audit is not written for them', async () => {
  const db = makeDb(roster());
  const out = await svc.applyPromotion(db, { schoolId: 'S1', academicYear: YEAR, actorId: 9, excludedIds: [2, 4] });
  const g = (id) => db.state.students.find((s) => s.id === id);
  expect(g(2)).toMatchObject({ grade: 'ป.2', is_deleted: false });
  expect(g(4)).toMatchObject({ grade: 'ป.6', is_deleted: false, vehicle_id: 'V1' });
  expect(out).toMatchObject({ promoted: 3, graduated: 2, excluded: 2 });
  expect(mockAudit.mock.calls.filter(([a]) => a.entityType === 'student').map(([a]) => a.entityId)).not.toEqual(expect.arrayContaining(['2', '4']));
});

test('second run in the same academic year is 409 and changes nothing', async () => {
  const db = makeDb(roster(), { promoted: [YEAR] });
  await expect(svc.applyPromotion(db, { schoolId: 'S1', academicYear: YEAR, actorId: 9 })).rejects.toMatchObject({ statusCode: 409 });
  expect(db.state.writes).toEqual([]);
  expect(db.state.rolledBack).toBe(1);
  expect(db.state.students.find((s) => s.id === 1).grade).toBe('อ.1');
  const pre = await svc.previewPromotion(db, { schoolId: 'S1', academicYear: YEAR });
  expect(pre.already_promoted).toBe(true);
});

test('excluding a pupil from another school is rejected and rolled back', async () => {
  const db = makeDb(roster());
  await expect(svc.applyPromotion(db, { schoolId: 'S1', academicYear: YEAR, actorId: 9, excludedIds: [999] })).rejects.toMatchObject({ statusCode: 400 });
  expect(db.state.rolledBack).toBe(1);
  expect(db.state.committed).toBe(0);
});

test('audit failure rolls the whole promotion back', async () => {
  const db = makeDb(roster());
  mockAudit.mockRejectedValueOnce(new Error('audit down'));
  await expect(svc.applyPromotion(db, { schoolId: 'S1', academicYear: YEAR, actorId: 9 })).rejects.toThrow('audit down');
  expect(db.state.rolledBack).toBe(1);
  expect(db.state.committed).toBe(0);
});

test.each(['abc', '1999', String(YEAR + 5), ''])('academic year %j is rejected', async (y) => {
  await expect(svc.applyPromotion(makeDb(roster()), { schoolId: 'S1', academicYear: y, actorId: 9 })).rejects.toMatchObject({ statusCode: 400 });
});

describe('routes', () => {
  const express = require('express');
  const request = require('supertest');
  let user;
  const mockQuery = jest.fn();
  jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => { req.user = global.__promoUser; next(); } }));
  jest.mock('../src/config/database', () => ({ pool: { query: (...a) => global.__promoQuery(...a), getConnection: (...a) => global.__promoConn(...a) } }));
  const app = express();
  app.use(express.json());
  app.use('/api/school/promotion', require('../src/routes/schoolPromotion.routes'));
  app.use(require('../src/middleware/errorHandler'));
  beforeEach(() => { global.__promoQuery = mockQuery.mockReset().mockResolvedValue([[]]); global.__promoConn = jest.fn(); });

  test('grade teacher gets 403 on preview and apply', async () => {
    global.__promoUser = { id: 1, role: 'school', scopeId: 'S1', gradeScope: 'ป.3' };
    expect((await request(app).get('/api/school/promotion/preview')).status).toBe(403);
    expect((await request(app).post('/api/school/promotion/apply').send({ academic_year: YEAR })).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('platform admin must name a school', async () => {
    global.__promoUser = { id: 1, role: 'admin' };
    expect((await request(app).get('/api/school/promotion/preview')).status).toBe(400);
  });
  test('school admin preview is read-only (SELECT only) and bound to own school', async () => {
    global.__promoUser = { id: 1, role: 'school', scopeId: 'S1', gradeScope: null };
    const res = await request(app).get('/api/school/promotion/preview').query({ academic_year: YEAR, school_id: 'OTHER' });
    expect(res.status).toBe(200);
    for (const [sql, params] of mockQuery.mock.calls) {
      expect(sql.trim()).toMatch(/^SELECT/);
      expect(params[0]).toBe('S1');
    }
    expect(global.__promoConn).not.toHaveBeenCalled();
  });
});
