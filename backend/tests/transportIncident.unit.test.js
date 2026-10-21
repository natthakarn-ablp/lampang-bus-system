'use strict';

const { validateSelection, getIncidentVehicle } = require('../src/services/transportIncident.service');
const { todayBangkok } = require('../src/utils/thaiTime');
const selection = { vehicleId: 'V-unit21', date: '2026-10-21', session: 'morning' };

test.each(['2026-02-30', '2026-10-21T00:00:00Z', ['2026-10-21'], '', null])('reject malformed date %p', date => {
  expect(() => validateSelection({ ...selection, date }, '2026-10-21')).toThrow();
});
test('allow Bangkok today and exactly 30 previous days only', () => {
  expect(() => validateSelection(selection, '2026-10-21')).not.toThrow();
  expect(() => validateSelection({ ...selection, date: '2026-09-21' }, '2026-10-21')).not.toThrow();
  for (const date of ['2026-09-20', '2026-10-22']) {
    expect(() => validateSelection({ ...selection, date }, '2026-10-21')).toThrow();
  }
});
test.each(['both', ['morning'], 'evening;DROP TABLE students'])('reject unsupported session %p', session => {
  expect(() => validateSelection({ ...selection, session }, selection.date)).toThrow();
});
test.each(['V-1 OR 1=1', '../1', 'a'.repeat(21)])('reject malformed vehicle %s', vehicleId => {
  expect(() => validateSelection({ ...selection, vehicleId }, selection.date)).toThrow();
});
test.each(['school', 'driver', 'affiliation', 'province', undefined])('service denies role %s before SQL', async role => {
  const db = { query: jest.fn() };
  await expect(getIncidentVehicle({ ...selection, role }, db)).rejects.toMatchObject({ statusCode: 403 });
  expect(db.query).not.toHaveBeenCalled();
});

test('minimizes fields and preserves cancelled event rather than infer occupancy', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce([[{ id: 'V-unit21', plate_no: 'รถจำลอง', owner_phone: 'SECRET' }]])
    .mockResolvedValueOnce([[{ id: 1, prefix: 'เด็กชาย', first_name: 'จำลอง', last_name: 'ทดสอบ', school_name: 'โรงเรียนจำลอง', cid_hash: 'SECRET', dropoff_address: 'SECRET' }]])
    .mockResolvedValueOnce([[{ student_id: 1, label: 'จุดจำลอง' }]])
    .mockResolvedValueOnce([[{ id: 10, student_id: 1, student_name: 'จำลอง', status: 'CHECKED_IN', school_name: 'โรงเรียนจำลอง' },
      { id: 11, student_id: 1, student_name: 'จำลอง', status: 'CANCELLED' }]]) };
  const result = await getIncidentVehicle({ ...selection, date: todayBangkok(), role: 'transport' }, db);
  expect(result.current_roster).toHaveLength(1);
  expect(result.current_roster[0].pickup_points).toEqual(['จุดจำลอง']);
  expect(result.recorded_events.map(row => row.status)).toEqual(['CHECKED_IN', 'CANCELLED']);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(result).not.toHaveProperty('on_board');
  expect(db.query.mock.calls[3][1]).toEqual(['V-unit21', todayBangkok(), 'morning']);
});

test('missing/deleted vehicle returns 404 before reading pupil data', async () => {
  const db = { query: jest.fn().mockResolvedValue([[]]) };
  await expect(getIncidentVehicle({ ...selection, date: todayBangkok(), role: 'transport' }, db)).rejects.toMatchObject({ statusCode: 404 });
  expect(db.query).toHaveBeenCalledTimes(1);
});
