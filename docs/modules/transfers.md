# transfers — โอนย้ายนักเรียนข้ามโรงเรียน / ข้ามสังกัด

## หน้าที่
โรงเรียนต้นทางยื่นคำขอโอนย้ายนักเรียนไปโรงเรียนปลายทาง; ผู้อนุมัติขึ้นกับทิศทาง: ภายในสังกัดเดียวกัน = สังกัด (affiliation) พิจารณา,
ข้ามสังกัด = โรงเรียนปลายทางพิจารณา; admin อนุมัติได้ทุกกรณี. เมื่ออนุมัติ ระบบสร้างแถวนักเรียนใหม่ที่โรงเรียนปลายทางและ soft delete แถวเดิม.

## จุดเข้า
ไม่มี feature flag. ทุกเส้นอยู่ใต้ router แม่ที่ `authenticate` + role.

โรงเรียน (`school.routes.js`, ทั้งหมด `requireFullSchoolScope`):
- POST /api/school/students/:studentId/transfer-request — ยื่นคำขอ (L2434)
- GET /api/school/students/transfer-requests (L2374); GET /students/transfer-requests/:id (L2397) — คำขอเข้า/ออก
- POST /students/transfer-requests/:id/cancel (L2382); /approve (L2406); /reject (L2420) — ยกเลิก (ต้นทาง) / อนุมัติ-ปฏิเสธ (ปลายทาง)

สังกัด (`affiliation.routes.js`): GET /api/affiliation/transfer-requests (L806), GET /:id (L816), POST /:id/approve (L828), POST /:id/reject (L850)
admin (`admin.routes.js`, admin เท่านั้น): GET /api/admin/student-transfer-requests (L1962), GET /:id (L1970), POST /:id/approve (L1980), POST /:id/reject (L1996)

## โค้ดหลัก
- `backend/src/services/studentTransfer.service.js` (376) — `createRequest` (L21), `isCrossAffiliation` (L67), `approveAsDestinationSchool` (L144), `rejectAsDestinationSchool`, `cancelRequest` (L156), `approveAndApply` (L193), `reject` (L288), `listForAffiliation` (L314), `assertAffiliationCanDecide` (L347), `approveOutcomeMessage` (L359)

## ข้อมูลที่รับผิดชอบ
- `student_transfer_requests` — 032_student_transfer_requests.sql
- เขียนต่อ: `students` (แถวใหม่ + soft delete แถวเดิม), `parent_student` (คัดลอกลิงก์ผู้ปกครอง) — ตารางสร้างใน 001
- `audit_logs` (entityType `student_transfer_request`, `student`)

## จุดเชื่อม
- นักเรียน/ผู้ปกครองดู [students-import.md](students-import.md), [line-parent.md](line-parent.md)
- คิวคำขอฝั่ง admin/สังกัด ดู [admin-ops.md](admin-ops.md), [affiliation-province.md](affiliation-province.md)

## กติกาสำคัญ
- ห้ามมีคำขอ PENDING ซ้ำของนักเรียนคนเดียวกัน (409) — `studentTransfer.service.js:42-43` (ใน `createRequest`)
- อนุมัติทำใน transaction และล็อกคำขอ `FOR UPDATE`; ผลซ้ำคืน `ALREADY_APPLIED` (idempotent) — `studentTransfer.service.js:193-201`
- ถ้านักเรียนต้นทางเปลี่ยนไประหว่างรอ (stale) → สถานะ `STALE_NEEDS_REVIEW` และ audit — `studentTransfer.service.js:205-207`; โรงเรียนปลายทางหาย/รหัสซ้ำที่ปลายทาง → `FAILED`
- ภายในสังกัดเดียวกัน โรงเรียนปลายทางอนุมัติไม่ได้ (`SAME_AFFILIATION_AFFILIATION_DECIDES`) — `studentTransfer.service.js:138-148`; ข้ามสังกัด สังกัดอนุมัติไม่ได้ (`CROSS_AFFILIATION_DESTINATION_SCHOOL_DECIDES`) — L347-353
- แถวนักเรียนเดิมถูก soft delete และถอด `vehicle_id` ตอน apply — `studentTransfer.service.js:215`
- ข้อผิดพลาดที่ไม่ใช่ statusCode ทำให้คำขอ PENDING → `FAILED` พร้อม audit — `studentTransfer.service.js:281-282`
- ปุ่มของโรงเรียนทั้งหมดปิดสำหรับครูประจำชั้น (`requireFullSchoolScope`)


## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(crossAffiliationTransfer|studentTransferGuardianLinks|importTransferredOut|transferAuditTrail|restoreTransferredStudent)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `studentTransfer.test.js`.

## ความเสี่ยงที่ทราบ
- ตรรกะ "ใครอนุมัติได้" กระจายใน service 3 จุด (`approveAsDestinationSchool`, `assertAffiliationCanDecide`, admin `approveAndApply`) — แก้ต้องแก้ให้ครบ
- การสร้างนักเรียนใหม่ที่ปลายทางคัดลอกฟิลด์ด้วย INSERT ยาว (`studentTransfer.service.js:220`): คอลัมน์ใหม่ใน `students` ต้องมาเพิ่มที่นี่ด้วย (ยังไม่ได้ตรวจว่าครบทุกคอลัมน์)
