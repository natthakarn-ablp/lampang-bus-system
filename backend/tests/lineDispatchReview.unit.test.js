'use strict';

// Review fixes on PR #148 (stabilization register SB-B2-01..03), DB-free:
// a scripted fake connection/pool records every SQL statement.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/config/env', () => ({ line: { channelAccessToken: '' }, app: { nodeEnv: 'test' }, features: {} }));
jest.mock('../src/services/line.service', () => ({
  isStillLinkedRecipient: jest.fn(async () => true),
  buildNotificationText: jest.fn((type, data) => `msg ${type} ${data && data.n}`),
}));

const line = require('../src/services/line.service');
const d = require('../src/services/lineDispatch.service');

function fakeDb(rows) {
  const log = [];
  const conn = {
    query: jest.fn(async (sql) => {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (/^SELECT id FROM notifications/.test(log[log.length - 1])) return [rows.map((r) => ({ id: r.id }))];
      if (/^SELECT id, target_line_user_id/.test(log[log.length - 1])) return [rows];
      return [{ affectedRows: rows.length }];
    }),
    beginTransaction: jest.fn(async () => { log.push('BEGIN'); }),
    commit: jest.fn(async () => { log.push('COMMIT'); }),
    rollback: jest.fn(async () => { log.push('ROLLBACK'); }),
    release: jest.fn(),
  };
  const settles = [];
  const db = {
    getConnection: jest.fn(async () => conn),
    query: jest.fn(async (sql, params) => { settles.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return [{ affectedRows: 1 }]; }),
  };
  return { db, log, settles };
}

const row = (id, extra = {}) => ({
  id, target_line_user_id: 'U' + id, notification_type: 'checkin', student_id: null,
  message_json: JSON.stringify({ n: id }), retry_key: 'k' + id, attempt_count: 1, key_age_min: 0, ...extra,
});

beforeEach(() => { line.isStillLinkedRecipient.mockClear(); line.buildNotificationText.mockClear(); });

describe('SB-B2-01 no LINE token', () => {
  test.each(['production', 'staging', 'prod', ''])('nodeEnv=%p: queue untouched, nothing counted as sent', async (nodeEnv) => {
    const { db, log, settles } = fakeDb([row(1)]);
    const out = await d.dispatchBatch({ db, token: '', nodeEnv });
    expect(out).toMatchObject({ processed: 0, sent: 0, error: 'NO_LINE_TOKEN' });
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    expect(settles).toEqual([]);
  });

  test('development: dry-run rows are counted as dryRun, never as sent', async () => {
    const { db, settles } = fakeDb([row(1), row(2)]);
    const out = await d.dispatchBatch({ db, token: '', nodeEnv: 'development' });
    expect(out).toMatchObject({ processed: 2, sent: 0, dryRun: 2 });
    expect(settles.every((s) => /DRY_RUN_NO_TOKEN/.test(s.sql))).toBe(true);
  });
});

describe('SB-B2-02 poison rows', () => {
  test('bad JSON and render errors get a terminal FAILED state; good rows still send', async () => {
    line.buildNotificationText.mockImplementation((type, data) => {
      if (data && data.n === 3) throw new Error('boom');
      return 'ok';
    });
    const rows = [row(1, { message_json: '{not json' }), row(2), row(3)];
    const { db, settles } = fakeDb(rows);
    const push = jest.fn(async () => ({ status: 200, requestId: 'r' }));
    const out = await d.dispatchBatch({ db, token: 't', nodeEnv: 'production', push });
    expect(out).toMatchObject({ processed: 3, sent: 1, failed: 2 });
    expect(push).toHaveBeenCalledTimes(1);
    const terminal = settles.filter((s) => /retry_count = 3/.test(s.sql));
    expect(terminal.map((s) => s.params.slice(0, 3))).toEqual([
      ['RENDER_ERROR', 'FAILED', 1], ['RENDER_ERROR', 'FAILED', 3],
    ]);
  });

  test('an unexpected error on one row does not abort the others', async () => {
    line.buildNotificationText.mockImplementation(() => 'ok');
    line.isStillLinkedRecipient.mockImplementationOnce(async () => { throw new Error('db hiccup'); });
    const { db } = fakeDb([row(1, { student_id: 9 }), row(2)]);
    const push = jest.fn(async () => ({ status: 200, requestId: 'r' }));
    const out = await d.dispatchBatch({ db, token: 't', nodeEnv: 'production', push, concurrency: 1 });
    expect(out).toMatchObject({ processed: 2, sent: 1, errors: 1 });
  });
});

describe('SB-B2-03 claim isolation', () => {
  test('claim transaction runs at READ COMMITTED, set before BEGIN', async () => {
    const { db, log } = fakeDb([row(1)]);
    await d.claimBatch({ limit: 10, maxAgeMinutes: 180, types: null, leaseSeconds: 60, db });
    expect(log[0]).toBe('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    expect(log[1]).toBe('BEGIN');
    expect(log[log.length - 1]).toBe('COMMIT');
  });
});
