'use strict';

/**
 * gt2-01 / sch-02 / neg-03 (live QA 2026-11) — auth and role-guard messages are
 * shown to teachers verbatim, so they must be Thai.
 */

const fs = require('fs');
const path = require('path');
const { requireRole } = require('../src/middleware/roleGuard');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

test('cross-role 403 is Thai', () => {
  const res = mockRes();
  requireRole('province')({ user: { role: 'school' } }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json.mock.calls[0][0].message).toBe('คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้');
});

test('missing user 401 is Thai', () => {
  const res = mockRes();
  requireRole('province')({}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json.mock.calls[0][0].message).toMatch(/[฀-๿]/);
});

test('every sendError / sendSuccess message in auth.routes.js is Thai', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
  const msgs = [
    ...src.matchAll(/sendError\(\s*res,\s*'([^']*)'/g),
    ...src.matchAll(/sendSuccess\(\s*res,\s*[^,()]+,\s*'([^']*)'/g),
    ...src.matchAll(/^\s*'([^']*)'\s*\n\s*\);/gm),
  ].map(m => m[1]);
  expect(msgs.length).toBeGreaterThan(10);
  const english = msgs.filter(m => !/[฀-๿]/.test(m));
  expect(english).toEqual([]);
  expect(src).toContain("'รหัสผ่านปัจจุบันไม่ถูกต้อง'");
});
