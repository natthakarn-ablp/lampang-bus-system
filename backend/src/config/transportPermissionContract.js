'use strict';

/**
 * Contract for the transport role. This file is intentionally data-only so
 * the permission audit, unit tests and operator workflow all use the same
 * source of truth.
 *
 * `exactRoles` is used for transport-only operational routes. Shared routes
 * use `requiredRoles` because school/province may legitimately read the same
 * verification record through their own workflow.
 */
const REQUIRED_ROUTES = [
  { id: 'view.dashboard', category: 'VIEW', method: 'GET', path: '/api/transport/dashboard', exactRoles: ['admin', 'transport'] },
  { id: 'view.vehicles', category: 'VIEW', method: 'GET', path: '/api/transport/vehicles', exactRoles: ['admin', 'transport'] },
  { id: 'view.vehicle', category: 'VIEW', method: 'GET', path: '/api/transport/vehicles/:id', exactRoles: ['admin', 'transport'] },
  { id: 'view.incident-roster', category: 'VIEW', method: 'GET', path: '/api/transport/vehicles/:id/incident-roster', exactRoles: ['admin', 'transport'], dataBoundary: 'vehicle_pupil_school_recorded_events', auditRequired: true },
  { id: 'view.pending', category: 'VIEW', method: 'GET', path: '/api/transport/vehicles/pending', exactRoles: ['admin', 'transport'] },
  { id: 'view.expiring', category: 'VIEW', method: 'GET', path: '/api/transport/vehicles/expiring', exactRoles: ['admin', 'transport'] },
  { id: 'view.inspections', category: 'VIEW', method: 'GET', path: '/api/transport/inspections', exactRoles: ['admin', 'transport'] },
  { id: 'view.pickup-map', category: 'VIEW', method: 'GET', path: '/api/transport/pickup-map', exactRoles: ['admin', 'transport'], dataBoundary: 'aggregate_only' },
  { id: 'view.verification-queue', category: 'VIEW', method: 'GET', path: '/api/verification/transport/queue', exactRoles: ['admin', 'transport'] },
  { id: 'view.application', category: 'VIEW', method: 'GET', path: '/api/verification/applications/:id', requiredRoles: ['transport'] },
  { id: 'view.timeline', category: 'VIEW', method: 'GET', path: '/api/verification/applications/:id/timeline', requiredRoles: ['transport'] },
  { id: 'view.drivers', category: 'VIEW', method: 'GET', path: '/api/verification/transport/drivers', exactRoles: ['admin', 'transport'] },
  { id: 'view.checklist', category: 'VIEW', method: 'GET', path: '/api/verification/transport/checklist', exactRoles: ['admin', 'transport'] },
  { id: 'view.vehicle-documents', category: 'VIEW', method: 'GET', path: '/api/verification/transport/documents/vehicle/:vehicleId', exactRoles: ['admin', 'transport'], feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.driver-documents', category: 'VIEW', method: 'GET', path: '/api/verification/transport/documents/driver/:driverId', exactRoles: ['admin', 'transport'], feature: 'FEATURE_DRIVER_REGISTRATION' },
  { id: 'view.document-file', category: 'VIEW', method: 'GET', path: '/api/documents/:docType/:id/file', requiredRoles: ['transport'], feature: 'FEATURE_DRIVER_REGISTRATION', auditRequired: true },

  { id: 'edit.vehicle-for-inspection', category: 'EDIT', method: 'POST', path: '/api/transport/vehicles', exactRoles: ['admin', 'transport'] },
  { id: 'edit.inspection-create', category: 'EDIT', method: 'POST', path: '/api/transport/inspections', exactRoles: ['admin', 'transport'] },
  { id: 'edit.inspection-update', category: 'EDIT', method: 'PUT', path: '/api/transport/inspections/:id', exactRoles: ['admin', 'transport'] },
  { id: 'edit.inspection-delete', category: 'EDIT', method: 'DELETE', path: '/api/transport/inspections/:id', exactRoles: ['admin', 'transport'] },
  { id: 'edit.assign-driver', category: 'EDIT', method: 'POST', path: '/api/verification/transport/vehicles/:id/drivers', exactRoles: ['admin', 'transport'] },
  { id: 'edit.driver-qualification', category: 'EDIT', method: 'POST', path: '/api/verification/transport/drivers/:id/qualification', exactRoles: ['admin', 'transport'] },
  { id: 'edit.document-review', category: 'EDIT', method: 'POST', path: '/api/verification/transport/documents/:kind/:id/review', exactRoles: ['admin', 'transport'], feature: 'FEATURE_DRIVER_REGISTRATION' },

  { id: 'approve.start-attempt', category: 'APPROVE', method: 'POST', path: '/api/verification/transport/applications/:id/start', exactRoles: ['admin', 'transport'] },
  { id: 'approve.finalize-attempt', category: 'APPROVE', method: 'POST', path: '/api/verification/transport/attempts/:id/finalize', exactRoles: ['admin', 'transport'] },
  { id: 'approve.abort-attempt', category: 'APPROVE', method: 'DELETE', path: '/api/verification/transport/attempts/:id', exactRoles: ['admin', 'transport'] },

  { id: 'export.vehicle-safety', category: 'EXPORT', method: 'GET', path: '/api/transport/export/vehicles.csv', exactRoles: ['admin', 'transport'], dataBoundary: 'vehicle_and_inspection_only', auditRequired: true },
];

// These areas must remain unreachable to transport even if a new route is
// added later. Participation and policy-notice routes are deliberately not
// listed here because they are shared self-scoped workflows.
const FORBIDDEN_PREFIXES = [
  { prefix: '/api/admin/users', reason: 'จัดการผู้ใช้เป็นสิทธิ์ผู้ดูแลระบบ' },
  { prefix: '/api/reports', reason: 'รายงานทั่วไปอาจมีข้อมูลนักเรียนหรือผู้ปกครอง' },
  { prefix: '/api/school', reason: 'ขนส่งไม่แก้ข้อมูลต้นทางของโรงเรียน' },
  { prefix: '/api/driver', reason: 'ขนส่งไม่เช็กชื่อหรือทำรายการแทนคนขับ' },
];

const CONDITIONAL_ROUTES = [
  { id: 'qr.read-token', method: 'GET', path: '/api/qr/vehicle/:id/token', feature: 'FEATURE_VEHICLE_QR' },
  { id: 'qr.create-token', method: 'POST', path: '/api/qr/vehicle/:id/token', feature: 'FEATURE_VEHICLE_QR' },
  { id: 'qr.revoke-token', method: 'POST', path: '/api/qr/vehicle/:id/revoke', feature: 'FEATURE_VEHICLE_QR' },
];

module.exports = { REQUIRED_ROUTES, FORBIDDEN_PREFIXES, CONDITIONAL_ROUTES };
