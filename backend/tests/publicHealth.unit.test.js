'use strict';

jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn() },
}));

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const app = require('../src/app');
const {
  PUBLIC_HEALTH_CACHE_TTL_MS,
  resetPublicHealthCache,
} = require('../src/services/publicHealth.service');

const migrationFiles = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();

beforeEach(() => {
  resetPublicHealthCache();
  pool.query.mockReset();
  pool.query.mockImplementation(async (sql) => {
    if (/SELECT 1 AS ok/.test(sql)) return [[{ ok: 1 }]];
    if (/FROM schema_migrations/.test(sql)) {
      return [migrationFiles.map((filename) => ({ filename, checksum: null }))];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
});

test('GET /api/health returns only the approved public shape with no-store', async () => {
  const response = await request(app).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    status: 'ok',
    commit: expect.stringMatching(/^[0-9a-f]{7}$/),
    database: { connected: true },
    migrations: { latest: migrationFiles.at(-1), pending: 0 },
  });
  expect(Object.keys(response.body).sort()).toEqual(['commit', 'database', 'migrations', 'status']);
});

test('public response omits runtime, environment, paths, DB identity and raw errors', async () => {
  const response = await request(app).get('/api/health');
  const serialized = JSON.stringify(response.body);

  expect(serialized).not.toMatch(/node_version|uptime|environment|path|database_name|db_name|error|stack/i);
});

test('migration failure degrades safely without exposing the underlying error', async () => {
  pool.query.mockImplementation(async (sql) => {
    if (/SELECT 1 AS ok/.test(sql)) return [[{ ok: 1 }]];
    if (/FROM schema_migrations/.test(sql)) throw new Error('synthetic path and database detail');
    throw new Error(`unexpected query: ${sql}`);
  });

  const response = await request(app).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    status: 'degraded',
    commit: expect.stringMatching(/^[0-9a-f]{7}$/),
    database: { connected: true },
    migrations: { latest: null, pending: null },
  });
  expect(JSON.stringify(response.body)).not.toMatch(/synthetic|path|error|stack/i);
});

test('migration result is cached for no more than 60 seconds', async () => {
  expect(PUBLIC_HEALTH_CACHE_TTL_MS).toBeGreaterThan(0);
  expect(PUBLIC_HEALTH_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);

  await request(app).get('/api/health');
  await request(app).get('/api/health');
  expect(pool.query.mock.calls.filter(([sql]) => /FROM schema_migrations/.test(sql))).toHaveLength(1);
});

test('route has a dedicated limiter and is mounted before the API 404 boundary', () => {
  const stack = app._router.stack;
  const healthIndex = stack.findIndex((layer) => layer.route?.path === '/api/health');
  const notFoundIndex = stack.findIndex((layer) => layer.handle === app.apiNotFound);
  expect(healthIndex).toBeGreaterThan(-1);
  expect(notFoundIndex).toBeGreaterThan(healthIndex);
  expect(stack[healthIndex].route.stack[0].handle).toBe(app.publicHealthNoStore);
  expect(stack[healthIndex].route.stack[1].handle).toBe(app.publicHealthLimiter);
});

test('another unknown API path still returns the canonical JSON 404', async () => {
  const response = await request(app).get('/api/__still_missing_after_public_health__');
  expect(response.status).toBe(404);
  expect(response.type).toMatch(/json/);
  expect(response.body).toEqual({
    success: false,
    message: 'Route not found',
    errors: [],
    data: null,
  });
});
