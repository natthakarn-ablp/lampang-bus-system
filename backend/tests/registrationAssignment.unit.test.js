'use strict';

/**
 * Approved registration roster → students.vehicle_id (school confirms).
 * DB-free mock pool/conn.
 */

require('./loadTestEnv');
const svc = require('../src/services/vehicleRegistration.service');

function makeDb({ aps, roster = [], students = [] } = {}) {
  const calls = [];
  const run = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM inspection_application_schools aps/.test(sql)) return [[aps].filter(Boolean)];
    if (/FROM registration_roster_students r\s+JOIN students s/.test(sql)) return [roster];
    if (/FROM students s\s+WHERE s\.id IN \(\?\)/.test(sql)) {
      const ids = params.find((x) => Array.isArray(x));
      return [students.filter((s) => ids.includes(s.id))];
    }
    if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
    if (/^\s*(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), query: run,
  };
  return { calls, conn, pool: { query: run, getConnection: jest.fn().mockResolvedValue(conn) } };
}

const APPROVED = { approval_status: 'APPROVED', application_status: 'SUBMITTED', vehicle_id: 'V1', plate_no: 'กข-1', vehicle_deleted: 0 };

describe('previewRosterAssignment', () => {
  test('lists matched children with their current vehicle state', async () => {
    const { pool } = makeDb({
      aps: APPROVED,
      roster: [
        { student_id: 1, full_name: 'ก', grade: 'ป.1', classroom: '1', vehicle_id: null, current_plate: null },
        { student_id: 2, full_name: 'ข', grade: 'ป.1', classroom: '1', vehicle_id: 'V1', current_plate: 'กข-1' },
        { student_id: 3, full_name: 'ค', grade: 'ป.2', classroom: '1', vehicle_id: 'V9', current_plate: 'กข-9' },
      ],
    });
    const out = await svc.previewRosterAssignment(pool, { applicationId: 5, schoolId: 'S1' });
    expect(out.students.map((s) => s.state)).toEqual(['NO_VEHICLE', 'ON_THIS_VEHICLE', 'OTHER_VEHICLE']);
    expect(out.counts).toEqual({ on_this_vehicle: 1, no_vehicle: 1, other_vehicle: 1 });
    expect(out).toMatchObject({ vehicle_id: 'V1', plate_no: 'กข-1' });
  });

  test('not approved yet → 409', async () => {
    const { pool } = makeDb({ aps: { ...APPROVED, approval_status: 'PENDING_SCHOOL_REVIEW' } });
    await expect(svc.previewRosterAssignment(pool, { applicationId: 5, schoolId: 'S1' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'NOT_APPROVED' }] });
  });

  test('another school\'s application → 403', async () => {
    const { pool } = makeDb({ aps: null });
    await expect(svc.previewRosterAssignment(pool, { applicationId: 5, schoolId: 'S2' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('assignApprovedRoster', () => {
  const students = [
    { id: 1, vehicle_id: null, grade: 'ป.1', classroom: '1' },
    { id: 2, vehicle_id: 'V1', grade: 'ป.1', classroom: '1' },
    { id: 3, vehicle_id: 'V9', grade: 'ป.2', classroom: '1' },
  ];

  test('assigns the confirmed children, skips ones already on the vehicle, audits each move', async () => {
    const { pool, calls, conn } = makeDb({ aps: APPROVED, students });
    const out = await svc.assignApprovedRoster(pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [1, 2, 3] });
    expect(out).toEqual({ application_id: 5, vehicle_id: 'V1', assigned: [1, 3], unchanged: [2], sessions_updated: [] });
    const updates = calls.filter((c) => /UPDATE students SET vehicle_id/.test(c.sql));
    expect(updates.map((u) => u.params)).toEqual([['V1', 1, 'S1'], ['V1', 3, 'S1']]);
    const audit = calls.filter((c) => /INSERT INTO audit_logs/.test(c.sql)).map((c) => JSON.parse(c.params[5]));
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ vehicle_id: 'V1', source: 'vehicle_registration', application_id: 5 });
    expect(calls.some((c) => /DELETE spp FROM student_pickup_points/.test(c.sql))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('a child not on the approved roster (or of another school) is refused, nothing written', async () => {
    const { pool, calls, conn } = makeDb({ aps: APPROVED, students });
    await expect(svc.assignApprovedRoster(pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [1, 77] }))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'NOT_ON_APPROVED_ROSTER', student_ids: [77] }] });
    expect(calls.some((c) => /UPDATE students/.test(c.sql))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('roster query is limited to MATCHED rows of this application + school and locks', async () => {
    const { pool, calls } = makeDb({ aps: APPROVED, students });
    await svc.assignApprovedRoster(pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [1] });
    const q = calls.find((c) => /FROM students s\s+WHERE s\.id IN/.test(c.sql));
    expect(q.sql).toMatch(/match_status = 'MATCHED'/);
    expect(q.sql).toMatch(/FOR UPDATE/);
    expect(q.params).toEqual([5, 'S1', [1], 'S1', 5, 'S1']);
  });

  test('cancelled application or empty selection is refused', async () => {
    const { pool } = makeDb({ aps: { ...APPROVED, application_status: 'CANCELLED' }, students });
    await expect(svc.assignApprovedRoster(pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [1] }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'APPLICATION_INACTIVE' }] });
    await expect(svc.assignApprovedRoster(makeDb({ aps: APPROVED }).pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('roster MORNING/EVENING marker → students.morning_enabled / evening_enabled', () => {
  const both = { morning_enabled: 1, evening_enabled: 1 };

  test('preview reports the marker and whether it would change the child', async () => {
    const { pool, calls } = makeDb({
      aps: APPROVED,
      roster: [
        { student_id: 1, full_name: 'ก', vehicle_id: null, ...both, pickup_types: 'MORNING' },
        { student_id: 2, full_name: 'ข', vehicle_id: 'V1', ...both, pickup_types: 'EVENING' },
        { student_id: 3, full_name: 'ค', vehicle_id: 'V1', ...both, pickup_types: null },
        { student_id: 4, full_name: 'ง', vehicle_id: 'V1', ...both, pickup_types: 'EVENING,MORNING' },
      ],
    });
    const out = await svc.previewRosterAssignment(pool, { applicationId: 5, schoolId: 'S1' });
    expect(out.students.map((s) => [s.pickup_type, s.sessions_pending])).toEqual([
      ['MORNING', true], ['EVENING', true], [null, false], ['BOTH', false],
    ]);
    const q = calls.find((c) => /FROM registration_roster_students r\s+JOIN students s/.test(c.sql));
    expect(q.sql).toMatch(/r2\.pickup_type IS NOT NULL/);
    expect(q.params).toEqual([5, 'S1', 5, 'S1']);
  });

  test('assigning applies the marker, keeps sessions when there is none, audits old/new', async () => {
    const { pool, calls } = makeDb({
      aps: APPROVED,
      students: [
        { id: 1, vehicle_id: null, grade: 'ป.1', classroom: '1', ...both, pickup_types: 'MORNING' },
        { id: 2, vehicle_id: null, grade: 'ป.1', classroom: '1', morning_enabled: 0, evening_enabled: 1, pickup_types: null },
        { id: 3, vehicle_id: 'V1', grade: 'ป.1', classroom: '1', ...both, pickup_types: 'EVENING' },
        { id: 4, vehicle_id: 'V1', grade: 'ป.1', classroom: '1', ...both, pickup_types: 'BOTH' },
      ],
    });
    const out = await svc.assignApprovedRoster(pool, { applicationId: 5, schoolId: 'S1', userId: 9, studentIds: [1, 2, 3, 4] });
    expect(out).toEqual({
      application_id: 5, vehicle_id: 'V1', assigned: [1, 2], unchanged: [3, 4], sessions_updated: [1, 3],
    });
    const updates = calls.filter((c) => /UPDATE students SET/.test(c.sql));
    expect(updates.map((u) => [u.sql.match(/SET (.*) WHERE/)[1], u.params])).toEqual([
      ['vehicle_id = ?, morning_enabled = ?, evening_enabled = ?', ['V1', 1, 0, 1, 'S1']],
      ['vehicle_id = ?', ['V1', 2, 'S1']],
      ['morning_enabled = ?, evening_enabled = ?', [0, 1, 3, 'S1']],
    ]);
    const audits = calls.filter((c) => /INSERT INTO audit_logs/.test(c.sql))
      .map((c) => ({ old: JSON.parse(c.params[4]), new: JSON.parse(c.params[5]) }));
    expect(audits).toHaveLength(3);
    expect(audits[0].old).toMatchObject({ morning_enabled: true, evening_enabled: true });
    expect(audits[0].new).toMatchObject({ morning_enabled: true, evening_enabled: false, pickup_type: 'MORNING', action: 'move_vehicle' });
    expect(audits[1].new).not.toHaveProperty('morning_enabled');
    expect(audits[2].new).toMatchObject({ action: 'set_sessions', morning_enabled: false, evening_enabled: true, pickup_type: 'EVENING' });
  });
});
