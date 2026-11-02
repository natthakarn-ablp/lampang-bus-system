'use strict';

const SESSIONS = ['morning', 'evening'];
const KINDS = ['LEAVE', 'SELF'];

function assertAttendanceKind(kind, session) {
  if (!KINDS.includes(kind) || !SESSIONS.includes(session)) {
    const error = new Error('ชนิดการเช็กชื่อหรือรอบไม่ถูกต้อง');
    error.statusCode = 400;
    throw error;
  }
}

// One outcome per pupil/session; never silently choose a winner for conflicting
// evidence. Callers must surface conflicts rather than count a child twice.
function outcome({ enabled, busDone, kinds = [] }) {
  if (!enabled) return 'DISABLED';
  const unique = [...new Set(kinds)];
  if (unique.some(kind => !KINDS.includes(kind))) throw new Error('Unknown attendance kind');
  if (unique.length > 1 || (busDone && unique.length)) return 'CONFLICT';
  return unique[0] || (busDone ? 'BUS' : 'PENDING');
}

function summarizeAttendance(rows) {
  const counts = { BUS: 0, SELF: 0, LEAVE: 0, PENDING: 0, CONFLICT: 0, DISABLED: 0 };
  for (const row of rows) counts[outcome(row)]++;
  const expected = rows.length - counts.DISABLED;
  const busExpected = Math.max(0, expected - counts.SELF - counts.LEAVE);
  return { ...counts, expected, busExpected,
    busPercent: counts.CONFLICT || !busExpected ? null : Math.round(counts.BUS / busExpected * 10000) / 100 };
}

module.exports = { assertAttendanceKind, outcome, summarizeAttendance };
