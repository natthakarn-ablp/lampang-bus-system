'use strict';

/**
 * Unit tests for the admin/operator CRUD-gap endpoints (so operators stop
 * hand-editing the DB): vehicle soft-delete / merge, checkin void, student &
 * user restore, emergency resolve / soft-delete. DB-free — a mock pool/conn is
 * passed straight into each service (services take pool as 1st arg).
 */

require('./loadTestEnv');
const vehicleAdmin = require('../src/services/vehicleAdmin.service');
const checkinSvc = require('../src/services/checkin.service');
const schoolSvc = require('../src/services/school.service');
const adminSvc = require('../src/services/admin.service');
const emergencyAdmin = require('../src/services/emergencyAdmin.service');

function makeConn(handler) {
  const calls = [];
  return {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, params) => { calls.push([sql, params]); return handler(sql, params); }),
  };
}
const poolOf = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn) });
const issued = (conn, re) => conn.calls.some(([s]) => re.test(s));
const dflt = (sql) => {
  if (/INSERT INTO/.test(sql)) return [{ insertId: 1 }];
  if (/^\s*(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
  return [[]];
};

describe('vehicleAdmin.softDeleteVehicle', () => {
  const veh = { id: 'V-1', plate_no: 'นข 1 ลำปาง', is_deleted: 0 };
  test('blocks soft-delete when active students exist (no force) → 409 VEHICLE_IN_USE', async () => {
    const conn = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [[veh]];
      if (/COUNT\(\*\) AS n FROM students/.test(sql)) return [[{ n: 3 }]];
      if (/COUNT\(\*\) AS n FROM driver_vehicle_assignments/.test(sql)) return [[{ n: 0 }]];
      return dflt(sql);
    });
    await expect(vehicleAdmin.softDeleteVehicle(poolOf(conn), { vehicleId: 'V-1', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'VEHICLE_IN_USE' }] });
    expect(conn.rollback).toHaveBeenCalled();
    expect(issued(conn, /UPDATE vehicles SET is_deleted/)).toBe(false);
  });

  test('force + reason soft-deletes despite active students', async () => {
    const conn = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [[veh]];
      if (/COUNT\(\*\) AS n FROM students/.test(sql)) return [[{ n: 3 }]];
      if (/COUNT\(\*\) AS n FROM driver_vehicle_assignments/.test(sql)) return [[{ n: 0 }]];
      return dflt(sql);
    });
    const out = await vehicleAdmin.softDeleteVehicle(poolOf(conn), { vehicleId: 'V-1', actorId: 1, force: true, reason: 'รถทดสอบ' });
    expect(out.status).toBe('DELETED');
    expect(out.forced).toBe(true);
    expect(issued(conn, /UPDATE vehicles SET is_deleted = TRUE/)).toBe(true);
  });

  test('already-deleted vehicle is idempotent', async () => {
    const conn = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [[{ ...veh, is_deleted: 1 }]];
      return dflt(sql);
    });
    const out = await vehicleAdmin.softDeleteVehicle(poolOf(conn), { vehicleId: 'V-1', actorId: 1 });
    expect(out.status).toBe('ALREADY_DELETED');
  });
});

