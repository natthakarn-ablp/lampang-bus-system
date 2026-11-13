# vehicles-drivers — รถ, คนขับ, การมอบหมาย, เอกสาร, กะ, ลงทะเบียนรถ

## หน้าที่
จัดการข้อมูลรถ (ทะเบียนเป็นเอกลักษณ์ตามรูปแบบ normalized, รวม/ลบ/แก้), คนขับและบัญชีคนขับ (ปิด/กู้/ย้ายรถ/จบการมอบหมาย), การเลือกกะ (shift) ของคนขับ,
เอกสารรถ/คนขับ (อัปโหลด/ตรวจ/ดูแบบจำกัดสิทธิ์) และการลงทะเบียนรถที่คนขับเริ่ม (roster นักเรียนต่อโรงเรียน). การตรวจสภาพรถอยู่ที่ [verification-inspection.md](verification-inspection.md).

## จุดเข้า
Mount: `/api/driver` (`driver.routes.js`, `router.use(authenticate, requireRole('driver'))` L109, ไม่มี flag), `/api/school` (ส่วนรถ), `/api/admin`.
Flag `FEATURE_DRIVER_REGISTRATION` (`env.features.driverRegistration`, `app.js:161-170`) เปิด: `/api/driver/registrations`, `/api/school/registrations`, `/api/documents`. Flag `FEATURE_DRIVER_SHIFT_SELECTION` บังคับให้ต้องมี active shift (`driver.routes.js:129`, `checkin.service.js:79`).

- คนขับ (`driver.routes.js`): GET /authorized-vehicles (L164), GET /active-shift (L171), POST /shifts/start (L178), POST /shifts/:id/end (L210), GET/PUT /profile (L756/826), GET/POST /profile/photo (L923/950), POST /change-password (L992), GET /search-students (L1079), GET /schools (L1122), POST/GET /roster-request(s) (L1133/1157), POST/GET /applications (L1487/1499), GET /applications/:id (L1510)
- ลงทะเบียน (flag, `registration.routes.js`) ฝั่งคนขับ: POST /students (L82), GET / (L99), DELETE /students/:id (L107), POST /documents/vehicle (L125), POST /documents/driver (L141), GET /documents (L158), DELETE /documents/:kind/:id (L172)
- ลงทะเบียน ฝั่งโรงเรียน: GET /documents/vehicle/:vehicleId (L219), GET /documents/driver/:driverId (L231), POST /documents/:kind/:id/review (L244), GET / (L266), GET /:applicationId (L274), POST /:applicationId/students/:rosterId/match (L287), PATCH .../students/:rosterId (L306), POST /:applicationId/approve (L325), POST /:applicationId/reject (L338)
- เอกสาร (flag): GET /api/documents/:docType/:id/file (`documents.routes.js:39`; role driver/school/transport/admin, ครูประจำชั้นถูกบล็อก L27)
- โรงเรียน (`school.routes.js`): GET /vehicles (L272), /vehicles/all (L1440), /vehicles/check-plate (L1462), POST /vehicles (L1501), PUT /vehicles/:id (L1666), คำขอรถ GET/POST /vehicles/requests (L2452-2474, full-scope)
- admin (`admin.routes.js`): POST /drivers/preflight (L2083), POST /drivers/:userId/restore|deactivate|reassign-vehicle (L2090-2112), POST /driver-assignments/:assignmentId/end (L2127), GET /driver-integrity (L2077), DELETE /vehicles/:id (L2163), PUT /vehicles/:id (L2181), POST /vehicles/:id/merge (L2202), GET/POST /vehicle-requests (L2008-2037)
- วันหมดอายุเอกสารรถ + แก้ทะเบียนพิมพ์ผิด (2026-11-13): transport/admin `PUT /api/transport/vehicles/:id/document-expiry` (ทะเบียน/พ.ร.บ./ภาษี เท่านั้น, คำนวณ verification_status ใหม่; โรงเรียนไม่มีสิทธิ์แก้ ตามหลัก SCH-VEH-3) — `services/vehicleDocumentExpiry.service.js`; transport/admin `POST /api/transport/vehicles/:id/fix-plate` และ admin `POST /api/admin/vehicles/:id/fix-plate` (ต้องมีเหตุผล) — `vehicleAdmin.fixPlate` เปลี่ยนทะเบียน + ชื่อผู้ใช้คนขับที่ตั้งตามทะเบียนเดิมใน transaction เดียว, 409 ถ้าชื่อผู้ใช้ใหม่ถูกใช้แล้ว; UI ที่ `TransportVehicleList.jsx` (admin เข้าจากเมนู)
- ขนส่ง: POST /api/transport/vehicles (`transport.routes.js:36`), GET /vehicles/check-plate (L23)

## โค้ดหลัก
- `services/vehicleAdmin.service.js` (300) — `softDeleteVehicle` (L80), `correctVehicle` (L136), `mergeVehicles` (L231); `vehicleDedup.service.js` (130) — `findPlateMatches`, `preflightStatus`; `utils/vehiclePlate.js`, `utils/plateIdentity.js`
- `services/driverProfile.service.js` (171) — `linkOrCreateDriverForVehicle` (L75), `generateTemporaryPassword`
- `services/driverLifecycle.service.js` (162) — `restoreDriver`, `deactivateDriver` (L74), `reassignDriverVehicle` (L90), `endAssignment` (L130)
- `services/driverShift.service.js` (334) — `startShift` (L56), `endShift` (L159), `authorizeDriverForVehicle` (L218), `verifyDriverQualification` (L284)
- `services/driverDocuments.service.js` (424) — `addVehicleDocument`, `addDriverDocument`, `reviewDocument` (L243), `resolveDocumentForViewer` (L389), `safeResolveStorageKey` (L59)
- `services/vehicleRegistration.service.js` (595) — `addRosterStudent` (L111), `approveRegistration` (L416), `rejectRegistration` (L461); `vehicleRequest.service.js` (214)
- `routes/driver.routes.js` (1553), `routes/registration.routes.js` (351), `routes/documents.routes.js` (105)

