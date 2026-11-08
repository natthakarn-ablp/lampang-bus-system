'use strict';

// M1 parent leave routes: dark when the flag is off, link + consent checked,
// service errors mapped to their status.
jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/line.service');
jest.mock('../src/services/parentLeave.service', () => ({
  createParentLeave: jest.fn(), cancelParentLeave: jest.fn(), listParentLeaves: jest.fn(),
  SESSION_TH: { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' },
}));
jest.mock('../src/services/parentConsentGate', () => ({
  guardParentView: jest.fn().mockResolvedValue({ allowed: true }),
  applyChildListGate: jest.fn((children) => ({ children, consent_required: false, consent_granted: true })),
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]) } }));

const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const leaveSvc = require('../src/services/parentLeave.service');
const parentRoutes = require('../src/routes/parent.routes');

const app = express();
app.use(express.json());
app.use('/api/parent', parentRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

const auth = (r) => r.set('Authorization', 'Bearer t');

beforeEach(() => {
  jest.clearAllMocks();
  env.features.parentLeave = true;
  idTokenSvc.verifyIdToken.mockResolvedValue({ valid: true, userId: 'U_p' });
  lineSvc.getLinkedChildren.mockResolvedValue([{ id: 7, first_name: 'ก', last_name: 'ข' }]);
  lineSvc.sendTextMessage.mockResolvedValue({ dryRun: true });
});
afterAll(() => { env.features.parentLeave = false; });

test('flag off: every leave endpoint is 404 and the service is never called', async () => {
  env.features.parentLeave = false;
  expect((await auth(request(app).get('/api/parent/children/7/leaves'))).status).toBe(404);
  expect((await auth(request(app).post('/api/parent/children/7/leaves')).send({})).status).toBe(404);
  expect((await auth(request(app).post('/api/parent/leaves/3/cancel'))).status).toBe(404);
  expect(leaveSvc.createParentLeave).not.toHaveBeenCalled();
});

test('children list tells the LIFF page whether parent leave is on', async () => {
  const res = await auth(request(app).get('/api/parent/children'));
  expect(res.body.meta.parent_leave_enabled).toBe(true);
});

test('a child not linked to this LINE account is 403', async () => {
  const res = await auth(request(app).post('/api/parent/children/8/leaves')).send({ leave_date: '2026-11-10', session: 'morning' });
  expect(res.status).toBe(403);
  expect(leaveSvc.createParentLeave).not.toHaveBeenCalled();
});

test('create passes the verified LINE id and confirms in LINE', async () => {
  leaveSvc.createParentLeave.mockResolvedValue({ id: 1, student_id: 7, leave_date: '2026-11-10', session: 'morning' });
  const res = await auth(request(app).post('/api/parent/children/7/leaves'))
    .send({ leave_date: '2026-11-10', session: 'morning', reason: 'ป่วย', lineUserId: 'U_forged' });
  expect(res.status).toBe(201);
  expect(leaveSvc.createParentLeave).toHaveBeenCalledWith({
    lineUserId: 'U_p', studentId: 7, leaveDate: '2026-11-10', session: 'morning', reason: 'ป่วย',
  });
  expect(lineSvc.sendTextMessage).toHaveBeenCalledWith('U_p', expect.stringContaining('รับแจ้งลาแล้ว'));
});

test('service errors keep their status and code', async () => {
  const err = Object.assign(new Error('เลยเวลา'), { statusCode: 409, code: 'PARENT_LEAVE_CUTOFF' });
  leaveSvc.createParentLeave.mockRejectedValue(err);
  const res = await auth(request(app).post('/api/parent/children/7/leaves')).send({ leave_date: '2026-11-09', session: 'morning' });
  expect(res.status).toBe(409);
  expect(res.body.errors).toEqual([{ code: 'PARENT_LEAVE_CUTOFF' }]);
});

test('cancel uses the verified LINE id', async () => {
  leaveSvc.cancelParentLeave.mockResolvedValue({ id: 3, cancelled: true });
  const res = await auth(request(app).post('/api/parent/leaves/3/cancel'));
  expect(res.status).toBe(200);
  expect(leaveSvc.cancelParentLeave).toHaveBeenCalledWith({ lineUserId: 'U_p', leaveId: 3 });
});
