'use strict';

/**
 * platePreflight.test.js  (Phase 10.13A-15)
 *
 * ISOLATED — mocked pool, no globalSetup, no production DB. Tests the read-only
 * plate duplicate-preflight service that powers the check-plate endpoints and
 * the create-path 409 candidate list.
 */

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/database');
const { findPlateMatches } = require('../src/services/vehicleDedup.service');

const row = (plate_no, normalized_plate, vehicle_type = 'รถตู้', id = 'V-x') =>
  ({ id, plate_no, normalized_plate, vehicle_type });

beforeEach(() => jest.clearAllMocks());

describe('findPlateMatches — duplicate preflight', () => {
  test('1. CLEAR for a new valid plate (no matches)', async () => {
    pool.query.mockResolvedValue([[]]);
    const res = await findPlateMatches('ผก 9999 ลำปาง');
    expect(res.status).toBe('CLEAR');
    expect(res.candidates).toEqual([]);
  });

  test('2. EXACT candidate (plate_no identical)', async () => {
    pool.query.mockResolvedValue([[row('นข 4337 ลำปาง', 'นข4337ลำปาง')]]);
    const res = await findPlateMatches('นข4337 ลำปาง');
    expect(res.status).toBe('DUPLICATE_OR_SIMILAR');
    expect(res.candidates[0].duplicate_type).toBe('EXACT');
  });

  test('3. NORMALIZED candidate (spacing variant, same normalized)', async () => {
    pool.query.mockResolvedValue([[row('นข4337 ลำปาง', 'นข4337ลำปาง')]]);
    const res = await findPlateMatches('นข 4337 ลำปาง'); // extra space
    expect(res.candidates[0].duplicate_type).toBe('NORMALIZED');
  });

  test('4. province omitted is rejected before duplicate matching', async () => {
    pool.query.mockResolvedValue([[row('นข4337 ลำปาง', 'นข4337ลำปาง')]]);
    await expect(findPlateMatches('นข4337')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('5. different plate NUMBER is NOT flagged', async () => {
    pool.query.mockResolvedValue([[row('นข4338 ลำปาง', 'นข4338ลำปาง')]]);
    const res = await findPlateMatches('นข4337 ลำปาง');
    expect(res.status).toBe('CLEAR');
    expect(res.candidates).toEqual([]);
  });

  test('6. invalid/empty plate → 400 VALIDATION_ERROR', async () => {
    await expect(findPlateMatches('   ')).rejects.toMatchObject({ statusCode: 400 });
    try { await findPlateMatches('   '); } catch (e) { expect(e.errors?.[0]?.code).toBe('VALIDATION_ERROR'); }
  });

  test('7. candidate objects expose no sensitive fields (no phone/cid/hash)', async () => {
    pool.query.mockResolvedValue([[row('นข4337 ลำปาง', 'นข4337ลำปาง')]]);
    const res = await findPlateMatches('นข4337 ลำปาง');
    const keys = Object.keys(res.candidates[0]).sort();
    expect(keys).toEqual(['duplicate_type', 'normalized_plate', 'plate_no', 'vehicle_id', 'vehicle_type']);
    expect(JSON.stringify(res.candidates)).not.toMatch(/phone|cid|hash|password|token/i);
  });

  test('8. EXACT is ordered before any province-variant candidate returned by the DB filter', async () => {
    pool.query.mockResolvedValue([[
      row('นข4337', 'นข4337', 'รถตู้', 'V-a'),            // PROVINCE_VARIANT vs input
      row('นข 4337 ลำปาง', 'นข4337ลำปาง', 'รถตู้', 'V-b'),  // EXACT vs input
    ]]);
    const res = await findPlateMatches('นข4337 ลำปาง');
    expect(res.candidates[0].duplicate_type).toBe('EXACT');
  });
});
