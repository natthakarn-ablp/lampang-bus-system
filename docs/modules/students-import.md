# students-import — นักเรียน, นำเข้า, เลื่อนชั้น, คำขอแก้รายชื่อจากคนขับ

## หน้าที่
จัดการข้อมูลนักเรียนระดับโรงเรียน (แก้ไข, ย้ายรถ, ลบแบบ soft delete, กู้คืน), นำเข้าไฟล์ CSV/XLSX แบบ preview → apply → rollback,
เลื่อนชั้นปีการศึกษา และรับ/อนุมัติคำขอเพิ่ม-ถอดรายชื่อที่คนขับส่งมา. ส่วนใหญ่อยู่ใน `school.routes.js` ที่ใหญ่มาก (ไฟล์เดียวรวมหลายโมดูล).

## จุดเข้า
Mount (`app.js` ~L183-184): `/api/school/promotion` (ก่อน) แล้ว `/api/school`. ทุกเส้นผ่าน `authenticate, requireRole('school','admin')` (`school.routes.js:164`). ไม่มี feature flag. ไม่มี `POST /students` สำหรับสร้างทีละคน — นักเรียนใหม่เข้าทาง import หรือ roster request.

- GET /api/school/students, /students/classrooms, /students/deleted-search — รายการ/ห้องเรียน/ค้นหาที่ลบแล้ว
- PUT /students/:id — แก้ข้อมูลนักเรียน+ผู้ปกครอง (L980)
- POST /students/move — ย้ายรถ (L1182)
- DELETE /students/:id — soft delete (L1226)
- POST /students/:id/restore — กู้คืน (L1420)
- GET /students/template — ดาวน์โหลดแม่แบบ (L1854)
- POST /students/import — นำเข้าแบบเดิมครั้งเดียว (L1933, full-school เท่านั้น)
- POST /students/import/preview (L2263); POST /students/import/:batchId/apply (L2288); GET /students/import/batches, /:batchId, /:batchId/report; POST /students/import/:batchId/rollback (L2345)
- GET /roster-requests; PUT /roster-requests/:id — ดู/อนุมัติคำขอจากคนขับ (L946/961, PUT เป็น full-school)
- POST /students/:id/claim-code, POST /claim-codes, POST /students/:id/parent-line/unlink — ดู [line-parent.md](line-parent.md)
- GET /api/school/promotion/preview, POST /api/school/promotion/apply — เลื่อนชั้น (`schoolPromotion.routes.js:31,39`; ครูประจำชั้นถูกบล็อกทั้ง router, L13-18)
- โอนย้ายข้ามโรงเรียน: ดู [transfers.md](transfers.md)

## โค้ดหลัก
- `backend/src/routes/school.routes.js` (2804) — handlers ข้างต้น, helpers `resolveSchoolId`, `resolveGradeScope` (L76), `teacherGradeScope` (L84), `requireFullSchoolScope` (L96)
- `backend/src/services/school.service.js` (620) — `getStudents`, `restoreStudent` (L519), `searchDeletedStudents`
- `backend/src/services/studentImportPreview.service.js` (965) — `runPreview`, `analyzeRows`, `applyBatch` (L755), `applyInsertRow`, `applyGuardianRow`, `applyReactivateRow`, `rollbackBatch` (L950), `assertScopedBatch`
- `backend/src/utils/studentImport.js` (18), `studentImportClassifier.js` (128), `gradeScope.js` (77: `normalizeGrade`, `gradeEquivalents`)
- `backend/src/services/schoolPromotion.service.js` (159) `previewPromotion`/`applyPromotion`; `schoolYearPromotionMigration.service.js` (86)
- `backend/src/services/rosterRequest.service.js` (464) — `createRequest` (ฝั่งคนขับ), `reviewRequest` (L271)
- `backend/src/services/idAllocator.service.js` (36) — ออกรหัสนักเรียน

## ข้อมูลที่รับผิดชอบ
- `students`, `parents`, `parent_student`, `import_batches` — 001_initial_schema.sql
- `import_batch_rows` — 027_import_preview.sql (ประวัติ/rollback เพิ่มใน 031_import_history_rollback.sql)
- `id_sequences` — 029_student_id_sequence.sql
- `school_year_promotions` — 055_school_year_promotions.sql
- `roster_change_requests` — 008_phase8_leaves_requests.sql (เพิ่มนักเรียนใหม่ 009)
- `registration_roster_students` (รายชื่อลงทะเบียนรถ) — 044 ดู [vehicles-drivers.md](vehicles-drivers.md)

