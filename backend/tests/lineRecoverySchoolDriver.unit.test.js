'use strict';

/**
 * LINE self-service password recovery for school main accounts, grade-teacher
 * sub-accounts and driver (vehicle) accounts — owner decision 2026-11-13.
 *
 * Exercises the real recovery router against a tiny in-memory model of the
 * three tables it reads, so "a teacher cannot recover the main school account
 * and vice versa" is tested as behaviour, not as a regex. LINE is mocked: no
 * message leaves this process.
 */

jest.mock('../src/config/database', () => {
  const pool = { query: jest.fn(), getConnection: jest.fn() };
  return { pool };
});
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    const user = global.__fixtureUsers.find((u) => u.id === id);
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
const { pool } = require('../src/config/database');
const { verifyIdToken } = require('../src/services/lineIdToken.service');
const { sendTextMessage } = require('../src/services/line.service');
const router = require('../src/routes/adminPasswordRecovery.routes');
const { SCOPE_PRESERVED_COLUMNS } = require('../src/config/accountRecoveryPolicy');
const { releaseRecoveryBinding } = require('../src/utils/recoveryBinding');
const { validateFeatureDependencies } = require('../src/config/env');

// ── fixture: one school, its main account, one grade teacher, one vehicle ────
const MAIN = { id: 10, username: 'school01', role: 'school', scope_id: 'SCH0001', grade_scope: null };
const TEACHER = { id: 11, username: 'teacher_p1', role: 'school', scope_id: 'SCH0001', grade_scope: 'ป.1' };
const DRIVER = { id: 12, username: 'กข-1234', role: 'driver', scope_id: null, grade_scope: null };
const ADMIN = { id: 1, username: 'admin01', role: 'admin', scope_id: null, grade_scope: null };
const AFFIL = { id: 13, username: 'aff01', role: 'affiliation', scope_id: 'AFF001', grade_scope: null };
global.__fixtureUsers = [MAIN, TEACHER, DRIVER, ADMIN, AFFIL];

let channels; // [{ user_id, provider_subject }]
let resetRequests; // [{ id, user_id, token_hash }]
let executed; // every SQL statement seen, for scope assertions

/**
 * Answers the statements the recovery router issues, from the fixture. Any
 * statement it does not recognise resolves to an OK packet, which is what a
 * write returns.
 */
async function fakeQuery(sql, params = []) {
  executed.push({ sql, params });
  const s = sql.replace(/\s+/g, ' ');

  // /request lookup and its locking re-read: username → bound LINE.
  if (/FROM users u JOIN user_recovery_channels rc/.test(s) && /WHERE u\.username = \?/.test(s)) {
    const [username, roles] = params;
    const user = global.__fixtureUsers.find((u) => u.username === username && roles.includes(u.role));
    const chan = user && channels.find((c) => c.user_id === user.id);
    return [[user && chan ? { id: user.id, role: user.role, display_name: user.username, provider_subject: chan.provider_subject } : undefined]];
  }
  if (/FROM users u JOIN user_recovery_channels rc/.test(s) && /WHERE u\.id = \?/.test(s)) {
    const [id, roles] = params;
    const user = global.__fixtureUsers.find((u) => u.id === id && roles.includes(u.role));
    const chan = user && channels.find((c) => c.user_id === user.id);
    return [[user && chan ? { provider_subject: chan.provider_subject } : undefined]];
  }
  // link-line: password check row.
  if (/SELECT id, username, display_name, password_hash FROM users/.test(s)) {
    const [id, role] = params;
    const user = global.__fixtureUsers.find((u) => u.id === id && u.role === role);
    return [[user ? { ...user, display_name: user.username, password_hash: 'hash' } : undefined]];
  }
  if (/INSERT INTO user_recovery_channels/.test(s)) {
    const [userId, subject] = params;
    if (channels.some((c) => c.provider_subject === subject && c.user_id !== userId)) {
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    }
    channels.push({ user_id: userId, provider_subject: subject });
    return [{ affectedRows: 1 }];
  }
  if (/DELETE FROM user_recovery_channels WHERE user_id = \?/.test(s)) {
    const before = channels.length;
    channels = channels.filter((c) => c.user_id !== params[0]);
    return [{ affectedRows: before - channels.length }];
  }
  if (/INSERT INTO password_reset_requests/.test(s)) {
    const [id, userId, tokenHash] = params;
    resetRequests.push({ id, user_id: userId, token_hash: tokenHash });
    return [{ affectedRows: 1 }];
  }
  // /complete lookup by token.
  if (/FROM password_reset_requests pr JOIN users u/.test(s)) {
    const [tokenHash, roles] = params;
    const req = resetRequests.find((r) => r.token_hash === tokenHash);
    const user = req && global.__fixtureUsers.find((u) => u.id === req.user_id && roles.includes(u.role));
    const chan = user && channels.find((c) => c.user_id === user.id);
    return [[user && chan ? {
      id: req.id, user_id: user.id, failed_attempts: 0, username: user.username,
      role: user.role, password_hash: 'old-hash', provider_subject: chan.provider_subject,
    } : undefined]];
  }
  if (/SELECT is_verified, verified_at FROM user_recovery_channels/.test(s)) {
    const chan = channels.find((c) => c.user_id === params[0]);
    return [[chan ? { is_verified: 1, verified_at: '2026-11-13T00:00:00Z' } : undefined]];
  }
  if (/SELECT COUNT\(\*\) AS remaining/.test(s)) return [[{ remaining: 0 }]];
  return [{ affectedRows: 1 }];
}

