# admin-ops — งานผู้ดูแลระบบ: ผู้ใช้, health/readiness, ฉุกเฉิน, feature flag, audit log

## หน้าที่
`/api/admin/*` สำหรับ role `admin` เท่านั้น (จัดการผู้ใช้ทุกบทบาท, เหตุฉุกเฉิน, terms, ตัวติดตามสุขภาพระบบ, snapshot/วิจัย, คิวอนุมัติคำขอ);
endpoint สุขภาพระบบสาธารณะ, ความพร้อมเปิดใช้ (readiness), การบันทึก audit log ที่ใช้ทั้งระบบ และตัวกำหนด feature flag ใน `config/env.js`.

## จุดเข้า
Mount: `/api/admin` (`app.js:192`; `router.use(authenticate, requireRole('admin'))` — `admin.routes.js:334`), `/api/readiness` (`app.js:211`; province/admin, `readiness.routes.js:16`), `/api/terms` (authenticate เท่านั้น, `terms.routes.js:10`), `/api/visits` (public), `GET /health` (`app.js:93`, ภายใน) และ `GET /api/health` (`app.js:126`, public แบบจำกัดข้อมูล).

admin.routes.js (2356 บรรทัด) หลัก ๆ:
- ผู้ใช้: GET /users (L337), POST /users (L376), PUT /users/:id (L458), POST /users/:id/reset-password (L538), DELETE /users/:id (L577), POST /users/:id/restore (L636), GET /users-needing-action (L666), GET /roster-requests-pending (L678)
- ปิดเหตุฉุกเฉิน (เจ้าของยืนยัน 2026-11-13, ต้องมีบันทึก): `POST /api/{school|affiliation|province|admin}/emergencies/:id/close`, คนขับ `GET /api/driver/emergencies/open` + `POST /api/driver/emergencies/:id/resolve` ("แก้ไขแล้ว") — `emergencyAdmin.service.closeEmergencyScoped` ต่อบรรทัดประวัติท้าย `note` และเขียน audit (role, scope, note); ปิดซ้ำได้ 409. ผลส่ง LINE ของเหตุฉุกเฉินบันทึกเป็น audit `emergency_line_push`
- ฉุกเฉิน: GET /emergencies (L2253), PATCH /emergencies/:id (L2279), DELETE /emergencies/:id (L2300) — คนขับแจ้งที่ `POST /api/driver/emergency` (`driver.routes.js:594`)
- สุขภาพ/ปฏิบัติการ: GET /system-health (L996), GET /operations/health (L2049), /operations/capacity-sample (L2062), /operations/route-latency (L2071), GET /pending-requests-count (L1946)
- วิจัย/snapshot: POST /snapshots/run (L1119), GET /snapshots (L1218), GET /evaluation-summary (L1235), GET /research-export (+/preview) (L1301/1888) — ดู [reports-export.md](reports-export.md)
- Audit: GET /audit-logs (L912, ส่งออก CSV ได้)
- terms: GET/POST /terms (L2316/2322), POST /terms/:id/current (L2333)
- ย้ายมาจากโมดูลอื่น: pickup-points (L717-878), live-vehicles/track (L1927-1942), student-transfer-requests (L1962-1996), vehicle-requests (L2008-2037), drivers/vehicles (L2077-2202), POST /checkin/:logId/void (L2224), POST /verification/applications/:id/cancel (L2142) — ดูโมดูลที่เกี่ยวข้อง

## โค้ดหลัก
- `routes/admin.routes.js` (2356), `routes/readiness.routes.js` (33), `routes/terms.routes.js` (39), `routes/visits.routes.js` (44)
- `services/admin.service.js` (133) — `getUsersNeedingAction`, `restoreUser`; `emergency.service.js` (128) — `createEmergencyReport`, `insertOrReuse`; `emergencyAdmin.service.js` (85) — `resolveEmergency`, `softDeleteEmergency`
- `services/operationsHealth.service.js` (137) `computeOperationsHealth`; `operationsAlert.service.js` (51); `deploymentReadiness.service.js` (291) `getDeploymentReadiness`; `publicHealth.service.js` (53); `migrationStatus.service.js` (38); `capacitySample.service.js` (195); `routeLatency.service.js` (97); `term.service.js` (255)
- `utils/audit.js` (73) `logAudit`, `utils/auditLabels.js`, `utils/health.js` (102)
- `config/env.js` — `env.features.*`; `src/index.js` L~300-320 ตรวจ migration ที่ flag ต้องการตอนบูต

