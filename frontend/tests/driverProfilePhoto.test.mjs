import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DRV-T03: /uploads is blocked, so the page must not use photo_url as <img src>.
const src = readFileSync(new URL('../src/pages/driver/DriverProfile.jsx', import.meta.url), 'utf8');

test('driver photo is fetched through the authenticated API, not /uploads', () => {
  assert.match(src, /api\.get\('\/driver\/profile\/photo'/);
  assert.match(src, /responseType:\s*'blob'/);
  assert.doesNotMatch(src, /<img src=\{profile\.photo_url\}/);
});
