'use strict';

/**
 * transportInspectionHardening.unit.test.js
 *
 * Covers the security hardening of the legacy transport-inspection write path:
 *  - validateInspectionDates (pure): expiry/inspection-date bounds (F3)
 *  - createInspection: date validation, vehicle-exists guard, atomic txn (F1)
 *  - updateInspection: 404, inspector ownership + admin override, no silent
 *    no-op, date validation, atomic txn (F2)
 *
 * DB-free — mock pool in the same style as vehicleRegistrationService.unit.test.js.
 * refreshVehicleEligibility is mocked so these tests exercise only the write
 * path, not the (separately tested) eligibility recompute.
 */

jest.mock('../src/services/vehicleVerification.service', () => ({
  refreshVehicleEligibility: jest.fn().mockResolvedValue({ status: 'ELIGIBLE', reasons: [] }),
}));

const svc = require('../src/services/transport.service');
const { refreshVehicleEligibility } = require('../src/services/vehicleVerification.service');
const { validateInspectionDates, bangkokToday } = require('../src/utils/inspectionDates');

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const TODAY = bangkokToday();

// Ordered [regex, response] pairs. First match wins. Default = empty rows.
function mockDb(pairs = []) {
  const run = jest.fn(async (sql) => {
    for (const [re, resp] of pairs) {
      if (re.test(sql)) return typeof resp === 'function' ? resp(sql) : resp;
    }
    return [[]];
  });
  const conn = {
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(() => {}),
    query: run,
  };
  const db = { getConnection: jest.fn(async () => conn), query: run };
  return { db, conn, run };
}

beforeEach(() => refreshVehicleEligibility.mockClear());

// ── validateInspectionDates (pure) ──────────────────────────────────────────
describe('validateInspectionDates', () => {
  const T = '2026-06-15';

  test('valid PASSED with in-window expiry → null', () => {
    expect(validateInspectionDates({
      result: 'PASSED', inspectionDate: '2026-06-10', expiryDate: '2027-06-10', today: T,
    })).toBeNull();
  });

  test('valid non-PASS with null expiry → null', () => {
    expect(validateInspectionDates({
      result: 'NEEDS_FIX', inspectionDate: '2026-06-10', expiryDate: null, today: T,
    })).toBeNull();
  });

  test('PASSED without expiry → EXPIRY_DATE_REQUIRED', () => {
    expect(validateInspectionDates({
      result: 'PASSED', inspectionDate: '2026-06-10', today: T,
    })).toMatchObject({ code: 'EXPIRY_DATE_REQUIRED' });
  });

  test('future inspection date → INSPECTION_DATE_IN_FUTURE', () => {
    expect(validateInspectionDates({
      result: 'FAILED', inspectionDate: '2026-06-16', today: T,
    })).toMatchObject({ code: 'INSPECTION_DATE_IN_FUTURE' });
  });

  test('inspection date > 1yr old → INSPECTION_DATE_TOO_OLD', () => {
    expect(validateInspectionDates({
      result: 'FAILED', inspectionDate: '2025-06-10', today: T,
    })).toMatchObject({ code: 'INSPECTION_DATE_TOO_OLD' });
  });

  test('expiry on/before inspection → EXPIRY_BEFORE_INSPECTION', () => {
    expect(validateInspectionDates({
      result: 'PASSED', inspectionDate: '2026-06-10', expiryDate: '2026-06-10', today: T,
    })).toMatchObject({ code: 'EXPIRY_BEFORE_INSPECTION' });
  });

  test('expiry > 2yr after inspection (the year-2099 abuse) → EXPIRY_TOO_FAR', () => {
    expect(validateInspectionDates({
      result: 'PASSED', inspectionDate: '2026-06-10', expiryDate: '2099-12-31', today: T,
    })).toMatchObject({ code: 'EXPIRY_TOO_FAR' });
  });

  test('malformed inspection date → INSPECTION_DATE_INVALID', () => {
    expect(validateInspectionDates({
      result: 'FAILED', inspectionDate: '10/06/2026', today: T,
    })).toMatchObject({ code: 'INSPECTION_DATE_INVALID' });
  });

  test('malformed expiry date → EXPIRY_DATE_INVALID', () => {
    expect(validateInspectionDates({
      result: 'PASSED', inspectionDate: '2026-06-10', expiryDate: 'soon', today: T,
    })).toMatchObject({ code: 'EXPIRY_DATE_INVALID' });
  });
});