describe('vehicleAdmin.correctVehicle (non-plate fields) + mergeVehicles', () => {
  test('updates simple fields and audits', async () => {
    const v = { id: 'V-1', plate_no: 'นข 1 ลำปาง', is_deleted: 0, vehicle_type: 'รถตู้' };
    const conn = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \?$/.test(sql.trim()) || /FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [[v]];
      return dflt(sql);
    });
    const out = await vehicleAdmin.correctVehicle(poolOf(conn), { vehicleId: 'V-1', actorId: 1, patch: { vehicle_type: 'รถสองแถว' } });
    expect(issued(conn, /UPDATE vehicles SET vehicle_type = \?/)).toBe(true);
    expect(out.id).toBe('V-1');
  });

  test('merge rejects self-merge + missing reason', async () => {
    const conn = makeConn(dflt);
    await expect(vehicleAdmin.mergeVehicles(poolOf(conn), { vehicleId: 'V-1', intoVehicleId: 'V-1', actorId: 1, reason: 'x' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(vehicleAdmin.mergeVehicles(poolOf(conn), { vehicleId: 'V-1', intoVehicleId: 'V-2', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('merge repoints children and soft-deletes the loser', async () => {
    const conn = makeConn((sql, params) => {
      if (/SELECT \* FROM vehicles WHERE id = \?/.test(sql)) {
        return [[params[0] === 'V-1' ? { id: 'V-1', plate_no: 'A', is_deleted: 0 } : { id: 'V-2', plate_no: 'B', is_deleted: 0 }]];
      }
      if (/active_vehicle_id = \? LIMIT 1/.test(sql)) return [[]]; // winner has no active assignment
      return dflt(sql);
    });
    const out = await vehicleAdmin.mergeVehicles(poolOf(conn), { vehicleId: 'V-1', intoVehicleId: 'V-2', actorId: 1, reason: 'รถซ้ำ' });
    expect(out.status).toBe('MERGED');
    expect(out.merged_into).toBe('V-2');
    expect(issued(conn, /UPDATE students SET vehicle_id = \?/)).toBe(true);
    expect(issued(conn, /UPDATE vehicles SET is_deleted = TRUE/)).toBe(true);
  });
});

describe('checkin.voidCheckin', () => {
  const log = { id: 5, term_id: 't', vehicle_id: 'V-1', plate_no: 'p', student_id: 9, cid_hash: 'h', student_name: 'ด.ช.ก', session: 'morning', status: 'CHECKED_IN', check_date: '2026-06-27' };
  const handler = (over = {}) => (sql) => {
    if (/FROM checkin_logs\s+WHERE id = \?\s+FOR UPDATE/.test(sql)) return [[{ ...log, ...over }]];
    if (/status = 'CANCELLED' AND id > \?/.test(sql)) return [[]]; // no prior void
    if (/FROM daily_status/.test(sql)) return [[{ morning_done: 1, evening_done: 0 }]];
    if (/FROM students WHERE id = \?/.test(sql)) return [[{ school_id: 'SCH1' }]];
    return dflt(sql);
  };

  test('404 when log not found', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : dflt(sql)));
    await expect(checkinSvc.voidCheckin(poolOf(conn), { userId: 1, logId: 5, reason: 'x', scope: { kind: 'admin' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('409 when target is already CANCELLED', async () => {
    const conn = makeConn(handler({ status: 'CANCELLED' }));
    await expect(checkinSvc.voidCheckin(poolOf(conn), { userId: 1, logId: 5, reason: 'x', scope: { kind: 'admin' } }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ALREADY_CANCELLED' }] });
  });

  test('403 when a driver voids another vehicle\'s log', async () => {
    const conn = makeConn(handler());
    await expect(checkinSvc.voidCheckin(poolOf(conn), { userId: 1, logId: 5, reason: 'x', scope: { kind: 'driver', vehicleId: 'V-OTHER' } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('admin void writes compensating CANCELLED row + resets daily_status', async () => {
    const conn = makeConn(handler());
    const out = await checkinSvc.voidCheckin(poolOf(conn), { userId: 1, logId: 5, reason: 'สแกนผิดคน', scope: { kind: 'admin' } });
    expect(out.status).toBe('CANCELLED');
    expect(out.original_log_id).toBe(5);
    expect(issued(conn, /INSERT INTO checkin_logs/)).toBe(true);
    expect(issued(conn, /UPDATE daily_status\s+SET morning_done = FALSE/)).toBe(true);
  });
});

describe('school.restoreStudent', () => {
  test('404 when not in caller school scope', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : dflt(sql)));
    await expect(schoolSvc.restoreStudent(poolOf(conn), { schoolId: 'SCH1', studentId: 9, actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  test('restores a soft-deleted student', async () => {
    const conn = makeConn((sql) => {
      if (/FROM students s\s+WHERE s.id = \? AND s.school_id = \?\s+FOR UPDATE/.test(sql)) return [[{ id: 9, first_name: 'ก', last_name: 'ข', is_deleted: 1 }]];
      return dflt(sql);
    });
    const out = await schoolSvc.restoreStudent(poolOf(conn), { schoolId: 'SCH1', studentId: 9, actorId: 1 });
    expect(out.status).toBe('RESTORED');
    expect(issued(conn, /UPDATE students SET is_deleted = FALSE/)).toBe(true);
  });
});

describe('admin.restoreUser', () => {
  test('404 when user not found', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : dflt(sql)));
    await expect(adminSvc.restoreUser(poolOf(conn), { userId: 7, actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  test('409 refuses a driver account (must use driver lifecycle)', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[{ id: 7, username: 'd', role: 'driver', is_deleted: 1 }]] : dflt(sql)));
    await expect(adminSvc.restoreUser(poolOf(conn), { userId: 7, actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });
  });
  test('restores a non-driver user DEACTIVATED', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[{ id: 7, username: 's', role: 'school', is_deleted: 1 }]] : dflt(sql)));
    const out = await adminSvc.restoreUser(poolOf(conn), { userId: 7, actorId: 1 });
    expect(out).toMatchObject({ status: 'RESTORED', is_active: false });
    expect(issued(conn, /UPDATE users SET is_deleted = FALSE, deleted_at = NULL, is_active = FALSE/)).toBe(true);
  });
});

describe('emergencyAdmin', () => {
  test('resolveEmergency 404 when not found', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : dflt(sql)));
    await expect(emergencyAdmin.resolveEmergency(poolOf(conn), { id: 3, result: 'RESOLVED', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  test('resolveEmergency writes result/note', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[{ id: 3, result: null, note: null, is_deleted: 0 }]] : dflt(sql)));
    const out = await emergencyAdmin.resolveEmergency(poolOf(conn), { id: 3, result: 'CLOSED', note: 'จบเคส', actorId: 1 });
    expect(out).toMatchObject({ status: 'UPDATED', result: 'CLOSED' });
    expect(issued(conn, /UPDATE emergency_logs SET result = \?, note = \?/)).toBe(true);
  });
  test('softDeleteEmergency soft-deletes', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[{ id: 3, plate_no: 'p', detail: 'd', result: null, is_deleted: 0 }]] : dflt(sql)));
    const out = await emergencyAdmin.softDeleteEmergency(poolOf(conn), { id: 3, actorId: 1, reason: 'ทดสอบ' });
    expect(out.status).toBe('DELETED');
    expect(issued(conn, /UPDATE emergency_logs SET is_deleted = TRUE/)).toBe(true);
  });
});
