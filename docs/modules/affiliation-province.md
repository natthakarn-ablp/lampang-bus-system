# affiliation-province — dashboard สังกัด/จังหวัด และการจัดการบัญชีโรงเรียน

## หน้าที่
ให้ role `affiliation` (เขตพื้นที่) และ `province` (ส่วนกลาง) ดูภาพรวมโรงเรียน/นักเรียน/รถ/สถานะวันนี้/เหตุฉุกเฉิน/รถเสี่ยง/audit log ตามขอบเขตของตน,
ให้สังกัดสร้าง/รีเซ็ต/เปิด-ปิด/นำเข้าบัญชีโรงเรียน, ให้จังหวัดรีเซ็ตรหัสผ่านบัญชีหน่วยงาน, และให้สังกัดพิจารณาคำขอโอนย้ายนักเรียน/คำขอรถในเขต.

## จุดเข้า
Mount (`app.js:179-180`): `/api/affiliation` (`router.use(authenticate, requireRole('affiliation','admin'))`, `affiliation.routes.js:169`) และ `/api/province` (`requireRole('province','admin')`, `province.routes.js:41`). ไม่มี feature flag. admin ระบุสังกัดผ่าน `?affiliation_id=` (`resolveAffiliationId`, L171-174).

Affiliation (`affiliation.routes.js`): GET /dashboard (L179), /schools (L194), /schools/report (L210), /schools/report/excel (L225), /students (L249), /vehicles (L270), /status-today (L285), /emergencies (L301), /vehicles-at-risk (L327), /missing (L340), /audit-logs (L600, `?format=csv`), /live-vehicles (L720), /vehicles/:vehicleId/track|track-days (L750-751), /pickup-map (L758)
- บัญชีโรงเรียน: GET/POST /school-accounts (L375/384), POST /school-accounts/new-school (L400), POST /school-accounts/:id/reset-password (L417), PUT /school-accounts/:id (L434, เปิด/ปิด), GET /school-accounts/import-template (L474), POST /school-accounts/import/preview (L537), POST /school-accounts/import/commit (L571), POST /notify-school (L687)
- อนุมัติ: GET /transfer-requests (L806), GET /:id (L816), POST /:id/approve (L828), /:id/reject (L850); GET /vehicle-requests (L866), GET /:id (L876), POST /:id/approve (L888), /:id/reject (L911)

Province (`province.routes.js`): GET /dashboard (L46), /affiliations (L56), /schools (L67), /students (L82), /vehicles (L98), /vehicles-at-risk (L119), /status-today (L129), /trend (L140), /emergencies (L181), /audit-logs (L193), /live-vehicles (L263), /vehicles/:vehicleId/track|track-days (L277-278), /pickup-map (L284), GET /unit-accounts (L324), POST /unit-accounts/:id/reset-password (L332)
- readiness จังหวัด: `/api/readiness` ใน [admin-ops.md](admin-ops.md)
- รายงาน/export ของสองบทบาทนี้ผ่าน [reports-export.md](reports-export.md)

## โค้ดหลัก
- `routes/affiliation.routes.js` (927), `routes/province.routes.js` (350)
- `services/affiliation.service.js` (671) — query dashboard/รายการตามสังกัด; `services/province.service.js` (750) — query ระดับจังหวัด
- `services/affiliationAdmin.service.js` (534) — `getSchoolAccounts`, `createSchoolAccount` (L31), `resetSchoolPassword` (L90), `toggleSchoolAccount` (L136), `createSchoolWithAccount` (L157), `previewSchoolImport` (L352), `commitSchoolImport` (L416)
- `services/provinceAdmin.service.js` (121) — `listManagedAccounts` (L46), `resetUnitAccountPassword` (L69)
- `utils/affiliationSchoolsWorkbook.js` (xlsx แม่แบบ/รายงาน)

## ข้อมูลที่รับผิดชอบ
ไม่มีตารางของตัวเอง; เขียน `users` (บัญชีโรงเรียน, ตารางสร้างใน 001_initial_schema.sql) และ `schools` (001) ผ่าน `createSchoolWithAccount`; `audit_logs` (001). สังกัดอ่าน `affiliations` (001; seed สังกัดลำปางใน 019_add_lampang_affiliations.sql, 020_add_lampang_peo_affiliation.sql).

## จุดเชื่อม
- ใช้ `vehicleLocation.service` / `pickupPoint.service` สำหรับ live และ pickup-map → [pickup-gps-eta.md](pickup-gps-eta.md)
- อนุมัติโอนย้าย/คำขอรถ → [transfers.md](transfers.md), [vehicles-drivers.md](vehicles-drivers.md) (`studentTransfer.service`, `vehicleRequest.service`)
- สร้างบัญชีโรงเรียน/รหัสผ่านชั่วคราว → [auth-session.md](auth-session.md); admin เห็นทั้งหมดผ่าน [admin-ops.md](admin-ops.md)

## กติกาสำคัญ
- ขอบเขตสังกัดมาจาก token (`req.user.scopeId`) ไม่ใช่ query ยกเว้น admin — `affiliation.routes.js:171-174`
- สังกัดจัดการได้เฉพาะบัญชี `role='school'` ในโรงเรียนที่ `affiliation_id` ตรงกัน และยังไม่ลบ — `affiliationAdmin.service.js:34,93-96,140`
- แจ้งเตือนโรงเรียนได้เฉพาะโรงเรียนในสังกัดตน (admin ได้ทุกแห่ง) — `affiliation.routes.js:693-700`
- รีเซ็ตรหัสผ่านใช้ bcrypt cost 12 และตั้ง `must_change_password = TRUE` + `password_changed_at = NOW()` (ทำให้เซสชันเดิมใช้ไม่ได้) — `affiliationAdmin.service.js:116-121`; ทุกการสร้าง/รีเซ็ต/เปิด-ปิดมี audit — L79,125,150
- จังหวัดเห็นรายการรถแบบตัดเบอร์โทร (driver/attendant/owner phone) — `province.routes.js:101-104`; live-vehicles/pickup-map ไม่มี PII (`province.routes.js:248,283`)
- audit-logs ผ่าน `exportFormatLimiter`; นำเข้า/แม่แบบผ่าน `importExportLimiter` — `affiliation.routes.js:225,474,537,571,600`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(affiliationLiveQa|affiliationReadiness|affiliationSchoolReport|affiliationToggleAccountValidation|provinceUnitAccounts|dataQualityReport|rbacMatrix|crossAffiliationTransfer)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `affiliation.test.js`, `province.test.js`, `provincePhoneVisibility.test.js`, `crossSchoolIsolation.test.js`. Frontend: `frontend/tests/affiliationSchoolReport.browser.test.mjs` (`npm run test:school-report`).

## ความเสี่ยงที่ทราบ
- `affiliation.routes.js` 927 บรรทัด และ `province.service.js` 750 บรรทัด
- ข้อความใน CLAUDE.md §5.4-5.5 (สเปกที่ร่างเก่า) อาจไม่ตรง route จริง — ใช้รายการข้างต้นแทน (ยังไม่ได้เทียบทุกบรรทัด)
