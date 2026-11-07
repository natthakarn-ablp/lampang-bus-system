'use strict';

/**
 * swt-07 / SEED-F1 (live QA 2026-11) — an auto-created driver login must get a
 * random initial password, never the licence plate painted on the bus, and the
 * school must receive that password once in the POST /school/vehicles response.
 */

require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: null };
    next();
  },
}));
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn(), getConnection: (...args) => mockGetConnection(...args) },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/vehicleDedup.service', () => ({
  annotateVehicleList: rows => rows,
  classifyPlateAgainstDb: jest.fn().mockResolvedValue({ code: 'VALID_NEW_VEHICLE' }),
}));

const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const { validatePassword } = require('../src/utils/passwordPolicy');
const { generateTemporaryPassword, linkOrCreateDriverForVehicle } = require('../src/services/driverProfile.service');

function makeConn() {
  const query = jest.fn(async (sql) => {
    if (/INSERT INTO drivers/.test(sql)) return [{ insertId: 900 }];
    if (/^\s*INSERT|^\s*UPDATE/.test(sql)) return [{ affectedRows: 1, insertId: 1 }];
    return [[]];
  });
  return {
    query,
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
  };
}
const userInsert = (conn) => conn.query.mock.calls.find(([sql]) => /INSERT INTO users/.test(sql));

describe('generateTemporaryPassword', () => {
  test('is 8 characters, mixes letters and digits, and passes the password policy', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[a-z2-9]{8}$/);
      expect(pw).toMatch(/[a-z].*[a-z]/);
      expect(pw).toMatch(/[2-9].*[2-9]/);
      expect(pw).not.toMatch(/[01ilo]/);
      expect(validatePassword(pw, { username: 'นข 9999 ลำปาง' }).ok).toBe(true);
    }
  });

  test('is not predictable between calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe('linkOrCreateDriverForVehicle — initial password', () => {
  const BASE = { driverName: 'นายทดสอบ', driverPhone: '', normalizedPlate: 'นข9999ลำปาง', plateNo: 'นข 9999 ลำปาง', vehicleId: 'V-1' };

  test('a new login is hashed from the random password, not the plate', async () => {
    const conn = makeConn();
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(res.userCreated).toBe(true);
    expect(res.temporaryPassword).not.toBe(BASE.plateNo);
    const [, params] = userInsert(conn);
    const hash = params[1];
    expect(await bcrypt.compare(res.temporaryPassword, hash)).toBe(true);
    expect(await bcrypt.compare(BASE.plateNo, hash)).toBe(false);
    expect(params).not.toContain(res.temporaryPassword); // plaintext never reaches SQL
  });
});

describe('POST /school/vehicles — driver credentials shown once', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/school', require('../src/routes/school.routes'));
  app.use(require('../src/middleware/errorHandler'));

  test('returns the plate as username and the random password, never the plate as password', async () => {
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const res = await request(app).post('/api/school/vehicles').send({
      plate_prefix: 'นข', plate_number: '9999', plate_province: 'ลำปาง', vehicle_type: 'รถตู้',
      driver_name: 'นายทดสอบ',
    });
    expect(res.status).toBe(201);
    const creds = res.body.data.driver_credentials;
    expect(creds.username).toBe('นข 9999 ลำปาง');
    expect(creds.temporary_password).toMatch(/^[a-z2-9]{8}$/);
    expect(creds.temporary_password).not.toBe(creds.username);
    const [, params] = userInsert(conn);
    expect(await bcrypt.compare(creds.temporary_password, params[1])).toBe(true);
    // the audit entry must not carry the plaintext password
    const { logAudit } = require('../src/utils/audit');
    expect(JSON.stringify(logAudit.mock.calls)).not.toContain(creds.temporary_password);
  });
});
