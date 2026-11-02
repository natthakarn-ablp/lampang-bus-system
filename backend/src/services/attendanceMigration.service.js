'use strict';
const crypto = require('node:crypto');
const filename = '054_attendance_kind.sql';
const names = ['attendance_kind', 'morning_enabled_snapshot', 'evening_enabled_snapshot', 'active_session'];
function refuse(message) { const error = new Error(message); error.code = 'ATTENDANCE_MIGRATION_REFUSED'; throw error; }
async function structure(conn) {
  const [columns] = await conn.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_leaves'");
  const [indexes] = await conn.query("SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_leaves'");
  const selected = columns.filter(row => names.includes(row.COLUMN_NAME));
  const index = name => indexes.filter(row => row.INDEX_NAME === name).sort((a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX));
  const isUnique = (rows, expected) => rows.length === expected.length && rows.every((row, i) => !Number(row.NON_UNIQUE) && row.COLUMN_NAME === expected[i]);
  const legacy = index('uk_sl_date_student_session');
  const active = index('uk_sl_active_date_student_session');
  if (!selected.length && !active.length && isUnique(legacy, ['leave_date', 'student_id', 'session'])) return 'legacy';
  if (selected.length !== names.length || legacy.length || !isUnique(active, ['leave_date', 'student_id', 'active_session'])) return 'invalid';
  const byName = Object.fromEntries(selected.map(row => [row.COLUMN_NAME, row]));
  const kind = byName.attendance_kind;
  if (!/^enum\('LEAVE','SELF'\)$/i.test(kind.COLUMN_TYPE) || kind.IS_NULLABLE !== 'NO' || String(kind.COLUMN_DEFAULT).replace(/^'|'$/g, '') !== 'LEAVE') return 'invalid';
  for (const name of names.slice(1, 3)) if (!/^tinyint(?:\(1\))?$/i.test(byName[name].COLUMN_TYPE) || byName[name].IS_NULLABLE !== 'YES'
    || (byName[name].COLUMN_DEFAULT != null && String(byName[name].COLUMN_DEFAULT).toUpperCase() !== 'NULL')) return 'invalid';
  const generated = byName.active_session;
  const expression = String(generated.GENERATION_EXPRESSION || '').replace(/[`\s()]/g, '').toLowerCase();
  if (!/^varchar\(7\)$/i.test(generated.COLUMN_TYPE) || generated.IS_NULLABLE !== 'YES' || !/STORED|PERSISTENT/i.test(generated.EXTRA) || !/^casewhencancelled=(?:0|false)thensessionelsenullend$/.test(expression)) return 'invalid';
  return 'ready';
}
async function applyAttendanceMigration(conn, { sql, checksum }) {
  if (!/^[a-f0-9]{64}$/.test(checksum || '') || crypto.createHash('sha256').update(sql).digest('hex') !== checksum) refuse('Migration source checksum does not match');
  const [[lock]] = await conn.query("SELECT GET_LOCK('schoolbus:migration:054',0) AS acquired");
  if (Number(lock?.acquired) !== 1) refuse('Another migration operation holds the database lock');
  try {
    const [[tracked]] = await conn.query('SELECT filename,checksum FROM schema_migrations WHERE filename=?', [filename]);
    if (tracked && tracked.checksum !== checksum) refuse('Tracked migration checksum differs; do not overwrite it');
    const before = await structure(conn);
    if (tracked) {
      if (before !== 'ready') refuse('Tracked migration does not match the actual schema');
      return { status: 'already-applied', filename, checksum };
    }
    if (before === 'invalid') refuse('Partial or unexpected schema; manual inspection is required');
    if (before === 'legacy') {
      await conn.query(sql);
      if (await structure(conn) !== 'ready') refuse('DDL postcheck failed; ledger was not stamped');
    }
    // A previous interrupted attempt may have committed the atomic DDL but not
    // its ledger entry. Exact metadata validation above permits safe recovery.
    await conn.query('INSERT INTO schema_migrations(filename,checksum) VALUES (?,?)', [filename, checksum]);
    return { status: before === 'legacy' ? 'applied' : 'recovered-ledger', filename, checksum };
  } finally { await conn.query("SELECT RELEASE_LOCK('schoolbus:migration:054')"); }
}
async function assertAttendanceSchema(conn) {
  let ready = false;
  try { ready = await structure(conn) === 'ready'; } catch { /* metadata is not verified */ }
  if (!ready) refuse('Migration054 attendance schema is missing or could not be verified; refusing startup');
}
module.exports = { filename, structure, applyAttendanceMigration, assertAttendanceSchema };
