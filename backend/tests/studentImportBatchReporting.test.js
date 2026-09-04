'use strict';

/**
 * studentImportBatchReporting.test.js
 *
 * Four defects found in the 2026-09-04 import verification, all in the same
 * story: what the school is told about an import it already ran.
 *
 *   M1  import_batches.insert_count / skip_count / error_rows were written once
 *       at preview and never updated by apply, so the history list reported the
 *       preview's optimism (3 ready, 0 errors) for a batch that had actually
 *       failed a row — while the detail endpoint, which recomputes from the
 *       rows, told the truth. Two screens, two different stories.
 *   M2  a row that died inside apply kept the preview's message_th
 *       ("พร้อมนำเข้า") next to status APPLY_FAILED, and neither the detail nor
 *       the report endpoint selected error_detail — a failure with no cause.
 *   M3  the classifier never checked value length against the destination
 *       columns, so a 150-character name previewed as READY and then died at
 *       apply with ER_DATA_TOO_LONG. Preview exists so that cannot happen.
 *   M4  guardian_diff_json was written as JSON.stringify(null) — the JSON
 *       literal null, not SQL NULL — so `guardian_diff_json IS NOT NULL` was
 *       true for every row ever written and every brand-new student was
 *       reported as a guardian change.
 *
 * The test drives the real service against real MySQL. Mocks cannot show M3 or
 * M4: M3 needs the server's actual column widths and STRICT_TRANS_TABLES, and
 * M4 turns entirely on the difference between SQL NULL and the JSON literal
 * null, which only the database can tell apart.
 *
 * The 2026-09-05 verification of that fix then found two regressions of its own
 * and two paths it had missed, all covered at the bottom of this file:
 *
 *   R1  error_detail was cleared only on SUCCESS, so a row that failed once and
 *       was blocked or staled on a retry showed the PREVIOUS failure's reason
 *       under its new status (VEHICLE_BLOCKED · ER_DATA_TOO_LONG).
 *   R2  the batch status and success_rows were written from the pass that had
 *       just run, not from the rows, so a second pass that imported nothing
 *       reset a batch that had already reported a success and a failure.
 *   G1  the width check covered the six students columns but not parents.name,
 *       so a 150-character ผู้ปกครอง still previewed READY and died at apply.
 *   G2  VEHICLE_BLOCKED and STALE_NEEDS_REPREVIEW were counted nowhere, so a
 *       row whose vehicle disappeared between preview and apply vanished from
 *       the counts and left the batch reading APPLIED.
 *
 * Plus the PII rule the fix has to keep: error_detail reaches a screen and an
 * endpoint documented as PII-safe, so it may only ever hold a whitelisted code.
 */

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestPool } = require('./dbHelper');
const {
  runPreview, applyBatch, listBatches, getBatchDetail, getReport,
} = require('../src/services/studentImportPreview.service');
const { validatePlateNo } = require('../src/utils/vehiclePlate');
const plateId = require('../src/utils/plateIdentity');

const SCHOOL_ID = '__TSCH';
const CODES = [
  'ZIMPACC1', 'ZIMPACC2', 'ZIMPACC3', 'ZIMPACC4', 'ZIMPACC5',
  'ZIMPACC6', 'ZIMPACC7', 'ZIMPACC8', 'ZIMPACC9', 'ZIMPACC10',
];
// students.first_name and parents.name are both VARCHAR(100); 150 cannot be stored.
const OVERLONG = 'ก'.repeat(150);
// A vehicle this file owns, so it can be soft-deleted mid-test without touching
// the shared fixtures. Removed again in afterAll.
const BLOCKED_PLATE = 'ขข 9987 ลำปาง';
const BLOCKED_VEHICLE_ID = 'V-testblock01';

const HEADER = 'รหัสนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ชั้น,ห้อง,ทะเบียนรถ,ผู้ปกครอง,เบอร์โทรผู้ปกครอง';
const line = (code, firstName, guardian, phone, plate = '') =>
  `${code},เด็กชาย,${firstName},ทดสอบนำเข้า,ป.5,1,${plate},${guardian},${phone}`;

