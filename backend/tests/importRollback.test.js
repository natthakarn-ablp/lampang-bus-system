'use strict';

/**
 * importRollback.test.js  (Phase 10.13B-5)
 * Import history detail tenant scope + rollback eligibility/idempotency/safety.
 */
const crypto = require('crypto');
const { rollbackBatch, getBatchDetail } = require('../src/services/studentImportPreview.service');

const cid = (school, code) => crypto.createHash('sha256').update(`import-${school}-${code}`).digest('hex');

// Mock pool. rows = import_batch_rows for the batch; studentById = the students
// returned by the per-row FOR UPDATE re-read.
function makePool({ batchSchool = 'S1', rows = [], studentById = {} }) {
  const conn = () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (/FROM students WHERE id = \? FOR UPDATE/.test(sql)) { const s = studentById[params[0]]; return [s ? [s] : []]; }
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      if (/^\s*UPDATE/i.test(sql)) return [{}];
      return [[]];
    },
  });
  return {
    getConnection: async () => conn(),
    query: async (sql) => {
      if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: batchSchool }]];
      if (/FROM import_batch_rows WHERE batch_id = \? ORDER BY row_no/.test(sql)) return [rows];
      if (/COUNT\(\*\) n FROM import_batch_rows.*APPLIED/.test(sql)) return [[{ n: 0 }]];
      return [{}];
    },
  };
}
const appliedRow = (row_no, code, newId) => ({ id: row_no * 10, row_no, status: 'APPLIED', rollback_status: null, new_student_id: newId, student_code: code });

describe('rollbackBatch (10.13B-5)', () => {
  test('empty selection → 400', async () => {
    await expect(rollbackBatch(makePool({}), { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [] })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('tenant scope mismatch → 403', async () => {
    await expect(rollbackBatch(makePool({ batchSchool: 'OTHER' }), { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('eligible inserted row → ROLLED_BACK (soft-delete)', async () => {
    const pool = makePool({ rows: [appliedRow(2, '900', 500)], studentById: { 500: { id: 500, school_id: 'S1', student_code: '900', is_deleted: 0, cid_hash: cid('S1', '900') } } });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2], reason: 'ผิดพลาด' });
    expect(out.rolled_back).toBe(1);
    expect(out.details[0].status).toBe('ROLLED_BACK');
  });

  test('pre-existing / externally-created student (cid mismatch) → NOT_SAFE_TO_ROLLBACK', async () => {
    const pool = makePool({ rows: [appliedRow(2, '900', 500)], studentById: { 500: { id: 500, school_id: 'S1', student_code: '900', is_deleted: 0, cid_hash: 'some-other-cid' } } });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] });
    expect(out.skipped).toBe(1);
    expect(out.details[0].status).toBe('NOT_SAFE_TO_ROLLBACK');
  });

  test('guardian-updated row (status != APPLIED) → NOT_ELIGIBLE', async () => {
    const pool = makePool({ rows: [{ id: 20, row_no: 2, status: 'GUARDIAN_UPDATED', rollback_status: null, new_student_id: 500, student_code: '900' }] });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] });
    expect(out.details[0].status).toBe('NOT_ELIGIBLE_FOR_ROLLBACK');
  });

  test('already rolled back → ALREADY_ROLLED_BACK (idempotent)', async () => {
    const pool = makePool({ rows: [{ id: 20, row_no: 2, status: 'APPLIED', rollback_status: 'ROLLED_BACK', new_student_id: 500, student_code: '900' }] });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] });
    expect(out.already_rolled_back).toBe(1);
  });

  test('cross-school student (school differs now) → NOT_ELIGIBLE', async () => {
    const pool = makePool({ rows: [appliedRow(2, '900', 500)], studentById: { 500: { id: 500, school_id: 'OTHER', student_code: '900', is_deleted: 0, cid_hash: cid('OTHER', '900') } } });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] });
    expect(out.details[0].status).toBe('NOT_ELIGIBLE_FOR_ROLLBACK');
  });

  test('student gone → STALE_NEEDS_REVIEW', async () => {
    const pool = makePool({ rows: [appliedRow(2, '900', 500)], studentById: {} });
    const out = await rollbackBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, selectedRowIds: [2] });
    expect(out.details[0].status).toBe('STALE_NEEDS_REVIEW');
  });
});

describe('getBatchDetail tenant scope (10.13B-5)', () => {
  test('other school cannot view detail → 403', async () => {
    const pool = { query: async (sql) => (/FROM import_batches WHERE id/.test(sql) ? [[{ id: 1, school_id: 'S2' }]] : [[]]) };
    await expect(getBatchDetail(pool, { batchId: 1, schoolId: 'S1' })).rejects.toMatchObject({ statusCode: 403 });
  });
});
