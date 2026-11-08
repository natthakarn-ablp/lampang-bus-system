'use strict';

// SCH-STU-7 (school audit 2026-11-08, owner-approved): when a pupil changes
// vehicle, leaves, is transferred, graduates or an import is rolled back, the
// pickup-point assignment on the OLD vehicle is removed.
const fs = require('fs');
const path = require('path');
const { clearStalePickupAssignments } = require('../src/services/pickupCleanup.service');

test('deletes only assignments whose point is not on the pupil\'s current vehicle', async () => {
  const db = { query: jest.fn().mockResolvedValue([{ affectedRows: 2 }]) };
  expect(await clearStalePickupAssignments(db, [7, '8', 'x', -1])).toBe(2);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toMatch(/DELETE spp FROM student_pickup_points spp/);
  expect(sql).toMatch(/s\.is_deleted = TRUE OR s\.vehicle_id IS NULL OR s\.vehicle_id <> pp\.vehicle_id/);
  expect(params).toEqual([[7, 8]]);
});

test('no valid ids → no query', async () => {
  const db = { query: jest.fn() };
  expect(await clearStalePickupAssignments(db, [])).toBe(0);
  expect(db.query).not.toHaveBeenCalled();
});

test('every place that changes a pupil\'s vehicle or removes the pupil calls the cleanup', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../src', p), 'utf8');
  const count = (src) => (src.match(/clearStalePickupAssignments\(/g) || []).length;
  expect(count(read('routes/school.routes.js'))).toBeGreaterThanOrEqual(3);          // move, delete, legacy import reactivate
  expect(count(read('services/rosterRequest.service.js'))).toBeGreaterThanOrEqual(2); // add-existing, remove
  expect(count(read('services/studentTransfer.service.js'))).toBeGreaterThanOrEqual(1);
  expect(count(read('services/schoolPromotion.service.js'))).toBeGreaterThanOrEqual(1);
  expect(count(read('services/studentImportPreview.service.js'))).toBeGreaterThanOrEqual(2); // reactivate, rollback
});
