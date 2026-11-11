# leave — แจ้งลาโดยคนขับ / โรงเรียน(ครู) / ผู้ปกครอง

## หน้าที่
บันทึกและยกเลิกการลาของนักเรียนรายรอบ (morning / evening / both) ต่อวัน โดยผู้แจ้ง 3 ประเภท: คนขับ, โรงเรียน (รวมครูประจำชั้น), ผู้ปกครองผ่าน LIFF (flag-gated).
ผลการลาถูกอ่านต่อโดย roster/สถานะวันนี้ ใน [attendance.md](attendance.md).

## จุดเข้า
- คนขับ (`/api/driver`, `driver.routes.js`): POST /leave (L1031), DELETE /leave/:id (L1050), GET /leaves (L1067)
- โรงเรียน (`/api/school`, `school.routes.js`): GET /leaves (L626), POST /leave (L643), DELETE /leaves/:id (L686)
- ผู้ปกครอง (`/api/parent`, `parent.routes.js`) — เปิดด้วย `FEATURE_PARENT_LEAVE` (`env.features.parentLeave`; ถ้าปิด `parentLeaveEnabled(res)` ตอบปฏิเสธ, parent.routes.js:262):
  - GET /api/parent/children/:id/leaves (L283); POST /children/:id/leaves (L301); POST /leaves/:id/cancel (L322)
  - POST /api/parent/guardians/leave (L380) — ผู้ปกครองร่วม (co-guardian) ออกจากการดูแล ไม่ใช่การลาของนักเรียน (ชื่อ path คล้ายกัน ระวังสับสน; ดู [line-parent.md](line-parent.md))

## โค้ดหลัก
- `backend/src/services/leave.service.js` (249) — `createLeave` (L12), `cancelLeave` (L116, คนขับ), `cancelLeaveBySchool` (L141), `getLeavesForVehicle`, `getLeavesForSchool` (L215), `getActiveLeaves`
- `backend/src/services/parentLeave.service.js` (182) — `createParentLeave` (L59), `cancelParentLeave` (L129), `listParentLeaves` (L157), `isPastCutoff` (L45)
- `backend/src/utils/calendarDate.js` (`isCalendarDate`), `thaiTime` (`todayBangkok`)

## ข้อมูลที่รับผิดชอบ
- `student_leaves` — 008_phase8_leaves_requests.sql
  - `attendance_kind` (LEAVE/SELF) เพิ่มใน 054_attendance_kind.sql
  - 056_parent_leave.sql: `reported_role` รับ 'parent', `reported_by` เป็น NULL ได้, เพิ่ม `reported_line_user_id`

## จุดเชื่อม
- `students` (ล็อก FOR UPDATE ตอนสร้าง), `audit.logAudit`
- อ่านโดย `checkin.service.getRoster` (กรอง `attendance_kind = 'LEAVE'`, checkin.service.js:273) → [attendance.md](attendance.md)
- "เดินทางเอง" ใช้ตารางเดียวกันแต่ `attendance_kind='SELF'` → [attendance.md](attendance.md)
- ผู้ปกครองยืนยันตัวตนด้วย `requireParentLineAuth` → [line-parent.md](line-parent.md)

## กติกาสำคัญ
- วันที่ลาต้องเป็นรูปแบบ YYYY-MM-DD และห้ามย้อนหลัง (`LEAVE_DATE_IN_PAST`); แก้ย้อนหลังต้องใช้ backdated attendance — `leave.service.js:12-21`
- สร้างลาใน transaction READ COMMITTED + ล็อกนักเรียน `FOR UPDATE` และตรวจว่านักเรียนอยู่รถ/โรงเรียนที่ระบุ — `leave.service.js:25-32`
- ครูประจำชั้นต้องตรงโรงเรียนและเกรดตน — `leave.service.js:45`; ยกเลิกโดยโรงเรียนก็ตรวจเกรด (L153) และกรอง `attendance_kind='LEAVE'` (L145); route ฝั่งครูจำกัดเฉพาะวันนี้ + รอบ morning/evening — `school.routes.js:657-675`
- ผู้ปกครอง: ล่วงหน้าไม่เกิน `PARENT_LEAVE_MAX_DAYS_AHEAD` (ค่าเริ่มต้น 14), ห้ามย้อนหลัง, ตัดรอบเช้า 06:00 / เย็น 14:00 (ปรับด้วย env) — `parentLeave.service.js:59-68`, `env.js:326-328`; ยกเลิกเลยเวลาตัดรอบไม่ได้ — `parentLeave.service.js:139`
- ผู้ปกครองสร้าง/ยกเลิกใน transaction + `logAudit` — `parentLeave.service.js:72-114,148`
- ทุกการสร้าง/ยกเลิกเขียน audit — `leave.service.js:88,127,179`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(parentLeave|leaveDateCalendar|driverCheckinEnrollmentLeave|gradeTeacherEntry)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `driverLeaveScope.test.js`, `phase8.test.js` (ครอบคลุมลา/คำขอ — ยังไม่ได้ตรวจเนื้อหา). Frontend: `frontend/tests/parentLeaveUi.test.mjs` (`node --test`).

## ความเสี่ยงที่ทราบ
- ตัวอย่างชื่อซ้ำสับสน: `/api/parent/guardians/leave` (parent.routes.js:380) ไม่เกี่ยวกับ leave ของนักเรียน
- logic การลาแยก 2 service (`leave.service` กับ `parentLeave.service`) ที่เขียน `student_leaves` เหมือนกัน — ต้องแก้ให้สอดคล้องกันเอง
