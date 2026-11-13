'use strict';

/**
 * Transport may merge a duplicate vehicle itself (owner decision 2026-11-13):
 * GET /api/transport/vehicles/:id/impact + POST /api/transport/vehicles/:id/merge
 * run the admin service unchanged — reason required, one transaction, the
 * merged-away plate's driver login closed — and the audit rows carry by_role.
 * Delete stays admin-only. DB-free: a mock connection answers the SQL.
 */

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: req.headers['x-test-role'] || 'transport' };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const errorHandler = require('../src/middleware/errorHandler');

const LOSER = { id: 'V-1', plate_no: 'นข-1 ลำปาง', is_deleted: 0 };
const WINNER = { id: 'V-2', plate_no: 'นข 2 ลำปาง', is_deleted: 0 };
const LOGINS = [{ id: 41, username: 'นข1ลำปาง', is_active: 1 }, { id: 42, username: 'นข 2 ลำปาง', is_active: 1 }];

function makeConn() {
  const calls = [];
  return {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (/SELECT \* FROM vehicles WHERE id = \?/.test(sql)) return [[params[0] === 'V-1' ? LOSER : WINNER]];
      if (/active_vehicle_id = \? LIMIT 1/.test(sql)) return [[]];
      if (/FROM users\s+WHERE role = 'driver'/.test(sql)) {
        return [LOGINS.filter((u) => u.username.replace(/[\s-]/g, '').toLowerCase() === params[0])];
      }
      if (/^\s*(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }),
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/transport', require('../src/routes/transport.routes'));
  a.use('/api/admin', require('../src/routes/admin.routes'));
  a.use(errorHandler);
  return a;
}

let conn;
beforeEach(() => {
  jest.clearAllMocks();
  conn = makeConn();
  pool.getConnection.mockResolvedValue(conn);
});

test('transport merges a duplicate: same transaction, source-plate login closed, audits by_role transport', async () => {
  const res = await request(app()).post('/api/transport/vehicles/V-1/merge')
    .send({ into_vehicle_id: 'V-2', reason: 'เพิ่มรถซ้ำสองครั้ง' });
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('MERGED');
  expect(conn.beginTransaction).toHaveBeenCalled();
  expect(conn.commit).toHaveBeenCalled();
  const userUpdates = conn.calls.filter(([s]) => /^\s*UPDATE users/.test(s));
  expect(userUpdates).toHaveLength(1);
  expect(userUpdates[0][0]).toMatch(/is_active = FALSE, password_changed_at = NOW\(\)/);
  expect(userUpdates[0][1]).toEqual([41]);
  expect(res.body.data.driver_logins_closed.map((l) => l.user_id)).toEqual([41]);

  const vehicleAudit = logAudit.mock.calls.map((c) => c[0]).find((a) => a.entityType === 'vehicle');
  expect(vehicleAudit.newValue).toMatchObject({ merged_into: 'V-2', by_role: 'transport', reason: 'เพิ่มรถซ้ำสองครั้ง' });
  const userAudit = logAudit.mock.calls.map((c) => c[0]).find((a) => a.entityType === 'user');
  expect(userAudit.newValue).toMatchObject({ is_active: false, reason: 'vehicle_merged', by_role: 'transport' });
});

test('transport merge without a reason is refused before any write', async () => {
  const res = await request(app()).post('/api/transport/vehicles/V-1/merge').send({ into_vehicle_id: 'V-2', reason: '  ' });
  expect(res.status).toBe(400);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('admin merge records by_role admin', async () => {
  const res = await request(app()).post('/api/admin/vehicles/V-1/merge').set('x-test-role', 'admin')
    .send({ into_vehicle_id: 'V-2', reason: 'รถซ้ำ' });
  expect(res.status).toBe(200);
  const vehicleAudit = logAudit.mock.calls.map((c) => c[0]).find((a) => a.entityType === 'vehicle');
  expect(vehicleAudit.newValue.by_role).toBe('admin');
});

test('school cannot reach the transport merge or impact routes', async () => {
  const a = app();
  expect((await request(a).post('/api/transport/vehicles/V-1/merge').set('x-test-role', 'school')
    .send({ into_vehicle_id: 'V-2', reason: 'x' })).status).toBe(403);
  expect((await request(a).get('/api/transport/vehicles/V-1/impact').set('x-test-role', 'school')).status).toBe(403);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('transport cannot delete a vehicle (DELETE stays admin-only)', async () => {
  const a = app();
  expect((await request(a).delete('/api/admin/vehicles/V-1').set('x-test-role', 'transport').send({ reason: 'x' })).status).toBe(403);
  expect((await request(a).delete('/api/transport/vehicles/V-1').set('x-test-role', 'transport').send({ reason: 'x' })).status).toBe(404);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('transport reads the merge impact preview', async () => {
  pool.query.mockImplementation(async (sql) => {
    if (/SELECT id, plate_no, vehicle_type, is_deleted FROM vehicles/.test(sql)) return [[{ id: 'V-1', plate_no: LOSER.plate_no, vehicle_type: 'van', is_deleted: 0 }]];
    if (/COUNT\(\*\) AS n FROM students WHERE vehicle_id = \? AND is_deleted/.test(sql)) return [[{ n: 2 }]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ n: 0 }]];
    if (/FROM users\s+WHERE role = 'driver'/.test(sql)) return [[LOGINS[0]]];
    return [[]];
  });
  const res = await request(app()).get('/api/transport/vehicles/V-1/impact');
  expect(res.status).toBe(200);
  expect(res.body.data.active_students).toBe(2);
  expect(res.body.data.driver_login).toMatchObject({ id: 41 });
});
