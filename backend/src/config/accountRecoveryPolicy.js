'use strict';

/**
 * Per-role account-recovery policy.
 *
 * `docs/password-recovery-all-roles-roadmap.md` makes recovery for all six
 * login roles (plus parent LINE re-linking) mandatory scope, but it also
 * forbids guessing the business logic each role needs: whether a username is a
 * person or a shared unit account, who may bind or re-bind LINE for a shared
 * account, and what happens at handover. Those are owner decisions.
 *
 * So this file separates the two things that kept getting conflated:
 *
 *   - the MECHANISM, which is identical for every role and already built, and
 *   - the DECISION, which differs per role and belongs to a human.
 *
 * A role becomes reachable only when BOTH its environment flag is on AND its
 * decision gates are recorded as confirmed here. Flipping `gatesConfirmed`
 * requires editing this file, which means it lands in a diff next to the
 * signed decision that justifies it — an env var alone can never open a role.
 *
 * `admin`, `school` (main account and grade-teacher sub-accounts) and `driver`
 * have confirmed gates — school and driver by owner decision 2026-11-13 — and
 * each still needs its flag. `province`, `affiliation` and `transport` stay
 * closed on unconfirmed gates.
 */

/** Roles that authenticate with a password in `users`. */
const LOGIN_ROLES = Object.freeze(['admin', 'province', 'affiliation', 'school', 'transport', 'driver']);

/**
 * Columns a password reset must never touch. A reset that silently widened a
 * teacher's grade scope or moved an account to another school would be a
 * privilege escalation dressed as a convenience feature.
 */
const SCOPE_PRESERVED_COLUMNS = Object.freeze([
  'role', 'scope_type', 'scope_id', 'grade_scope', 'driver_id', 'is_active',
]);

