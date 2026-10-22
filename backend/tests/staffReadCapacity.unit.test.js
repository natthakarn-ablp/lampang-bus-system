'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCENARIOS, ROLES, checkSandboxTarget, readRoleTokens,
  parsePlan, assessStage, parseArgs, verifySandbox,
} = require('../scripts/staff-read-capacity');

describe('six-staff-role synthetic read capacity harness', () => {
  test('uses exactly the six staff roles with read-only, fixed API paths', () => {
    expect([...ROLES].sort()).toEqual(['admin', 'affiliation', 'driver', 'province', 'school', 'transport']);
    expect(SCENARIOS).toHaveLength(6);
    expect(SCENARIOS.every((scenario) => scenario.method === 'GET' && !scenario.writes && /^\/api\/[a-z/-]+$/.test(scenario.path))).toBe(true);
    expect(SCENARIOS.reduce((sum, scenario) => sum + scenario.weight, 0)).toBeCloseTo(1);
  });

  test('rejects public/proxy-like targets and production loopback port', () => {
    expect(checkSandboxTarget('http://127.0.0.1:13307').ok).toBe(true);
    for (const target of [
      'https://schoolbuslampang.com', 'http://110.164.162.205:13307',
      'http://127.0.0.1:3000', 'http://127.0.0.1:13307/api',
      'http://user:pass@127.0.0.1:13307', 'http://127.0.0.1:13307?x=1',
    ]) expect(checkSandboxTarget(target).ok).toBe(false);
  });

  test('requires bounded explicit ascending stages and rejects unknown options', () => {
    expect(parsePlan({ users: '5,10', 'max-users': '20', duration: '15' })).toEqual([
      { label: 'staff-read-5', users: 5, durationSec: 15 },
      { label: 'staff-read-10', users: 10, durationSec: 15 },
    ]);
    expect(() => parsePlan({ users: '10,5', 'max-users': '20', duration: '15' })).toThrow('users_must_increase');
    expect(() => parsePlan({ users: '201', 'max-users': '201', duration: '15' })).toThrow('max_users');
    expect(() => parsePlan({ users: '5', 'max-users': '20', duration: '3600' })).toThrow('duration');
    expect(() => parseArgs(['--target', 'http://127.0.0.1:13307', '--mystery'])).toThrow('missing_value');
  });

  test('all six isolated role tokens must be present without printing token values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schoolbus-staff-read-'));
    const file = path.join(dir, 'tokens.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ school: 'synthetic-school-token' }), { mode: 0o600 });
      expect(() => readRoleTokens(file)).toThrow('missing_sandbox_roles:driver,transport,affiliation,province,admin');
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(ROLES.map((role) => [role, `synthetic-${role}-token`]))));
      expect(Object.keys(readRoleTokens(file))).toEqual(ROLES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('health preflight refuses production even behind loopback', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(async (_url, init) => ({
      status: 200,
      json: async () => ({ success: true, data: { service: 'lampang-bus-backend', environment: 'production', database: { connected: true } } }),
    }));
    try {
      await expect(verifySandbox('http://127.0.0.1:13307')).rejects.toThrow('target_not_verified_test_sandbox');
      expect(global.fetch.mock.calls[0][1].redirect).toBe('error');
      global.fetch.mockImplementationOnce(async () => ({
        status: 200,
        json: async () => ({ success: true, data: { service: 'lampang-bus-backend', environment: 'test', database: { connected: true } } }),
      }));
      await expect(verifySandbox('http://127.0.0.1:13307')).resolves.toBeUndefined();
    } finally {
      global.fetch = original;
    }
  });

  test('insufficient or failed samples cannot be presented as a capacity pass', () => {
    const by_scenario = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.key,
      { served: 29, served_ratio: 1, error_rate: 0, p95_ms: 20 }]));
    const verdict = assessStage({ by_scenario, server: { samples: 2 }, aborted: null });
    expect(verdict.provisional_pass).toBe(false);
    expect(verdict.failures).toHaveLength(6);
    const passing = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.key,
      { served: 30, served_ratio: 1, error_rate: 0, p95_ms: 20 }]));
    expect(assessStage({ by_scenario: passing, server: null, aborted: null }).failures).toEqual(['server_capacity_samples_missing']);
  });
});
