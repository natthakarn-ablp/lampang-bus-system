'use strict';

/**
 * vehicleRequest.test.js  (Phase 10.13B-7)
 * Vehicle restore / shared-fleet request lifecycle + safe approve.
 */
const svc = require('../src/services/vehicleRequest.service');

function makePool({ vehicle, dupPending = false, request, reReadVehicle, activeSibling = false } = {}) {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      if (/FROM vehicle_requests WHERE id = \? FOR UPDATE/.test(sql)) return [request ? [request] : []];
      if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [reReadVehicle ? [reReadVehicle] : []];
      if (/WHERE canonical_plate = \? AND is_deleted = FALSE AND id <> \?/.test(sql)) return [activeSibling ? [{ id: 'V-other' }] : []];
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      if (/^\s*UPDATE/i.test(sql)) return [{}];
      return [[]];
    },
  };
  return {
    getConnection: async () => conn,
    query: async (sql) => {
      if (/FROM vehicles WHERE id = \?/.test(sql)) return [vehicle ? [vehicle] : []];
      if (/FROM vehicles WHERE canonical_plate = \? AND is_deleted = TRUE/.test(sql)) return [vehicle ? [vehicle] : []];
      if (/vehicle_requests WHERE school_id = \? AND canonical_plate = \? AND request_type = \? AND status = 'PENDING'/.test(sql)) return [dupPending ? [{ id: 3 }] : []];
      if (/FROM vehicle_requests q .*WHERE q\.id = \?/.test(sql)) return [request ? [request] : []];   // JOIN'd detail
      if (/FROM vehicle_requests WHERE id = \?/.test(sql)) return [request ? [request] : []];
      if (/INSERT INTO vehicle_requests/.test(sql)) return [{ insertId: 55 }];
      return [{}];
    },
  };
}
const softVeh = (o = {}) => ({ id: 'V-x', plate_no: 'นข 4031 ลำปาง', vehicle_type: 'รถตู้', is_deleted: 1, ...o });

describe('createVehicleRequest (10.13B-7)', () => {
  test('RESTORE for a soft-deleted vehicle → PENDING', async () => {
    const out = await svc.createVehicleRequest(makePool({ vehicle: softVeh() }), { schoolId: 'S1', userId: 1, requestType: 'RESTORE_SOFT_DELETED_VEHICLE', vehicleId: 'V-x', reason: 'ต้องใช้' });
    expect(out.status).toBe('PENDING');
    expect(out.vehicle_id).toBe('V-x');
  });
  test('reason required → 400', async () => {
    await expect(svc.createVehicleRequest(makePool({ vehicle: softVeh() }), { schoolId: 'S1', userId: 1, requestType: 'RESTORE_SOFT_DELETED_VEHICLE', vehicleId: 'V-x' })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('RESTORE of an ACTIVE vehicle → 400 (no need to restore)', async () => {
    await expect(svc.createVehicleRequest(makePool({ vehicle: softVeh({ is_deleted: 0 }) }), { schoolId: 'S1', userId: 1, requestType: 'RESTORE_SOFT_DELETED_VEHICLE', vehicleId: 'V-x', reason: 'x' })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('duplicate pending request → 409', async () => {
    await expect(svc.createVehicleRequest(makePool({ vehicle: softVeh(), dupPending: true }), { schoolId: 'S1', userId: 1, requestType: 'RESTORE_SOFT_DELETED_VEHICLE', vehicleId: 'V-x', reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });
  test('invalid request_type → 400', async () => {
    await expect(svc.createVehicleRequest(makePool({}), { schoolId: 'S1', userId: 1, requestType: 'BOGUS', reason: 'x' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('cancel / scope (10.13B-7)', () => {
  test('requester cancels own pending → CANCELLED', async () => {
    const out = await svc.cancelVehicleRequest(makePool({ request: { id: 55, school_id: 'S1', status: 'PENDING' } }), { requestId: 55, schoolId: 'S1', userId: 1 });
    expect(out.status).toBe('CANCELLED');
  });
  test('other school cannot cancel → 403', async () => {
    await expect(svc.cancelVehicleRequest(makePool({ request: { id: 55, school_id: 'OTHER', status: 'PENDING' } }), { requestId: 55, schoolId: 'S1', userId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });
  test('other school cannot view detail → 403', async () => {
    await expect(svc.getSchoolVehicleRequest(makePool({ request: { id: 55, school_id: 'OTHER', status: 'PENDING' } }), { requestId: 55, schoolId: 'S1' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

const restoreReq = (o = {}) => ({ id: 55, status: 'PENDING', request_type: 'RESTORE_SOFT_DELETED_VEHICLE', vehicle_id: 'V-x', canonical_plate: 'นข4031ลำปาง', ...o });

describe('approveVehicleRequest (10.13B-7)', () => {
  test('RESTORE → APPLIED, vehicle un-deleted', async () => {
    const out = await svc.approveVehicleRequest(makePool({ request: restoreReq(), reReadVehicle: softVeh() }), { requestId: 55, adminUserId: 9, adminNote: 'ok' });
    expect(out.status).toBe('APPLIED');
    expect(out.vehicle_id).toBe('V-x');
  });
  test('RESTORE blocked if an active canonical sibling exists → FAILED', async () => {
    const out = await svc.approveVehicleRequest(makePool({ request: restoreReq(), reReadVehicle: softVeh(), activeSibling: true }), { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('FAILED');
    expect(out.reason).toBe('ACTIVE_CANONICAL_CONFLICT');
  });
  test('already applied → ALREADY_APPLIED (idempotent)', async () => {
    const out = await svc.approveVehicleRequest(makePool({ request: restoreReq({ status: 'APPLIED' }) }), { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('ALREADY_APPLIED');
  });
  test('USE_EXISTING_SHARED_VEHICLE → APPLIED informational (no vehicle mutation)', async () => {
    const out = await svc.approveVehicleRequest(makePool({ request: restoreReq({ request_type: 'USE_EXISTING_SHARED_VEHICLE' }) }), { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('APPLIED');
    expect(out.informational).toBe(true);
  });
  test('admin reject pending → REJECTED', async () => {
    const out = await svc.rejectVehicleRequest(makePool({ request: { id: 55, status: 'PENDING' } }), { requestId: 55, adminUserId: 9, adminNote: 'ไม่ผ่าน' });
    expect(out.status).toBe('REJECTED');
  });
});