const ROLE_POLICIES = Object.freeze({
  admin: {
    role: 'admin',
    // Kept as the original variable name: production already sets it, and
    // renaming a live flag is a deployment hazard for no benefit.
    envFlag: 'FEATURE_ADMIN_PASSWORD_RECOVERY',
    phase: 'Phase 1-2 — technical pilot',
    identityModel: 'personal',
    extraControls: 'ต้องมี admin/operator สำรอง และช่องทาง manual reset เมื่อ LINE ใช้ไม่ได้',
    decisionGates: [],
    // No open gates: the admin flow is a personal account with a documented
    // backup path. Whether to actually enable it stays with the env flag, and
    // UAT with a real admin is still required before turning it on.
    gatesConfirmed: true,
    requiresApproverRole: null,
  },
  province: {
    role: 'province',
    envFlag: 'FEATURE_RECOVERY_PROVINCE',
    phase: 'Phase 3 — unit accounts',
    identityModel: 'undecided',
    extraControls: 'ต้องมีหนังสือ/รายการมอบหมายและขั้นตอนส่งมอบบัญชี',
    decisionGates: [
      'province_account_is_personal_or_shared',
      'province_line_binding_authority',
      'province_handover_procedure',
    ],
    gatesConfirmed: false,
    requiresApproverRole: 'admin',
  },
  affiliation: {
    role: 'affiliation',
    envFlag: 'FEATURE_RECOVERY_AFFILIATION',
    phase: 'Phase 3 — unit accounts',
    identityModel: 'undecided',
    extraControls: 'จำกัดตาม affiliation_id และแจ้งจังหวัดเมื่อเปลี่ยนผู้ถือบัญชี',
    decisionGates: [
      'affiliation_account_is_personal_or_shared',
      'affiliation_line_binding_authority',
      'affiliation_handover_notifies_province',
    ],
    gatesConfirmed: false,
    requiresApproverRole: 'province',
  },
  transport: {
    role: 'transport',
    envFlag: 'FEATURE_RECOVERY_TRANSPORT',
    phase: 'Phase 3 — unit accounts',
    identityModel: 'undecided',
    extraControls: 'ต้องมีขั้นตอนส่งมอบบัญชีหน่วยงาน',
    decisionGates: [
      'transport_account_is_personal_or_shared',
      'transport_line_binding_authority',
      'transport_handover_procedure',
    ],
    gatesConfirmed: false,
    requiresApproverRole: 'admin',
  },
  // ── school + grade-teacher sub-accounts: owner decision 2026-11-13 ──────────
  //
  // One flag covers both kinds of `role = 'school'` account: the school's main
  // account and the grade-teacher sub-accounts (users.grade_scope set).
  // Recovery is always keyed by the `users` row, so the two never share a
  // binding: a binding is created only for req.user.id while that user is
  // signed in, /request resolves by the exact username, and one LINE identity
  // can hold only one account (UNIQUE provider, provider_subject — migration
  // 049). A teacher therefore cannot recover the main account, nor the main
  // account a teacher's, and a reset changes only password columns, never the
  // SCOPE_PRESERVED_COLUMNS above (school_id lives in scope_id).
  school: {
    role: 'school',
    envFlag: 'FEATURE_RECOVERY_SCHOOL',
    phase: 'Phase 4 — school and teacher sub-accounts',
    identityModel: 'school_main_account_and_personal_teacher_subaccounts',
    extraControls: 'บัญชีหลักผูก LINE ของผู้ถือบัญชีหลัก; บัญชีย่อยครูผูก LINE รายบุคคลและคง school_id/grade_scope เดิม; เมื่อเปลี่ยนผู้รับผิดชอบ โรงเรียนรีเซ็ตรหัสผ่านบัญชีครู (สังกัดรีเซ็ตบัญชีหลัก) ซึ่งยกเลิกการผูก LINE เดิมทันที หรือผู้ถือบัญชียกเลิกการผูกเอง',
    // All three gates closed by owner decision 2026-11-13.
    decisionGates: [],
    decisionsRecorded: {
      school_main_account_ownership_evidence:
        'owner decision 2026-11-13: ผู้ที่เข้าสู่ระบบบัญชีหลักด้วยรหัสผ่านปัจจุบันแล้วผูก LINE ของตนคือผู้ถือบัญชีหลัก (สังกัดเป็นผู้สร้าง/รีเซ็ตบัญชีหลัก)',
      teacher_subaccount_binds_separately:
        'owner decision 2026-11-13: ครูแต่ละคนผูก LINE กับบัญชีย่อยของตนเอง แยกจากบัญชีหลัก',
      // Revocation is immediate rather than a window: every password reset
      // performed by someone else releases the binding
      // (backend/src/utils/recoveryBinding.js).
      revocation_window_on_transfer:
        'owner decision 2026-11-13: เมื่อโอนย้ายหรือเปลี่ยนผู้รับผิดชอบ โรงเรียนรีเซ็ตรหัสผ่านบัญชีครู (สังกัดรีเซ็ตบัญชีหลัก) ซึ่งยกเลิกการผูก LINE เดิมทันที หรือผู้ถือบัญชียกเลิกการผูก LINE',
    },
    gatesConfirmed: true,
    requiresApproverRole: null,
  },
  // ── driver: owner decision 2026-11-13 ──────────────────────────────────────
  //
  // The driver account IS the vehicle account (username = plate). The owner
  // accepts that whoever has the LINE bound to that account can recover it; on
  // a vehicle shared between shifts that is whoever bound it while signed in.
  driver: {
    role: 'driver',
    envFlag: 'FEATURE_RECOVERY_DRIVER',
    phase: 'Phase 5 — drivers',
    identityModel: 'vehicle_account',
    extraControls: 'บัญชีคนขับคือบัญชีของรถ (ชื่อผู้ใช้ = ทะเบียนรถ) ผู้ที่มี LINE ที่ผูกกับบัญชีรถกู้รหัสผ่านได้; เมื่อเปลี่ยนคนขับ รีเซ็ตรหัสผ่านบัญชีรถ ซึ่งยกเลิกการผูก LINE เดิมทันที หรือผู้ถือบัญชียกเลิกการผูกเอง',
    decisionGates: [],
    decisionsRecorded: {
      driver_username_is_person_or_vehicle:
        'owner decision 2026-11-13: บัญชีคนขับผูกกับรถ (username = ทะเบียนรถ) ไม่ใช่บุคคล',
      multi_shift_vehicle_requires_separate_accounts_or_school_approval:
        'owner decision 2026-11-13: ยอมรับว่าผู้ที่มี LINE ที่ผูกกับบัญชีรถกู้บัญชีนั้นได้ ไม่ต้องแยกบัญชีหรือรออนุมัติ',
      // On this code base the server path that resets a driver password for
      // someone else is admin.routes.js POST /users/:id/reset-password; it
      // releases the binding through utils/recoveryBinding.js, and any future
      // school-side driver reset must call the same helper.
      driver_change_of_vehicle_or_shift_handling:
        'owner decision 2026-11-13: เมื่อเปลี่ยนคนขับ รีเซ็ตรหัสผ่านบัญชีรถ (ยกเลิกการผูก LINE เดิมทันที) หรือผู้ถือบัญชียกเลิกการผูก LINE',
    },
    gatesConfirmed: true,
    requiresApproverRole: null,
  },
});

