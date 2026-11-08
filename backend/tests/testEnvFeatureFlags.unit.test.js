'use strict';

// OPS-001 (2026-11-08): the unit suite must not inherit feature flags from the
// real `.env` or from the shell. deploy-backend.sh runs it on the production
// server from backend/, where `.env` turns flags on; that once aborted a deploy
// (two tests asserted flag-off SQL). Each case runs a fresh Node process in a
// throwaway directory whose `.env` turns flags ON — exactly the server's shape —
// so nothing here reads the real `.env`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const LOAD_TEST_ENV = path.join(BACKEND, 'tests', 'loadTestEnv.js');
const ENV_JS = path.join(BACKEND, 'src', 'config', 'env.js');

function probe({ withTestSetup, shellEnv = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-probe-'));
  fs.writeFileSync(path.join(dir, '.env'),
    'FEATURE_CO_GUARDIAN=true\nFEATURE_PARENT_LEAVE=true\nFEATURE_PARENT_CLAIM_CODE=true\n');
  const code = `
    ${withTestSetup ? `require(${JSON.stringify(LOAD_TEST_ENV)});` : ''}
    const env = require(${JSON.stringify(ENV_JS)});
    process.stdout.write(JSON.stringify({
      coGuardian: env.features.coGuardian,
      parentLeave: env.features.parentLeave,
      parentClaimCode: env.features.parentClaimCode,
    }));`;
  const childEnv = { ...process.env, NODE_ENV: 'test', ...shellEnv };
  for (const k of Object.keys(childEnv)) if (k.startsWith('FEATURE_') && !(k in shellEnv)) delete childEnv[k];
  const r = spawnSync(process.execPath, ['-e', code], { cwd: dir, env: childEnv, encoding: 'utf8', timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`probe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('control: without the test setup, a .env in the working directory turns flags on', () => {
  expect(probe({ withTestSetup: false })).toEqual({ coGuardian: true, parentLeave: true, parentClaimCode: true });
});

test('with the test setup, a production-shaped .env cannot turn flags on', () => {
  expect(probe({ withTestSetup: true })).toEqual({ coGuardian: false, parentLeave: false, parentClaimCode: false });
});

test('a flag exported by the surrounding shell is also pinned off', () => {
  expect(probe({ withTestSetup: true, shellEnv: { FEATURE_CO_GUARDIAN: 'true' } }).coGuardian).toBe(false);
});

test('every FEATURE_* name config/env.js reads is covered', () => {
  const { featureFlagNames } = require('./loadTestEnv');
  const names = featureFlagNames();
  expect(names).toEqual(expect.arrayContaining(['FEATURE_CO_GUARDIAN', 'FEATURE_PARENT_LEAVE', 'FEATURE_PARENT_CLAIM_CODE', 'FEATURE_VEHICLE_QR']));
  for (const n of names) expect(process.env[n]).toBeDefined();
});

test('a feature test can still switch a flag ON for itself before requiring the module, and restore it', () => {
  const saved = process.env.FEATURE_CO_GUARDIAN;
  try {
    process.env.FEATURE_CO_GUARDIAN = 'true';
    let fresh;
    jest.isolateModules(() => { fresh = require('../src/config/env'); });
    expect(fresh.features.coGuardian).toBe(true);
  } finally {
    process.env.FEATURE_CO_GUARDIAN = saved;
  }
  let again;
  jest.isolateModules(() => { again = require('../src/config/env'); });
  expect(again.features.coGuardian).toBe(false);
});
