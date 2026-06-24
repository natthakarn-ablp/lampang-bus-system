'use strict';

function assertDisposableTestDatabase(source = process.env) {
  if (source.NODE_ENV !== 'test') {
    throw new Error('Refusing destructive test database access: NODE_ENV must be test');
  }
  if (source.DB_NAME !== 'lampang_bus_test') {
    throw new Error(`Refusing destructive test database access: DB_NAME=${source.DB_NAME || '(missing)'}`);
  }
  if (source.ALLOW_TEST_DB_RESET !== 'true') {
    throw new Error('ALLOW_TEST_DB_RESET=true is required');
  }
  return true;
}

module.exports = { assertDisposableTestDatabase };
