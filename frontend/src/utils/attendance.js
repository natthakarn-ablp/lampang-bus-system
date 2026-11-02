export function isBusRider(student, session) {
  return !!student[`${session}_enabled`] && !student[`${session}_self`] && !student[`${session}_leave`];
}

export function visibleAttendance(tree) {
  const students = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Array.isArray(node.students)) node.students.forEach(student => students.set(student.id, student));
    for (const [key, value] of Object.entries(node)) if (key !== 'students') visit(value);
  }
  visit(tree);
  const result = {};
  for (const session of ['morning', 'evening']) {
    for (const kind of ['self', 'leave']) result[`${session}_${kind}`] = [...students.values()].filter(student => student[`${session}_enabled`] && student[`${session}_${kind}`]).length;
  }
  return result;
}