## ข้อมูลที่รับผิดชอบ
- `vehicles`, `drivers`, `driver_vehicle_assignments`, `vehicle_attendants`, `users` (บัญชีคนขับ) — 001_initial_schema.sql
- plate ไม่ซ้ำ: 023_vehicle_expiry_and_normalization.sql, 024_unique_vehicle_normalized_plate.sql (`uq_vehicles_normalized_plate`), 030_vehicle_canonical_identity.sql; โรงเรียนผู้รับรอง 012_certifying_school.sql
- `vehicle_requests` — 033_vehicle_requests.sql; คอลัมน์ QR token — 034_vehicle_qr_codes.sql
- `driver_display_status` — 036; `driver_risk_records` — 037; `driver_qualifications`, `vehicle_operating_shifts` — 039_driver_pool_and_shifts.sql
- `registration_roster_students` — 044_driver_registration_roster.sql; `vehicle_documents`, `driver_documents` — 045_driver_documents.sql

## จุดเชื่อม
- `checkin.service` หารถ/กะของคนขับ (`getDriverVehicle`, `resolveVehicleShiftIndependent`) → [attendance.md](attendance.md)
- การลงทะเบียนใช้ `vehicle_inspection_applications` ของ [verification-inspection.md](verification-inspection.md) (`vehicleRegistration.service.js:50`); roster นักเรียนเทียบกับ [students-import.md](students-import.md)
- บัญชี/รหัสผ่านคนขับ → [auth-session.md](auth-session.md), [admin-ops.md](admin-ops.md); ตำแหน่งรถ → [pickup-gps-eta.md](pickup-gps-eta.md)

## กติกาสำคัญ
- ทะเบียนซ้ำ (normalized) ห้ามสร้าง — UNIQUE ใน migration 024:58 และตรวจก่อนด้วย `vehicleDedup.preflightStatus`
- ลบ/แก้/รวมรถ: transaction + `FOR UPDATE` + audit — `vehicleAdmin.service.js:83-84,118-120,139-140,215,238`; `mergeVehicles` ย้าย FK ลูกตามลำดับที่ปลอดภัย (คอมเมนต์ L8)
- คนขับ 1 คนเปิดกะได้ 1 กะ และรถ 1 คันมี 1 กะเปิด (`uq_open_shift_driver`, `uq_open_shift_vehicle`, migration 039:66-67); `startShift` ล็อกแถวคนขับ/กะ — `driverShift.service.js:66-106`
- Lifecycle คนขับ (ปิดบัญชี/ย้ายรถ/จบ assignment) audit ทุกครั้ง — `driverLifecycle.service.js:83,109,122,135`
- เอกสาร: path ต้องอยู่ใน `uploads/documents` (กัน path traversal) — `driverDocuments.service.js:34,59-66`; เพิ่มเอกสารล็อกรถ `FOR UPDATE` ใน transaction — L131-133; การดูไฟล์ถูก audit ก่อนส่งด้วย `auditExportBeforeSend` — `documents.routes.js:78`
- เขียนผ่านโรงเรียน: ครูประจำชั้นกรอกคนขับ/เจ้าของรถไม่ได้ (`school.routes.js:1506`), แก้ได้เฉพาะ vehicle_type/owner_name/owner_phone (L1682); ประกันรถแก้ได้เฉพาะระบบคนขับ (`INSURANCE_OWNER_ONLY`, L1671-1680)
- คำขอรถ approve ล็อกคำขอ `FOR UPDATE` และผลลัพธ์ idempotent (`ALREADY_APPLIED`/`FAILED`) — `vehicleRequest.service.js:127-141`
- ลงทะเบียนรถ: schoolRouter ต้อง `requireFullSchoolScope` (`registration.routes.js:216`); match/แก้ roster ล็อกแถว `FOR UPDATE` — `vehicleRegistration.service.js:332-334`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(driverDocuments|driverProfile|driverReuseScope|driverPermissionWorkflow|driverTemporaryPassword|driverEndedAssignment|emergencyShiftFallback|vehiclePlateStrict|vehicleRegistrationService|registration|schoolVehicle|vehicleVerificationDriverScope|usernameCollision|staffReadCapacity)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `driver.test.js`, `driverLifecycle.test.js`, `driverShift.test.js`, `driverReactivation.test.js`, `driverOnboardingLink.test.js`, `driverVehicleResolution.test.js`, `vehicleRequest.test.js`, `vehiclePlate.test.js`, `structuredPlate.test.js`, `vehicleCanonicalDb.test.js`, `transportVehicleDedup.test.js`, `onboardingDedup.test.js`. Frontend (`node --test`): `frontend/tests/driver*.test.mjs`.

## ความเสี่ยงที่ทราบ
- `driver.routes.js` 1553 บรรทัด และ `school.routes.js` 2804 บรรทัด (ส่วนรถ L1440-1750) รวมหลายโมดูล
- `requireFullSchoolScope` ถูกนิยามซ้ำในไฟล์ของตัวเอง (`registration.routes.js:204`, `documents.routes.js:29`) นอกจาก `school.routes.js:96` — แก้ข้อความ/เงื่อนไขต้องแก้หลายที่