let pool;
let userId;
const tempFiles = [];
const batchIds = [];

function writeCsv(rows) {
  const file = path.join(os.tmpdir(), `import-reporting-${Date.now()}-${tempFiles.length}.csv`);
  fs.writeFileSync(file, '﻿' + [HEADER, ...rows].join('\r\n') + '\r\n', 'utf8');
  tempFiles.push(file);
  return file;
}

async function preview(rows) {
  const out = await runPreview(pool, {
    schoolId: SCHOOL_ID, importedBy: userId, filePath: writeCsv(rows), originalName: 'reporting.csv',
  });
  batchIds.push(out.batch_id);
  return out;
}

const rowOf = (rows, rowNumber) => rows.find((r) => r.row_number === rowNumber);

beforeAll(async () => {
  pool = getTestPool();
  const [[u]] = await pool.query("SELECT id FROM users WHERE username = '__test_school' LIMIT 1");
  userId = u.id;
  // tests/schema.sql is a structure-only dump, so the seed row migration 029
  // inserts into id_sequences is absent from the disposable database and every
  // student insert would fail before reaching anything this file is testing.
  // Same statement as the migration: idempotent, and never lowers the sequence.
  await pool.query(
    `INSERT INTO id_sequences (name, next_value)
     SELECT 'students', COALESCE(MAX(id), 0) + 1 FROM students
     ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value))`
  );
});

afterAll(async () => {
  // Remove only what this file created, in FK order.
  const [students] = await pool.query(
    `SELECT id FROM students WHERE school_id = ? AND student_code IN (${CODES.map(() => '?').join(',')})`,
    [SCHOOL_ID, ...CODES]
  );
  const studentIds = students.map((s) => s.id);
  if (studentIds.length) {
    const [links] = await pool.query(
      `SELECT DISTINCT parent_id FROM parent_student WHERE student_id IN (${studentIds.map(() => '?').join(',')})`,
      studentIds
    );
    await pool.query(
      `DELETE FROM parent_student WHERE student_id IN (${studentIds.map(() => '?').join(',')})`, studentIds
    );
    await pool.query(
      `DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id IN (${studentIds.map(() => '?').join(',')})`,
      studentIds.map(String)
    );
    await pool.query(
      `DELETE FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})`, studentIds
    );
    for (const l of links) {
      const [[still]] = await pool.query('SELECT COUNT(*) AS n FROM parent_student WHERE parent_id = ?', [l.parent_id]);
      if (Number(still.n) === 0) await pool.query('DELETE FROM parents WHERE id = ?', [l.parent_id]);
    }
  }
  if (batchIds.length) {
    const ph = batchIds.map(() => '?').join(',');
    await pool.query(`DELETE FROM import_batch_rows WHERE batch_id IN (${ph})`, batchIds);
    await pool.query(`DELETE FROM import_batches WHERE id IN (${ph})`, batchIds);
  }
  // The vehicle this file created (after the students that referenced it are gone).
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'vehicle' AND entity_id = ?", [BLOCKED_VEHICLE_ID]);
  await pool.query('DELETE FROM vehicles WHERE id = ?', [BLOCKED_VEHICLE_ID]);
  for (const f of tempFiles) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  await pool.end();
});

