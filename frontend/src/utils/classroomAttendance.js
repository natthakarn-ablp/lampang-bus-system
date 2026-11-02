// Match the stored-grade variants accepted by backend/utils/gradeScope.
// Display grouping must not hide pupils whose grade is stored as e.g. 'ป. 5'.
function attendanceGrade(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[๐-๙]/g, digit => '๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)).replace(/\s+/g, '');
  for (const [pattern, prefix] of [
    [/^(?:อ\.?|อนุบาล(?:ปีที่)?|อบ\.?)(\d{1,2})$/, 'อ'],
    [/^(?:ป\.?|ประถมศึกษาปีที่|ประถม)(\d{1,2})$/, 'ป'],
    [/^(?:ม\.?|มัธยมศึกษาปีที่|มัธยม)(\d{1,2})$/, 'ม'],
  ]) {
    const match = compact.match(pattern);
    if (match) return `${prefix}.${match[1]}`;
  }
  return raw || 'ไม่ระบุชั้น';
}

// The roster API stays vehicle-based; group each grade and classroom across
// vehicles without combining rooms with the same name in other grades.
export function groupTeacherClassrooms(vehicles = []) {
  const rooms = new Map();
  for (const vehicle of vehicles) {
    for (const student of vehicle.students || []) {
      const classroom = String(student.classroom || '').trim();
      const grade = attendanceGrade(student.grade);
      const key = JSON.stringify([grade, classroom]);
      if (!rooms.has(key)) rooms.set(key, { key, grade, classroom, students: [] });
      rooms.get(key).students.push({ ...student, plate_no: vehicle.plate_no || null });
    }
  }
  for (const room of rooms.values()) {
    room.students.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
  }
  return [...rooms.values()].sort((a, b) => {
    const gradeOrder = a.grade.localeCompare(b.grade, 'th', { numeric: true });
    if (gradeOrder) return gradeOrder;
    if (!a.classroom) return 1;
    if (!b.classroom) return -1;
    return a.classroom.localeCompare(b.classroom, 'th', { numeric: true });
  });
}

export function classroomPlan(room, selectedLeaveIds, selectedSelfIds = new Set()) {
  const pending = room.students.filter(st => !st.done && !st.on_leave && !st.self_travel && !st.no_vehicle);
  return {
    presentIds: pending.filter(st => !selectedLeaveIds.has(st.id) && !selectedSelfIds.has(st.id)).map(st => st.id),
    leaveIds: pending.filter(st => selectedLeaveIds.has(st.id)).map(st => st.id),
    selfIds: pending.filter(st => selectedSelfIds.has(st.id) && !selectedLeaveIds.has(st.id)).map(st => st.id),
  };
}
