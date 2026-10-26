'use strict';

function abbreviateGrade(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/ประถมศึกษาปีที่\s*/g, 'ป.')
    .replace(/อนุบาล(?:ปีที่)?\s*/g, 'อ.')
    .trim();
}

function formatGradeClass(grade, classroom, fallback = '-') {
  const gradeLabel = abbreviateGrade(grade);
  const classroomText = classroom === null || classroom === undefined
    ? ''
    : String(classroom).trim();

  if (gradeLabel && classroomText) return `${gradeLabel}/${classroomText}`;
  return gradeLabel || classroomText || fallback;
}

module.exports = { abbreviateGrade, formatGradeClass };
