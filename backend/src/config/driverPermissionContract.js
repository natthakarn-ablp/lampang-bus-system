'use strict';

/**
 * Permission contract for the driver role. Every route here is checked against
 * the mounted Express graph. Data ownership is still enforced by each service
 * from the authenticated driver/vehicle relationship; it must never be taken
 * from a client-supplied vehicle id.
 */
const REQUIRED_ROUTES = [
  { id: 'view.authorized-vehicles', category: 'VIEW', method: 'GET', path: '/api/driver/authorized-vehicles', exactRoles: ['driver'], scope: 'own_driver' },
  { id: 'view.active-shift', category: 'VIEW', method: 'GET', path: '/api/driver/active-shift', exactRoles: ['driver'], scope: 'own_driver' },
  { id: 'view.roster', category: 'VIEW', method: 'GET', path: '/api/driver/roster', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.pickup-points', category: 'VIEW', method: 'GET', path: '/api/driver/pickup-points', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.pickup-students', category: 'VIEW', method: 'GET', path: '/api/driver/pickup-students', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.assignable-students', category: 'VIEW', method: 'GET', path: '/api/driver/pickup-points/:id/assignable-students', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.status-today', category: 'VIEW', method: 'GET', path: '/api/driver/status-today', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.profile', category: 'VIEW', method: 'GET', path: '/api/driver/profile', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.leaves', category: 'VIEW', method: 'GET', path: '/api/driver/leaves', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.student-search', category: 'VIEW', method: 'GET', path: '/api/driver/search-students', exactRoles: ['driver'], scope: 'schools_served_by_active_vehicle' },
  { id: 'view.schools', category: 'VIEW', method: 'GET', path: '/api/driver/schools', exactRoles: ['driver'], scope: 'active_school_directory' },
  { id: 'view.roster-requests', category: 'VIEW', method: 'GET', path: '/api/driver/roster-requests', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.pretrip-status', category: 'VIEW', method: 'GET', path: '/api/driver/pretrip-status', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'view.applications', category: 'VIEW', method: 'GET', path: '/api/driver/applications', exactRoles: ['driver'], scope: 'own_user', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.application', category: 'VIEW', method: 'GET', path: '/api/driver/applications/:id', exactRoles: ['driver'], scope: 'own_user', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.registrations', category: 'VIEW', method: 'GET', path: '/api/driver/registrations', exactRoles: ['driver'], scope: 'own_driver', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.registration-documents', category: 'VIEW', method: 'GET', path: '/api/driver/registrations/documents', exactRoles: ['driver'], scope: 'own_driver_or_vehicle', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.document-file', category: 'VIEW', method: 'GET', path: '/api/documents/:docType/:id/file', requiredRoles: ['driver'], scope: 'own_upload_or_active_vehicle', feature: 'FEATURE_DRIVER_REGISTRATION', auditRequired: true },
  { id: 'view.verification-timeline', category: 'VIEW', method: 'GET', path: '/api/verification/applications/:id/timeline', requiredRoles: ['driver'], scope: 'own_application' },
  { id: 'view.eta', category: 'VIEW', method: 'GET', path: '/api/eta/vehicle/:vehicleId', requiredRoles: ['driver'], scope: 'active_vehicle', feature: 'FEATURE_ETA' },

  { id: 'edit.shift-start', category: 'EDIT', method: 'POST', path: '/api/driver/shifts/start', exactRoles: ['driver'], scope: 'authorized_vehicle' },
  { id: 'edit.shift-end', category: 'EDIT', method: 'POST', path: '/api/driver/shifts/:id/end', exactRoles: ['driver'], scope: 'own_open_shift' },
  { id: 'edit.pickup-create', category: 'EDIT', method: 'POST', path: '/api/driver/pickup-points', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.pickup-delete', category: 'EDIT', method: 'DELETE', path: '/api/driver/pickup-points/:id', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.pickup-students', category: 'EDIT', method: 'PUT', path: '/api/driver/pickup-points/:id/students', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.checkin', category: 'EDIT', method: 'POST', path: '/api/driver/checkin', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.checkout', category: 'EDIT', method: 'POST', path: '/api/driver/checkout', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.checkin-all', category: 'EDIT', method: 'POST', path: '/api/driver/checkin-all', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.checkout-all', category: 'EDIT', method: 'POST', path: '/api/driver/checkout-all', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.checkin-void', category: 'EDIT', method: 'POST', path: '/api/driver/checkin/:logId/void', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.profile', category: 'EDIT', method: 'PUT', path: '/api/driver/profile', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.profile-photo', category: 'EDIT', method: 'POST', path: '/api/driver/profile/photo', exactRoles: ['driver'], scope: 'own_driver' },
  { id: 'edit.password', category: 'EDIT', method: 'POST', path: '/api/driver/change-password', exactRoles: ['driver'], scope: 'own_user' },
  { id: 'edit.leave-create', category: 'EDIT', method: 'POST', path: '/api/driver/leave', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.leave-delete', category: 'EDIT', method: 'DELETE', path: '/api/driver/leave/:id', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.roster-request', category: 'EDIT', method: 'POST', path: '/api/driver/roster-request', exactRoles: ['driver'], scope: 'request_only_no_approval' },
  { id: 'edit.pretrip', category: 'EDIT', method: 'POST', path: '/api/driver/pretrip', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.location-start', category: 'EDIT', method: 'POST', path: '/api/driver/vehicle-location', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.location-stop', category: 'EDIT', method: 'DELETE', path: '/api/driver/vehicle-location', exactRoles: ['driver'], scope: 'active_vehicle' },
  { id: 'edit.application-create', category: 'EDIT', method: 'POST', path: '/api/driver/applications', exactRoles: ['driver'], scope: 'own_user', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.registration-student-add', category: 'EDIT', method: 'POST', path: '/api/driver/registrations/students', exactRoles: ['driver'], scope: 'own_registration', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.registration-student-remove', category: 'EDIT', method: 'DELETE', path: '/api/driver/registrations/students/:id', exactRoles: ['driver'], scope: 'own_registration', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.vehicle-document-upload', category: 'EDIT', method: 'POST', path: '/api/driver/registrations/documents/vehicle', exactRoles: ['driver'], scope: 'own_active_vehicle', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.driver-document-upload', category: 'EDIT', method: 'POST', path: '/api/driver/registrations/documents/driver', exactRoles: ['driver'], scope: 'own_driver', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.document-delete', category: 'EDIT', method: 'DELETE', path: '/api/driver/registrations/documents/:kind/:id', exactRoles: ['driver'], scope: 'own_pending_upload', feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'edit.consent-record', category: 'EDIT', method: 'POST', path: '/api/consent', exactRoles: ['driver'], scope: 'own_driver' },
  { id: 'edit.consent-withdraw', category: 'EDIT', method: 'POST', path: '/api/consent/withdraw', exactRoles: ['driver'], scope: 'own_driver' },

  { id: 'emergency.create', category: 'EMERGENCY', method: 'POST', path: '/api/driver/emergency', exactRoles: ['driver'], scope: 'active_or_fallback_vehicle', mustNotBeBlockedBySafetyPolicy: true },
];

const FORBIDDEN_PREFIXES = [
  { prefix: '/api/admin', reason: 'คนขับไม่จัดการผู้ใช้หรือระบบ' },
  { prefix: '/api/reports', reason: 'คนขับไม่มีสิทธิ์ส่งออกรายงาน' },
  { prefix: '/api/school', reason: 'คนขับส่งคำขอให้โรงเรียน แต่ไม่อนุมัติแทนโรงเรียน' },
  { prefix: '/api/transport', reason: 'คนขับไม่ตรวจหรือรับรองรถแทนขนส่ง' },
  { prefix: '/api/province', reason: 'คนขับไม่มีสิทธิ์กำกับดูแลระดับจังหวัด' },
  { prefix: '/api/affiliation', reason: 'คนขับไม่มีสิทธิ์จัดการข้อมูลสังกัด' },
];

const FEATURE_MOUNTED_ROUTES = REQUIRED_ROUTES.filter((route) => route.feature);

module.exports = { REQUIRED_ROUTES, FORBIDDEN_PREFIXES, FEATURE_MOUNTED_ROUTES };
