// Self-service LINE password recovery — which roles are open, and who to
// contact when a role is not.
//
// The server decides (backend/src/config/accountRecoveryPolicy.js: a role
// needs confirmed decision gates AND its flag). These helpers only read that
// answer from GET /api/auth/recovery/config or from the login `features`.

/** Login `features` key for each role whose recovery has its own flag. */
export const RECOVERY_FEATURE_BY_ROLE = Object.freeze({
  admin: 'adminPasswordRecovery',
  school: 'recoverySchool',
  driver: 'recoveryDriver',
});

/**
 * Roles the recovery config says are open. Prefers `policy.enabled_roles`,
 * falls back to `policy.roles[*].enabled`, and always honours the legacy
 * `admin_password_recovery` key that older servers send.
 */
export function enabledRecoveryRolesFromConfig(data) {
  const policy = data?.policy;
  let roles = [];
  if (Array.isArray(policy?.enabled_roles)) {
    roles = policy.enabled_roles.slice();
  } else if (policy?.roles && typeof policy.roles === 'object') {
    roles = Object.entries(policy.roles).filter(([, row]) => row?.enabled).map(([role]) => role);
  }
  if (data?.admin_password_recovery && !roles.includes('admin')) roles.push('admin');
  return roles;
}

/** Whether the signed-in user's own role can bind LINE right now. */
export function canBindRecoveryFor(user, features) {
  const role = user?.role;
  if (!role) return false;
  const flag = RECOVERY_FEATURE_BY_ROLE[role];
  // province / affiliation / transport: the page itself explains that their
  // recovery is not open yet (decision gates unconfirmed).
  if (!flag) return ['province', 'affiliation', 'transport'].includes(role);
  return Boolean(features?.[flag]);
}

/**
 * Who can reset each kind of account for someone who forgot the password,
 * as the server routes actually allow on this code base:
 *  - school main account → affiliation (POST /api/affiliation/users/:id/reset-password)
 *  - grade teacher       → the school's main account (POST /api/school/teacher-accounts/:id/reset-password)
 *  - driver (vehicle)    → any school whose pupils ride the vehicle (POST /api/school/vehicles/:id/driver/reset-password),
 *                          its affiliation (POST /api/affiliation/vehicles/:id/driver/reset-password) or admin
 *  - affiliation, transport → province (POST /api/province/unit-accounts/:id/reset-password) or admin
 *  - province            → admin
 * `recoveryRole` is the policy role whose LINE recovery covers that account.
 */
export const RECOVERY_CONTACTS = Object.freeze([
  { key: 'school',  label: 'โรงเรียน (บัญชีหลัก)', recoveryRole: 'school', contact: 'ติดต่อสังกัดให้รีเซ็ตรหัสผ่าน' },
  { key: 'teacher', label: 'ครูประจำสายชั้น', recoveryRole: 'school', contact: 'ติดต่อบัญชีหลักของโรงเรียนให้รีเซ็ตรหัสผ่าน' },
  { key: 'driver',  label: 'คนขับ (บัญชีรถ)', recoveryRole: 'driver', contact: 'ติดต่อโรงเรียนที่ใช้รถคันนี้ให้รีเซ็ตรหัสผ่าน' },
  { key: 'unit',    label: 'สังกัดและขนส่ง', recoveryRole: null, contact: 'ติดต่อจังหวัดหรือผู้ดูแลระบบให้รีเซ็ตรหัสผ่าน' },
  { key: 'province', label: 'จังหวัด', recoveryRole: null, contact: 'ติดต่อผู้ดูแลระบบให้รีเซ็ตรหัสผ่าน' },
  { key: 'admin',   label: 'ผู้ดูแลระบบ', recoveryRole: 'admin', contact: 'ติดต่อผู้ดูแลระบบอีกบัญชีหนึ่งให้รีเซ็ตรหัสผ่าน' },
]);
