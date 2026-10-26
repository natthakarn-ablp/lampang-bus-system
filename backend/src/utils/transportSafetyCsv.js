'use strict';

// Only these vehicle-safety fields may leave the dedicated transport export.
// Do not add student, owner/driver contact, free-text notes or evidence URLs.
const COLUMNS = Object.freeze([
  ['plate_no', 'ทะเบียนรถ'], ['vehicle_type', 'ประเภทรถ'],
  ['latest_inspection_result', 'ผลตรวจล่าสุด'],
  ['latest_inspection_date', 'วันที่ตรวจ'], ['inspection_expiry', 'ผลตรวจหมดอายุ'],
  ['insurance_expiry', 'ประกันหมดอายุ'], ['registration_expiry', 'ทะเบียนหมดอายุ'],
  ['compulsory_insurance_expiry', 'พ.ร.บ.หมดอายุ'], ['tax_expiry', 'ภาษีหมดอายุ'],
]);

function cell(value) {
  let text = value == null ? '' : String(value);
  // Excel/LibreOffice may interpret a user-entered plate as a formula.
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function encodeSafetyCsv(rows) {
  return `\uFEFF${[
    COLUMNS.map(([, label]) => cell(label)).join(','),
    ...rows.map(row => COLUMNS.map(([key]) => cell(row[key])).join(',')),
  ].join('\r\n')}`;
}

module.exports = { COLUMNS, encodeSafetyCsv };
