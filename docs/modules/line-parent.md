# line-parent — LINE webhook, ผูกบัญชีผู้ปกครอง, Parent API, คิวแจ้งเตือน

## หน้าที่
รับ webhook จาก LINE (ตรวจลายเซ็น), ผูก LINE ของผู้ปกครองกับนักเรียน (เบอร์โทร + รหัสนักเรียน หรือรหัส claim ที่โรงเรียนออก), ให้ LIFF ดูสถานะ/ประวัติ/ETA/ลา/ผู้ปกครองร่วม,
และส่งการแจ้งเตือนที่ถูกคิวไว้ในตาราง `notifications` ออกทาง LINE Push (เรียกโดย cron).

## จุดเข้า
Mount: `/api/line` และ `/api/parent` ไม่มี flag ระดับ mount (`app.js:~177-178`); ภายในมี flag ตามนี้:
`FEATURE_PARENT_LEAVE` (ลา, ดู [leave.md](leave.md)), `FEATURE_PARENT_CLAIM_CODE` / `FEATURE_PARENT_CLAIM_CODE_REQUIRED`, `FEATURE_CO_GUARDIAN`, `FEATURE_PARENT_CONSENT_REQUIRED` (ทั้งหมดอ่านใน `config/env.js`).

- POST /api/line/webhook (`line.routes.js:62`) — ตรวจ HMAC `x-line-signature` ก่อนตอบ 200 แล้วค่อยประมวลผล
- POST /api/line/process-notifications (L539) — ส่งคิวแจ้งเตือน; ป้องกันด้วย header `x-api-key` = `CRON_API_KEY` (production ไม่ตั้งค่า = 503)
- GET /api/parent/line/bind-config (`parent.routes.js:449`); POST /line/bind-preview (L462); POST /line/bind-confirm (L540)
- GET /api/parent/children (L162), /children/:id/status (L185), /children/:id/history (L203), /children/:id/eta (L243)
- ลา (flag): GET/POST /children/:id/leaves (L283/301), POST /leaves/:id/cancel (L322)
- ผู้ปกครองร่วม (flag `FEATURE_CO_GUARDIAN`): GET /guardians (L340), POST /guardians/invite (L347), /guardians/accept (L356), /guardians/:id/remove (L367), /guardians/leave (L380)
- ฝั่งโรงเรียน (`school.routes.js`): POST /students/:id/claim-code (L1289), POST /claim-codes (L1305) (ต้อง `claimCodesEnabled`, L1283), POST /students/:id/parent-line/unlink (L1341)
- Consent ของผู้ปกครอง ดู [consent-qr-policy-participation.md](consent-qr-policy-participation.md)

## โค้ดหลัก
- `backend/src/routes/line.routes.js` (566) — `verifySignature` (L21, timingSafeEqual), webhook handler
- `backend/src/routes/parent.routes.js` (624) — `requireParentLineAuth` (L129, ตรวจ LIFF id_token), `bindGuards` (L111), `linkedChildOr403`
- `backend/src/services/line.service.js` (1494) — `bindLineUserToPhone` (L154), `unbindLineUser` (L223), `getChildStatusToday`, `buildEmergencyFlex`, `buildParentStatusFlex`, `sendTextMessage` (L559), `isStillLinkedRecipient` (L1391), `processUnsentNotifications` (L1413)
- `backend/src/services/lineFlexTemplates.service.js` (812) — Flex templates
- `backend/src/services/lineBindGuard.js` (239) — lockout/ratelimit ผูกบัญชี (`checkLock`, `noteFailure`, `noteSuccess`); `lineBindingSource.js` (25) `activeBindingsSql`; `lineIdToken.service.js` (106) `verifyIdToken`
- `backend/src/services/parentClaimCode.service.js` (144); `coGuardian.service.js` (242) `createInvite`, `acceptInvite`, `leave`; `parentConsentGate.js`; `consent.service.js` (161)