## จุดเชื่อม
- เรียก: `audit.logAudit`, `idAllocator`; การผูกผู้ปกครองหลังนำเข้าใช้ `linkParent` ใน studentImportPreview.service.js (L395)
- ถูกเรียกโดย: driver.routes (ส่ง roster request), [transfers.md](transfers.md), [attendance.md](attendance.md) (อ่านรายชื่อ)

## กติกาสำคัญ
- Soft delete เท่านั้น (`is_deleted`, `deleted_at`, ถอด `vehicle_id`) — `school.routes.js:1226`, `schoolPromotion.service.js:116`
- แถวนำเข้าถูกล็อก `FOR UPDATE` ตอน apply/rollback — `studentImportPreview.service.js:479,560,682`
- ออกรหัสผ่าน allocator แบบ atomic แทน `MAX(id)+1` — `idAllocator.service.js:18`, `rosterRequest.service.js:347`
- reviewRequest ล็อกคำขอ `FOR UPDATE` และสถานะต้อง `pending` — `rosterRequest.service.js:277-281`
- เลื่อนชั้นรันใน transaction, ล็อกนักเรียนทั้งโรงเรียน, กันซ้ำด้วย `school_year_promotions` — `schoolPromotion.service.js:82-94`
- restore: transaction + `FOR UPDATE` + audit — `school.service.js:522-590`
- ทุก handler คิด `school_id` จาก token (`resolveSchoolId`); admin ต้องส่ง `school_id` เอง — `school.routes.js:48-52`
- การแก้ที่ทำโดยครูประจำชั้นตรวจเกรดซ้ำใน SQL (`grade <=> ?`) — `school.routes.js:1063`

## สิทธิ์ครูประจำชั้น
ครูประจำชั้น = `role='school'` และ `users.grade_scope` ไม่ว่าง (ค่าจาก JWT -> `req.user.gradeScope`). CLAUDE.md §8 ระบุว่าอ่านอย่างเดียว แต่โค้ดอนุญาตการเขียนหลายเส้น.

### พฤติกรรมโค้ดปัจจุบัน
เส้นที่เขียนได้ (ไม่มี `requireFullSchoolScope`) และเงื่อนไขที่โค้ดบังคับ (ทั้งหมดใน `backend/src/routes/school.routes.js`):
- PUT /api/school/students/:id — L980-996 เฉพาะฟิลด์ prefix, first_name, last_name, grade, classroom, morning_enabled, evening_enabled, parent_name, parent_phone และเกรดใหม่ต้องเท่าเกรดตน
- POST /students/move — L1182, เช็คเกรดนักเรียน L1195
- DELETE /students/:id — L1226, เช็คเกรด L1244
- POST /students/:id/restore — L1420 ส่ง `gradeScope` เข้า `school.service.js:519`
- POST /students/import/preview — L2263 (ห้าม `auto_create_vehicle`, L2273); POST /students/import/:batchId/apply — L2288 ได้เฉพาะ `mode='insert_ready'` ครั้งละ 1 คน ไม่มี confirm/auto-vehicle (L2297) และ `assertScopedBatch` (L2301)
- POST /leave (L643; วันนี้เท่านั้น รอบ morning/evening L659) และ DELETE /leaves/:id (L686)
- POST /self-travel (L848), POST /self-travel/:id/undo (L860), PATCH /self-travel/:id/time (L873)
- POST /teacher-check (L902), PATCH /teacher-check/:logId/time (L920), POST /teacher-check/:logId/undo (L933) — คอมเมนต์ L820-824 ระบุ "OPEN to grade teachers"
- POST /backdated-attendance (L2773, ส่ง `gradeFilter` L2786)
- **จุดรับส่ง (เจ้าของยืนยัน 2026-11-11)**: POST /pickup-points (รถต้องมีนักเรียนสายชั้นตน, นักเรียนที่ผูกต้องเป็นสายชั้นตน), PUT /pickup-points/:id/students (แทนที่เฉพาะแถวสายชั้นตน ผ่าน `restrictToGrade`), DELETE /pickup-points/:id (ได้เฉพาะจุดที่ไม่มีนักเรียนสายชั้นอื่น/โรงเรียนอื่น — 409 `POINT_SHARED_WITH_OTHER_GRADE`)
- GET /students/export — Excel รายชื่อนักเรียนตามตัวกรองหน้า "นักเรียน" (ค้นหา/สายชั้น/ห้อง/ผูกรถ) เฉพาะที่ยังไม่ถูกลบ สูงสุด 5,000 คน; ครูถูกจำกัดที่สายชั้นตน; ไม่มีข้อมูลผู้ปกครอง/ที่อยู่; audit `student_list_xlsx`
- GET /grade-vehicle-summary (+ `?format=xlsx`) — สรุปนักเรียนผูกรถ/ยังไม่ผูกรถตามสายชั้น; บัญชีโรงเรียนเห็นทุกสายชั้น ครูเห็นเฉพาะสายชั้นตน; export เขียน audit `grade_vehicle_summary_xlsx`
- POST /vehicles (L1501; ห้ามกรอก driver_name/driver_phone/owner_name L1506) และ PUT /vehicles/:id (L1666; แก้ได้เฉพาะ vehicle_type, owner_name, owner_phone L1682)

