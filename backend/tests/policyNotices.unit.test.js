'use strict';

const { APPROVED, VERSION, LEGAL_REVIEW, ROLE_TOPICS, noticesForRole } = require('../src/config/policyNotices');

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
});
