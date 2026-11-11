# reports-export — รายงาน, CSV/Excel/PDF, ความปลอดภัยการ export, สถิติการมาเรียน

## หน้าที่
สร้างรายงานรายวัน/รายเดือน/สรุป/นโยบาย ตามขอบเขตของผู้ใช้ (school / affiliation / province / admin) และส่งออกเป็น CSV (มี BOM), Excel, PDF;
ทุกการ export ถูกจำกัดอัตรา, ผ่านนโยบายยืนยัน และ audit ก่อนส่งข้อมูล.

## จุดเข้า
Mount: `/api/reports` พร้อม `exportLimiter` (40 ครั้ง / 5 นาที ต่อผู้ใช้, `app.js:181-185`). ไม่มี feature flag. ทุก route ผ่าน `authenticate, requireRole('school','affiliation','province','admin')` (`report.routes.js:22`) และตัวตรวจ filter (L51).

- GET /api/reports/daily (L63), /monthly (L73), /summary (L83), /policy (L94) — JSON
- GET /api/reports/export/csv (L312), /export/excel (L342), /export/pdf (L410) — รายวัน
- GET /api/reports/export/monthly/csv (L577), /monthly/excel (L604), /monthly/pdf (L644)
- POST /api/reports/decision-log (L770) — บันทึกการตัดสินใจ (จำกัดบทบาทด้วย `DECISION_LOG_ROLES`)

Export/ดาวน์โหลดอื่นนอก mount นี้: `GET /api/{school,affiliation,province,admin}/audit-logs` (`?format=csv`, school ต้อง full-scope), `GET /api/admin/research-export` (admin.routes.js:1301) และ `/research-export/preview` (L1888), `GET /api/transport/export/vehicles.csv` (transport.routes.js:144), แม่แบบนักเรียน (ดู [students-import.md](students-import.md)).

## โค้ดหลัก
- `backend/src/routes/report.routes.js` (803) — handlers, `extractFilters`, `consumeReportExportPolicy` (L165), `csvLine`
- `backend/src/services/report.service.js` (659) — `buildScopeFilter` (L32), `getDailyReport` (L102), `getMonthlyReport` (L221), `getSummaryReport` (L420), `exportRowsQuery` (L500), `getExportRows` (L551), `getPolicyReport` (L588); `streamExportRows` ถูกเรียกที่ report.routes.js (ตำแหน่งนิยามยังไม่ได้ตรวจ)
- `backend/src/services/attendanceStatistics.service.js` (132) — `readLedger`, `decorateDaily/Monthly`
- `backend/src/utils/exportSecurity.js` (120) — `neutralizeSpreadsheetCell`, `csvCell`, `maskPhone`, `maskLineUserId`, `redactAuditValue`
- `backend/src/utils/exportAudit.js` (32) — `auditExportBeforeSend`; `utils/csv.js` (41); `services/researchReadiness.service.js` (308)

## ข้อมูลที่รับผิดชอบ
ไม่มีตารางรายงานของตัวเอง (อ่านจาก `checkin_logs`, `daily_status`, `students`, `student_leaves`, ...).
- `daily_snapshots` — 013_daily_snapshots.sql (เขียนโดย admin: POST /api/admin/snapshots/run `admin.routes.js:1119`, `REPLACE INTO` L1188; เฟสวิจัยเพิ่มใน 014)
- Decision log บันทึกเป็นแถวใน `audit_logs` (entityType `decision_log`, `report.routes.js:770-790`) ไม่มีตารางเฉพาะ

## จุดเชื่อม
- อ่านข้อมูลจาก [attendance.md](attendance.md), [leave.md](leave.md), [students-import.md](students-import.md)
- `consumePolicyAction` (นโยบาย/การยืนยัน) → [consent-qr-policy-participation.md](consent-qr-policy-participation.md)
- audit → [admin-ops.md](admin-ops.md)

## กติกาสำคัญ
- Scope มาจาก token (`buildScopeFilter(user, ...)`) ไม่ใช่จาก query — `report.service.js:32`; `date`/`month` ตรวจเป็นวันที่จริง — `report.routes.js:30-45`
- ทุกเซลล์ CSV ผ่าน `csvCell` กัน formula injection — `exportSecurity.js:25-40`, ใช้ที่ `report.routes.js:14,278`
- ต้องผ่านนโยบาย `consumeReportExportPolicy` และ `auditExportBeforeSend` ก่อนเขียน header/ข้อมูล — `report.routes.js:314-322`
- CSV รายวันเป็น async generator stream — `report.routes.js:327`; filter ถูกตรวจก่อนส่ง header เพื่อให้ error ยังเป็น JSON (`report.routes.js:316`)
- ค่าใน audit log ที่ export ผ่าน `redactAuditValue`/mask เบอร์โทร — `exportSecurity.js:46-102`
- บทบาท driver/transport ไม่ผ่าน `/api/reports` (`report.routes.js:22`)

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(reportService|reportDailyPdf|reportMonthlyExport|reportGradeScope|reportExportAudit|documentExportAudit|exportRateLimitCoverage|attendanceStatistics|summaryMatchesBreakdown|auditLogRedaction|csvParser|transportExportRoute|researchExportProvenance|researchMetricsRegistry|researchIntegrityGuard|frontendSnapshotPctContract)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `report.test.js`, `reportRoleBoundary.test.js`, `reportExportStreaming.test.js`, `exportSecurity.test.js`, `researchExportFormats.test.js`, `researchExportDateValidation.test.js`.

## ความเสี่ยงที่ทราบ
- `report.routes.js` 803 บรรทัด และ `report.service.js` 659 บรรทัด
- ความคอมเมนต์ใน `app.js:177-179` ระบุว่า report/export "build full datasets in memory" — export Excel/PDF ยังไม่ได้ตรวจว่า stream หรือไม่
