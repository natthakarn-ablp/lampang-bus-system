import test from 'node:test';
import assert from 'node:assert/strict';
import { filterIncidentRows, incidentDateError, incidentErrorMessage, incidentPhase } from '../src/utils/transportIncidentView.js';

test('dates are validated as calendar days, including leap years and exact30day limits', () => {
  const check = value => incidentDateError(value, '2026-10-21', '2026-09-21');
  assert.equal(check('2026-10-21'), '');
  assert.equal(check('2026-09-21'), '');
  for (const value of ['', '2026-10-22', '2026-09-20', '2026-02-30', '2026-10-21T00:00:00Z']) assert.ok(check(value));
  assert.equal(incidentDateError('2024-02-29', '2024-03-01', '2024-02-01'), '');
  assert.ok(incidentDateError('2025-02-29', '2025-03-01', '2025-02-01'));
});

test('name/school search is partial, trims spaces, and preserves full supplied names', () => {
  const rows = [{ id: 1, name: 'เด็กหญิงชื่อจำลองยาวสำหรับตรวจสอบการแสดงชื่อเต็ม', school_name: 'โรงเรียนจำลองลำปาง' },
    { id: 2, name: 'Synthetic Child', school_name: null, parent_phone: 'HIDDEN_CONTACT' }];
  assert.deepEqual(filterIncidentRows(rows, '  จำลองลำปาง '), [rows[0]]);
  assert.deepEqual(filterIncidentRows(rows, 'CHILD'), [rows[1]]);
  assert.deepEqual(filterIncidentRows(rows, 'HIDDEN_CONTACT'), []);
  assert.deepEqual(filterIncidentRows(rows, ''), rows);
  assert.deepEqual(filterIncidentRows(rows, 'ไม่ตรงคำค้น'), []);
});

for (const currentKey of ['vehicleB:2026-10-21:morning:0', 'vehicleA:2026-10-20:morning:0', 'vehicleA:2026-10-21:evening:0', 'vehicleA:2026-10-21:morning:1']) {
  test(`a ready/error response from a prior selection cannot render under ${currentKey}`, () => {
    for (const phase of ['ready', 'error']) assert.equal(incidentPhase({ key: 'vehicleA:2026-10-21:morning:0', phase }, currentKey), 'loading');
  });
}

test('only matching requests expose ready and error state', () => {
  for (const phase of ['loading', 'ready', 'error']) assert.equal(incidentPhase({ key: 'exact', phase }, 'exact'), phase);
});

test('server and network failures are not falsely described as lack of permission', () => {
  assert.match(incidentErrorMessage(403), /ไม่มีสิทธิ์/);
  assert.match(incidentErrorMessage(404), /ไม่พบรถ/);
  assert.match(incidentErrorMessage(400), /วันที่หรือรอบรถ/);
  for (const code of [500, undefined]) assert.match(incidentErrorMessage(code), /การเชื่อมต่อ/);
});
