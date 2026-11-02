'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { applyAttendanceMigration, assertAttendanceSchema, filename } = require('../src/services/attendanceMigration.service');
const sql = fs.readFileSync(path.join(__dirname, '../migrations', filename), 'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');
const readyColumns = () => [
  { COLUMN_NAME: 'attendance_kind', COLUMN_TYPE: "enum('LEAVE','SELF')", IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'LEAVE' },
  ...['morning_enabled_snapshot','evening_enabled_snapshot'].map(COLUMN_NAME => ({ COLUMN_NAME, COLUMN_TYPE: 'tinyint(1)', IS_NULLABLE: 'YES' })),
  { COLUMN_NAME: 'active_session', COLUMN_TYPE: 'varchar(7)', IS_NULLABLE: 'YES', EXTRA: 'STORED GENERATED', GENERATION_EXPRESSION: '(case when (\`cancelled\` = false) then \`session\` else NULL end)' },
];
let state, tracked, columns, indexUnique, postInvalid, acquired, conn;
beforeEach(() => {
  state = 'legacy'; tracked = null; columns = readyColumns(); indexUnique = 0; postInvalid = false; acquired = 1;
  conn = { query: jest.fn(async (query, args) => {
    if (query.includes('GET_LOCK')) return [[{ acquired }]];
    if (query.includes('RELEASE_LOCK')) return [[]];
    if (query.startsWith('SELECT filename')) return [[tracked].filter(Boolean)];
    if (query.includes('information_schema.COLUMNS')) return [state === 'legacy' ? [] : state === 'partial' ? columns.slice(0,1) : columns];
    if (query.includes('information_schema.STATISTICS')) return [(state === 'legacy' ? ['leave_date','student_id','session'] : ['leave_date','student_id','active_session']).map((COLUMN_NAME, i) => ({
      INDEX_NAME: state === 'legacy' ? 'uk_sl_date_student_session' : 'uk_sl_active_date_student_session', COLUMN_NAME, NON_UNIQUE: indexUnique, SEQ_IN_INDEX: i + 1,
    }))];
    if (query === sql) { state = postInvalid ? 'partial' : 'ready'; return [[]]; }
    if (query.startsWith('INSERT INTO schema_migrations')) { tracked = { filename: args[0], checksum: args[1] }; return [{ affectedRows: 1 }]; }
    throw new Error('Unexpected synthetic query');
  }) };
});
test('applies exactly054 then verifies schema before recording its checksum', async () => {
  expect(await applyAttendanceMigration(conn, { sql, checksum })).toMatchObject({ status: 'applied', filename });
  expect(conn.query.mock.calls.filter(([query]) => query === sql)).toHaveLength(1);
  expect(tracked).toEqual({ filename: '054_attendance_kind.sql', checksum });
  expect(conn.query.mock.calls.at(-1)[0]).toContain('RELEASE_LOCK');
});
test('already applied exact checksum and metadata do not rerun DDL or stamp', async () => {
  state = 'ready'; tracked = { filename, checksum };
  expect(await applyAttendanceMigration(conn, { sql, checksum })).toMatchObject({ status: 'already-applied' });
  expect(conn.query.mock.calls.some(([query]) => query === sql || query.startsWith('INSERT'))).toBe(false);
});
test('recovers interrupted ledger stamping only after exact schema validation', async () => {
  state = 'ready';
  expect(await applyAttendanceMigration(conn, { sql, checksum })).toMatchObject({ status: 'recovered-ledger' });
  expect(conn.query.mock.calls.some(([query]) => query === sql)).toBe(false);
});
test('refuses changed migration history without overwriting it', async () => {
  tracked = { filename, checksum: '0'.repeat(64) };
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('checksum differs');
  expect(conn.query.mock.calls.some(([query]) => query === sql || query.startsWith('INSERT'))).toBe(false);
});
test('refuses partial schema rather than retrying ADD COLUMN blindly', async () => {
  state = 'partial';
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('Partial or unexpected');
  expect(conn.query.mock.calls.some(([query]) => query === sql)).toBe(false);
});
test('a generated key must free cancelled history, not just have the correct name', async () => {
  state = 'ready'; columns[3].GENERATION_EXPRESSION = 'session';
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('Partial or unexpected');
});
test('a nonunique key is refused', async () => {
  state = 'ready'; indexUnique = 1;
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('Partial or unexpected');
});
test('does not stamp a failed DDL postcheck', async () => {
  postInvalid = true;
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('DDL postcheck failed');
  expect(tracked).toBeNull();
});
test('a tracked migration with legacy schema is refused', async () => {
  tracked = { filename, checksum };
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('does not match');
});
test('wrong input checksum is rejected before any DB operation', async () => {
  await expect(applyAttendanceMigration(conn, { sql, checksum: '0'.repeat(64) })).rejects.toThrow('source checksum');
  expect(conn.query).not.toHaveBeenCalled();
});
test('does not release another DB lock owner', async () => {
  acquired = 0;
  await expect(applyAttendanceMigration(conn, { sql, checksum })).rejects.toThrow('holds the database lock');
  expect(conn.query).toHaveBeenCalledTimes(1);
});
test('runner dry-run does not read private configuration or create a deploy lock', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance054-dry-'));
  const lock = path.join(temp, 'deploy.lock');
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/apply-migration-054.mjs'), '--dry-run'], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, ENV_FILE: path.join(temp, 'missing-private-env'), SELF_TRAVEL_DEPLOY_LOCK: lock },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dry_run: true, filename, checksum });
    expect(fs.existsSync(lock)).toBe(false);
  } finally { fs.rmdirSync(temp); }
});
test('boot guard accepts a verified ready schema and refuses legacy or unknown metadata', async () => {
  state = 'ready';
  await expect(assertAttendanceSchema(conn)).resolves.toBeUndefined();
  state = 'legacy';
  await expect(assertAttendanceSchema(conn)).rejects.toThrow('refusing startup');
  conn.query.mockRejectedValue(new Error('synthetic private diagnostic'));
  await expect(assertAttendanceSchema(conn)).rejects.toThrow('could not be verified');
});
test('boot calls the attendance schema guard before opening the listener', () => {
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  expect(index.indexOf('await assertAttendanceSchema(pool)')).toBeGreaterThan(index.indexOf('await testConnection()'));
  expect(index.indexOf('await assertAttendanceSchema(pool)')).toBeLessThan(index.indexOf('app.listen('));
});
