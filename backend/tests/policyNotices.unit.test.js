'use strict';

const {
  APPROVED, VERSION, LEGAL_REVIEW, ROLE_TOPICS, ACTION_POLICIES,
  noticesForRole, actionPolicyForRole, catalogForRole,
} = require('../src/config/policyNotices');

describe('staff policy notice draft', () => {
  test('stays dark until a reviewed notice is explicitly approved', () => {
    expect(APPROVED).toBe(false);
    expect(LEGAL_REVIEW.approved).toBe(false);
    expect(LEGAL_REVIEW.fullNoticeUrl).toBe('');
    expect(VERSION).toMatch(/^draft-/);
  });

  test('has the common topic and a distinct scoped topic for every staff role', () => {
    expect(Object.keys(ROLE_TOPICS).sort()).toEqual(
      ['school', 'driver', 'transport', 'affiliation', 'province', 'admin'].sort()
    );
    for (const role of Object.keys(ROLE_TOPICS)) {
      const notices = noticesForRole(role);
      expect(notices.map((notice) => notice.key)).toEqual(['common', role]);
      expect(notices.every((notice) => notice.kind === 'notice' && notice.version === VERSION)).toBe(true);
      expect(notices.every((notice) => notice.title && notice.summary)).toBe(true);
    }
  });

  test('unknown and parent roles cannot receive a staff notice', () => {
    expect(noticesForRole('parent')).toEqual([]);
    expect(noticesForRole('unknown')).toEqual([]);
  });

  test('maps consequential actions to an exact role, subject and evidence kind', () => {
    expect(Object.keys(ACTION_POLICIES).sort()).toEqual([
      'school.student_import_apply', 'transport.inspection_create',
      'transport.inspection_update', 'transport.vehicle_export',
    ].sort());
    expect(actionPolicyForRole('school', 'school.student_import_apply')).toEqual(
      expect.objectContaining({ key: 'school_import', kind: 'certification', subjectType: 'import_batch' })
    );
    expect(actionPolicyForRole('transport', 'transport.vehicle_export')).toEqual(
      expect.objectContaining({ key: 'transport_export', kind: 'warning', subjectType: 'transport_safety_report' })
    );
    expect(actionPolicyForRole('driver', 'transport.vehicle_export')).toBeNull();
  });

  test('builds a revisit catalog without duplicating create and update inspection text', () => {
    const catalog = catalogForRole('transport');
    expect(catalog.map((item) => item.key)).toEqual([
      'common', 'transport', 'transport_inspection', 'transport_export',
    ]);
    expect(catalog.find((item) => item.key === 'transport_inspection').contexts).toEqual([
      'transport.inspection_create', 'transport.inspection_update',
    ]);
  });
});
