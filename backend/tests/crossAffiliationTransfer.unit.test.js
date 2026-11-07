'use strict';

/**
 * crossAffiliationTransfer.unit.test.js  (QA affiliation-03)
 *
 * A transfer whose destination school is in a DIFFERENT affiliation from the
 * source school is decided by the destination school, not by the source
 * affiliation. Same-affiliation transfers keep the affiliation flow.
 *
 * Route-level (supertest) against the real studentTransfer service and a
 * hand-rolled fake pool, so the scope checks are exercised end to end
 * without a database.
 */

require('./loadTestEnv');

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

// ── Fake data ────────────────────────────────────────────────────────────────
// AFF1: S1 (source), S2.  AFF2: S3, S4.
const SCHOOLS = {
  S1: { name: 'ต้นทาง เขต 1', affiliation_id: 'AFF1' },
  S2: { name: 'ปลายทาง เขต 1', affiliation_id: 'AFF1' },
  S3: { name: 'ปลายทาง เขต 2', affiliation_id: 'AFF2' },
  S4: { name: 'อีกโรงเรียน เขต 2', affiliation_id: 'AFF2' },
};
let requests;
let inserted;
const student = { id: 100, school_id: 'S1', student_code: '500', prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', grade: 'ป.4', classroom: '1', vehicle_id: null, is_deleted: 0 };

function joined(q) {
  const ss = SCHOOLS[q.source_school_id] || {};
  const ds = SCHOOLS[q.destination_school_id] || {};
  return { ...q, source_school_name: ss.name, destination_school_name: ds.name,
    source_affiliation_id: ss.affiliation_id ?? null, destination_affiliation_id: ds.affiliation_id ?? null };
}

function mockHandle(sql, params = []) {
  if (/FROM student_transfer_requests q/.test(sql)) {
    let rows = Object.values(requests).map(joined);
    if (/WHERE q\.id = \? AND q\.destination_school_id = \?/.test(sql)) {
      rows = rows.filter((r) => String(r.id) === String(params[0]) && String(r.destination_school_id) === String(params[1]));
    } else if (/WHERE q\.id = \? AND \(ss\.affiliation_id = \? OR ds\.affiliation_id = \?\)/.test(sql)) {
      rows = rows.filter((r) => String(r.id) === String(params[0]) && (r.source_affiliation_id === params[1] || r.destination_affiliation_id === params[2]));
    } else if (/WHERE \(ss\.affiliation_id = \? OR ds\.affiliation_id = \?\)/.test(sql)) {
      rows = rows.filter((r) => r.source_affiliation_id === params[0] || r.destination_affiliation_id === params[1]);
    } else if (/WHERE q\.source_school_id = \? OR q\.destination_school_id = \?/.test(sql)) {
      rows = rows.filter((r) => r.source_school_id === params[0] || r.destination_school_id === params[1]);
    }
    return [rows];
  }
  if (/FROM student_transfer_requests WHERE id = \?/.test(sql)) {
    const r = requests[params[0]];
    return [r ? [{ ...r }] : []];
  }
  if (/UPDATE student_transfer_requests SET status='REJECTED'/.test(sql)) {
    const r = requests[params[2]];
    if (r && r.status === 'PENDING') r.status = 'REJECTED';
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE student_transfer_requests SET status='APPLIED'/.test(sql)) {
    const r = requests[params[params.length - 1]];
    if (r) { r.status = 'APPLIED'; r.applied_student_id = params[1]; }
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO students/.test(sql)) { inserted.push(params); return [{ affectedRows: 1 }]; }
  if (/FROM students WHERE id = \?/.test(sql)) return [[{ ...student }]];
  if (/FROM students WHERE school_id = \? AND student_code = \?/.test(sql)) return [[]];
  if (/FROM schools WHERE id = \? AND/.test(sql)) return [SCHOOLS[params[0]] ? [{ id: params[0], ...SCHOOLS[params[0]] }] : []];
  if (/FROM id_sequences/.test(sql)) return [[{ next_value: 99001 }]];
  if (/FROM parent_student WHERE student_id/.test(sql)) return [[{ total: 1, approved_total: 1 }]];
  return [{ affectedRows: 1 }];
}

jest.mock('../src/config/database', () => {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => mockHandle(sql, params),
  };
  return { pool: { query: async (sql, params) => mockHandle(sql, params), getConnection: async () => conn } };
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use('/api/affiliation', require('../src/routes/affiliation.routes'));
app.use(require('../src/middleware/errorHandler'));

const asSchool = (scopeId, gradeScope = null) => { mockUser = { id: 7, role: 'school', scopeId, gradeScope }; };
const asAffiliation = (scopeId) => { mockUser = { id: 8, role: 'affiliation', scopeId }; };

beforeEach(() => {
  inserted = [];
  requests = {
    // Cross-affiliation: S1 (AFF1) → S3 (AFF2)
    42: { id: 42, status: 'PENDING', request_type: 'TRANSFER_TO_SCHOOL', student_id: 100, student_code: '500', student_name_snapshot: 'ด.ช.ก ข', source_school_id: 'S1', destination_school_id: 'S3', reason: 'ย้ายตามผู้ปกครอง' },
    // Same affiliation: S1 (AFF1) → S2 (AFF1)
    43: { id: 43, status: 'PENDING', request_type: 'TRANSFER_TO_SCHOOL', student_id: 100, student_code: '500', student_name_snapshot: 'ด.ช.ก ข', source_school_id: 'S1', destination_school_id: 'S2', reason: 'ย้าย' },
  };
});

describe('source affiliation and cross-affiliation requests', () => {
  test('source affiliation cannot approve a cross-affiliation request (403, Thai, nothing applied)', async () => {
    asAffiliation('AFF1');
    const res = await request(app).post('/api/affiliation/transfer-requests/42/approve').send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/ข้ามสังกัด/);
    expect(res.body.message).toMatch(/โรงเรียนปลายทาง/);
    expect(requests[42].status).toBe('PENDING');
    expect(inserted).toHaveLength(0);
  });

  test('source affiliation cannot reject a cross-affiliation request either', async () => {
    asAffiliation('AFF1');
    const res = await request(app).post('/api/affiliation/transfer-requests/42/reject').send({});
    expect(res.status).toBe(403);
    expect(requests[42].status).toBe('PENDING');
  });

  test('source affiliation still sees the request, marked OUTGOING and not approvable', async () => {
    asAffiliation('AFF1');
    const res = await request(app).get('/api/affiliation/transfer-requests');
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.id === 42);
    expect(row).toMatchObject({ direction: 'OUTGOING', cross_affiliation: true, approver: 'DESTINATION_SCHOOL', can_approve: false });
    const internal = res.body.data.find((r) => r.id === 43);
    expect(internal).toMatchObject({ direction: 'INTERNAL', cross_affiliation: false, can_approve: true });
  });

  test('destination affiliation cannot approve it either; it sees it as INCOMING', async () => {
    asAffiliation('AFF2');
    const list = await request(app).get('/api/affiliation/transfer-requests');
    expect(list.body.data.map((r) => r.id)).toEqual([42]);
    expect(list.body.data[0]).toMatchObject({ direction: 'INCOMING', can_approve: false });
    const res = await request(app).post('/api/affiliation/transfer-requests/42/approve').send({});
    expect(res.status).toBe(403);
  });
});

