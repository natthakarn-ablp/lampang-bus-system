'use strict';

/**
 * One-off operational script — re-hash students.cid_hash from the original source
 * CIDs using the configured CID_HASH_PEPPER (keyed HMAC-SHA256).
 *
 * Background (audit 2026-06-18, auth-crypto): cid_hash was a plain unsalted SHA-256,
 * which is brute-forceable from a leaked DB. utils/hash.js now uses HMAC when
 * CID_HASH_PEPPER is set, but existing rows must be re-hashed from the ORIGINAL raw
 * CIDs (hashes are one-way). The raw CIDs only exist in input/*.xlsx, so this script
 * re-reads them and rewrites cid_hash everywhere it is denormalised.
 *
 * USAGE:
 *   1. Choose a strong secret and put it in the backend env:  CID_HASH_PEPPER=<≥32 random chars>
 *   2. node backend/scripts/rehash-cid.js          (dry run — prints what would change)
 *   3. node backend/scripts/rehash-cid.js --apply  (writes the new hashes)
 *
 * Mirrors the column mapping in migrate-from-excel.js (DATA sheet: col 5 = student id,
 * col 6 = national ID).
 */

require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { hashCid } = require('../src/utils/hash');

const EXCEL_PATH = path.resolve(__dirname, '../../input/Lampang_Bus_System_MasterV.1.xlsx');
const APPLY = process.argv.includes('--apply');

function cellValue(row, colIndex) {
  const cell = row.getCell(colIndex);
  if (cell.value === null || cell.value === undefined) return null;
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map((r) => r.text).join('').trim() || null;
  }
  return String(cell.value).trim() || null;
}

async function main() {
  if (!process.env.CID_HASH_PEPPER) {
    console.error('[rehash-cid] CID_HASH_PEPPER is not set. Set it before running so the new hashes are keyed.');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const dataSheet = workbook.getWorksheet('DATA');
  if (!dataSheet) { console.error('[rehash-cid] DATA sheet not found'); process.exit(1); }

  const updates = [];
  dataSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const studentId = parseInt(cellValue(row, 5), 10);
    if (!Number.isInteger(studentId)) return;
    const cid = cellValue(row, 6);
    const newHash = cid ? hashCid(String(cid)) : hashCid(`NOID-${studentId}`);
    updates.push({ studentId, newHash });
  });

  console.log(`[rehash-cid] ${updates.length} student rows to re-hash. apply=${APPLY}`);
  if (!APPLY) {
    console.log('[rehash-cid] dry run — re-run with --apply to write. Sample:',
      updates.slice(0, 3).map((u) => ({ id: u.studentId, cid_hash: `${u.newHash.slice(0, 12)}…` })));
    return;
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
  });
  try {
    await conn.beginTransaction();
    for (const u of updates) {
      await conn.query('UPDATE students SET cid_hash = ? WHERE id = ?', [u.newHash, u.studentId]);
      // Keep the denormalised copies consistent so historical rows still match.
      await conn.query('UPDATE checkin_logs SET cid_hash = ? WHERE student_id = ?', [u.newHash, u.studentId]);
      await conn.query('UPDATE daily_status SET cid_hash = ? WHERE student_id = ?', [u.newHash, u.studentId]);
    }
    await conn.commit();
    console.log(`[rehash-cid] done — ${updates.length} students re-hashed.`);
  } catch (err) {
    await conn.rollback();
    console.error('[rehash-cid] failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
