'use strict';

/**
 * The STALE_NEEDS_REPREVIEW half of the batch-counter fix.
 *
 * applyBatch derives every batch counter from the row statuses, and
 * UNRESOLVED_ROW_STATUSES lists ERROR, APPLY_FAILED, VEHICLE_BLOCKED and
 * STALE_NEEDS_REPREVIEW. Three of those four are exercised against a real
 * database elsewhere: studentImportBatchReporting.test.js drives a row to
 * VEHICLE_BLOCKED and asserts it lands in error_rows and holds the batch at
 * APPLIED_PARTIAL.
 *
 * STALE_NEEDS_REPREVIEW was not. importApplyModes.test.js reaches the transition,
 * but against a mocked pool that answers every UPDATE with [{}] — so it proves
 * the branch is taken and nothing about what the counters end up saying. This is
 * the case the whole counter fix exists for: a row that the school still has to
 * deal with must not leave the batch reading APPLIED with zero errors.
 *
 * Reaching it needs the row to survive to apply and the student to be gone by
 * then, which is exactly what happens when a preview is confirmed after someone
 * else has deleted the student.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestPool } = require('./dbHelper');
const {
  runPreview, applyBatch, listBatches, getBatchDetail,
} = require('../src/services/studentImportPreview.service');

const SCHOOL_ID = '__TSCH';
const CODE_STALE = 'ZSTALE01';
const CODE_OK = 'ZSTALE02';

const HEADER = 'รหัสนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ชั้น,ห้อง,ทะเบียนรถ,ผู้ปกครอง,เบอร์โทรผู้ปกครอง';
const line = (code, firstName, guardian, phone) =>
  `${code},เด็กชาย,${firstName},ทดสอบสเตล,ป.4,2,,${guardian},${phone}`;

let pool;
let userId;
const tempFiles = [];
const batchIds = [];

function writeCsv(rows) {
  const file = path.join(os.tmpdir(), `import-stale-${Date.now()}-${tempFiles.length}.csv`);
  fs.writeFileSync(file, '﻿' + [HEADER, ...rows].join('\r\n') + '\r\n', 'utf8');
  tempFiles.push(file);
  return file;
}

async function preview(rows) {
  const out = await runPreview(pool, {
    schoolId: SCHOOL_ID, importedBy: userId, filePath: writeCsv(rows), originalName: 'stale.csv',
  });
  batchIds.push(out.batch_id);
  return out;
}

beforeAll(async () => {
  pool = getTestPool();
  const [[u]] = await pool.query("SELECT id FROM users WHERE username = '__test_school' LIMIT 1");
  userId = u.id;
  // tests/schema.sql is structure-only, so migration 029's id_sequences seed row
  // is absent and every student insert would fail before reaching the assertions.
  await pool.query(
    `INSERT INTO id_sequences (name, next_value)
     SELECT 'students', COALESCE(MAX(id), 0) + 1 FROM students
     ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value))`
  );
});

afterAll(async () => {
  const [students] = await pool.query(
    'SELECT id FROM students WHERE school_id = ? AND student_code IN (?, ?)',
    [SCHOOL_ID, CODE_STALE, CODE_OK]
  );
  const ids = students.map((s) => s.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const [links] = await pool.query(
      `SELECT DISTINCT parent_id FROM parent_student WHERE student_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM parent_student WHERE student_id IN (${ph})`, ids);
    await pool.query(
      `DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id IN (${ph})`, ids.map(String));
    await pool.query(`DELETE FROM students WHERE id IN (${ph})`, ids);
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
  for (const f of tempFiles) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  await pool.end();
});

describe('a row that goes stale during apply stays in the batch counts', () => {
  let batchId;

  it('sets up two students, then loses one between preview and apply', async () => {
    // Round one: both students are created normally.
    const first = await preview([
      line(CODE_STALE, 'สเตลหนึ่ง', 'ผู้ปกครองเดิม', '0810000011'),
      line(CODE_OK, 'สเตลสอง', 'ผู้ปกครองเดิมสอง', '0810000012'),
    ]);
    const created = await applyBatch(pool, {
      batchId: first.batch_id, schoolId: SCHOOL_ID, userId, mode: 'insert_ready',
    });
    expect(`created: ${created.applied}`).toBe('created: 2');

    // Round two: the same codes with different guardians, so both rows preview as
    // GUARDIAN_MISMATCH and wait for confirmation.
    const second = await preview([
      line(CODE_STALE, 'สเตลหนึ่ง', 'ผู้ปกครองใหม่', '0810000021'),
      line(CODE_OK, 'สเตลสอง', 'ผู้ปกครองใหม่สอง', '0810000022'),
    ]);
    batchId = second.batch_id;
    const kinds = second.rows.map((r) => r.classification).sort();
    expect(`classifications: ${kinds.join(',')}`).toBe('classifications: GUARDIAN_MISMATCH,GUARDIAN_MISMATCH');

    // Someone deletes one of the students before the confirmation is submitted.
    await pool.query(
      'UPDATE students SET is_deleted = TRUE, deleted_at = NOW() WHERE school_id = ? AND student_code = ?',
      [SCHOOL_ID, CODE_STALE]
    );
  });

  it('marks the vanished row STALE_NEEDS_REPREVIEW and applies the other', async () => {
    const rowNos = (await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID }))
      .rows.map((r) => r.row_number);
    const out = await applyBatch(pool, {
      batchId, schoolId: SCHOOL_ID, userId,
      mode: 'update_guardian_confirmed', confirmGuardianUpdate: true, selectedRowIds: rowNos,
    });
    expect(`stale: ${out.stale}, guardian_updated: ${out.guardian_updated}`)
      .toBe('stale: 1, guardian_updated: 1');

    const [rows] = await pool.query(
      'SELECT student_code, status FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no', [batchId]);
    const byCode = Object.fromEntries(rows.map((r) => [r.student_code, r.status]));
    expect(`${CODE_STALE}: ${byCode[CODE_STALE]}`).toBe(`${CODE_STALE}: STALE_NEEDS_REPREVIEW`);
    expect(`${CODE_OK}: ${byCode[CODE_OK]}`).toBe(`${CODE_OK}: GUARDIAN_UPDATED`);
  });

  it('counts the stale row as unresolved, not as nothing', async () => {
    // The defect this guards: a stale row counted nowhere left the batch reading
    // APPLIED with error_rows 0, so the school was told a row had been handled
    // that it still has to re-preview.
    const [[batch]] = await pool.query(
      'SELECT status, success_rows, error_rows FROM import_batches WHERE id = ?', [batchId]);
    expect(`status: ${batch.status}`).toBe('status: APPLIED_PARTIAL');
    expect(`success_rows: ${batch.success_rows}`).toBe('success_rows: 1');
    expect(`error_rows: ${batch.error_rows}`).toBe('error_rows: 1');
  });

  it('shows the same thing on the history list and the detail screen', async () => {
    const { batches } = await listBatches(pool, { schoolId: SCHOOL_ID, perPage: 100 });
    const listed = batches.find((b) => b.batch_id === batchId);
    const detail = await getBatchDetail(pool, { batchId, schoolId: SCHOOL_ID });

    expect(`listed status: ${listed.status}`).toBe('listed status: APPLIED_PARTIAL');
    expect(`listed errors: ${listed.error_count}`).toBe(`listed errors: ${detail.summary.error}`);
    expect(detail.summary).toMatchObject({ total: 2, error: 1, ready: 0 });
  });

  it('tells the school to re-preview rather than showing a stale reason', async () => {
    const [[row]] = await pool.query(
      'SELECT message_th, error_detail FROM import_batch_rows WHERE batch_id = ? AND student_code = ?',
      [batchId, CODE_STALE]
    );
    expect(`error_detail: ${row.error_detail}`).toBe('error_detail: null');
    expect(typeof row.message_th).toBe('string');
    expect(row.message_th.length).toBeGreaterThan(0);
  });
});
