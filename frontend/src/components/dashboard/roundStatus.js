/**
 * roundStatus.js — time-aware status of one pick-up/drop-off round.
 *
 * Pure functions (no React, no import.meta) so they run under `node --test`
 * (tests/dashboardRoundStatus.test.mjs) and give every dashboard and report
 * the same answer for the same numbers.
 *
 * Colour rules (docs/design/dashboard-redesign.md §3):
 *   neutral  ยังไม่ถึงเวลา / วันหยุด / ไม่มีนักเรียนใช้รถ / ไม่มีข้อมูล
 *   info     กำลังรับส่ง (round open, nothing late yet)
 *   warn     เลยเวลาที่ควรเสร็จแล้ว แต่ยังค้าง · หรือวันก่อนหน้าที่บันทึกค้าง
 *   success  ครบแล้ว
 *   danger   only for real problems: data conflict, or pupils still not
 *            confirmed after the round has closed today
 *
 * Round times: the only server-side setting is DRIVER_SESSION_SWITCH_HOUR
 * (default 12, the morning/evening split also used by TeacherCheck and
 * utils/reportRounds.js). The other times are product defaults kept here in
 * one place; there is no per-school setting for them.
 */

export const ROUND_TIMES = {
  switchHour: 12,
  // minutes after midnight, Asia/Bangkok
  morning: { opensAt: 6 * 60, dueBy: 9 * 60, closesAt: 12 * 60 },
  evening: { opensAt: 14 * 60 + 30, dueBy: 17 * 60 + 30, closesAt: 19 * 60 },
};

export const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น' };
// What "done" means for the round, in the words staff use.
export const SESSION_DONE_VERB = { morning: 'ส่งถึงโรงเรียน', evening: 'ส่งถึงบ้าน' };

const fmt = n => Number(n || 0).toLocaleString('th-TH');
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** { today: 'YYYY-MM-DD', minutes } in Asia/Bangkok for `now`. */
export function bangkokClock(now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const parts = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }).split(':');
  const minutes = (Number(parts[0]) % 24) * 60 + Number(parts[1]);
  return { today, minutes };
}

