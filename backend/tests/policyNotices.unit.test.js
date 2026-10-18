'use strict';

const {
  APPROVED, REVIEW_MODE, VERSION, LEGAL_REVIEW, ROLE_TOPICS, ACTION_POLICIES,
  noticesForRole, actionPolicyForRole, catalogForRole,
} = require('../src/config/policyNotices');

describe('staff policy notice draft', () => {
  test('keeps legal approval false while exposing a labelled review candidate', () => {
    expect(APPROVED).toBe(false);
    expect(REVIEW_MODE).toBe(true);
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
      'transport.inspection_update', 'transport.vehicle_export', 'driver.shift_start',
      'report.export', 'admin.research_export',
    ].sort());
    expect(actionPolicyForRole('school', 'school.student_import_apply')).toEqual(
      expect.objectContaining({ key: 'school_import', kind: 'certification', subjectType: 'import_batch' })
    );
    expect(actionPolicyForRole('transport', 'transport.vehicle_export')).toEqual(
      expect.objectContaining({ key: 'transport_export', kind: 'warning', subjectType: 'transport_safety_report' })
    );
    expect(actionPolicyForRole('driver', 'transport.vehicle_export')).toBeNull();
    expect(actionPolicyForRole('driver', 'driver.shift_start')).toEqual(
      expect.objectContaining({ key: 'driver_shift', kind: 'certification', subjectType: 'vehicle' })
    );
    expect(actionPolicyForRole('province', 'report.export')).toEqual(
      expect.objectContaining({ key: 'report_export', kind: 'warning', subjectType: 'report_export' })
    );
    expect(actionPolicyForRole('admin', 'admin.research_export')).toEqual(
      expect.objectContaining({ key: 'admin_research_export', kind: 'warning', subjectType: 'research_export' })
    );
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
