'use strict';
require('./loadTestEnv');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const svc = require('../src/services/schoolYearPromotionMigration.service');

const sql = fs.readFileSync(path.join(__dirname, '../migrations', svc.filename), 'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');

const COLS = [
  ['id', 'bigint', 'NO'], ['school_id', 'varchar(10)', 'NO'], ['academic_year', 'smallint', 'NO'],
  ['performed_by', 'int', 'YES'], ['promoted_count', 'int', 'NO'], ['graduated_count', 'int', 'NO'],
  ['excluded_count', 'int', 'NO'], ['unreadable_count', 'int', 'NO'], ['performed_at', 'timestamp', 'NO'],
].map(([COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE]) => ({ COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE }));
const IDX = [{ COLUMN_NAME: 'school_id', NON_UNIQUE: 0 }, { COLUMN_NAME: 'academic_year', NON_UNIQUE: 0 }];

function fakeConn({ table = 'absent', tracked = null, lock = 1 } = {}) {
  const state = { table, tracked, ddl: 0, ledger: 0, released: 0 };
  return {
    state,
    query: jest.fn(async (q, params) => {
      if (q.includes('GET_LOCK')) return [[{ acquired: lock }]];
      if (q.includes('RELEASE_LOCK')) { state.released += 1; return [[{}]]; }
      if (q.includes('FROM schema_migrations')) return [state.tracked ? [state.tracked] : []];
      if (q.includes('information_schema.COLUMNS')) return [state.table === 'absent' ? [] : state.table === 'invalid' ? COLS.slice(1) : COLS];
      if (q.includes('information_schema.STATISTICS')) return [IDX];
      if (q.startsWith('INSERT INTO schema_migrations')) { state.ledger += 1; return [{}]; }
      if (/CREATE TABLE/.test(q)) { state.ddl += 1; state.table = 'ready'; return [{}]; }
      throw new Error('unexpected sql ' + q + params);
    }),
  };
}

test('creates the table once, stamps the ledger, and releases the lock', async () => {
  const c = fakeConn();
  expect(await svc.applyPromotionMigration(c, { sql, checksum })).toMatchObject({ status: 'applied', filename: svc.filename });
  expect(c.state).toMatchObject({ ddl: 1, ledger: 1, released: 1 });
});

test('already tracked and matching: no DDL, no second ledger row', async () => {
  const c = fakeConn({ table: 'ready', tracked: { filename: svc.filename, checksum } });
  expect(await svc.applyPromotionMigration(c, { sql, checksum })).toMatchObject({ status: 'already-applied' });
  expect(c.state).toMatchObject({ ddl: 0, ledger: 0, released: 1 });
});

test('table exists but ledger missing: only recovers the ledger', async () => {
  const c = fakeConn({ table: 'ready' });
  expect(await svc.applyPromotionMigration(c, { sql, checksum })).toMatchObject({ status: 'recovered-ledger' });
  expect(c.state).toMatchObject({ ddl: 0, ledger: 1 });
});

test.each([
  ['wrong checksum', fakeConn(), { sql, checksum: 'a'.repeat(64) }],
  ['malformed checksum', fakeConn(), { sql, checksum: 'x' }],
  ['unexpected table shape', fakeConn({ table: 'invalid' }), { sql, checksum }],
  ['ledger checksum differs', fakeConn({ table: 'ready', tracked: { filename: svc.filename, checksum: 'b'.repeat(64) } }), { sql, checksum }],
  ['another operation holds the DB lock', fakeConn({ lock: 0 }), { sql, checksum }],
])('refuses: %s', async (_name, c, args) => {
  await expect(svc.applyPromotionMigration(c, args)).rejects.toMatchObject({ code: 'PROMOTION_MIGRATION_REFUSED' });
  expect(c.state.ddl).toBe(0);
  expect(c.state.ledger).toBe(0);
});

test('verify is read-only and needs table + matching ledger', async () => {
  const ok = fakeConn({ table: 'ready', tracked: { filename: svc.filename, checksum } });
  expect(await svc.verifyPromotionMigration(ok, { checksum })).toMatchObject({ status: 'verified' });
  await expect(svc.verifyPromotionMigration(fakeConn(), { checksum })).rejects.toMatchObject({ code: 'PROMOTION_MIGRATION_REFUSED' });
  await expect(svc.verifyPromotionMigration(fakeConn({ table: 'ready' }), { checksum })).rejects.toMatchObject({ code: 'PROMOTION_MIGRATION_REFUSED' });
  expect(ok.state).toMatchObject({ ddl: 0, ledger: 0 });
});

test('runner dry run touches nothing and reports the checksum', () => {
  const out = require('node:child_process').execFileSync('node', [path.join(__dirname, '../../scripts/apply-migration-055.mjs')], { encoding: 'utf8' });
  expect(JSON.parse(out)).toMatchObject({ dry_run: true, filename: svc.filename, checksum });
});
