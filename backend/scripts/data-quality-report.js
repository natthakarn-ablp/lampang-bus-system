#!/usr/bin/env node
'use strict';

// Phase 6.1 — aggregate data-quality report (read-only, no PII).
//
// WHY THIS EXISTS
// ---------------
// The closure plan's first data-readiness item asks for "aggregate data-quality
// score โดยไม่ export PII", and its second asks someone to check school-affiliation
// mapping, active/inactive, ownership, duplicates, orphans and the fields that
// LINE and check-in actually depend on. Neither existed. The only thing close
// was integrity-monitor.js, which watches OPERATIONS (is the service healthy,
// are backups running) and not the CONTENT of the data.
//
// A school cannot certify data it has never been shown. This produces the sheet
// they are being asked to sign against, and it produces it in a form that is
// safe to email: every query below returns COUNTS ONLY.
//
// WHAT IT WILL NEVER DO
// ---------------------
// It never selects a student name, a national id or its hash, a phone number, a
// LINE user id, an address, or any other column that identifies a person. The
// guard test backend/tests/dataQualityReport.unit.test.js reads this file as
// TEXT — it cannot require it, because requiring the database config validates
// the environment and throws on a machine with no database — and it fails if a
// query mentions a personal column, and fails if any statement is anything but
// a SELECT. That is deliberate: this report is meant to be run against the real
// production database, so the safety has to be in the file, not in the operator.
//
// USAGE
//   cd backend && node scripts/data-quality-report.js
//   node scripts/data-quality-report.js --json
//   node scripts/data-quality-report.js --write-json /path/report.json
//
// There is deliberately no per-school filter yet. Every school's own sheet has
// to be scoped in the same place the rest of the system scopes things — the
// server, from the caller's token — and adding a command-line filter here first
// would build a second, unguarded way to slice the same data.
//
// EXIT CODES  0 = no defect, 1 = warnings only, 2 = at least one critical defect

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const wi = args.indexOf('--write-json');
const writePath = wi >= 0 ? args[wi + 1] : null;

// Severity is about what the defect BLOCKS, not about how many rows it touches.
// CRITICAL means a child could be missed at pickup or a parent notified about
// the wrong child. WARN means a report will be wrong or incomplete. INFO is
// context a data owner needs to read the numbers.
const CRITICAL = 'CRITICAL';
const WARN = 'WARN';
const INFO = 'INFO';

/**
 * Every check is one COUNT query plus a rule for reading it. Keeping them in a
 * table rather than in code means the guard test can assert over the whole set,
 * and a data owner can read what is being measured without reading JavaScript.
 *
 * `scoped` marks the checks that accept a school filter; the rest are
 * system-wide by nature (an orphan has no school to be filtered by).
 */
