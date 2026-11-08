'use strict';

// SCH-VEH-3 (owner decision 2026-11-08): insurance of a shared vehicle is kept
// by the vehicle owner/driver; a school PUT carrying insurance is refused.
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/config/database', () => {
  const q = async () => { throw Object.assign(new Error('DB must not be reached'), { code: 'ER_TEST' }); };
  return { pool: { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, rollback: async () => {}, release: () => {} }) } };
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

test.each([
  { insurance_expiry: '2030-01-01' }, { insurance_status: 'มีประกัน' }, { insurance_type: 'ชั้น 1', owner_name: 'x' },
])('school PUT with insurance %j → 403 before any DB work', async (body) => {
  mockUser = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: null };
  const res = await request(app).put('/api/school/vehicles/V1').send(body);
  expect(res.status).toBe(403);
  expect(res.body.errors).toEqual([{ code: 'INSURANCE_OWNER_ONLY' }]);
});
