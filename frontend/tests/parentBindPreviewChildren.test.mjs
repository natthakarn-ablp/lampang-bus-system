import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// P-02 (parent audit 2026-11-08): the bind preview must show every child the
// phone binding will expose, and tell the parent what to do if one is not theirs.
const src = readFileSync(new URL('../src/pages/parent/ParentLink.jsx', import.meta.url), 'utf8');

test('preview keeps the children list returned by bind-preview', () => {
  assert.match(src, /setPreviewChildren\(/);
  assert.match(src, /data\?\.children/);
});

test('preview renders the full list with a count', () => {
  assert.match(src, /previewChildren\.map\(/);
  assert.match(src, /ทั้งหมด \{previewChildren\.length\} คน/);
});

test('preview tells the parent not to confirm if a child is not theirs', () => {
  assert.match(src, /ไม่ใช่บุตรหลานของท่าน/);
});
