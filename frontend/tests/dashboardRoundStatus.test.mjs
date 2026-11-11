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

test('in progress is calm, overdue is amber, closed with pupils pending is amber (not red)', () => {
  assert.equal(roundStatus({ session: 'morning', done: 10, expected: 40, date: DAY, now: at('07:30') }).tone, 'info');
  const late = roundStatus({ session: 'morning', done: 30, expected: 40, date: DAY, now: at('09:30') });
  assert.equal(late.tone, 'warn');
  assert.equal(late.pending, 10);
  const closed = roundStatus({ session: 'evening', done: 38, expected: 40, date: DAY, now: at('19:30') });
  assert.equal(closed.tone, 'warn');
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

// ── After the rounds: a calm day summary, said once (production 21:00 report) ──
test('a closed round is not red and its card does not repeat the summary sentence', () => {
  const closed = roundStatus({ session: 'morning', done: 0, expected: 12, date: DAY, now: at('21:00') });
  assert.equal(closed.state, 'not_delivered');
  assert.notEqual(closed.tone, 'danger');
  assert.equal(closed.label, 'ยังไม่ยืนยัน 12 คน');
  assert.doesNotMatch(closed.detail, /หมดรอบแล้ว/);
});

test('after all rounds the hero is a neutral whole-day summary, not the morning alarm', () => {
  const now = at('21:00');
  const m = roundStatus({ session: 'morning', done: 0, expected: 12, date: DAY, now });
  const e = roundStatus({ session: 'evening', done: 0, expected: 12, date: DAY, now });
  const d = dayStatus([m, e]);
  assert.equal(d.tone, 'neutral');
  assert.equal(d.kind, 'summary');
  assert.match(d.headline, /^สรุปวันนี้: /);
  assert.match(d.headline, /รอบเช้า 12 คน · รอบเย็น 12 คน/);
  assert.equal(d.focus, 'evening');
  // "หมดรอบแล้ว" is said once on the whole hero (summary + both cards).
  const text = [d.headline, d.sub, m.label, m.detail, e.label, e.detail].join(' | ');
  assert.equal(text.split('หมดรอบแล้ว').length - 1, 1);

  // Only the evening still pending: one-line result with the numbers.
  const mDone = roundStatus({ session: 'morning', done: 12, expected: 12, date: DAY, now });
  const one = dayStatus([mDone, e]);
  assert.equal(one.tone, 'neutral');
  assert.equal(one.headline, 'สรุปวันนี้: รอบเย็น ยืนยันแล้ว 0/12 คน · ยังไม่ยืนยัน 12 คน');
});

test('during the evening round the hero talks about the evening, never the finished morning', () => {
  const m = roundStatus({ session: 'morning', done: 0, expected: 12, date: DAY, now: at('16:00') });
  const open = dayStatus([m, roundStatus({ session: 'evening', done: 3, expected: 12, date: DAY, now: at('16:00') })]);
  assert.equal(open.focus, 'evening');
  assert.match(open.headline, /^รอบเย็น/);
  assert.equal(open.tone, 'info');
  const waiting = dayStatus([m, roundStatus({ session: 'evening', done: 0, expected: 12, date: DAY, now: at('15:00') })]);
  assert.equal(waiting.focus, 'evening');
  assert.match(waiting.headline, /^รอบเย็น/);
  const late = dayStatus([
    roundStatus({ session: 'morning', done: 0, expected: 12, date: DAY, now: at('18:00') }),
    roundStatus({ session: 'evening', done: 5, expected: 12, date: DAY, now: at('18:00') }),
  ]);
  assert.equal(late.tone, 'warn'); // in-round behaviour kept: overdue is amber
  assert.equal(late.headline, 'รอบเย็นยังค้าง 7 คน');
});

test('between rounds the morning result is a calm summary that points to the evening', () => {
  const now = at('13:00');
  const d = dayStatus([
    roundStatus({ session: 'morning', done: 10, expected: 12, date: DAY, now }),
    roundStatus({ session: 'evening', done: 0, expected: 12, date: DAY, now }),
  ]);
  assert.equal(d.tone, 'neutral');
  assert.equal(d.headline, 'สรุปรอบเช้า: ยืนยันแล้ว 10/12 คน · ยังไม่ยืนยัน 2 คน');
  assert.match(d.sub, /^รอบเย็นเริ่มประมาณ 14:30 น\./);
});

test('a past date is a neutral whole-day summary', () => {
  const now = at('09:00');
  const d = dayStatus([
    roundStatus({ session: 'morning', done: 40, expected: 40, date: '2026-11-05', now }),
    roundStatus({ session: 'evening', done: 38, expected: 40, date: '2026-11-05', now }),
  ]);
  assert.equal(d.tone, 'neutral');
  assert.equal(d.headline, 'สรุปทั้งวัน: รอบเย็น ยืนยันแล้ว 38/40 คน · ยังไม่ยืนยัน 2 คน');
  assert.doesNotMatch(d.sub, /หมดรอบแล้ว/);
});

test('conflicts and emergencies stay red after the rounds', () => {
  const now = at('21:00');
  const e = roundStatus({ session: 'evening', done: 0, expected: 12, date: DAY, now });
  assert.equal(dayStatus([roundStatus({ session: 'morning', done: 1, expected: 12, conflict: 1, date: DAY, now }), e]).tone, 'danger');
  assert.equal(dayStatus([e], { emergencies: 1 }).tone, 'danger');
});
