'use strict';

/**
 * Guards the invariant that broke CI on 2026-08-27: the integration-test
 * connections must evaluate CURDATE() on the same calendar as the application
 * pool. The app pins +07:00 (src/config/database.js), so "today" is the Bangkok
 * day. A test connection left on the server default (UTC) disagrees with it
 * from 00:00 to 07:00 Bangkok — during which every
 * `DELETE ... WHERE check_date = CURDATE()` cleanup in the suite matched
 * nothing, rows leaked between tests, and check-ins started returning 409.
 *
 * DB-free: asserts the shape of the config, never opens a socket.
 */

const { DB_TIMEZONE } = require('../src/config/dbTimezone');
const { testDbConfig } = require('./dbHelper');

describe('test DB connections share the application timezone', () => {
  test('the shared offset is Bangkok (+07:00)', () => {
    expect(DB_TIMEZONE).toBe('+07:00');
  });

  test('testDbConfig carries that offset', () => {
    expect(testDbConfig().timezone).toBe(DB_TIMEZONE);
  });

  test('caller-supplied options do not silently drop it', () => {
    expect(testDbConfig({ multipleStatements: true }).timezone).toBe(DB_TIMEZONE);
  });

  test('src/config/database.js reads the offset from the shared module', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../src/config/database.js'), 'utf8'
    );
    // A second hardcoded literal here is how the two sides drifted apart before.
    expect(source).toContain("require('./dbTimezone')");
    expect(source).not.toMatch(/const\s+DB_TIMEZONE\s*=\s*['"]/);
  });
});
