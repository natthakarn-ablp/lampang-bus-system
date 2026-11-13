'use strict';

/**
 * LINE self-service password recovery for province, affiliation and transport
 * (unit) accounts — owner decision 2026-11-13.
 *
 * Decision: these are office accounts. Whoever holds the account binds their
 * own LINE while signed in; at handover the account that manages it resets the
 * password (province ← admin; affiliation and transport ← province or admin),
 * and that reset releases the LINE binding in the same transaction. Deleting
 * or deactivating a unit account releases it too.
 *
 * Covered here, as behaviour against an in-memory model of the recovery
 * tables (no database):
 *   - role × flag matrix on the real recovery router;
 *   - the binding is released on every reset / delete / deactivate path for
 *     these roles, inside the transaction that makes the change;
 *   - LINE is mocked throughout, and no reset path sends a LINE message.
 */

jest.mock('../src/config/database', () => {
  const pool = { query: jest.fn(), getConnection: jest.fn() };
  return { pool };
});
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    const user = global.__unitFixtureUsers.find((u) => u.id === id);
    if (!user) return next(Object.assign(new Error('no user'), { status: 401 }));
    req.user = { id: user.id, username: user.username, role: user.role };
    return next();
  },
}));
jest.mock('../src/services/lineIdToken.service', () => ({ verifyIdToken: jest.fn() }));
jest.mock('../src/services/line.service', () => ({ sendTextMessage: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const { validateFeatureDependencies } = require('../src/config/env');
const { pool } = require('../src/config/database');
const { verifyIdToken } = require('../src/services/lineIdToken.service');
const { sendTextMessage } = require('../src/services/line.service');
const { logAudit } = require('../src/utils/audit');
const recoveryRouter = require('../src/routes/adminPasswordRecovery.routes');
const adminRouter = require('../src/routes/admin.routes');
const provAdmin = require('../src/services/provinceAdmin.service');
const org = require('../src/services/orgEntities.service');
const { ROLE_POLICIES } = require('../src/config/accountRecoveryPolicy');

// ── fixture ─────────────────────────────────────────────────────────────────
const ADMIN = { id: 1, username: 'admin01', role: 'admin', scope_id: null, is_active: 1 };
const PROV = { id: 20, username: 'province01', role: 'province', scope_id: 'LPG', is_active: 1 };
const AFF = { id: 21, username: 'aff01', role: 'affiliation', scope_id: 'AFF001', is_active: 1 };
const TRN = { id: 22, username: 'transport01', role: 'transport', scope_id: null, is_active: 1 };
const SCHOOL = { id: 23, username: 'school01', role: 'school', scope_id: 'SCH0001', is_active: 1 };
const UNITS = [PROV, AFF, TRN];
global.__unitFixtureUsers = [ADMIN, PROV, AFF, TRN, SCHOOL];

const FLAG_KEY = { province: 'recoveryProvince', affiliation: 'recoveryAffiliation', transport: 'recoveryTransport' };

let channels; // [{ user_id, provider_subject }]
let codes; // [{ user_id }]
let resetRequests; // [{ id, user_id, token_hash, used_at }]
let executed; // [{ sql, params, inTx }]
let inTx;

function userById(id) {
  return global.__unitFixtureUsers.find((u) => u.id === Number(id));
}

async function fakeQuery(sql, params = []) {
  executed.push({ sql, params, inTx });
  const s = sql.replace(/\s+/g, ' ');

  // ── recovery router ──────────────────────────────────────────────────────
  if (/FROM users u JOIN user_recovery_channels rc/.test(s) && /WHERE u\.username = \?/.test(s)) {
    const [username, roles] = params;
    const user = global.__unitFixtureUsers.find((u) => u.username === username && roles.includes(u.role));
    const chan = user && channels.find((c) => c.user_id === user.id);
    return [[user && chan ? { id: user.id, role: user.role, display_name: user.username, provider_subject: chan.provider_subject } : undefined]];
  }
  if (/FROM users u JOIN user_recovery_channels rc/.test(s) && /WHERE u\.id = \?/.test(s)) {
    const [id, roles] = params;
    const user = global.__unitFixtureUsers.find((u) => u.id === id && roles.includes(u.role));
    const chan = user && channels.find((c) => c.user_id === user.id);
    return [[user && chan ? { provider_subject: chan.provider_subject } : undefined]];
  }
  if (/SELECT id, username, display_name, password_hash FROM users/.test(s)) {
    const [id, role] = params;
    const user = global.__unitFixtureUsers.find((u) => u.id === id && u.role === role);
    return [[user ? { ...user, display_name: user.username, password_hash: 'hash' } : undefined]];
  }
  if (/SELECT is_verified, verified_at FROM user_recovery_channels/.test(s)) {
    const chan = channels.find((c) => c.user_id === params[0]);
    return [[chan ? { is_verified: 1, verified_at: '2026-11-13T00:00:00Z' } : undefined]];
  }
  if (/SELECT COUNT\(\*\) AS remaining/.test(s)) return [[{ remaining: 0 }]];
  if (/INSERT INTO user_recovery_channels/.test(s)) {
    const [userId, subject] = params;
    if (channels.some((c) => c.provider_subject === subject && c.user_id !== userId)) {
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    }
    channels.push({ user_id: userId, provider_subject: subject });
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO password_reset_requests/.test(s)) {
    const [id, userId, tokenHash] = params;
    resetRequests.push({ id, user_id: userId, token_hash: tokenHash, used_at: null });
    return [{ affectedRows: 1 }];
  }

  // ── binding release (utils/recoveryBinding.js) ───────────────────────────
  if (/DELETE FROM user_recovery_channels WHERE user_id = \?/.test(s)) {
    const before = channels.length;
    channels = channels.filter((c) => c.user_id !== params[0]);
    return [{ affectedRows: before - channels.length }];
  }
  if (/DELETE FROM user_recovery_codes WHERE user_id = \?/.test(s)) {
    const before = codes.length;
    codes = codes.filter((c) => c.user_id !== params[0]);
    return [{ affectedRows: before - codes.length }];
  }
  if (/DELETE FROM password_reset_requests WHERE user_id = \? AND used_at IS NULL/.test(s)) {
    const before = resetRequests.length;
    resetRequests = resetRequests.filter((r) => r.user_id !== params[0] || r.used_at);
    return [{ affectedRows: before - resetRequests.length }];
  }

  // ── account lookups (admin routes, provinceAdmin, orgEntities) ───────────
  if (/FROM affiliations WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(s)) {
    return [[{ id: params[0], name: 'สังกัดทดสอบ' }]];
  }
  if (/COUNT\(\*\) AS n FROM schools WHERE affiliation_id = \?/.test(s)) return [[{ n: 0 }]];
  if (/SELECT id FROM users WHERE role = 'affiliation' AND scope_type = 'AFFILIATION'/.test(s)) {
    return [global.__unitFixtureUsers.filter((u) => u.role === 'affiliation' && u.scope_id === params[0]).map((u) => ({ id: u.id }))];
  }
  if (/FROM affiliations WHERE id = \? AND is_deleted = FALSE/.test(s)) return [[{ id: params[0] }]];
  if (/^\s*SELECT [^;]* FROM users WHERE id = \?/.test(s)) {
    const user = userById(params[0]);
    if (!user) return [[]];
    if (/role IN \(\?\)/.test(s) && !params[1].includes(user.role)) return [[]];
    // findManaged(…, { deleted: true }) asks for is_deleted = TRUE.
    if (/is_deleted = \?/.test(s) && params[2] === true) return [[]];
    return [[{ ...user, display_name: user.username, scope_type: null, grade_scope: null, driver_id: null }]];
  }
  if (/INSERT INTO/.test(s)) return [{ insertId: 77, affectedRows: 1 }];
  return [{ affectedRows: 1 }];
}

const conn = {
  query: (...a) => fakeQuery(...a),
  beginTransaction: jest.fn(async () => { inTx = true; }),
  commit: jest.fn(async () => { inTx = false; }),
  rollback: jest.fn(async () => { inTx = false; }),
  release: jest.fn(),
};

const app = express();
app.use(express.json());
app.use('/api/auth/recovery', recoveryRouter);
app.use('/api/admin', adminRouter);
app.use((err, _req, res, _next) => res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message }));

function setFlags(on = {}) {
  env.features.adminPasswordRecovery = Boolean(on.admin);
  env.features.recoverySchool = Boolean(on.school);
  env.features.recoveryDriver = Boolean(on.driver);
  env.features.recoveryProvince = Boolean(on.province);
  env.features.recoveryAffiliation = Boolean(on.affiliation);
  env.features.recoveryTransport = Boolean(on.transport);
}

beforeEach(() => {
  jest.clearAllMocks();
  channels = [];
  codes = [];
  resetRequests = [];
  executed = [];
  inTx = false;
  pool.query.mockImplementation((...a) => fakeQuery(...a));
  pool.getConnection.mockResolvedValue(conn);
  setFlags({ province: true, affiliation: true, transport: true });
  env.features.adminRecoveryRequireCode = false;
  env.jwt.secret = 'unit-test-secret-that-is-longer-than-32-characters';
  bcrypt.compare.mockResolvedValue(false);
  bcrypt.hash.mockResolvedValue('$2b$12$new-hash');
  sendTextMessage.mockResolvedValue({ sent: true });
});

afterAll(() => setFlags());

async function bind(user, lineSubject) {
  bcrypt.compare.mockResolvedValueOnce(true);
  verifyIdToken.mockResolvedValueOnce({ valid: true, userId: lineSubject });
  return request(app)
    .post('/api/auth/recovery/self/link-line')
    .set('x-test-user-id', String(user.id))
    .send({ current_password: 'Current#Pass1', id_token: 'signed', user_id: ADMIN.id, role: 'admin' });
}

/** Seed a binding directly (as if bound earlier), plus codes and a pending request. */
function seedBinding(user, subject = `U-${user.username}`) {
  channels.push({ user_id: user.id, provider_subject: subject });
  codes.push({ user_id: user.id });
  resetRequests.push({ id: `req-${user.id}`, user_id: user.id, token_hash: 'x', used_at: null });
}

/** The three release DELETEs for `userId` all ran inside a transaction. */
function expectReleasedInTx(userId) {
  for (const re of [
    /DELETE FROM password_reset_requests WHERE user_id = \? AND used_at IS NULL/,
    /DELETE FROM user_recovery_codes WHERE user_id = \?/,
    /DELETE FROM user_recovery_channels WHERE user_id = \?/,
  ]) {
    const hit = executed.find((e) => re.test(e.sql) && e.params[0] === userId);
    expect(hit).toBeDefined();
    expect(hit.inTx).toBe(true);
  }
  expect(channels.some((c) => c.user_id === userId)).toBe(false);
  expect(codes.some((c) => c.user_id === userId)).toBe(false);
  expect(resetRequests.some((r) => r.user_id === userId && !r.used_at)).toBe(false);
  expect(conn.commit).toHaveBeenCalled();
}

// ─── 1. role × flag matrix ──────────────────────────────────────────────────
describe('role × flag matrix on the real recovery router', () => {
  const ROLES = ['province', 'affiliation', 'transport'];
  const OWNER = { province: PROV, affiliation: AFF, transport: TRN };
  const cases = [];
  for (const role of ROLES) {
    for (const flagRole of [...ROLES, 'admin', 'school', 'driver']) {
      cases.push([role, flagRole, role === flagRole ? 200 : 404]);
    }
    cases.push([role, 'none', 404]);
  }

  it.each(cases)('%s account with only the %s flag on → %i', async (role, flagRole, status) => {
    setFlags(flagRole === 'none' ? {} : { [flagRole]: true });
    const res = await request(app).get('/api/auth/recovery/self/status')
      .set('x-test-user-id', String(OWNER[role].id));
    expect(res.status).toBe(status);
  });

  it('the public config lists exactly the unit roles whose flag is on', async () => {
    setFlags({});
    let res = await request(app).get('/api/auth/recovery/config');
    for (const role of ROLES) {
      expect(res.body.data.policy.roles[role].blocked_reason).toBe('feature_flag_off');
      expect(res.body.data.policy.roles[role].gates_confirmed).toBe(true);
    }
    setFlags({ affiliation: true });
    res = await request(app).get('/api/auth/recovery/config');
    expect(res.body.data.policy.enabled_roles).toEqual(['affiliation']);
    setFlags({ province: true, affiliation: true, transport: true });
    res = await request(app).get('/api/auth/recovery/config');
    expect(res.body.data.policy.enabled_roles).toEqual(['province', 'affiliation', 'transport']);
  });

  it('a unit flag never opens school, driver or admin', async () => {
    setFlags({ province: true, affiliation: true, transport: true });
    const res = await request(app).get('/api/auth/recovery/self/status').set('x-test-user-id', String(SCHOOL.id));
    expect(res.status).toBe(404);
  });

  it('every policy flag is overlaid from env.features', () => {
    for (const role of ROLES) {
      setFlags({ [role]: true });
      const source = recoveryRouter.recoveryEnvSource();
      expect(source[ROLE_POLICIES[role].envFlag]).toBe('true');
      expect(env.features[FLAG_KEY[role]]).toBe(true);
    }
  });
});

// ─── 2. bind + request, LINE mocked ─────────────────────────────────────────
describe('the holder binds their own LINE and receives the link', () => {
  it.each([
    [AFF, 'บัญชีสังกัด', 'จังหวัดหรือผู้ดูแลระบบ'],
    [TRN, 'บัญชีขนส่ง', 'จังหวัดหรือผู้ดูแลระบบ'],
    [PROV, 'บัญชีจังหวัด', 'ผู้ดูแลระบบ'],
  ])('%o', async (user, label, reportTo) => {
    const subject = `U-${user.username}`;
    expect((await bind(user, subject)).status).toBe(200);
    // Bound to the caller's own session, whatever the body claimed.
    expect(channels).toEqual([{ user_id: user.id, provider_subject: subject }]);
    sendTextMessage.mockClear();

    const res = await request(app).post('/api/auth/recovery/request').send({ username: user.username });
    expect(res.status).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [to, msg] = sendTextMessage.mock.calls[0];
    expect(to).toBe(subject); // mocked: nothing leaves this process
    expect(msg).toContain(label);
    expect(msg).toContain(user.username);
    expect(msg).toContain(`กรุณาแจ้ง${reportTo}`);
  });

  it('no request is sent while the role\'s flag is off', async () => {
    seedBinding(AFF);
    setFlags({ province: true, transport: true });
    await request(app).post('/api/auth/recovery/request').send({ username: AFF.username });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

// ─── 3. every reset / delete / deactivate path releases the binding ─────────
describe('handover: resets by the managing account release the binding', () => {
  it.each([PROV, AFF, TRN])('admin reset of %o releases in the reset transaction', async (user) => {
    seedBinding(user);
    const res = await request(app).post(`/api/admin/users/${user.id}/reset-password`)
      .set('x-test-user-id', String(ADMIN.id)).send({ password: 'Brand#New2569pass' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ recovery_channels_released: 1 });
    const update = executed.find((e) => /UPDATE users SET password_hash = \?/.test(e.sql));
    expect(update.inTx).toBe(true);
    expectReleasedInTx(user.id);
    expect(logAudit.mock.calls[0][0].conn).toBe(conn);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('admin reset of an admin still leaves the binding alone', async () => {
    const other = { id: 2, username: 'admin02', role: 'admin', is_active: 1 };
    global.__unitFixtureUsers.push(other);
    try {
      seedBinding(other);
      const res = await request(app).post(`/api/admin/users/${other.id}/reset-password`)
        .set('x-test-user-id', String(ADMIN.id)).send({ password: 'Brand#New2569pass' });
      expect(res.status).toBe(200);
      expect(channels.some((c) => c.user_id === other.id)).toBe(true);
    } finally {
      global.__unitFixtureUsers.pop();
    }
  });

  it.each([AFF, TRN])('province reset of %o releases in the reset transaction', async (user) => {
    seedBinding(user);
    const out = await provAdmin.resetUnitAccountPassword({
      accountId: user.id, newPassword: 'Brand#New2569pass', userId: PROV.id,
    });
    expect(out.recovery_channels_released).toBe(1);
    const update = executed.find((e) => /UPDATE users SET password_hash = \?/.test(e.sql.replace(/\s+/g, ' ')));
    expect(update.inTx).toBe(true);
    expectReleasedInTx(user.id);
    const audit = logAudit.mock.calls[0][0];
    expect(audit.conn).toBe(conn);
    expect(audit.newValue).toMatchObject({ recovery_channels_released: 1, by_role: 'province' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('the province cannot reset (or release) a province account', async () => {
    seedBinding(PROV);
    await expect(provAdmin.resetUnitAccountPassword({
      accountId: PROV.id, newPassword: 'Brand#New2569pass', userId: PROV.id,
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(channels.some((c) => c.user_id === PROV.id)).toBe(true);
  });

  it('a failed reset rolls the release back with it', async () => {
    seedBinding(AFF);
    logAudit.mockRejectedValueOnce(new Error('audit down'));
    await expect(provAdmin.resetUnitAccountPassword({
      accountId: AFF.id, newPassword: 'Brand#New2569pass', userId: PROV.id,
    })).rejects.toThrow('audit down');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe('delete and deactivate release the binding too', () => {
  it.each([PROV, AFF, TRN])('admin delete of %o', async (user) => {
    seedBinding(user);
    const res = await request(app).delete(`/api/admin/users/${user.id}`).set('x-test-user-id', String(ADMIN.id));
    expect(res.status).toBe(200);
    expectReleasedInTx(user.id);
  });

  it.each([PROV, AFF, TRN])('admin deactivate of %o', async (user) => {
    seedBinding(user);
    const res = await request(app).put(`/api/admin/users/${user.id}`)
      .set('x-test-user-id', String(ADMIN.id)).send({ is_active: false });
    expect(res.status).toBe(200);
    const update = executed.find((e) => /UPDATE users SET is_active = \?/.test(e.sql));
    expect(update.inTx).toBe(true);
    expectReleasedInTx(user.id);
    expect(logAudit.mock.calls[0][0].newValue).toMatchObject({ recovery_channels_released: 1 });
  });

  it('admin rename of a unit account keeps the binding', async () => {
    seedBinding(AFF);
    const res = await request(app).put(`/api/admin/users/${AFF.id}`)
      .set('x-test-user-id', String(ADMIN.id)).send({ display_name: 'ชื่อใหม่' });
    expect(res.status).toBe(200);
    expect(channels.some((c) => c.user_id === AFF.id)).toBe(true);
  });

  it.each([AFF, TRN])('province delete of %o', async (user) => {
    seedBinding(user);
    const out = await provAdmin.deleteUnitAccount(pool, { accountId: user.id, actorId: PROV.id });
    expect(out.recovery_channels_released).toBe(1);
    expectReleasedInTx(user.id);
  });

  it.each([AFF, TRN])('province deactivate of %o', async (user) => {
    seedBinding(user);
    const out = await provAdmin.updateUnitAccount(pool, { accountId: user.id, isActive: false, actorId: PROV.id });
    expect(out.recovery_channels_released).toBe(1);
    const update = executed.find((e) => /UPDATE users SET is_active = \?/.test(e.sql));
    expect(update.inTx).toBe(true);
    expectReleasedInTx(user.id);
  });

  it('province rename keeps the binding', async () => {
    seedBinding(TRN);
    await provAdmin.updateUnitAccount(pool, { accountId: TRN.id, displayName: 'ขนส่งใหม่', actorId: PROV.id });
    expect(channels.some((c) => c.user_id === TRN.id)).toBe(true);
  });

  it('closing an affiliation releases the binding of each account it deactivates', async () => {
    seedBinding(AFF);
    const out = await org.deactivateAffiliation(pool, { id: 'AFF001', actorId: PROV.id });
    expect(out.accounts_deactivated).toBe(1);
    expectReleasedInTx(AFF.id);
    expect(logAudit.mock.calls[0][0].newValue).toMatchObject({ recovery_channels_released: 1 });
  });

  it('after release, the former holder\'s LINE gets nothing', async () => {
    seedBinding(TRN, 'U-former');
    await provAdmin.resetUnitAccountPassword({ accountId: TRN.id, newPassword: 'Brand#New2569pass', userId: PROV.id });
    sendTextMessage.mockClear();
    await request(app).post('/api/auth/recovery/request').send({ username: TRN.username });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

// ─── 4. startup checks ──────────────────────────────────────────────────────
describe('the unit flags need the same LINE prerequisites as admin recovery', () => {
  it.each(['FEATURE_RECOVERY_PROVINCE', 'FEATURE_RECOVERY_AFFILIATION', 'FEATURE_RECOVERY_TRANSPORT'])('%s', (flag) => {
    const base = { [flag]: 'true' };
    expect(() => validateFeatureDependencies(base)).toThrow(new RegExp(`${flag} requires LINE_LIFF_ID`));
    expect(() => validateFeatureDependencies({ ...base, LINE_LIFF_ID: 'x' }))
      .toThrow(new RegExp(`${flag} requires LINE_CHANNEL_ACCESS_TOKEN`));
    expect(() => validateFeatureDependencies({
      ...base, LINE_LIFF_ID: 'x', LINE_CHANNEL_ACCESS_TOKEN: 't', PUBLIC_APP_URL: 'http://insecure.example',
    })).toThrow(/HTTPS/);
    expect(validateFeatureDependencies({
      ...base, LINE_LIFF_ID: 'x', LINE_CHANNEL_ACCESS_TOKEN: 't', PUBLIC_APP_URL: 'https://schoolbuslampang.com',
    })).toBe(true);
  });

  it('the migration-049 boot check covers the unit flags', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const i = src.indexOf('async function assertAdminRecoveryMigrationPresent');
    const body = src.slice(i, src.indexOf('\n}\n', i));
    for (const key of ['recoveryProvince', 'recoveryAffiliation', 'recoveryTransport']) {
      expect(body).toContain(`env.features.${key}`);
    }
  });
});
