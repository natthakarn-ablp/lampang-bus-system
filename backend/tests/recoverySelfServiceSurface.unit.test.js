'use strict';

/**
 * The account-security page now serves every role that may hold a LINE
 * binding, and the server still decides who that is.
 *
 * Background. The owner's problem on 2026-09-07 was that every forgotten
 * password reached the single admin. Two answers were approved: the province
 * can now reset affiliation and transport accounts, and those same three
 * roles are to gain LINE self-service recovery like the admin already has.
 *
 * The mechanism was already built for all six login roles — /api/auth/recovery
 * /self/* takes any role the policy allows — but the only page that could bind
 * a LINE account was routed to admins and called the /admin/* twin. This is
 * the change that makes one page serve them all.
 *
 * Opening a role is a separate, recorded decision in
 * backend/src/config/accountRecoveryPolicy.js. School and driver were opened
 * by owner decision 2026-11-13, then province, affiliation and transport (unit
 * accounts) by a second owner decision the same day; each still needs its own
 * flag, and the menu entry shows only while that flag is on.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const page = read('frontend/src/pages/admin/AdminAccountSecurity.jsx');
const app = read('frontend/src/App.jsx');
const nav = read('frontend/src/components/TopNavbar.jsx');
const route = read('backend/src/routes/adminPasswordRecovery.routes.js');
const policy = read('backend/src/config/accountRecoveryPolicy.js');

describe('the page talks to the shared endpoints', () => {
  it.each(['status', 'link-line', 'regenerate-codes'])('uses /self/%s', (endpoint) => {
    expect(page).toContain(`/auth/recovery/self/${endpoint}`);
  });

  it('unbinds through /self/line', () => {
    expect(page).toContain("api.delete('/auth/recovery/self/line'");
  });

  it('no longer calls the admin-only twin', () => {
    const calls = [...page.matchAll(/api\.(?:get|post|delete)\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]);
    expect(calls.some((c) => c.startsWith('/auth/recovery/self/'))).toBe(true);
    expect(calls.some((c) => c.startsWith('/auth/recovery/admin/'))).toBe(false);
  });

  it('those endpoints accept any policy-enabled role, not only admin', () => {
    expect(route).toMatch(/const selfServiceGate = \[requireFeature, authenticate, requireRecoveryRole\]/);
    expect(route).toMatch(/router\.get\('\/self\/status', \.\.\.selfServiceGate/);
    expect(route).toMatch(/const adminGate = \[requireFeature, authenticate, requireRole\('admin'\), requireRecoveryRole\]/);
  });
});

describe('who may open the page', () => {
  // Owner decision 2026-11-13 added school (main account + grade teachers)
  // and driver; before that this test pinned them OUT.
  it('is routed for all six login roles', () => {
    const i = app.indexOf('/parent/link/admin-recovery');
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 300)).toMatch(
      /allowedRoles=\{\['admin', 'province', 'affiliation', 'transport', 'school', 'driver'\]\}/
    );
  });

  it('the account menu lists the same six', () => {
    expect(nav).toMatch(/const RECOVERY_ROLES = \['admin', 'province', 'affiliation', 'transport', 'school', 'driver'\]/);
    expect(nav).toMatch(/\{canBindRecovery && \(/);
  });

  it('but shows it to each role only while its own flag is on', () => {
    const helper = read('frontend/src/utils/passwordRecovery.js');
    expect(nav).toMatch(/canBindRecoveryFor\(user, features\)/);
    expect(helper).toMatch(/admin: 'adminPasswordRecovery'/);
    expect(helper).toMatch(/school: 'recoverySchool'/);
    expect(helper).toMatch(/driver: 'recoveryDriver'/);
    expect(helper).toMatch(/province: 'recoveryProvince'/);
    expect(helper).toMatch(/affiliation: 'recoveryAffiliation'/);
    expect(helper).toMatch(/transport: 'recoveryTransport'/);
    expect(helper).toMatch(/return Boolean\(features\?\.\[flag\]\)/);
    // No role is shown the entry unconditionally any more.
    expect(helper).toMatch(/if \(!flag\) return false;/);
    expect(helper).not.toMatch(/\['province', 'affiliation', 'transport'\]\.includes\(role\)/);
  });

  it('every feature key the menu reads is one the server sends at login', () => {
    const helper = read('frontend/src/utils/passwordRecovery.js');
    const envJs = read('backend/src/config/env.js');
    const block = helper.match(/RECOVERY_FEATURE_BY_ROLE = Object\.freeze\(\{([\s\S]*?)\}\)/)[1];
    const keys = [...block.matchAll(/:\s*'(\w+)'/g)].map((m) => m[1]);
    expect(keys).toHaveLength(6);
    for (const key of keys) expect(envJs).toMatch(new RegExp(`\\b${key}: process\\.env\\.`));
  });

  it('the driver profile links to it behind the driver flag', () => {
    const profile = read('frontend/src/pages/driver/DriverProfile.jsx');
    expect(profile).toMatch(/features\?\.recoveryDriver && \(/);
    expect(profile).toContain('to="/parent/link/admin-recovery"');
  });
});

describe('the login page offers LINE recovery to every open role', () => {
  const login = read('frontend/src/pages/Login.jsx');
  const forgot = read('frontend/src/pages/ForgotPassword.jsx');
  const helper = read('frontend/src/utils/passwordRecovery.js');

  it('reads the open roles from the policy, not only the admin key', () => {
    expect(login).toMatch(/enabledRecoveryRolesFromConfig\(res\.data\.data\)/);
    expect(forgot).toMatch(/enabledRecoveryRolesFromConfig\(res\.data\.data\)/);
    expect(helper).toMatch(/policy\.enabled_roles/);
  });

  it('labels the link as LINE recovery for any role', () => {
    expect(login).toContain('ลืมรหัสผ่าน (กู้ผ่าน LINE)');
    expect(login).not.toContain('ผู้ดูแลระบบ: รีเซ็ตผ่าน LINE');
  });

  it('names who can actually reset each closed role', () => {
    // Each contact matches a real reset route on this code base.
    const contact = (key) => helper.match(new RegExp(`key: '${key}'[^}]+contact: '([^']+)'`))[1];
    expect(contact('school')).toContain('สังกัด');
    expect(contact('teacher')).toContain('บัญชีหลักของโรงเรียน');
    // 2026-11-13 (PR #178): schools that use the vehicle can reset its driver.
    expect(contact('driver')).toContain('โรงเรียน');
    expect(contact('affiliation')).toContain('จังหวัด');
    expect(contact('transport')).toContain('จังหวัด');
    expect(contact('province')).toContain('ผู้ดูแลระบบ');
    // Each unit row is tied to its own policy role, so Login shows the LINE
    // option for it only while that role is open.
    const recoveryRole = (key) => helper.match(new RegExp(`key: '${key}'[^}]+recoveryRole: '([^']+)'`))[1];
    expect(recoveryRole('affiliation')).toBe('affiliation');
    expect(recoveryRole('transport')).toBe('transport');
    expect(recoveryRole('province')).toBe('province');
    // The old Login text (pre-recovery) is gone.
    expect(login).not.toContain('โรงเรียนและคนขับ: ติดต่อผู้ดูแลบัญชีของโรงเรียน');
  });
});

describe('the server, not the page, decides whether recovery is open', () => {
  it('the page asks the policy endpoint for its own role', () => {
    expect(page).toMatch(/api\.get\('\/auth\/recovery\/config'\)/);
    expect(page).toMatch(/policy\?\.roles/);
    expect(page).toMatch(/roles\[user\.role\]/);
  });

  it('waits for that answer instead of guessing', () => {
    expect(page).toMatch(/if \(roleEnabled === null\) return;/);
    expect(page).toMatch(/roleEnabled === false/);
  });

  it('a role needs both its flag and its confirmed gates', () => {
    expect(policy).toMatch(/if \(!policy\.gatesConfirmed\) return \{ enabled: false, reason: 'decision_gates_unconfirmed' \}/);
    expect(policy).toMatch(/if \(source\[policy\.envFlag\] !== 'true'\) return \{ enabled: false, reason: 'feature_flag_off' \}/);
  });

  it('province, affiliation and transport are confirmed by owner decision 2026-11-13', () => {
    for (const role of ['province', 'affiliation', 'transport']) {
      const i = policy.indexOf(`role: '${role}',`);
      expect(i).toBeGreaterThan(-1);
      const j = policy.indexOf('requiresApproverRole', i);
      const block = policy.slice(i, j);
      expect(block).toMatch(/gatesConfirmed: true/);
      expect(block).toMatch(/decisionGates: \[\]/);
      expect(block).toContain('owner decision 2026-11-13');
    }
  });

  it('the account page has its own wording for each unit role', () => {
    for (const [role, home] of [['province', '/province'], ['affiliation', '/affiliation'], ['transport', '/transport']]) {
      expect(page).toMatch(new RegExp(`${role}: \\{[\\s\\S]*?to: '${home}'`));
    }
  });
});

describe('messages that stop being true when more roles can bind', () => {
  it('a taken LINE account is not described as an administrator\'s', () => {
    expect(route).not.toContain('ถูกผูกกับผู้ดูแลระบบบัญชีอื่นแล้ว');
    expect(route).toContain('ถูกผูกกับบัญชีผู้ใช้อื่นแล้ว');
  });
});

describe('one authority for reading recovery flags', () => {
  it('is exported, so nothing outside this file has to rebuild it', () => {
    expect(route).toMatch(/module\.exports\.recoveryEnvSource = recoveryEnvSource;/);
  });

  it('overlays the live admin flag on the environment', () => {
    expect(route).toMatch(/FEATURE_ADMIN_PASSWORD_RECOVERY: env\.features\.adminPasswordRecovery \? 'true' : 'false'/);
  });

  it('overlays the unit-account flags the same way', () => {
    expect(route).toMatch(/FEATURE_RECOVERY_PROVINCE: env\.features\.recoveryProvince \? 'true' : 'false'/);
    expect(route).toMatch(/FEATURE_RECOVERY_AFFILIATION: env\.features\.recoveryAffiliation \? 'true' : 'false'/);
    expect(route).toMatch(/FEATURE_RECOVERY_TRANSPORT: env\.features\.recoveryTransport \? 'true' : 'false'/);
  });
});
