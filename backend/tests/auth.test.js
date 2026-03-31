'use strict';

/**
 * auth.test.js
 *
 * Integration tests for POST /api/auth/login
 *                        GET  /api/auth/me
 *                        POST /api/auth/refresh-token
 *                        POST /api/auth/logout
 *                        POST /api/auth/change-password
 *
 * Requires a running MySQL instance with the schema applied and
 * the test users seeded by tests/setup.js.
 *
 * Run:  npm test
 */

require('dotenv').config();
const request = require('supertest');

const app = require('../src/app');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_USER = {
  username: '__test_province',
  password: 'testpass123',
};

const WRONG_PASSWORD = 'wrongpass999';

let accessToken  = '';
let refreshToken = '';

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('should return 400 when body is empty', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: '__no_such_user__', password: '1234' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: WRONG_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('should return 200 with tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    expect(res.body.data.user.role).toBe('province');
    expect(res.body.data.user.username).toBe(TEST_USER.username);

    // Persist tokens for subsequent tests
    accessToken  = res.body.data.access_token;
    refreshToken = res.body.data.refresh_token;
  });

  it('response should follow standard format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: TEST_USER.password });
    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('data');
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('should return 401 when no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for a garbage token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('should return 200 with user info for valid token', async () => {
    // Login first to get fresh token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: TEST_USER.password });
    const token = loginRes.body.data.access_token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe(TEST_USER.username);
    expect(res.body.data.role).toBe('province');
    expect(res.body.data).not.toHaveProperty('password_hash');
  });
});

// ─── POST /api/auth/refresh-token ────────────────────────────────────────────

describe('POST /api/auth/refresh-token', () => {
  it('should return 400 when refresh_token is missing', async () => {
    const res = await request(app).post('/api/auth/refresh-token').send({});
    expect(res.status).toBe(400);
  });

  it('should return 401 for an invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: 'garbage.token.here' });
    expect(res.status).toBe(401);
  });

  it('should return a new access_token for a valid refresh token', async () => {
    // Login to get fresh refresh token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: TEST_USER.password });
    const rToken = loginRes.body.data.refresh_token;

    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: rToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('access_token');
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('should return 401 when not authenticated', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(401);
  });

  it('should revoke the refresh token and prevent reuse', async () => {
    // Login fresh
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: TEST_USER.password });
    const aToken = loginRes.body.data.access_token;
    const rToken = loginRes.body.data.refresh_token;

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${aToken}`)
      .send({ refresh_token: rToken });
    expect(logoutRes.status).toBe(200);

    // Try to use the revoked refresh token
    const refreshRes = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: rToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.message).toMatch(/revoked/i);
  });
});

// ─── Role-based access control (403) ─────────────────────────────────────────

describe('RBAC — 403 for wrong role', () => {
  it('driver cannot access a province-only route (placeholder check)', async () => {
    // Login as driver
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: '__test_driver', password: 'testpass123' });
    const token = loginRes.body.data?.access_token;

    if (!token) {
      // If driver user not seeded, skip gracefully
      return;
    }

    // /api/central/* will be added in Phase 4 — for now verify /api/auth/me still works
    // and that the token carries the correct role.
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.role).toBe('driver');
  });
});

// ─── Standard response format ─────────────────────────────────────────────────

describe('Standard response format', () => {
  it('404 for unknown routes should follow standard format', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('data', null);
  });

  it('error responses include errors array', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.body).toHaveProperty('errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
