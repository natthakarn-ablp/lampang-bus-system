'use strict';
// Targeted, operator-run applier for migration 055 only (never a general runner).
const crypto = require('node:crypto');

const filename = '055_school_year_promotions.sql';
const TABLE = 'school_year_promotions';
const EXPECTED = {
  id: /^bigint/i,
  school_id: /^varchar\(10\)$/i,
  academic_year: /^smallint/i,
  performed_by: /^int/i,
  promoted_count: /^int/i,
  graduated_count: /^int/i,
  excluded_count: /^int/i,
  unreadable_count: /^int/i,
  performed_at: /^timestamp/i,
};

function refuse(message) {
  const error = new Error(message);
  error.code = 'PROMOTION_MIGRATION_REFUSED';
  throw error;
}

/** 'absent' | 'ready' | 'invalid' — exact metadata check, no data read. */
async function structure(conn) {
  const [columns] = await conn.query(
    'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [TABLE]
  );
  if (!columns.length) return 'absent';
  const byName = Object.fromEntries(columns.map((c) => [c.COLUMN_NAME, c]));
  const names = Object.keys(EXPECTED);
  if (columns.length !== names.length) return 'invalid';
  for (const name of names) {
    if (!byName[name] || !EXPECTED[name].test(byName[name].COLUMN_TYPE)) return 'invalid';
  }
  if (byName.school_id.IS_NULLABLE !== 'NO' || byName.academic_year.IS_NULLABLE !== 'NO') return 'invalid';
  const [indexes] = await conn.query(
    'SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX',
    [TABLE, 'uk_school_year']
  );
  const unique = indexes.length === 2 && indexes.every((r) => !Number(r.NON_UNIQUE))
    && indexes[0].COLUMN_NAME === 'school_id' && indexes[1].COLUMN_NAME === 'academic_year';
  return unique ? 'ready' : 'invalid';
}

function checkChecksum(sql, checksum) {
  if (!/^[a-f0-9]{64}$/.test(checksum || '') || crypto.createHash('sha256').update(sql).digest('hex') !== checksum) {
    refuse('Migration source checksum does not match');
  }
}

async function applyPromotionMigration(conn, { sql, checksum }) {
  checkChecksum(sql, checksum);
  const [[lock]] = await conn.query("SELECT GET_LOCK('schoolbus:migration:055',0) AS acquired");
  if (Number(lock?.acquired) !== 1) refuse('Another migration operation holds the database lock');
  try {
    const [[tracked]] = await conn.query('SELECT filename,checksum FROM schema_migrations WHERE filename=?', [filename]);
    if (tracked && tracked.checksum !== checksum) refuse('Tracked migration checksum differs; do not overwrite it');
    const before = await structure(conn);
    if (tracked) {
      if (before !== 'ready') refuse('Tracked migration does not match the actual schema');
      return { status: 'already-applied', filename, checksum };
    }
    if (before === 'invalid') refuse('Partial or unexpected table; manual inspection is required');
    if (before === 'absent') {
      await conn.query(sql);
      if (await structure(conn) !== 'ready') refuse('DDL postcheck failed; ledger was not stamped');
    }
    await conn.query('INSERT INTO schema_migrations(filename,checksum) VALUES (?,?)', [filename, checksum]);
    return { status: before === 'absent' ? 'applied' : 'recovered-ledger', filename, checksum };
  } finally {
    await conn.query("SELECT RELEASE_LOCK('schoolbus:migration:055')");
  }
}

async function verifyPromotionMigration(conn, { checksum }) {
  if (!/^[a-f0-9]{64}$/.test(checksum || '')) refuse('Expected checksum is invalid');
  if (await structure(conn) !== 'ready') refuse('school_year_promotions is missing or does not match migration 055');
  const [[tracked]] = await conn.query('SELECT filename,checksum FROM schema_migrations WHERE filename=?', [filename]);
  if (!tracked || tracked.checksum !== checksum) refuse('Schema verified but 055 ledger is missing or checksum differs');
  return { status: 'verified', filename, checksum };
}

module.exports = { filename, structure, applyPromotionMigration, verifyPromotionMigration };
