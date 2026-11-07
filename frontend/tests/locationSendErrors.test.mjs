import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldDiscardBatch } from '../src/utils/locationSendErrors.js';

const err = (status, data = {}) => ({ response: { status, data } });

test('recoverable 4xx batch answers keep the queued route history', () => {
  assert.equal(shouldDiscardBatch(err(404, { message: 'ไม่พบรถที่ลงทะเบียน', errors: [] })), false);
  assert.equal(shouldDiscardBatch(err(403, { errors: [{ code: 'NO_ACTIVE_ASSIGNMENT' }] })), false);
  assert.equal(shouldDiscardBatch(err(400, { message: 'ไม่พบการมอบหมายคนขับสำหรับรถคันนี้', errors: [] })), false);
});

test('only a malformed points payload is discarded', () => {
  assert.equal(shouldDiscardBatch(err(400, { errors: [{ field: 'points' }] })), true);
});

test('flushQueue does not drop the batch for every non-retryable error', () => {
  const src = readFileSync(new URL('../src/components/LiveLocationToggle.jsx', import.meta.url), 'utf8');
  assert.match(src, /shouldDiscardBatch\(err\)/);
  assert.doesNotMatch(src, /if \(!isRetryable\(err\)\) \{\s*try \{\s*const batch/);
});
