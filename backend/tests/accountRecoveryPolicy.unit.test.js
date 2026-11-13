'use strict';

/**
 * Per-role account-recovery policy.
 *
 * The roadmap makes recovery mandatory for all six login roles and forbids
 * guessing the ownership logic each one needs. The property that keeps both
 * true at once: a role opens only when a human has recorded its decision gates
 * as confirmed AND an operator has set its flag. An env var alone must never
 * be enough, because an env var can be set without anyone deciding anything.
 */

const {
  LOGIN_ROLES,
  SCOPE_PRESERVED_COLUMNS,
  ROLE_POLICIES,
  PARENT_RECOVERY,
  recoveryStatusForRole,
  isRecoveryEnabledForRole,
  enabledRecoveryRoles,
  recoveryPolicySummary,
} = require('../src/config/accountRecoveryPolicy');

/** All flags on — the worst case an operator could produce by accident. */
const ALL_FLAGS_ON = Object.fromEntries(
  LOGIN_ROLES.map((r) => [ROLE_POLICIES[r].envFlag, 'true'])
);

describe('recovery scope', () => {
  it('covers every login role, so "all roles" cannot quietly shrink', () => {
    expect([...LOGIN_ROLES].sort()).toEqual(
      ['admin', 'affiliation', 'driver', 'province', 'school', 'transport']
    );
    for (const role of LOGIN_ROLES) {
      expect(ROLE_POLICIES[role]).toBeDefined();
      expect(ROLE_POLICIES[role].role).toBe(role);
      expect(typeof ROLE_POLICIES[role].envFlag).toBe('string');
      expect(ROLE_POLICIES[role].phase).toMatch(/Phase/);
    }
  });

  it('tracks parents separately, as link recovery rather than password recovery', () => {
    expect(PARENT_RECOVERY.mechanism).toBe('account_link_recovery');
    expect(PARENT_RECOVERY.envFlag).toBeNull();
    expect(PARENT_RECOVERY.gatesConfirmed).toBe(false);
    expect(PARENT_RECOVERY.note).toContain('ไม่มีรหัสผ่าน');
  });

  it('names the columns a reset must never touch', () => {
    // A reset that widened grade_scope or moved scope_id would be privilege
    // escalation dressed as a convenience feature.
    for (const col of ['role', 'scope_type', 'scope_id', 'grade_scope', 'driver_id']) {
      expect(SCOPE_PRESERVED_COLUMNS).toContain(col);
    }
  });
});

/** Roles whose gates a human has confirmed (school + driver: owner decision 2026-11-13). */
const CONFIRMED = ['admin', 'school', 'driver'];
const STILL_CLOSED = ['province', 'affiliation', 'transport'];

describe('decision gates outrank feature flags', () => {
  it('opens only the confirmed roles even with every flag on', () => {
    const enabled = enabledRecoveryRoles(ALL_FLAGS_ON);
    expect(enabled).toEqual(['admin', 'school', 'driver']);
  });

  it('reports unconfirmed gates as the blocker, not the flag', () => {
    for (const role of STILL_CLOSED) {
      const status = recoveryStatusForRole(role, ALL_FLAGS_ON);
      expect(status.enabled).toBe(false);
      expect(status.reason).toBe('decision_gates_unconfirmed');
    }
  });

  // Full matrix: every role × its own flag on/off × every other flag on/off.
  // A role opens iff its gates are confirmed AND its own flag is exactly
  // 'true'; no other role's flag can open it.
  describe.each(LOGIN_ROLES)('gate/flag matrix for %s', (role) => {
    const flag = ROLE_POLICIES[role].envFlag;
    const others = Object.fromEntries(
      LOGIN_ROLES.filter((r) => r !== role).map((r) => [ROLE_POLICIES[r].envFlag, 'true'])
    );
    it.each([
      ['own flag off, others off', {}, false],
      ['own flag off, others on', others, false],
      ['own flag on, others off', { [flag]: 'true' }, CONFIRMED.includes(role)],
      ['own flag on, others on', { ...others, [flag]: 'true' }, CONFIRMED.includes(role)],
    ])('%s', (_label, source, expected) => {
      expect(isRecoveryEnabledForRole(role, source)).toBe(expected);
      const { reason } = recoveryStatusForRole(role, source);
      if (expected) expect(reason).toBeNull();
      else if (!CONFIRMED.includes(role)) expect(reason).toBe('decision_gates_unconfirmed');
      else expect(reason).toBe('feature_flag_off');
    });
  });

  it('school and driver flags are independent of each other and of admin', () => {
    expect(enabledRecoveryRoles({ FEATURE_RECOVERY_SCHOOL: 'true' })).toEqual(['school']);
    expect(enabledRecoveryRoles({ FEATURE_RECOVERY_DRIVER: 'true' })).toEqual(['driver']);
    expect(enabledRecoveryRoles({ FEATURE_ADMIN_PASSWORD_RECOVERY: 'true' })).toEqual(['admin']);
  });

  it('requires the flag as well once gates are confirmed', () => {
    expect(recoveryStatusForRole('admin', {})).toEqual({
      enabled: false, reason: 'feature_flag_off',
    });
    expect(recoveryStatusForRole('admin', { FEATURE_ADMIN_PASSWORD_RECOVERY: 'true' }))
      .toEqual({ enabled: true, reason: null });
  });

  it('treats any value other than the exact string "true" as off', () => {
    for (const value of ['1', 'yes', 'TRUE', 'on', '', 'false']) {
      expect(isRecoveryEnabledForRole('admin', { FEATURE_ADMIN_PASSWORD_RECOVERY: value })).toBe(false);
    }
  });

  it('refuses roles that are not recoverable at all', () => {
    expect(recoveryStatusForRole('parent', ALL_FLAGS_ON).reason).toBe('role_not_recoverable');
    expect(recoveryStatusForRole('', ALL_FLAGS_ON).reason).toBe('role_not_recoverable');
    expect(recoveryStatusForRole(undefined, ALL_FLAGS_ON).reason).toBe('role_not_recoverable');
    // A role name that is not in the registry must not fall through to enabled.
    expect(isRecoveryEnabledForRole('superadmin', ALL_FLAGS_ON)).toBe(false);
  });

  it('returns an empty allowlist when nothing is enabled', () => {
    // With no roles enabled the shared endpoints must 404, which is the state
    // production is in today.
    expect(enabledRecoveryRoles({})).toEqual([]);
  });
});

