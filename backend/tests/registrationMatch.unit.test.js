'use strict';

const {
  stripThaiPrefix,
  nameSimilarity,
  suggestMatch,
  evaluateEligibility,
  normalizePickup,
} = require('../src/utils/registrationMatch');

describe('registrationMatch.stripThaiPrefix', () => {
  it('strips common Thai honorific prefixes', () => {
    expect(stripThaiPrefix('เด็กชายรักเรียน ดีงาม')).toBe('รักเรียน ดีงาม');
    expect(stripThaiPrefix('ด.ช. สมชาย')).toBe('สมชาย');
    expect(stripThaiPrefix('ด.ญ.มานี')).toBe('มานี');
    expect(stripThaiPrefix('นางสาวสุดา')).toBe('สุดา');
  });
  it('collapses internal whitespace and trims', () => {
    expect(stripThaiPrefix('  เด็กหญิง   ใจดี   มากมาย ')).toBe('ใจดี มากมาย');
  });
  it('is null-safe', () => {
    expect(stripThaiPrefix(null)).toBe('');
    expect(stripThaiPrefix(undefined)).toBe('');
  });
});

describe('registrationMatch.nameSimilarity', () => {
  it('returns 1 for identical names after prefix strip', () => {
    expect(nameSimilarity('เด็กชายสมชาย ใจดี', 'สมชาย ใจดี')).toBe(1);
  });
  it('returns a high score for a one-character typo', () => {
    expect(nameSimilarity('สมชาย', 'สมชาน')).toBeGreaterThanOrEqual(0.8);
  });
  it('returns 0 for empty input', () => {
    expect(nameSimilarity('', 'สมชาย')).toBe(0);
  });
});

describe('registrationMatch.suggestMatch', () => {
  const students = [
    { id: 1, student_code: '19752', full_name: 'นราวิชญ์ สุตรา', grade: 'ป.4' },
    { id: 2, student_code: '20011', full_name: 'มานี รักเรียน', grade: 'ป.3' },
    { id: 3, student_code: '20012', full_name: 'มานะ รักเรียน', grade: 'ป.3' },
  ];

  it('matches exact student_code with high confidence', () => {
    const out = suggestMatch({ raw_student_code: '19752', raw_student_name: 'ด.ช. รักเรียน ป.4' }, students);
    expect(out.confidence).toBe('high');
    expect(out.student.id).toBe(1);
  });

  it('falls back to a single fuzzy name match with medium confidence', () => {
    const out = suggestMatch({ raw_student_name: 'นราวิชญ์ สุตรา' }, students);
    expect(out.confidence).toBe('medium');
    expect(out.student.id).toBe(1);
  });

  it('returns ambiguous when two names are similarly close', () => {
    const out = suggestMatch({ raw_student_name: 'มานี รักเรียน' }, students, { threshold: 0.6 });
    expect(out.confidence).toBe('ambiguous');
    expect(out.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns none when nothing is close enough', () => {
    const out = suggestMatch({ raw_student_name: 'ไม่มีใครชื่อนี้เลยจริงๆ' }, students);
    expect(out.confidence).toBe('none');
  });

  it('is safe with an empty student list', () => {
    expect(suggestMatch({ raw_student_name: 'สมชาย' }, []).confidence).toBe('none');
  });
});

describe('registrationMatch.evaluateEligibility', () => {
  it('is true only when all schools approved AND inspection eligible', () => {
    expect(evaluateEligibility({ approvals: ['APPROVED', 'APPROVED'], verificationStatus: 'ELIGIBLE' })).toBe(true);
    expect(evaluateEligibility({ approvals: ['APPROVED'], verificationStatus: 'EXPIRING' })).toBe(true);
  });
  it('is false when any school is not approved', () => {
    expect(evaluateEligibility({ approvals: ['APPROVED', 'PENDING_SCHOOL_REVIEW'], verificationStatus: 'ELIGIBLE' })).toBe(false);
  });
  it('is false when the inspection is not eligible', () => {
    expect(evaluateEligibility({ approvals: ['APPROVED'], verificationStatus: 'INELIGIBLE' })).toBe(false);
    expect(evaluateEligibility({ approvals: ['APPROVED'], verificationStatus: 'UNVERIFIED' })).toBe(false);
  });
  it('is false with no schools at all', () => {
    expect(evaluateEligibility({ approvals: [], verificationStatus: 'ELIGIBLE' })).toBe(false);
  });
});

describe('registrationMatch.normalizePickup', () => {
  it('passes through canonical values', () => {
    expect(normalizePickup('MORNING')).toBe('MORNING');
    expect(normalizePickup('both')).toBe('BOTH');
  });
  it('maps Thai aliases', () => {
    expect(normalizePickup('เช้า')).toBe('MORNING');
    expect(normalizePickup('เย็น')).toBe('EVENING');
    expect(normalizePickup('ทั้งวัน')).toBe('BOTH');
  });
  it('returns null for unknown input', () => {
    expect(normalizePickup('whenever')).toBeNull();
    expect(normalizePickup(null)).toBeNull();
  });
});
