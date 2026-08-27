'use strict';

/**
 * importApplyModes.test.js  (Phase 10.13B-4)
 * Confirmed apply modes: classifier confirm-flags + applyBatch mode/selection
 * gating, idempotency, stale, vehicle-blocked, and tenant scope.
 */
const { classifyImportRow } = require('../src/utils/studentImportClassifier');
const { applyBatch } = require('../src/services/studentImportPreview.service');

const row = (o) => ({ rowNum: 1, student_code: '100', first_name: 'ก', last_name: 'ข', ...o });

describe('classifier confirm-flags (10.13B-4)', () => {
  test('GUARDIAN_MISMATCH exposes can_confirm_guardian_update', () => {
    const r = classifyImportRow({ row: row({ parent_name: 'แม่ใหม่' }), schoolId: 'S1', existing: { id: 5, is_deleted: 0, parent_name: 'พ่อเก่า' } });
    expect(r.classification).toBe('GUARDIAN_MISMATCH');
    expect(r.can_confirm_guardian_update).toBe(true);
    expect(r.can_confirm_reactivate).toBe(false);
    expect(r.action_required).toBe('ยืนยันอัปเดตข้อมูลผู้ปกครอง');
  });
  test('SOFT_DELETED exposes can_confirm_reactivate', () => {
    const r = classifyImportRow({ row: row({}), schoolId: 'S1', existing: { id: 5, is_deleted: 1 } });
    expect(r.classification).toBe('SOFT_DELETED_SAME_SCHOOL_REACTIVATE');
    expect(r.can_confirm_reactivate).toBe(true);
    expect(r.can_confirm_guardian_update).toBe(false);
  });
  test('INSERT_NEW exposes neither confirm flag', () => {
    const r = classifyImportRow({ row: row({}), schoolId: 'S1' });
    expect(r.can_confirm_guardian_update).toBe(false);
    expect(r.can_confirm_reactivate).toBe(false);
  });
});

// Configurable mock pool. studentByCode maps student_code → row returned by the
// per-row student lookup (or undefined → "gone"). vehicleActive controls the
// reactivate vehicle re-check.
function makePool({ batchSchool = 'S1', guardianRows = [], reactRows = [], insertRows = [], studentByCode = {}, vehicleActive = true }) {
  const rowsById = new Map([...guardianRows, ...reactRows, ...insertRows].map((r) => [r.id, r]));
  const conn = () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (/FROM import_batch_rows WHERE id = \? FOR UPDATE/.test(sql)) {
        const locked = rowsById.get(params[0]);
        return locked ? [[{ ...locked, applied_at: null }]] : [[]];
      }
      if (/FROM students WHERE school_id = \? AND student_code/.test(sql)) {
        const s = studentByCode[params[1]];
        return [s ? [s] : []];
      }
      if (/FROM parent_student ps JOIN parents/.test(sql)) return [[]];
      if (/FROM parents WHERE phone/.test(sql)) return [[]];
      if (/FROM vehicles WHERE id = \? AND is_deleted/.test(sql)) return [vehicleActive ? [{ id: params[0] }] : []];
      if (/FROM id_sequences/.test(sql)) return [[{ next_value: 1000 }]];
      if (/INSERT INTO parents/.test(sql)) return [{ insertId: 99 }];
      if (/INSERT INTO students/.test(sql)) return [{}];
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      if (/INSERT INTO parent_student/.test(sql)) return [{}];
      if (/^\s*UPDATE/i.test(sql)) return [{}];
      return [[]];
    },
  });
  return {
    getConnection: async () => conn(),
    query: async (sql) => {
      if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: batchSchool }]];
      if (/FROM terms/.test(sql)) return [[{ id: '2569-1' }]];
      if (/classification = 'GUARDIAN_MISMATCH'/.test(sql)) return [guardianRows];
      if (/classification = 'SOFT_DELETED_SAME_SCHOOL_REACTIVATE'/.test(sql)) return [reactRows];
      if (/classification IN \('INSERT_NEW'/.test(sql)) return [insertRows];
      return [{}];
    },
  };
}
const gRow = (row_no, code) => ({ id: row_no * 10, row_no, student_code: code, normalized_json: JSON.stringify({ parent_name: 'ผู้ปกครองใหม่', parent_phone: '0810000001' }), matched_vehicle_id: null });
const rRow = (row_no, code, veh = null) => ({ id: row_no * 10, row_no, student_code: code, normalized_json: JSON.stringify({ first_name: 'a', last_name: 'b' }), matched_vehicle_id: veh });

