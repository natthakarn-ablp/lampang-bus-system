'use strict';

const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');

describe('assertDisposableTestDatabase', () => {
  test('accepts the exact disposable database contract', () => {
    expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME: 'lampang_bus_test', ALLOW_TEST_DB_RESET: 'true',
    })).not.toThrow();
  });

  test.each(['lampang_bus', 'lampang_bus_dev', '', undefined])(
    'rejects protected database %p',
    (DB_NAME) => expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME, ALLOW_TEST_DB_RESET: 'true',
    })).toThrow(/Refusing destructive test database access/)
  );

  test('requires an explicit reset acknowledgement', () => {
    expect(() => assertDisposableTestDatabase({
      NODE_ENV: 'test', DB_NAME: 'lampang_bus_test', ALLOW_TEST_DB_RESET: 'false',
    })).toThrow(/ALLOW_TEST_DB_RESET/);
  });
});
