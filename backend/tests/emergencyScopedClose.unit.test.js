'use strict';

/**
 * emergencyScopedClose.unit.test.js — DB-free checks of
 * emergencyAdmin.closeEmergencyScoped (owner decision 2026-11-13). The DB
 * integration counterpart is selfServeDriverEmergency.test.js.
 */

jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
const { logAudit } = require('../src/utils/audit');
const svc = require('../src/services/emergencyAdmin.service');

function fakePool(row, { schoolLink = false, affLink = false } = {}) {
  const conn = {
    queries: [],
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      conn.queries.push([sql, params]);
      if (/FROM emergency_logs WHERE id = \? FOR UPDATE/.test(sql)) return [[row].filter(Boolean)];
      if (/FROM students WHERE vehicle_id = \? AND school_id/.test(sql)) return [schoolLink ? [{ ok: 1 }] : []];
      if (/JOIN schools sc/.test(sql)) return [affLink ? [{ ok: 1 }] : []];
      if (/^UPDATE emergency_logs/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }),
  };
  return { conn, getConnection: async () => conn };
}

const open = () => ({ id: 7, vehicle_id: 'V-1', plate_no: 'P', reported_by: 50, result: null, note: 'เดิม', is_deleted: 0 });
const actor = (role) => ({ id: 1, role, name: 'ผู้ทดสอบ' });

beforeEach(() => jest.clearAllMocks());

test('roles outside the decision (transport) are refused', async () => {
  const p = fakePool(open());
  await expect(svc.closeEmergencyScoped(p, { id: 7, note: 'x', actor: actor('transport'), scope: { all: true } }))
    .rejects.toMatchObject({ statusCode: 403 });
});

test('note is required and the driver may only mark RESOLVED', async () => {
  const p = fakePool(open());
  await expect(svc.closeEmergencyScoped(p, { id: 7, note: '  ', actor: actor('province'), scope: { all: true } }))
    .rejects.toMatchObject({ statusCode: 400 });
  await expect(svc.closeEmergencyScoped(p, { id: 7, result: 'FALSE_ALARM', note: 'x', actor: actor('driver'), scope: { driverUserId: 50 } }))
    .rejects.toMatchObject({ statusCode: 400 });
});

test('driver of another vehicle gets 404 and nothing is written', async () => {
  const p = fakePool(open());
  await expect(svc.closeEmergencyScoped(p, {
    id: 7, note: 'x', actor: actor('driver'), scope: { driverUserId: 99, vehicleId: 'V-OTHER' },
  })).rejects.toMatchObject({ statusCode: 404 });
  expect(p.conn.queries.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
  expect(logAudit).not.toHaveBeenCalled();
});

test('school without pupils on the vehicle → 404; with pupils → closes, appends history, audits role', async () => {
  await expect(svc.closeEmergencyScoped(fakePool(open()), {
    id: 7, note: 'x', actor: actor('school'), scope: { schoolId: 'S1' },
  })).rejects.toMatchObject({ statusCode: 404 });

  const p = fakePool(open(), { schoolLink: true });
  const out = await svc.closeEmergencyScoped(p, { id: 7, note: 'ตรวจแล้ว', actor: actor('school'), scope: { schoolId: 'S1' } });
  expect(out).toMatchObject({ status: 'CLOSED', result: 'RESOLVED' });
  const upd = p.conn.queries.find(([sql]) => /^UPDATE emergency_logs/.test(sql));
  expect(upd[1][1]).toMatch(/^เดิม\n\[ปิดเหตุ .* · โรงเรียน · ผู้ทดสอบ\] ตรวจแล้ว$/);
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    entityType: 'emergency', required: true,
    newValue: expect.objectContaining({ closed_by_role: 'school', close_note: 'ตรวจแล้ว', scope: { school_id: 'S1' } }),
  }));
});

test('an already-closed emergency is 409 (no silent overwrite)', async () => {
  const p = fakePool({ ...open(), result: 'RESOLVED' });
  await expect(svc.closeEmergencyScoped(p, { id: 7, note: 'x', actor: actor('province'), scope: { all: true } }))
    .rejects.toMatchObject({ statusCode: 409 });
});

test('empty scope fails closed', async () => {
  const p = fakePool(open(), { schoolLink: true, affLink: true });
  await expect(svc.closeEmergencyScoped(p, { id: 7, note: 'x', actor: actor('affiliation'), scope: {} }))
    .rejects.toMatchObject({ statusCode: 404 });
});
