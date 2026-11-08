'use strict';

// P-09 (parent audit 2026-11-08, owner-approved): parent history is at most
// 30 days and never earlier than the day the LINE account was bound.
jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/line.service');
jest.mock('../src/services/parentConsentGate', () => ({
  guardParentView: jest.fn().mockResolvedValue({ allowed: true }),
  applyChildListGate: jest.fn((children) => ({ children })),
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const { pool } = require('../src/config/database');
const parentRoutes = require('../src/routes/parent.routes');

const app = express();
app.use(express.json());
app.use('/api/parent', parentRoutes);

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue([[]]);
  idTokenSvc.verifyIdToken.mockResolvedValue({ valid: true, userId: 'U_parent' });
  lineSvc.getLinkedChildren.mockResolvedValue([{ id: 101, first_name: 'ก' }]);
});

const historyCall = () => pool.query.mock.calls.find(c => /FROM checkin_logs/.test(c[0]));

test('?days=90 is clamped to 30', async () => {
  const res = await request(app).get('/api/parent/children/101/history?days=90').set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
  expect(historyCall()[1][1]).toBe(30);
});

test('history never starts before the bind day of THIS LINE account', async () => {
  await request(app).get('/api/parent/children/101/history').set('Authorization', 'Bearer t');
  const [sql, params] = historyCall();
  expect(sql).toMatch(/DATE\(lb\.bound_at\)/);
  expect(sql).toMatch(/lb\.line_user_id = \? AND lb\.is_active = TRUE/);
  expect(params).toEqual([101, 7, 'U_parent']);
});