const conn = {
  query: (...a) => fakeQuery(...a),
  beginTransaction: jest.fn().mockResolvedValue(),
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
  release: jest.fn(),
};

const app = express();
app.use(express.json());
app.use('/api/auth/recovery', router);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, message: err.message }));

function setFlags({ admin = false, school = false, driver = false } = {}) {
  env.features.adminPasswordRecovery = admin;
  env.features.recoverySchool = school;
  env.features.recoveryDriver = driver;
}

beforeEach(() => {
  jest.clearAllMocks();
  channels = [];
  resetRequests = [];
  executed = [];
  pool.query.mockImplementation(fakeQuery);
  pool.getConnection.mockResolvedValue(conn);
  // Pin everything this suite depends on; the deploy runs unit tests with the
  // server's .env loaded (CLAUDE.md §14).
  setFlags({ admin: true, school: true, driver: true });
  env.features.adminRecoveryRequireCode = false;
  env.jwt.secret = 'unit-test-secret-that-is-longer-than-32-characters';
  bcrypt.compare.mockResolvedValue(false); // new password differs from old
  bcrypt.hash.mockResolvedValue('$2b$12$new-hash');
  sendTextMessage.mockResolvedValue({ sent: true });
});

afterAll(() => setFlags());

async function bind(user, lineSubject) {
  bcrypt.compare.mockResolvedValueOnce(true); // current password correct
  verifyIdToken.mockResolvedValueOnce({ valid: true, userId: lineSubject });
  return request(app)
    .post('/api/auth/recovery/self/link-line')
    .set('x-test-user-id', String(user.id))
    // A client-supplied user_id/role must be ignored.
    .send({ current_password: 'Current#Pass1', id_token: 'signed', user_id: MAIN.id, role: 'admin' });
}

function lastLinkTo(subject) {
  const calls = sendTextMessage.mock.calls.filter(([to]) => to === subject);
  return calls.length ? calls[calls.length - 1][1] : null;
}

