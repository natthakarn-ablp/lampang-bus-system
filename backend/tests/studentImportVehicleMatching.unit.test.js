'use strict';

require('./loadTestEnv');
const { analyzeRows } = require('../src/services/studentImportPreview.service');

function makeDb({ vehicles = [] } = {}) {
  return {
    query: async (sql) => {
      if (/SELECT id, plate_no, is_deleted FROM vehicles/.test(sql)) return [vehicles];
      if (/FROM students st WHERE st.school_id/.test(sql)) return [[]];
      if (/school_id <> \?/.test(sql)) return [[]];
      return [[]];
    },
  };
}

const baseRow = (plateNo) => ({
  rowNum: 2,
  student_code: '901',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  plate_no: plateNo,
});

describe('student import vehicle matching is strict', () => {
  test('does not auto-match a province-less plate even when only one active vehicle has that base number', async () => {
    const db = makeDb({ vehicles: [{ id: 'V-800', plate_no: 'นข 800 ลำปาง', is_deleted: 0 }] });
    const [r] = await analyzeRows(db, 'S1', [baseRow('นข 800')]);
    expect(r.classification).toBe('VEHICLE_MISSING_PROVINCE');
    expect(r.can_apply).toBe(false);
    expect(r.matched_vehicle_id).toBeNull();
  });

  test('does not fuzzy-match a partial province prefix to an existing vehicle', async () => {
    const db = makeDb({ vehicles: [{ id: 'V-800', plate_no: 'นข 800 ลำปาง', is_deleted: 0 }] });
    const [r] = await analyzeRows(db, 'S1', [baseRow('นข 800 ลำ')]);
    expect(r.classification).toBe('VEHICLE_PLATE_INVALID');
    expect(r.can_apply).toBe(false);
    expect(r.matched_vehicle_id).toBeNull();
  });
});