describe('applyBatch modes (10.13B-4)', () => {
  test('tenant scope mismatch → 403', async () => {
    await expect(applyBatch(makePool({ batchSchool: 'OTHER' }), { batchId: 1, schoolId: 'S1', userId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('insert_ready does NOT touch guardian/reactivate rows', async () => {
    const pool = makePool({ guardianRows: [gRow(2, '200')], reactRows: [rRow(3, '300')] });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'insert_ready' });
    expect(out.guardian_updated).toBe(0);
    expect(out.reactivated).toBe(0);
  });

  test('update_guardian_confirmed applies ONLY the selected row', async () => {
    const pool = makePool({ guardianRows: [gRow(2, '200'), gRow(3, '300')], studentByCode: { 200: { id: 5 }, 300: { id: 6 } } });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'update_guardian_confirmed', confirmGuardianUpdate: true, selectedRowIds: [2] });
    expect(out.guardian_updated).toBe(1);                       // row 2 only
    expect(out.details.find((d) => d.row === 2).status).toBe('GUARDIAN_UPDATED');
    expect(out.details.find((d) => d.row === 3)).toBeUndefined(); // row 3 unselected → untouched
  });

  test('guardian update requires confirm flag (no flag → nothing applied)', async () => {
    const pool = makePool({ guardianRows: [gRow(2, '200')], studentByCode: { 200: { id: 5 } } });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'update_guardian_confirmed', confirmGuardianUpdate: false, selectedRowIds: [2] });
    expect(out.guardian_updated).toBe(0);
  });

  test('guardian: student gone since preview → STALE_NEEDS_REPREVIEW', async () => {
    const pool = makePool({ guardianRows: [gRow(2, '200')], studentByCode: {} });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'update_guardian_confirmed', confirmGuardianUpdate: true, selectedRowIds: [2] });
    expect(out.stale).toBe(1);
  });

  test('reactivate: soft-deleted student → REACTIVATED', async () => {
    const pool = makePool({ reactRows: [rRow(3, '300')], studentByCode: { 300: { id: 6, is_deleted: 1 } } });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'reactivate_student_confirmed', confirmReactivate: true, selectedRowIds: [3] });
    expect(out.reactivated).toBe(1);
  });

  test('reactivate: already active → ALREADY_APPLIED (no duplicate)', async () => {
    const pool = makePool({ reactRows: [rRow(3, '300')], studentByCode: { 300: { id: 6, is_deleted: 0 } } });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'reactivate_student_confirmed', confirmReactivate: true, selectedRowIds: [3] });
    expect(out.reactivated).toBe(0);
    expect(out.already_applied).toBe(1);
  });

  test('reactivate: matched vehicle now missing → VEHICLE_BLOCKED', async () => {
    const pool = makePool({ reactRows: [rRow(3, '300', 'V-x')], studentByCode: { 300: { id: 6, is_deleted: 1 } }, vehicleActive: false });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'reactivate_student_confirmed', confirmReactivate: true, selectedRowIds: [3] });
    expect(out.vehicle_blocked).toBe(1);
    expect(out.reactivated).toBe(0);
  });

  test('mixed_confirmed: inserts + selected guardian + selected reactivate', async () => {
    const pool = makePool({
      insertRows: [{ id: 10, row_no: 1, student_code: '100', normalized_json: '{}', matched_vehicle_id: null }],
      guardianRows: [gRow(2, '200')], reactRows: [rRow(3, '300')],
      studentByCode: { 100: undefined, 200: { id: 5 }, 300: { id: 6, is_deleted: 1 } },
    });
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1, mode: 'mixed_confirmed', confirmGuardianUpdate: true, confirmReactivate: true, selectedRowIds: [2, 3] });
    expect(out.applied).toBe(1);
    expect(out.guardian_updated).toBe(1);
    expect(out.reactivated).toBe(1);
  });
});
