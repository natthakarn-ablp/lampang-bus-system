'use strict';

// M2 co-guardian routes + the unbind paths that must take co-guardians along.
jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/coGuardian.service', () => ({
  getGuardianInfo: jest.fn().mockResolvedValue({ role: 'primary', max: 2, co_guardians: [], pending_invite: false }),
  createInvite: jest.fn().mockResolvedValue({ code: 'ABCD-2345', valid_hours: 24 }),
  acceptInvite: jest.fn().mockResolvedValue({ ok: true, invited_by: 'U_primary' }),
  removeByPrimary: jest.fn().mockResolvedValue(['U_c']),
  leave: jest.fn().mockResolvedValue([]),
  removeAllForPhone: jest.fn().mockResolvedValue(['U_c']),
}));
jest.mock('../src/services/parentConsentGate', () => ({
  guardParentView: jest.fn().mockResolvedValue({ allowed: true }),
  applyChildListGate: jest.fn((children) => ({ children, consent_required: false, consent_granted: true })),
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]), getConnection: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const idTokenSvc = require('../src/services/lineIdToken.service');
const coSvc = require('../src/services/coGuardian.service');
const lineSvc = require('../src/services/line.service');
const { pool } = require('../src/config/database');

const app = express();
app.use(express.json());
app.use('/api/parent', require('../src/routes/parent.routes'));
app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

let n = 0;
beforeEach(() => {
  jest.clearAllMocks();
  env.features.coGuardian = true;
  n += 1;
  idTokenSvc.verifyIdToken.mockResolvedValue({ valid: true, userId: `U${n}` });
  jest.spyOn(lineSvc, 'sendTextMessage').mockResolvedValue({ dryRun: true });
});
afterAll(() => { env.features.coGuardian = false; });
const auth = (r) => r.set('Authorization', 'Bearer t');

test('flag off: every guardian endpoint is 404', async () => {
  env.features.coGuardian = false;
  for (const [m, p] of [['get', '/guardians'], ['post', '/guardians/invite'], ['post', '/guardians/accept'], ['post', '/guardians/3/remove'], ['post', '/guardians/leave']]) {
    expect((await auth(request(app)[m](`/api/parent${p}`))).status).toBe(404);
  }
  expect(coSvc.createInvite).not.toHaveBeenCalled();
});

test('invite, accept, remove use the VERIFIED LINE id', async () => {
  expect((await auth(request(app).post('/api/parent/guardians/invite'))).status).toBe(201);
  expect(coSvc.createInvite).toHaveBeenCalledWith(`U${n}`);
  const acc = await auth(request(app).post('/api/parent/guardians/accept')).send({ code: 'abcd-2345', lineUserId: 'U_forged' });
  expect(acc.status).toBe(201);
  expect(coSvc.acceptInvite).toHaveBeenCalledWith(`U${n}`, 'abcd-2345');
  expect(lineSvc.sendTextMessage).toHaveBeenCalledWith('U_primary', expect.stringContaining('ผู้ปกครองร่วม'));
  expect((await auth(request(app).post('/api/parent/guardians/3/remove'))).status).toBe(200);
  expect(coSvc.removeByPrimary).toHaveBeenCalledWith(`U${n}`, 3);
});

test('service errors keep their status', async () => {
  coSvc.acceptInvite.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 409, code: 'ALREADY_BOUND' }));
  const res = await auth(request(app).post('/api/parent/guardians/accept')).send({ code: 'ABCD2345' });
  expect(res.status).toBe(409);
  expect(res.body.errors).toEqual([{ code: 'ALREADY_BOUND' }]);
});

test('meta and bind-config advertise the flag', async () => {
  expect((await request(app).get('/api/parent/line/bind-config')).body.data.co_guardian_enabled).toBe(true);
});

describe('chat/LIFF self-unbind (line.service.unlinkAccount)', () => {
  test('a co-guardian only leaves; the primary binding is untouched', async () => {
    coSvc.leave.mockResolvedValueOnce(['U_c']);
    const out = await lineSvc.unlinkAccount('U_c');
    expect(out).toMatchObject({ success: true, coGuardian: true });
    expect(pool.getConnection).not.toHaveBeenCalled(); // unbindLineUser never ran
  });

  test('a primary unbinding takes its co-guardians along', async () => {
    pool.query.mockImplementation(async (sql) => (/SELECT lb\.phone FROM/.test(sql) ? [[{ phone: '0811' }]] : [[]]));
    const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) };
    pool.getConnection.mockResolvedValue(conn);
    const out = await lineSvc.unlinkAccount('U_p');
    expect(out).toMatchObject({ success: true, unlinkedPhone: '0811' });
    expect(coSvc.removeAllForPhone).toHaveBeenCalledWith('0811');
  });

  test('flag off: co-guardian service is never consulted', async () => {
    env.features.coGuardian = false;
    pool.query.mockResolvedValue([[]]);
    await lineSvc.unlinkAccount('U_x');
    expect(coSvc.leave).not.toHaveBeenCalled();
    expect(coSvc.removeAllForPhone).not.toHaveBeenCalled();
  });
});
