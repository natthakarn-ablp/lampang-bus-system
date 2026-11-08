'use strict';

// SCH-VEH-2b (school audit 2026-11-08): POST /api/school/vehicles with the
// plate of a SOFT-DELETED vehicle must not silently reuse (revive) that row; the
// plate classifier answers 409 so the school files a restore request instead.
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/vehicleDedup.service', () => ({
  classifyPlateAgainstDb: jest.fn().mockResolvedValue({
    code: 'SOFT_DELETED_VEHICLE', message: 'รถคันนี้ถูกลบไปแล้ว กรุณายื่นคำขอกู้คืน', vehicle_id: 'V-old', is_deleted: true,
  }),
}));

const mockStatements = [];
function mockHandle(sql) {
  mockStatements.push(sql);
  // The deleted row matches the plate; only an is_deleted-aware lookup skips it.
  if (/SELECT id FROM vehicles WHERE normalized_plate = \?/.test(sql)) {
    return [/is_deleted = FALSE/.test(sql) ? [] : [{ id: 'V-old' }]];
  }
  if (/^\s*SELECT/i.test(sql)) return [[]];
  return [{ affectedRows: 1, insertId: 1 }];
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
app.use(require('../src/middleware/errorHandler'));

test('soft-deleted plate: 409 from the classifier, the deleted row is never touched', async () => {
  mockUser = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: null };
  const res = await request(app).post('/api/school/vehicles')
    .send({ plate_prefix: 'นข', plate_number: '9999', plate_province: 'ลำปาง', vehicle_type: 'รถตู้' });
  expect(res.status).toBe(409);
  expect(mockStatements.some(s => /UPDATE vehicles/.test(s) || /INSERT INTO driver_vehicle_assignments/.test(s))).toBe(false);
});
