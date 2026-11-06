'use strict';

/**
 * Backfill missed attendance for one school + one grade over a date range,
 * the way a grade teacher would record it on the live check page
 * (checkin.service TEACHER_STATUS): morning = arrived at school (CHECKED_OUT),
 * evening = boarded to go home (CHECKED_IN), at fixed wall-clock times.
 *
 * Every row goes through backdatedAttendance.service.recordBackdatedCheck, so
 * it gets the same validation, the same `checkin_backdated` audit row (with the
 * reason) and NO parent LINE notification. A pupil/session that already has a
 * record that day, is on leave / travelling on their own, does not use that
 * session, or whose time has not happened yet (today) is skipped — existing
 * data is never changed.
 *
 * Dry run by default; pass --apply to write.
 *
 * Usage (from backend/):
 *   node scripts/backfill-attendance.js --school-name "อนุบาลลำปาง" --grade ป.1 \
 *     --from 2026-11-02 --to 2026-11-06 --morning 07:00 --evening 16:00 \
 *     --reason "..." [--apply]
 *   (--school-id SCH0001 may be used instead of --school-name)
 */

const { pool } = require('../src/config/database');
const svc = require('../src/services/backdatedAttendance.service');
const { gradeEquivalents, normalizeGradeScope } = require('../src/utils/gradeScope');
const { todayBangkok } = require('../src/utils/thaiTime');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function datesBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const d = new Date(t);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

function bangkokHm(now) {
  return now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const schoolIdArg = arg('school-id');
  const schoolName = arg('school-name');
  const grade = normalizeGradeScope(arg('grade'));
  const from = arg('from');
  const to = arg('to') || from;
  const times = { morning: arg('morning') || '07:00', evening: arg('evening') || '16:00' };
  const reason = arg('reason');

  if ((!schoolIdArg && !schoolName) || !grade || !from || !reason) {
    throw new Error('required: --school-id|--school-name, --grade, --from, --reason (got grade=' + arg('grade') + ')');
  }

  // 1. School — exactly one match, or stop.
  const [schools] = schoolIdArg
    ? await pool.query('SELECT id, name FROM schools WHERE id = ? AND is_deleted = FALSE', [schoolIdArg])
    : await pool.query('SELECT id, name FROM schools WHERE name LIKE ? AND is_deleted = FALSE', [`%${schoolName}%`]);
  if (schools.length !== 1) {
    throw new Error(`school must match exactly one row, got ${schools.length}: ${schools.map(s => `${s.id} ${s.name}`).join(' | ')}`);
  }
  const school = schools[0];

  // 2. Actor — the school's main (full-scope) account, so the rows show the
  //    school as the recorder, as if the school had entered them.
  const [actors] = await pool.query(
    `SELECT id, username, display_name FROM users
      WHERE role = 'school' AND scope_id = ? AND grade_scope IS NULL AND is_deleted = FALSE
      ORDER BY id LIMIT 1`, [school.id]);
  if (!actors.length) throw new Error(`no full-scope school account for ${school.id}`);
  const actor = actors[0];

  // 3. Pupils of that grade who ride a bus.
  const [students] = await pool.query(
    `SELECT id, first_name, last_name, grade, morning_enabled, evening_enabled
       FROM students
      WHERE school_id = ? AND is_deleted = FALSE AND vehicle_id IS NOT NULL AND grade IN (?)
      ORDER BY id`,
    [school.id, gradeEquivalents(grade)]
  );

  const now = new Date();
  const today = todayBangkok(now);
  const dates = datesBetween(from, to);
  console.log(`[backfill-attendance] ${apply ? 'APPLY' : 'DRY-RUN'} · ${school.id} ${school.name} · grade ${grade} · ${students.length} pupils`);
  console.log(`[backfill-attendance] dates ${dates.join(', ')} · มา ${times.morning} (morning CHECKED_OUT) · กลับ ${times.evening} (evening CHECKED_IN) · actor ${actor.username} (#${actor.id})`);

  const tally = {};
  const bump = (date, key) => { tally[date] = tally[date] || {}; tally[date][key] = (tally[date][key] || 0) + 1; };

  for (const date of dates) {
    // Never back-date past the service window — fail loudly rather than skip.
    svc.assertBackdateWindow(date, now, { allowToday: true });
    for (const st of students) {
      for (const session of ['morning', 'evening']) {
        const key = `${session}`;
        if (!(session === 'morning' ? st.morning_enabled : st.evening_enabled)) { bump(date, `${key}:not_enrolled`); continue; }
        if (date === today && times[session] > bangkokHm(now)) { bump(date, `${key}:future_time`); continue; }

        const [[ds]] = await pool.query(
          `SELECT ${session}_done AS done FROM daily_status WHERE check_date = ? AND student_id = ?`, [date, st.id]);
        if (ds && ds.done) { bump(date, `${key}:already_recorded`); continue; }
        const [[lv]] = await pool.query(
          `SELECT attendance_kind FROM student_leaves
            WHERE student_id = ? AND leave_date = ? AND cancelled = FALSE AND session IN (?, 'both') LIMIT 1`,
          [st.id, date, session]);
        if (lv) { bump(date, `${key}:${lv.attendance_kind === 'SELF' ? 'self_travel' : 'on_leave'}`); continue; }

        if (!apply) { bump(date, `${key}:would_record`); continue; }
        try {
          await svc.recordBackdatedCheck(pool, {
            userId: actor.id,
            userRole: 'school',
            userDisplayName: `${actor.display_name || actor.username} (backfill script)`,
            schoolId: school.id,
            gradeFilter: grade,
            studentId: st.id,
            checkDate: date,
            session,
            status: session === 'morning' ? 'CHECKED_OUT' : 'CHECKED_IN',
            time: times[session],
            reason,
            now,
            allowToday: true,
          });
          bump(date, `${key}:recorded`);
        } catch (err) {
          bump(date, `${key}:error_${err.code || err.statusCode || 'unknown'}`);
          console.error(`[backfill-attendance] ${date} ${session} student ${st.id}: ${err.message}`);
        }
      }
    }
  }

  for (const date of dates) {
    const row = Object.entries(tally[date] || {}).sort().map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[backfill-attendance] ${date} ${row}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('[backfill-attendance] error:', e.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
