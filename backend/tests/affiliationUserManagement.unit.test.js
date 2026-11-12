'use strict';

/**
 * /api/affiliation/users — route wiring (DB-free). The scope itself is proven
 * against MySQL in affiliationUserManagement.test.js; here: the affiliation
 * always comes from the JWT, never from the request, and the service SQL
 * excludes grade-teacher accounts.
 */

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/services/affiliationUsers.service', () => ({
  listMainAccounts: jest.fn(),
  updateMainAccount: jest.fn(),
  resetMainPassword: jest.fn(),
  deleteMainAccount: jest.fn(),
  restoreMainAccount: jest.fn(),
}));
jest.mock('../src/services/affiliationAdmin.service', () => ({ createSchoolAccount: jest.fn() }));

const express = require('express');
const request = require('supertest');
const svc = require('../src/services/affiliationUsers.service');
const adminSvc = require('../src/services/affiliationAdmin.service');
const routes = require('../src/routes/affiliation.routes');

const app = express();
app.use(express.json());
app.use('/api/affiliation', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: 7, role: 'affiliation', scopeId: 'AFF1' };
  svc.listMainAccounts.mockResolvedValue([]);
  svc.updateMainAccount.mockResolvedValue({ id: 5 });
  svc.resetMainPassword.mockResolvedValue({ id: 5 });
  svc.deleteMainAccount.mockResolvedValue({ id: 5 });
  svc.restoreMainAccount.mockResolvedValue({ id: 5 });
  adminSvc.createSchoolAccount.mockResolvedValue({ id: 9 });
});

test('list: affiliation from the token; ?affiliation_id is ignored for non-admins', async () => {
  const res = await request(app).get('/api/affiliation/users?affiliation_id=OTHER&status=deleted');
  expect(res.status).toBe(200);
  expect(svc.listMainAccounts).toHaveBeenCalledWith(expect.anything(), 'AFF1', { status: 'deleted' });
});

test('unknown status falls back to active', async () => {
  await request(app).get('/api/affiliation/users?status=everything');
  expect(svc.listMainAccounts).toHaveBeenCalledWith(expect.anything(), 'AFF1', { status: 'active' });
});

test.each([
  ['put', '/api/affiliation/users/5', { display_name: 'x', affiliation_id: 'OTHER' }, 'updateMainAccount'],
  ['post', '/api/affiliation/users/5/reset-password', { password: 'Strong#Pass2569x', affiliation_id: 'OTHER' }, 'resetMainPassword'],
  ['delete', '/api/affiliation/users/5', {}, 'deleteMainAccount'],
  ['post', '/api/affiliation/users/5/restore', {}, 'restoreMainAccount'],
])('%s %s passes the token affiliation and the actor', async (method, url, body, fn) => {
  const res = await request(app)[method](url).send(body);
  expect(res.status).toBe(200);
  expect(svc[fn]).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    affiliationId: 'AFF1', accountId: 5, actorId: 7,
  }));
});

test('reset without a password is 400 and never reaches the service', async () => {
  const res = await request(app).post('/api/affiliation/users/5/reset-password').send({});
  expect(res.status).toBe(400);
  expect(svc.resetMainPassword).not.toHaveBeenCalled();
});

test('non-numeric id is rejected before the service', async () => {
  const res = await request(app).delete('/api/affiliation/users/abc');
  expect(res.status).toBe(400);
  expect(svc.deleteMainAccount).not.toHaveBeenCalled();
});

test('create uses the token affiliation', async () => {
  const res = await request(app).post('/api/affiliation/users').send({ school_id: '100001', username: '100001', affiliation_id: 'OTHER' });
  expect(res.status).toBe(201);
  expect(adminSvc.createSchoolAccount).toHaveBeenCalledWith(expect.objectContaining({ affiliationId: 'AFF1', schoolId: '100001' }));
});

test('an account without an affiliation scope gets 403', async () => {
  mockUser = { id: 7, role: 'affiliation', scopeId: null };
  expect((await request(app).get('/api/affiliation/users')).status).toBe(403);
});

test('service scope SQL excludes grade-teacher accounts', () => {
  const real = jest.requireActual('../src/services/affiliationUsers.service');
  expect(real._MAIN_ACCOUNT_SQL).toMatch(/grade_scope IS NULL/);
  expect(real._MAIN_ACCOUNT_SQL).toMatch(/u\.role = 'school'/);
});
