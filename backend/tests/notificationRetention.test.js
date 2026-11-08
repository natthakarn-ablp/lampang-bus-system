'use strict';

// PERF-002 — on the CI MySQL: EXPLAIN evidence for the dispatch-queue and
// retention queries before/after the indexes from 059/060, and a retention run
// that must keep pending / claimed / UNKNOWN notifications.
// 059 + 060 are applied to the disposable test DB here and rolled back after.
require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const { getTestConnection } = require('./dbHelper');
const { pool } = require('../src/config/database');
const cleanup = require('../scripts/cleanup-notification-logs');

const M = (f) => fs.readFileSync(path.join(__dirname, '../migrations', f), 'utf8');
// The test connection has multipleStatements off; the owner's mysql CLI apply
// runs the file as is. Strip comment lines and run each statement.
async function runSqlFile(c, f) {
  const body = M(f).split('
').filter(l => !/^\s*--/.test(l)).join('
');
  for (const stmt of body.split(';').map(x => x.trim()).filter(Boolean)) await c.query(stmt);
}
const LID = 'U__ret_a';
const applied = [];
const plans = {};

const QUEUE_SQL = `SELECT id FROM notifications
  WHERE sent = FALSE AND retry_count < 3 AND created_at >= DATE_SUB(NOW(), INTERVAL 180 MINUTE)
  ORDER BY created_at ASC LIMIT 50`;
const NOTIF_RET_SQL = () => `SELECT id FROM notifications WHERE ${cleanup.eligibleWhere(cleanup.TARGETS.notifications, 90)} ORDER BY created_at, id LIMIT 1000`;
const LML_RET_SQL = () => `SELECT id FROM line_message_logs WHERE ${cleanup.eligibleWhere(cleanup.TARGETS.line_message_logs, 30)} ORDER BY created_at, id LIMIT 1000`;

async function explain(c, sql) {
  const [rows] = await c.query(`EXPLAIN ${sql}`);
  return rows.map(r => ({ table: r.table, type: r.type, possible_keys: r.possible_keys, key: r.key, rows: r.rows, Extra: r.Extra }));
}
async function hasColumn(c, table, col) {
  const [[{ n }]] = await c.query(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', [table, col]);
  return Number(n) > 0;
}
async function hasIndex(c, table, idx) {
  const [[{ n }]] = await c.query(
    'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?', [table, idx]);
  return Number(n) > 0;
}

beforeAll(async () => {
  const c = await getTestConnection();
  try {
    await c.query("INSERT IGNORE INTO line_users(line_user_id,user_type,verified) VALUES (?, 'parent', FALSE)", [LID]);
    // 6,000 synthetic notifications over ~200 days, mostly sent; 3,000 log rows.
    await c.query('SET SESSION cte_max_recursion_depth = 10000');
    await c.query(`INSERT INTO notifications(target_line_user_id,notification_type,student_id,message_json,sent,retry_count,created_at)
      WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < 6000)
      SELECT ?, 'system', NULL, JSON_OBJECT('n', n), n % 50 <> 0, 0, NOW() - INTERVAL (n * 48) MINUTE FROM s`, [LID]);
    await c.query(`INSERT INTO line_message_logs(line_user_id,source_type,message_text,created_at)
      WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < 3000)
      SELECT ?, 'user', CONCAT('synthetic ', n), NOW() - INTERVAL (n * 96) MINUTE FROM s`, [LID]);
    await c.query('ANALYZE TABLE notifications, line_message_logs');
    plans.before = { queue: await explain(c, QUEUE_SQL), lml: await explain(c, LML_RET_SQL()) };
    if (!(await hasColumn(c, 'notifications', 'claim_token'))) { await runSqlFile(c, '059_notification_dispatch_lease.sql'); applied.push('059'); }
    if (!(await hasIndex(c, 'line_message_logs', 'idx_lml_created'))) { await runSqlFile(c, '060_notification_log_retention_indexes.sql'); applied.push('060'); }
    await c.query('ANALYZE TABLE notifications, line_message_logs');
    plans.after = { queue: await explain(c, QUEUE_SQL), notif: await explain(c, NOTIF_RET_SQL()), lml: await explain(c, LML_RET_SQL()) };
    // Evidence for the PR / docs (CI log).
    console.log('[PERF-002 EXPLAIN]', JSON.stringify(plans));
  } finally { await c.end(); }
});

afterAll(async () => {
  const c = await getTestConnection();
  try {
    await c.query('DELETE FROM notifications WHERE target_line_user_id = ?', [LID]);
    await c.query('DELETE FROM line_message_logs WHERE line_user_id = ?', [LID]);
    await c.query('DELETE FROM line_users WHERE line_user_id = ?', [LID]);
    if (applied.includes('060')) await runSqlFile(c, 'rollback/060_notification_log_retention_indexes_rollback.sql');
    if (applied.includes('059')) await runSqlFile(c, 'rollback/059_notification_dispatch_lease_rollback.sql');
  } finally { await c.end(); }
  await pool.end();
});

test('queue query can use idx_notif_queue after 059', () => {
  expect(String(plans.after.queue[0].possible_keys || '')).toMatch(/idx_notif_queue/);
  expect(plans.after.queue[0].type).not.toBe('ALL');
});

test('line_message_logs retention scans by idx_lml_created after 060 (full scan before)', () => {
  expect(plans.before.lml[0].type).toBe('ALL');
  expect(String(plans.after.lml[0].possible_keys || '')).toMatch(/idx_lml_created/);
  expect(plans.after.lml[0].type).not.toBe('ALL');
});

test('notifications retention query has an index available after 060', () => {
  expect(String(plans.after.notif[0].possible_keys || '')).toMatch(/idx_notif_created|idx_notif_queue/);
});

test('retention apply keeps pending, claimed and UNKNOWN notifications', async () => {
  // Old rows in every state that must survive.
  await pool.query(`INSERT INTO notifications(target_line_user_id,notification_type,message_json,sent,retry_count,delivery_state,claim_token,created_at) VALUES
    (?, 'system', '{}', FALSE, 0, 'PENDING', NULL, NOW() - INTERVAL 200 DAY),
    (?, 'system', '{}', FALSE, 1, 'UNKNOWN', 'aaaaaaaa-0000-0000-0000-000000000000', NOW() - INTERVAL 200 DAY),
    (?, 'system', '{}', FALSE, 3, 'UNKNOWN', NULL, NOW() - INTERVAL 200 DAY),
    (?, 'system', '{}', FALSE, 3, 'FAILED', NULL, NOW() - INTERVAL 200 DAY)`, [LID, LID, LID, LID]);
  const count = async (where) => Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE target_line_user_id = ? AND ${where}`, [LID]))[0][0].n);
  const keptBefore = await count("(sent = FALSE AND retry_count < 3) OR claim_token IS NOT NULL OR delivery_state = 'UNKNOWN'");
  const recentBefore = await count('created_at >= NOW() - INTERVAL 90 DAY');
  const lmlRecentBefore = Number((await pool.query('SELECT COUNT(*) n FROM line_message_logs WHERE line_user_id = ? AND created_at >= NOW() - INTERVAL 30 DAY', [LID]))[0][0].n);

  const out = await cleanup.run(pool, { apply: true, notificationsDays: 90, lineLogDays: 30, batch: 500, maxBatches: 100, pauseMs: 0 });
  console.log('[PERF-002 retention synthetic]', JSON.stringify(out));
  expect(out[0].deleted).toBeGreaterThan(0);
  expect(await count("(sent = FALSE AND retry_count < 3) OR claim_token IS NOT NULL OR delivery_state = 'UNKNOWN'")).toBe(keptBefore);
  expect(await count('created_at >= NOW() - INTERVAL 90 DAY')).toBe(recentBefore);
  expect(await count("delivery_state = 'FAILED' AND created_at < NOW() - INTERVAL 90 DAY")).toBe(0);
  expect(await count('sent = TRUE AND created_at < NOW() - INTERVAL 90 DAY')).toBe(0);
  const [[lml]] = await pool.query('SELECT COUNT(*) n, MIN(created_at) oldest FROM line_message_logs WHERE line_user_id = ?', [LID]);
  expect(Number(lml.n)).toBe(lmlRecentBefore);
});
