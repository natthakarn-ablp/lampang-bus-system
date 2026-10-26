'use strict';

/**
 * The mysql2 pool size and queue limit were literals in src/config/database.js.
 * The capacity rehearsal on a development machine measured that pool at
 * utilisation 1.0, with callers already queueing, at 20 simulated users
 * (docs/performance/load-test-local-2026-09-05.md section 2.1), so it is the
 * first knob an operator will have to turn once the province is on the system —
 * and a literal can only be turned by editing source and redeploying.
 *
 * These tests hold the two things that make that knob safe to expose:
 *   1. Unset means EXACTLY what the system did before (10 connections, an
 *      unlimited queue). Nobody's deployment changes because this became
 *      configurable.
 *   2. A bad value is refused at boot instead of quietly coerced. parseInt()
 *      would read '20x' as 20 and 'abc' as NaN, and a mis-sized pool surfaces
 *      only as latency under real load, long after the deploy that caused it.
 *
 * DB-free by construction: this reads src/config/database.js with fs rather than
 * requiring it, so no pool is ever created and no connection is opened.
 */

const fs = require('fs');
const path = require('path');

const env = require('../src/config/env');

const { parseDatabasePoolConfig, validateEnvOrExit } = env;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Strips block and line comments so a rule can be described without tripping it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// The values database.js used before the setting existed. Written out literally
// here on purpose: if someone changes the default in env.js, this test is the
// thing that asks whether every live deployment was meant to change with it.
const PREVIOUS_LITERALS = { connectionLimit: 10, queueLimit: 0 };

describe('unset pool config reproduces the previous hardcoded behaviour', () => {
  test('an empty environment yields the old literals', () => {
    expect(parseDatabasePoolConfig({})).toEqual(PREVIOUS_LITERALS);
  });

  test('blank, whitespace-only and undefined values count as unset', () => {
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '', DB_POOL_QUEUE_LIMIT: '' }))
      .toEqual(PREVIOUS_LITERALS);
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '   ', DB_POOL_QUEUE_LIMIT: '\t' }))
      .toEqual(PREVIOUS_LITERALS);
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: undefined, DB_POOL_QUEUE_LIMIT: null }))
      .toEqual(PREVIOUS_LITERALS);
  });

  test('the exported env object carries the parsed values, not a second copy', () => {
    expect(env.db.pool).toEqual(parseDatabasePoolConfig(process.env));
  });
});

describe('a valid override applies', () => {
  test('both settings are taken from the environment', () => {
    expect(parseDatabasePoolConfig({
      DB_POOL_CONNECTION_LIMIT: '40',
      DB_POOL_QUEUE_LIMIT: '200',
    })).toEqual({ connectionLimit: 40, queueLimit: 200 });
  });

  test('the values are numbers, so mysql2 gets a size and not a string', () => {
    const parsed = parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '40', DB_POOL_QUEUE_LIMIT: '200' });
    expect(typeof parsed.connectionLimit).toBe('number');
    expect(typeof parsed.queueLimit).toBe('number');
  });

  test('surrounding whitespace does not defeat an override', () => {
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: ' 25 ' }).connectionLimit).toBe(25);
  });

  test('the ends of the accepted range are accepted', () => {
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '1' }).connectionLimit).toBe(1);
    expect(parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '150' }).connectionLimit).toBe(150);
    expect(parseDatabasePoolConfig({ DB_POOL_QUEUE_LIMIT: '0' }).queueLimit).toBe(0);
    expect(parseDatabasePoolConfig({ DB_POOL_QUEUE_LIMIT: '10000' }).queueLimit).toBe(10000);
  });
});

describe('an invalid value is rejected, never coerced', () => {
  // '20x' and '10.9' are the dangerous ones: parseInt() reads them as 20 and 10
  // and the app runs on a size nobody chose. 'abc' becomes NaN, which mysql2
  // treats as no limit at all. '0' would deadlock the app on its first query,
  // and 151 is past the production server's max_connections.
  test.each(['abc', '20x', '0', '-5', '2.5', '10.9', '1e3', '151', '1 0', 'ten', '0x10'])(
    'DB_POOL_CONNECTION_LIMIT=%p throws', (value) => {
      expect(() => parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: value }))
        .toThrow(/DB_POOL_CONNECTION_LIMIT must be a whole number between 1 and 150/);
    }
  );

  test.each(['abc', '-1', '1.5', '100x', '10001'])('DB_POOL_QUEUE_LIMIT=%p throws', (value) => {
    expect(() => parseDatabasePoolConfig({ DB_POOL_QUEUE_LIMIT: value }))
      .toThrow(/DB_POOL_QUEUE_LIMIT must be a whole number between 0 and 10000/);
  });

  test('a rejected value never falls back to the default silently', () => {
    let parsed = null;
    try {
      parsed = parseDatabasePoolConfig({ DB_POOL_CONNECTION_LIMIT: '20x' });
    } catch {
      // The throw is the point; `parsed` must still be null below.
    }
    expect(parsed).toBeNull();
  });
});

// Same contract as the other config checks in securityEnv.test.js: under
// NODE_ENV=test the hard validation throws instead of calling process.exit(1),
// so bad config is still refused without killing the Jest worker.
describe('the app refuses to boot on a bad pool value', () => {
  const goodBase = {
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_NAME: 'db',
    DB_USER: 'user',
    DB_PASSWORD: 'pw',
    JWT_SECRET: 'x'.repeat(32),
    JWT_EXPIRES_IN: '24h',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  test('a config without the keys still validates', () => {
    expect(validateEnvOrExit({ ...goodBase }, 'test')).toBe(true);
  });

  test('a config with valid overrides validates', () => {
    expect(validateEnvOrExit(
      { ...goodBase, DB_POOL_CONNECTION_LIMIT: '40', DB_POOL_QUEUE_LIMIT: '200' },
      'test'
    )).toBe(true);
  });

  test('an unusable pool size stops the boot instead of starting on the default', () => {
    expect(() => validateEnvOrExit({ ...goodBase, DB_POOL_CONNECTION_LIMIT: '0' }, 'test'))
      .toThrow(/DB_POOL_CONNECTION_LIMIT/);
    expect(() => validateEnvOrExit({ ...goodBase, DB_POOL_QUEUE_LIMIT: '-1' }, 'test'))
      .toThrow(/DB_POOL_QUEUE_LIMIT/);
  });
});

describe('config/database.js reads the pool size from env, not from a literal', () => {
  const code = stripComments(read('backend/src/config/database.js'));

  test('the pool is built from the parsed env values', () => {
    expect(code).toMatch(/connectionLimit:\s*env\.db\.pool\.connectionLimit/);
    expect(code).toMatch(/queueLimit:\s*env\.db\.pool\.queueLimit/);
  });

  test('no numeric pool literal is left behind to override the setting', () => {
    expect(code).not.toMatch(/connectionLimit:\s*\d/);
    expect(code).not.toMatch(/queueLimit:\s*\d/);
  });
});

describe('.env.example tells the operator what to set', () => {
  const example = read('backend/.env.example');

  test('documents both keys with their accepted range', () => {
    expect(example).toMatch(/DB_POOL_CONNECTION_LIMIT/);
    expect(example).toMatch(/DB_POOL_QUEUE_LIMIT/);
    expect(example).toMatch(/1-150/);
    expect(example).toMatch(/0-10000/);
  });

  test('ships no active override, so a copied file keeps today\'s behaviour', () => {
    expect(example).not.toMatch(/^DB_POOL_CONNECTION_LIMIT=/m);
    expect(example).not.toMatch(/^DB_POOL_QUEUE_LIMIT=/m);
  });
});
