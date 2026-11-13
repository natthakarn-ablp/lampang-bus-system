'use strict';

/**
 * In-app alert for the school main account when a grade teacher or a driver
 * binds / unbinds LINE for password recovery. Stored as audit_logs rows
 * (entity_type 'recovery_alert') — never the notifications table, never LINE.
 */

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user-id']), role: req.headers['x-test-role'] };
    return next();
  },
}));
jest.mock('../src/services/lineIdToken.service', () => ({ verifyIdToken: jest.fn() }));
jest.mock('../src/services/line.service', () => ({ sendTextMessage: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('../src/services/recoveryBindingAlert.service', () => {
  const actual = jest.requireActual('../src/services/recoveryBindingAlert.service');
  return { ...actual, recordBindingChange: jest.fn().mockResolvedValue([]) };
});

jest.mock('../src/services/pendingQueue.service', () => ({ getSummary: jest.fn() }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const { verifyIdToken } = require('../src/services/lineIdToken.service');
const { sendTextMessage } = require('../src/services/line.service');
const mocked = require('../src/services/recoveryBindingAlert.service');

const svc = jest.requireActual('../src/services/recoveryBindingAlert.service');

const TEACHER = { id: 11, role: 'school', username: 'teacher_p1', display_name: 'ครู ป.1', scope_id: 'SCH0001', grade_scope: 'ป.1' };
const MAIN = { id: 10, role: 'school', username: 'school01', display_name: 'โรงเรียน', scope_id: 'SCH0001', grade_scope: null };
const DRIVER = { id: 12, role: 'driver', username: 'กข-1234', display_name: 'คนขับ', scope_id: null, grade_scope: null };
const ADMIN = { id: 1, role: 'admin', username: 'admin01', display_name: 'admin', scope_id: null, grade_scope: null };

function fakeDb({ user, schools = [] }) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM users WHERE id = \?/.test(sql.replace(/\s+/g, ' '))) return [[user].filter(Boolean)];
      if (/FROM vehicles v/.test(sql)) return [schools];
      return [{ affectedRows: 1 }];
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  logAudit.mockResolvedValue();
});

describe('who hears about a binding', () => {
  test('a grade teacher → their school main account', async () => {
    const db = fakeDb({ user: TEACHER });
    const out = await svc.recordBindingChange(db, { userId: 11, linked: true });
    expect(out).toEqual(['SCH0001']);
    expect(logAudit).toHaveBeenCalledTimes(1);
    const a = logAudit.mock.calls[0][0];
    expect(a).toMatchObject({ action: 'CREATE', entityType: 'recovery_alert', entityId: 'SCH0001', userId: 11, conn: db });
    expect(a.newValue).toMatchObject({
      kind: 'LINE_RECOVERY_LINKED', target_role: 'school', target_scope_id: 'SCH0001',
      subject_role: 'school', grade_scope: 'ป.1', provider: 'LINE',
    });
  });

  test('a driver → every school whose pupils ride that vehicle (plate matched normalised)', async () => {
    const db = fakeDb({ user: DRIVER, schools: [{ school_id: 'SCH0001', plate_no: 'กข 1234' }, { school_id: 'SCH0002', plate_no: 'กข 1234' }] });
    const out = await svc.recordBindingChange(db, { userId: 12, linked: false });
    expect(out).toEqual(['SCH0001', 'SCH0002']);
    const q = db.calls.find((c) => /FROM vehicles v/.test(c.sql));
    expect(q.params).toEqual(['กข1234']);
    expect(q.sql).toMatch(/s\.is_deleted = FALSE/);
    expect(logAudit.mock.calls.map((c) => [c[0].entityId, c[0].newValue.kind, c[0].newValue.plate_no])).toEqual([
      ['SCH0001', 'LINE_RECOVERY_UNLINKED', 'กข 1234'],
      ['SCH0002', 'LINE_RECOVERY_UNLINKED', 'กข 1234'],
    ]);
  });

  test.each([[MAIN], [ADMIN]])('%o binding is nobody else\'s news', async (user) => {
    const out = await svc.recordBindingChange(fakeDb({ user }), { userId: user.id, linked: true });
    expect(out).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('a failed alert write never throws', async () => {
    logAudit.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(svc.recordBindingChange(fakeDb({ user: TEACHER }), { userId: 11, linked: true })).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('listForSchool', () => {
  test('reads only this school\'s rows and maps them for the bell', async () => {
    const db = { query: jest.fn().mockResolvedValue([[
      { id: 7, created_at: '2026-11-13', new_value: JSON.stringify({ kind: 'LINE_RECOVERY_LINKED', subject_role: 'school', subject_name: 'ครู ป.1', grade_scope: 'ป.1' }) },
    ]]) };
    const out = await svc.listForSchool(db, 'SCH0001', { days: 14, limit: 10 });
    expect(db.query.mock.calls[0][1]).toEqual(['recovery_alert', 'SCH0001', 14, 10]);
    expect(out).toEqual([{ id: 7, created_at: '2026-11-13', kind: 'LINE_RECOVERY_LINKED', subject_role: 'school', subject_name: 'ครู ป.1', grade_scope: 'ป.1', plate_no: null }]);
  });
});

describe('the recovery router records the alert after the binding commits', () => {
  const conn = {
    query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  const router = require('../src/routes/adminPasswordRecovery.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/auth/recovery', router);

  beforeEach(() => {
    env.features.adminPasswordRecovery = true;
    env.features.recoverySchool = true;
    env.features.recoveryDriver = true;
    env.features.adminRecoveryRequireCode = false;
    pool.getConnection.mockResolvedValue(conn);
    pool.query.mockResolvedValue([[{ id: 11, username: 'teacher_p1', display_name: 'ครู', password_hash: 'h' }]]);
    bcrypt.compare.mockResolvedValue(true);
    verifyIdToken.mockResolvedValue({ valid: true, userId: 'Uline' });
    sendTextMessage.mockResolvedValue({ sent: true });
  });
  afterAll(() => {
    env.features.adminPasswordRecovery = false;
    env.features.recoverySchool = false;
    env.features.recoveryDriver = false;
  });

  test('link → linked: true', async () => {
    const res = await request(app).post('/api/auth/recovery/self/link-line')
      .set('x-test-user-id', '11').set('x-test-role', 'school')
      .send({ current_password: 'x', id_token: 'signed' });
    expect(res.status).toBe(200);
    expect(mocked.recordBindingChange).toHaveBeenCalledWith(pool, { userId: 11, linked: true });
    expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(mocked.recordBindingChange.mock.invocationCallOrder[0]);
    // The only LINE message is the binding confirmation to the binder's own LINE.
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage.mock.calls[0][0]).toBe('Uline');
  });

  test('unlink → linked: false', async () => {
    const res = await request(app).delete('/api/auth/recovery/self/line')
      .set('x-test-user-id', '11').set('x-test-role', 'school')
      .send({ current_password: 'x' });
    expect(res.status).toBe(200);
    expect(mocked.recordBindingChange).toHaveBeenCalledWith(pool, { userId: 11, linked: false });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('pending-summary carries the alerts for the school main account only', () => {
  const pendingSvc = require('../src/services/pendingQueue.service');
  const { pendingSummaryHandler } = require('../src/routes/pendingSummaryHandler');

  async function run(user) {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await pendingSummaryHandler()({ user, query: {} }, res, (e) => { throw e; });
    return res.body.data;
  }

  beforeEach(() => {
    pendingSvc.getSummary.mockResolvedValue({ total: 0, queues: [] });
    pool.query.mockResolvedValue([[{ id: 3, created_at: 'x', new_value: '{"kind":"LINE_RECOVERY_UNLINKED","subject_role":"driver","plate_no":"กข 1234"}' }]]);
  });

  test('main account gets recovery_alerts scoped by its token school', async () => {
    const data = await run({ role: 'school', scopeId: 'SCH0001', gradeScope: null });
    expect(data.recovery_alerts).toHaveLength(1);
    expect(data.recovery_alerts[0]).toMatchObject({ kind: 'LINE_RECOVERY_UNLINKED', plate_no: 'กข 1234' });
    expect(pool.query.mock.calls[0][1]).toEqual(['recovery_alert', 'SCH0001', 14, 10]);
  });

  test.each([
    [{ role: 'school', scopeId: 'SCH0001', gradeScope: 'ป.1' }],
    [{ role: 'affiliation', scopeId: 'AFF1' }],
  ])('%o gets none', async (user) => {
    const data = await run(user);
    expect(data.recovery_alerts).toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
