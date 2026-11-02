'use strict';
const { totals, decorateDaily, decorateMonthly } = require('../src/services/attendanceStatistics.service');
const event = (overrides = {}) => ({ student_id: 1, school_id: 'S1', vehicle_id: 'V1',
  affiliation_id: 'A1', check_date: '2026-11-01', session: 'morning', attendance_kind: 'SELF',
  morning_enabled: 1, evening_enabled: 1, morning_done: 0, evening_done: 0, ...overrides });
test('five days of independent arrival count five occurrences and one distinct pupil', () => {
  const rows = Array.from({ length: 5 }, (_, i) => event({ check_date: `2026-11-0${i + 1}` }));
  expect(totals(rows)).toMatchObject({ morning_self: 5, morning_self_people: 1, evening_self: 0, days: 5 });
});
test('both-session leave counts once in each session and duplicates are not counted twice', () => {
  const row = event({ attendance_kind: 'LEAVE', session: 'both' });
  expect(totals([row, row])).toMatchObject({ morning_leave: 1, evening_leave: 1, morning_leave_people: 1 });
});
test('bus/exception and conflicting exception evidence are surfaced separately', () => {
  expect(totals([event({ morning_done: 1 })])).toMatchObject({ morning_conflict: 1, morning_self: 0 });
  expect(totals([event(), event({ attendance_kind: 'LEAVE' })])).toMatchObject({ morning_conflict: 1, morning_self: 0, morning_leave: 0 });
});
test('MySQL UNION decimal strings do not turn morning zero into a bus/SELF conflict', () => {
  expect(totals([event({ morning_done: '0', evening_done: '1' })])).toMatchObject({ morning_self: 1, morning_conflict: 0 });
  expect(totals([event({ morning_done: '1' })])).toMatchObject({ morning_self: 0, morning_conflict: 1 });
  expect(totals([event({ morning_enabled: '0' })])).toMatchObject({ morning_self: 0 });
});
test('daily totals and school/vehicle denominators reconcile, preserving other rows', () => {
  const result = decorateDaily({ morning_total: 5, morning_done: 2, morning_pending: 3,
    schools: [{ school_id: 'S1', morning_expected: 5, morning_done: 2 }, { school_id: 'S2', morning_expected: 3 }],
    vehicles: [{ vehicle_id: 'V1', morning_expected: 5, morning_done: 2 }] },
  [event(), event({ student_id: 2, attendance_kind: 'LEAVE' }), event({ attendance_kind: 'BUS_DATE', student_id: null, morning_done: 2 })]);
  expect(result).toMatchObject({ morning_total: 3, morning_registered: 5, morning_pending: 1, morning_self: 1, morning_leave: 1 });
  expect(result.schools[0]).toMatchObject({ morning_expected: 3, morning_pending: 1 });
  expect(result.schools[1]).toMatchObject({ morning_expected: 3, morning_self: 0 });
  expect(result.vehicles[0].morning_expected).toBe(3);
  expect(decorateDaily(result, [event(), event({ student_id: 2, attendance_kind: 'LEAVE' }), event({ attendance_kind: 'BUS_DATE', student_id: null, morning_done: 2 })])).toEqual(result);
});
test('province affiliation rows use their existing id without dropping exception counts', () => {
  const result = decorateDaily({ affiliations: [{ id: 'A1', morning_expected: 2, morning_done: 1, morning_kpi: 50 }] }, [event(), event({ attendance_kind: 'BUS_DATE', student_id: null, morning_done: 1 })]);
  expect(result.affiliations[0]).toMatchObject({ morning_expected: 1, morning_self: 1, morning_registered: 2, morning_kpi: 100 });
});
test('month includes an exception-only date and separates trips from unique pupils', () => {
  const result = decorateMonthly({ morning_expected: 2, evening_expected: 2, total_morning_done: 1,
    daily_trend: [{ date: '2026-11-01', morning_done: 1, evening_done: 0 }], schools: [], vehicles: [] },
  [event({ attendance_kind: 'BUS_DATE', student_id: null, morning_done: 1 }), event({ check_date: '2026-11-02' })]);
  expect(result.days_with_data).toBe(2);
  expect(result.total_morning_expected).toBe(3);
  expect(result.daily_trend).toHaveLength(2);
  expect(result.daily_trend[1]).toMatchObject({ morning_self: 1, morning_expected: 1, morning_done: 0 });
});

test('same-snapshot classification cannot retain a stale bus count after cancellation and independent travel', () => {
  expect(decorateDaily({ morning_total: 1, morning_done: 1 }, [event()])).toMatchObject({ morning_done: 0, morning_self: 1, morning_total: 0, morning_pending: 0 });
  expect(decorateDaily({ morning_total: 1, morning_done: 0 }, [event({ attendance_kind: 'BUS_DATE', morning_done: 1 })])).toMatchObject({ morning_done: 1, morning_self: 0, morning_pending: 0 });
});
