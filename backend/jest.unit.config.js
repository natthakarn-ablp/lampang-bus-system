'use strict';

module.exports = {
  testEnvironment: 'node',
  // Load .env.test before any unit test body runs. Unit tests are DB-free, so
  // this only sets env vars (harmless), and keeps a single source of truth for
  // test environment between the unit and integration paths.
  setupFiles: ['<rootDir>/tests/loadTestEnv.js'],
  testMatch: ['<rootDir>/tests/**/*.unit.test.js', '<rootDir>/tests/securityEnv.test.js'],
  testTimeout: 10000,
};
