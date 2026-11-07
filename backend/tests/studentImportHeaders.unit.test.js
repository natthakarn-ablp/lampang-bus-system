'use strict';

/**
 * Live QA sch-04 — a student import file whose column headers do not match the
 * template must be rejected once with a clear Thai 400 naming the missing
 * columns, instead of previewing every row as "รหัสนักเรียนไม่ถูกต้อง".
 *
 * DB-free: parseImportFile only touches the filesystem.
 */

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseImportFile } = require('../src/services/studentImportPreview.service');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-headers-'));
const writeCsv = (name, text) => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.from('﻿' + text, 'utf-8'));
  return p;
};

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('parseImportFile required headers (sch-04)', () => {
  test('English / wrong headers → one 400 naming every missing column', async () => {
    const p = writeCsv('wrong.csv', 'code,name,surname\n65001,สมชาย,ใจดี\n');
    const err = await parseImportFile(p, 'wrong.csv').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('หัวคอลัมน์ในไฟล์ไม่ตรงกับแบบฟอร์ม');
    expect(err.missingHeaders).toEqual(['รหัสนักเรียน', 'ชื่อ', 'นามสกุล']);
  });

  test('missing only the surname column → names just that column', async () => {
    const p = writeCsv('nosurname.csv', 'รหัสนักเรียน*,ชื่อ*,ชั้น\n65001,สมชาย,ป.1\n');
    const err = await parseImportFile(p, 'nosurname.csv').catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.missingHeaders).toEqual(['นามสกุล']);
    expect(err.message).toContain('นามสกุล');
  });

  test('an empty CSV is rejected the same way (no header row)', async () => {
    const p = writeCsv('empty.csv', '');
    await expect(parseImportFile(p, 'empty.csv')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('the shipped static CSV template is header-only and passes the check', async () => {
    const tpl = path.join(__dirname, '../../frontend/public/templates/student_import_template_th.csv');
    const p = path.join(TMP, 'template.csv');
    fs.copyFileSync(tpl, p);
    const rows = await parseImportFile(p, 'template.csv');
    // SEED-F2: no example rows that a teacher could import by accident.
    expect(rows).toEqual([]);
  });

  test('xlsx with template headers parses; xlsx with wrong headers is rejected', async () => {
    const good = new ExcelJS.Workbook();
    const ws = good.addWorksheet('s');
    ws.addRow(['รหัสนักเรียน*', 'คำนำหน้า', 'ชื่อ*', 'นามสกุล*', 'ระดับชั้น', 'ห้อง']);
    ws.addRow(['65001', 'เด็กชาย', 'สมชาย', 'ใจดี', 'ป.1', '1']);
    const goodPath = path.join(TMP, 'good.xlsx');
    await good.xlsx.writeFile(goodPath);
    const rows = await parseImportFile(goodPath, 'good.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0].last_name).toBe('ใจดี');

    const bad = new ExcelJS.Workbook();
    const ws2 = bad.addWorksheet('s');
    ws2.addRow(['รายชื่อนักเรียน ปีการศึกษา 2569']);
    ws2.addRow(['รหัสนักเรียน', 'ชื่อ', 'นามสกุล']);
    const badPath = path.join(TMP, 'bad.xlsx');
    await bad.xlsx.writeFile(badPath);
    await expect(parseImportFile(badPath, 'bad.xlsx')).rejects.toMatchObject({ statusCode: 400 });
  });
});