// ── createInspection (F1 + F3) ──────────────────────────────────────────────
describe('createInspection', () => {
  const base = { vehicleId: 'V1', result: 'PASSED', userId: 5 };

  test('PASSED without expiry → 400 before any transaction opens', async () => {
    const { db } = mockDb();
    await expect(svc.createInspection({ ...base, inspectionDate: TODAY }, db))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'EXPIRY_DATE_REQUIRED' }] });
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('far-future expiry → 400 EXPIRY_TOO_FAR', async () => {
    const { db } = mockDb();
    await expect(svc.createInspection({
      ...base, inspectionDate: TODAY, expiryDate: '2099-12-31',
    }, db)).rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'EXPIRY_TOO_FAR' }] });
  });

  test('vehicle not found → 404 + rollback, no insert', async () => {
    const { db, conn, run } = mockDb([
      [/FROM vehicles WHERE id = \? AND is_deleted = FALSE FOR UPDATE/, [[]]],
    ]);
    await expect(svc.createInspection({
      ...base, inspectionDate: TODAY, expiryDate: addDays(TODAY, 300),
    }, db)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'VEHICLE_NOT_FOUND' }] });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(run.mock.calls.some(([sql]) => /INSERT INTO vehicle_inspections/.test(sql))).toBe(false);
    expect(refreshVehicleEligibility).not.toHaveBeenCalled();
  });

  test('happy path → insert + refresh eligibility + commit, returns insertId', async () => {
    const { db, conn, run } = mockDb([
      [/FROM vehicles WHERE id = \? AND is_deleted = FALSE FOR UPDATE/, [[{ id: 'V1' }]]],
      [/INSERT INTO vehicle_inspections/, [{ insertId: 42 }]],
    ]);
    const id = await svc.createInspection({
      ...base, inspectionDate: TODAY, expiryDate: addDays(TODAY, 300),
    }, db);
    expect(id).toBe(42);
    expect(refreshVehicleEligibility).toHaveBeenCalledWith(conn, 'V1');
    expect(conn.commit).toHaveBeenCalled();
    expect(run.mock.calls.some(([sql]) => /INSERT INTO audit_logs/.test(sql))).toBe(true);
  });
});

// ── updateInspection (F2 + F3) ──────────────────────────────────────────────
describe('updateInspection', () => {
  const row = {
    id: 7, vehicle_id: 'V1', inspected_by: 5, result: 'PENDING', notes: null,
    inspection_date: TODAY, expiry_date: null,
  };
  const selRe = /FROM vehicle_inspections WHERE id = \? FOR UPDATE/;

  test('missing inspection → 404 (no silent no-op)', async () => {
    const { db } = mockDb([[selRe, [[]]]]);
    await expect(svc.updateInspection({
      inspectionId: 7, result: 'FAILED', userId: 5,
    }, db)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'INSPECTION_NOT_FOUND' }] });
  });

  test('non-owner, non-admin → 403 + rollback, no update/audit', async () => {
    const { db, conn, run } = mockDb([[selRe, [[{ ...row, inspected_by: 99 }]]]]);
    await expect(svc.updateInspection({
      inspectionId: 7, result: 'FAILED', userId: 5, isAdmin: false,
    }, db)).rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'NOT_INSPECTION_OWNER' }] });
    expect(conn.rollback).toHaveBeenCalled();
    expect(run.mock.calls.some(([sql]) => /UPDATE vehicle_inspections SET/.test(sql))).toBe(false);
    expect(run.mock.calls.some(([sql]) => /INSERT INTO audit_logs/.test(sql))).toBe(false);
  });

  test('admin overrides ownership → succeeds', async () => {
    const { db, conn } = mockDb([[selRe, [[{ ...row, inspected_by: 99 }]]]]);
    await svc.updateInspection({
      inspectionId: 7, result: 'FAILED', userId: 1, isAdmin: true,
    }, db);
    expect(conn.commit).toHaveBeenCalled();
    expect(refreshVehicleEligibility).toHaveBeenCalledWith(conn, 'V1');
  });

  test('owner sets PASSED with bad expiry → 400 EXPIRY_BEFORE_INSPECTION', async () => {
    const { db } = mockDb([[selRe, [[row]]]]);
    await expect(svc.updateInspection({
      inspectionId: 7, result: 'PASSED', expiryDate: addDays(TODAY, -1), userId: 5,
    }, db)).rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'EXPIRY_BEFORE_INSPECTION' }] });
  });

  test('owner happy path → update + audit + refresh + commit', async () => {
    const { db, conn, run } = mockDb([[selRe, [[row]]]]);
    await svc.updateInspection({
      inspectionId: 7, result: 'PASSED', expiryDate: addDays(TODAY, 300), notes: 'ok', userId: 5,
    }, db);
    expect(run.mock.calls.some(([sql]) => /UPDATE vehicle_inspections SET/.test(sql))).toBe(true);
    expect(run.mock.calls.some(([sql]) => /INSERT INTO audit_logs/.test(sql))).toBe(true);
    expect(refreshVehicleEligibility).toHaveBeenCalledWith(conn, 'V1');
    expect(conn.commit).toHaveBeenCalled();
  });
});
