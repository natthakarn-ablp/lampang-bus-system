'use strict';

/**
 * LINE login must return the user to the page they started from.
 *
 * Reported by the system owner on 2026-09-07, the day admin password recovery
 * was switched on: as an admin they could not press "ผูกบัญชี LINE", and the
 * confirmation below it took them to the PARENT binding page instead.
 *
 * Both symptoms are one defect. frontend/src/utils/liff.js called
 * `liff.login()` with no arguments, so LIFF returns the user to the LIFF app's
 * Endpoint URL. That endpoint sits under /parent/link for this project — see
 * the launcher-defence routes at frontend/src/App.jsx (/parent/link/link and
 * /link both redirect to /parent/link) and the admin page mounted beneath it
 * at /parent/link/admin-recovery. An admin who pressed "ยืนยัน LINE" was thus
 * sent to LINE and dropped back onto the parent page, never returning with an
 * id token; and AdminAccountSecurity.jsx keeps the bind button disabled while
 * that token is empty, so the button could never become clickable.
 *
 * There is no frontend test runner in this repository (handoff §5), so this
 * guards the two source facts that together make the flow work.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('liff.login returns to the current page', () => {
  const src = read('frontend/src/utils/liff.js');

  it('passes a redirectUri', () => {
    expect(src).toMatch(/liff\.login\(\s*\{[^}]*redirectUri/);
  });

  it('never calls login with no arguments', () => {
    expect(src).not.toMatch(/liff\.login\(\s*\)/);
  });

  it('redirects to the page the user is on, which is always under the endpoint path', () => {
    expect(src).toMatch(/redirectUri:\s*window\.location\.href/);
  });
});

describe('the admin recovery page stays reachable through the LIFF endpoint', () => {
  const app = read('frontend/src/App.jsx');
  const nav = read('frontend/src/components/TopNavbar.jsx');

  it('is routed under /parent/link so the LIFF endpoint covers it', () => {
    expect(app).toContain('/parent/link/admin-recovery');
  });

  it('is admin-only', () => {
    const idx = app.indexOf('/parent/link/admin-recovery');
    expect(idx).toBeGreaterThan(-1);
    // The PrivateRoute wrapping this route restricts it to admin.
    expect(app.slice(idx, idx + 200)).toMatch(/allowedRoles=\{\['admin'\]\}/);
  });

  it('is what the account menu opens', () => {
    expect(nav).toContain("navigate('/parent/link/admin-recovery')");
  });
});

describe('the bind button depends on a token, so the redirect is what unblocks it', () => {
  const page = read('frontend/src/pages/admin/AdminAccountSecurity.jsx');

  it('disables binding until an id token exists', () => {
    expect(page).toMatch(/disabled=\{Boolean\(busy\) \|\| !lineIdToken\}/);
  });

  it('obtains that token through the LIFF helper', () => {
    expect(page).toMatch(/getLiffIdToken/);
    expect(page).toMatch(/resolveLineUserId/);
  });
});
