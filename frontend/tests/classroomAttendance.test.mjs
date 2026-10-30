import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTeacherClassrooms, classroomPlan } from '../src/utils/classroomAttendance.js';

test('groups one classroom across different vehicles and sorts room numbers', () => {
  const rooms = groupTeacherClassrooms([
    { plate_no: 'รถ ก', students: [{ id: 1, classroom: '2' }, { id: 2, classroom: '1' }] },
    { plate_no: 'รถ ข', students: [{ id: 3, classroom: '1' }, { id: 4, classroom: '' }] },
  ]);
  assert.deepEqual(rooms.map(r => [r.classroom, r.students.map(s => s.id)]), [
    ['1', [2, 3]], ['2', [1]], ['', [4]],
  ]);
  assert.equal(rooms[0].students[1].plate_no, 'รถ ข');
});

test('defaults pending riders to present and excludes done, existing leave and no-vehicle pupils', () => {
  const room = { students: [
    { id: 1 }, { id: 2 }, { id: 3, done: true },
    { id: 4, on_leave: true }, { id: 5, no_vehicle: true },
  ] };
  assert.deepEqual(classroomPlan(room, new Set()), { presentIds: [1, 2], leaveIds: [] });
  assert.deepEqual(classroomPlan(room, new Set([2, 3, 4, 5])), { presentIds: [1], leaveIds: [2] });
});
