'use strict';

const { normalizeGrade } = require('../utils/gradeScope');
const { logAudit } = require('../utils/audit');
const { todayBangkok } = require('../utils/thaiTime');

// Canonical grade -> next canonical grade; null = graduates (soft delete).
const PROMOTION_MAP = {
  'อ.1': 'อ.2', 'อ.2': 'อ.3', 'อ.3': 'ป.1',
  'ป.1': 'ป.2', 'ป.2': 'ป.3', 'ป.3': 'ป.4', 'ป.4': 'ป.5', 'ป.5': 'ป.6', 'ป.6': null,
  'ม.1': 'ม.2', 'ม.2': 'ม.3', 'ม.3': null,
  'ม.4': 'ม.5', 'ม.5': 'ม.6', 'ม.6': null,
};
const GRADE_ORDER = Object.keys(PROMOTION_MAP);

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function currentBuddhistYear(now = new Date()) {
  return Number(todayBangkok(now).slice(0, 4)) + 543;
}

function parseAcademicYear(value, now = new Date()) {
  const y = Number(value);
  const cur = currentBuddhistYear(now);
  if (!Number.isInteger(y) || y < cur - 1 || y > cur + 1) throw fail('ปีการศึกษาไม่ถูกต้อง', 400);
  return y;
}

function pupilName(s) { return `${s.prefix || ''}${s.first_name} ${s.last_name}`.trim(); }

/** Read-only plan from the active roster. Never writes. */
async function buildPlan(db, schoolId, excludedIds = []) {
  const [pupils] = await db.query(
    `SELECT id, student_code, prefix, first_name, last_name, grade, classroom
       FROM students WHERE school_id = ? AND is_deleted = FALSE ORDER BY id`,
    [schoolId]
  );
  const excluded = new Set(excludedIds.map(Number));
  const byGrade = new Map();
  const unreadable = [];
  const moves = []; // { pupil, from, to }
  for (const p of pupils) {
    const from = normalizeGrade(p.grade);
    if (!from || !(from in PROMOTION_MAP)) { unreadable.push(p); continue; }
    if (!byGrade.has(from)) byGrade.set(from, { from, to: PROMOTION_MAP[from], count: 0, excluded: 0, pupils: [] });
    const row = byGrade.get(from);
    const isExcluded = excluded.has(Number(p.id));
    row.count += 1;
    if (isExcluded) row.excluded += 1;
    row.pupils.push({ id: p.id, student_code: p.student_code, name: pupilName(p), classroom: p.classroom, excluded: isExcluded });
    if (!isExcluded) moves.push({ pupil: p, from, to: PROMOTION_MAP[from] });
  }
  const rows = GRADE_ORDER.filter((g) => byGrade.has(g)).map((g) => byGrade.get(g));
  const ids = new Set(pupils.map((p) => Number(p.id)));
  const unknownExcluded = [...excluded].filter((id) => !ids.has(id));
  return { rows, moves, unreadable, unknownExcluded };
}

async function previewPromotion(db, { schoolId, academicYear }) {
  const year = parseAcademicYear(academicYear ?? currentBuddhistYear());
  const [done] = await db.query(
    'SELECT academic_year FROM school_year_promotions WHERE school_id = ? ORDER BY academic_year DESC',
    [schoolId]
  );
  const plan = await buildPlan(db, schoolId, []);
  return {
    academic_year: year,
    already_promoted: done.some((r) => Number(r.academic_year) === year),
    promoted_years: done.map((r) => Number(r.academic_year)),
    rows: plan.rows.map((r) => ({ from: r.from, to: r.to, graduates: r.to === null, count: r.count, pupils: r.pupils })),
    unreadable: plan.unreadable.map((p) => ({ id: p.id, student_code: p.student_code, name: pupilName(p), grade: p.grade })),
  };
}

