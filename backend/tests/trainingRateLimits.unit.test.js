'use strict';

/**
 * Training-room rate limits (2026-11).
 *
 * 40-60 teachers in one room share ONE public IP. These tests drive the real
 * express-rate-limit instances (or limiters built from the exact same factory
 * and budgets, with the NODE_ENV=test skip turned off) and prove:
 *   - 60 distinct users behind one IP are not throttled by the operator floor,
 *     the export limiters, or the refresh limiter;
 *   - a single user exceeding the per-user budget is still throttled;
 *   - forged/unsigned tokens can't mint fresh buckets (they fall back to IP);
 *   - failed logins are still limited per IP, successful logins are not counted;
 *   - the per-(username+IP) lock still applies in front of the login handler.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-training-rate-limits-0123456789';

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/sharedSecurityState', () => {
  const actual = jest.requireActual('../src/utils/sharedSecurityState');
  return {
    ...actual,
    isLoginLocked: jest.fn().mockResolvedValue(false),
    noteLoginFail: jest.fn().mockResolvedValue(undefined),
    clearLoginFails: jest.fn().mockResolvedValue(undefined),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const {
  createUserKeyedLimiter,
  userOrIpKey,
  refreshTokenKey,
  GLOBAL_API_BUDGET,
  REPORT_EXPORT_BUDGET,
  IMPORT_EXPORT_BUDGET,
} = require('../src/middleware/rateLimiters');
const authRoutes = require('../src/routes/auth.routes');
const sharedSecurity = require('../src/utils/sharedSecurityState');

const SECRET = process.env.JWT_SECRET;
const ROOM_IP = '203.0.113.7';

function accessToken(id) {
  return jwt.sign({ sub: id, role: 'school', username: `teacher${id}` }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}
function refreshToken(id) {
  return jwt.sign({ sub: id, type: 'refresh', jti: `jti-${id}-${Math.random()}` }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

function appWith(limiter, handler = (_req, res) => res.status(200).json({ ok: true })) {
  const app = express();
  app.set('trust proxy', 1); // lets tests pin the client IP via X-Forwarded-For
  app.use(express.json());
  app.use('/t', limiter, handler);
  return app;
}

async function hit(app, { token, ip = ROOM_IP, body, method = 'get' } = {}) {
  let r = request(app)[method]('/t').set('X-Forwarded-For', ip);
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (body) r = r.send(body);
  return r;
}

describe('key generators', () => {
  test('valid access token keys by user id; missing/forged/refresh tokens key by IP', () => {
    const base = { ip: ROOM_IP, headers: {} };
    expect(userOrIpKey({ ...base, headers: { authorization: `Bearer ${accessToken(42)}` } })).toBe('u:42');
    expect(userOrIpKey(base)).toBe(`ip:${ROOM_IP}`);

    const forged = jwt.sign({ sub: 99 }, 'some-other-secret', { algorithm: 'HS256' });
    expect(userOrIpKey({ ...base, headers: { authorization: `Bearer ${forged}` } })).toBe(`ip:${ROOM_IP}`);

    const unsigned = jwt.sign({ sub: 99 }, null, { algorithm: 'none' });
    expect(userOrIpKey({ ...base, headers: { authorization: `Bearer ${unsigned}` } })).toBe(`ip:${ROOM_IP}`);

    expect(userOrIpKey({ ...base, headers: { authorization: `Bearer ${refreshToken(5)}` } })).toBe(`ip:${ROOM_IP}`);
  });

  test('IPv6 fallback is collapsed to a prefix (ipKeyGenerator)', () => {
    const a = userOrIpKey({ ip: '2001:db8:abcd:12::1', headers: {} });
    const b = userOrIpKey({ ip: '2001:db8:abcd:12::ffff', headers: {} });
    expect(a).toBe(b);
  });

  test('refresh key uses the verified refresh-token subject, else IP', () => {
    expect(refreshTokenKey({ ip: ROOM_IP, body: { refresh_token: refreshToken(7) } })).toBe('r:7');
    expect(refreshTokenKey({ ip: ROOM_IP, body: { refresh_token: accessToken(7) } })).toBe(`ip:${ROOM_IP}`);
    expect(refreshTokenKey({ ip: ROOM_IP, body: { refresh_token: 'garbage' } })).toBe(`ip:${ROOM_IP}`);
    expect(refreshTokenKey({ ip: ROOM_IP, body: {} })).toBe(`ip:${ROOM_IP}`);
  });
});

describe('global API floor (120/min per user)', () => {
  const make = () => createUserKeyedLimiter({ ...GLOBAL_API_BUDGET, skipInTest: false });

  test('60 users from one IP, 10 requests each (600 > old 120/IP budget), none throttled', async () => {
    const app = appWith(make());
    for (let user = 1; user <= 60; user += 1) {
      const token = accessToken(user);
      for (let i = 0; i < 10; i += 1) {
        const res = await hit(app, { token });
        expect(res.status).toBe(200);
      }
    }
  });

  test('one user exceeding 120/min is throttled; another user on the same IP is not', async () => {
    const app = appWith(make());
    const token = accessToken(1);
    for (let i = 0; i < GLOBAL_API_BUDGET.max; i += 1) {
      expect((await hit(app, { token })).status).toBe(200);
    }
    const blocked = await hit(app, { token });
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect((await hit(app, { token: accessToken(2) })).status).toBe(200);
  });

  test('forged tokens cannot rotate buckets: they share the IP budget', async () => {
    const app = appWith(make());
    for (let i = 0; i < GLOBAL_API_BUDGET.max; i += 1) {
      const forged = jwt.sign({ sub: 1000 + i }, 'attacker-secret', { algorithm: 'HS256' });
      expect((await hit(app, { token: forged })).status).toBe(200);
    }
    const forged = jwt.sign({ sub: 9999 }, 'attacker-secret', { algorithm: 'HS256' });
    expect((await hit(app, { token: forged })).status).toBe(429);
  });

  test('the app mounts user-keyed limiters for the floor and /api/reports', () => {
    const app = require('../src/app');
    expect(typeof app.globalApiLimiter).toBe('function');
    expect(typeof app.exportLimiter).toBe('function');
  });
});

describe('export / import limiters (40 / 5 min per user)', () => {
  test.each([
    ['reports exportLimiter', REPORT_EXPORT_BUDGET],
    ['importExportLimiter', IMPORT_EXPORT_BUDGET],
  ])('%s: 60 users x 2 exports from one IP pass; one user over budget is throttled', async (_name, budget) => {
    const app = appWith(createUserKeyedLimiter({ ...budget, skipInTest: false }));
    for (let user = 1; user <= 60; user += 1) {
      const token = accessToken(user);
      expect((await hit(app, { token })).status).toBe(200);
      expect((await hit(app, { token })).status).toBe(200);
    }
    const heavy = accessToken(500);
    for (let i = 0; i < budget.max; i += 1) {
      expect((await hit(app, { token: heavy })).status).toBe(200);
    }
    expect((await hit(app, { token: heavy })).status).toBe(429);
  });
});

describe('refresh limiter (30 / 5 min per refresh-token subject)', () => {
  test('60 users refreshing from one IP are not throttled; one user over 30 is', async () => {
    const app = appWith(authRoutes.refreshLimiter);
    for (let user = 1; user <= 60; user += 1) {
      const res = await hit(app, { method: 'post', body: { refresh_token: refreshToken(user) } });
      expect(res.status).toBe(200);
    }
    for (let i = 0; i < 30; i += 1) {
      expect((await hit(app, { method: 'post', body: { refresh_token: refreshToken(777) } })).status).toBe(200);
    }
    expect((await hit(app, { method: 'post', body: { refresh_token: refreshToken(777) } })).status).toBe(429);
  });
});

describe('login limiter (failed attempts only, 60 / 15 min per IP)', () => {
  // Stand-in handler: "good" password succeeds, anything else is a 401 — the
  // limiter only looks at the response status.
  const loginHandler = (req, res) => (req.body && req.body.password === 'good'
    ? res.status(200).json({ success: true })
    : res.status(401).json({ success: false }));

  test('budget is 60 failures and successful logins are skipped', () => {
    expect(authRoutes.LOGIN_LIMIT.MAX_FAILURES).toBe(60);
  });

  test('a room of 60 successful logins (plus re-logins) is never counted', async () => {
    const app = appWith(authRoutes.loginLimiter, loginHandler);
    for (let i = 0; i < 150; i += 1) {
      const res = await hit(app, { method: 'post', ip: '198.51.100.1', body: { username: `t${i % 60}`, password: 'good' } });
      expect(res.status).toBe(200);
    }
    // The IP still has its full failure budget afterwards.
    for (let i = 0; i < 60; i += 1) {
      expect((await hit(app, { method: 'post', ip: '198.51.100.1', body: { username: 'x', password: 'bad' } })).status).toBe(401);
    }
  });

  test('failed logins are still limited per IP: the 61st failure gets 429', async () => {
    const app = appWith(authRoutes.loginLimiter, loginHandler);
    for (let i = 0; i < 60; i += 1) {
      expect((await hit(app, { method: 'post', ip: '198.51.100.2', body: { username: `u${i}`, password: 'bad' } })).status).toBe(401);
    }
    const blocked = await hit(app, { method: 'post', ip: '198.51.100.2', body: { username: 'u61', password: 'good' } });
    expect(blocked.status).toBe(429);
    // A different IP is unaffected.
    expect((await hit(app, { method: 'post', ip: '198.51.100.9', body: { password: 'good' } })).status).toBe(200);
  });
});

describe('per-(username+IP) lock still guards the real login route', () => {
  test('LOGIN_LOCK threshold is 10 failures / 15 min', () => {
    expect(sharedSecurity.LOGIN_LOCK).toEqual({ THRESHOLD: 10, WINDOW_SEC: 15 * 60 });
  });

  test('a locked username+IP gets 429 before any password check, keyed by username and IP', async () => {
    const { pool } = require('../src/config/database');
    pool.query.mockReset();
    sharedSecurity.isLoginLocked.mockResolvedValueOnce(true);

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.0.2.43')
      .send({ username: 'teacher1', password: 'whatever' });

    expect(res.status).toBe(429);
    expect(pool.query).not.toHaveBeenCalled();
    expect(sharedSecurity.isLoginLocked).toHaveBeenCalledWith(sharedSecurity.loginLockKey('teacher1', '192.0.2.43'));
  });

  test('a wrong password records a failure against the username+IP lock key', async () => {
    const { pool } = require('../src/config/database');
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce([[{
      id: 1, username: 'teacher2', password_hash: '$2b$04$abcdefghijklmnopqrstuuJ8m1Xq4qkqv0O9Gd3m9oQ0a8m5r5l9e',
      role: 'school', is_active: 1, is_deleted: 0,
    }]]);
    sharedSecurity.noteLoginFail.mockClear();

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.0.2.44')
      .send({ username: 'teacher2', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(sharedSecurity.noteLoginFail).toHaveBeenCalledWith(sharedSecurity.loginLockKey('teacher2', '192.0.2.44'));
  });
});
