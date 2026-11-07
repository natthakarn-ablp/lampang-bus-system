'use strict';

/**
 * DRV-PROFILE-FORMS-02 — PUT /driver/profile must validate on the server what the
 * form validates in the browser: non-empty name, 9-10 digit phones, bounded lengths
 * matching the DB columns, and a real YYYY-MM-DD insurance expiry.
 */
require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 5, role: 'driver', username: 'นข 1 ลำปาง', driver_id: 3 };
    next();
  },
}));
const mockConn = {
  query: jest.fn(async () => [{ affectedRows: 1 }]),
  beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
};
jest.mock('../src/config/database', () => ({
  pool: {
    query: jest.fn(async () => [[{ driver_id: 3 }]]),
    getConnection: jest.fn(async () => mockConn),
  },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/checkin.service', () => ({
  ...jest.requireActual('../src/services/checkin.service'),
  getDriverVehicle: jest.fn(async () => ({ vehicle_id: 'V-1' })),
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const router = require('../src/routes/driver.routes');

const app = express();
app.use(express.json());
app.use('/api/driver', router);
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));

const put = (body) => request(app).put('/api/driver/profile').send(body);

beforeEach(() => { pool.getConnection.mockClear(); mockConn.query.mockClear(); });

describe('PUT /driver/profile validation', () => {
  test.each([
    ['blank name', { name: '   ' }, 'name'],
    ['non-string name', { name: null }, 'name'],
    ['name over 100 chars', { name: 'ก'.repeat(101) }, 'name'],
    ['non-numeric phone', { phone: '081-234-5678' }, 'phone'],
    ['too-long phone', { owner_phone: '0812345678901' }, 'owner_phone'],
    ['bad attendant phone', { attendant_phone: 'abc' }, 'attendant_phone'],
    ['vehicle_type over 50', { vehicle_type: 'x'.repeat(51) }, 'vehicle_type'],
    ['insurance_status over 50', { insurance_status: 'x'.repeat(51) }, 'insurance_status'],
    ['malformed expiry', { insurance_expiry: '31/12/2026' }, 'insurance_expiry'],
    ['impossible expiry date', { insurance_expiry: '2026-02-31' }, 'insurance_expiry'],
  ])('%s -> 400 naming the field', async (_n, body, field) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.map(e => e.field)).toContain(field);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('valid payload is accepted and values are trimmed', async () => {
    const res = await put({ name: '  สมชาย ใจดี ', phone: '0812345678', insurance_expiry: '2026-12-31', owner_phone: '' });
    expect(res.status).toBe(200);
    const upd = mockConn.query.mock.calls.find(([sql]) => /UPDATE drivers/.test(sql));
    expect(upd[1][0]).toBe('สมชาย ใจดี');
  });
});
