'use strict';

require('./loadTestEnv');
const { applyBatch } = require('../src/services/studentImportPreview.service');

function makePool({ insertRows = [], studentByCode = {}, activeVehicle = true } = {}) {
  const calls = [];
  const record = (scope, sql, params) => calls.push({ scope, sql: String(sql).replace(/\s+/g, ' ').trim(), params });
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      record('conn', sql, params);
      if (/SELECT \* FROM import_batch_rows WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[insertRows.find((r) => Number(r.id) === Number(params[0])) || null]];
      }
      if (/SELECT id, is_deleted FROM students WHERE school_id = \? AND student_code = \?/.test(sql)) {
        const st = studentByCode[params[1]];
        return [st ? [st] : []];
      }
      if (/SELECT next_value FROM id_sequences/.test(sql)) return [[{ next_value: 1001 }]];
      if (/UPDATE id_sequences/.test(sql)) return [{}];
      if (/SELECT id FROM vehicles WHERE id = \? AND is_deleted = FALSE/.test(sql)) {
        return [activeVehicle ? [{ id: params[0] }] : []];
      }
      if (/SELECT id, is_deleted FROM vehicles/.test(sql)) return [[]];
      if (/SELECT id FROM vehicles WHERE is_deleted = FALSE/.test(sql)) return [[]];
      if (/INSERT INTO vehicles/.test(sql)) return [{}];
      if (/INSERT INTO students/.test(sql)) return [{}];
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      if (/INSERT INTO parent_student/.test(sql)) return [{}];
      if (/UPDATE import_batch_rows/.test(sql)) return [{}];
      return [[]];
    },
  };
  return {
    _calls: calls,
    getConnection: async () => conn,
    query: async (sql, params = []) => {
      record('pool', sql, params);
      if (/SELECT id FROM terms/.test(sql)) return [[{ id: '2569-1' }]];
      if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: 'S1' }]];
      if (/classification IN \('INSERT_NEW'/.test(sql)) return [insertRows];
      if (/UPDATE import_batches SET/.test(sql)) return [{}];
      return [[]];
    },
  };
}

const insertRow = (overrides = {}) => ({
  id: 10,
  batch_id: 1,
  row_no: 2,
  student_code: '900',
  classification: 'INSERT_NEW',
  can_apply: 1,
  applied_at: null,
  raw_json: JSON.stringify({ student_name: 'สมชาย ใจดี', plate: 'นข 2210 ลำปาง' }),
  normalized_json: JSON.stringify({ first_name: 'สมชาย', last_name: 'ใจดี' }),
  matched_vehicle_id: null,
  ...overrides,
});

describe('student import apply safety (audit round 1)', () => {
  test('auto-create uses the plate persisted in raw_json and inserts the student with the created UNVERIFIED vehicle', async () => {
    const row = insertRow({ classification: 'INSERT_NEW_AUTO_VEHICLE' });
    const pool = makePool({ insertRows: [row] });

    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 7, autoCreateVehicle: true });

    expect(out.applied).toBe(1);
    expect(pool._calls.some((c) => /SELECT \* FROM import_batch_rows WHERE id = \? FOR UPDATE/.test(c.sql))).toBe(true);
    expect(pool._calls.some((c) => /INSERT INTO vehicles/.test(c.sql))).toBe(true);
    const studentInsert = pool._calls.find((c) => /INSERT INTO students/.test(c.sql));
    expect(studentInsert).toBeTruthy();
    expect(studentInsert.params[9]).toMatch(/^V-/);
  });

  test('insert apply re-checks a matched vehicle and blocks if it was soft-deleted after preview', async () => {
    const row = insertRow({ matched_vehicle_id: 'V-soft-deleted' });
    const pool = makePool({ insertRows: [row], activeVehicle: false });

    const out = await applyBatch(pool, { batchId: 1, schoolId: 'S1', userId: 7 });

    expect(out.vehicle_blocked).toBe(1);
    expect(out.applied).toBe(0);
    expect(pool._calls.some((c) => /INSERT INTO students/.test(c.sql))).toBe(false);
    expect(pool._calls.some((c) => /UPDATE import_batch_rows SET status='VEHICLE_BLOCKED'/.test(c.sql))).toBe(true);
  });
});


describe('student import guardian update safety (audit round 2)', () => {
  function makeGuardianPool() {
    const calls = [];
    const row = {
      id: 20,
      batch_id: 1,
      row_no: 2,
      student_code: '200',
      classification: 'GUARDIAN_MISMATCH',
      applied_at: null,
      normalized_json: JSON.stringify({ parent_name: 'ผู้ปกครองใหม่', parent_phone: '0820000002' }),
    };
    const record = (scope, sql, params) => calls.push({ scope, sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    return {
      _calls: calls,
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params = []) => {
          record('conn', sql, params);
          if (/SELECT \* FROM import_batch_rows WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
          if (/SELECT id FROM students WHERE school_id = \? AND student_code = \?/.test(sql)) return [[{ id: 5 }]];
          if (/FROM parent_student ps JOIN parents p/.test(sql)) return [[{ id: 1, old_name: 'ผู้ปกครองเดิม', old_phone: '0810000001' }]];
          if (/SELECT id FROM parents WHERE phone = \?/.test(sql)) return [[]];
          if (/INSERT INTO parents/.test(sql)) return [{ insertId: 99 }];
          if (/INSERT INTO parent_student/.test(sql)) return [{}];
          if (/UPDATE parent_student SET approved = FALSE/.test(sql)) return [{}];
          if (/INSERT INTO audit_logs/.test(sql)) return [{}];
          if (/UPDATE import_batch_rows/.test(sql)) return [{}];
          if (/UPDATE parents/.test(sql)) return [{}];
          return [[]];
        },
      }),
      query: async (sql, params = []) => {
        record('pool', sql, params);
        if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: 'S1' }]];
        if (/classification = 'GUARDIAN_MISMATCH'/.test(sql)) return [[row]];
        if (/UPDATE import_batches SET/.test(sql)) return [{}];
        return [[]];
      },
    };
  }

  test('phone changes create a new parent link and preserve the old parent row instead of overwriting it', async () => {
    const pool = makeGuardianPool();
    const out = await applyBatch(pool, {
      batchId: 1,
      schoolId: 'S1',
      userId: 7,
      mode: 'update_guardian_confirmed',
      confirmGuardianUpdate: true,
      selectedRowIds: [2],
    });

    expect(out.guardian_updated).toBe(1);
    expect(pool._calls.some((c) => /INSERT INTO parents/.test(c.sql))).toBe(true);
    expect(pool._calls.some((c) => /UPDATE parent_student SET approved = FALSE/.test(c.sql))).toBe(true);
    expect(pool._calls.some((c) => /UPDATE parents SET name = \?, phone = \? WHERE id = \?/.test(c.sql))).toBe(false);
  });
});
