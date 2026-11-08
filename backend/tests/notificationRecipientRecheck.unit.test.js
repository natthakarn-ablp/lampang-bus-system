'use strict';

// P-07 (parent audit 2026-11-08): a queued check-in notification must not be
// pushed to a LINE account that is no longer linked to the student when the
// queue is drained (unbound, phone changed, link un-approved, student removed).
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/config/env', () => ({ line: { channelAccessToken: '' }, features: {} }));

const { pool } = require('../src/config/database');
const lineSvc = require('../src/services/line.service');

function makeConn({ linked }) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/FROM notifications/i.test(sql)) {
        return [[{
          id: 9, target_line_user_id: 'U_old', notification_type: 'checkin', student_id: 42,
          message_json: { studentName: 'ด.ช.ทดสอบ', status: 'CHECKED_IN', session: 'morning' },
        }]];
      }
      if (/FROM parent_student/i.test(sql)) return [linked ? [{ ok: 1 }] : []];
      return [{ affectedRows: 1 }];
    }),
  };
  pool.getConnection.mockResolvedValue(conn);
  return conn;
}

const updates = (conn) => conn.query.mock.calls.map(c => c[0]).filter(sql => /^\s*UPDATE notifications/i.test(sql));

test('unlinked recipient: not sent, taken out of the queue', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const conn = makeConn({ linked: false });
  const r = await lineSvc.processUnsentNotifications();
  expect(r).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
  expect(updates(conn).some(sql => /sent = TRUE/.test(sql))).toBe(false);
  expect(updates(conn).some(sql => /RECIPIENT_NO_LONGER_LINKED/.test(sql))).toBe(true);
  expect(log.mock.calls.some(c => String(c[0]).includes('[LINE DRY-RUN]'))).toBe(false);
  log.mockRestore();
});

test('still-linked recipient is sent as before', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const conn = makeConn({ linked: true });
  const r = await lineSvc.processUnsentNotifications();
  expect(r).toMatchObject({ processed: 1, sent: 1 });
  expect(updates(conn).some(sql => /sent = TRUE/.test(sql))).toBe(true);
  log.mockRestore();
});
