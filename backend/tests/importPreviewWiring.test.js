'use strict';

/**
 * importPreviewWiring.test.js  (Phase 10.13A-26A)
 * analyzeRows with a mocked db — proves DB lookups feed the classifier correctly
 * (canonical vehicle match incl. alias, cross-school, same-school dup), and that
 * apply is idempotent (re-apply on an existing student → ALREADY_APPLIED).
 */
const { analyzeRows, applyBatch } = require('../src/services/studentImportPreview.service');

// db that answers the queries analyzeRows issues, by SQL shape.
function makeDb({ vehicles = [], existingByCode = {}, crossSchoolCodes = [] }) {
  return {
    query: async (sql, params) => {
      if (/FROM vehicles/.test(sql)) return [vehicles];
      if (/FROM students st WHERE st.school_id/.test(sql)) {
        const code = params[1];
        return [[existingByCode[code] || undefined].filter((x) => x !== undefined)];
      }
      if (/school_id <> \?/.test(sql)) {
        const code = params[0];
        return [crossSchoolCodes.includes(code) ? [{ x: 1 }] : []];
      }
      return [[]];
    },
  };
}

const VEHS = [
  { id: 'V-bkk', plate_no: 'ออ 7332 กทม', is_deleted: 0 },
  { id: 'V-800', plate_no: 'นข 800 ลำปาง', is_deleted: 0 },
];

describe('analyzeRows (10.13A-26A)', () => {
  test('alias vehicle match: file กรุงเทพมหานคร resolves to DB กทม', async () => {
    const db = makeDb({ vehicles: VEHS });
    const [r] = await analyzeRows(db, 'S1', [{ rowNum: 2, student_code: '900', first_name: 'a', last_name: 'b', plate_no: 'ออ 7332 กรุงเทพมหานคร' }]);
    expect(r.classification).toBe('INSERT_NEW');
    expect(r.matched_vehicle_id).toBe('V-bkk');
    expect(r.can_apply).toBe(true);
  });

  test('vehicle not found → VEHICLE_NOT_FOUND with the exact plate', async () => {
    const db = makeDb({ vehicles: VEHS });
    const [r] = await analyzeRows(db, 'S1', [{ rowNum: 2, student_code: '901', first_name: 'a', last_name: 'b', plate_no: 'ขข 9999 เชียงใหม่' }]);
    expect(r.classification).toBe('VEHICLE_NOT_FOUND');
    expect(r.message_th).toContain('ขข 9999 เชียงใหม่');
  });

  test('missing province → VEHICLE_MISSING_PROVINCE', async () => {
    const db = makeDb({ vehicles: VEHS });
    const [r] = await analyzeRows(db, 'S1', [{ rowNum: 2, student_code: '902', first_name: 'a', last_name: 'b', plate_no: 'นข 800' }]);
    expect(r.classification).toBe('VEHICLE_MISSING_PROVINCE');
  });

  test('cross-school same code → CROSS_SCHOOL_SAME_CODE_ALLOWED (can_apply)', async () => {
    const db = makeDb({ vehicles: VEHS, crossSchoolCodes: ['3307'] });
    const [r] = await analyzeRows(db, '52020147', [{ rowNum: 2, student_code: '3307', first_name: 'a', last_name: 'b' }]);
    expect(r.classification).toBe('CROSS_SCHOOL_SAME_CODE_ALLOWED');
    expect(r.can_apply).toBe(true);
  });

  test('same-school active duplicate → SKIP (no insert)', async () => {
    const db = makeDb({ vehicles: VEHS, existingByCode: { 100: { id: 7, is_deleted: 0, parent_name: null } } });
    const [r] = await analyzeRows(db, 'S1', [{ rowNum: 2, student_code: '100', first_name: 'a', last_name: 'b' }]);
    expect(r.classification).toBe('SKIP_DUPLICATE_SAME_SCHOOL');
    expect(r.can_apply).toBe(false);
  });
});

describe('applyBatch idempotency (10.13A-26A)', () => {
  // Minimal pool: batch belongs to school; the one can_apply row already exists
  // active → must return ALREADY_APPLIED, never insert.
  function makePool() {
    const calls = [];
    const batchRow = {
      id: 10,
      batch_id: 1,
      row_no: 2,
      student_code: '900',
      classification: 'INSERT_NEW',
      can_apply: 1,
      applied_at: null,
      normalized_json: '{"first_name":"a","last_name":"b"}',
      raw_json: '{"student_code":"900","first_name":"a","last_name":"b"}',
      matched_vehicle_id: null,
    };
    return {
      _calls: calls,
      getConnection: async () => ({
        query: async (sql, params) => {
          calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
          if (/SELECT \* FROM import_batch_rows WHERE id/.test(sql)) return [[batchRow]];
          if (/SELECT id, is_deleted FROM students WHERE school_id/.test(sql)) return [[{ id: 5, is_deleted: 0 }]]; // exists active
          if (/UPDATE import_batch_rows SET status='ALREADY_APPLIED'/.test(sql)) return [{ affectedRows: 1 }];
          return [[]];
        },
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
      }),
      query: async (sql) => {
        if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: 'S1', status: 'PREVIEWED' }]];
        if (/FROM import_batch_rows WHERE batch_id/.test(sql)) return [[batchRow]];
        return [[]];
      },
    };
  }
  test('re-apply on existing student → ALREADY_APPLIED, no INSERT', async () => {
    const pool = makePool();
    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 1 });
    expect(out.already_applied).toBe(1);
    expect(out.applied).toBe(0);
    expect(pool._calls.some((c) => c.startsWith('INSERT INTO'))).toBe(false);
  });

  test('scope mismatch → 403', async () => {
    const pool = makePool();
    await expect(applyBatch(pool, { batchId: 1, schoolId: 'OTHER', userId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });
});
