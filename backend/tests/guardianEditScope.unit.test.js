'use strict';

// SCH-STU-4 (school audit 2026-11-08): editing a pupil's guardian replaces only
// that guardian's link. It must read the APPROVED link and must not delete the
// child's other guardian links.
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const mockStatements = [];
function mockHandle(sql, params) {
  mockStatements.push([sql, params]);
  if (/FROM students s\s+LEFT JOIN parent_student ps/.test(sql)) {
    return [[{ id: 101, first_name: 'ก', last_name: 'ข', grade: 'ป.1', parent_name: 'แม่', parent_phone: '0811111111' }]];
  }
  if (/FROM\s+parent_student ps\s+JOIN\s+parents p/.test(sql)) {
    // Approved guardian 5; a revoked guardian 4 would sort first without the filter.
    return [/ps\.approved = TRUE/.test(sql) ? [{ parent_id: 5, current_name: 'แม่', current_phone: '0811111111' }]
      : [{ parent_id: 4, current_name: 'เก่า', current_phone: '0800000000' }]];
  }
  if (/INSERT INTO parents/.test(sql)) return [{ insertId: 9 }];
  if (/^\s*SELECT/i.test(sql)) return [[{ id: 101, grade: 'ป.1' }]];
  return [{ affectedRows: 1 }];
}
jest.mock('../src/config/database', () => {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => mockHandle(sql, params),
  };
  return { pool: { query: async (sql, params) => mockHandle(sql, params), getConnection: async () => conn } };
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

test('phone change replaces only the approved guardian link that was edited', async () => {
  mockUser = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: null };
  const res = await request(app).put('/api/school/students/101').send({ parent_phone: '0822222222' });
  expect(res.status).toBe(200);
  const del = mockStatements.find(([sql]) => /DELETE FROM parent_student/.test(sql));
  expect(del[0]).toMatch(/WHERE student_id = \? AND parent_id = \?/);
  expect(del[1]).toEqual([101, 5]);
  const profile = mockStatements.find(([sql]) => /FROM students s\s+LEFT JOIN parent_student ps/.test(sql));
  expect(profile[0]).toMatch(/ps\.approved = TRUE/);
});
