'use strict';
jest.mock('../src/services/term.service', () => ({ getCurrentTerm: jest.fn().mockResolvedValue('synthetic-term') }));
const service = require('../src/services/checkin.service');

const params = { userId: 11, vehicleId: 'synthetic-vehicle', plateNo: 'synthetic-plate', studentId: 5 };

function poolWith({ morning = 1, evening = 1, leave = false } = {}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/FROM\s+students/.test(sql)) {
        return [[{ id: 5, cid_hash: 'h', first_name: 'Synthetic', last_name: 'Fixture',
          morning_enabled: morning, evening_enabled: evening }]];
      }
      if (/attendance_kind = 'SELF'/.test(sql)) return [[]];
      if (/FROM student_leaves/.test(sql)) return [leave ? [{ id: 1 }] : []];
      if (/SELECT id, status FROM checkin_logs/.test(sql)) return [[]];
      if (/INSERT INTO checkin_logs/.test(sql)) return [{ insertId: 900 }];
      if (/FROM\s+parent_student/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }),
  };
  return { conn, pool: { query: jest.fn().mockResolvedValue([[{ id: 1 }]]), getConnection: jest.fn().mockResolvedValue(conn) } };
}
const inserted = conn => conn.query.mock.calls.some(([sql]) => /INSERT INTO checkin_logs/.test(sql));

test('driver check-in is refused for a session the child is not enrolled in', async () => {
  const { pool, conn } = poolWith({ evening: 0 });
  await expect(service.processCheckin(pool, { ...params, session: 'evening' }))
    .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'NOT_RIDER' }] });
  expect(inserted(conn)).toBe(false);
});

test('driver check-in is refused for a child on approved leave', async () => {
  const { pool, conn } = poolWith({ leave: true });
  await expect(service.processCheckin(pool, { ...params, session: 'morning' }))
    .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ON_LEAVE' }] });
  expect(inserted(conn)).toBe(false);
});

test('driver check-in still succeeds for an enrolled child without leave', async () => {
  const { pool } = poolWith();
  const r = await service.processCheckin(pool, { ...params, session: 'morning' });
  expect(r.log_id).toBe(900);
});
