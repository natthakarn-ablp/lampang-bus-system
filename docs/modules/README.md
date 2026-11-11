# docs/modules — แผนที่โมดูลธุรกิจ

เอกสารรายโมดูลสำหรับหาโค้ดที่ถูกต้องโดยไม่ต้องอ่าน route ขนาด 2,000+ บรรทัด. หมายเลขบรรทัดอิงโค้ดบน branch `docs/doc-001-system-index` ณ วันที่เขียน (อาจเลื่อนเมื่อโค้ดเปลี่ยน). Mount ทั้งหมดอยู่ใน `backend/src/app.js`.

| ไฟล์ | จุดประสงค์ | route หลัก | service หลัก |
|---|---|---|---|
| [auth-session.md](auth-session.md) | login, JWT/refresh, logout revoke, เปลี่ยน/กู้รหัสผ่าน | `routes/auth.routes.js`, `adminPasswordRecovery.routes.js` | `middleware/auth.js`, `utils/sessionReset.js` (ไม่มี service) |
| [students-import.md](students-import.md) | นักเรียน, นำเข้า, เลื่อนชั้น, roster request, สิทธิ์ครูประจำชั้น | `routes/school.routes.js`, `schoolPromotion.routes.js` | `services/school.service.js`, `studentImportPreview.service.js` |
| [vehicles-drivers.md](vehicles-drivers.md) | รถ, คนขับ, กะ, เอกสาร, ลงทะเบียนรถ | `routes/driver.routes.js`, `registration.routes.js`, `documents.routes.js` | `services/vehicleAdmin.service.js`, `driverLifecycle.service.js` |
| [attendance.md](attendance.md) | เช็กอิน/เอาท์, override, ย้อนหลัง, เดินทางเอง | `routes/driver.routes.js`, `school.routes.js` | `services/checkin.service.js` |
| [leave.md](leave.md) | การลา (คนขับ/โรงเรียน/ผู้ปกครอง) | `routes/driver.routes.js`, `school.routes.js`, `parent.routes.js` | `services/leave.service.js`, `parentLeave.service.js` |
| [pickup-gps-eta.md](pickup-gps-eta.md) | จุดรับส่ง, ตำแหน่งสด, ประวัติ, ETA, geofence, deviation | `routes/driver.routes.js`, `eta/geofence/routeDeviation.routes.js` | `services/vehicleLocation.service.js`, `pickupPoint.service.js` |
| [reports-export.md](reports-export.md) | รายงาน, CSV/Excel/PDF, ความปลอดภัยการ export | `routes/report.routes.js` | `services/report.service.js` |
| [line-parent.md](line-parent.md) | LINE webhook, ผูกบัญชี, Parent API, คิวแจ้งเตือน | `routes/line.routes.js`, `parent.routes.js` | `services/line.service.js` |
| [transfers.md](transfers.md) | โอนย้ายนักเรียนข้ามโรงเรียน/สังกัด | `routes/school.routes.js`, `affiliation.routes.js`, `admin.routes.js` | `services/studentTransfer.service.js` |
| [verification-inspection.md](verification-inspection.md) | ตรวจสภาพรถ และคำขอส่งตรวจ/eligibility | `routes/transport.routes.js`, `verification.routes.js` | `services/vehicleVerification.service.js`, `transport.service.js` |
| [admin-ops.md](admin-ops.md) | ผู้ใช้, health, readiness, ฉุกเฉิน, feature flag, audit | `routes/admin.routes.js`, `readiness.routes.js` | `services/admin.service.js`, `operationsHealth.service.js` |
| [affiliation-province.md](affiliation-province.md) | dashboard สังกัด/จังหวัด, บัญชีโรงเรียน | `routes/affiliation.routes.js`, `province.routes.js` | `services/affiliation.service.js`, `province.service.js` |
| [consent-qr-policy-participation.md](consent-qr-policy-participation.md) | consent, QR, policy notice, participation (บางส่วนมี flag) | `routes/consent.routes.js`, `qr.routes.js`, `policyNotice.routes.js`, `participation.routes.js` | `services/consent.service.js`, `qrAccess.service.js`, `participation.service.js` |

## คำสั่งทดสอบแบบไม่ต้องใช้ DB
`cd backend && npx jest --config jest.unit.config.js --runInBand <pattern>` (รันเฉพาะ `*.unit.test.js` และ `securityEnv.test.js`). ไฟล์ `*.test.js` อื่นต้องใช้ MySQL test DB: `npm run test:ci`. Frontend: `cd frontend && node --test tests/<file>.mjs`.