describe('destination school decides cross-affiliation requests', () => {
  test('destination school main account can view, then approve into its own school', async () => {
    asSchool('S3');
    const detail = await request(app).get('/api/school/students/transfer-requests/42');
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ can_decide: true, cross_affiliation: true, student_code: '500', grade: 'ป.4', guardian_links: 1 });
    expect(detail.body.data).not.toHaveProperty('student_id');

    const res = await request(app).post('/api/school/students/transfer-requests/42/approve').send({ note: 'รับเข้า' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPLIED');
    expect(requests[42].status).toBe('APPLIED');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain('S3'); // the new student row lands in the caller's school
  });

  test('destination school can reject', async () => {
    asSchool('S3');
    const res = await request(app).post('/api/school/students/transfer-requests/42/reject').send({ note: 'ไม่มีที่ว่าง' });
    expect(res.status).toBe(200);
    expect(requests[42].status).toBe('REJECTED');
  });

  test('destination school list marks the request INCOMING and decidable', async () => {
    asSchool('S3');
    const res = await request(app).get('/api/school/students/transfer-requests');
    expect(res.body.data.find((r) => r.id === 42)).toMatchObject({ direction: 'INCOMING', can_decide: true });
  });

  test('source school sees status, OUTGOING, but cannot approve its own outgoing request', async () => {
    asSchool('S1');
    const list = await request(app).get('/api/school/students/transfer-requests');
    expect(list.body.data.find((r) => r.id === 42)).toMatchObject({ direction: 'OUTGOING', can_decide: false, status: 'PENDING' });
    const res = await request(app).post('/api/school/students/transfer-requests/42/approve').send({});
    expect(res.status).toBe(404);
    expect(requests[42].status).toBe('PENDING');
  });

  test('another school (same affiliation as destination) cannot view, approve or reject', async () => {
    asSchool('S4');
    expect((await request(app).get('/api/school/students/transfer-requests/42')).status).toBe(404);
    expect((await request(app).post('/api/school/students/transfer-requests/42/approve').send({})).status).toBe(404);
    expect((await request(app).post('/api/school/students/transfer-requests/42/reject').send({})).status).toBe(404);
    expect(requests[42].status).toBe('PENDING');
    expect(inserted).toHaveLength(0);
  });

  test('a grade-scoped teacher of the destination school cannot approve or view', async () => {
    asSchool('S3', 'ป.4');
    expect((await request(app).post('/api/school/students/transfer-requests/42/approve').send({})).status).toBe(403);
    expect((await request(app).post('/api/school/students/transfer-requests/42/reject').send({})).status).toBe(403);
    expect((await request(app).get('/api/school/students/transfer-requests/42')).status).toBe(403);
    expect(requests[42].status).toBe('PENDING');
  });
});

