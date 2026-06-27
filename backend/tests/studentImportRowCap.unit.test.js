'use strict';

/**
 * Regression — runPreview() must reject an oversized import (>5000 rows) BEFORE
 * any per-row DB work.
 *
 * Security audit 2026-06-27 (MEDIUM#7): the preview path
 * (/api/school/students/import/preview → runPreview) had no row cap, unlike the
 * legacy POST /students/import. A huge / decompression-bombed file therefore
 * amplified into thousands of per-row INSERTs inside one transaction. The cap is
 * placed right after parse and before analyzeRows / the INSERT loop.
 *
 * DB-free: a pool whose query/getConnection THROW proves the cap short-circuits
 * before the DB is ever touched.
 */

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const importPreview = require('../src/services/studentImportPreview.service');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-cap-'));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

function writeCsv(name, dataRows) {
  const header = 'รหัสนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ชั้น,ห้อง,ทะเบียนรถ,ผู้ปกครอง,เบอร์';
  const lines = [header];
  for (let i = 1; i <= dataRows; i++) lines.push(`${10000 + i},เด็กชาย,ชื่อ${i},สกุล${i},ป.1,1,,,`);
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.from('﻿' + lines.join('\n') + '\n', 'utf-8'));
  return p;
}

function throwingPool() {
  return {
    query: jest.fn(() => { throw new Error('DB must not be reached'); }),
    getConnection: jest.fn(() => { throw new Error('DB must not be reached'); }),
  };
}

describe('runPreview row cap (MEDIUM#7)', () => {
  test('rejects a >5000-row file with a 400 before touching the DB', async () => {
    const filePath = writeCsv('big.csv', 5005);
    const pool = throwingPool();
    const err = await importPreview.runPreview(pool, {
      schoolId: 'SCH0001', importedBy: 1, filePath, originalName: 'big.csv',
    }).then(() => null, (e) => e);

    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/แถวมากเกินไป/);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
