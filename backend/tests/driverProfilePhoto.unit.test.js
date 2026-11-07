'use strict';

/**
 * DRV-T03 — the driver's profile photo is stored as /uploads/drivers/<file>, but
 * /uploads is blocked (404) by design, so the photo could never be displayed.
 * An authenticated GET /api/driver/profile/photo must serve the driver's OWN
 * photo (and nothing else).
 */

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 7, role: 'driver' }; next(); },
}));
jest.mock('../src/middleware/roleGuard', () => ({ requireRole: () => (_req, _res, next) => next() }));
jest.mock('../src/services/checkin.service', () => ({
  getDriverVehicle: jest.fn().mockResolvedValue({ vehicle_id: 'V-1' }),
}));

const router = require('../src/routes/driver.routes');
const uploadDir = path.join(__dirname, '../uploads/drivers');
const fileName = `7-drvt03-${process.pid}.png`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function app() {
  const a = express();
  a.use('/api/driver', router);
  return a;
}

beforeAll(() => { fs.mkdirSync(uploadDir, { recursive: true }); fs.writeFileSync(path.join(uploadDir, fileName), PNG); });
afterAll(() => { try { fs.unlinkSync(path.join(uploadDir, fileName)); } catch { /* ignore */ } });
beforeEach(() => mockQuery.mockReset());

describe('GET /api/driver/profile/photo', () => {
  test('serves the driver\'s own stored photo as an image', async () => {
    mockQuery.mockResolvedValueOnce([[{ photo_url: `/uploads/drivers/${fileName}` }]]);
    const res = await request(app()).get('/api/driver/profile/photo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('404 when the driver has no photo', async () => {
    mockQuery.mockResolvedValueOnce([[{ photo_url: null }]]);
    const res = await request(app()).get('/api/driver/profile/photo');
    expect(res.status).toBe(404);
  });

  test('never escapes the drivers upload dir', async () => {
    mockQuery.mockResolvedValueOnce([[{ photo_url: '/uploads/drivers/../imports/secret.csv' }]]);
    const res = await request(app()).get('/api/driver/profile/photo');
    expect(res.status).toBe(404);
  });
});
