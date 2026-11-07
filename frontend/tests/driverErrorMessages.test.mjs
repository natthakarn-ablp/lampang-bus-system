import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { driverErrorMessage } from '../src/utils/driverErrors.js';

const THAI = /[฀-๿]/;
const httpErr = (status, message) => ({ response: { status, data: { message } } });

test('driver-facing English backend messages are translated to Thai', () => {
  for (const m of [
    'Driver profile is not linked to this account',
    'Multiple open shifts found for this driver',
    'Multiple active vehicles assigned to this driver — please contact admin',
    'Student not found in this vehicle',
    'student_id and session are required',
    'detail is required',
  ]) {
    const out = driverErrorMessage(httpErr(409, m), 'สำรอง');
    assert.match(out, THAI, m);
    assert.notEqual(out, 'สำรอง', m);
  }
});

test('network error is reported as lost connection, not generic text', () => {
  assert.match(driverErrorMessage({}, 'เกิดข้อผิดพลาด'), /อินเทอร์เน็ต/);
});

test('driver pages route catch messages through driverErrorMessage', () => {
  const dir = new URL('../src/pages/driver/', import.meta.url);
  for (const f of ['DriverDashboard.jsx', 'CheckinPanel.jsx', 'EmergencyPage.jsx', 'StudentList.jsx']) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /err\.response\?\.data\?\.message \|\|/, f);
    assert.match(src, /driverErrorMessage/, f);
  }
});

test('dashboard refetches roster on 409 and only marks round ended when nothing failed', () => {
  const src = readFileSync(new URL('../src/pages/driver/DriverDashboard.jsx', import.meta.url), 'utf8');
  assert.match(src, /status === 409\) await fetchData\(\)/);
  assert.match(src, /if \(failed\.length === 0\) setCheckedOut\(true\)/);
});