describe('unconfirmed roles carry the decisions they are waiting on', () => {
  it('names at least one open gate per unconfirmed role', () => {
    for (const role of LOGIN_ROLES) {
      const policy = ROLE_POLICIES[role];
      if (policy.gatesConfirmed) continue;
      expect(policy.decisionGates.length).toBeGreaterThan(0);
      // A gate id that says nothing is a gate nobody can close.
      for (const gate of policy.decisionGates) expect(gate.length).toBeGreaterThan(10);
    }
  });

  it('keeps province, affiliation and transport undecided', () => {
    for (const role of STILL_CLOSED) {
      expect(ROLE_POLICIES[role].gatesConfirmed).toBe(false);
      expect(ROLE_POLICIES[role].identityModel).toBe('undecided');
    }
  });
});

describe('owner decision 2026-11-13: school, grade teachers and drivers', () => {
  it('records the driver decision: the account is the vehicle', () => {
    const p = ROLE_POLICIES.driver;
    expect(p.gatesConfirmed).toBe(true);
    expect(p.identityModel).toBe('vehicle_account');
    expect(p.decisionGates).toEqual([]);
    expect(Object.keys(p.decisionsRecorded).sort()).toEqual([
      'driver_change_of_vehicle_or_shift_handling',
      'driver_username_is_person_or_vehicle',
      'multi_shift_vehicle_requires_separate_accounts_or_school_approval',
    ]);
  });

  it('records the school decision: main account plus separately bound teachers', () => {
    const p = ROLE_POLICIES.school;
    expect(p.gatesConfirmed).toBe(true);
    expect(p.identityModel).toBe('school_main_account_and_personal_teacher_subaccounts');
    expect(p.decisionGates).toEqual([]);
    expect(Object.keys(p.decisionsRecorded).sort()).toEqual([
      'revocation_window_on_transfer',
      'school_main_account_ownership_evidence',
      'teacher_subaccount_binds_separately',
    ]);
    expect(p.extraControls).toContain('grade_scope');
  });

  it('cites the decision in every recorded gate', () => {
    for (const role of ['school', 'driver']) {
      for (const text of Object.values(ROLE_POLICIES[role].decisionsRecorded)) {
        expect(text).toContain('owner decision 2026-11-13');
      }
    }
  });

  it('every confirmed role either has no open gate or records why', () => {
    for (const role of CONFIRMED) {
      expect(ROLE_POLICIES[role].decisionGates).toEqual([]);
    }
    expect(ROLE_POLICIES.admin.identityModel).toBe('personal');
  });
});

describe('policy summary', () => {
  it('explains every role rather than only listing the open ones', () => {
    const summary = recoveryPolicySummary(ALL_FLAGS_ON);
    expect(Object.keys(summary.roles).sort()).toEqual([...LOGIN_ROLES].sort());
    for (const role of LOGIN_ROLES) {
      const row = summary.roles[role];
      expect(typeof row.enabled).toBe('boolean');
      if (!row.enabled) expect(row.blocked_reason).toBeTruthy();
      expect(row.phase).toBeTruthy();
    }
    expect(summary.enabled_roles).toEqual(['admin', 'school', 'driver']);
    expect(summary.roles.driver.decisions_recorded.length).toBe(3);
    expect(summary.roles.province.decisions_recorded).toEqual([]);
    expect(summary.parent.gates_confirmed).toBe(false);
  });

  it('leaks no flag values or secrets', () => {
    const json = JSON.stringify(recoveryPolicySummary(ALL_FLAGS_ON));
    expect(json).not.toMatch(/FEATURE_/);
    expect(json).not.toMatch(/secret|token|password_hash/i);
  });
});
