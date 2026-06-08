'use strict';

/**
 * uploadProtection.test.js  (Phase 10.12F — closes H7)
 *
 * ISOLATED — run with a jest config that omits globalSetup. The /uploads
 * blocker is registered before every DB-backed route, so these requests return
 * 404 without ever touching MySQL. Proves uploaded files (import CSV/XLSX with
 * student/parent PII, driver photos) are no longer served publicly and that no
 * path traversal or filesystem path leak is possible.
 */

const request = require('supertest');
const app = require('../src/app');

describe('Uploads are not publicly served (Phase 10.12F / H7)', () => {
  test('1. GET /uploads/<file> no longer serves the file (404, JSON, not file content)', async () => {
    const res = await request(app).get('/uploads/imports/anything.csv');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
    expect(res.headers['content-type'] || '').not.toMatch(/text\/csv/);
  });

  test('2. a real-looking driver photo path returns 404 (never a 200 image)', async () => {
    const res = await request(app).get('/uploads/drivers/1-1700000000000.png');
    expect(res.status).toBe(404);
    expect(res.headers['content-type'] || '').not.toMatch(/^image\//);
  });

  test('3. encoded path-traversal under /uploads is blocked (no content)', async () => {
    const res = await request(app).get('/uploads/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect([400, 403, 404]).toContain(res.status);
    expect(res.text || '').not.toMatch(/root:.*:0:0:/);
  });

  test('4. traversal toward project files stays blocked', async () => {
    const res = await request(app).get('/uploads/%2e%2e%2f%2e%2e%2fpackage.json');
    expect([400, 403, 404]).toContain(res.status);
    expect(res.text || '').not.toMatch(/"dependencies"/);
  });

  test('5. missing file returns 404', async () => {
    const res = await request(app).get('/uploads/does-not-exist.txt');
    expect(res.status).toBe(404);
  });

  test('6. error response leaks no filesystem path', async () => {
    const res = await request(app).get('/uploads/imports/secret.csv');
    const blob = JSON.stringify(res.body) + (res.text || '');
    expect(blob).not.toMatch(/\/home\/|__dirname|backend\/uploads|\/var\//);
  });
});
