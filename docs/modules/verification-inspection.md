# verification-inspection — ตรวจสภาพรถ (transport) และคำขอส่งตรวจรถร่วมหลายโรงเรียน (verification)

## หน้าที่
มี 2 ระบบอยู่คู่กัน: (1) `/api/transport` บันทึกผลตรวจสภาพรถแบบเดิม (`vehicle_inspections`) และ dashboard/export ความปลอดภัย โดยผู้ใช้ขนส่ง;
(2) `/api/verification` กระบวนการ "คำขอส่งตรวจ" ที่โรงเรียนยื่น → ขนส่งตรวจตาม checklist → คำนวณสถานะ eligibility ของรถ (รวมเอกสาร, ความจุ, คนขับที่ผ่านคุณสมบัติ).

## จุดเข้า
Mount: `/api/transport` และ `/api/verification` (`app.js:188-189`), ไม่มี feature flag ระดับ mount; เส้นเอกสารตรวจใต้ `/api/verification/transport/documents/*` ปิดด้วย `requireDocFeature` (404 ถ้า `FEATURE_DRIVER_REGISTRATION` ปิด, `verification.routes.js:332`).

Transport (`transport.routes.js`, `router.use(authenticate, requireRole('transport','admin'))` L19): GET /dashboard (L136), GET /vehicles (L163), /vehicles/pending (L182), /vehicles/expiring (L199), /vehicles/:id (L231), GET /vehicles/:id/incident-roster (L212, no-store), GET/POST /inspections (L240/253), PUT /inspections/:id (L286), DELETE /inspections/:id (L319), GET /export/vehicles.csv (L144), GET /schools (L125), GET /pickup-map (L336)
Verification (`verification.routes.js`, `router.use(requireFullSchoolScope)` L38 ครอบทั้ง router):
- โรงเรียน: POST /school/applications (L40), GET /school/applications (L59), POST /applications/:id/ready (L90), POST /applications/:id/cancel (L108), POST /applications/:id/review (L128)
- หลาย role: GET /applications/:id (L71), GET /applications/:id/timeline (L151) (school/transport/province/admin[/driver])
- ขนส่ง: GET /transport/queue (L205), GET /transport/drivers (L215), POST /transport/vehicles/:id/drivers (L221), POST /transport/drivers/:id/qualification (L239), GET /transport/checklist (L260), POST /transport/applications/:id/start (L266), POST /transport/attempts/:id/finalize (L285), DELETE /transport/attempts/:id (L311)
- เอกสาร (flag): GET /transport/documents/vehicle/:vehicleId (L339), GET /transport/documents/driver/:driverId (L345), POST /transport/documents/:kind/:id/review (L353)
- admin: POST /api/admin/verification/applications/:id/cancel (`admin.routes.js:2142`)
- รับช่วง/ยกเลิกแทน (2026-11-13): POST /transport/attempts/:id/takeover (transport/admin, เหตุผล ≥5 ตัวอักษร — `inspected_by` ย้ายมาเป็นผู้กด, audit เก็บผู้ตรวจเดิม); GET /oversight/applications/stuck และ POST /oversight/applications/:id/cancel (transport ทั้งจังหวัด / affiliation เฉพาะโรงเรียนในสังกัด / admin) — ยกเลิกได้เมื่อคำขอไม่เคลื่อนไหว ≥3 วัน พร้อมเหตุผล; สังกัดยกเลิกไม่ได้ถ้ามีการตรวจค้าง (`overrideCancelApplication`, `takeoverInspectionAttempt`)
- รับรองรถโรงเรียน มพบ. 2564 (flag `FEATURE_SCHOOL_CERTIFICATION`, migration 063, 2026-11-14; `routes/certification.routes.js` mount `/api/certification` — 404 ทุกเส้นเมื่อปิด flag, ครูสายชั้น 403): โรงเรียน GET/PUT /school/window, GET /school/applications/:id/checklist, POST /school/applications/:id/certificate, GET /school/certificates, POST /school/certificates/:id/revoke, GET/POST /school/appointments, POST /school/appointments/:id/cancel · คนขับ GET /driver/overview, PUT /driver/caretaker · ขนส่ง/admin GET /transport/appointments, POST /transport/appointments/:id/confirm|done · GET /certificates/:id/pdf (โรงเรียนผู้ออก + โรงเรียนอื่นที่มีนักเรียนใช้รถคันนั้น (รถร่วม, อ่านอย่างเดียว)/คนขับรถตน/ขนส่ง/admin, audit EXPORT ก่อนส่ง) · คนขับ GET /api/driver/applications/rider-schools?vehicle_id= และ POST /api/driver/applications รับ `issuing_school_id` (ต้องเป็นโรงเรียนที่มีนักเรียนใช้รถ — ไม่ส่ง = โรงเรียนที่มีนักเรียนมากที่สุด) — รายละเอียด [docs/ops/apply-063.md](../ops/apply-063.md)
- คนขับยื่นคำขอ: `/api/driver/applications*` (`driver.routes.js:1487-1510`, `createDriverApplication` ใน vehicleVerification.service.js:1012)

