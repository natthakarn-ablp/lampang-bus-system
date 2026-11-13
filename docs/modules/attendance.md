# attendance — เช็กอิน/เช็กเอาท์, เช็กแทน, ย้อนหลัง, เดินทางเอง

## หน้าที่
บันทึกการขึ้น/ลงรถรายนักเรียน (คนขับ), การยืนยันแทนโดยโรงเรียน (override), การเช็กโดยครูที่โรงเรียน (teacher-check),
การเช็กย้อนหลังไม่เกิน 7 วัน, การบันทึก "เดินทางเอง" (self travel) และการ void รายการผิด. เขียน `checkin_logs` + `daily_status` + คิว `notifications` ใน transaction เดียว.

## จุดเข้า
ไม่มี feature flag. ทุกเส้นอยู่ใต้ `authenticate` ของ router แม่.

คนขับ (`/api/driver`, `driver.routes.js`):
- POST /api/driver/checkin (L459), /checkout (L493), /checkin-all (L527), /checkout-all (L563) — ขึ้น/ลงรถรายคนและทั้งคัน
- GET /api/driver/roster (L227), GET /status-today (L736) — รายชื่อ+สถานะวันนี้
- POST /api/driver/checkin/:logId/void (L1528) — ยกเลิกรายการของตน (`restorePriorDone`; UI ปุ่ม "ยกเลิกรายการที่กดผิด" ใน DriverDashboard แสดงเฉพาะแถว `recent[].can_void` จาก GET /api/driver/status-today = รายการวันนี้ที่คนขับกดเอง และเป็นรายการล่าสุดของนักเรียน/รอบนั้น)
- POST /api/driver/emergency (L594) — ดู [admin-ops.md](admin-ops.md)

โรงเรียน (`/api/school`, `school.routes.js`):
- POST /checkin-override (L702), POST /checkin-override/all (L759) — ยืนยัน/ทำเครื่องหมายขาดแทน ต้องมีเหตุผล (full-school เท่านั้น)
- POST /checkin/:logId/void (L2720, full-school) — void รายการ
- GET /no-show (L189), GET /missing (L583), GET /status-today (L288) — อ่านสถานะ
- GET/POST /teacher-check (L887/902), PATCH /teacher-check/:logId/time (L920), POST /teacher-check/:logId/undo (L933) — ครูเช็กที่โรงเรียน
- POST /self-travel (L848), POST /self-travel/:id/undo (L860), PATCH /self-travel/:id/time (L873)
- GET/POST /backdated-attendance (L2761/2773)

## โค้ดหลัก
- `backend/src/services/checkin.service.js` (1861) — `processCheckin/Checkout(+All)` (L577-687), `_buildCheckinTransaction` (L357), `processSchoolOverride(+All)` (L817/996), `voidCheckin` (L1263), `getNoShowStudents` (L1206), `processTeacherCheck` (L1597), `correctTeacherCheckTime` (L1695), `undoTeacherCheck` (L1797), `getRoster` (L239)
- `backend/src/services/backdatedAttendance.service.js` (414) — `getBackdatedRoster` (L122), `recordBackdatedCheck` (L206), `assertBackdateWindow`
- `backend/src/services/selfTravel.service.js` (128) — `recordSelfTravel`, `undoSelfTravel`, `correctSelfTravelTime`
- `backend/src/utils/attendanceOutcome.js` (33) — `outcome()` รวมผลลาพัก/เดินทางเอง/ขึ้นรถ → ถ้าขัดแย้งคืน `CONFLICT`
- `backend/src/services/attendanceMigration.service.js` (61), `term.service.js` (`deriveTermIdFromDate`)

## ข้อมูลที่รับผิดชอบ
- `checkin_logs`, `daily_status` — 001_initial_schema.sql (archive: `checkin_logs_archive` 047_log_archive_tables.sql)
- `notifications` (เขียนคิว) — 001
- เดินทางเอง ใช้ `student_leaves` (008_phase8_leaves_requests.sql) แยกด้วยคอลัมน์ `attendance_kind` ENUM('LEAVE','SELF') จาก 054_attendance_kind.sql
- `daily_snapshots` (013) — ยังไม่ได้ตรวจว่าใครเขียน (น่าจะ reports)

## จุดเชื่อม
- เขียนคิว `notifications` → ส่งโดย [line-parent.md](line-parent.md)
- ลา/เดินทางเอง กระทบสถานะ roster → [leave.md](leave.md)
- รายงานอ่านจากตารางนี้ → [reports-export.md](reports-export.md)
- คนขับ/รถ resolve จาก [vehicles-drivers.md](vehicles-drivers.md); ครูประจำชั้น ดู [students-import.md](students-import.md)

