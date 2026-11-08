'use strict';

// P-04 (parent audit 2026-11-08): the school pupil list carries a yes/no
// "parent has linked LINE" flag (active binding on the parent phone) and
// never the LINE user id.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/database');
const schoolSvc = require('../src/services/school.service');

// These assert the plain line_bindings SQL, i.e. FEATURE_CO_GUARDIAN off. Pin
// it: the production server's .env turns it on and the deploy runs the unit
// suite there (the co-guardian path has its own tests).
const pinnedEnv = require('../src/config/env');
beforeEach(() => {
  pinnedEnv.features.coGuardian = false;
  pool.query.mockReset();
  pool.query.mockImplementation(async (sql) => {
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 2 }]];
    return [[
      { id: 1, first_name: 'ก', parent_phone: '0811111111', parent_line_linked: 1 },
      { id: 2, first_name: 'ข', parent_phone: '0822222222', parent_line_linked: 0 },
    ]];
  });
});

test('list query checks an ACTIVE binding on the parent phone', async () => {
  await schoolSvc.getStudents('SCH0001', {});
  const dataSql = pool.query.mock.calls.map(c => c[0]).find(sql => /parent_line_linked/.test(sql));
  expect(dataSql).toMatch(/FROM line_bindings lb\s+WHERE lb\.phone = p\.phone AND lb\.is_active = TRUE/);
  expect(dataSql).not.toMatch(/line_user_id/);
});

test('flag is a boolean for full school and grade-scoped teacher alike', async () => {
  const full = await schoolSvc.getStudents('SCH0001', {});
  expect(full.students.map(s => s.parent_line_linked)).toEqual([true, false]);
  const teacher = await schoolSvc.getStudents('SCH0001', { gradeFilter: ['ป.1'] });
  expect(teacher.students.map(s => s.parent_line_linked)).toEqual([true, false]);
  expect(teacher.students[0].parent_phone).toBeUndefined();
});

// OPS-001 review: the same list with FEATURE_CO_GUARDIAN on — the badge must
// also count co-guardians (union source), still never return a LINE id, and the
// flag set here must not leak (beforeEach pins it off again).
describe('with FEATURE_CO_GUARDIAN on', () => {
  beforeEach(() => { pinnedEnv.features.coGuardian = true; });
  afterAll(() => { pinnedEnv.features.coGuardian = false; });

  test('the linked badge reads primary bindings AND co-guardians, active only', async () => {
    await schoolSvc.getStudents('SCH0001', {});
    const dataSql = pool.query.mock.calls.map(c => c[0]).find(sql => /parent_line_linked/.test(sql));
    expect(dataSql).toMatch(/FROM line_bindings UNION ALL SELECT phone, line_user_id, is_active, bound_at FROM line_co_guardians\) lb\s+WHERE lb\.phone = p\.phone AND lb\.is_active = TRUE/);
  });
});

test('the flag set in the block above did not leak into later tests', () => {
  expect(pinnedEnv.features.coGuardian).toBe(false);
});
