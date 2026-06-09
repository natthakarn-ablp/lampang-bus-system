'use strict';

/**
 * transportVehicleDedup.test.js  (Phase 10.13A-14)
 *
 * ISOLATED — pool, audit, and auth are mocked, so this runs without globalSetup
 * and never touches the production DB. Exercises the real POST
 * /api/transport/vehicles handler: exact-normalized reuse is preserved, and
 * province-omitted/variant duplicates are now rejected (409) before any INSERT.
 */

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'transport' }; next(); },
}));

const express = require('express');
const request = require('supertest');

const { pool } = require('../src/config/database');
const transportRoutes = require('../src/routes/transport.routes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transport', transportRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}
const app = makeApp();

// Drive pool.query by SQL shape: exact-dup check, province-variant candidates, INSERT.
function setupPool({ exact = [], candidates = [] } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/normalized_plate = \? AND is_deleted = FALSE/.test(sql)) return [exact];          // exact dup check
    if (/LIKE CONCAT/.test(sql)) return [candidates];                                       // province-variant candidates
    if (/INSERT INTO vehicles/.test(sql)) return [{ insertId: 1, affectedRows: 1 }];        // create
    return [[]];
  });
}
const insertCalled = () => pool.query.mock.calls.some(([sql]) => /INSERT INTO vehicles/.test(sql));

beforeEach(() => jest.clearAllMocks());

describe('POST /api/transport/vehicles — province-variant duplicate guard', () => {
  test('1. province-OMITTED duplicate (active w/ province exists) → 409, no INSERT', async () => {
    setupPool({ exact: [], candidates: [{ plate_no: 'นข4337 ลำปาง', normalized_plate: 'นข4337ลำปาง' }] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'นข4337' });
    expect(res.status).toBe(409);
    expect(res.body.errors?.[0]?.code).toBe('DUPLICATE_OR_INCOMPLETE_PLATE');
    // Phase 10.13A-15 — 409 carries the conflicting plate(s) for the UI warning
    expect(res.body.errors[0].candidates?.[0]?.plate_no).toBe('นข4337 ลำปาง');
    expect(insertCalled()).toBe(false);
  });

  test('2. province-PRESENT duplicate (active w/o province exists) → 409', async () => {
    setupPool({ exact: [], candidates: [{ plate_no: 'นข4337', normalized_plate: 'นข4337' }] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'นข4337 ลำปาง' });
    expect(res.status).toBe(409);
    expect(res.body.errors?.[0]?.code).toBe('DUPLICATE_OR_INCOMPLETE_PLATE');
  });

  test('3. different plate NUMBER is NOT rejected → creates (201)', async () => {
    setupPool({ exact: [], candidates: [{ plate_no: 'นข4338 ลำปาง', normalized_plate: 'นข4338ลำปาง' }] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'นข4337 ลำปาง' });
    expect(res.status).toBe(201);
    expect(insertCalled()).toBe(true);
  });

  test('4. exact-normalized duplicate still REUSES existing (200, existed:true)', async () => {
    setupPool({ exact: [{ id: 'V-x', plate_no: 'นข4337 ลำปาง' }] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'นข 4337 ลำปาง' });
    expect(res.status).toBe(200);
    expect(res.body.data.existed).toBe(true);
    expect(insertCalled()).toBe(false);
  });

  test('5. valid new vehicle (no exact, no variant) → created (201)', async () => {
    setupPool({ exact: [], candidates: [] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'ผก 9999 ลำปาง', vehicle_type: 'รถตู้' });
    expect(res.status).toBe(201);
    expect(res.body.data.existed).toBe(false);
    expect(insertCalled()).toBe(true);
  });

  test('6. invalid/empty plate → 400 before any duplicate logic', async () => {
    setupPool({});
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: '   ' });
    expect(res.status).toBe(400);
    expect(insertCalled()).toBe(false);
  });

  test('7. 409 message leaks no PII (no hash/phone/token)', async () => {
    setupPool({ exact: [], candidates: [{ plate_no: 'นข4337 ลำปาง', normalized_plate: 'นข4337ลำปาง' }] });
    const res = await request(app).post('/api/transport/vehicles').send({ plate_no: 'นข4337' });
    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/\$2[aby]\$/);
    expect(blob).not.toMatch(/\d{10}/);
  });
});
