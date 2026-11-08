'use strict';

// M3 routes: school issue endpoints (flag, full-school only) and the LIFF bind
// accepting a school code, optional or required.
jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/lineBindGuard', () => ({
  keysFor: jest.fn((o) => ({ pair: `pair:${o.studentKey}`, sub: o.sub ? `sub:${o.sub}` : undefined })),
  resolveStudentLockKey: jest.fn().mockResolvedValue('SCH1:101'),
  checkLock: jest.fn().mockResolvedValue({ locked: false }),
  noteFailure: jest.fn().mockResolvedValue(),
  noteSuccess: jest.fn().mockResolvedValue(),
}));
jest.mock('../src/services/line.service', () => ({
  auditBind: jest.fn().mockResolvedValue(),
  getLinkedParentId: jest.fn().mockResolvedValue(null),
  findLinkableParent: jest.fn().mockResolvedValue({ found: true, parentId: 7, studentCode: '101', student: { first_name: 'ก' } }),
  getLineUserIdByPhone: jest.fn().mockResolvedValue(null),
  getChildrenByPhone: jest.fn().mockResolvedValue([]),
  getLinkedChildren: jest.fn().mockResolvedValue([]),
  commitLineLink: jest.fn().mockResolvedValue({ success: true }),
  logMessage: jest.fn().mockResolvedValue(),
  pushParentFlex: jest.fn().mockResolvedValue(),
  LineBindConflictError: class LineBindConflictError extends Error {},
}));
jest.mock('../src/services/parentClaimCode.service', () => {
  const actual = jest.requireActual('../src/services/parentClaimCode.service');
  return {
    ...actual,
    issueForStudents: jest.fn().mockResolvedValue([{ id: 7, first_name: 'ก', code: 'ABCD-2345' }]),
    findLinkableParentByClaim: jest.fn().mockResolvedValue({ found: true, claimId: 3, parentId: 7, studentCode: '101', student: { first_name: 'ก' } }),
    markUsed: jest.fn().mockResolvedValue(true),
  };
});
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = JSON.parse(decodeURIComponent(req.headers['x-test-user'] || '%7B%7D')); next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[{ id: 7 }]]), getConnection: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const claimSvc = require('../src/services/parentClaimCode.service');

const app = express();
app.use(express.json());
app.use('/api/parent', require('../src/routes/parent.routes'));
app.use('/api/school', require('../src/routes/school.routes'));
app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

const SCHOOL = { id: 5, role: 'school', scopeType: 'SCHOOL', scopeId: 'SCH1', gradeScope: null };
const TEACHER = { ...SCHOOL, id: 6, gradeScope: 'ป.1' };
const asUser = (r, u) => r.set('x-test-user', encodeURIComponent(JSON.stringify(u)));

let n = 0;
beforeEach(() => {
  jest.clearAllMocks();
  env.features.parentClaimCode = true;
  env.features.parentClaimCodeRequired = false;
  // A fresh LINE user per test keeps the per-user bind limiter out of the way.
  n += 1;
  idTokenSvc.verifyIdToken.mockResolvedValue({ valid: true, userId: `U${n}` });
});
afterAll(() => { env.features.parentClaimCode = false; env.features.parentClaimCodeRequired = false; });

describe('school issue endpoints', () => {
  test('flag off: 404, nothing issued', async () => {
    env.features.parentClaimCode = false;
    expect((await asUser(request(app).post('/api/school/students/7/claim-code'), SCHOOL)).status).toBe(404);
    expect((await asUser(request(app).post('/api/school/claim-codes'), SCHOOL).send({ grade: 'ป.1' })).status).toBe(404);
    expect(claimSvc.issueForStudents).not.toHaveBeenCalled();
  });

  test('grade teacher is refused', async () => {
    expect((await asUser(request(app).post('/api/school/students/7/claim-code'), TEACHER)).status).toBe(403);
    expect(claimSvc.issueForStudents).not.toHaveBeenCalled();
  });

  test('full school account gets the code once, scoped to its school', async () => {
    const res = await asUser(request(app).post('/api/school/students/7/claim-code'), SCHOOL);
    expect(res.status).toBe(201);
    expect(res.body.data.codes[0].code).toBe('ABCD-2345');
    expect(claimSvc.issueForStudents).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'SCH1', studentIds: [7], userId: 5 }));
  });

  test('bulk needs a grade', async () => {
    expect((await asUser(request(app).post('/api/school/claim-codes'), SCHOOL).send({})).status).toBe(400);
  });
});

describe('LIFF bind with a school code', () => {
  const body = (extra) => ({ idToken: 't', phone: '0811112222', ...extra });

  test('bind-config tells the form what to show', async () => {
    env.features.parentClaimCodeRequired = true;
    const res = await request(app).get('/api/parent/line/bind-config');
    expect(res.body.data).toMatchObject({ claim_code_enabled: true, claim_code_required: true });
  });

  test('preview with a code needs no student code and uses the claim lookup', async () => {
    const res = await request(app).post('/api/parent/line/bind-preview').send(body({ claim_code: 'abcd-2345' }));
    expect(res.status).toBe(200);
    expect(claimSvc.findLinkableParentByClaim).toHaveBeenCalledWith('0811112222', 'ABCD2345');
    expect(lineSvc.findLinkableParent).not.toHaveBeenCalled();
  });

  test('confirm with a code marks it used after the bind', async () => {
    const res = await request(app).post('/api/parent/line/bind-confirm').send(body({ claim_code: 'ABCD2345' }));
    expect(res.status).toBe(201);
    expect(claimSvc.markUsed).toHaveBeenCalledWith(3, `U${n}`);
    expect(lineSvc.commitLineLink.mock.invocationCallOrder[0]).toBeLessThan(claimSvc.markUsed.mock.invocationCallOrder[0]);
  });

  test('not required: the classic phone + student code still binds', async () => {
    const res = await request(app).post('/api/parent/line/bind-confirm').send(body({ student_code: '101' }));
    expect(res.status).toBe(201);
    expect(claimSvc.markUsed).not.toHaveBeenCalled();
  });

  test('required: phone + student code alone is refused', async () => {
    env.features.parentClaimCodeRequired = true;
    const res = await request(app).post('/api/parent/line/bind-preview').send(body({ student_code: '101' }));
    expect(res.status).toBe(400);
    expect(lineSvc.findLinkableParent).not.toHaveBeenCalled();
  });

  test('flag off: a code is ignored and the classic path runs', async () => {
    env.features.parentClaimCode = false;
    const res = await request(app).post('/api/parent/line/bind-preview').send(body({ claim_code: 'ABCD2345', student_code: '101' }));
    expect(res.status).toBe(200);
    expect(claimSvc.findLinkableParentByClaim).not.toHaveBeenCalled();
  });
});
