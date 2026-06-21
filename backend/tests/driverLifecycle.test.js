'use strict';

/**
 * driverLifecycle.test.js  (Phase 10.13B-8)
 * Driver preflight + restore (23C-guarded) + reassign (DB-guarded) + deactivate.
 */
jest.mock('../src/utils/driverReactivation', () => ({ detectDriverReactivationBlock: jest.fn() }));
const { detectDriverReactivationBlock } = require('../src/utils/driverReactivation');
const svc = require('../src/services/driverLifecycle.service');

const driverUser = (o = {}) => ({ id: 50, username: 'นข 1 ลำปาง', role: 'driver', is_active: 1, is_deleted: 0, driver_id: 7, ...o });

// Mock pool keyed by SQL shape. Conn mirrors pool for transactional fns.
function makePool(cfg = {}) {
  const q = async (sql, params) => {
    if (/FROM users WHERE id = \? AND role = 'driver'/.test(sql)) return [cfg.user ? [cfg.user] : []];
    if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql) || /FROM vehicles WHERE id = \?/.test(sql)) return [cfg.vehicle ? [cfg.vehicle] : []];
    if (/WHERE driver_id = \? AND vehicle_id = \? AND is_active = TRUE/.test(sql)) return [cfg.alreadyAssigned ? [{ id: 1 }] : []];
    if (/WHERE vehicle_id = \? AND is_active = TRUE LIMIT 1/.test(sql)) return [cfg.targetDriver ? [{ id: 9, driver_id: 99 }] : []];
    if (/WHERE driver_id = \? AND is_active = TRUE LIMIT 1/.test(sql)) return [cfg.oldAssignment ? [{ id: 8, vehicle_id: 'V-old' }] : []];
    if (/INSERT INTO driver_vehicle_assignments/.test(sql)) { if (cfg.insertDup) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; e.sqlMessage = "Duplicate ... uq_dva_active_vehicle"; throw e; } return [{}]; }
    if (/INSERT INTO audit_logs/.test(sql)) return [{}];
    if (/^\s*UPDATE/i.test(sql)) return [{}];
    return [[]];
  };
  return { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) };
}

describe('preflightDriverAction (10.13B-8)', () => {
  test('RESTORE blocked when 23C flags a duplicate', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: true, reason: 'DUPLICATE_OF_LINKED_DRIVER', canonicalUserId: 407 });
    const r = await svc.preflightDriverAction(makePool({ user: driverUser({ is_active: 0 }) }), { action: 'RESTORE_DRIVER', payload: { user_id: 408 } });
    expect(r.allowed).toBe(false);
    expect(r.severity).toBe('BLOCKED');
    expect(r.canonical_user_id).toBe(407);
  });
  test('RESTORE clear when not a duplicate', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: false });
    const r = await svc.preflightDriverAction(makePool({ user: driverUser({ is_active: 0 }) }), { action: 'RESTORE_DRIVER', payload: { user_id: 50 } });
    expect(r.allowed).toBe(true);
    expect(r.recommended_action).toBe('RESTORE');
  });
  test('RESTORE allowed with WARNING when no active vehicle (10.13C)', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: false, warning: true, reason: 'NO_ACTIVE_VEHICLE' });
    const r = await svc.preflightDriverAction(makePool({ user: driverUser({ is_active: 0 }) }), { action: 'RESTORE_DRIVER', payload: { user_id: 50 } });
    expect(r.allowed).toBe(true);
    expect(r.severity).toBe('WARNING');
    expect(r.classification).toBe('NO_ACTIVE_VEHICLE');
    expect(r.recommended_action).toBe('RESTORE');
  });
  test('REASSIGN warns when target vehicle already has an active driver', async () => {
    const r = await svc.preflightDriverAction(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 0 }, targetDriver: true }), { action: 'REASSIGN_DRIVER_VEHICLE', payload: { user_id: 50, vehicle_id: 'V-1' } });
    expect(r.classification).toBe('TARGET_VEHICLE_HAS_ACTIVE_DRIVER');
    expect(r.recommended_action).toBe('END_OLD_ASSIGNMENT');
  });
  test('REASSIGN blocked when target vehicle is soft-deleted', async () => {
    const r = await svc.preflightDriverAction(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 1 } }), { action: 'REASSIGN_DRIVER_VEHICLE', payload: { user_id: 50, vehicle_id: 'V-1' } });
    expect(r.allowed).toBe(false);
    expect(r.classification).toBe('VEHICLE_SOFT_DELETED');
  });
});

