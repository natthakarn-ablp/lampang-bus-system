import { abbreviateGrade } from './student.js';

// The roster API stays vehicle-based; group each grade and classroom across
// vehicles without combining rooms with the same name in other grades.
export function groupTeacherClassrooms(vehicles = []) {
  const rooms = new Map();
  for (const vehicle of vehicles) {
    for (const student of vehicle.students || []) {
      const classroom = String(student.classroom || '').trim();
      const grade = abbreviateGrade(student.grade) || 'ไม่ระบุชั้น';
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

export function classroomPlan(room, selectedLeaveIds) {
  const pending = room.students.filter(st => !st.done && !st.on_leave && !st.no_vehicle);
  return {
    presentIds: pending.filter(st => !selectedLeaveIds.has(st.id)).map(st => st.id),
    leaveIds: pending.filter(st => selectedLeaveIds.has(st.id)).map(st => st.id),
  };
}