## โค้ดหลัก
- `services/vehicleVerification.service.js` (1285) — `computeEligibility` (L50), `refreshVehicleEligibility` (L141), `createApplication` (L244), `transitionSchoolApplication` (L525), `startInspection` (L710), `finalizeInspection` (L783), `abortInspectionAttempt` (L908), `createDriverApplication` (L1012), `reviewApplication` (L1207)
- `services/schoolCertification.service.js` — หนังสือรับรอง (`issueCertificateInTx` เลขที่ `<school>/<term>/<0001>` ใต้ล็อกแถวโรงเรียน, มีผลถึงสิ้นภาคเรียนจาก `term.service.getTermEndDate`), `revokeCertificate`, `getDocumentChecklist`, ช่วงรับเอกสาร, ผู้ดูแลนักเรียน, นัดตรวจ; กติกา pure: `capExpiryToTerm`, `fixDeadlineFor` (+15 วัน), `certificateReasons`
- `services/transport.service.js` (631) — `getDashboard`, `getVehicles`, `createInspection` (L430), `updateInspection` (L486), `deleteInspection` (L582), `getSafetyExportRows`, `assertLegacyWritable` (L60)
- `services/transportIncident.service.js` (109) — `getIncidentVehicle` (รายชื่อ roster ฉุกเฉิน ถูก audit แยก)
- `services/driverDocuments.service.js` — `reviewDocument` ([vehicles-drivers.md](vehicles-drivers.md)); `config/transportPermissionContract.js`, `driverPermissionContract.js`

## ข้อมูลที่รับผิดชอบ
- `vehicle_inspections` — 001_initial_schema.sql
- `inspection_checklist_templates`, `inspection_checklist_items`, `vehicle_inspection_applications`, `inspection_application_schools`, `inspection_attempts`, `inspection_checklist_results`, `inspection_evidence` — 038_shared_vehicle_verification.sql
- `driver_qualifications` — 039_driver_pool_and_shifts.sql; `vehicle_documents`, `driver_documents` — 045_driver_documents.sql (เจ้าของโค้ด: vehicles-drivers)
- คอลัมน์ verification/eligibility บน `vehicles` เพิ่มใน 038 (ยังไม่ได้ตรวจชื่อคอลัมน์ครบ)
- `school_transport_certificates`, `school_certification_windows`, `inspection_appointments`, `inspection_appointment_vehicles`, `vehicles.caretaker_*`, `vehicle_inspection_applications.fix_deadline`, แบบตรวจ `LAMPANG_SCHOOLBUS` v2 — 063_school_transport_certification.sql

## จุดเชื่อม
- การลงทะเบียนรถของคนขับสร้าง/ใช้ application เดียวกัน (`vehicleRegistration.ensureApplicationForVehicle`) → [vehicles-drivers.md](vehicles-drivers.md)
- เอกสาร, คนขับที่ผ่านคุณสมบัติ ป้อนเข้า `computeEligibility`; incident roster ใช้ข้อมูลนักเรียน → [students-import.md](students-import.md)
- นโยบาย/หลักฐานการยืนยันก่อนเขียน (`consumePolicyAction`) → [consent-qr-policy-participation.md](consent-qr-policy-participation.md)

