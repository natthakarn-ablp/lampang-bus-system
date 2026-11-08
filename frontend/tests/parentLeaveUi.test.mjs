import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// M1 parent leave via LINE (parent audit 2026-11-08, owner-approved).
const src = readFileSync(new URL('../src/pages/parent/ParentStatus.jsx', import.meta.url), 'utf8');

test('leave button only when the backend says the feature is on', () => {
  assert.match(src, /meta\?\.parent_leave_enabled === true/);
  assert.match(src, /\{leaveEnabled && \(/);
});

test('leave form posts to the parent leave endpoint with the LIFF token header', () => {
  assert.match(src, /\/api\/parent\/children\/\$\{selectedChild\.id\}\/leaves`, leaveForm, \{\s*headers: \{ Authorization: `Bearer \$\{idToken\}` \}/);
});

test('cancel is offered only where the server allows it', () => {
  assert.match(src, /\{l\.can_cancel && \(/);
  assert.match(src, /\/api\/parent\/leaves\/\$\{leaveId\}\/cancel/);
});

test('rules and Thai labels are shown', () => {
  assert.match(src, /leaveRules\.morning_cutoff/);
  assert.match(src, /แจ้งลา \/ ไม่ขึ้นรถ/);
});