describe('M3 — preview must not promise a row the column cannot hold', () => {
  test('a 150-character name is an ERROR at preview, not a READY that dies at apply', async () => {
    const out = await preview([
      line(CODES[0], 'สมชาย', 'ผู้ปกครองหนึ่ง', '0900000901'),
      line(CODES[1], OVERLONG, 'ผู้ปกครองสอง', '0900000902'),
      line(CODES[2], 'สมศักดิ์', 'ผู้ปกครองสาม', '0900000903'),
    ]);

    const bad = rowOf(out.rows, 3);
    expect(bad.status).toBe('ERROR');
    expect(bad.classification).toBe('FIELD_TOO_LONG');
    expect(bad.can_apply).toBe(false);
    // The operator has to be told which field and what the ceiling is.
    expect(bad.message_th).toContain('100');
    expect(bad.message_th).not.toBe('พร้อมนำเข้า');

    expect(out.summary).toMatchObject({ total: 3, ready: 2, error: 1, can_apply: 2 });

    // The two well-formed rows are untouched by the new check.
    expect(rowOf(out.rows, 2).status).toBe('READY');
    expect(rowOf(out.rows, 4).status).toBe('READY');
  });
});

describe('M1 / M2 — a batch that fails a row must say so, in both places', () => {
  let batchId;

  beforeAll(async () => {
    // Preview three clean rows, then make row 3 unstorable *after* preview.
    // A row can still fail at apply for reasons preview cannot see (a vehicle
    // deleted in between, a code taken by someone else), and this reproduces
    // that shape without depending on the M3 gap that is now closed.
    const out = await preview([
      line(CODES[3], 'สมหญิง', 'ผู้ปกครองสี่', '0900000904'),
      line(CODES[4], 'สมปอง', 'ผู้ปกครองห้า', '0900000905'),
      line(CODES[5], 'สมบูรณ์', 'ผู้ปกครองหก', '0900000906'),
    ]);
    batchId = out.batch_id;
    expect(out.summary).toMatchObject({ ready: 3, error: 0 });

    await pool.query(
      "UPDATE import_batch_rows SET normalized_json = JSON_SET(normalized_json, '$.first_name', ?) WHERE batch_id = ? AND row_no = 3",
      [OVERLONG, batchId]
    );

    const applied = await applyBatch(pool, { batchId, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
    expect(applied.applied).toBe(2);
    expect(applied.failed).toBe(1);
  });

  test('M1 — the history list reports what happened, not what preview hoped', async () => {
    const { batches } = await listBatches(pool, { schoolId: SCHOOL_ID, perPage: 100 });
    const listed = batches.find((b) => b.batch_id === batchId);
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });

    expect(listed.status).toBe('APPLIED_PARTIAL');
    // The two screens are fed by different code paths; they must not disagree.
    expect(listed.insert_count).toBe(detail.summary.applied);
    expect(listed.error_count).toBe(detail.summary.error);
    expect(listed.insert_count).toBe(2);
    expect(listed.error_count).toBe(1);
    // The batch row the detail screen reads its header from agrees too.
    expect(detail.batch.insert_count).toBe(2);
    expect(detail.batch.error_count).toBe(1);
  });

  test('M2 — the failed row explains itself, and both endpoints carry the reason', async () => {
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });
    const failed = detail.rows.find((r) => r.row_number === 3);

    expect(failed.status).toBe('APPLY_FAILED');
    expect(failed.message_th).not.toBe('พร้อมนำเข้า');
    expect(failed.message_th).toContain('ไม่สำเร็จ');
    expect(failed.error_detail).toBe('ER_DATA_TOO_LONG');

    const report = await getReport(pool, { batchId, schoolId: SCHOOL_ID });
    const reported = report.rows.find((r) => r.row_number === 3);
    expect(reported.error_detail).toBe('ER_DATA_TOO_LONG');
    expect(reported.message_th).not.toBe('พร้อมนำเข้า');

    // Rows that succeeded are not given a phantom failure reason.
    expect(detail.rows.find((r) => r.row_number === 2).error_detail).toBeNull();
  });

  test('M2 — a failed row that succeeds on retry stops claiming it failed', async () => {
    // A repeat apply picks the failed row up again (it still has can_apply = 1
    // and applied_at IS NULL), so the failure text and reason must not outlive
    // the failure — otherwise the fix for M2 creates the mirror-image lie.
    await pool.query(
      "UPDATE import_batch_rows SET normalized_json = JSON_SET(normalized_json, '$.first_name', 'สมบูรณ์') WHERE batch_id = ? AND row_no = 3",
      [batchId]
    );
    const retried = await applyBatch(pool, { batchId, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
    expect(retried.applied).toBe(1);
    expect(retried.failed).toBe(0);

    const [[stored]] = await pool.query(
      'SELECT status, message_th, error_detail FROM import_batch_rows WHERE batch_id = ? AND row_no = 3', [batchId]
    );
    expect(stored.status).toBe('APPLIED');
    expect(stored.error_detail).toBeNull();
    expect(stored.message_th).not.toContain('ไม่สำเร็จ');

    // A row that never failed keeps the message it already had.
    const [[untouched]] = await pool.query(
      'SELECT message_th, error_detail FROM import_batch_rows WHERE batch_id = ? AND row_no = 2', [batchId]
    );
    expect(untouched.message_th).toBe('พร้อมนำเข้า');
    expect(untouched.error_detail).toBeNull();

    // And the batch counters follow the rows on the second pass too.
    const { batches } = await listBatches(pool, { schoolId: SCHOOL_ID, perPage: 100 });
    const listed = batches.find((b) => b.batch_id === batchId);
    expect(listed.status).toBe('APPLIED');
    expect(listed.insert_count).toBe(3);
    expect(listed.error_count).toBe(0);
  });
});

