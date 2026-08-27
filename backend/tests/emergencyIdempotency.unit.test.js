'use strict';

/**
 * emergencyIdempotency.unit.test.js  (#6 — emergency double-tap protection)
 *
 * createEmergencyReport() is idempotent within a short window: a second
 * identical report from the same driver returns the FIRST row and does NOT
 * INSERT again, so the route skips the duplicate LINE push + audit. Before this
 * service each POST /api/driver/emergency inserted unconditionally.
 *
 * DB-free: fake injected pool, in the transport.service.js style. Runs under
 * jest.unit.config.js. (An end-to-end double-tap proof against the real route +
 * DB lives in the integration suite — it can't run on the prod box.)
 */

const { createEmergencyReport, DEFAULT_DEDUPE_WINDOW_SECONDS } = require('../src/services/emergency.service');

function mockDb({ dup = null } = {}) {
  const query = jest.fn(async (sql) => {
    if (/SELECT id, vehicle_id, plate_no\s+FROM emergency_logs/.test(sql)) return [dup ? [dup] : []];
    if (/INSERT INTO emergency_logs/.test(sql)) return [{ insertId: 4242 }];
    return [[]];
  });
  return { db: { query }, query };
}
const insertCalls = (query) => query.mock.calls.filter(([sql]) => /INSERT INTO emergency_logs/.test(sql));
const dedupeCall = (query) => query.mock.calls.find(([sql]) => /FROM emergency_logs\s+WHERE reported_by/.test(sql));

const base = { reportedBy: 7, vehicleId: 'V-1', plateNo: 'นข 2210 ลำปาง', detail: 'อุบัติเหตุ' };

describe('createEmergencyReport — idempotency', () => {
  test('first report inserts and returns a fresh id', async () => {
    const { db, query } = mockDb({ dup: null });
    const out = await createEmergencyReport(base, db);
    expect(out).toMatchObject({ id: 4242, isDuplicate: false, vehicleId: 'V-1' });
    expect(insertCalls(query)).toHaveLength(1);
  });

  test('a matching recent report is treated as a DUPLICATE — no second INSERT', async () => {
    const { db, query } = mockDb({ dup: { id: 99, vehicle_id: 'V-1', plate_no: 'นข 2210 ลำปาง' } });
    const out = await createEmergencyReport(base, db);
    expect(out).toEqual({ id: 99, vehicleId: 'V-1', plateNo: 'นข 2210 ลำปาง', isDuplicate: true });
    expect(insertCalls(query)).toHaveLength(0); // the whole point: no duplicate row
  });

  test('dedupe query is NULL-safe when the driver has no resolved vehicle', async () => {
    const { db, query } = mockDb({ dup: null });
    await createEmergencyReport({ ...base, vehicleId: null }, db);
    const [sql, params] = dedupeCall(query);
    expect(sql).toMatch(/vehicle_id IS NULL/);
    expect(sql).not.toMatch(/vehicle_id = \?/);
    // params: reportedBy, detail, windowSeconds  (no vehicleId slot)
    expect(params).toEqual([7, 'อุบัติเหตุ', DEFAULT_DEDUPE_WINDOW_SECONDS]);
  });

  test('dedupe query binds the vehicle id + window when a vehicle is known', async () => {
    const { db, query } = mockDb({ dup: null });
    await createEmergencyReport({ ...base, dedupeWindowSeconds: 30 }, db);
    const [sql, params] = dedupeCall(query);
    expect(sql).toMatch(/vehicle_id = \?/);
    expect(params).toEqual([7, 'อุบัติเหตุ', 'V-1', 30]);
  });

  test('missing detail → 400 and no query is issued', async () => {
    const { db, query } = mockDb();
    await expect(createEmergencyReport({ reportedBy: 7 }, db))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'DETAIL_REQUIRED' }] });
    expect(query).not.toHaveBeenCalled();
  });

  test('missing reportedBy → 400', async () => {
    const { db } = mockDb();
    await expect(createEmergencyReport({ detail: 'x' }, db)).rejects.toMatchObject({ statusCode: 400 });
  });
});