async function applyPromotion(db, { schoolId, academicYear, excludedIds = [], actorId, ip = null, userAgent = null }) {
  const year = parseAcademicYear(academicYear);
  if (!Array.isArray(excludedIds) || excludedIds.length > 5000 || excludedIds.some((id) => !Number.isInteger(Number(id)))) {
    throw fail('รายการยกเว้นไม่ถูกต้อง', 400);
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // The unique (school_id, academic_year) key is the double-run guard.
    try {
      await conn.query(
        'INSERT INTO school_year_promotions (school_id, academic_year, performed_by) VALUES (?, ?, ?)',
        [schoolId, year, actorId]
      );
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') throw fail('โรงเรียนนี้เลื่อนชั้นปีการศึกษานี้ไปแล้ว', 409);
      throw err;
    }
    // Lock the roster, then plan from the locked snapshot.
    await conn.query('SELECT id FROM students WHERE school_id = ? AND is_deleted = FALSE FOR UPDATE', [schoolId]);
    const plan = await buildPlan(conn, schoolId, excludedIds);
    if (plan.unknownExcluded.length) throw fail('รายการยกเว้นมีนักเรียนที่ไม่อยู่ในโรงเรียนนี้', 400);

    // Group by target so every pupil is written exactly once (no chain-promoting).
    const toGrade = new Map();
    const graduates = [];
    for (const m of plan.moves) {
      if (m.to === null) graduates.push(m);
      else {
        if (!toGrade.has(m.to)) toGrade.set(m.to, []);
        toGrade.get(m.to).push(m);
      }
    }
    for (const [grade, list] of toGrade) {
      await conn.query(
        'UPDATE students SET grade = ? WHERE school_id = ? AND is_deleted = FALSE AND id IN (?)',
        [grade, schoolId, list.map((m) => m.pupil.id)]
      );
    }
    if (graduates.length) {
      await conn.query(
        'UPDATE students SET is_deleted = TRUE, deleted_at = NOW(), vehicle_id = NULL WHERE school_id = ? AND is_deleted = FALSE AND id IN (?)',
        [schoolId, graduates.map((m) => m.pupil.id)]
      );
      await require('./pickupCleanup.service').clearStalePickupAssignments(conn, graduates.map((m) => m.pupil.id));  // SCH-STU-7
    }

    const promoted = plan.moves.length - graduates.length;
    const excludedCount = plan.rows.reduce((n, r) => n + r.excluded, 0);
    await conn.query(
      `UPDATE school_year_promotions
          SET promoted_count = ?, graduated_count = ?, excluded_count = ?, unreadable_count = ?
        WHERE school_id = ? AND academic_year = ?`,
      [promoted, graduates.length, excludedCount, plan.unreadable.length, schoolId, year]
    );

    const audit = (entityType, entityId, oldValue, newValue) => logAudit({
      userId: actorId, action: 'UPDATE', entityType, entityId: String(entityId), oldValue, newValue,
      ipAddress: ip, userAgent, conn, required: true,
    });
    await audit('school_year_promotion', `${schoolId}:${year}`, null, {
      action: 'promote_school_year', academic_year: year, promoted, graduated: graduates.length,
      excluded: excludedCount, unreadable: plan.unreadable.length,
      per_grade: plan.rows.map((r) => ({ from: r.from, to: r.to, count: r.count, excluded: r.excluded })),
    });
    for (const m of plan.moves) {
      await audit('student', m.pupil.id,
        { grade: m.pupil.grade, is_deleted: false },
        {
          action: m.to === null ? 'graduate' : 'promote', academic_year: year,
          grade: m.to, previous_grade: m.pupil.grade, student_name: pupilName(m.pupil),
        });
    }

    await conn.commit();
    return { academic_year: year, promoted, graduated: graduates.length, excluded: excludedCount, unreadable: plan.unreadable.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { PROMOTION_MAP, currentBuddhistYear, parseAcademicYear, previewPromotion, applyPromotion };
