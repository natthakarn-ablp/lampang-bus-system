/**
 * Build the small grade/classroom label shown next to a student's name
 * in pickup-point checklists, popups, and roster rows.
 *
 * Returns a labeled string the caller can prefix with "·" or render
 * as-is. Returns null if the student has neither field.
 *
 *   { grade: 'ป.4', classroom: '1' }   →  'ป.4/1'
 *   { grade: 'ม.1', classroom: '2/1' } →  'ม.1/2/1'   (rare but legal)
 *   { classroom: '5' }                 →  'ห้อง 5'
 *   { grade: 'ป.4' }                   →  'ป.4'
 *   { }                                →  null
 *
 * Why "ห้อง" prefix when only classroom is present:
 *   The classroom field is a free-text VARCHAR (per schema notes —
 *   may contain '1', 'A', '1/1', 'อนุบาล3/2'). Without a label, a
 *   bare number reads as a stray digit ("ชื่อ 5"). Prefixing with
 *   "ห้อง" makes it self-describing.
 *
 * Why no "ห้อง" prefix when grade is present:
 *   "ป.4/1" is the conventional Thai school notation. Adding "ห้อง"
 *   would be redundant.
 */
export function abbreviateGrade(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/ประถมศึกษาปีที่\s*/g, 'ป.')
    .replace(/อนุบาล(?:ปีที่)?\s*/g, 'อ.')
    .trim();
}

export function formatGradeClass(grade, classroom, fallback = '-') {
  const gradeLabel = abbreviateGrade(grade);
  const classroomText = classroom === null || classroom === undefined
    ? ''
    : String(classroom).trim();

  if (gradeLabel && classroomText) return `${gradeLabel}/${classroomText}`;
  return gradeLabel || classroomText || fallback;
}

export function classroomLabel(student) {
  if (!student) return null;
  const grade = abbreviateGrade(student.grade);
  const classroom = student.classroom && String(student.classroom).trim();
  if (grade && classroom) return `${grade}/${classroom}`;
  if (classroom)          return `ห้อง ${classroom}`;
  if (grade)              return grade;
  return null;
}
