'use strict';

/**
 * qrAccess.test.js — Phase QR-1
 * Server-side level resolution + per-level field isolation (the core PDPA
 * guarantee: a lower level can never receive higher-level fields), token lookup,
 * and the mandatory Level-3 sensitive-access audit.
 */
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/config/env', () => ({ features: { qrLevel3: true, qrEmergencyContactSource: 'driver' } }));

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const qr = require('../src/services/qrAccess.service');

// Dispatch pool.query by SQL fragment. Each return is the mysql2 [rows] shape.
function db(over = {}) {
  const cfg = {
    vehicle: [{
      id: 'V-1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'รถตู้', insurance_status: 'active',
      insurance_expiry: '2099-12-31', registration_expiry: '2099-12-31',
      compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
      verification_status: 'ELIGIBLE', is_deleted: 0,
    }],
    parentLinked: [],
    driver: [{ id: 7, name: 'สมชาย ใจดี', phone: '0812345678' }],
    displayStatus: [{ display_status: 'normal' }],
    inspection: [{ result: 'PASSED', expiry_date: null }],
    sharedInspection: [],
    attendant: [],
    risk: [{ id: 1, record_type: 'complaint', severity: 'low', description: 'x', occurred_on: '2026-01-01' }],
    ...over,
  };
  pool.query.mockImplementation(async (sql) => {
    if (/qr_token = \?/.test(sql)) return [cfg.vehicle];
    if (/FROM line_bindings lb/.test(sql)) return [cfg.parentLinked];
    if (/FROM drivers d\s+JOIN driver_vehicle_assignments/.test(sql)) return [cfg.driver];
    if (/FROM driver_display_status/.test(sql)) return [cfg.displayStatus];
    if (/FROM vehicle_inspections/.test(sql)) return [cfg.inspection];
    if (/FROM inspection_attempts/.test(sql)) return [cfg.sharedInspection];
    if (/FROM vehicle_attendants/.test(sql)) return [cfg.attendant];
    if (/FROM driver_risk_records/.test(sql)) return [cfg.risk];
    return [[]];
  });
}
beforeEach(() => { jest.clearAllMocks(); db(); });

describe('getVehicleByQrToken', () => {
  test('found → vehicle; not found → null', async () => {
    expect((await qr.getVehicleByQrToken('tok')).id).toBe('V-1');
    db({ vehicle: [] });
    expect(await qr.getVehicleByQrToken('bad')).toBeNull();
    expect(await qr.getVehicleByQrToken('')).toBeNull();
  });
});

describe('resolveAccessLevel (credentials only)', () => {
  test('staff role → 3', async () => {
    for (const role of ['transport', 'admin', 'province']) {
      expect(await qr.resolveAccessLevel({ user: { id: 1, role } }, 'V-1')).toBe(3);
    }
  });
  test('non-privileged role (school/driver) → 1', async () => {
    expect(await qr.resolveAccessLevel({ user: { id: 1, role: 'school' } }, 'V-1')).toBe(1);
    expect(await qr.resolveAccessLevel({ user: { id: 1, role: 'driver' } }, 'V-1')).toBe(1);
  });
  test('verified parent linked to THIS vehicle → 2', async () => {
    db({ parentLinked: [{ ok: 1 }] });
    expect(await qr.resolveAccessLevel({ lineUserId: 'U1' }, 'V-1')).toBe(2);
  });
  test('verified parent NOT linked to this vehicle → 1 (isolation)', async () => {
    db({ parentLinked: [] });
    expect(await qr.resolveAccessLevel({ lineUserId: 'U1' }, 'V-1')).toBe(1);
  });
  test('anonymous → 1', async () => {
    expect(await qr.resolveAccessLevel({}, 'V-1')).toBe(1);
  });
});

describe('view builders — field isolation', () => {
  test('public view exposes NO driver name / phone / history / owner', async () => {
    const v = await qr.buildPublicView({
      id: 'V-1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'รถตู้', verification_status: 'ELIGIBLE',
      insurance_status: 'active', insurance_expiry: '2099-12-31', registration_expiry: '2099-12-31',
      compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
    });
    expect(v.level).toBe(1);
    expect(v).not.toHaveProperty('driver_name');
    expect(v).not.toHaveProperty('driver_phone');
    expect(v).not.toHaveProperty('emergency_contact');
    expect(v).not.toHaveProperty('risk_history');
    expect(v.inspection_status).toBe('PASSED');
    expect(v.driver_status).toBe('normal');
    expect(v).toMatchObject({ eligibility_status: 'ELIGIBLE', document_status: {
      insurance: 'VALID', registration: 'VALID', compulsory_insurance: 'VALID', tax: 'VALID',
    } });
    expect(JSON.stringify(v)).not.toMatch(/driver_name|driver_phone|owner|student|evidence/i);
  });
  test('parent view adds name + emergency contact (not suspended)', async () => {
    const v = await qr.buildParentView({ id: 'V-1', plate_no: 'นข 1 ลำปาง', insurance_status: 'active', insurance_expiry: null });
    expect(v.level).toBe(2);
    expect(v.driver_name).toBe('สมชาย ใจดี');
    expect(v.emergency_contact).toBe('0812345678');
    expect(v).not.toHaveProperty('risk_history');
  });
  test('suspended driver hides name + contact even at parent level', async () => {
    db({ displayStatus: [{ display_status: 'suspended' }] });
    const v = await qr.buildParentView({ id: 'V-1', plate_no: 'นข 1 ลำปาง', insurance_status: 'active', insurance_expiry: null });
    expect(v.driver_status).toBe('suspended');
    expect(v.driver_name).toBeNull();
    expect(v.emergency_contact).toBeNull();
  });
  test('staff view adds risk history + writes the sensitive VIEW audit', async () => {
    const v = await qr.buildStaffView({ id: 'V-1', plate_no: 'นข 1 ลำปาง', insurance_status: 'active', insurance_expiry: null }, { user: { id: 9 }, ip: '1.2.3.4', headers: {} });
    expect(v.level).toBe(3);
    expect(Array.isArray(v.risk_history)).toBe(true);
    expect(v.risk_history.length).toBe(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'VIEW', entityType: 'driver_sensitive', entityId: '7' }));
  });
});

describe('insurance/inspection derivation', () => {
  test('expired insurance → expired; missing → none', async () => {
    let v = await qr.buildPublicView({ id: 'V-1', plate_no: 'x', insurance_expiry: '2000-01-01' });
    expect(v.insurance_status).toBe('expired');
    v = await qr.buildPublicView({ id: 'V-1', plate_no: 'x', insurance_status: '', insurance_expiry: null });
    expect(v.insurance_status).toBe('none');
  });

  test('shared finalized inspection is preferred over the legacy summary', async () => {
    db({
      sharedInspection: [{ result: 'PASSED', inspection_date: '2026-06-22', expiry_date: '2027-06-22' }],
      inspection: [{ result: 'FAILED', inspection_date: '2020-01-01', expiry_date: null }],
    });
    const status = await qr.getLatestInspectionStatus('V-1');
    expect(status).toMatchObject({ status: 'PASSED', inspection_date: '2026-06-22', expiry_date: '2027-06-22' });
  });
});
