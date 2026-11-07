'use strict';

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/services/affiliationAdmin.service', () => ({ toggleSchoolAccount: jest.fn() }));

const express = require('express');
const request = require('supertest');
const svc = require('../src/services/affiliationAdmin.service');
const routes = require('../src/routes/affiliation.routes');

const instance = express();
instance.use(express.json());
instance.use('/api/affiliation', routes);
instance.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false }));

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: 1, role: 'affiliation', scopeId: 'AFF1' };
  svc.toggleSchoolAccount.mockResolvedValue({ id: 5, is_active: true });
});

const put = (body) => request(instance).put('/api/affiliation/school-accounts/5').send(body);

test('boolean is_active is accepted', async () => {
  expect((await put({ is_active: false })).status).toBe(200);
  expect(svc.toggleSchoolAccount).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
});

test.each([[{}], [{ is_active: 'abc' }], [{ is_active: 1 }], [{ is_active: null }]])(
  'missing or non-boolean is_active %j is a 400 and never reaches the service', async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(svc.toggleSchoolAccount).not.toHaveBeenCalled();
  });
