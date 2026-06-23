'use strict';

// DB-free unit tests for the transport per-vehicle LIST endpoints that back the
// dashboard counts (`not_inspected`, `pending`, `expiring_docs_count`,
// `expired_docs_count`). A mock pool captures the SQL so we can assert the
// filter definitions match the dashboard aggregates without touching MySQL.

const { getPendingVehicles, getExpiringVehicles } = require('../src/services/transport.service');

// Mock pool: first query() call (COUNT) returns [[{ total }]], the second
// (the row SELECT) returns [rows]. Every SQL string is recorded for assertions.
function fakePool({ total = 0, rows = [] } = {}) {
  const calls = [];
  let call = 0;
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      call += 1;
      if (call === 1) return [[{ total }]];
      return [rows];
    }),
  };
}

const countSql = (pool) => pool.calls[0].sql;
const listSql = (pool) => pool.calls[1].sql;

describe('getPendingVehicles (รถที่ยังไม่ตรวจ)', () => {
  test('default set = vehicles with NO inspection row (matches not_inspected)', async () => {
    const pool = fakePool({ total: 3, rows: [{ id: 'V-1' }] });
    const result = await getPendingVehicles({ page: 1, per_page: 50 }, pool);

    // not_inspected definition: non-deleted vehicle with no inspection row.
    expect(countSql(pool)).toMatch(/v\.is_deleted = FALSE/);
    expect(countSql(pool)).toMatch(/NOT EXISTS\s*\(SELECT 1 FROM vehicle_inspections vi WHERE vi\.vehicle_id = v\.id\)/);
    // Default must NOT pull in latest-result=PENDING rows (keeps total == not_inspected).
    expect(countSql(pool)).not.toMatch(/'PENDING'/);

    expect(result.meta).toEqual({ page: 1, per_page: 50, total: 3 });
    expect(result.vehicles).toEqual([{ id: 'V-1' }]);
  });

  test('includePending adds latest-result PENDING vehicles (dashboard `pending`)', async () => {
    const pool = fakePool({ total: 5 });
    await getPendingVehicles({ includePending: true }, pool);
    expect(countSql(pool)).toMatch(/NOT EXISTS/);
    expect(countSql(pool)).toMatch(/= 'PENDING'/);
  });

  test('is PII-free: never queries the students table', async () => {
    const pool = fakePool({ total: 0 });
    await getPendingVehicles({}, pool);
    for (const { sql } of pool.calls) {
      expect(sql).not.toMatch(/\bstudents\b/);
    }
  });

  test('paginates with LIMIT/OFFSET derived from page & per_page', async () => {
    const pool = fakePool({ total: 0 });
    await getPendingVehicles({ page: 3, per_page: 20 }, pool);
    expect(listSql(pool)).toMatch(/LIMIT \? OFFSET \?/);
    // page 3, per_page 20 → offset 40
    expect(pool.calls[1].params).toEqual([20, 40]);
  });
});

describe('getExpiringVehicles (รถที่ใกล้หมดอายุ)', () => {
  test('default matches dashboard expiring_docs_count (4-field 30-day union)', async () => {
    const pool = fakePool({ total: 7, rows: [{ id: 'V-2' }] });
    const result = await getExpiringVehicles({ page: 1, per_page: 50 }, pool);

    const sql = countSql(pool);
    expect(sql).toMatch(/v\.is_deleted = FALSE/);
    for (const field of ['insurance_expiry', 'registration_expiry', 'compulsory_insurance_expiry', 'tax_expiry']) {
      expect(sql).toMatch(new RegExp(`${field}\\s+BETWEEN CURDATE\\(\\) AND DATE_ADD\\(CURDATE\\(\\), INTERVAL 30 DAY\\)`));
    }
    // default must be the "expiring soon" window, not the already-expired branch
    expect(sql).not.toMatch(/< CURDATE\(\)/);

    expect(result.meta).toEqual({ page: 1, per_page: 50, total: 7 });
    expect(result.vehicles).toEqual([{ id: 'V-2' }]);
  });

  test('expired=true matches dashboard expired_docs_count (4-field < CURDATE)', async () => {
    const pool = fakePool({ total: 2 });
    await getExpiringVehicles({ expired: true }, pool);

    const sql = countSql(pool);
    for (const field of ['insurance_expiry', 'registration_expiry', 'compulsory_insurance_expiry', 'tax_expiry']) {
      expect(sql).toMatch(new RegExp(`${field}\\s+< CURDATE\\(\\)`));
    }
    expect(sql).not.toMatch(/BETWEEN CURDATE/);
  });

  test('is PII-free: never queries the students table', async () => {
    const pool = fakePool({ total: 0 });
    await getExpiringVehicles({}, pool);
    for (const { sql } of pool.calls) {
      expect(sql).not.toMatch(/\bstudents\b/);
    }
  });

  test('paginates with LIMIT/OFFSET derived from page & per_page', async () => {
    const pool = fakePool({ total: 0 });
    await getExpiringVehicles({ page: 2, per_page: 25 }, pool);
    expect(listSql(pool)).toMatch(/LIMIT \? OFFSET \?/);
    // page 2, per_page 25 → offset 25
    expect(pool.calls[1].params).toEqual([25, 25]);
  });
});
