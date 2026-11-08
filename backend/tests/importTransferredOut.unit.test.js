'use strict';

// SCH-STU-2 (school audit 2026-11-08): a pupil closed by an APPLIED transfer
// must not be revived by re-importing the old school's file (restore already
// refuses this, AUD-SCH-02).
const { classifyImportRow } = require('../src/utils/studentImportClassifier');

const ROW = { student_code: '101', first_name: 'ก', last_name: 'ข', grade: 'ป.1', plate_no: 'นข 1234 ลำปาง' };
const VEHICLE = { matched: true, vehicle_id: 'V-1', display_plate: 'นข 1234 ลำปาง' };

test('soft-deleted + transferred out → SKIP, never offered for reactivation', () => {
  const r = classifyImportRow({ row: ROW, schoolId: 'SCH1', existing: { id: 7, is_deleted: 1, transferred_out: 1 }, vehicle: VEHICLE });
  expect(r.classification).toBe('SKIP_TRANSFERRED_OUT');
  expect(r.status).toBe('SKIP');
  expect(r.can_apply).toBe(false);
});

test('soft-deleted without a transfer still asks to confirm reactivation (unchanged)', () => {
  const r = classifyImportRow({ row: ROW, schoolId: 'SCH1', existing: { id: 7, is_deleted: 1, transferred_out: 0 }, vehicle: VEHICLE });
  expect(r.classification).toBe('SOFT_DELETED_SAME_SCHOOL_REACTIVATE');
});

test('preview lookup and both apply paths check for an APPLIED transfer', () => {
  const fs = require('fs');
  const path = require('path');
  const svc = fs.readFileSync(path.join(__dirname, '../src/services/studentImportPreview.service.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/school.routes.js'), 'utf8');
  expect(svc).toMatch(/AS transferred_out/);
  expect(svc).toMatch(/applyReactivateRow[\s\S]*?status = 'APPLIED'[\s\S]*?markStale/);
  expect(routes).toMatch(/existing\.is_deleted && Number\(existing\.transferred_out\)/);
});
