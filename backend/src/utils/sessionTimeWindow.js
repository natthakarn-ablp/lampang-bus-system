'use strict';

/**
 * The hours a corrected time may take for each round (live QA gt1-04).
 *
 * แก้เวลา used to accept any time of day, so an evening boarding could be saved
 * as 07:45 and the daily export then showed it as such. The windows overlap
 * around midday on purpose: a half-day (exam day, early closing) sends the
 * evening round home before noon, and a late morning round can arrive after
 * it. Only a time on the wrong side of the day is refused.
 */
const SESSION_TIME_WINDOWS = Object.freeze({
  morning: Object.freeze({ from: '00:00', before: '13:00', message: 'เวลารอบเช้าต้องก่อน 13:00 น.' }),
  evening: Object.freeze({ from: '11:00', before: '24:00', message: 'เวลารอบเย็นต้องตั้งแต่ 11:00 น. เป็นต้นไป' }),
});

/** Thai error message when `time` (HH:mm) falls outside the round, else null. */
function sessionTimeError(session, time) {
  const window = SESSION_TIME_WINDOWS[session];
  if (!window || typeof time !== 'string') return null;
  return time >= window.from && time < window.before ? null : window.message;
}

module.exports = { SESSION_TIME_WINDOWS, sessionTimeError };