/**
 * Parents have no password and no `users` row, so their continuity problem is
 * re-binding LINE, not recovering a password. It is tracked here so "all
 * roles" cannot quietly mean "all roles that happen to have a password".
 */
const PARENT_RECOVERY = Object.freeze({
  role: 'parent',
  mechanism: 'account_link_recovery',
  envFlag: null,
  phase: 'Phase 6 — parent LINE continuity',
  extraControls: 'โรงเรียนตรวจความสัมพันธ์กับนักเรียนและป้องกันการผูกซ้ำ',
  decisionGates: [
    'parent_rebind_verification_owner',
    'parent_duplicate_binding_prevention',
    'parent_unbind_audit_requirements',
  ],
  gatesConfirmed: false,
  note: 'ห้ามเรียกกระบวนการนี้ว่า "ลืมรหัสผ่าน" — ผู้ปกครองไม่มีรหัสผ่านในระบบ',
});

/**
 * Whether recovery is reachable for a role right now.
 *
 * @returns {{ enabled: boolean, reason: string|null }} `reason` names the first
 *   blocker so an operator gets a diagnosis instead of a silent 404.
 */
function recoveryStatusForRole(role, source = process.env) {
  const policy = ROLE_POLICIES[role];
  if (!policy) return { enabled: false, reason: 'role_not_recoverable' };
  if (!policy.gatesConfirmed) return { enabled: false, reason: 'decision_gates_unconfirmed' };
  if (source[policy.envFlag] !== 'true') return { enabled: false, reason: 'feature_flag_off' };
  return { enabled: true, reason: null };
}

function isRecoveryEnabledForRole(role, source = process.env) {
  return recoveryStatusForRole(role, source).enabled;
}

/**
 * The roles a recovery request may currently resolve to. An empty list means
 * the whole feature is off, and callers must behave exactly as they did before
 * recovery existed.
 */
function enabledRecoveryRoles(source = process.env) {
  return LOGIN_ROLES.filter((role) => isRecoveryEnabledForRole(role, source));
}

/** Per-role status for the config endpoint and for operator diagnostics. */
function recoveryPolicySummary(source = process.env) {
  const roles = {};
  for (const role of LOGIN_ROLES) {
    const policy = ROLE_POLICIES[role];
    const status = recoveryStatusForRole(role, source);
    roles[role] = {
      enabled: status.enabled,
      blocked_reason: status.reason,
      phase: policy.phase,
      identity_model: policy.identityModel,
      decision_gates: policy.decisionGates,
      decisions_recorded: Object.keys(policy.decisionsRecorded || {}),
      gates_confirmed: policy.gatesConfirmed,
      requires_approver_role: policy.requiresApproverRole,
    };
  }
  return {
    schema_version: '1.0',
    roles,
    parent: {
      mechanism: PARENT_RECOVERY.mechanism,
      phase: PARENT_RECOVERY.phase,
      decision_gates: PARENT_RECOVERY.decisionGates,
      gates_confirmed: PARENT_RECOVERY.gatesConfirmed,
      note: PARENT_RECOVERY.note,
    },
    enabled_roles: enabledRecoveryRoles(source),
  };
}

module.exports = {
  LOGIN_ROLES,
  SCOPE_PRESERVED_COLUMNS,
  ROLE_POLICIES,
  PARENT_RECOVERY,
  recoveryStatusForRole,
  isRecoveryEnabledForRole,
  enabledRecoveryRoles,
  recoveryPolicySummary,
};
