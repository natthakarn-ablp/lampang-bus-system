import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// P-04 (parent audit 2026-11-08): the school pupil list shows whether the
// parent has linked LINE.
const src = readFileSync(new URL('../src/pages/school/StudentSearch.jsx', import.meta.url), 'utf8');

test('parent column shows the LINE link status', () => {
  assert.match(src, /s2\.parent_line_linked/);
  assert.match(src, /ผูก LINE แล้ว/);
  assert.match(src, /ยังไม่ผูก LINE/);
});
