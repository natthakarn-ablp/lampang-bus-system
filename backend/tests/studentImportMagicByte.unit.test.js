'use strict';

/**
 * Regression — parseImportFile() (student import PREVIEW path) must validate the
 * REAL first bytes of an upload, not just the extension.
 *
 * Security audit 2026-06-27 (MEDIUM#6): the preview path
 * (/api/school/students/import/preview → runPreview → parseImportFile) sniffed
 * type by extension only, so a renamed legacy .xls (OLE2) or a spoofed binary
 * renamed .xlsx reached ExcelJS and threw an unhandled 500. The legacy
 * /students/import already guarded with the same fileType helpers; this closes
 * the sibling gap. The affiliation school-account import got the identical guard
 * in parseSchoolImportFile (not exported, so covered by review + the shared
 * fileType helpers exercised here).
 *
 * DB-free: parseImportFile only touches the filesystem.
 */

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseImportFile } = require('../src/services/studentImportPreview.service');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-magic-'));
const write = (name, buf) => { const p = path.join(TMP, name); fs.writeFileSync(p, buf); return p; };

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('parseImportFile magic-byte validation (MEDIUM#6)', () => {
  test('rejects a legacy .xls (OLE2) renamed .xlsx with a 400', async () => {
    const ole2 = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const p = write('fake.xlsx', ole2);
    await expect(parseImportFile(p, 'fake.xlsx')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an arbitrary binary renamed .xlsx with a 400', async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0, 0]);
    const p = write('blob.xlsx', garbage);
    await expect(parseImportFile(p, 'blob.xlsx')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a non-existent file is treated as invalid (no crash, 400)', async () => {
    await expect(parseImportFile(path.join(TMP, 'nope.csv'), 'nope.csv'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('accepts a valid UTF-8 CSV (textual bytes) and parses its rows', async () => {
    const csv =
      'รหัสนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ชั้น,ห้อง,ทะเบียนรถ,ผู้ปกครอง,เบอร์\n' +
      '12345,เด็กชาย,สมชาย,ใจดี,ป.1,1,นข 1 ลำปาง,แม่,0901112222\n';
    const p = write('ok.csv', Buffer.from('﻿' + csv, 'utf-8'));
    const rows = await parseImportFile(p, 'ok.csv');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].first_name).toBe('สมชาย');
    expect(rows[0].student_code).toBe('12345');
  });
});
