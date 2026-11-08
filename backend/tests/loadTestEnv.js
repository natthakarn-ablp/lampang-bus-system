'use strict';

/**
 * loadTestEnv.js — committed test-env bootstrap.
 *
 * SAFETY-CRITICAL: this is what guarantees the test suite targets the
 * DISPOSABLE database (lampang_bus_test) and never the dev clone of
 * production data (lampang_bus_dev).
 *
 * How it works:
 *   - Wired as Jest `setupFiles` in BOTH jest.config (package.json "jest")
 *     and jest.unit.config.js, so it runs in every test worker BEFORE the
 *     test module body — i.e. before each test file's own
 *     `require('dotenv').config()` call.
 *   - Also require()'d at the top of tests/setup.js and tests/teardown.js,
 *     because Jest globalSetup/globalTeardown run in a SEPARATE process where
 *     `setupFiles` does NOT apply.
 *
 * Why `override: true`: we deliberately force the safe values to win even if
 * the surrounding shell already exported a dangerous DB_NAME (e.g. an operator
 * shell with DB_NAME=lampang_bus_dev) or a real `.env` was preloaded. The
 * destructive-safety of the suite must NOT hinge on the guard merely throwing —
 * it must POSITIVELY target lampang_bus_test. So loading `.env.test` here
 * overwrites NODE_ENV/DB_NAME/ALLOW_TEST_DB_RESET to the disposable values.
 *
 * The later `require('dotenv').config()` calls in each test file read the real
 * `.env` with the DEFAULT (override:false) behaviour, so they CANNOT clobber
 * anything we set here — they only fill in keys absent from `.env.test`.
 *
 * Idempotent: requiring this module more than once only loads the file once.
 */

const fs = require('fs');
const path = require('path');

/**
 * Feature flags are pinned OFF for the test run (OPS-001, 2026-11-08).
 *
 * config/env.js calls `require('dotenv').config()`, which reads `.env` from the
 * working directory. On the production server deploy-backend.sh runs the unit
 * suite from backend/, where the real `.env` turns production flags on — and a
 * test that asserted flag-off SQL failed there while passing in CI (deploy of
 * 4a7b1ca aborted). dotenv never overrides a key that is already set, so every
 * FEATURE_* name config/env.js reads is set here first: to the value from
 * `.env.test` when that file names it, otherwise to 'false'. Neither the real
 * `.env` nor a value exported by the surrounding shell can switch a flag on
 * for the suite. A test that needs a flag on sets it itself (env.features.x or
 * process.env before a fresh require) and covers the on/off cases explicitly.
 */
const ENV_JS = path.resolve(__dirname, '../src/config/env.js');
function featureFlagNames() {
  const src = fs.readFileSync(ENV_JS, 'utf8');
  return [...new Set(src.match(/\bFEATURE_[A-Z0-9_]+/g) || [])];
}

if (!global.__LAMPANG_TEST_ENV_LOADED__) {
  const loaded = require('dotenv').config({
    path: path.resolve(__dirname, '../.env.test'),
    override: true,
  });
  const fromTestFile = (loaded && loaded.parsed) || {};
  for (const name of featureFlagNames()) {
    process.env[name] = Object.prototype.hasOwnProperty.call(fromTestFile, name)
      ? fromTestFile[name]
      : 'false';
  }
  global.__LAMPANG_TEST_ENV_LOADED__ = true;
}

module.exports = { featureFlagNames };