describe('restoreDriver (10.13B-8)', () => {
  test('blocked duplicate → 409', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: true, reason: 'DUPLICATE_OF_LINKED_DRIVER', canonicalUserId: 407 });
    await expect(svc.restoreDriver(makePool({ user: driverUser({ is_active: 0 }) }), { userId: 408, reason: 'x', actorId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });
  test('canonical (not blocked) → RESTORED', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: false });
    const out = await svc.restoreDriver(makePool({ user: driverUser({ is_active: 0 }) }), { userId: 50, reason: 'wrongly deactivated', actorId: 1 });
    expect(out.status).toBe('RESTORED');
  });
  test('no active vehicle → RESTORED with warning surfaced (10.13C)', async () => {
    detectDriverReactivationBlock.mockResolvedValue({ blocked: false, warning: true, reason: 'NO_ACTIVE_VEHICLE' });
    const out = await svc.restoreDriver(makePool({ user: driverUser({ is_active: 0 }) }), { userId: 50, reason: 'vehicle was retired', actorId: 1 });
    expect(out.status).toBe('RESTORED');
    expect(out.warning).toBe('NO_ACTIVE_VEHICLE');
  });
});

describe('reassignDriverVehicle (10.13B-8)', () => {
  test('clear target → REASSIGNED (ends old, creates new)', async () => {
    const out = await svc.reassignDriverVehicle(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 0 }, oldAssignment: true }), { userId: 50, vehicleId: 'V-1', reason: 'ย้าย', actorId: 1 });
    expect(out.status).toBe('REASSIGNED');
    expect(out.ended_old).toBe(true);
  });
  test('target has active driver, no force → TARGET_VEHICLE_HAS_ACTIVE_DRIVER', async () => {
    const out = await svc.reassignDriverVehicle(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 0 }, targetDriver: true }), { userId: 50, vehicleId: 'V-1', reason: 'x', actorId: 1 });
    expect(out.status).toBe('TARGET_VEHICLE_HAS_ACTIVE_DRIVER');
  });
  test('soft-deleted target vehicle → 400', async () => {
    await expect(svc.reassignDriverVehicle(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 1 } }), { userId: 50, vehicleId: 'V-1', reason: 'x', actorId: 1 })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('DB unique race on insert → 409 Thai', async () => {
    await expect(svc.reassignDriverVehicle(makePool({ user: driverUser(), vehicle: { id: 'V-1', is_deleted: 0 }, insertDup: true }), { userId: 50, vehicleId: 'V-1', reason: 'x', actorId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });
  test('inactive driver → 400', async () => {
    await expect(svc.reassignDriverVehicle(makePool({ user: driverUser({ is_active: 0 }) }), { userId: 50, vehicleId: 'V-1', reason: 'x', actorId: 1 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('deactivateDriver (10.13B-8)', () => {
  test('active driver → DEACTIVATED (ends assignment)', async () => {
    const out = await svc.deactivateDriver(makePool({ user: driverUser() }), { userId: 50, reason: 'ลาออก', actorId: 1 });
    expect(out.status).toBe('DEACTIVATED');
  });
  test('already inactive → ALREADY_INACTIVE', async () => {
    const out = await svc.deactivateDriver(makePool({ user: driverUser({ is_active: 0 }) }), { userId: 50, reason: 'x', actorId: 1 });
    expect(out.status).toBe('ALREADY_INACTIVE');
  });
});
