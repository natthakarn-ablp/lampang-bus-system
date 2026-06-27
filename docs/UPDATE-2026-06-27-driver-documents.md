# บันทึกการเปลี่ยนแปลงระบบ — แนบเอกสารหลักฐานฝั่งคนขับ (Phase 10.14)

> **วันที่:** 27 มิถุนายน 2569
> **ฟีเจอร์:** การแนบเอกสารหลักฐานของรถและคนขับ (Vehicle & Driver Supporting Evidence)
> **สถานะ:** เสร็จสมบูรณ์ (backend + frontend) อยู่ใน working tree — **dark** ใต้ feature flag `FEATURE_DRIVER_REGISTRATION` (ยังไม่ deploy)
> **ต่อยอดจาก:** ฟีเจอร์ขึ้นทะเบียนรถแบบคนขับเริ่มเอง (Driver-initiated Registration / Roster, migration 044)

---

## สารบัญ

1. [วัตถุประสงค์](#1-วัตถุประสงค์)
2. [ภาพรวมและโฟลว์การทำงาน](#2-ภาพรวมและโฟลว์การทำงาน)
3. [Database Schema (migration 045)](#3-database-schema-migration-045)
4. [Backend](#4-backend)
5. [Frontend](#5-frontend)
6. [API Endpoints](#6-api-endpoints)
7. [ความปลอดภัย (Security)](#7-ความปลอดภัย-security)
8. [RBAC](#8-rbac)
9. [ไฟล์ที่เปลี่ยนแปลง](#9-ไฟล์ที่เปลี่ยนแปลง)
10. [การทดสอบและการตรวจสอบ](#10-การทดสอบและการตรวจสอบ)
11. [แผนการ Deploy](#11-แผนการ-deploy)
12. [ข้อจำกัดและงานที่เหลือ](#12-ข้อจำกัดและงานที่เหลือ)

---

## 1. วัตถุประสงค์

ให้ **คนขับรถ** สามารถถ่ายรูปหรือแนบไฟล์ PDF เอกสารหลักฐานของรถและของตัวคนขับเข้าระบบได้เอง
แล้วให้ **โรงเรียน** (ผู้ออกคำขอ) และ **ขนส่ง** ตรวจสอบเอกสารเหล่านั้นได้ โดยเอกสารทำหน้าที่เป็น
**หลักฐานประกอบ (supporting evidence)** เท่านั้น

ประเภทเอกสารที่รองรับ:
- **เอกสารรถ (vehicle):** เล่มทะเบียนรถ, พ.ร.บ. (ประกันภัยภาคบังคับ), ป้ายภาษีรถ, ประกันภัยรถ, เอกสารอื่น ๆ
- **เอกสารคนขับ (driver):** ใบขับขี่, เอกสารอื่น ๆ

**หลักการสำคัญ:** การอนุมัติ/ปฏิเสธเอกสาร (`review_status`) เป็น **ข้อมูลเชิงแนะนำ (advisory)** ที่ตั้งโดยมนุษย์เท่านั้น
**ไม่** ไปแตะหรือเปลี่ยน `vehicles.verification_status` หรือสถานะความพร้อมขึ้นทะเบียน (eligibility) โดยอัตโนมัติ —
เพื่อไม่ให้เอกสารกลายเป็นช่องทางข้ามขั้นตอนการตรวจสภาพรถจริง

---

## 2. ภาพรวมและโฟลว์การทำงาน

```
คนขับ                         โรงเรียน / ขนส่ง                  ระบบ
─────                         ─────────────────                ────
แนบเอกสาร (รูป/PDF) ──────────────────────────────────►  เก็บไฟล์ใต้ uploads/documents/
  (เลือกประเภท → เลือกไฟล์)                                 + ตรวจ magic-byte + คำนวณ sha256
                                                            review_status = PENDING
                              เปิดดูไฟล์ ◄──────────────  serve แบบ auth + scoped (inline)
                              กด "ผ่าน / ไม่ผ่าน" ───────►  review_status = APPROVED / REJECTED
                                (ไม่ผ่านต้องใส่เหตุผล)         (advisory เท่านั้น — ไม่แตะ eligibility)
คนขับเห็นผล ◄────────────────────────────────────────────  ถ้า REJECTED เห็นเหตุผล → แนบใหม่ได้
```

- เอกสารผูกกับ **รถ** (ทุกคนขับของรถคันนั้นเห็นร่วมกัน) และผูกกับ **คนขับ** (ใบขับขี่)
- รถ/คนขับที่ผูกกับเอกสารถูก resolve **ฝั่งเซิร์ฟเวอร์** จาก JWT เสมอ — ผู้ใช้ส่ง vehicle_id/driver_id มาเองไม่ได้
- ทุก action (upload / review / view / delete) เขียน `audit_logs`

---

## 3. Database Schema (migration 045)

ไฟล์: `backend/migrations/045_driver_documents.sql` — **เพิ่มใหม่ 2 ตาราง ไม่แก้ตารางเดิม** (additive only)

### ตาราง `vehicle_documents`

| คอลัมน์ | ชนิด | หมายเหตุ |
|---------|------|----------|
| `id` | BIGINT AUTO_INCREMENT PK | |
| `vehicle_id` | VARCHAR(20) NOT NULL | FK → `vehicles(id)` |
| `doc_type` | ENUM | `VEHICLE_REGISTRATION`, `COMPULSORY_INSURANCE`, `TAX`, `INSURANCE`, `OTHER` |
| `storage_key` | VARCHAR(255) NOT NULL | ชื่อไฟล์ (basename) บนดิสก์ใต้ `uploads/documents/` |
| `original_name` | VARCHAR(255) NOT NULL | ชื่อไฟล์เดิมที่ผู้ใช้อัปโหลด |
| `mime_type` | VARCHAR(120) NULL | ชนิดไฟล์ที่ client ประกาศ (ไม่เชื่อตอน serve — ดู §7) |
| `sha256` | CHAR(64) NOT NULL | hex digest ของไบต์ที่เก็บจริง |
| `file_size` | INT NOT NULL | |
| `expiry_date` | DATE NULL | วันหมดอายุของเอกสาร (ถ้ามี) |
| `uploaded_by` | INT NOT NULL | FK → `users(id)` |
| `review_status` | ENUM | `PENDING` (default), `APPROVED`, `REJECTED` |
| `reviewed_by` | INT NULL | FK → `users(id)` (school/transport/admin) |
| `reviewed_at` | TIMESTAMP NULL | |
| `review_note` | VARCHAR(500) NULL | เหตุผล (บังคับเมื่อ REJECTED) |
| `is_deleted` / `deleted_at` | | soft-delete |
| `created_at` / `updated_at` | TIMESTAMP | |

Index: `idx_vehdoc_vehicle (vehicle_id, is_deleted)`, `idx_vehdoc_review (review_status)`, `idx_vehdoc_uploaded_by (uploaded_by)`
FK: `fk_vehdoc_vehicle`, `fk_vehdoc_uploaded_by`, `fk_vehdoc_reviewed_by`

### ตาราง `driver_documents`

โครงสร้างเหมือน `vehicle_documents` ทุกประการ ยกเว้น:
- `driver_id` INT NOT NULL — FK → `drivers(id)` (แทน `vehicle_id`)
- `doc_type` ENUM(`DRIVER_LICENCE`, `OTHER`)
- Index: `idx_drvdoc_driver (driver_id, is_deleted)`, `idx_drvdoc_review`, `idx_drvdoc_uploaded_by`

> ทั้งสองตาราง `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` และใช้ `CREATE TABLE IF NOT EXISTS`
> การ apply migration นี้เพียงอย่างเดียว **ไม่เปลี่ยนพฤติกรรมหรือข้อมูลเดิม** เพราะ runtime ถูก gate ด้วย flag

---

## 4. Backend

### 4.1 Service — `backend/src/services/driverDocuments.service.js` (ใหม่)

รวม logic เอกสารทั้งหมดไว้ที่เดียว (รับ `pool` เป็น argument แรก → ทดสอบแบบ DB-free ได้) ฟังก์ชันหลัก:

| ฟังก์ชัน | หน้าที่ |
|----------|--------|
| `addVehicleDocument` / `addDriverDocument` | ตรวจ `doc_type` กับ enum → INSERT + `audit_logs('CREATE')` ใน transaction |
| `listVehicleDocuments` / `listDriverDocuments` | คืนรายการเอกสารที่ `is_deleted = FALSE` |
| `getDocument` | อ่านเอกสาร 1 รายการ + คืน `owner_id` (vehicle_id หรือ driver_id) สำหรับเช็ก scope |
| `reviewDocument` | APPROVED/REJECTED — REJECTED บังคับใส่ note → UPDATE + audit (APPROVE/UPDATE) ใน transaction |
| `softDeleteDocument` | owner-or-admin (`uploaded_by !== userId` → 403 `NOT_OWNER`) |
| `resolveDocumentForViewer` | **หัวใจความปลอดภัยของการ serve** — resolve เอกสารตาม scope ของผู้ดู (ดู §7) |
| `safeResolveStorageKey` | **ตัวกัน path traversal** — รับเฉพาะ basename สะอาด คืน absolute path ใต้ `DOC_BASE_DIR` เท่านั้น |
| `schoolOwnsVehicle` / `schoolOwnsDriver` | ตรวจว่าโรงเรียนมีสิทธิ์เหนือรถ/คนขับนั้นไหม |
| `driverIdForVehicle` | หา driver_id ที่ active ของรถ (จาก `driver_vehicle_assignments`) |

ค่าคงที่ exported: `VEHICLE_DOC_TYPES`, `DRIVER_DOC_TYPES`, `DOC_BASE_DIR` (= `backend/uploads/documents/` แบบ flat)

### 4.2 Upload + การ resolve — `backend/src/routes/registration.routes.js`

ใช้ `multer` disk storage:
- ชื่อไฟล์ที่เก็บ: `${userId}-${timestamp}-${random}.${ext}` (เป็น basename สะอาดเสมอ ไม่ขึ้นกับชื่อเดิม)
- จำกัดขนาด **5 MB**, นามสกุลที่รับ: `.pdf .jpg .jpeg .png .webp`
- `validateStoredDocument()` อ่านไฟล์ที่เขียนแล้ว → ตรวจ **magic-byte** (`isAllowedDocument` = PDF หรือรูปที่อนุญาต) → ถ้าไม่ผ่าน **unlink ทิ้งทันที** → คืน `{ sha256, size }`
- vehicle_id / driver_id resolve จากบัญชีคนขับฝั่งเซิร์ฟเวอร์ (`resolveDriverVehicleId`, `driverIdForVehicle`) — ไม่อ่านจาก body

### 4.3 การ serve ไฟล์ — `backend/src/routes/documents.routes.js` (ใหม่)

`GET /api/documents/:docType/:id/file` (docType ∈ `vehicle` | `driver`):
- `authenticate` + `requireRole('driver','school','transport','admin')`
- เรียก `resolveDocumentForViewer` (scoped ตาม role) → `safeResolveStorageKey` → `fs.createReadStream`
- ตั้ง header: `Content-Type` แบบ whitelist (clamp), `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`,
  `Content-Disposition: inline` (filename strip `\r \n "`)
- เขียน `audit_logs('EXPORT', view_document)`
- ทุกความล้มเหลว (ไม่พบ row / นอก scope / poisoned key / ไฟล์หาย) คืน **404 เดียวกัน** `DOCUMENT_NOT_FOUND` (ไม่รั่วข้อมูล)

### 4.4 การ mount + feature flag — `backend/src/app.js`

mount ใต้บล็อก `if (env.features.driverRegistration)` เท่านั้น:
```js
app.use('/api/documents', require('./routes/documents.routes'));
```
เมื่อ flag ปิด → path เหล่านี้ 404 และระบบเดิมไม่เปลี่ยน (true dark launch)

### 4.5 ฝั่งขนส่ง — `backend/src/routes/verification.routes.js`

เพิ่ม middleware `requireDocFeature` (404 เมื่อ flag ปิด) + 3 routes ใต้ `/api/verification/transport/documents/*`
(เป็น first middleware ก่อน `requireRole` เพื่อให้ dark แม้ผู้ใช้ transport ที่ auth แล้ว)

### 4.6 ปรับเสริม — `getSchoolRegistrationDetail`

`backend/src/services/vehicleRegistration.service.js` — เพิ่มคืน `vehicle_id`, `driver_id`, `plate_no`
ในรายละเอียดคำขอ เพื่อให้หน้าตรวจของโรงเรียนโหลดเอกสารได้ในทริปเดียว

### 4.7 ปรับเสริม — `backend/src/utils/fileType.js`

เพิ่ม `isPdf()` (magic `%PDF-`) และ `isAllowedDocument()` (= PDF หรือ `isAllowedImage`) — **เพิ่มเท่านั้น**
helper เดิม (`isAllowedImage`, การตรวจ import) ไม่เปลี่ยน

---

## 5. Frontend

### 5.1 ฝั่งคนขับ — `frontend/src/pages/driver/DriverVehicleRegistration.jsx`

เพิ่มส่วน **"เอกสารรถและคนขับ"** (component `DriverDocuments`) ใช้ดีไซน์เดิมของหน้าคนขับ
(ผู้ใช้สูงอายุ/ไม่ถนัดเทคโนโลยี: ปุ่มใหญ่ ≥56px, ภาษาไทยตรงไปตรงมา, สถานะเป็น "คำ" มีสี):
- แนบเอกสาร 2 แตะ: เลือกประเภท → เลือกไฟล์ → อัปโหลดอัตโนมัติ
- รายการเอกสารพร้อม pill สถานะ: **รอตรวจ / ผ่านแล้ว / ไม่ผ่าน — แนบใหม่** + แสดงเหตุผลเมื่อไม่ผ่าน
- ปุ่ม **ดู** (เปิดไฟล์) และ **ลบ** (เอกสารที่ APPROVED แล้วล็อก ลบไม่ได้)

### 5.2 ฝั่งโรงเรียน — `frontend/src/pages/school/SchoolRegistrationReview.jsx`

เพิ่มส่วนตรวจเอกสาร (component `DocumentReview`) ในหน้ารายละเอียดคำขอ:
- โหลดเอกสารรถ + คนขับจาก `detail.vehicle_id` / `detail.driver_id`
- ปุ่ม **ดูไฟล์** + **ผ่าน / ไม่ผ่าน** (ไม่ผ่านต้องใส่เหตุผล) + แสดงวันหมดอายุ/เหตุผล
- บัญชีครูประจำสายชั้น (grade teacher) ดูได้อย่างเดียว (`canReview = !isTeacher`)

### 5.3 การเปิดดูไฟล์ที่ต้อง auth

route ไฟล์ต้องมี Bearer token ดังนั้น `<img src>` ธรรมดาใช้ไม่ได้ — ทั้งสองหน้าจึง **fetch ไฟล์เป็น blob ผ่าน axios**
(แนบ token อัตโนมัติ) → `URL.createObjectURL` → เปิดแท็บใหม่ → revoke URL ภายหลัง

---

## 6. API Endpoints

### คนขับ (role: `driver`) — ใต้ `/api/driver/registrations`
```
POST   /documents/vehicle              แนบเอกสารรถ (multipart: file, doc_type, expiry_date)
POST   /documents/driver               แนบเอกสารคนขับ (multipart: file, doc_type, expiry_date)
GET    /documents                      รายการเอกสารรถ + คนขับของตัวเอง
DELETE /documents/:kind/:id            ลบเอกสารของตัวเอง (kind ∈ vehicle|driver)
```

### โรงเรียน (role: `school`, `admin`) — ใต้ `/api/school/registrations`
```
GET    /documents/vehicle/:vehicleId   เอกสารของรถ (เช็ก schoolOwnsVehicle)
GET    /documents/driver/:driverId     เอกสารของคนขับ (เช็ก schoolOwnsDriver)
POST   /documents/:kind/:id/review     ตรวจเอกสาร { decision: APPROVED|REJECTED, note }
```

### ขนส่ง (role: `transport`, `admin`) — ใต้ `/api/verification` (gate `requireDocFeature`)
```
GET    /transport/documents/vehicle/:vehicleId
GET    /transport/documents/driver/:driverId
POST   /transport/documents/:kind/:id/review
```

### การเปิดดูไฟล์ (ทุก role ข้างต้น) — ใต้ `/api/documents`
```
GET    /:docType/:id/file              docType ∈ vehicle|driver — serve แบบ auth + scoped + inline
```

> ทั้งหมดนี้ใช้งานได้เฉพาะเมื่อ `FEATURE_DRIVER_REGISTRATION=true` (มิฉะนั้น 404)

---

## 7. ความปลอดภัย (Security)

ผ่านการตรวจแบบ adversarial (2 มุมมอง: serving-security + upload/scope/dark-flag) — **CONFIRMED-CORRECT**

| ภัย | การป้องกัน |
|-----|-----------|
| **Path traversal** | `safeResolveStorageKey` ปฏิเสธ NUL, ตัวคั่น path, `..`, `.`, ค่าว่าง, absolute path; รับเฉพาะ basename สะอาด และยืนยันซ้ำว่า resolved path อยู่ใต้ `DOC_BASE_DIR`. `storage_key` ที่ถูก poison (เช่น `../../../etc/passwd`) → 404 |
| **IDOR / ข้ามขอบเขต** | `resolveDocumentForViewer` ผูก scope จาก **JWT** เสมอ ไม่ใช่จาก URL: โรงเรียนผูก `school_id` ใน JOIN (`inspection_application_schools`), คนขับผูก `uploaded_by = userId OR vehicle_id = (รถของตัวเองที่ resolve ฝั่ง server)`, transport/admin ไม่มี scope (ตาม RBAC). id ที่นอก scope → 0 row → 404 |
| **Header injection / XSS** | `Content-Disposition` strip `\r \n "`; mime ที่มี CRLF ทำให้ Node โยน error (ไม่ split header); polyglot ถูกคุมด้วย CSP `sandbox` + `nosniff` |
| **Mime หลอก (polyglot)** | ตอน serve **clamp `Content-Type`** เป็น whitelist `application/pdf, image/png, image/jpeg, image/webp` เท่านั้น; ชนิดอื่น downgrade เป็น `application/octet-stream` (ดาวน์โหลด ไม่ render inline) → ฆ่า XSS residual โดยไฟล์จริงยังดูได้ปกติ |
| **Upload ไฟล์อันตราย** | ตรวจ magic-byte ของไบต์จริง (`.exe`/HTML/SVG/ZIP เปลี่ยนนามสกุลเป็น `.pdf` ก็ไม่ผ่าน) + unlink ทุก path ที่ reject (ไม่มีไฟล์ค้าง) |
| **404 oracle** | ทุกกรณีล้มเหลวคืน 404 + ข้อความ/code เดียวกัน ไม่บอกว่าเอกสารมีอยู่จริงหรือไม่ |
| **Dark-flag containment** | `/api/documents` + registration routers mount ใต้ flag; routes ฝั่ง transport gate ด้วย `requireDocFeature` เป็น middleware ตัวแรก; ไม่ถูกบัง/บังโดยกำแพง `/uploads` 404 |

---

## 8. RBAC

| การกระทำ | driver | school | transport | province/affiliation | admin |
|----------|--------|--------|-----------|----------------------|-------|
| แนบเอกสาร (รถ/คนขับของตน) | ✅ | ❌ | ❌ | ❌ | ❌ |
| ดูรายการ + เปิดไฟล์ | ✅ ของตน | ✅ ในขอบเขตโรงเรียน | ✅ ทุกคัน | ❌ | ✅ |
| ตรวจเอกสาร (ผ่าน/ไม่ผ่าน) | ❌ | ✅ ในขอบเขต (ยกเว้นครูสายชั้น) | ✅ | ❌ | ✅ |
| ลบเอกสาร | ✅ ของตน (ยังไม่ APPROVED) | ❌ | ❌ | ❌ | ✅ |

> `parent` / `province` / `affiliation` ถูกปฏิเสธโดย allow-list ของ router (403)

---

## 9. ไฟล์ที่เปลี่ยนแปลง

### เพิ่มใหม่
```
backend/migrations/045_driver_documents.sql
backend/src/services/driverDocuments.service.js
backend/src/routes/documents.routes.js
backend/tests/driverDocuments.unit.test.js
docs/UPDATE-2026-06-27-driver-documents.md   (ไฟล์นี้)
```

### แก้ไข
```
backend/src/app.js                              (mount /api/documents ใต้ flag)
backend/src/routes/registration.routes.js       (upload/list/delete + multer + validateStoredDocument)
backend/src/routes/verification.routes.js        (transport doc routes + requireDocFeature)
backend/src/services/vehicleRegistration.service.js  (detail คืน vehicle_id/driver_id/plate_no)
backend/src/utils/fileType.js                    (isPdf, isAllowedDocument — เพิ่มเท่านั้น)
frontend/src/pages/driver/DriverVehicleRegistration.jsx   (component DriverDocuments)
frontend/src/pages/school/SchoolRegistrationReview.jsx     (component DocumentReview)
```

> หมายเหตุ: ไฟล์ฝั่ง registration/roster (migration 044, registration.routes.js, vehicleRegistration.service.js,
> registrationMatch.js) เป็น WIP ของฟีเจอร์ roster ที่ยัง untracked — ฟีเจอร์เอกสารนี้พันอยู่กับชุดนั้น

---

## 10. การทดสอบและการตรวจสอบ

- **Unit tests:** `npx jest --config jest.unit.config.js` → **18 suites / 185 tests ผ่านทั้งหมด**
  (รวมไฟล์ใหม่ `driverDocuments.unit.test.js` — 22 เคส: traversal guard, IDOR/scope, CRUD/review guards แบบ DB-free)
- **Syntax:** `node -c` ผ่านทุกไฟล์ backend; esbuild transform ผ่านทั้ง 2 หน้า frontend (โปรเจกต์ frontend ไม่มี eslint config)
- **App-graph smoke:** `require('./src/app.js')` ด้วย `FEATURE_DRIVER_REGISTRATION=true` โหลด dark routers ได้
- **Adversarial verify (workflow):** 2 มุมมอง → **CONFIRMED-CORRECT** (IDOR, traversal, header-injection/XSS, 404-oracle,
  dark-flag, magic-byte, migration 045 ถูกต้องครบ); residual เรื่อง mime ถูกปิดด้วย whitelist clamp ตอน serve

---

## 11. แผนการ Deploy

ฟีเจอร์นี้ **ยังไม่ deploy** — ต้องทำพร้อมฟีเจอร์ roster (อยู่ใน flag เดียวกัน) ตามขั้นตอน:

1. **Backup ฐานข้อมูล** (`mysqldump` ลง `/home/schoolbus/db-backup/`)
2. **Apply migration 045** (และ 044 ถ้ายังไม่ได้ apply) บน prod — additive, ไม่กระทบข้อมูลเดิม
3. สร้างโฟลเดอร์ `backend/uploads/documents/` (writable โดย process)
4. `npm run build` ฝั่ง frontend (จะรวม redesign WIP เข้าด้วย — ต้องตกลงก่อน)
5. ตั้ง `FEATURE_DRIVER_REGISTRATION=true` ใน `.env`
6. `pm2 restart schoolbus-backend` → ตรวจ `/health` + ทดสอบ flow จริง
7. (ถ้าจะปิดกลับ) เพียงตั้ง flag = false → path 404 ระบบเดิมไม่กระทบ

> ยังไม่ได้ push ขึ้น GitHub (prod box ไม่มี git credential) — รอ token

---

## 12. ข้อจำกัดและงานที่เหลือ

- เอกสาร = **หลักฐานประกอบเท่านั้น** ตั้งใจไม่ผูกกับ eligibility/verification อัตโนมัติ (ป้องกันการข้ามการตรวจสภาพจริง)
- ยังไม่มีการแจ้งเตือน LINE เมื่อเอกสารถูก reject (คนขับเห็นผลเมื่อเปิดหน้าเท่านั้น) — เป็นงานต่อยอดได้
- ยังไม่มีหน้า UI ฝั่ง transport สำหรับดู/ตรวจเอกสาร (มีแต่ API) — ฝั่ง transport ตรวจผ่าน API/ส่วนอื่นได้ แต่ UI เฉพาะยังไม่ทำ
- `mime_type` ที่เก็บคือชนิดที่ client ประกาศ (จึงไม่เชื่อตอน serve และใช้ whitelist clamp แทน) — ถ้าต้องการความแม่นยำ
  อาจ derive ชนิดจากไบต์ที่ sniff ในอนาคต (defense-in-depth เพิ่มเติม ไม่จำเป็นต่อความถูกต้อง)
