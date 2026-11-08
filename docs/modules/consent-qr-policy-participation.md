# consent-qr-policy-participation — ความยินยอม (PDPA), QR รถ, นโยบายที่ต้องรับทราบ, ระบบการมีส่วนร่วม

## หน้าที่
สี่ส่วนที่เปิดแยกกัน: (1) consent ของผู้ปกครอง/คนขับ (`consent_records`) และ gate การดูตำแหน่งตาม consent; (2) QR ประจำรถที่ให้ข้อมูลหลายระดับตามหลักฐานตัวตน;
(3) Policy notice — ข้อความที่ผู้ใช้เจ้าหน้าที่ต้องอ่านและยืนยันก่อนทำการสำคัญ (export, เริ่มกะ, ฯลฯ) พร้อมเก็บหลักฐาน;
(4) Participation cases — กล่องเรื่องร้องเรียน/ข้อเสนอแบบ event log ต่อท้ายอย่างเดียว.

## จุดเข้า
Consent + QR: mount เฉพาะเมื่อ `FEATURE_VEHICLE_QR=true` (`app.js:225`, ปิดแล้ว 404). Consent ใช้ rate-limit 30/นาที (`app.js` consentLimiter), QR มี `qrLimiter` ของตัวเอง (`qr.routes.js`).
- GET /api/consent/notice (`consent.routes.js:37`); ผู้ปกครอง (LIFF id_token ผ่าน `requireParentLineAuth`): GET /me/parent (L45), POST /parent (L49), POST /parent/withdraw (L55); คนขับ (JWT): GET /me (L63), POST / (L67), POST /withdraw (L75)
- GET /api/qr/vehicle/:qr_token (`qr.routes.js:31`, public + `optionalAuth`); POST /vehicle/:id/token (L42), GET /vehicle/:id/token (L55), POST /vehicle/:id/revoke (L65) — admin/transport
- Policy notice: mount `/api/policy-notices` เสมอ (`app.js:158`), ไม่มี flag ระดับ mount แต่ **ทำงานจริงต่อเมื่อ `APPROVED`** ใน `config/policyNotices.js:159` (ต้องผ่านการตรวจทางกฎหมาย + มีเลขอ้างอิง/ผู้ควบคุม/ช่องทางติดต่อ): GET /current (`policyNotice.routes.js:164`), /action/:context (L190), /catalog (L197), POST /prepare-action (L221), /consume-client-action (L285), /acknowledge (L298)
- Participation: mount `/api/participation` เฉพาะเมื่อ `FEATURE_PARTICIPATION_CASES=true` (`app.js:218-220`): GET /cases (`participation.routes.js:102`), GET /cases/:id (L152), POST /cases (L176), POST /cases/:id/events (L207), GET /summary (L252)
- Gate ผู้ปกครองดูตำแหน่ง: `FEATURE_PARENT_CONSENT_REQUIRED` (ใช้ใน `/api/parent/children*`, ดู [line-parent.md](line-parent.md))

## โค้ดหลัก
- `services/consent.service.js` (161) — `grantConsent` (L87), `withdrawConsent` (L129), `allRequiredConsentsGranted`; `config/consentText.js` (122); `services/parentConsentGate.js` (122) — `guardParentView` (L63), `redactUnconsentedChild`, `applyChildListGate`
- `services/qrAccess.service.js` (273) — `resolveAccessLevel` (L165), `buildPublicView/ParentView/StaffView` (L183/201/215), `buildViewForLevel` (L261)
- `routes/policyNotice.routes.js` (337), `config/policyNotices.js` (217), `utils/policyActionEvidence.js` (47) `consumePolicyAction`, `utils/policyEvidenceTables.js` (103)
- `routes/participation.routes.js` (267), `services/participation.service.js` (416) — `createCase` (L311), `appendEvent` (L342), `canActorAppendEvent` (L256), `summariseParticipation` (L274)
- `services/safetyPolicy.service.js` (144) — นโยบายความปลอดภัย (mode ENFORCE/อื่น ใช้ใน driver.routes.js:115-154)

