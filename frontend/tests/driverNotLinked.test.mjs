import test from 'node:test';
import assert from 'node:assert/strict';
import { isDriverNotLinked } from '../src/utils/driverErrors.js';

const err = (status, code, message = '') => ({
  response: { status, data: { message, errors: code ? [{ code }] : undefined } },
});

test('403 NO_ACTIVE_ASSIGNMENT is treated as not linked (no dead-end pretrip modal)', () => {
  assert.equal(isDriverNotLinked(err(403, 'NO_ACTIVE_ASSIGNMENT', 'บัญชีคนขับนี้ไม่มีรถที่ได้รับมอบหมายในขณะนี้')), true);
});

test('409 DRIVER_PROFILE_NOT_LINKED is treated as not linked', () => {
  assert.equal(isDriverNotLinked(err(409, 'DRIVER_PROFILE_NOT_LINKED', 'Driver profile is not linked to this account')), true);
});

test('legacy message-based detection still works', () => {
  assert.equal(isDriverNotLinked(err(400, null, 'Vehicle not found for this driver account')), true);
});

test('unrelated errors keep the pretrip gate', () => {
  assert.equal(isDriverNotLinked(err(403, 'SOMETHING_ELSE', 'forbidden')), false);
  assert.equal(isDriverNotLinked(err(500, null, 'boom')), false);
  assert.equal(isDriverNotLinked({}), false);
});
