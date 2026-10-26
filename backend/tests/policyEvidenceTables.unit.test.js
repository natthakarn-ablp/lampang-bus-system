'use strict';

/**
 * utils/policyEvidenceTables.js and how /api/policy-notices uses it.
 *
 * Three probe outcomes:
 *   ready   -> routes behave normally
 *   missing -> once a policy is APPROVED, every route answers 503 + Thai message
 *   unknown -> probe failed; not treated as missing, routes are not blocked
 * plus the 60 s cache: a re-probe after the TTL brings the feature back on its
 * own once the migrations are applied, with no restart.
 */

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 17, role: req.get('X-Test-Role') || 'school', scopeType: 'SCHOOL', scopeId: 'SCH0001' };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/config/env', () => ({ db: { name: 'lampang_bus_test' } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/config/policyNotices', () => {
  const actual = jest.requireActual('../src/config/policyNotices');
  return { ...actual, APPROVED: true };
});

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const tables = require('../src/utils/policyEvidenceTables');

const ALL = tables.REQUIRED_POLICY_EVIDENCE_TABLES;

// information_schema answers with the tables that "exist"; everything else
// (the ledger reads/writes) answers empty so routes can run to completion.
let existing = ALL.slice();
let probeError = null;
pool.query.mockImplementation(async (sql, params = []) => {
  if (/information_schema\.tables/.test(sql)) {
    if (probeError) throw probeError;
    return [params.slice(1).filter((t) => existing.includes(t)).map((t) => ({ table_name: t }))];
  }
  return [[]];
});
const probeCalls = () => pool.query.mock.calls.filter(([sql]) => /information_schema/.test(sql)).length;

function appWithRouter() {
  const router = require('../src/routes/policyNotice.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/policy-notices', router);
  return app;
}

const ROUTES = [
  ['get', '/api/policy-notices/current'],
  ['get', '/api/policy-notices/action/report.export'],
  ['get', '/api/policy-notices/catalog'],
  ['post', '/api/policy-notices/prepare-action'],
  ['post', '/api/policy-notices/consume-client-action'],
  ['post', '/api/policy-notices/acknowledge'],
];

beforeEach(() => {
  existing = ALL.slice();
  probeError = null;
  pool.query.mockClear();
  tables.resetPolicyEvidenceCache();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('probePolicyEvidenceTables', () => {
  test('ready when both tables exist', async () => {
    await expect(tables.probePolicyEvidenceTables(pool, 'db')).resolves.toEqual({ state: 'ready', missing: [], error: null });
  });

  test('missing names exactly the absent table', async () => {
    existing = ['policy_acknowledgements'];
    await expect(tables.probePolicyEvidenceTables(pool, 'db'))
      .resolves.toEqual({ state: 'missing', missing: ['policy_action_evidence'], error: null });
  });

  test('unknown when the probe itself fails, and never throws', async () => {
    probeError = Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
    await expect(tables.probePolicyEvidenceTables(pool, 'db'))
      .resolves.toEqual({ state: 'unknown', missing: [], error: 'ER_TABLEACCESS_DENIED_ERROR' });
  });
});

describe('/api/policy-notices once a policy is APPROVED', () => {
  test('tables present: no route answers 503', async () => {
    const app = appWithRouter();
    for (const [method, path] of ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(`${method} ${path} -> ${res.status}`).not.toMatch(/-> 503$/);
    }
  });

  test('tables missing: every route answers 503 with the Thai message', async () => {
    existing = [];
    const app = appWithRouter();
    for (const [method, path] of ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 503`);
      expect(res.body).toEqual({ success: false, message: tables.UNAVAILABLE_MESSAGE, errors: [], data: null });
    }
    expect(tables.UNAVAILABLE_MESSAGE).toMatch(/ยังไม่พร้อมใช้งาน/);
    // no ledger query ran while the tables are known missing
    expect(pool.query.mock.calls.every(([sql]) => /information_schema/.test(sql))).toBe(true);
  });

  test('probe fails: routes are not blocked', async () => {
    probeError = new Error('denied');
    const app = appWithRouter();
    for (const [method, path] of ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(`${method} ${path} -> ${res.status}`).not.toMatch(/-> 503$/);
    }
  });
});

describe('60 second cache', () => {
  test('re-uses the answer inside the TTL, re-probes after it, and recovers without restart', async () => {
    existing = [];
    const t0 = 1_000_000;
    expect((await tables.getPolicyEvidenceStatus({ now: t0 })).state).toBe('missing');
    expect(probeCalls()).toBe(1);

    // migrations applied, but still inside the TTL: cached answer, no new probe
    existing = ALL.slice();
    expect((await tables.getPolicyEvidenceStatus({ now: t0 + tables.CACHE_TTL_MS - 1 })).state).toBe('missing');
    expect(probeCalls()).toBe(1);

    // after the TTL: re-probed and back to ready on its own
    expect((await tables.getPolicyEvidenceStatus({ now: t0 + tables.CACHE_TTL_MS })).state).toBe('ready');
    expect(probeCalls()).toBe(2);
    expect(tables.CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  test('concurrent requests share one probe', async () => {
    await Promise.all([1, 2, 3].map(() => tables.getPolicyEvidenceStatus()));
    expect(probeCalls()).toBe(1);
  });
});