## ข้อมูลที่รับผิดชอบ
- `line_users`, `line_message_logs`, `notifications`, `parents`, `parent_student` — 001_initial_schema.sql
- `line_bindings` — 022_line_bindings.sql (เบอร์ผู้ปกครองไม่ซ้ำ 042_parent_phone_unique.sql)
- `line_webhook_events_seen`, `line_bind_lockouts` — 051_shared_security_state.sql
- `parent_claim_codes` — 057_parent_claim_codes.sql
- `line_guardian_invites`, `line_co_guardians` — 058_co_guardians.sql

## จุดเชื่อม
- ผู้เขียนคิว `notifications`: check-in (`checkin.service.js:531`, [attendance.md](attendance.md)), geofence ([pickup-gps-eta.md](pickup-gps-eta.md)), emergency ([admin-ops.md](admin-ops.md))
- นักเรียน/ผู้ปกครองจาก [students-import.md](students-import.md); ลา → [leave.md](leave.md); กู้รหัส admin ผ่าน LINE → [auth-session.md](auth-session.md)

## กติกาสำคัญ
- webhook: ต้องผ่านลายเซ็นมิฉะนั้น 403 — `line.routes.js:73-77`; กัน event ซ้ำด้วย `INSERT IGNORE` ลง `line_webhook_events_seen` — `line.routes.js:56` (คอมเมนต์)
- LIFF ทุก endpoint ยืนยัน id_token ก่อน (`requireParentLineAuth`), ผู้ปกครองเห็นเฉพาะเด็กที่ผูก+อนุมัติ — `parent.routes.js:129,162-203`
- ผูกบัญชีทำใน transaction (`line.service.js:155-157`) และมี lockout เก็บใน DB — `lineBindGuard.js:142-202`
- คิวส่ง: `FOR UPDATE SKIP LOCKED`, `retry_count < 3` — `line.service.js:1418,1435`; ตรวจผู้รับยังผูก/อนุมัติ ณ เวลาส่ง ไม่งั้นตั้ง `retry_count=3` (`RECIPIENT_NO_LONGER_LINKED`) — `line.service.js:1391,1445-1447`
- รหัส claim เก็บเป็น hash (`hashCode`) — `parentClaimCode.service.js:36`
- cron endpoint ใช้ `safeKeyEqual` (constant-time) — `line.routes.js:41,549`
- ผูก/ยกเลิก LINE มี audit (`auditBind`) — `line.service.js:1352`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(line|parentClaim|coGuardian|parentConsent|parentLeave|parentLineBind|notificationRecipientRecheck|liff|schoolParentLine|qrParentBindingActive)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `lineBindGuard.test.js`, `lineBindAudit.test.js`, `lineBindCredential.test.js`, `lineNotificationResolver.test.js`, `parentAuth.test.js`, `sharedSecurityState.test.js`. Frontend (`node --test`): `frontend/tests/coGuardianUi.test.mjs`, `parentClaimCodeUi.test.mjs`, `parentBindPreviewChildren.test.mjs`, `schoolParentLineStatus.test.mjs`, `schoolParentLineUnlink.test.mjs`.

## ความเสี่ยงที่ทราบ
- `processUnsentNotifications` เปิด transaction ค้างไว้ตลอดลูปส่ง และเรียก LINE API (`sendTextMessage`) ภายใน transaction — `line.service.js:1417-1464` (ล็อกแถวนานเท่าเวลาเรียก LINE ต่อรายการ; limit ค่าเริ่มต้น 50)
- `line.service.js` 1494 บรรทัด รวม binding, flex builders, push, queue ในไฟล์เดียว
- ที่เก็บ `linkingState` เป็น Map ในหน่วยความจำ (`line.service.js:44-56`) — ไม่ใช้ร่วมกันข้าม instance (ยังไม่ได้ตรวจว่ายังใช้งานอยู่)
