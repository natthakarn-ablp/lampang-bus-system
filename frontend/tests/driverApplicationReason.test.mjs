import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/pages/driver/DriverApplications.jsx', import.meta.url), 'utf8');

test('driver card shows the rejection/cancellation reason', () => {
  assert.match(src, /app\.cancel_reason/);
});

test('driver timeline shows review notes', () => {
  assert.match(src, /new_value\??\.review_notes/);
});

test('driver timeline translates the raw audit action to Thai', () => {
  assert.match(src, /auditActionTh\(t\.action\)/);
  assert.doesNotMatch(src, /— \{t\.action\}/);
});
