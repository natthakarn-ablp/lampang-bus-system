'use strict';

/**
 * The province can reset an affiliation or transport password — and nothing
 * else.
 *
 * The owner's problem, 2026-09-07: schools forget their passwords constantly
 * and affiliations sometimes do, and every reset landed on the single admin.
 * Two of the three levels were already covered — an affiliation resets the
 * schools in its own area (affiliationAdmin.service.js resetSchoolPassword) and
 * a school resets its own teacher sub-accounts — but province.routes.js had no
 * write endpoint at all, so an affiliation that forgot its password had nobody
 * but the admin. This closes that gap.
 *
 * What must stay true, and is what this suite guards:
 *  - only affiliation and transport accounts are reachable. A province may not
 *    reset an admin (a climb), another province (sideways), a school (that
 *    belongs to the school's own affiliation) or a driver (belongs to the
 *    school);
 *  - a reset writes password columns only. Touching role, scope_type,
 *    scope_id, grade_scope, driver_id or is_active would be a privilege change
 *    dressed as a convenience — see SCOPE_PRESERVED_COLUMNS in
 *    backend/src/config/accountRecoveryPolicy.js;
 *  - the new password goes through the shared policy, the holder is forced to
 *    change it at next login, and password_changed_at is set so sessions and
 *    refresh tokens issued before the reset stop working at once;
 *  - the action is audited.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const service = read('backend/src/services/provinceAdmin.service.js');
const route = read('backend/src/routes/province.routes.js');
const policy = read('backend/src/config/accountRecoveryPolicy.js');

describe('who a province may act on', () => {
  it('manages affiliation and transport only', () => {
    expect(service).toMatch(/const MANAGED_ROLES = Object\.freeze\(\['affiliation', 'transport'\]\)/);
  });

  it('filters by that list when listing and when resetting', () => {
    const uses = service.match(/role IN \(\?\)/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(service).toMatch(/WHERE u\.role IN \(\?\) AND u\.is_deleted = FALSE/);
    expect(service).toMatch(/WHERE id = \? AND role IN \(\?\) AND is_deleted = FALSE/);
  });

  it('says so plainly when the target is out of reach', () => {
    expect(service).toContain('รีเซ็ตได้เฉพาะบัญชีสังกัดและขนส่ง');
    expect(service).toMatch(/err\.statusCode = 404/);
  });

  it('never names admin, province, school or driver as reachable', () => {
    const block = service.match(/const MANAGED_ROLES[^;]+;/)[0];
    for (const role of ['admin', 'province', 'school', 'driver']) {
      expect(block).not.toContain(`'${role}'`);
    }
  });
});

describe('what a reset changes, and what it must not', () => {
  const update = service.match(/UPDATE users[\s\S]*?WHERE id = \?/)[0];

  it('writes the password columns only', () => {
    expect(update).toMatch(/SET password_hash = \?, must_change_password = TRUE, password_changed_at = NOW\(\)/);
  });

  it.each(['role', 'scope_type', 'scope_id', 'grade_scope', 'driver_id', 'is_active'])(
    'leaves %s alone', (column) => {
      expect(update).not.toMatch(new RegExp(`${column}\\s*=`));
    });

  it('those are the columns the policy calls scope-preserved', () => {
    expect(policy).toMatch(/SCOPE_PRESERVED_COLUMNS = Object\.freeze\(\[\s*'role', 'scope_type', 'scope_id', 'grade_scope', 'driver_id', 'is_active',/);
  });

  it('applies the shared password policy against the target username', () => {
    expect(service).toMatch(/validatePassword\(newPassword, \{ username: account\.username \}\)/);
  });

  it('hashes at the same cost as the other reset paths', () => {
    expect(service).toMatch(/const BCRYPT_COST = 12/);
    expect(read('backend/src/services/affiliationAdmin.service.js')).toMatch(/bcrypt\.hash\(newPassword, 12\)/);
  });

  it('audits the reset with who did it and to which kind of account', () => {
    expect(service).toMatch(/logAudit\(\{/);
    expect(service).toMatch(/action: 'password_reset'/);
    expect(service).toMatch(/by_role: 'province'/);
    expect(service).toMatch(/target_role: account\.role/);
    // `username` is the key the other audit writers use for the account acted
    // on, so a search for one account finds this row too.
    expect(service).toMatch(/username: account\.username/);
  });

  it('selects no password material when listing', () => {
    const start = service.indexOf('async function listManagedAccounts');
    const end = service.indexOf('async function resetUnitAccountPassword');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const list = service.slice(start, end);
    // must_change_password is a flag the page shows, not a secret; the hash is
    // the thing that must never leave the database.
    expect(list).not.toMatch(/password_hash/);
    expect(list).toMatch(/must_change_password/);
  });
});

describe('the endpoints', () => {
  it('sit behind the province router guard', () => {
    expect(route).toMatch(/router\.use\(authenticate, requireRole\('province', 'admin'\)\)/);
  });

  it('offer a list and a reset', () => {
    expect(route).toMatch(/router\.get\('\/unit-accounts'/);
    expect(route).toMatch(/router\.post\('\/unit-accounts\/:id\/reset-password'/);
  });

  it('validate the path id and require a password', () => {
    expect(route).toMatch(/readIdParam\(req, res, 'id'\)/);
    expect(route).toContain('password จำเป็น');
  });

  it('pass the caller and their address through for the audit trail', () => {
    expect(route).toMatch(/userId: req\.user\.id/);
    expect(route).toMatch(/ip: req\.ip/);
  });
});

describe('the page a province officer uses', () => {
  const page = read('frontend/src/pages/province/ProvUnitAccounts.jsx');

  it('calls the province endpoints, not the admin ones', () => {
    expect(page).toMatch(/api\.get\('\/province\/unit-accounts'\)/);
    expect(page).toMatch(/api\.post\(`\/province\/unit-accounts\/\$\{resetTarget\.id\}\/reset-password`/);
    // Every api call this page makes must be a /province/ one. Matching on the
    // whole file would also catch a path merely named in a comment.
    const calls = [...page.matchAll(/api\.(?:get|post|put|delete)\(\s*[`'"]([^`'"]+)/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const path of calls) expect(path.startsWith('/province/')).toBe(true);
  });

  it('asks for the password twice and refuses a short one, as the sibling page does', () => {
    expect(page).toMatch(/resetForm\.password\.length < 8 \|\| resetForm\.password !== resetForm\.confirm/);
  });

  it('says who resets whom, so nobody comes to the wrong desk', () => {
    expect(page).toContain('บัญชีโรงเรียนให้สังกัดของโรงเรียนนั้นเป็นผู้รีเซ็ต');
    expect(page).toContain('บัญชีครูประจำสายชั้นให้โรงเรียนเป็นผู้รีเซ็ต');
  });

  it('names the account in the dialog even when display_name is null', () => {
    // affiliation_name is always null for a transport row (the LEFT JOIN is
    // guarded by role = 'affiliation'), and display_name is nullable, so the
    // dialog needs the same three-step fallback the table cell has.
    expect(page).toMatch(/resetTarget\?\.display_name \|\| resetTarget\?\.affiliation_name \|\| resetTarget\?\.username/);
  });

  it('is routed and reachable from the province menu', () => {
    expect(read('frontend/src/App.jsx')).toMatch(/<Route path="unit-accounts" element=\{<ProvUnitAccounts \/>\} \/>/);
    expect(read('frontend/src/components/Sidebar.jsx')).toMatch(/to: '\/province\/unit-accounts'/);
  });
});
