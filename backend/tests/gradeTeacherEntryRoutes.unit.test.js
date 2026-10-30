'use strict';

require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: req.headers['x-full-school'] ? null : 'ป.4' };
    next();
  },
}));
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...args) => mockQuery(...args), getConnection: (...args) => mockGetConnection(...args) } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/vehicleDedup.service', () => ({
  annotateVehicleList: rows => rows,
  classifyPlateAgainstDb: jest.fn().mockResolvedValue({ code: 'VALID_NEW_VEHICLE' }),
}));

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

beforeEach(() => { mockQuery.mockReset(); mockGetConnection.mockReset(); });

test('teacher cannot move a student in another grade; no vehicle lookup or update follows', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 12, grade: 'ป.5', vehicle_id: null }]]);
  const res = await request(app).post('/api/school/students/move').send({ student_id: 12, vehicle_id: 'V-1' });
  expect(res.status).toBe(404);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][1]).toEqual([12, 'SCH1']);
});

test('teacher can assign an own-grade student to an existing vehicle', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 12, grade: 'ประถมศึกษาปีที่ ๔', vehicle_id: null }]])
    .mockResolvedValueOnce([[{ id: 'V-1' }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }]);
  const res = await request(app).post('/api/school/students/move').send({ student_id: 12, vehicle_id: 'V-1' });
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[2]).toEqual([expect.stringContaining('UPDATE students SET vehicle_id'), ['V-1', 12, 'SCH1', 'ประถมศึกษาปีที่ ๔']]);
});

test('teacher cannot set driver or owner data while registering a vehicle', async () => {
  for (const field of ['driver_name', 'driver_phone', 'owner_name']) {
    const res = await request(app).post('/api/school/vehicles').send({ plate_no: 'นข 1234 ลำปาง', [field]: 'test' });
    expect(res.status).toBe(403);
  }
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockGetConnection).not.toHaveBeenCalled();
});

test('teacher can register a new plate without creating a driver account', async () => {
  const connQuery = jest.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([{}]);
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), query: connQuery };
  mockGetConnection.mockResolvedValue(conn);
  const res = await request(app).post('/api/school/vehicles').send({
    plate_prefix: 'นข', plate_number: '1234', plate_province: 'ลำปาง', vehicle_type: 'รถตู้',
  });
  expect(res.status).toBe(201);
  expect(res.body.data).not.toHaveProperty('driver_credentials');
  expect(connQuery.mock.calls[1][0]).toContain('INSERT INTO vehicles');
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test('vehicle dropdown is available to teacher without owner data', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 'V-1', plate_no: 'นข 1234 ลำปาง', vehicle_type: 'รถตู้', active_students: 1 }]]);
  const res = await request(app).get('/api/school/vehicles/all');
  expect(res.status).toBe(200);
  expect(res.body.data[0]).not.toHaveProperty('owner_name');
});