describe('M4 — only a real guardian change may be reported as one', () => {
  let batchId;

  beforeAll(async () => {
    batchId = batchIds[batchIds.length - 1];
  });

  test('preview stores SQL NULL, not the JSON literal null, when nothing changed', async () => {
    const [rows] = await pool.query(
      'SELECT row_no, guardian_diff_json IS NULL AS sql_null, JSON_TYPE(guardian_diff_json) AS jtype FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no',
      [batchId]
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(Number(r.sql_null)).toBe(1);   // was 0 — the column held JSON null
      expect(r.jtype).toBeNull();           // was the string 'NULL'
    }
  });

  test('a brand-new student is not reported as a guardian change', async () => {
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });
    for (const r of detail.rows) expect(r.guardian_mismatch).toBe(false);
    const report = await getReport(pool, { batchId, schoolId: SCHOOL_ID });
    for (const r of report.rows) expect(r.guardian_mismatch).toBe('no');
  });

  test('rows already written the old way read as unchanged; a real diff still reads as changed', async () => {
    // Row 2 = the legacy shape that is sitting in the database today.
    await pool.query(
      "UPDATE import_batch_rows SET guardian_diff_json = CAST('null' AS JSON) WHERE batch_id = ? AND row_no = 2",
      [batchId]
    );
    // Row 4 = a genuine guardian change, which must keep being reported.
    await pool.query(
      "UPDATE import_batch_rows SET guardian_diff_json = CAST(? AS JSON) WHERE batch_id = ? AND row_no = 4",
      [JSON.stringify({ current: 'ผู้ปกครองเดิม', input: 'ผู้ปกครองใหม่' }), batchId]
    );

    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });
    const legacy = detail.rows.find((r) => r.row_number === 2);
    const real = detail.rows.find((r) => r.row_number === 4);

    expect(legacy.guardian_mismatch).toBe(false);
    expect(real.guardian_mismatch).toBe(true);
    expect(real.guardian_current).toBe('ผู้ปกครองเดิม');
    expect(real.guardian_input).toBe('ผู้ปกครองใหม่');

    const report = await getReport(pool, { batchId, schoolId: SCHOOL_ID });
    expect(report.rows.find((r) => r.row_number === 2).guardian_mismatch).toBe('no');
    expect(report.rows.find((r) => r.row_number === 4).guardian_mismatch).toBe('yes');
  });
});

