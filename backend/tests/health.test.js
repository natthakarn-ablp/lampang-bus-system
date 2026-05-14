'use strict';

require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  test('returns 200 with the backward-compatible envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OK');
    expect(res.body.data).toBeTruthy();
  });

  test('exposes safe operational metadata', async () => {
    const res = await request(app).get('/health');
    const d = res.body.data;
    expect(d).toHaveProperty('service');
    expect(d).toHaveProperty('version');
    expect(d).toHaveProperty('environment');
    expect(d).toHaveProperty('node_version');
    expect(d).toHaveProperty('uptime');
    expect(d).toHaveProperty('timestamp');
    expect(d).toHaveProperty('database');
    expect(typeof d.uptime).toBe('number');
    expect(typeof d.database.connected).toBe('boolean');
    // service name should be the hardcoded module name, not anything env-derived
    expect(d.service).toMatch(/lampang/i);
  });

  test('does not expose secrets, env values, or DB error details', async () => {
    const res = await request(app).get('/health');
    const json = JSON.stringify(res.body).toLowerCase();
    // None of these should appear anywhere in the public response.
    expect(json).not.toMatch(/password/);
    expect(json).not.toMatch(/secret/);
    expect(json).not.toMatch(/jwt_/);
    expect(json).not.toMatch(/line_channel/);
    expect(json).not.toMatch(/db_password/);
    expect(json).not.toMatch(/\/home\/schoolbus/);   // no internal file paths
    expect(json).not.toMatch(/access_token/);
  });
});
