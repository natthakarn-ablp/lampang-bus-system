import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// UX gaps after PRs #177–#179: the pending bell must be reachable on phones,
// the school bell shows LINE-recovery binding alerts, and the registration
// assignment panel shows the roster's เช้า/เย็น marker.
const nav = readFileSync(new URL('../src/components/TopNavbar.jsx', import.meta.url), 'utf8');
const review = readFileSync(new URL('../src/pages/school/SchoolRegistrationReview.jsx', import.meta.url), 'utf8');

test('the approver bell is not hidden below the sm breakpoint', () => {
  const btn = nav.match(/onClick=\{\(\) => setBellOpen\(o => !o\)\}\s*className="([^"]+)"/);
  assert.ok(btn, 'approver bell button found');
  assert.doesNotMatch(btn[1], /(^|\s)hidden(\s|$)/);
  assert.match(btn[1], /inline-flex/);
  // Dropdowns never overflow a 360px phone.
  assert.equal((nav.match(/max-w-\[calc\(100vw-1\.5rem\)\]/g) || []).length, 2);
});

test('the school bell lists recovery_alerts and counts the unseen ones', () => {
  assert.match(nav, /summary\?\.recovery_alerts/);
  assert.match(nav, /\(summary\?\.total \|\| 0\) \+ recoveryUnseen/);
  assert.match(nav, /การผูก LINE กู้รหัสผ่าน/);
  assert.match(nav, /LINE_RECOVERY_UNLINKED/);
  // Seen-marker reads/writes are guarded (private mode, blocked storage).
  assert.match(nav, /try \{ return Number\(localStorage\.getItem\(key\)\) \|\| 0; \} catch/);
});

test('the assignment panel shows the roster marker and pre-picks session-only changes', () => {
  assert.equal((review.match(/const PICKUP_LABEL =/g) || []).length, 1);
  assert.match(review, /\{PICKUP_LABEL\[s\.pickup_type\]\}/);
  assert.match(review, /s\.state === 'ON_THIS_VEHICLE' && s\.sessions_pending/);
});
