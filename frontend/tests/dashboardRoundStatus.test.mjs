import test from 'node:test';
import assert from 'node:assert/strict';
import { roundPhase, roundStatus, dayStatus, isWeekend } from '../src/components/dashboard/roundStatus.js';

// Friday 6 Nov 2026 at a given Bangkok time.
const at = (hhmm, date = '2026-11-06') => new Date(`${date}T${hhmm}:00+07:00`);
const DAY = '2026-11-06';

test('weekend detection uses the Bangkok calendar day', () => {
  assert.equal(isWeekend('2026-11-07'), true); // Saturday
  assert.equal(isWeekend('2026-11-08'), true); // Sunday
  assert.equal(isWeekend('2026-11-06'), false);
});

test('phases follow the round clock', () => {
  assert.equal(roundPhase('morning', { date: DAY, now: at('05:30') }), 'before');
  assert.equal(roundPhase('morning', { date: DAY, now: at('07:00') }), 'open');
  assert.equal(roundPhase('morning', { date: DAY, now: at('10:00') }), 'overdue');
  assert.equal(roundPhase('morning', { date: DAY, now: at('13:00') }), 'closed');
  assert.equal(roundPhase('evening', { date: DAY, now: at('10:00') }), 'before');
  assert.equal(roundPhase('evening', { date: DAY, now: at('16:00') }), 'open');
  assert.equal(roundPhase('evening', { date: DAY, now: at('18:00') }), 'overdue');
  assert.equal(roundPhase('evening', { date: DAY, now: at('19:30') }), 'closed');
  assert.equal(roundPhase('morning', { date: '2026-11-05', now: at('07:00') }), 'past');
  assert.equal(roundPhase('morning', { date: '2026-11-09', now: at('07:00') }), 'future');
  assert.equal(roundPhase('morning', { date: '2026-11-07', now: at('07:00', '2026-11-07') }), 'off_day');
  assert.equal(roundPhase('morning', { date: '2026-11-07', now: at('07:00', '2026-11-07'), isSchoolDay: true }), 'open');
});

test('nothing is red or 0% before a round could have happened', () => {
  const s = roundStatus({ session: 'evening', done: 0, expected: 40, date: DAY, now: at('09:00') });
  assert.equal(s.tone, 'neutral');
  assert.equal(s.label, 'ยังไม่ถึงเวลา');
  const holiday = roundStatus({ session: 'morning', done: 0, expected: 40, date: '2026-11-07', now: at('10:00', '2026-11-07') });
  assert.equal(holiday.tone, 'neutral');
  assert.equal(holiday.label, 'วันหยุด');
  const waiting = roundStatus({ session: 'morning', done: 0, expected: 40, date: DAY, now: at('06:30') });
  assert.equal(waiting.tone, 'neutral');
});

test('in progress is calm, overdue is amber, closed with pupils pending is red', () => {
  assert.equal(roundStatus({ session: 'morning', done: 10, expected: 40, date: DAY, now: at('07:30') }).tone, 'info');
  const late = roundStatus({ session: 'morning', done: 30, expected: 40, date: DAY, now: at('09:30') });
  assert.equal(late.tone, 'warn');
  assert.equal(late.pending, 10);
  const closed = roundStatus({ session: 'evening', done: 38, expected: 40, date: DAY, now: at('19:30') });
  assert.equal(closed.tone, 'danger');
  assert.equal(closed.state, 'not_delivered');
  // A past day with gaps is a record to check, not an emergency.
  assert.equal(roundStatus({ session: 'evening', done: 38, expected: 40, date: '2026-11-05', now: at('09:00') }).tone, 'warn');
});

test('complete, no riders, conflict and unavailable', () => {
  assert.equal(roundStatus({ session: 'morning', done: 40, expected: 40, date: DAY, now: at('08:00') }).tone, 'success');
  assert.equal(roundStatus({ session: 'morning', done: 0, expected: 0, date: DAY, now: at('08:00') }).state, 'no_riders');
  assert.equal(roundStatus({ session: 'morning', done: 1, expected: 4, conflict: 2, date: DAY, now: at('08:00') }).tone, 'danger');
  const u = roundStatus({ session: 'morning', unavailable: true });
  assert.equal(u.state, 'unavailable');
  assert.equal(u.pct, null);
});

test('dayStatus gives one answer, worst first', () => {
  const now = at('10:00');
  const m = roundStatus({ session: 'morning', done: 40, expected: 40, date: DAY, now });
  const e = roundStatus({ session: 'evening', done: 0, expected: 40, date: DAY, now });
  const d = dayStatus([m, e]);
  assert.equal(d.tone, 'success');
  assert.match(d.headline, /รอบเช้าครบแล้ว/);

  const late = roundStatus({ session: 'morning', done: 30, expected: 40, date: DAY, now });
  assert.equal(dayStatus([late, e]).tone, 'warn');
  assert.equal(dayStatus([late, e]).focus, 'morning');
  assert.equal(dayStatus([m, e], { emergencies: 1 }).tone, 'danger');

  const allDone = dayStatus([m, roundStatus({ session: 'evening', done: 40, expected: 40, date: DAY, now: at('17:00') })]);
  assert.equal(allDone.headline, 'รับส่งครบทุกคนแล้ว');
});
