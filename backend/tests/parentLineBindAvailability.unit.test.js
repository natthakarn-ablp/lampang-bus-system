'use strict';

jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/lineBindGuard', () => ({
  keysFor: jest.fn(() => ({ pair: 'synthetic-pair', sub: 'synthetic-sub' })),
  checkLock: jest.fn().mockResolvedValue({ locked: false }),
  noteFailure: jest.fn(),
  noteSuccess: jest.fn(),
}));
jest.mock('../src/services/line.service', () => ({
  auditBind: jest.fn().mockResolvedValue(),
  getLinkedParentId: jest.fn(),
  findLinkableParent: jest.fn(),
  commitLineLink: jest.fn(),
  LineBindConflictError: class LineBindConflictError extends Error {},
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const idTokenSvc = require('../src/services/lineIdToken.service');
const parentRoutes = require('../src/routes/parent.routes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent', parentRoutes);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }));
  return app;
}

const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  idTokenSvc.verifyIdToken.mockResolvedValue({ valid: false, error: 'timeout' });
});

test.each([
  '/api/parent/line/bind-preview',
  '/api/parent/line/bind-confirm',
])('%s returns 503 when LINE verification is temporarily unavailable', async (path) => {
  const response = await request(app).post(path).send({
    idToken: 'synthetic-token',
    phone: '0812345678',
    student_code: 'SYNTHETIC-STUDENT',
  });

  expect(response.status).toBe(503);
  expect(response.body.errors).toContainEqual({ code: 'LINE_VERIFY_UNAVAILABLE' });
  expect(idTokenSvc.verifyIdToken).toHaveBeenCalledWith('synthetic-token');
});

test.each([
  '/api/parent/line/bind-preview',
  '/api/parent/line/bind-confirm',
])('%s keeps an ordinary invalid token at 401', async (path) => {
  idTokenSvc.verifyIdToken.mockResolvedValueOnce({ valid: false, error: 'invalid_token' });
  const response = await request(app).post(path).send({
    idToken: 'synthetic-token',
    phone: '0812345678',
    student_code: 'SYNTHETIC-STUDENT',
  });

  expect(response.status).toBe(401);
  expect(response.body.errors).not.toContainEqual({ code: 'LINE_VERIFY_UNAVAILABLE' });
});
