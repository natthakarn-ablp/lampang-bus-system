'use strict';

/**
 * Live QA round 2, parent-01 / parent-02 (2026-11-07).
 *
 * parent-01: opening the bind link (/parent/link) in Chrome or Facebook called
 * liff.login unconditionally, which jumps to LINE's email/password page with
 * no explanation. The parent pages must instead show the app's own Thai
 * "open in LINE" screen. The admin LINE-verification flow must keep logging
 * in from a desktop browser.
 *
 * parent-02: /parent outside LINE said "ยังไม่ได้ผูกบัญชี LINE" even to linked
 * parents.
 *
 * There is no frontend test runner in this repository, so this guards the
 * source facts that make the flow work (same approach as
 * liffLoginRedirect.unit.test.js).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('liff helper can skip login outside the LINE client', () => {
  const src = read('frontend/src/utils/liff.js');

  it('resolveLineUserId takes loginOutsideLine, defaulting to true', () => {
    expect(src).toMatch(/export async function resolveLineUserId\(\{\s*loginOutsideLine\s*=\s*true\s*\}\s*=\s*\{\}\)/);
  });

  it('returns before liff.login when outside LINE and the caller opted out', () => {
    const skip = src.indexOf('!loginOutsideLine && !safeIsInClient(liff)');
    const login = src.indexOf('liff.login({ redirectUri: window.location.href });');
    expect(skip).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(skip);
  });

  it('isOutsideLineClient is false when LIFF is not configured', () => {
    expect(src).toMatch(/export function isOutsideLineClient\(\)\s*\{\s*if \(!LIFF_ID \|\| !_liffReady \|\| !_liffModule\) return false;/);
  });

  it('builds the LINE launch URL from the LIFF id', () => {
    expect(src).toContain('`https://liff.line.me/${LIFF_ID}${subPath}`');
  });
});

describe('parent pages show the open-in-LINE screen', () => {
  const link = read('frontend/src/pages/parent/ParentLink.jsx');
  const status = read('frontend/src/pages/parent/ParentStatus.jsx');
  const card = read('frontend/src/components/parent/OpenInLineCard.jsx');

  it('bind page does not trigger LINE login outside LINE', () => {
    expect(link).toContain('resolveLineUserId({ loginOutsideLine: false })');
    expect(link).toMatch(/if \(!idToken && outsideLine\)[\s\S]{0,40}<OpenInLineCard subPath="\/link"/);
  });

  it('status page checks outside-LINE before the unlinked card', () => {
    const outside = status.indexOf('!loading && !idToken && outsideLine');
    const unlinked = status.indexOf('ยังไม่ได้ผูกบัญชี LINE');
    expect(outside).toBeGreaterThan(-1);
    expect(unlinked).toBeGreaterThan(outside);
  });

  it('card offers an open-in-LINE button and a tappable OA link in Thai', () => {
    expect(card).toContain('เปิดในแอป LINE');
    expect(card).toContain('href={getLiffLaunchUrl(subPath)}');
    expect(card).toContain('href={LINE_OA_URL}');
  });

  it('admin verification keeps the default (login allowed outside LINE)', () => {
    const admin = read('frontend/src/pages/admin/AdminAccountSecurity.jsx');
    expect(admin).not.toMatch(/loginOutsideLine:\s*false/);
  });
});