describe('same-affiliation flow unchanged', () => {
  test('affiliation approves a same-affiliation request as before', async () => {
    asAffiliation('AFF1');
    const res = await request(app).post('/api/affiliation/transfer-requests/43/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPLIED');
    expect(res.body.message).toBe('อนุมัติและดำเนินการโอนย้ายสำเร็จ');
    expect(inserted[0]).toContain('S2');
  });

  test('affiliation rejects a same-affiliation request as before', async () => {
    asAffiliation('AFF1');
    const res = await request(app).post('/api/affiliation/transfer-requests/43/reject').send({});
    expect(res.status).toBe(200);
    expect(requests[43].status).toBe('REJECTED');
  });

  test('destination school cannot short-circuit a same-affiliation request', async () => {
    asSchool('S2');
    const res = await request(app).post('/api/school/students/transfer-requests/43/approve').send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/สังกัดเดียวกัน/);
    expect(requests[43].status).toBe('PENDING');
  });

  test('another affiliation cannot touch a same-affiliation request', async () => {
    asAffiliation('AFF2');
    const res = await request(app).post('/api/affiliation/transfer-requests/43/approve').send({});
    expect(res.status).toBe(404);
  });
});

describe('createRequest reports who decides', () => {
  const svc = require('../src/services/studentTransfer.service');
  const { pool } = require('../src/config/database');
  test('cross-affiliation create → DESTINATION_SCHOOL', async () => {
    requests = {};
    const fakePool = { query: async (sql, params) => {
      if (/FROM schools WHERE id = \? AND/.test(sql)) return [[{ id: 'S3', name: 'x', affiliation_id: 'AFF2', source_affiliation_id: 'AFF1' }]];
      if (/INSERT INTO student_transfer_requests/.test(sql)) return [{ insertId: 50 }];
      if (/status = 'PENDING' LIMIT 1/.test(sql)) return [[]];
      return pool.query(sql, params);
    } };
    const out = await svc.createRequest(fakePool, { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S3', reason: 'ย้าย' });
    expect(out).toMatchObject({ status: 'PENDING', cross_affiliation: true, approver: 'DESTINATION_SCHOOL' });
  });
  test('isCrossAffiliation treats a missing affiliation as different', () => {
    expect(svc.isCrossAffiliation({ source_affiliation_id: 'AFF1', destination_affiliation_id: 'AFF1' })).toBe(false);
    expect(svc.isCrossAffiliation({ source_affiliation_id: 'AFF1', destination_affiliation_id: null })).toBe(true);
    expect(svc.isCrossAffiliation({ source_affiliation_id: null, destination_affiliation_id: null })).toBe(false);
  });
});
