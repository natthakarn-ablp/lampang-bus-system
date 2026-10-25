'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');

describe('unknown API routes stay API responses in every environment', () => {
  test('returns a structured JSON 404', async () => {
    const res = await request(app).get('/api/__missing_permission_audit__');
    expect(res.status).toBe(404);
    expect(res.type).toMatch(/json/);
    expect(res.body).toEqual({
      success: false,
      message: 'Route not found',
      errors: [],
      data: null,
    });
  });

  test('mounts the API 404 before the production SPA catch-all', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
    const api404 = src.indexOf("app.use('/api', apiNotFound)");
    const spa = src.indexOf("if (process.env.NODE_ENV === 'production')");
    expect(api404).toBeGreaterThan(-1);
    expect(spa).toBeGreaterThan(api404);
  });
});
