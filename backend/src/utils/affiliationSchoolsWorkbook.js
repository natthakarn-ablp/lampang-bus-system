'use strict';

const ExcelJS = require('exceljs');

/** Build a master-data overview; never interpret external text as formulas. */
function buildAffiliationSchoolsWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lampang Bus System';
  workbook.created = new Date(report.generated_at);
  const sheet = workbook.addWorksheet('สรุปโรงเรียนในสังกัด');
  sheet.columns = [{ width: 20 }, { width: 60 }, { width: 24 }, { width: 26 }];
  sheet.addRow(['รายงานสรุปโรงเรียนในสังกัด (ข้อมูลปัจจุบัน)']);
  sheet.addRow(['สังกัด', String(report.affiliation.name)]);
  sheet.addRow(['สร้างเมื่อ (UTC)', String(report.generated_at)]);
  sheet.addRow(['จำนวนโรงเรียน', Number(report.summary.total_schools)]);
  sheet.addRow(['ข้อมูลปัจจุบัน ไม่ใช่สถานะการส่งรายงาน; จำนวนศูนย์ไม่ได้หมายความว่ายังไม่ส่งรายงาน']);
  sheet.addRow(['รถรวมทั้งสังกัดนับไม่ซ้ำ รถร่วมหลายโรงเรียนอาจทำให้ยอดรวมน้อยกว่าผลรวมรายโรงเรียน']);
  sheet.addRow([]);
  sheet.addRow(['รหัสโรงเรียน', 'ชื่อโรงเรียน', 'จำนวนนักเรียน (คน)', 'จำนวนรถรับส่ง (คัน)']);
  for (const school of report.schools) {
    // ExcelJS writes JS strings as text cells, including leading =, +, - and @.
    // Do not use formula objects or coerce school identifiers to numbers.
    sheet.addRow([String(school.id), String(school.name), Number(school.student_count), Number(school.vehicle_count)]);
  }
  sheet.addRow(['รวม', `${report.summary.total_schools} โรงเรียน`, Number(report.summary.total_students), Number(report.summary.total_vehicles)]);
  sheet.getRow(1).font = { bold: true, size: 16 };
  sheet.getRow(8).font = { bold: true };
  sheet.lastRow.font = { bold: true };
  sheet.getColumn(3).numFmt = '0';
  sheet.getColumn(4).numFmt = '0';
  sheet.mergeCells('A1:D1');
  sheet.mergeCells('A5:D5');
  sheet.mergeCells('A6:D6');
  for (const rowNumber of [5, 6]) {
    sheet.getRow(rowNumber).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(rowNumber).height = 34;
  }
  sheet.views = [{ state: 'frozen', ySplit: 8 }];
  return workbook;
}

module.exports = { buildAffiliationSchoolsWorkbook };