เส้นที่ถูกบล็อกด้วย `requireFullSchoolScope`: checkin-override, roster-requests PUT, import แบบเดิม/rollback, transfer, vehicle requests, teacher-accounts, claim-codes, parent-line unlink, checkin void, audit-logs; และ `/api/school/promotion/*` ทั้ง router.

### นโยบายที่รอเจ้าของยืนยัน
เจ้าของระบบยังไม่ได้ยืนยันว่าสิทธิ์เขียนข้างต้นเป็นนโยบายที่ตั้งใจหรือไม่ เอกสารนี้ไม่ระบุว่าโค้ดถูกหรือผิด. ต้องรอการตัดสินใจก่อนแก้ CLAUDE.md §8 หรือโค้ด.

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(schoolScope|gradeScope|gradeTeacherEntry|gradeTeacherProfileEdit.unit|guardianEditScope|schoolPromotion|schoolYearPromotionMigration|studentImport|rosterAddScope|rosterRequestStaleApproval|importTransferredOut|restoreTransferredStudent|schoolInputValidation)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `school.test.js`, `studentImportScope.test.js`, `studentImportClassifier.test.js`, `importApplyModes.test.js`, `importPreviewWiring.test.js`, `importRollback.test.js`, `importStaleRowCounters.test.js`, `studentImportBatchReporting.test.js`, `gradeScopeCounts.test.js`, `gradeTeacherProfileEdit.test.js`, `idAllocator.test.js`, `studentPrivacySweep.test.js`. ฝั่ง frontend: `frontend/tests/classroomAttendance.test.mjs`, `driverRosterRetry.test.mjs` (`node --test`).

## ความเสี่ยงที่ทราบ
- `school.routes.js` 2804 บรรทัด รวมนักเรียน/รถ/ลา/จุดรับ/ครู/ย้ายโรงเรียน ในไฟล์เดียว; export `resolveGradeScope` ท้ายไฟล์ (L2804) ให้ module อื่นใช้
- `studentImportPreview.service.js` 965 บรรทัด
- POST /students/import แบบเดิม (L1933-2236) ยาว ~300 บรรทัดใน route โดยตรง

## ครูประจำชั้นรายห้อง (2026-11-12)
ตาราง `homeroom_teachers` (migration 061) แก้ได้เฉพาะบัญชีหลักของโรงเรียน ผ่าน `/api/school/homeroom-teachers` และ `services/homeroom.service.js` · แนบชื่อครูเข้ากับรายชื่อนักเรียน/Excel, หน้าเช็กชื่อรายห้อง, รายชื่อของคนขับ และสถานะ LINE ผ่าน `attachHomeroomTeachers()` เมื่อ `FEATURE_HOMEROOM_TEACHERS=true` — รายละเอียดและขั้นตอนเปิดใช้: [docs/ops/homeroom-teachers.md](../ops/homeroom-teachers.md)

## ลบนักเรียนหลายคน (2026-11-12)
`POST /api/school/students/bulk-delete { student_ids: [...] }` (≤500) — กติกาเดียวกับ `DELETE /students/:id` ทุกคน (โรงเรียนตาม token, ยังไม่ถูกลบ, ครูสายชั้นเฉพาะชั้นตน), soft delete + ถอดรถ + ล้างจุดรับส่ง + audit รายคน ใน transaction เดียว · id ที่ไม่เข้าเงื่อนไขส่งกลับใน `skipped` ไม่ถูกแตะ · หน้าจอ: ช่องเลือก + "ลบที่เลือก" ใน `StudentSearch.jsx` (เลือกทีละหน้า, หน้าละ 20/50/100)
