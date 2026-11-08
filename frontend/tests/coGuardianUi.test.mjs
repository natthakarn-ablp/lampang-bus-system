import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// M2 co-guardians (parent audit 2026-11-08).
const status = readFileSync(new URL('../src/pages/parent/ParentStatus.jsx', import.meta.url), 'utf8');
const link = readFileSync(new URL('../src/pages/parent/ParentLink.jsx', import.meta.url), 'utf8');

test('guardian section only when the backend says the feature is on', () => {
  assert.match(status, /meta\?\.co_guardian_enabled === true/);
  assert.match(status, /view === 'list' && coEnabled && guardians && guardians\.role !== 'none'/);
});

test('primary can invite and remove; co-guardian can leave', () => {
  assert.match(status, /\/api\/parent\/guardians\/invite/);
  assert.match(status, /\/api\/parent\/guardians\/\$\{id\}\/remove/);
  assert.match(status, /\/api\/parent\/guardians\/leave/);
  assert.match(status, /guardians\.co_guardians\.length < guardians\.max/);
});

test('bind page lets an invited person redeem the code with the LIFF token', () => {
  assert.match(link, /\{bindConfig\.co_guardian_enabled && \(/);
  assert.match(link, /\/api\/parent\/guardians\/accept', \{ code: inviteCode\.trim\(\) \}, \{\s*headers: \{ Authorization: `Bearer \$\{idToken\}` \}/);
});