## ข้อมูลที่รับผิดชอบ
- `consent_records` — 035_consent_records.sql; QR token บน `vehicles` — 034_vehicle_qr_codes.sql
- `policy_acknowledgements` — 052_policy_acknowledgements.sql; `policy_action_evidence` — 053_policy_action_evidence.sql
- `participation_cases`, `participation_case_events` — 050_participation_cases.sql

## จุดเชื่อม
- `consumePolicyAction` ถูกเรียกก่อนการเขียนสำคัญ: เริ่มกะ (`driver.routes.js:178`), ตรวจสภาพรถ (`transport.routes.js:146,263,297`), export รายงาน (`report.routes.js:165`) → [reports-export.md](reports-export.md), [verification-inspection.md](verification-inspection.md)
- QR ใช้ข้อมูลรถ/ตรวจสภาพ/เอกสาร/คนขับ → [vehicles-drivers.md](vehicles-drivers.md); consent ของผู้ปกครองใช้ LINE id_token → [line-parent.md](line-parent.md)
- Participation ใช้ scope เดียวกับ role ในระบบ → [affiliation-province.md](affiliation-province.md)

## กติกาสำคัญ
- ระดับการเข้าถึง QR คำนวณจากหลักฐานตัวตนเท่านั้น ไม่เชื่อ client และแต่ละ builder คืนเฉพาะฟิลด์ของระดับตน — `qrAccess.service.js:4-6,165`; ระดับ 3 (เบอร์คนขับ) ต้องเปิด `FEATURE_QR_LEVEL3` และถูก audit — `qrAccess.service.js:220,254`; token ที่ถูกเพิกถอนใช้ไม่ได้ (`qr_revoked_at IS NULL`, L24)
- ผู้ปกครองต้องมี consent `qr_parent_optin` สถานะ granted — `qrAccess.service.js:51-59`
- gate ตำแหน่งตาม consent ปิดเป็นค่าเริ่มต้น (`featureEnabled=false` ผ่านทั้งหมด) — `parentConsentGate.js:63-65`
- Policy: ปิดแบบ fail-closed จนกว่า `APPROVED`; เมื่อ approved ถ้าไม่มี header `X-Policy-Action-Token` จะปฏิเสธ — `policyActionEvidence.js:18-30`; ตารางหลักฐานหายคืน 503 — `policyNotice.routes.js:19-26`
- Participation: event log ต่อท้ายอย่างเดียว (ไม่แก้/ลบ event), สถานะเปลี่ยนตาม `EVENT_RESULT_STATUS` (`participation.service.js:98-108`), `appendEvent` ล็อกเคส `FOR UPDATE` — L344; ครูประจำชั้นถูกปฏิเสธทั้งโมดูล (`GRADE_TEACHER_PARTICIPATION_FORBIDDEN`) — `participation.routes.js:37-47`; ขอบเขตมาจาก token — `participation.routes.js:58` (`scopeClause`)

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(policyNotice|policyActionEvidence|policyEvidence|policyNotices|participation|parentConsent|safetyPolicy|accountRecoveryPolicy|qrParentBindingActive|decisionLogValidation)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `consent.test.js`, `qrAccess.test.js`.

## ความเสี่ยงที่ทราบ
- นโยบายที่ `APPROVED` ยังต้องอาศัยการตั้งค่าใน `config/policyNotices.js` (ไฟล์โค้ด ไม่ใช่ DB) — การเปิดใช้งานต้อง deploy โค้ด
- `consent_records` ถูกอ่านทั้งใน consent.service, qrAccess.service และ parentConsentGate ด้วย SQL ของตัวเอง (ยังไม่ได้ตรวจความสอดคล้องของเงื่อนไข)