describe('R1 / R2 / G2 — a retry must not rewrite what the school was already told', () => {
  let batchId;

  beforeAll(async () => {
    const v = validatePlateNo(BLOCKED_PLATE);
    await pool.query('DELETE FROM vehicles WHERE id = ?', [BLOCKED_VEHICLE_ID]);
    await pool.query(
      `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type, verification_status)
       VALUES (?, ?, ?, ?, 'รถตู้', 'UNVERIFIED')`,
      [BLOCKED_VEHICLE_ID, v.trimmed, v.normalized, plateId.canonicalPlateForStorage(v.trimmed)]
    );

    const out = await preview([
      line(CODES[6], 'สมคิด', 'ผู้ปกครองเจ็ด', '0900000907'),
      line(CODES[7], 'สมทรง', 'ผู้ปกครองแปด', '0900000908', BLOCKED_PLATE),
    ]);
    batchId = out.batch_id;
    expect(out.summary).toMatchObject({ total: 2, ready: 2, error: 0 });
    expect(rowOf(out.rows, 3).matched_vehicle_id).toBe(BLOCKED_VEHICLE_ID);

    // Pass 1 — row 3 cannot be stored. The school is told: 1 success, 1 failure.
    await pool.query(
      "UPDATE import_batch_rows SET normalized_json = JSON_SET(normalized_json, '$.first_name', ?) WHERE batch_id = ? AND row_no = 3",
      [OVERLONG, batchId]
    );
    const pass1 = await applyBatch(pool, { batchId, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
    expect(pass1.applied).toBe(1);
    expect(pass1.failed).toBe(1);
    const [[afterPass1]] = await pool.query(
      'SELECT status, success_rows, insert_count, error_rows FROM import_batches WHERE id = ?', [batchId]
    );
    expect(afterPass1.status).toBe('APPLIED_PARTIAL');
    expect(afterPass1.success_rows).toBe(1);
    expect(afterPass1.error_rows).toBe(1);

    // Pass 2 — the file row is fixed, but the vehicle disappeared in between, so
    // the retry ends on VEHICLE_BLOCKED and imports nothing at all.
    await pool.query(
      "UPDATE import_batch_rows SET normalized_json = JSON_SET(normalized_json, '$.first_name', 'สมทรง') WHERE batch_id = ? AND row_no = 3",
      [batchId]
    );
    await pool.query('UPDATE vehicles SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [BLOCKED_VEHICLE_ID]);
    const pass2 = await applyBatch(pool, { batchId, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
    expect(pass2.applied).toBe(0);
    expect(pass2.failed).toBe(0);
    expect(pass2.vehicle_blocked).toBe(1);
  });

  test('R1 — the blocked row does not wear the previous failure\'s reason', async () => {
    const [[stored]] = await pool.query(
      'SELECT status, message_th, error_detail FROM import_batch_rows WHERE batch_id = ? AND row_no = 3', [batchId]
    );
    expect(stored.status).toBe('VEHICLE_BLOCKED');
    expect(stored.error_detail).toBeNull();            // was 'ER_DATA_TOO_LONG'
    expect(stored.message_th).not.toContain('ยาวเกิน'); // was the ER_DATA_TOO_LONG text
    expect(stored.message_th).toContain('รถ');          // says why it is blocked NOW

    // Both school-facing endpoints must carry the corrected story, not the old one.
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });
    expect(detail.rows.find((r) => r.row_number === 3).error_detail).toBeNull();
    const report = await getReport(pool, { batchId, schoolId: SCHOOL_ID });
    expect(report.rows.find((r) => r.row_number === 3).error_detail).toBeNull();
  });

  test('R2 — a pass that imports nothing cannot lower a number already shown', async () => {
    const [[batch]] = await pool.query(
      'SELECT status, success_rows, insert_count, error_rows FROM import_batches WHERE id = ?', [batchId]
    );
    expect(batch.status).toBe('APPLIED_PARTIAL');  // was 'APPLIED' — the failure was forgotten
    expect(batch.success_rows).toBe(1);            // was 0 — pass 1's success was overwritten
    expect(batch.insert_count).toBe(1);
    expect(batch.error_rows).toBe(1);              // was 0 — the blocked row was counted nowhere
  });

  test('G2 — the blocked row stays in the counts, and both screens still agree', async () => {
    const { batches } = await listBatches(pool, { schoolId: SCHOOL_ID, perPage: 100 });
    const listed = batches.find((b) => b.batch_id === batchId);
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });

    expect(listed.status).toBe('APPLIED_PARTIAL');
    expect(listed.insert_count).toBe(detail.summary.applied);
    expect(listed.error_count).toBe(detail.summary.error);
    // A row that did not go in is not "ready" — it is one of the two the school
    // still has to deal with.
    expect(detail.summary).toMatchObject({ total: 2, applied: 1, error: 1, ready: 0 });
  });

  test('the counters follow the rows forward too, once the vehicle is back', async () => {
    await pool.query('UPDATE vehicles SET is_deleted = FALSE, deleted_at = NULL WHERE id = ?', [BLOCKED_VEHICLE_ID]);
    const pass3 = await applyBatch(pool, { batchId, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
    expect(pass3.applied).toBe(1);
    expect(pass3.vehicle_blocked).toBe(0);

    const [[batch]] = await pool.query(
      'SELECT status, success_rows, insert_count, error_rows FROM import_batches WHERE id = ?', [batchId]
    );
    expect(batch.status).toBe('APPLIED');
    expect(batch.success_rows).toBe(2);
    expect(batch.insert_count).toBe(2);
    expect(batch.error_rows).toBe(0);

    const [[stored]] = await pool.query(
      'SELECT status, error_detail FROM import_batch_rows WHERE batch_id = ? AND row_no = 3', [batchId]
    );
    expect(stored.status).toBe('APPLIED');
    expect(stored.error_detail).toBeNull();
  });
});

describe('G1 — the width check must cover the guardian column too', () => {
  test('a 150-character ผู้ปกครอง is an ERROR at preview, not a READY that dies at apply', async () => {
    const out = await preview([line(CODES[8], 'สมพร', OVERLONG, '0900000909')]);
    const bad = rowOf(out.rows, 2);

    expect(bad.status).toBe('ERROR');
    expect(bad.classification).toBe('FIELD_TOO_LONG');
    expect(bad.can_apply).toBe(false);
    expect(bad.message_th).toContain('ผู้ปกครอง');
    expect(bad.message_th).toContain('100');       // parents.name is VARCHAR(100)
    expect(out.summary).toMatchObject({ total: 1, ready: 0, error: 1, can_apply: 0 });
  });
});

describe('error_detail may only ever hold a code the service recognises', () => {
  test('an unmapped failure is stored as UNKNOWN_ERROR, not as raw error text', async () => {
    // /report is documented PII-safe and the school sees error_detail as
    // "สาเหตุจากระบบ: …". A mysql2 `code` is a fixed identifier, but the raw
    // `message` this used to fall back to is free text — ER_DUP_ENTRY's quotes
    // the duplicated key, i.e. a student_code. Force a failure the map does not
    // know (the id allocator throws a plain Error) and check what is stored.
    const out = await preview([line(CODES[9], 'สมหมาย', 'ผู้ปกครองสิบ', '0900000910')]);
    const probeBatch = out.batch_id;
    await pool.query("UPDATE id_sequences SET name = '__students_probe' WHERE name = 'students'");
    try {
      const res = await applyBatch(pool, { batchId: probeBatch, schoolId: SCHOOL_ID, userId, mode: 'insert_ready' });
      expect(res.failed).toBe(1);
    } finally {
      await pool.query("UPDATE id_sequences SET name = 'students' WHERE name = '__students_probe'");
    }

    const [[stored]] = await pool.query(
      'SELECT status, message_th, error_detail FROM import_batch_rows WHERE batch_id = ? AND row_no = 2', [probeBatch]
    );
    expect(stored.status).toBe('APPLY_FAILED');
    expect(stored.error_detail).toBe('UNKNOWN_ERROR');   // was the raw exception message
    expect(stored.message_th).toContain('ไม่สำเร็จ');
  });
});
