'use strict';

/**
 * corsSecurity.test.js  (Phase 10.12H)
 *
 * ISOLATED — exercises the exported CORS allow-list predicate. Requiring app.js
 * creates the (lazy) DB pool but never connects; no globalSetup, no prod DB.
 */

const app = require('../src/app');
const env = require('../src/config/env');

const { isOriginAllowed } = app;

describe('CORS origin allow-list (H: wildcard hardening)', () => {
  let origNodeEnv;
  let origOrigins;
  beforeEach(() => {
    origNodeEnv = env.app.nodeEnv;
    origOrigins = env.app.corsOrigins;
    env.app.corsOrigins = ['https://schoolbuslampang.com', 'https://www.schoolbuslampang.com'];
  });
  afterEach(() => {
    env.app.nodeEnv = origNodeEnv;
    env.app.corsOrigins = origOrigins;
  });

  test('production: allows a whitelisted origin', () => {
    env.app.nodeEnv = 'production';
    expect(isOriginAllowed('https://schoolbuslampang.com')).toBe(true);
    expect(isOriginAllowed('https://www.schoolbuslampang.com')).toBe(true);
  });

  test('production: blocks a non-whitelisted origin', () => {
    env.app.nodeEnv = 'production';
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    expect(isOriginAllowed('http://schoolbuslampang.com')).toBe(false); // wrong scheme
  });

  test('production: allows no-Origin requests (server-to-server / same-origin)', () => {
    env.app.nodeEnv = 'production';
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('')).toBe(true);
  });

  test('non-production: reflects any origin (dev convenience)', () => {
    env.app.nodeEnv = 'development';
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('https://anything.example')).toBe(true);
  });
});