/** Saturday or Sunday (the only school-day rule the backend has, see affiliation is_school_day). */
export function isWeekend(date) {
  if (!date) return false;
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00+07:00`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Where a round of `date` stands in time.
 *   'off_day' | 'future' | 'before' | 'open' | 'overdue' | 'closed' | 'past'
 * `isSchoolDay` (from an API, e.g. affiliation dashboard) wins over the
 * weekend rule when it is a boolean.
 */
export function roundPhase(session, { date, now = new Date(), isSchoolDay, times = ROUND_TIMES } = {}) {
  const { today, minutes } = bangkokClock(now);
  const day = date ? String(date).slice(0, 10) : today;
  const offDay = typeof isSchoolDay === 'boolean' ? !isSchoolDay : isWeekend(day);
  if (offDay) return 'off_day';
  if (day > today) return 'future';
  if (day < today) return 'past';
  const t = times[session] || times.morning;
  if (minutes < t.opensAt) return 'before';
  if (minutes < t.dueBy) return 'open';
  if (minutes < t.closesAt) return 'overdue';
  return 'closed';
}

/**
 * Status of one round.
 * @param {object} p
 * @param {'morning'|'evening'} p.session
 * @param {number} p.done        pupils confirmed (ส่งแล้ว/รับแล้ว)
 * @param {number} p.expected    pupils who ride this round (leave and self-travel excluded)
 * @param {string} [p.date]      YYYY-MM-DD, defaults to today (Bangkok)
 * @param {Date}   [p.now]
 * @param {boolean} [p.isSchoolDay]
 * @param {boolean|number} [p.conflict]  attendance conflict flag/count from the API
 * @param {boolean} [p.unavailable]      the feed failed: show "—", never 0
 * @returns {{ session, state, tone, label, detail, done, expected, pending, pct, phase }}
 */
export function roundStatus({ session = 'morning', done = 0, expected = 0, date, now = new Date(), isSchoolDay, conflict, unavailable, times = ROUND_TIMES } = {}) {
  const d = Math.max(0, Number(done) || 0);
  const e = Math.max(0, Number(expected) || 0);
  const pending = Math.max(0, e - d);
  const pct = e > 0 ? Math.min(100, Math.round((d / e) * 100)) : null;
  const phase = roundPhase(session, { date, now, isSchoolDay, times });
  const t = times[session] || times.morning;
  const base = { session, done: d, expected: e, pending, pct, phase };
  const verb = SESSION_DONE_VERB[session] || SESSION_DONE_VERB.morning;

  if (unavailable) return { ...base, pct: null, state: 'unavailable', tone: 'neutral', label: 'ไม่มีข้อมูล', detail: 'โหลดข้อมูลไม่สำเร็จ' };
  if (conflict) return { ...base, state: 'conflict', tone: 'danger', label: 'ข้อมูลขัดกัน', detail: 'มีการบันทึกการเดินทางขัดกัน กรุณาตรวจสอบ' };
  if (e === 0) {
    return { ...base, state: 'no_riders', tone: 'neutral', label: phase === 'off_day' ? 'วันหยุด' : 'ไม่มีผู้ใช้รถ', detail: 'ไม่มีนักเรียนใช้รถในรอบนี้' };
  }
  if (pending === 0) return { ...base, state: 'complete', tone: 'success', label: 'ครบแล้ว', detail: `${verb}ครบ ${fmt(d)} คน` };

  const progress = `${fmt(d)} จาก ${fmt(e)} คน`;
  switch (phase) {
    case 'off_day':
      return d > 0
        ? { ...base, state: 'off_day', tone: 'neutral', label: 'วันหยุด', detail: `มีการรับส่ง ${progress}` }
        : { ...base, state: 'off_day', tone: 'neutral', label: 'วันหยุด', detail: 'ไม่มีการรับส่งตามปกติ' };
    case 'future':
      return { ...base, state: 'not_yet', tone: 'neutral', label: 'ยังไม่ถึงวัน', detail: `นักเรียนใช้รถ ${fmt(e)} คน` };
    case 'before':
      return { ...base, state: 'not_yet', tone: 'neutral', label: 'ยังไม่ถึงเวลา', detail: `เริ่มประมาณ ${hhmm(t.opensAt)} น. · ใช้รถ ${fmt(e)} คน` };
    case 'open':
      return d === 0
        ? { ...base, state: 'waiting', tone: 'neutral', label: 'รอเริ่มรอบ', detail: `ยังไม่มีการเช็กชื่อ · ใช้รถ ${fmt(e)} คน` }
        : { ...base, state: 'in_progress', tone: 'info', label: 'กำลังรับส่ง', detail: `${verb}แล้ว ${progress}` };
    case 'overdue':
      return { ...base, state: 'overdue', tone: 'warn', label: `ค้าง ${fmt(pending)} คน`, detail: `เลย ${hhmm(t.dueBy)} น. แล้ว · ${verb}แล้ว ${progress}` };
    case 'closed':
      return { ...base, state: 'not_delivered', tone: 'danger', label: `ยังไม่ยืนยัน ${fmt(pending)} คน`, detail: `หมดรอบแล้ว ยังไม่ยืนยันว่า${verb} ${fmt(pending)} คน` };
    case 'past':
    default:
      return { ...base, state: 'incomplete_record', tone: 'warn', label: `ค้าง ${fmt(pending)} คน`, detail: `บันทึกไว้ ${progress}` };
  }
}

const TONE_RANK = { danger: 4, warn: 3, info: 2, success: 1, neutral: 0 };

/**
 * One plain-Thai answer to "วันนี้เป็นอย่างไร" from the round statuses.
 * @param {Array} rounds  results of roundStatus()
 * @param {{ emergencies?: number }} [extra]  emergencies today (or open)
 * @returns {{ tone, headline, sub, focus }}  focus = session that needs attention, or null
 */
export function dayStatus(rounds = [], { emergencies = 0 } = {}) {
  const list = rounds.filter(Boolean);
  const em = Number(emergencies) || 0;
  if (em > 0) {
    return { tone: 'danger', headline: `มีเหตุฉุกเฉิน ${fmt(em)} รายการ`, sub: 'ตรวจสอบรายละเอียดและผลการแก้ไข', focus: null };
  }
  if (list.length === 0 || list.every(r => r.state === 'unavailable')) {
    return { tone: 'neutral', headline: 'ยังไม่มีข้อมูลวันนี้', sub: 'โหลดข้อมูลไม่สำเร็จ หรือยังไม่มีการเช็กชื่อ', focus: null };
  }
  const worst = list.reduce((a, b) => (TONE_RANK[b.tone] > TONE_RANK[a.tone] ? b : a));
  const name = r => SESSION_LABEL[r.session] || '';

  if (list.every(r => r.phase === 'off_day' && r.done === 0)) {
    return { tone: 'neutral', headline: 'วันนี้เป็นวันหยุด', sub: 'ไม่มีการรับส่งตามปกติ', focus: null };
  }
  if (list.every(r => r.state === 'no_riders')) {
    return { tone: 'neutral', headline: 'ไม่มีนักเรียนใช้รถ', sub: 'ยังไม่มีนักเรียนที่ผูกกับรถในขอบเขตนี้', focus: null };
  }
  if (worst.tone === 'danger') {
    return { tone: 'danger', headline: `${name(worst)}: ${worst.label}`, sub: worst.detail, focus: worst.session };
  }
  if (worst.tone === 'warn') {
    return { tone: 'warn', headline: `${name(worst)}ยังค้าง ${fmt(worst.pending)} คน`, sub: worst.detail, focus: worst.session };
  }
  const active = list.find(r => r.state === 'in_progress' || r.state === 'waiting');
  if (active) {
    return { tone: active.tone, headline: `${name(active)}: ${active.label}`, sub: active.detail, focus: active.session };
  }
  const done = list.filter(r => r.state === 'complete');
  const later = list.find(r => r.state === 'not_yet');
  if (done.length > 0 && later) {
    return { tone: 'success', headline: `${done.map(name).join(' และ ')}ครบแล้ว`, sub: `${name(later)}ยังไม่ถึงเวลา`, focus: null };
  }
  if (done.length > 0 && done.length === list.filter(r => r.state !== 'no_riders').length) {
    return { tone: 'success', headline: 'รับส่งครบทุกคนแล้ว', sub: done.map(r => `${name(r)} ${fmt(r.done)} คน`).join(' · '), focus: null };
  }
  if (later) {
    return { tone: 'neutral', headline: `${name(later)}ยังไม่ถึงเวลา`, sub: later.detail, focus: null };
  }
  return { tone: worst.tone, headline: `${name(worst)}: ${worst.label}`, sub: worst.detail, focus: worst.session };
}
