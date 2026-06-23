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

const path = require('path');

if (!global.__LAMPANG_TEST_ENV_LOADED__) {
  require('dotenv').config({
    path: path.resolve(__dirname, '../.env.test'),
    override: true,
  });
  global.__LAMPANG_TEST_ENV_LOADED__ = true;
}

module.exports = {};
