import test from 'node:test';
import assert from 'node:assert/strict';
import { roundsNotStarted } from '../src/utils/reportRounds.js';
import {
  rateLimitMessage, retryAfterSeconds, notifyRateLimited, resetRateLimitNotice, RATE_LIMIT_EVENT,
} from '../src/utils/rateLimitNotice.js';

// 2026-11-12 10:30 Bangkok = 03:30Z; 13:00 Bangkok = 06:00Z.
const MORNING = new Date('2026-11-12T03:30:00Z');
const AFTERNOON = new Date('2026-11-12T06:00:00Z');

test('evening round is not started before 12:00 Bangkok on the same day', () => {
  assert.deepEqual(roundsNotStarted('2026-11-12', MORNING), { morning: false, evening: true });
  assert.deepEqual(roundsNotStarted('2026-11-12', AFTERNOON), { morning: false, evening: false });
});

test('past dates are never pending and future dates are fully pending', () => {
  assert.deepEqual(roundsNotStarted('2026-11-11', MORNING), { morning: false, evening: false });
  assert.deepEqual(roundsNotStarted('2026-11-13', AFTERNOON), { morning: true, evening: true });
});

test('rate-limit message keeps the server text and adds a wait hint', () => {
  assert.equal(rateLimitMessage({ message: 'ขอรายงานถี่เกินไป กรุณารอสักครู่' }, { 'retry-after': '240' }),
    'ขอรายงานถี่เกินไป กรุณารอสักครู่ (ลองใหม่ได้ในอีกประมาณ 4 นาที)');
  assert.equal(rateLimitMessage({ message: 'คำขอถี่เกินไป กรุณารอสักครู่' }, { 'ratelimit-reset': '30' }),
    'คำขอถี่เกินไป กรุณารอสักครู่ (ลองใหม่ได้ในอีกประมาณ 30 วินาที)');
  assert.equal(rateLimitMessage(null, {}), 'ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
});

test('retry-after is read from fetch Headers too', () => {
  const h = new Headers({ 'Retry-After': '61' });
  assert.equal(retryAfterSeconds(h), 61);
  assert.equal(retryAfterSeconds(null), null);
});

test('notifyRateLimited sends one event per quiet window', () => {
  const seen = [];
  globalThis.window = new EventTarget();
  window.addEventListener(RATE_LIMIT_EVENT, (e) => seen.push(e.detail.message));
  try {
    resetRateLimitNotice();
    assert.equal(notifyRateLimited({ message: 'ก' }, {}, 100_000), true);
    assert.equal(notifyRateLimited({ message: 'ข' }, {}, 101_000), false);
    assert.equal(notifyRateLimited({ message: 'ค' }, {}, 120_000), true);
    assert.deepEqual(seen, ['ก', 'ค']);
  } finally {
    delete globalThis.window;
  }
});