## กติกาสำคัญ
- ผลตรวจที่ผ่านคิวใหม่ (finalized attempt) แล้ว ห้ามแก้ผ่านระบบ legacy — `transport.service.js:60-72` (`assertLegacyWritable`)
- สร้าง/แก้ผลตรวจใน transaction + ล็อก `FOR UPDATE` — `transport.service.js:439-441,492-497`; audit — `transport.routes.js:114,150,219`
- ผลตรวจที่ยอมรับ: PASSED/FAILED/NEEDS_FIX/PENDING — `transport.routes.js:259-262`
- การเขียนสำคัญใช้ `consumePolicyAction` ก่อน — `transport.routes.js:146,263,297`
- `/api/transport` ไม่เห็น PII นักเรียนในรายการปกติ (ไม่มี roster-size/ชื่อนักเรียน, คอมเมนต์ `transport.service.js:74-80`); ดู roster ผ่านเส้น incident เท่านั้น ซึ่ง audit แยก
- คำขอ 1 คัน 1 ใบที่ active: `active_request_key` UNIQUE — migration 038:49; `createApplication` ล็อกซ้ำที่ `vehicleRegistration.service.js:50` (ผ่านทางลงทะเบียน)
- ครูประจำชั้นถูกปฏิเสธทั้ง router (อ่านด้วย) — `verification.routes.js:36-38`
- `eligibility` จะเป็น `SUSPENDED` ถ้ารถถูกระงับ — `vehicleVerification.service.js:189`
- เมื่อเปิด `FEATURE_SCHOOL_CERTIFICATION`: อนุมัติคำขอจากคนขับ (`reviewApplication`) หรือยืนยันพร้อมพิมพ์ (`transitionSchoolApplication` → READY_TO_PRINT) ออกหนังสือรับรองใน transaction เดียวกัน (นอกช่วงรับเอกสาร = เตือน ไม่บล็อก) · `startInspection` ตอบ 409 `CERTIFICATE_REQUIRED` ถ้าไม่มีหนังสือรับรองที่ยังมีผล (admin ข้ามได้) · `finalizeInspection` ผ่าน = วันหมดอายุ default/สูงสุด = สิ้นภาคเรียน (400 `EXPIRY_AFTER_TERM_END`), ต้องแก้ไข/ไม่ผ่าน = `fix_deadline` วันนี้+15 · `computeEligibility` เพิ่ม `CERTIFICATE_MISSING|EXPIRED|REVOKED` และ EXPIRING ≤30 วัน · แบบตรวจ v2 ใช้เฉพาะตอนเปิด flag (`resolveChecklistTemplate`); ปิด flag = พฤติกรรมเดิมทุกอย่าง
- **รถร่วมหลายโรงเรียน** (ทดสอบ 2026-11-14, `tests/certThreeSchoolScenario.test.js`): โรงเรียนผู้ออก (issuing school ของคำขอ) เท่านั้นที่ตรวจ/ออก/เพิกถอนหนังสือรับรองและนัดตรวจ — โรงเรียนอื่นที่มีนักเรียนใช้รถคันนั้นได้ 403 `ISSUING_SCHOOL_REQUIRED` (โรงเรียนที่ไม่เกี่ยวข้อง 404) แต่ **ดูได้**: รายการ/รายละเอียด/timeline ของคำขอ, checklist (`viewer_is_issuer:false`), `GET /school/certificates` (`is_issuer:false`) และ PDF · checklist นับนักเรียนของโรงเรียนผู้ออก + `total_count`/`schools` ทุกโรงเรียน; snapshot และ PDF ระบุจำนวนรวมทุกโรงเรียน (ชื่อโรงเรียน+จำนวน ไม่มีชื่อเด็ก) · ออกหนังสือรับรองเมื่อโรงเรียนอื่นเพิกถอนรถคันเดียวกันในภาคเรียนนี้ = เตือน `REVOKED_BY_OTHER_SCHOOL` ไม่บล็อก
- คิวงานรอ (`pendingQueue.service.js`, flag เดียวกัน): `inspection_appointments` (ขนส่ง), `certificate_expiring` (โรงเรียน, ไม่แจ้งเตือน), `fix_overdue` (แจ้งโรงเรียนผู้ออกและขนส่งครั้งเดียวทันทีที่เลยกำหนด ไม่ยกเลิกอัตโนมัติ; รถร่วม: โรงเรียนอื่นไม่ได้รับการแจ้ง แต่เห็น "เลยกำหนดยื่นใหม่" (`fix_overdue`) ในรายการคำขอของตน)

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(schoolCertification|transportInspectionHardening|transportIncident|transportIncidentRoute|transportPermissionWorkflow|transportRoleSafety|transportVehicles|transportExportRoute|inspectionMgmt|verificationTeacherBlock|verificationTimelineScope|vehicleVerificationDriverScope|licenceDateBoundary|driverPermissionWorkflow)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `schoolCertification.test.js`, `vehicleVerification.test.js`, `verificationRoutes.test.js`, `transportCanonicalInspection.test.js`, `transportIncident.test.js`, `transportDateShape.test.js`, `transportVehicleDedup.test.js`. Frontend: `frontend/tests/transportIncidentView.test.mjs`.

## ความเสี่ยงที่ทราบ
- `vehicleVerification.service.js` 1285 บรรทัด (ใหญ่ที่สุดในกลุ่ม service ของรถ)
- มีระบบตรวจสภาพ 2 ชุดคู่กัน (legacy `vehicle_inspections` และคิว 038) — `assertLegacyWritable` เป็นตัวกันไม่ให้ชนกัน แก้ฝั่งหนึ่งต้องดูอีกฝั่ง
