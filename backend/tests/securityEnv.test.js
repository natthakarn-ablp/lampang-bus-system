'use strict';

/**
 * securityEnv.test.js  (Phase 10.12B — fail-closed secrets)
 *
 * PURE unit tests — no database, no HTTP server, no globalSetup. These cover:
 *   1. LINE webhook signature verification (fail-closed in production,
 *      constant-time, accepts a valid signature, rejects a tampered one).
 *   2. Production-required secret validation (LINE_CHANNEL_SECRET, CRON_API_KEY).
 *
 * Run in isolation WITHOUT the DB-seeding globalSetup, e.g.:
 *   npx jest -c <config-without-globalSetup> tests/securityEnv.test.js
 */

const crypto = require('crypto');

const env = require('../src/config/env');
const lineRoutes = require('../src/routes/line.routes');

const { verifySignature } = lineRoutes;
const { getMissingProductionSecrets } = env;

// ─── 1. Webhook signature verification ───────────────────────────────────────
describe('LINE webhook verifySignature', () => {
  const TEST_SECRET = 'unit-test-channel-secret';
  const body = Buffer.from(JSON.stringify({ events: [{ type: 'message' }] }));
  const validSig = crypto.createHmac('sha256', TEST_SECRET).update(body).digest('base64');

  let origSecret;
  let origNodeEnv;

  beforeEach(() => {
    origSecret = env.line.channelSecret;
    origNodeEnv = env.app.nodeEnv;
  });
  afterEach(() => {
    env.line.channelSecret = origSecret;
    env.app.nodeEnv = origNodeEnv;
  });

  test('accepts a valid signature when secret is configured', () => {
    env.line.channelSecret = TEST_SECRET;
    expect(verifySignature(body, validSig)).toBe(true);
  });

  test('rejects a tampered / wrong signature', () => {
    env.line.channelSecret = TEST_SECRET;
    const tampered = crypto.createHmac('sha256', 'different-secret').update(body).digest('base64');
    expect(verifySignature(body, tampered)).toBe(false);
  });

  test('rejects a missing signature', () => {
    env.line.channelSecret = TEST_SECRET;
    expect(verifySignature(body, '')).toBe(false);
    expect(verifySignature(body, undefined)).toBe(false);
  });

  test('rejects a malformed signature of wrong length', () => {
    env.line.channelSecret = TEST_SECRET;
    expect(verifySignature(body, 'not-base64-of-right-length')).toBe(false);
  });

  test('fails CLOSED when no secret is set in production', () => {
    env.line.channelSecret = '';
    env.app.nodeEnv = 'production';
    expect(verifySignature(body, validSig)).toBe(false);
  });

  test('fails OPEN (dev convenience) when no secret is set outside production', () => {
    env.line.channelSecret = '';
    env.app.nodeEnv = 'development';
    expect(verifySignature(body, 'anything')).toBe(true);
  });
});

// ─── 2. Production-required secret validation ────────────────────────────────
describe('getMissingProductionSecrets', () => {
  const full = { LINE_CHANNEL_SECRET: 'x', CRON_API_KEY: 'y' };

  test('production + all secrets set → nothing missing', () => {
    expect(getMissingProductionSecrets(full, 'production')).toEqual([]);
  });

  test('production + both empty → both reported', () => {
    const missing = getMissingProductionSecrets(
      { LINE_CHANNEL_SECRET: '', CRON_API_KEY: '' },
      'production'
    );
    expect(missing).toContain('LINE_CHANNEL_SECRET');
    expect(missing).toContain('CRON_API_KEY');
  });

  test('production + whitespace-only secret counts as missing', () => {
    const missing = getMissingProductionSecrets(
      { LINE_CHANNEL_SECRET: '   ', CRON_API_KEY: 'y' },
      'production'
    );
    expect(missing).toEqual(['LINE_CHANNEL_SECRET']);
  });

  test('production + one missing → only that one reported', () => {
    expect(
      getMissingProductionSecrets({ LINE_CHANNEL_SECRET: 'x', CRON_API_KEY: '' }, 'production')
    ).toEqual(['CRON_API_KEY']);
  });

  test('non-production never requires the secrets', () => {
    expect(getMissingProductionSecrets({ LINE_CHANNEL_SECRET: '', CRON_API_KEY: '' }, 'development')).toEqual([]);
    expect(getMissingProductionSecrets({ LINE_CHANNEL_SECRET: '', CRON_API_KEY: '' }, 'test')).toEqual([]);
  });
});