## ข้อมูลที่รับผิดชอบ
- `users`, `audit_logs`, `system_params`, `emergency_logs`, `terms` — 001_initial_schema.sql; `emergency_logs` เพิ่ม GPS ใน 021_emergency_gps.sql และ soft delete ใน 025_soft_delete_emergency_logs.sql
- `audit_logs_archive`, `checkin_logs_archive` — 047_log_archive_tables.sql; `schema_migrations` — 028_schema_migrations.sql; `daily_visits` — 015_daily_visits.sql
- ค่า term ปัจจุบัน seed ใน 046_seed_current_term.sql, 048_seed_term_windows.sql
- ตารางผู้ดูแลอื่น ๆ (เช่น `daily_snapshots` 013) ดู [reports-export.md](reports-export.md)

## จุดเชื่อม
- `logAudit` ถูกเรียกจากแทบทุก route/service
- ลบ/restore ผู้ใช้เกี่ยวกับ recovery channel → [auth-session.md](auth-session.md); ผู้ใช้โรงเรียน/สังกัด → [affiliation-province.md](affiliation-province.md)
- อีเมล/LINE แจ้งเหตุฉุกเฉิน (`pushEmergencyFlexMessage` ใน line.service.js) → [line-parent.md](line-parent.md)

## Feature flags (`backend/src/config/env.js`, ค่าเริ่มต้นปิดยกเว้นที่ระบุ)
`FEATURE_ADMIN_PASSWORD_RECOVERY` (L284; ใช้ใน auth-session), `ADMIN_RECOVERY_REQUIRE_CODE` (ค่าเริ่มต้นเปิด), `FEATURE_VEHICLE_QR`, `FEATURE_QR_LEVEL3`, `FEATURE_DRIVER_SHIFT_SELECTION`, `FEATURE_ETA`, `FEATURE_GEOFENCE`, `FEATURE_ROUTE_DEVIATION`, `FEATURE_DRIVER_REGISTRATION`, `FEATURE_PARENT_CONSENT_REQUIRED`, `FEATURE_PARENT_LEAVE`, `FEATURE_PARENT_CLAIM_CODE`, `FEATURE_PARENT_CLAIM_CODE_REQUIRED`, `FEATURE_CO_GUARDIAN`, `FEATURE_PARTICIPATION_CASES`. flag ที่ต้องมี migration เฉพาะถูกตรวจตอนบูต (`src/index.js:~300-320`: 056, 057, 058).

## กติกาสำคัญ
- ทุก route `/api/admin` เป็น admin เท่านั้น — `admin.routes.js:334`
- ห้ามลบบัญชีตัวเอง — `admin.routes.js:581`; ลบผู้ใช้เป็น soft delete ใน transaction และปล่อย recovery channel/โค้ด/คำขอรีเซ็ต — `admin.routes.js:590-620`
- สร้างผู้ใช้: ตรวจรหัสผ่าน `validatePassword`, ตรวจ scope ด้วย `validateRoleScope`, `grade_scope` ใช้ได้กับ `role=school` เท่านั้นและต้องอยู่ในรายการที่กำหนด — `admin.routes.js:376-420`
- `logAudit({ required: true })` ทำให้ธุรกรรมล้มถ้าบันทึก audit ไม่ได้; ค่าเริ่มต้นกลืน error (log เท่านั้น) — `utils/audit.js:20-49`
- ฉุกเฉิน: สร้างแบบ idempotent ภายในช่วงเวลาสั้น ล็อกแถว user `FOR UPDATE` — `emergency.service.js:63-65`; ไม่ถูกบล็อกโดย safety policy (`emergency`: never BLOCK, `driver.routes.js:115,154`)
- readiness เป็นข้อมูลรวม ไม่มี PII — `readiness.routes.js:12-15`
- `/api/health` สาธารณะ จงใจเปิดเผยน้อยกว่า `/health` — `app.js:112`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(adminEndpoints|adminUserUpdateScope|auditLogRedaction|auditTransactionDeadlock|emergencyIdempotency|emergencyShiftFallback|operationsHealth|operationsAlert|publicHealth|healthAlertRetry|healthBuildInfo|healthSmokePrivacy|deploymentReadiness|testEnvFeatureFlags|apiNotFound|term|rbacMatrix|readinessGateNpmAudit|capacitySample|routeLatency|migrationBaseline)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `health.test.js`, `operationsHealth.test.js`, `capacitySample.test.js`, `emergencyConcurrencyMultiReporter.test.js`, `emergencyDoubleTap.test.js`, `hardening10_13b1.test.js`, `securityHardening.test.js`.

## ความเสี่ยงที่ทราบ
- `admin.routes.js` 2356 บรรทัด รวมหลายโมดูลย้อนหลัง (pickup, transfer, vehicle, driver, วิจัย)
- ค่าเริ่มต้นของ `logAudit` คือ non-fatal (กลืน error, `utils/audit.js:48-49`) — เส้นทางที่ต้องการ audit เข้มงวดต้องส่ง `required: true` เอง