function tokenFrom(message) {
  const m = message && message.match(/#token=([A-Za-z0-9_%-]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

describe('the flag decides which roles reach the self-service endpoints', () => {
  it.each([
    [TEACHER, { school: true }, 200],
    [MAIN, { school: true }, 200],
    [DRIVER, { driver: true }, 200],
    [TEACHER, { driver: true }, 404],
    [DRIVER, { school: true }, 404],
    [MAIN, { admin: true }, 404],
    // Gates still unconfirmed: no flag combination opens affiliation.
    [AFFIL, { admin: true, school: true, driver: true }, 404],
  ])('%o with %o → %i', async (user, flags, status) => {
    setFlags(flags);
    const res = await request(app).get('/api/auth/recovery/self/status').set('x-test-user-id', String(user.id));
    expect(res.status).toBe(status);
  });

  it('the public config reports school and driver open only with their flags', async () => {
    setFlags({ admin: true });
    let res = await request(app).get('/api/auth/recovery/config');
    expect(res.body.data.policy.enabled_roles).toEqual(['admin']);
    expect(res.body.data.policy.roles.school.blocked_reason).toBe('feature_flag_off');
    expect(res.body.data.policy.roles.driver.blocked_reason).toBe('feature_flag_off');
    expect(res.body.data.policy.roles.affiliation.blocked_reason).toBe('decision_gates_unconfirmed');

    setFlags({ admin: true, school: true, driver: true });
    res = await request(app).get('/api/auth/recovery/config');
    expect(res.body.data.policy.enabled_roles).toEqual(['admin', 'school', 'driver']);
  });

  it('with every recovery flag off the shared endpoints stay dark', async () => {
    setFlags();
    const res = await request(app).post('/api/auth/recovery/request').send({ username: TEACHER.username });
    expect(res.status).toBe(404);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('binding is per account, from the caller\'s own session', () => {
  it('binds the caller, ignoring any user_id or role in the body', async () => {
    const res = await bind(TEACHER, 'U-teacher');
    expect(res.status).toBe(200);
    expect(channels).toEqual([{ user_id: TEACHER.id, provider_subject: 'U-teacher' }]);
  });

  it('one LINE cannot hold both the teacher and the main account', async () => {
    expect((await bind(TEACHER, 'U-shared')).status).toBe(200);
    const res = await bind(MAIN, 'U-shared');
    expect(res.status).toBe(409);
    expect(channels).toEqual([{ user_id: TEACHER.id, provider_subject: 'U-shared' }]);
  });

  it('the bind confirmation addresses a driver as a vehicle account, not an administrator', async () => {
    await bind(DRIVER, 'U-driver');
    const msg = lastLinkTo('U-driver');
    expect(msg).toContain('บัญชีรถ/คนขับ');
    expect(msg).not.toContain('ผู้ดูแลระบบ School Safe Connect');
  });
});

describe('a teacher cannot recover the main school account, and vice versa', () => {
  beforeEach(async () => {
    await bind(MAIN, 'U-main');
    await bind(TEACHER, 'U-teacher');
    sendTextMessage.mockClear();
  });

  it('a request for the main account goes only to the main account\'s LINE', async () => {
    const res = await request(app).post('/api/auth/recovery/request').send({ username: MAIN.username });
    expect(res.status).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage.mock.calls[0][0]).toBe('U-main');
    expect(resetRequests.map((r) => r.user_id)).toEqual([MAIN.id]);
  });

  it('a request for the teacher goes only to the teacher\'s LINE', async () => {
    await request(app).post('/api/auth/recovery/request').send({ username: TEACHER.username });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage.mock.calls[0][0]).toBe('U-teacher');
    expect(resetRequests.map((r) => r.user_id)).toEqual([TEACHER.id]);
  });

  it('the teacher\'s link resets the teacher, and only password columns change', async () => {
    await request(app).post('/api/auth/recovery/request').send({ username: TEACHER.username });
    const token = tokenFrom(lastLinkTo('U-teacher'));
    expect(token).toBeTruthy();
    executed = [];
    const res = await request(app).post('/api/auth/recovery/complete')
      .send({ token, new_password: 'Brand#New2569pass' });
    expect(res.status).toBe(200);

    const updates = executed.filter(({ sql }) => /UPDATE users SET/.test(sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].params[updates[0].params.length - 1]).toBe(TEACHER.id);
    const setClause = updates[0].sql.match(/SET (.*) WHERE/s)[1];
    for (const col of SCOPE_PRESERVED_COLUMNS) {
      expect(setClause).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
    // No other statement in the completion writes to users at all.
    expect(executed.some(({ sql }) => /UPDATE users\b(?! SET password_hash)/.test(sql))).toBe(false);
  });

  it('nobody can use the teacher\'s LINE to reach the main account', async () => {
    channels = channels.filter((c) => c.user_id !== MAIN.id); // main never bound
    await request(app).post('/api/auth/recovery/request').send({ username: MAIN.username });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(resetRequests).toEqual([]);
  });
});

describe('driver accounts are the vehicle', () => {
  it('whoever holds the bound LINE receives the plate account\'s link', async () => {
    await bind(DRIVER, 'U-driver');
    sendTextMessage.mockClear();
    await request(app).post('/api/auth/recovery/request').send({ username: DRIVER.username });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [to, msg] = sendTextMessage.mock.calls[0];
    expect(to).toBe('U-driver');
    expect(msg).toContain(DRIVER.username);
    // ADMIN_RECOVERY_REQUIRE_CODE is false here, so no code is mentioned.
    expect(msg).not.toContain('รหัสกู้คืน');
  });

  it('closed again the moment the driver flag goes off', async () => {
    await bind(DRIVER, 'U-driver');
    sendTextMessage.mockClear();
    setFlags({ admin: true, school: true, driver: false });
    await request(app).post('/api/auth/recovery/request').send({ username: DRIVER.username });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('revocation: a reset by someone else releases the binding', () => {
  it('releaseRecoveryBinding clears channel, codes and pending requests', async () => {
    channels = [{ user_id: TEACHER.id, provider_subject: 'U-teacher' }, { user_id: MAIN.id, provider_subject: 'U-main' }];
    const released = await releaseRecoveryBinding(conn, TEACHER.id);
    expect(released).toBe(1);
    expect(channels).toEqual([{ user_id: MAIN.id, provider_subject: 'U-main' }]);
    const sqls = executed.map(({ sql }) => sql);
    expect(sqls).toEqual(expect.arrayContaining([
      expect.stringContaining('DELETE FROM password_reset_requests WHERE user_id = ? AND used_at IS NULL'),
      expect.stringContaining('DELETE FROM user_recovery_codes WHERE user_id = ?'),
      expect.stringContaining('DELETE FROM user_recovery_channels WHERE user_id = ?'),
    ]));
    expect(sqls.some((s) => /UPDATE users/.test(s))).toBe(false);
  });

  it('after release, the former holder\'s LINE gets nothing', async () => {
    await bind(TEACHER, 'U-former-teacher');
    await releaseRecoveryBinding(conn, TEACHER.id);
    sendTextMessage.mockClear();
    await request(app).post('/api/auth/recovery/request').send({ username: TEACHER.username });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  // Each reset path that can target a school or driver account calls the
  // helper inside its transaction.
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const slice = (src, start, end) => {
    const i = src.indexOf(start);
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf(end, i + start.length);
    return src.slice(i, j > i ? j : undefined);
  };

  it.each([
    ['school teacher reset', 'src/routes/school.routes.js', "router.post('/teacher-accounts/:id/reset-password'", 'router.delete('],
    ['school teacher delete', 'src/routes/school.routes.js', "router.delete('/teacher-accounts/:id'", 'router.post('],
    ['admin reset', 'src/routes/admin.routes.js', "router.post('/users/:id/reset-password'", 'router.delete('],
    ['affiliation main-account reset', 'src/services/affiliationUsers.service.js', 'async function resetMainPassword', 'async function deleteMainAccount'],
    ['affiliation legacy school reset', 'src/services/affiliationAdmin.service.js', 'async function resetSchoolPassword', '\nasync function '],
  ])('%s', (_label, file, start, end) => {
    const body = slice(read(file), start, end);
    expect(body).toMatch(/releaseRecoveryBinding\(conn, \w+\)/);
    expect(body).toMatch(/beginTransaction/);
    expect(body).toMatch(/commit\(\)/);
    expect(body).toMatch(/rollback\(\)/);
  });

  it('admin reset releases only for school and driver targets', () => {
    const body = slice(read('src/routes/admin.routes.js'), "router.post('/users/:id/reset-password'", 'router.delete(');
    expect(body).toMatch(/const releasesBinding = user\.role === 'school' \|\| user\.role === 'driver';/);
  });
});

describe('the new flags need the same LINE prerequisites as admin recovery', () => {
  it.each(['FEATURE_RECOVERY_SCHOOL', 'FEATURE_RECOVERY_DRIVER'])('%s', (flag) => {
    const base = { [flag]: 'true' };
    expect(() => validateFeatureDependencies(base)).toThrow(new RegExp(`${flag} requires LINE_LIFF_ID`));
    expect(() => validateFeatureDependencies({ ...base, LINE_LIFF_ID: 'x' }))
      .toThrow(new RegExp(`${flag} requires LINE_CHANNEL_ACCESS_TOKEN`));
    expect(validateFeatureDependencies({
      ...base, LINE_LIFF_ID: 'x', LINE_CHANNEL_ACCESS_TOKEN: 't', PUBLIC_APP_URL: 'https://schoolbuslampang.com',
    })).toBe(true);
  });
});
