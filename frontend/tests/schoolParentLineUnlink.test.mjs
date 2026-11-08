import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// P-04 write part (parent audit 2026-11-08, owner-approved): a full school
// account can cut a parent's LINE binding with a reason; teachers cannot.
const src = readFileSync(new URL('../src/pages/school/StudentSearch.jsx', import.meta.url), 'utf8');

test('unlink action is offered only to full school accounts on linked rows', () => {
  assert.match(src, /!isTeacher && s2\.parent_line_linked && \(/);
  assert.match(src, /ตัดการผูก LINE/);
});

test('unlink posts a reason to the school endpoint', () => {
  assert.match(src, /\/parent-line\/unlink`, \{ reason: unlinkReason\.trim\(\) \}/);
});
