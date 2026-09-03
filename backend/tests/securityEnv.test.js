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
const {
  getMissingProductionSecrets,
  parseSafetyPolicyConfig,
  validateFeatureDependencies,
  validateEnvOrExit,
} = env;

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

// ─── 3. Progressive deployment policy config ────────────────────────────────
describe('progressive deployment policy config', () => {
  test('defaults to observe', () => {
    expect(parseSafetyPolicyConfig({})).toEqual({ mode: 'OBSERVE', enforcementAt: null });
  });

  test('accepts enforce and a valid ISO date', () => {
    expect(parseSafetyPolicyConfig({
      SAFETY_POLICY_MODE: 'enforce',
      SAFETY_ENFORCEMENT_AT: '2026-07-01T00:00:00+07:00',
    })).toEqual({ mode: 'ENFORCE', enforcementAt: '2026-07-01T00:00:00+07:00' });
  });

  test.each(['open', 'true'])('rejects explicit invalid mode %p', (mode) => {
    expect(() => parseSafetyPolicyConfig({ SAFETY_POLICY_MODE: mode })).toThrow(/SAFETY_POLICY_MODE/);
  });

  test('rejects invalid enforcement date', () => {
    expect(() => parseSafetyPolicyConfig({
      SAFETY_POLICY_MODE: 'enforce', SAFETY_ENFORCEMENT_AT: 'not-a-date',
    })).toThrow(/SAFETY_ENFORCEMENT_AT/);
  });

  test('rejects QR level 3 when vehicle QR is disabled', () => {
    expect(() => validateFeatureDependencies({ FEATURE_VEHICLE_QR: 'false', FEATURE_QR_LEVEL3: 'true' }))
      .toThrow(/FEATURE_QR_LEVEL3/);
  });

  test('admin recovery requires LIFF, LINE push, and an HTTPS public URL', () => {
    const base = { FEATURE_ADMIN_PASSWORD_RECOVERY: 'true' };
    expect(() => validateFeatureDependencies(base)).toThrow(/LINE_LIFF_ID/);
    expect(() => validateFeatureDependencies({ ...base, LINE_LIFF_ID: '123-test' }))
      .toThrow(/LINE_CHANNEL_ACCESS_TOKEN/);
    expect(() => validateFeatureDependencies({
      ...base,
      LINE_LIFF_ID: '123-test',
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      PUBLIC_APP_URL: 'http://schoolbuslampang.com',
    })).toThrow(/HTTPS URL/);
    expect(validateFeatureDependencies({
      ...base,
      LINE_LIFF_ID: '123-test',
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      PUBLIC_APP_URL: 'https://schoolbuslampang.com',
    })).toBe(true);
  });
});

// ─── 4. validateEnvOrExit — fail-closed without killing the test worker ──────
// env.js runs hard validation at module load and historically called
// process.exit(1) on bad config with no NODE_ENV gate, which would kill the Jest
// worker when `require('../src/config/env')` ran on a checkout without a .env.
// Under NODE_ENV==='test' the same checks must THROW (catchable) instead of
// exiting, so bad config is still rejected but the worker survives. These tests
// assert that behaviour by passing nodeEnv='test' explicitly.
describe('validateEnvOrExit (test mode throws instead of process.exit)', () => {
  const goodBase = {
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_NAME: 'db',
    DB_USER: 'user',
    DB_PASSWORD: 'pw',
    JWT_SECRET: 'x'.repeat(32),
    JWT_EXPIRES_IN: '24h',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  test('is exported', () => {
    expect(typeof validateEnvOrExit).toBe('function');
  });

  test('passes for a fully valid config (returns true, does not throw)', () => {
    expect(validateEnvOrExit({ ...goodBase }, 'test')).toBe(true);
  });

  test('throws when required vars are missing', () => {
    expect(() => validateEnvOrExit({ JWT_SECRET: 'x'.repeat(32) }, 'test'))
      .toThrow(/Missing required environment variables/);
  });

  test('throws when JWT_SECRET is too short', () => {
    expect(() => validateEnvOrExit({ ...goodBase, JWT_SECRET: 'short' }, 'test'))
      .toThrow(/JWT_SECRET must be at least 32 characters/);
  });

  test('throws when a production secret is missing under NODE_ENV=production', () => {
    expect(() => validateEnvOrExit(
      { ...goodBase, LINE_CHANNEL_SECRET: '', CRON_API_KEY: '' },
      'production'
    )).toThrow(/Missing required production secrets/);
  });

  test('throws on an invalid SAFETY_POLICY_MODE', () => {
    expect(() => validateEnvOrExit({ ...goodBase, SAFETY_POLICY_MODE: 'open' }, 'test'))
      .toThrow(/SAFETY_POLICY_MODE/);
  });

  test('throws on an invalid feature dependency', () => {
    expect(() => validateEnvOrExit(
      { ...goodBase, FEATURE_VEHICLE_QR: 'false', FEATURE_QR_LEVEL3: 'true' },
      'test'
    )).toThrow(/FEATURE_QR_LEVEL3/);
  });
});
