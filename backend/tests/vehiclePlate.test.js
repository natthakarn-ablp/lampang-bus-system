'use strict';

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');
const { normalizePlate, validatePlateNo } = require('../src/utils/vehiclePlate');

// All bulk-test plates share this prefix so afterAll can clean them up safely
// without touching real production rows.
const TEST_PLATE_PREFIX = '__TEST DUP';

const SCHOOL = { username: '__test_school', password: 'testpass123' };
let schoolToken = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  schoolToken = await login(SCHOOL);
});

afterAll(async () => {
  // Guarded via getTestConnection() (issue #8).
  const conn = await getTestConnection();
  await conn.query(
    `DELETE FROM driver_vehicle_assignments
     WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate_no LIKE ?)`,
    [`${TEST_PLATE_PREFIX}%`]
  ).catch(() => {});
  await conn.query(`DELETE FROM users WHERE username LIKE ?`, [`${TEST_PLATE_PREFIX}%`]).catch(() => {});
  await conn.query(`DELETE FROM vehicles WHERE plate_no LIKE ?`, [`${TEST_PLATE_PREFIX}%`]).catch(() => {});
  await conn.end();
});

// ─── Unit tests — normalizePlate ────────────────────────────────────────────

describe('normalizePlate helper', () => {
  test('strips ASCII spaces', () => {
    expect(normalizePlate('1 นค 1589 กรุงเทพมหานคร')).toBe('1นค1589กรุงเทพมหานคร');
  });

  test('idempotent on already-normalized input', () => {
    expect(normalizePlate('1นค1589กรุงเทพมหานคร')).toBe('1นค1589กรุงเทพมหานคร');
  });

  test('strips ASCII hyphens', () => {
    expect(normalizePlate('1-นค-1589 กรุงเทพมหานคร')).toBe('1นค1589กรุงเทพมหานคร');
  });

  test('strips leading/trailing whitespace', () => {
    expect(normalizePlate(' นข 8139 ลำปาง ')).toBe('นข8139ลำปาง');
  });

  test('lowercases ASCII letters', () => {
    expect(normalizePlate('NX-2210 LP')).toBe('nx2210lp');
  });

  test('strips non-breaking space (U+00A0) and en dash (U+2013)', () => {
    expect(normalizePlate('นข 8139–ลำปาง')).toBe('นข8139ลำปาง');
  });

  test('strips ideographic space (U+3000) and em dash (U+2014)', () => {
    expect(normalizePlate('นข　8139—ลำปาง')).toBe('นข8139ลำปาง');
  });

  test('non-string input returns empty string', () => {
    expect(normalizePlate(null)).toBe('');
    expect(normalizePlate(undefined)).toBe('');
    expect(normalizePlate(12345)).toBe('');
  });

  test('empty / whitespace-only input returns empty string', () => {
    expect(normalizePlate('')).toBe('');
    expect(normalizePlate('   ')).toBe('');
    expect(normalizePlate(' 　\t')).toBe('');
  });
});

// ─── Unit tests — validatePlateNo ───────────────────────────────────────────

describe('validatePlateNo helper', () => {
  test('returns valid for non-empty plate', () => {
    const r = validatePlateNo(' นข 8139 ลำปาง ');
    expect(r.valid).toBe(true);
    expect(r.trimmed).toBe('นข 8139 ลำปาง');
    expect(r.normalized).toBe('นข8139ลำปาง');
  });

  test('rejects empty string', () => {
    expect(validatePlateNo('')).toEqual({ valid: false, error: 'กรุณาระบุทะเบียนรถ' });
  });

  test('rejects whitespace-only string', () => {
    expect(validatePlateNo('   ')).toEqual({ valid: false, error: 'กรุณาระบุทะเบียนรถ' });
  });

  test('rejects non-string input', () => {
    expect(validatePlateNo(null).valid).toBe(false);
    expect(validatePlateNo(undefined).valid).toBe(false);
    expect(validatePlateNo(123).valid).toBe(false);
  });
});

// ─── Integration tests — duplicate prevention through POST /api/school/vehicles
// All variants below collide on normalized_plate.

describe('Vehicle duplicate prevention (POST /api/school/vehicles)', () => {
  const PLATE = `${TEST_PLATE_PREFIX} 0001`;          // canonical
  const VARIANT_SPACING = `${TEST_PLATE_PREFIX}0001`; // no spaces
  const VARIANT_HYPHEN  = `${TEST_PLATE_PREFIX}-0001`; // hyphenated

  // The school POST endpoint returns 201 for BOTH create and reuse paths —
  // the dedup signal is the vehicle_id staying constant across variants,
  // not the HTTP status. We capture canonicalId from the first call and
  // assert every spelling variant maps back to the same row.
  let canonicalId = null;

  test('first insert creates a vehicle row', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: PLATE, vehicle_type: 'รถตู้' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('vehicle_id');
    canonicalId = res.body.data.vehicle_id;
  });

  test('exact-duplicate plate reuses the same vehicle row', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: PLATE, vehicle_type: 'รถตู้' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicle_id).toBe(canonicalId);
  });

  test('spacing variant collapses to the same vehicle row', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: VARIANT_SPACING, vehicle_type: 'รถตู้' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicle_id).toBe(canonicalId);
  });

  test('hyphen variant collapses to the same vehicle row', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: VARIANT_HYPHEN, vehicle_type: 'รถตู้' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicle_id).toBe(canonicalId);
  });

  test('empty plate is rejected with Thai message', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: '   ', vehicle_type: 'รถตู้' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('ทะเบียนรถ');
  });

  test('missing plate is rejected with Thai message', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ vehicle_type: 'รถตู้' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('ทะเบียนรถ');
  });
});