const CHECKS = [
  {
    key: 'schools_without_affiliation',
    label: 'โรงเรียนที่ไม่ได้ผูกกับสังกัดใด',
    severity: CRITICAL,
    why: 'เขตพื้นที่จะไม่เห็นโรงเรียนนี้ในรายงานของตนเลย และไม่มีใครรับผิดชอบข้อมูลของโรงเรียนนี้',
    sql: `SELECT COUNT(*) AS n FROM schools
          WHERE is_deleted = FALSE AND (affiliation_id IS NULL OR affiliation_id = '')`,
  },
  {
    key: 'schools_with_unknown_affiliation',
    label: 'โรงเรียนที่ผูกกับรหัสสังกัดที่ไม่มีอยู่จริง',
    severity: CRITICAL,
    why: 'ข้อมูลชี้ไปยังสังกัดที่ถูกลบหรือพิมพ์ผิด รายงานระดับเขตจะนับไม่ครบ',
    sql: `SELECT COUNT(*) AS n FROM schools s
          LEFT JOIN affiliations a ON a.id = s.affiliation_id
          WHERE s.is_deleted = FALSE AND s.affiliation_id IS NOT NULL AND a.id IS NULL`,
  },
  {
    key: 'students_without_school',
    label: 'นักเรียนที่ไม่ได้สังกัดโรงเรียนใด',
    severity: CRITICAL,
    why: 'ไม่มีโรงเรียนใดเห็นนักเรียนคนนี้ จึงไม่มีใครแก้ไขหรือรับรองข้อมูลของเขาได้',
    sql: `SELECT COUNT(*) AS n FROM students
          WHERE is_deleted = FALSE AND (school_id IS NULL OR school_id = '')`,
  },
  {
    key: 'students_with_unknown_school',
    label: 'นักเรียนที่ผูกกับรหัสโรงเรียนที่ไม่มีอยู่จริง',
    severity: CRITICAL,
    why: 'เป็นข้อมูลกำพร้า มองไม่เห็นจากทุกบทบาท',
    sql: `SELECT COUNT(*) AS n FROM students st
          LEFT JOIN schools s ON s.id = st.school_id
          WHERE st.is_deleted = FALSE AND st.school_id IS NOT NULL AND s.id IS NULL`,
  },
  {
    key: 'students_with_unknown_vehicle',
    label: 'นักเรียนที่ผูกกับรถที่ไม่มีอยู่จริง',
    severity: CRITICAL,
    why: 'คนขับจะไม่เห็นเด็กคนนี้ในรายชื่อของรถ เด็กจึงตกหล่นตอนรับส่ง',
    sql: `SELECT COUNT(*) AS n FROM students st
          LEFT JOIN vehicles v ON v.id = st.vehicle_id
          WHERE st.is_deleted = FALSE AND st.vehicle_id IS NOT NULL AND v.id IS NULL`,
  },
  {
    key: 'students_using_service_without_vehicle',
    label: 'นักเรียนที่ใช้บริการรถแต่ยังไม่ได้ผูกรถ',
    severity: CRITICAL,
    why: 'ระบบระบุว่าเด็กใช้บริการรอบเช้าหรือเย็น แต่ไม่มีรถคันใดมีชื่อเขา จึงไม่มีใครเช็กชื่อเขาได้',
    sql: `SELECT COUNT(*) AS n FROM students
          WHERE is_deleted = FALSE
            AND (morning_enabled = TRUE OR evening_enabled = TRUE)
            AND (vehicle_id IS NULL OR vehicle_id = '')`,
  },
  {
    key: 'duplicate_cid_hash',
    label: 'เลขบัตรประชาชนซ้ำ (นับเป็นกลุ่ม)',
    severity: CRITICAL,
    why: 'คนเดียวถูกบันทึกสองรายการ ทำให้ยอดนักเรียนเกินจริง และการแจ้งเตือนผู้ปกครองอาจไปผิดรายการ',
    // Counts GROUPS, never the values themselves. The hash is pseudonymous but
    // still identifies a person, so it must not leave the database.
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT cid_hash FROM students
            WHERE is_deleted = FALSE AND cid_hash IS NOT NULL AND cid_hash <> ''
            GROUP BY cid_hash HAVING COUNT(*) > 1
          ) AS dup`,
  },
  {
    key: 'students_without_cid_hash',
    label: 'นักเรียนที่ไม่มีเลขบัตรประชาชนในระบบ',
    severity: WARN,
    why: 'ใช้ตรวจสอบตัวตนซ้ำซ้อนไม่ได้ และเชื่อมกับระบบอื่นของราชการไม่ได้',
    sql: `SELECT COUNT(*) AS n FROM students
          WHERE is_deleted = FALSE AND (cid_hash IS NULL OR cid_hash = '')`,
  },
  {
    key: 'students_without_grade',
    label: 'นักเรียนที่ไม่ระบุระดับชั้น',
    severity: WARN,
    why: 'ครูประจำสายชั้นจะมองไม่เห็นเด็กคนนี้ และรายงานแยกชั้นจะนับไม่ครบ',
    sql: `SELECT COUNT(*) AS n FROM students
          WHERE is_deleted = FALSE AND (grade IS NULL OR grade = '')`,
  },
  {
    key: 'vehicles_without_driver',
    label: 'รถที่ไม่มีคนขับที่ยังใช้งานอยู่',
    severity: CRITICAL,
    why: 'ไม่มีใครเข้าสู่ระบบในนามรถคันนี้ได้ การเช็กชื่อของรถคันนี้จึงไม่เกิดขึ้นเลย',
    sql: `SELECT COUNT(*) AS n FROM vehicles v
          WHERE v.is_deleted = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM driver_vehicle_assignments a
              WHERE a.vehicle_id = v.id AND a.is_active = TRUE
            )`,
  },
  {
    key: 'vehicles_carrying_students_never_inspected',
    label: 'รถที่มีนักเรียนแต่ยังไม่เคยผ่านการตรวจสภาพ',
    severity: WARN,
    why: 'เป็นความเสี่ยงเชิงนโยบายที่ขนส่งต้องเห็น ไม่ใช่ข้อผิดพลาดของข้อมูล',
    sql: `SELECT COUNT(*) AS n FROM vehicles v
          WHERE v.is_deleted = FALSE
            AND EXISTS (SELECT 1 FROM students s WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE)
            AND NOT EXISTS (SELECT 1 FROM vehicle_inspections i WHERE i.vehicle_id = v.id)`,
  },
  {
    key: 'vehicles_with_expired_insurance',
    label: 'รถที่ประกันภัยหมดอายุแล้ว',
    severity: WARN,
    why: 'ต้องต่ออายุก่อนใช้รับส่งนักเรียน เป็นข้อมูลที่เขตและขนส่งต้องเห็น',
    sql: `SELECT COUNT(*) AS n FROM vehicles
          WHERE is_deleted = FALSE AND insurance_expiry IS NOT NULL AND insurance_expiry < CURDATE()`,
  },
  {
    key: 'user_accounts_never_logged_in',
    label: 'บัญชีผู้ใช้ที่ยังไม่เคยเข้าระบบ',
    severity: INFO,
    why: 'บัญชียังใช้รหัสตั้งต้นอยู่ ผู้ถือบัญชีตัวจริงยังไม่ได้ตั้งรหัสของตนเอง',
    sql: `SELECT COUNT(*) AS n FROM users
          WHERE is_deleted = FALSE AND is_active = TRUE AND last_login IS NULL`,
  },
  {
    key: 'schools_with_no_students',
    label: 'โรงเรียนที่ยังไม่มีข้อมูลนักเรียนเลย',
    severity: INFO,
    why: 'อาจยังไม่ได้นำเข้าข้อมูล หรืออาจเป็นโรงเรียนที่ไม่ควรอยู่ในระบบแล้ว',
    sql: `SELECT COUNT(*) AS n FROM schools s
          WHERE s.is_deleted = FALSE
            AND NOT EXISTS (SELECT 1 FROM students st WHERE st.school_id = s.id AND st.is_deleted = FALSE)`,
  },
];

// Denominators, so a count can be read as a proportion rather than as a scary
// absolute number. Also counts only.
const TOTALS = [
  { key: 'affiliations', sql: 'SELECT COUNT(*) AS n FROM affiliations WHERE is_deleted = FALSE' },
  { key: 'schools', sql: 'SELECT COUNT(*) AS n FROM schools WHERE is_deleted = FALSE' },
  { key: 'students', sql: 'SELECT COUNT(*) AS n FROM students WHERE is_deleted = FALSE' },
  { key: 'vehicles', sql: 'SELECT COUNT(*) AS n FROM vehicles WHERE is_deleted = FALSE' },
  { key: 'active_users', sql: 'SELECT COUNT(*) AS n FROM users WHERE is_deleted = FALSE AND is_active = TRUE' },
];

async function countOf(sql, params) {
  const [rows] = await pool.query(sql, params || []);
  return Number(rows[0] ? rows[0].n : 0);
}

/**
 * A single score would hide which defects matter, so this deliberately does NOT
 * average anything. It reports the counts and one overall verdict driven by the
 * worst severity that actually fired. A data owner signs off on the list, not on
 * a number they cannot interpret.
 */
function verdictOf(results) {
  if (results.some((r) => r.count > 0 && r.severity === CRITICAL)) return CRITICAL;
  if (results.some((r) => r.count > 0 && r.severity === WARN)) return WARN;
  return 'OK';
}

async function build() {
  const totals = {};
  for (const t of TOTALS) totals[t.key] = await countOf(t.sql);

  const results = [];
  for (const c of CHECKS) {
    const count = await countOf(c.sql);
    results.push({
      key: c.key,
      label: c.label,
      severity: c.severity,
      why: c.why,
      count,
      clean: count === 0,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    scope: 'ทั้งจังหวัด',
    totals,
    verdict: verdictOf(results),
    critical_open: results.filter((r) => r.severity === CRITICAL && !r.clean).length,
    warn_open: results.filter((r) => r.severity === WARN && !r.clean).length,
    checks: results,
    safety: 'aggregate counts only — no student, parent, driver or account identifier is read by this script',
  };
}

function render(report) {
  console.log(`[data-quality] ${report.generated_at}  ขอบเขต=${report.scope}  ผลรวม=${report.verdict}`);
  console.log(
    `  ฐาน: สังกัด ${report.totals.affiliations} · โรงเรียน ${report.totals.schools} · ` +
    `นักเรียน ${report.totals.students} · รถ ${report.totals.vehicles} · บัญชีใช้งาน ${report.totals.active_users}`
  );
  for (const c of report.checks) {
    const mark = c.clean ? ' ok ' : c.severity === CRITICAL ? 'CRIT' : c.severity === WARN ? 'WARN' : 'info';
    console.log(`  [${mark}] ${String(c.count).padStart(6)}  ${c.label}`);
    if (!c.clean) console.log(`           ↳ ${c.why}`);
  }
  console.log(`ข้อบกพร่องร้ายแรงที่ยังเปิดอยู่ ${report.critical_open} · คำเตือน ${report.warn_open}`);
}

// Requiring this file must not open a database connection or exit the process —
// the guard test reads CHECKS out of it, and a test run that talks to MySQL is
// a test run that cannot happen on a developer machine or in CI.
async function main() {
  const report = await build();

  if (writePath) {
    try {
      fs.mkdirSync(path.dirname(writePath), { recursive: true });
      const tmp = `${writePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(report, null, 2), { mode: 0o640 });
      fs.renameSync(tmp, writePath);
    } catch (e) {
      console.error('[data-quality] snapshot write failed:', e.code || e.message);
    }
  }

  if (jsonMode) console.log(JSON.stringify(report));
  else render(report);

  await pool.end();
  process.exit(report.verdict === CRITICAL ? 2 : report.verdict === WARN ? 1 : 0);
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[data-quality] ERROR:', e.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(2);
  });
}

module.exports = { CHECKS, TOTALS, verdictOf, CRITICAL, WARN, INFO };
