'use strict';

// SCH-VEH-5 (school audit 2026-11-08): a school must not overturn a document
// decision made by transport or admin.
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const docSvc = require('../src/services/driverDocuments.service');

function makePool({ status = 'APPROVED', reviewedBy = 3, priorRole = 'transport' } = {}) {
  const calls = [];
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (/FROM vehicle_documents WHERE id = \?/.test(sql)) {
        return [[{ id: 1, review_status: status, doc_type: 'insurance', uploaded_by: 9, reviewed_by: reviewedBy }]];
      }
      if (/SELECT role FROM users/.test(sql)) return [[{ role: priorRole }]];
      return [{ affectedRows: 1 }];
    }),
  };
  return { pool: { getConnection: async () => conn }, calls };
}
const updated = (calls) => calls.some(([sql]) => /UPDATE vehicle_documents/.test(sql));

test('school cannot overturn a transport decision (409, nothing written)', async () => {
  const { pool, calls } = makePool();
  await expect(docSvc.reviewDocument(pool, { kind: 'vehicle', id: 1, decision: 'REJECTED', note: 'x', reviewerUserId: 5, reviewerRole: 'school' }))
    .rejects.toMatchObject({ statusCode: 409 });
  expect(updated(calls)).toBe(false);
});

test('school can still review a pending document', async () => {
  const { pool, calls } = makePool({ status: 'PENDING', reviewedBy: null });
  await docSvc.reviewDocument(pool, { kind: 'vehicle', id: 1, decision: 'APPROVED', reviewerUserId: 5, reviewerRole: 'school' });
  expect(updated(calls)).toBe(true);
});

test('school can revise a decision another school account made', async () => {
  const { pool, calls } = makePool({ priorRole: 'school' });
  await docSvc.reviewDocument(pool, { kind: 'vehicle', id: 1, decision: 'APPROVED', reviewerUserId: 5, reviewerRole: 'school' });
  expect(updated(calls)).toBe(true);
});

test('transport may still change any decision', async () => {
  const { pool, calls } = makePool();
  await docSvc.reviewDocument(pool, { kind: 'vehicle', id: 1, decision: 'REJECTED', note: 'x', reviewerUserId: 3 });
  expect(updated(calls)).toBe(true);
});
