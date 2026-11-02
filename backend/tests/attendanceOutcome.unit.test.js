'use strict';

const { assertAttendanceKind, outcome, summarizeAttendance } = require('../src/utils/attendanceOutcome');

describe('session attendance accounting', () => {
  test('bus, self, leave and pending reconcile without counting non-riders as bus trips', () => {
    const summary = summarizeAttendance([
      { enabled: true, busDone: true },
      { enabled: true, kinds: ['SELF'] },
      { enabled: true, kinds: ['LEAVE'] },
      { enabled: true },
      { enabled: false },
    ]);
    expect(summary).toMatchObject({ BUS: 1, SELF: 1, LEAVE: 1, PENDING: 1,
      expected: 4, busExpected: 2, busPercent: 50 });
  });
  test('independent arrival and evening bus use are separate outcomes', () => {
    expect(outcome({ enabled: true, kinds: ['SELF'] })).toBe('SELF');
    expect(outcome({ enabled: true, busDone: true })).toBe('BUS');
  });
  test('conflicting bus and exception evidence is not silently treated as completed', () => {
    const summary = summarizeAttendance([{ enabled: true, busDone: true, kinds: ['SELF'] }]);
    expect(summary).toMatchObject({ CONFLICT: 1, BUS: 0, SELF: 0, busPercent: null });
    expect(outcome({ enabled: true, kinds: ['SELF', 'LEAVE'] })).toBe('CONFLICT');
  });
  test('all independent/leave sessions have no bus percentage, not 100 percent', () => {
    expect(summarizeAttendance([{ enabled: true, kinds: ['SELF'] },
      { enabled: true, kinds: ['LEAVE'] }])).toMatchObject({ busExpected: 0, busPercent: null });
  });
  test('reject untyped reason text and incorrect sessions', () => {
    expect(() => assertAttendanceKind('มาเอง', 'morning')).toThrow();
    expect(() => assertAttendanceKind('SELF', 'both')).toThrow();
    expect(() => assertAttendanceKind('SELF', 'morning')).not.toThrow();
    expect(() => outcome({ enabled: true, kinds: ['OTHER'] })).toThrow();
  });
});
