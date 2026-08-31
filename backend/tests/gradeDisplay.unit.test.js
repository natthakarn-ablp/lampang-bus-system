'use strict';

const { abbreviateGrade, formatGradeClass } = require('../src/utils/gradeDisplay');

describe('grade display formatting', () => {
  test.each([
    ['ประถมศึกษาปีที่ 1', 'ป.1'],
    ['ประถมศึกษาปีที่  6', 'ป.6'],
    ['อนุบาล 2', 'อ.2'],
    ['อนุบาลปีที่ 3', 'อ.3'],
    ['ป.4', 'ป.4'],
    ['มัธยมศึกษาปีที่ 1', 'มัธยมศึกษาปีที่ 1'],
  ])('abbreviates %s as %s', (input, expected) => {
    expect(abbreviateGrade(input)).toBe(expected);
  });

  test('combines the abbreviated grade and classroom', () => {
    expect(formatGradeClass('ประถมศึกษาปีที่ 4', '2')).toBe('ป.4/2');
    expect(formatGradeClass('อนุบาล 1', '1')).toBe('อ.1/1');
  });

  test('preserves useful partial and fallback values', () => {
    expect(formatGradeClass(null, 'A')).toBe('A');
    expect(formatGradeClass(null, null)).toBe('-');
    expect(formatGradeClass(null, null, '')).toBe('');
  });
});
