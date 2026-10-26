'use strict';

module.exports = {
  testEnvironment: 'node',
  // Load .env.test before any unit test body runs. Unit tests are DB-free, so
  // this only sets env vars (harmless), and keeps a single source of truth for
  // test environment between the unit and integration paths.
  setupFiles: ['<rootDir>/tests/loadTestEnv.js'],
  // Keep these root-relative globs portable. Expanding <rootDir> into an
  // absolute Windows worktree path mixes slash styles and can silently match
  // only the exact securityEnv file while skipping every *.unit.test.js file.
  testMatch: ['**/tests/**/*.unit.test.js', '**/tests/securityEnv.test.js'],
  testTimeout: 10000,
};
