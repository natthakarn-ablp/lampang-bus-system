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

test('same room number in different grades never shares a save plan', () => {
  const rooms = groupTeacherClassrooms([
    { plate_no: 'รถ ก', students: [
      { id: 1, grade: 'ป.1', classroom: '1' },
      { id: 2, grade: 'ป.2', classroom: '1' },
    ] },
    { plate_no: 'รถ ข', students: [
      { id: 3, grade: 'ประถมศึกษาปีที่ 1', classroom: '1' },
      { id: 4, grade: '', classroom: '1' },
    ] },
  ]);
  assert.equal(new Set(rooms.map(room => room.key)).size, 3);
  const firstGrade = rooms.find(room => room.grade === 'ป.1');
  const secondGrade = rooms.find(room => room.grade === 'ป.2');
  assert.deepEqual(classroomPlan(firstGrade, new Set([3])), { presentIds: [1], leaveIds: [3] });
  assert.deepEqual(classroomPlan(secondGrade, new Set([3])), { presentIds: [2], leaveIds: [] });
  assert.equal(rooms.find(room => room.grade === 'ไม่ระบุชั้น').students[0].id, 4);
});

test('stored grade spelling variants remain in the correct grade teacher classroom', () => {
  const grades = ['ป.5', 'ป. 5', 'ป5', 'ประถมศึกษาปีที่ ๕', 'อบ.2', 'อนุบาล 2', 'มัธยมศึกษาปีที่ 1', 'ม. 1'];
  const rooms = groupTeacherClassrooms([{ students: grades.map((grade, id) => ({ id, grade, classroom: '1' })) }]);
  assert.deepEqual(rooms.find(room => room.grade === 'ป.5').students.map(st => st.id), [0, 1, 2, 3]);
  assert.deepEqual(rooms.find(room => room.grade === 'อ.2').students.map(st => st.id), [4, 5]);
  assert.deepEqual(rooms.find(room => room.grade === 'ม.1').students.map(st => st.id), [6, 7]);
});
