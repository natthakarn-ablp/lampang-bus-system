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

describe('decision gates outrank feature flags', () => {
  it('keeps every role but admin closed even with every flag on', () => {
    const enabled = enabledRecoveryRoles(ALL_FLAGS_ON);
    expect(enabled).toEqual(['admin']);
  });

  it('reports unconfirmed gates as the blocker, not the flag', () => {
    for (const role of LOGIN_ROLES) {
      if (role === 'admin') continue;
      const status = recoveryStatusForRole(role, ALL_FLAGS_ON);
      expect(status.enabled).toBe(false);
      expect(status.reason).toBe('decision_gates_unconfirmed');
    }
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

  it('records the unresolved driver identity conflict', () => {
    // Login is by plate number, but a LINE account is a person: one driver
    // resetting a plate-shared account would lock out the other shift.
    const gates = ROLE_POLICIES.driver.decisionGates;
    expect(gates).toContain('driver_username_is_person_or_vehicle');
    expect(ROLE_POLICIES.driver.identityModel).toBe('undecided');
    expect(ROLE_POLICIES.driver.requiresApproverRole).toBe('school');
  });

  it('marks admin as the only role with a settled identity model', () => {
    expect(ROLE_POLICIES.admin.identityModel).toBe('personal');
    expect(ROLE_POLICIES.admin.decisionGates).toEqual([]);
    for (const role of LOGIN_ROLES) {
      if (role === 'admin') continue;
      expect(ROLE_POLICIES[role].identityModel).toBe('undecided');
    }
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
    expect(summary.enabled_roles).toEqual(['admin']);
    expect(summary.parent.gates_confirmed).toBe(false);
  });

  it('leaks no flag values or secrets', () => {
    const json = JSON.stringify(recoveryPolicySummary(ALL_FLAGS_ON));
    expect(json).not.toMatch(/FEATURE_/);
    expect(json).not.toMatch(/secret|token|password_hash/i);
  });
});
