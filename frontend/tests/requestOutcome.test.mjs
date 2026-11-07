import test from 'node:test';
import assert from 'node:assert/strict';
import { isFailedOutcome } from '../src/utils/requestOutcome.js';

test('approve: APPLIED and ALREADY_APPLIED are success', () => {
  assert.equal(isFailedOutcome('approve', 'APPLIED'), false);
  assert.equal(isFailedOutcome('approve', 'ALREADY_APPLIED'), false);
});

test('approve: FAILED, STALE and no-longer-pending statuses are errors', () => {
  for (const s of ['FAILED', 'STALE_NEEDS_REVIEW', 'REJECTED', 'CANCELLED']) {
    assert.equal(isFailedOutcome('approve', s), true, s);
  }
});

test('reject: only REJECTED is success', () => {
  assert.equal(isFailedOutcome('reject', 'REJECTED'), false);
  assert.equal(isFailedOutcome('reject', 'APPLIED'), true);
});

test('missing status or unknown action keeps the success toast', () => {
  assert.equal(isFailedOutcome('approve', undefined), false);
  assert.equal(isFailedOutcome('other', 'FAILED'), false);
});
