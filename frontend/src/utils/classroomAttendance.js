// The teacher roster API stays vehicle-based for existing school accounts.
// A grade teacher needs a classroom view across all vehicles in that grade.
export function groupTeacherClassrooms(vehicles = []) {
  const rooms = new Map();
  for (const vehicle of vehicles) {
    for (const student of vehicle.students || []) {
      const classroom = String(student.classroom || '').trim();
      const key = classroom || '__unspecified';
      if (!rooms.has(key)) rooms.set(key, { key, classroom, students: [] });
      rooms.get(key).students.push({ ...student, plate_no: vehicle.plate_no || null });
    }
  }
  for (const room of rooms.values()) {
    room.students.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
  }
  return [...rooms.values()].sort((a, b) => {
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