## กติกาสำคัญ
- Transaction ใช้ `READ COMMITTED` — `checkin.service.js:345-348`
- แถว `students` ถูกล็อก `FOR UPDATE` เป็น mutex รายนักเรียน (กัน deadlock/ลงรถซ้ำ) — `checkin.service.js:369`, ใช้ gap-lock หลีกเลี่ยงที่ L420
- เช็กอินแบบ batch ต้อง retry เมื่อ deadlock — `checkin.service.js:649` (ดู `checkinDeadlockRetry.unit.test.js`)
- ถ้ามีรายการ SELF ของนักเรียนรอบนั้น เช็กอินบนรถถูกกัน — `checkin.service.js:399`
- Override ต้องมีเหตุผล (trim) และเก็บ snapshot daily_status เดิมใน audit — `checkin.service.js:833,882,922`
- void: ล็อกแถวเดิม `FOR UPDATE` และตรวจความเป็นเจ้าของในธุรกรรม, รีเซ็ต `daily_status.<session>_done` — `checkin.service.js:1253-1263`
- ย้อนหลัง: 1-7 วัน ไม่รวมวันนี้ (`BACKDATE_MAX_DAYS`), term คำนวณจากวันที่ย้อนหลัง ไม่ใช่วันนี้ — `backdatedAttendance.service.js:33,78,249`; ล็อกนักเรียนใน txn L264
- self travel: ล็อกนักเรียน + audit แบบ `required: true` (ถ้า audit ไม่ลง ธุรกรรมล้ม) — `selfTravel.service.js:31,49`
- `logAudit` ทุกการเขียนข้างต้น (override L922, ย้อนหลัง L348/357)

## สิทธิ์ครูประจำชั้น
ดูรายละเอียดเต็มใน [students-import.md](students-import.md#สิทธิ์ครูประจำชั้น).

### พฤติกรรมโค้ดปัจจุบัน
เส้นเกี่ยวกับ attendance ที่ครูประจำชั้นเขียนได้ (ไม่มี `requireFullSchoolScope`) ใน `school.routes.js`: POST /teacher-check (L902), PATCH /teacher-check/:logId/time (L920), POST /teacher-check/:logId/undo (L933), POST /self-travel (L848), POST /self-travel/:id/undo (L860), PATCH /self-travel/:id/time (L873), POST /backdated-attendance (L2773) — ทั้งหมดส่ง `gradeFilter` ให้ service. คอมเมนต์ L820-824 ระบุว่า teacher-check "OPEN to grade teachers". ส่วน `/checkin-override*` (L702/759) และ `/checkin/:logId/void` (L2720) ถูกบล็อกด้วย `requireFullSchoolScope`.

### นโยบายที่รอเจ้าของยืนยัน
เจ้าของระบบยังไม่ได้ยืนยันว่านี่คือนโยบายที่ตั้งใจหรือไม่ เอกสารนี้ไม่ตัดสินว่าโค้ดถูกหรือผิด.

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(attendanceOutcome|attendanceStatistics|attendanceMigration|backdatedAttendanceTerm|selfTravel.unit|checkinDeadlockRetry|driverOverrideIndicator|driverCheckinEnrollmentLeave|gpsRecordedAtGuard|riderCountAcrossTermRollover|leaveDateCalendar|gradeTeacherEntry|transactionRetry)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `driver.test.js`, `backdatedAttendance.test.js`, `selfTravel.test.js`, `teacherCheck.test.js`, `schoolOverride.test.js`, `checkinConcurrencyMultiStudent.test.js`, `checkinEmergencyConcurrency.test.js`, `checkoutAllAfterVoid.test.js`, `checkoutRequiresBoarding.test.js`. Frontend: `frontend/tests/classroomAttendance.test.mjs`.

## ความเสี่ยงที่ทราบ
- `checkin.service.js` 1861 บรรทัด รวม driver/override/teacher/void ในไฟล์เดียว
- `driver.routes.js` 1553 บรรทัด และ `school.routes.js` 2804 บรรทัด ถือ handler ของโมดูลนี้ปนกับโมดูลอื่น

## หลายเที่ยวต่อรอบ (2026-11-12)
คนขับเริ่มเที่ยวถัดไปพร้อมเหตุผล (`/api/driver/trips`) เมื่อรถว่างและเที่ยวปัจจุบันมีเด็กขึ้นแล้ว · ตาราง `vehicle_trips` (migration 062) ไม่แก้ `checkin_logs` · โรงเรียน/สังกัด/จังหวัดดูสรุปที่ `/api/*/vehicle-trips` · flag `FEATURE_MULTI_TRIP` — รายละเอียด: [docs/ops/multi-trip.md](../ops/multi-trip.md)
