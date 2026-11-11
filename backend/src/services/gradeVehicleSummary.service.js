'use strict';

// Students with / without a vehicle, grouped by grade (สายชั้น).
// School main account sees every grade; a grade teacher only their own grade
// (caller passes gradeFilter from resolveGradeScope). No PII beyond what the
// school student list already shows (no CID hash, no phone, no address).

const { pool } = require('../config/database');
const { VALID_GRADE_SCOPES, normalizeGrade, gradeEquivalents } = require('../utils/gradeScope');

const UNKNOWN_GRADE = 'ไม่ระบุชั้น';

function gradeKey(raw) {
  const canonical = normalizeGrade(raw);
  if (canonical) return canonical;
  const t = raw == null ? '' : String(raw).trim();
  return t || UNKNOWN_GRADE;
}

function gradeOrder(g) {
  const i = VALID_GRADE_SCOPES.indexOf(g);
  if (i >= 0) return i;
  return g === UNKNOWN_GRADE ? 10000 : 1000;
}

async function getGradeVehicleSummary(schoolId, { gradeFilter = null, db = pool } = {}) {
  let where = 's.school_id = ? AND s.is_deleted = FALSE';
  const params = [schoolId];
  if (gradeFilter) {
    where += ' AND s.grade IN (?)';
    params.push(gradeEquivalents(gradeFilter));
  }
  const [rows] = await db.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE ${where}
      ORDER BY s.classroom ASC, s.first_name ASC, s.last_name ASC`,
    params
  );

  const byGrade = new Map();
  for (const r of rows) {
    const g = gradeKey(r.grade);
    if (!byGrade.has(g)) byGrade.set(g, { grade: g, total: 0, with_vehicle: 0, without_vehicle: 0, students_with_vehicle: [], students_without_vehicle: [] });
    const bucket = byGrade.get(g);
    const student = {
      id: r.id, prefix: r.prefix, first_name: r.first_name, last_name: r.last_name,
      grade: r.grade, classroom: r.classroom,
      vehicle_id: r.vehicle_id || null, plate_no: r.plate_no || null,
      morning_enabled: !!r.morning_enabled, evening_enabled: !!r.evening_enabled,
    };
    bucket.total++;
    if (r.vehicle_id) { bucket.with_vehicle++; bucket.students_with_vehicle.push(student); }
    else { bucket.without_vehicle++; bucket.students_without_vehicle.push(student); }
  }
  const grades = [...byGrade.values()].sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || a.grade.localeCompare(b.grade, 'th'));
  const totals = grades.reduce((t, g) => ({
    total: t.total + g.total, with_vehicle: t.with_vehicle + g.with_vehicle, without_vehicle: t.without_vehicle + g.without_vehicle,
  }), { total: 0, with_vehicle: 0, without_vehicle: 0 });
  return { grade_scope: gradeFilter || null, totals, grades };
}

function studentName(s) {
  return `${s.prefix || ''}${s.first_name || ''} ${s.last_name || ''}`.trim();
}

async function buildGradeVehicleWorkbook(summary) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sum = wb.addWorksheet('สรุปตามสายชั้น');
  sum.columns = [
    { header: 'สายชั้น', key: 'grade', width: 14 },
    { header: 'นักเรียนทั้งหมด', key: 'total', width: 16 },
    { header: 'ผูกรถแล้ว', key: 'with_vehicle', width: 14 },
    { header: 'ยังไม่ผูกรถ', key: 'without_vehicle', width: 14 },
  ];
  for (const g of summary.grades) sum.addRow({ grade: g.grade, total: g.total, with_vehicle: g.with_vehicle, without_vehicle: g.without_vehicle });
  const totalRow = sum.addRow({ grade: 'รวม', ...summary.totals });
  totalRow.font = { bold: true };
  sum.getRow(1).font = { bold: true };

  const listSheet = (name, key, withPlate) => {
    const ws = wb.addWorksheet(name);
    const cols = [
      { header: 'สายชั้น', key: 'g', width: 12 },
      { header: 'ห้อง', key: 'room', width: 8 },
      { header: 'รหัสนักเรียน', key: 'id', width: 14 },
      { header: 'ชื่อ-นามสกุล', key: 'name', width: 32 },
    ];
    if (withPlate) cols.push({ header: 'ทะเบียนรถ', key: 'plate', width: 16 });
    ws.columns = cols;
    ws.getRow(1).font = { bold: true };
    for (const g of summary.grades) {
      for (const s of g[key]) {
        // Values are written as plain strings/numbers (never formulas).
        ws.addRow({ g: g.grade, room: s.classroom == null ? '' : String(s.classroom), id: s.id, name: studentName(s), plate: s.plate_no || '' });
      }
    }
    return ws;
  };
  listSheet('ผูกรถแล้ว', 'students_with_vehicle', true);
  listSheet('ยังไม่ผูกรถ', 'students_without_vehicle', false);
  return wb.xlsx.writeBuffer();
}

module.exports = { getGradeVehicleSummary, buildGradeVehicleWorkbook, gradeKey, UNKNOWN_GRADE };
