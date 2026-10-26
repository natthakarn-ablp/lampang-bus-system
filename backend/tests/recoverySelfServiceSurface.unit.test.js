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
 * What is deliberately NOT done here: no role's decision gates are flipped.
 * backend/src/config/accountRecoveryPolicy.js still has gatesConfirmed false
 * for province, affiliation and transport, so those roles reach the page and
 * are told recovery is not open for them yet. Opening a role is a separate,
 * recorded decision — the policy file says so itself, and the questions are in
 * docs/project-closure/decision-2026-09-07-recovery-roles-questions.md.
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
  it('is routed for the four roles that can hold a binding', () => {
    const i = app.indexOf('/parent/link/admin-recovery');
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 300)).toMatch(/allowedRoles=\{\['admin', 'province', 'affiliation', 'transport'\]\}/);
  });

  it('the account menu offers it to the same four', () => {
    expect(nav).toMatch(/const RECOVERY_ROLES = \['admin', 'province', 'affiliation', 'transport'\]/);
    expect(nav).toMatch(/\{canBindRecovery && \(/);
  });

  it('drivers and schools are not among them', () => {
    const block = nav.match(/const RECOVERY_ROLES[^;]+;/)[0];
    expect(block).not.toContain("'driver'");
    expect(block).not.toContain("'school'");
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

  it('the three new roles are still closed pending their decisions', () => {
    for (const role of ['province', 'affiliation', 'transport']) {
      const i = policy.indexOf(`role: '${role}',`);
      expect(i).toBeGreaterThan(-1);
      const block = policy.slice(i, i + 900);
      expect(block).toMatch(/gatesConfirmed: false/);
      expect(block).toMatch(/decisionGates: \[/);
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
});
