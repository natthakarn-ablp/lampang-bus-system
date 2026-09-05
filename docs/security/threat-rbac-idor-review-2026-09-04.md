# Threat / RBAC / IDOR / Cross-scope Review — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **การทบทวนจาก source code ไม่ใช่การทดสอบเจาะระบบ ไม่ใช่ผลการทดสอบ ไม่ใช่การอนุมัติ และไม่ใช่หลักฐานว่าช่องโหว่ถูกปิดแล้ว** — ทุกข้อในเอกสารนี้อ่านจากไฟล์ที่ระบุไว้ตรง ๆ **ยกเว้นสามจุดที่ระบุไว้ชัดเจนในตัวข้อว่าเป็นการสังเกตจริง** (สอง request แบบไม่ยืนยันตัวตนไปยัง sandbox ใน §3.1 และการทดสอบ `res.setHeader` ใน S6) ไม่มีการเข้าถึง production และไม่มี integration test ใดถูกรันประกอบ

Task: `A1-11` (Phase 7) ตาม `docs/project-closure/execution-plan-to-completion-2026-09-04.md` §5 — **ยังไม่ครบตาม exit evidence ของ task นั้น** เพราะ exit evidence กำหนดว่าต้องมี "negative tests ต่อ finding" ด้วย เอกสารฉบับนี้ให้เฉพาะ **ส่วนที่เป็นการทบทวน** และระบุว่า negative test แต่ละข้อควรพิสูจน์อะไร แต่ยังไม่ได้เขียน test นั้น

---

## 1. ขอบเขต วิธีการ และฐานที่ทบทวน

| รายการ | ค่า |
|---|---|
| Commit ที่อ่าน | `4b80b4b` บน `feat/tracking-security-hardening` |
| ความสัมพันธ์กับ RC | `cef4bd1` (RC) เป็น ancestor ของ `4b80b4b` ห่างกัน 3 commit |
| Runtime code ต่างจาก RC หรือไม่ | **ไม่ต่าง** — `git diff --name-only cef4bd1..HEAD -- backend/src frontend/src` คืนค่า 0 ไฟล์ ทั้งสาม commit แตะรวม **15 ไฟล์**: 3 ไฟล์ใต้ `docs/project-closure/`, 8 ไฟล์ใต้ `scripts/`, 3 ไฟล์ใต้ `backend/tests/` และ `.gitattributes` ที่ root (ไฟล์เดียวที่อยู่นอกสามไดเรกทอรีนั้น) ดังนั้นข้อสรุปในเอกสารนี้ใช้กับ RC ได้ **เฉพาะในส่วน runtime code** |
| เครื่องมือที่รัน | `backend/scripts/generate-rbac-matrix.js` และ `backend/scripts/audit-scope-enforcement.js` |
| ที่เก็บผลของเครื่องมือ | ไดเรกทอรีชั่วคราวนอก repository — **ไม่ได้เขียนลง `outputs/rbac-matrix/`** ตามข้อจำกัดของงานนี้ |
| Feature flag ขณะรันเครื่องมือ | จาก `backend/.env.test.example:12-14` — `FEATURE_DRIVER_SHIFT_SELECTION=false`, `FEATURE_VEHICLE_QR=false`, `FEATURE_QR_LEVEL3=false` ส่วน flag อื่นไม่ได้ตั้งค่าจึงเป็น `false` ตาม default ใน `backend/src/config/env.js:205-238` |

ผลดิบที่ได้:

```
[rbac]  249 routes, 0 findings
[scope] id-addressed writes=75 scoped-role-reachable=30 org=25 self=5 actor-only=0 gaps=0 unmounted=12
```

แยกเป็น write 120 route / read 129 route โดยในฝั่ง read มี 19 route ที่ระบุ resource ด้วย id ใน path

**ข้อควรระวังเรื่องการอ่านตัวเลขนี้:** `gaps=0` ไม่ได้แปลว่า "ไม่มีช่องโหว่ cross-scope" — แปลว่า "ในกลุ่มที่เครื่องมือเลือกมาตรวจ ทุกตัวมี token ที่บ่งชี้ว่ามีการ resolve scope" §2 อธิบายว่ากลุ่มที่เครื่องมือเลือกมาตรวจคือกลุ่มไหน และตัดอะไรออกไปบ้าง

---

## 2. สิ่งที่ `audit-scope-enforcement.js` **ไม่** ครอบคลุม

เครื่องมือระบุขอบเขตของตัวเองไว้ตรงไปตรงมาใน docstring (`backend/scripts/audit-scope-enforcement.js:1-35`) เอกสารนี้ขยายความว่าขอบเขตนั้นทิ้งอะไรไว้ข้างนอก เพราะ **สิ่งที่อยู่ข้างนอกคือเนื้องานของ A1-11 ไม่ใช่การเล่าซ้ำว่า gaps=0**

| # | ข้อจำกัด | โค้ดที่กำหนดข้อจำกัด | สิ่งที่หลุดออกจากการตรวจ |
|---|---|---|---|
| L1 | ตรวจเฉพาะ **write method** | `WRITE_METHODS = ['post','put','patch','delete']` — `audit-scope-enforcement.js:42` | 129 read route ไม่ถูกตรวจเลย ในนั้นมี 19 route ที่ระบุด้วย id และ 10 route ในจำนวนนั้นเรียกได้โดยบทบาทที่มี scope แคบ (§4) |
| L2 | ตรวจเฉพาะ route ที่มี `:` ใน path | `if (!routePath.includes(':')) continue;` — `audit-scope-enforcement.js:142` | `/api/reports/*` ทั้ง 11 route ไม่ถูกตรวจ ทั้งที่ scope มาจาก **query parameter** (`school_id`, `affiliation_id`, `vehicle_id`) ซึ่งเป็นพื้นผิว cross-scope แบบเดียวกับ IDOR |
| L3 | นับเฉพาะ 3 บทบาทว่า "มี scope แคบ" | `SCOPED_ROLES = ['school','affiliation','driver']` — `audit-scope-enforcement.js:45` | `transport`, `province`, `admin` ถูกจัดเป็น out-of-scope โดยนิยาม และ `parent` (ยืนยันด้วย LINE id_token ไม่ใช่ JWT role ตาม `CLAUDE.md:974`) ไม่อยู่ในโมเดลเลย |
| L4 | อ่านเฉพาะ router ที่ **mount จริง** ใต้ flag ปัจจุบัน | `attachRoles()` (`audit-scope-enforcement.js:198`) ตั้ง `roles = null` ที่ `:205` แล้ว `needs_scope=false` ที่ `:210` | 12 id-addressed write ถูกกันออกด้วยเหตุผล "unmounted" ไม่ใช่ "ปลอดภัย" (รายการเต็มใน §5.1) |
| L5 | เป็น static token match ไม่ได้พิสูจน์ว่า predicate ถูก | docstring ระบุเอง — `audit-scope-enforcement.js:27-29` | SQL ที่ resolve scope ผิด แต่มีคำว่า `req.user.scopeId` อยู่ในตัว handler จะผ่านการตรวจ |

เช่นเดียวกัน `generate-rbac-matrix.js` มีข้อจำกัดของตัวเอง — ดู S9 ใน §6

---

## 3. โมเดล scope ต่อบทบาทที่บังคับจริงฝั่ง server

| บทบาท | สิ่งที่ผูก scope | บังคับที่ไหน |
|---|---|---|
| `driver` | รถที่ตนขับ (ผ่าน `driver_id` → active assignment หรือ open shift) | `backend/src/services/checkin.service.js:66-103` |
| `school` | `users.scope_id` (school_id) | `backend/src/routes/school.routes.js:44-47` (`resolveSchoolId` คืน `req.user.scopeId` สำหรับทุกบทบาทที่ไม่ใช่ admin) |
| `school` + `grade_scope` (ครูประจำสายชั้น) | ระดับชั้นของตน | `school.routes.js:69-75` (`resolveGradeScope`) และ `school.routes.js:88-98` (`requireFullSchoolScope` ปิด write/หน้าที่เป็น full-school) ใช้ 40 จุดในไฟล์เดียว |
| `affiliation` | `users.scope_id` (affiliation_id) | `backend/src/routes/affiliation.routes.js:164-167` |
| `province` | ทั้งจังหวัด (ไม่มี scope แคบกว่า) | `CLAUDE.md:978-981` |
| `transport` | รถทุกคัน ไม่มี scope แคบกว่า | `backend/src/routes/transport.routes.js:14` |
| `admin` | ทั้งระบบ ระบุ scope เองผ่าน query/body ได้ | `school.routes.js:45`, `affiliation.routes.js:165` |
| `parent` | บุตรหลานที่ผูกบัญชีและ `parent_student.approved = TRUE` | `backend/src/services/line.service.js:244-271` เรียกจาก `backend/src/routes/parent.routes.js:124-125, 139-140, 172-173` |

### 3.1 ชั้น authentication — สิ่งที่เขียนไว้ใน source

ทุกข้อในหัวข้อนี้ **อ่านจาก source ยังไม่ได้ทดสอบ runtime** ยกเว้นสองข้อท้ายหัวข้อที่ระบุว่ายิง request จริง

- Algorithm ถูก pin ไว้ที่ HS256 กัน alg-confusion — `backend/src/middleware/auth.js:45`
- Refresh token ที่ยื่นมาเป็น access token ถูกปฏิเสธ — `auth.js:48-50`
- ทุก request ที่ผ่าน `authenticate` มีการอ่านสถานะบัญชีจาก DB ใหม่ ไม่ได้เชื่อ claim ใน token อย่างเดียว — `auth.js:70-81`
- Access token ที่ออกก่อนเปลี่ยนรหัสผ่านถูกตัดทันที — `auth.js:88-93`
- Forced password change บังคับฝั่ง backend มี allowlist 3 path — `auth.js:11-15, 103-110`
- **ไม่มี route ใดถูกประกาศก่อน guard ของ router ตัวเอง** — `backend/src/routes/` มี **23 ไฟล์** ตรวจครบทั้ง 23 ไฟล์ด้วยการเทียบเลขบรรทัดของ guard ระดับ router กับเลขบรรทัดของ `*.get|post|put|patch|delete` ทุกตัวในไฟล์เดียวกัน ผลคือ **16 ไฟล์ที่มี guard ระดับ router ไม่มีไฟล์ใดมี route อยู่เหนือ guard ของตัวเอง**: `admin.routes.js:94`, `school.routes.js:158`, `affiliation.routes.js:162`, `province.routes.js:36`, `transport.routes.js:14`, `driver.routes.js:88`, `verification.routes.js:14`, `report.routes.js:16`, `readiness.routes.js:16`, `documents.routes.js:26`, `participation.routes.js:31`, `terms.routes.js:10`, `eta.routes.js:33`, `geofence.routes.js:34`, `routeDeviation.routes.js:27` และ `registration.routes.js` ที่มี guard สองตัวแยกกันต่อ sub-router (`:71` driverRouter → route แรกที่ `:73`, `:170` schoolRouter → route แรกที่ `:204`)
- อีก **7 ไฟล์ไม่มี guard ระดับ router เลย** จึงต้องอ่านเป็นราย route ไม่ใช่รายไฟล์: `auth.routes.js`, `adminPasswordRecovery.routes.js`, `consent.routes.js`, `line.routes.js`, `parent.routes.js`, `qr.routes.js`, `visits.routes.js` — กลุ่มนี้ใช้กลไกอื่นแทน JWT role (LINE id_token, webhook signature, signed QR token, API key) ตามที่ `generate-rbac-matrix.js:34-41` ประกาศไว้ **ซึ่งประกาศแบบ prefix และหยาบเกินไป — ดู S9** ในกลุ่มนี้ `visits.routes.js:23` (`POST /api/visits/track`) เป็น public counter โดยเจตนา (`app.js:172-188`, `generate-rbac-matrix.js:66-69`)

**สองข้อเดียวในหัวข้อนี้ที่ยิง request จริง** (sandbox ที่รันอยู่ `http://localhost:3000`, 4 ก.ย. 2569):
- `GET /api/school/audit-logs` ไม่มี `Authorization` header → `401` `"Authorization header missing or malformed"`
- token ปลอมที่ header เป็น `{"alg":"none"}` → `401` `"Invalid token"` สอดคล้องกับการ pin HS256 ที่ `auth.js:45` (ยังไม่ได้ทดสอบเคส HS256 ที่ลงนามด้วย secret อื่น)

ข้ออื่นทั้งหมดในหัวข้อนี้ยังไม่มีผลการทดสอบ — ดู U1 ใน §7

---

## 4. Route ที่ระบุด้วย id — วิธี resolve scope ฝั่ง server

### 4.1 กลุ่ม write (75 route, มี 30 route ที่บทบาท scope แคบเรียกได้)

เครื่องมือรายงาน `org=25 self=5 actor-only=0 gaps=0` กลุ่ม self 5 ตัวเป็นของ `driver` ทั้งหมด และ resolve รถจาก token ไม่ใช่จาก body:

| Route | resolve scope ด้วย |
|---|---|
| `POST /api/driver/shifts/:id/end` | `driverId` จาก token |
| `DELETE /api/driver/pickup-points/:id` | `getDriverVehicle` |
| `PUT /api/driver/pickup-points/:id/students` | `getDriverVehicle` |
| `DELETE /api/driver/leave/:id` | `getDriverVehicle` |
| `POST /api/driver/checkin/:logId/void` | `getDriverVehicle` — และ service ยืนยัน `vehicle_id` ของ log ซ้ำใน locked transaction (`driver.routes.js:1291-1295`) |

### 4.2 กลุ่ม read ที่ระบุด้วย id และบทบาท scope แคบเรียกได้ (10 route — **เครื่องมือไม่ได้ตรวจกลุ่มนี้**)

ทบทวนด้วยมือทุกตัวจาก source ผลคือ **ทั้ง 10 ตัวมีโค้ด resolve scope ฝั่ง server** ไม่มีตัวใดพึ่งการซ่อนเมนู — แต่นี่คือการอ่าน predicate ไม่ใช่การยิง request ข้ามขอบเขตแล้วดูผล ข้อจำกัด **L5** (§2: static read ไม่พิสูจน์ว่า predicate ถูก) ใช้กับตารางนี้ด้วย การพิสูจน์จริงต้องรอ negative test ตาม §8:

| Route | บทบาทที่เรียกได้ | scope ถูก resolve ที่ |
|---|---|---|
| `GET /api/affiliation/transfer-requests/:id` | admin, affiliation | `affiliation.routes.js:741-749` — ส่ง `affiliationId` จาก `resolveAffiliationId` เข้า `getDetailForAffiliation` |
| `GET /api/affiliation/vehicle-requests/:id` | admin, affiliation | `affiliation.routes.js:793-801` — รูปแบบเดียวกัน |
| `GET /api/driver/applications/:id` | driver | `driver.routes.js:1280-1289` ส่ง `viewer.userId` และ service ผูก `a.requested_by = ?` ที่ `services/vehicleVerification.service.js:437, 441` |
| `GET /api/driver/pickup-points/:id/assignable-students` | driver | `driver.routes.js:372-379` — เทียบ `point.vehicle_id` กับรถที่ resolve จาก token แล้ว 403 |
| `GET /api/school/pickup-points/:id/assignable-students` | admin, school | `school.routes.js:426-441` — `validateVehicleServesSchool` + **ส่ง `gradeFilter` จาก `resolveGradeScope` ต่อไปยัง query** (`services/pickupPoint.service.js:452-455`) |
| `GET /api/school/students/import/:batchId` | admin, school | `school.routes.js:1726` มี `requireFullSchoolScope` (กันครูประจำสายชั้น **ไม่ใช่** ตัว resolve scope) และ `:1728` ส่ง `resolveSchoolId(req)` เข้า `getBatchDetail` ซึ่งเทียบ `batch.school_id` แล้วโยน 403 (`services/studentImportPreview.service.js:659`) |
| `GET /api/school/students/import/:batchId/report` | admin, school | `school.routes.js:1799` มี `requireFullSchoolScope` และ `:1801` ส่ง `resolveSchoolId(req)` เข้า `getReport` ซึ่งโยน 403 ที่ `studentImportPreview.service.js:608` |
| `GET /api/school/vehicles/requests/:id` | admin, school | `school.routes.js:1875` มี `requireFullSchoolScope` และ `:1878` ส่ง `resolveSchoolId(req)` เข้า `getSchoolVehicleRequest` ซึ่งโยน 403 ที่ `services/vehicleRequest.service.js:84` |
| `GET /api/verification/applications/:id` | admin, province, school, transport | `verification.routes.js:66-81` ส่ง `viewer.schoolId` และ service ใช้ `accessJoin` ผ่าน `inspection_application_schools` (`vehicleVerification.service.js:438-446`) — บัญชี school ที่ไม่มี scopeId จะ 403 ไม่ใช่ผ่าน (`:432`) |
| `GET /api/verification/applications/:id/timeline` | admin, driver, province, school, transport | `verification.routes.js:160-173` — driver ผูก `a.requested_by`, school ผูก `aps.school_id`, ที่เหลือเป็น `'TRUE'` ดู **S3** ใน §6 |

### 4.3 กลุ่มที่ scope มาจาก query parameter ไม่ใช่ path id (`/api/reports/*` — เครื่องมือไม่ตรวจ)

`report.routes.js:45-59` รับ `school_id`, `affiliation_id`, `vehicle_id` จาก query แล้วส่งต่อเป็น `req.filters` การป้องกันอยู่ที่ `services/report.service.js:30-65`:

- บทบาท `school` ถูกผูก `s.school_id = user.scopeId` ก่อนเสมอ (`:35-42`) และถ้ามี `gradeScope` จะเติม `s.grade IN (...)` ด้วย (`:38-41`)
- บทบาท `affiliation` ถูกผูก `sc.affiliation_id = user.scopeId` (`:43-46`)
- filter จาก query **ไม่แทนที่ clause ของบทบาท** แต่กลไกไม่เหมือนกันทั้งสาม field (`:50-64`) และคำอธิบายต้องตรง:
  - `school_id` ที่ไม่ตรง `scopeId` ของผู้เรียกบทบาท `school` ถูก **ข้ามไปเฉย ๆ (ignored)** ไม่ถูก AND เข้าไป (`:52`) ผู้เรียกจึงยังได้แถวในขอบเขตตนเองตามปกติ **ไม่ใช่ผลลัพธ์ว่าง**
  - `affiliation_id` ถูกข้ามทั้งบทบาท `school` และ `affiliation` (`:57`)
  - มีเพียง `vehicle_id` ที่ถูก **AND** เข้าไปเสมอทุกบทบาท (`:61-64`) การใส่ id รถนอกขอบเขตจึงให้ผลลัพธ์ว่างจริง
  - ทั้งสามกรณีไม่มีทางเห็นข้ามขอบเขต แต่ negative test ที่เขียนจากคำว่า "ผลลัพธ์ว่าง" จะ fail ผิดข้อ — ถ้อยคำที่ถูกคือ *ignored* ตรงกับ test ที่มีอยู่แล้วใน repo (`backend/tests/crossSchoolIsolation.test.js:81` — `"GET /students?school_id=__TSCH2 (spoof) is IGNORED"`)
- `getPolicyReport` ปฏิเสธทุกบทบาทที่ไม่ใช่ province/admin ที่ชั้น service (`report.service.js:476-481`)

**ประเมินว่าถูกต้อง** แต่ให้สังเกตว่านี่เป็นการป้องกันที่ไม่มีเครื่องมืออัตโนมัติตัวใดในโครงการเฝ้าอยู่เลย — regression ที่ย้าย clause ของบทบาทไปอยู่หลัง optional filter จะไม่ทำให้ `gaps` เปลี่ยนจาก 0

---

## 5. พื้นที่ที่ audit เดิมไม่แตะ — ทบทวนรายพื้นที่

### 5.1 Router ที่ปิดด้วย feature flag (ไม่อยู่ในตัวเลข 249 route และไม่อยู่ในตัวเลข gaps=0)

Router ต่อไปนี้ **ไม่ถูก mount** ขณะรันเครื่องมือ จึงไม่ปรากฏใน RBAC matrix และไม่ถูกนับใน scope audit เลย:

| Router | flag | mount ที่ |
|---|---|---|
| `/api/participation` | `FEATURE_PARTICIPATION_CASES` | `app.js:196-198` |
| `/api/qr`, `/api/consent` | `FEATURE_VEHICLE_QR` | `app.js:203-219` |
| `/api/driver/registrations`, `/api/school/registrations`, `/api/documents` | `FEATURE_DRIVER_REGISTRATION` | `app.js:139-146` |
| `/api/eta`, `/api/geofences`, `/api/route-deviations` | `FEATURE_ETA` / `FEATURE_GEOFENCE` / `FEATURE_ROUTE_DEVIATION` | `app.js:228-236` |

12 id-addressed write ที่ถูกกันออกด้วยเหตุ "unmounted" คือ:

```
PUT/DELETE  geofence.routes.js       /:id                              scope_kind=none
POST        participation.routes.js  /cases/:id/events                 scope_kind=organisation
POST        qr.routes.js             /vehicle/:id/token, /vehicle/:id/revoke   scope_kind=none
DELETE      registration.routes.js   /students/:id                     scope_kind=self
DELETE      registration.routes.js   /documents/:kind/:id              scope_kind=actor
POST        registration.routes.js   /documents/:kind/:id/review       scope_kind=organisation
POST/PATCH  registration.routes.js   /:applicationId/students/:rosterId(/match)  scope_kind=organisation
POST        registration.routes.js   /:applicationId/approve, /:applicationId/reject  scope_kind=organisation
```

ตรวจด้วยมือแล้ว: `scope_kind=none` ของ geofence และ qr **ไม่ใช่ช่องโหว่** — `geofence.routes.js:64` บังคับ `requireRole('admin')` ทั้ง router และ `qr.routes.js:42, 65` บังคับ `requireRole('admin','transport')` ซึ่งเป็นบทบาทที่ไม่มี scope แคบกว่าตามโมเดลของเครื่องมือเอง

**สิ่งที่ต้องบันทึกไว้:** ถ้า owner ตัดสิน (รอ C0-4) ให้เปิด flag ใดก็ตาม ต้อง **รันเครื่องมือทั้งสองใหม่ด้วย flag ชุดที่จะใช้จริง** ก่อน แล้วจึงอ้าง `findings=0` / `gaps=0` ได้ ตัวเลขที่ผลิตจาก `.env.test.example` เป็นตัวเลขของระบบที่ปิด flag ทั้งหมด ไม่ใช่ของ RC ที่จะ deploy

### 5.2 Research export

`GET /api/admin/research-export` และ `/preview` เรียกได้เฉพาะ `admin` (router guard ที่ `admin.routes.js:94`) — ไม่มีบทบาทอื่นเข้าถึงได้ ตรวจแล้วว่าไม่มี research route ใดเปิดให้ province/affiliation

สิ่งที่ทำถูก:
- มี rate limit เฉพาะทางบน route หลัก (`importExportLimiter` ที่ `admin.routes.js:986`, นิยามที่ `middleware/rateLimiters.js:28`)
- เขียน audit `EXPORT` ทุกครั้ง (`admin.routes.js:1168-1174`)
- `redactAuditValue` ถูกใช้กับ `new_value` ของ audit log ที่ส่งออก (`admin.routes.js:1033, 1046`)
- CSV ผ่าน `neutralizeSpreadsheetCell` กัน formula injection (`admin.routes.js:1181-1187`)
- ชุดข้อมูลมี `readiness_note` บอกชัดว่าไม่ใช่ผลการวิจัย (`admin.routes.js:1006`)

สิ่งที่ยังไม่ถูก: **S6** ใน §6 (from/to ไม่ถูก validate) และ `/research-export/preview` (`admin.routes.js:1368`) ไม่มี `importExportLimiter` มีเพียง global floor 120/นาที (`app.js:115-127`)

ช่องที่ยังเว้นว่างโดยตั้งใจ: `meta` ของชุดข้อมูลไม่มี field `period` / `population` ตามที่ A1-1 ต้องการ — **รอ C0-6** ห้ามเติมเอง และเกณฑ์ว่าชุดข้อมูลนี้ "พร้อมประเมิน" หรือไม่ — **รอ C0-11**

### 5.3 Participation workflow (Phase 4/7 ของ master plan)

Scope predicate ของเส้นทาง **อ่าน (list / detail / summary) และการ re-check ตอนเขียน event** สร้างจาก token ไม่ใช่จาก request และถูกใช้ซ้ำใน transaction ตอนเขียน (อ่านจาก source; flag ปิดอยู่ จึงยังไม่ได้ทดสอบ runtime) — คำว่า "ครบ" ใช้กับ predicate ชุดนี้เท่านั้น **ไม่ได้แปลว่าการควบคุมการเข้าถึงของโมดูลนี้ครบ**: S1 และ S4 คือสิ่งที่ขาด:

- `scopeClause()` — `participation.routes.js:42-70` มี `default: '1=0'` ปฏิเสธก่อน ถ้ามีบทบาทใหม่เข้ามาโดยไม่มี clause จะเห็นศูนย์แถว ไม่ใช่เห็นทุกแถว
- `GET /cases/:id` — `participation.routes.js:142-146` ต่อ scope clause เข้ากับ `WHERE c.id = ?` จึงคืน 404 ไม่ใช่ 403 ที่รั่วข้อมูลการมีอยู่
- `POST /cases/:id/events` — re-check ภายใน transaction ด้วย predicate เดียวกับ list (`participation.routes.js:201-209`)

สิ่งที่ **ยังไม่มี** และเป็นเนื้อหาของ S1 และ S4 ใน §6: ไม่มีการผูก event type กับบทบาทผู้กระทำ และไม่มีการตรวจ `scope_id` ที่ผู้ใช้ระบุเอง

ข้อสังเกตเรื่องหลักฐาน (ไม่ใช่ความปลอดภัย): `ROLES` ใน `services/participation.service.js:36-38` มี `parent` แต่ router บังคับ `requireRole('school','affiliation','province','transport','driver','admin')` (`participation.routes.js:31`) ผู้ปกครองจึงยื่นเรื่องผ่าน API นี้ไม่ได้ ค่า `by_initiator_role.parent` ใน `/api/participation/summary` จะเป็น 0 เสมอ — ช่องทาง feedback ของผู้ปกครอง/ครู **รอ C0-12** และ **รอ D0-3 + D0-4**

### 5.4 Report / export endpoint

ครอบคลุมใน §4.3 แล้ว เพิ่มเติม:
- `/api/reports` มี limiter ของตัวเอง 40 ครั้ง/5 นาที (`app.js:155-163`) ไม่ได้อยู่ใน `GLOBAL_API_LIMITED_PREFIXES`
- ครูประจำสายชั้นเข้า `/api/reports/*` ได้ แต่ถูกกรองด้วย grade clause ที่ `report.service.js:38-41` ตามที่ comment ที่ `report.service.js:9-18` อธิบายว่าเคยเป็นช่องโหว่และปิดแล้ว — ยืนยันว่ามี clause จริงในโค้ดปัจจุบัน

### 5.5 LINE webhook

- Signature ตรวจแบบ constant-time และเทียบความยาวก่อน (`line.routes.js:20-33`)
- Body ไม่ถูก parse เป็น JSON ก่อนตรวจ signature (`app.js:64-68` ข้าม `/api/line/webhook`, แล้ว `line.routes.js:66` ใช้ `express.raw`)
- Dedup ของ `webhookEventId` กัน replay (`line.routes.js:47-63`) — **เป็น in-memory ใช้ได้กับ instance เดียว** ซึ่งตรงกับงาน A1-9 ที่แผนกำหนดให้ย้ายไป DB/Redis อยู่แล้ว ไม่ใช่ finding ใหม่
- `POST /api/line/process-notifications` ป้องกันด้วย API key เทียบแบบ constant-time และ fail closed ใน production (`line.routes.js:532-546`)

ที่ยังเป็นปัญหา: **S8** ใน §6

### 5.6 LIFF parent API

อ่านจาก source แล้วพบว่าออกแบบรัดกุมกว่าโมดูลอื่น (ยังไม่ได้ทดสอบ runtime) — ทุก endpoint ระดับเด็กดึงรายการบุตรหลานจาก LINE identity ที่ server verify แล้วเทียบกับ `:id` ก่อนทำงาน (`parent.routes.js:124-125, 139-140, 172-173`) และ `line_user_id` จาก body ไม่ถูกใช้เป็นตัวตนเลย (`parent.routes.js:88-93` ตาม comment) history มี clamp ช่วงเวลา 1–90 วัน และ LIMIT 500 (`parent.routes.js:150-160`) bind endpoint มี limiter แยกที่แน่นกว่า (12 ครั้ง/10 นาที — `parent.routes.js:45-53`)

Consent gate: `/api/parent/children` **มี** gate แล้วในรุ่นนี้ (`parent.routes.js:108-113`) แต่กรองเฉพาะ 2 field คือ `plate_no` และ `driver_name` (`services/parentConsentGate.js:81`) ผู้ปกครองที่ยังไม่ให้ความยินยอมยังได้รับ ชื่อ-นามสกุลเด็ก ระดับชั้น ห้อง และชื่อโรงเรียน (`services/line.service.js:251-253`) — **การตัดสินว่าชุด field นี้ถูกต้องตามฐานการประมวลผลหรือไม่ รอ D0-3 และ D0-4** และ consent type ที่ยอมรับยังมี 2 ค่า (`parentConsentGate.js:26`) — **รอ D0-7**

### 5.7 QR viewer (ปิดด้วย flag)

ระดับการเข้าถึงคำนวณจาก credential ที่พิสูจน์ได้เท่านั้น ไม่ได้รับจาก client (`services/qrAccess.service.js:162-167`) `STAFF_ROLES` มีเพียง `transport`, `admin`, `province` (`qrAccess.service.js:12`) บัญชี `school` / `affiliation` / `driver` ที่สแกน QR จึงได้ระดับ 1 เท่ากับคนทั่วไป และ L2 ต้องทั้ง "ผูกกับรถคันนี้" และ "ให้ความยินยอมแล้ว" (`qrAccess.service.js:31-44, 164-166`) `optionalAuth` ไม่ยกระดับให้บัญชีที่ยังต้องเปลี่ยนรหัสผ่าน (`middleware/optionalAuth.js:37-48`) — **ประเมินว่าออกแบบถูก** แต่ยังไม่ได้ทดสอบเพราะ flag ปิด

---

## 6. Findings — เรียงตามลำดับชั่วคราวของผู้ทบทวน (**เกณฑ์ความรุนแรงจริง รอ C0-13**)

ทุกข้อระบุ (ก) สิ่งที่โค้ดทำจริง (ข) สถานการณ์ที่ทำให้เสียหาย (ค) สิ่งที่ negative test ต้องพิสูจน์ (ง) การตัดสินใจที่ค้างอยู่ซึ่งกำหนดว่า "ถูก" คืออะไร

**ป้าย สูง / กลาง-สูง / กลาง / กลาง-ต่ำ / ต่ำ ด้านล่างไม่ใช่เกณฑ์ของโครงการ** — severity scheme เป็นส่วนหนึ่งของ **C0-13** (change governance) ซึ่งยังไม่ถูกตอบ: `docs/project-closure/execution-plan-to-completion-2026-09-04.md:68` ระบุว่าเป็นการตัดสินของ Project owner + Technical owner และป้อนเข้า A3-1 (defect triage) ส่วน `docs/project-closure/decision-register.md:336` ยังเป็นช่องว่าง (`☐ ใช้ Critical/Major/Minor ตาม master plan §5 ☐ อื่น ______`) ป้ายเหล่านี้จึงเป็นเพียงการจัดลำดับของผู้ทบทวนเพื่อให้อ่านต่อได้ **ห้ามใช้เป็นเกณฑ์ตัดสินว่าอะไรต้องแก้ก่อน-หลัง หรือเป็น input ของ A3-1 จนกว่า C0-13 จะถูกตอบ** และลำดับใน §8 ต้องถูกจัดใหม่ตามเกณฑ์ที่ owner กำหนด

### S1 — สูง: participation ไม่ผูกประเภทเหตุการณ์กับบทบาทผู้กระทำ

**โค้ด** `validateEventInput()` (`backend/src/services/participation.service.js:170-232`) ตรวจ 3 อย่าง: event type อยู่ในรายการ, `actor_role` อยู่ในรายการบทบาท, และ event นั้นตามหลังสถานะปัจจุบันได้ (`ALLOWED_EVENTS` ที่ `:69-78`) **ไม่มีเงื่อนไขใดผูกว่า บทบาทใดออก event ใดได้** route ตั้ง `actor_role` จาก token จริง (`participation.routes.js:213`) จึงไม่ปลอมบทบาทได้ แต่การตรวจว่า "บทบาทนี้มีอำนาจตัดสิน" ไม่มีอยู่เลย

**สถานการณ์ที่ทำให้เสียหาย** คนขับยื่นเรื่อง `RESOURCE_REQUEST` — `scopeClause` ของ driver คือ `c.initiated_by = ?` (`participation.routes.js:64`) เรื่องของตัวเองจึงมองเห็นได้ ผ่านการ re-check ที่ `participation.routes.js:202-205` ทุกครั้ง จากนั้นยิงต่อเนื่อง `DECIDED` (decision `APPROVED` + note) → `ASSIGNED` (`assigned_to` เป็น user id ใดก็ได้ **ที่มีอยู่จริง** ในตาราง `users` — FK ที่ `migrations/050_participation_cases.sql:88` กันเฉพาะเลขที่ไม่มีอยู่ ไม่ได้กันการมอบหมายข้ามขอบเขต ดู S4) → `COMPLETED` → `FEEDBACK_SENT` เรื่องเปลี่ยนเป็น `CLOSED` โดยไม่มีใครนอกจากคนยื่นแตะเลย แล้วเรื่องนั้นถูกนับใน `closed_feedback_loop` และ `decided_with_rationale` ที่ `participation.service.js:268, 272` ซึ่งเป็นตัวเลขที่ `/api/participation/summary` คืนออกไปเป็น participation KPI ผลคือทั้งช่องโหว่เชิงอำนาจและการปนเปื้อนของหลักฐานเชิงวิจัยในเหตุการณ์เดียวกัน

**Negative test ต้องพิสูจน์** ว่า token ของบทบาทที่ไม่มีอำนาจตัดสิน ยิง `DECIDED` / `ASSIGNED` / `FEEDBACK_SENT` บนเรื่องที่ตนมองเห็น แล้วได้ 403 และสถานะไม่ขยับ — ครบทั้ง 6 บทบาทที่ router อนุญาต

**การตัดสินใจที่ค้าง** ตารางอำนาจ "ใครอนุมัติอะไร ระดับเดียว ไม่ซ้ำ queue" คือ **รอ C0-2** — ห้ามทีมเทคนิคตั้งตารางนี้เอง และขอบเขตว่า `PARTICIPATION_CASES` จะ accept/pilot/defer คือ **รอ C0-4**

**สถานะปัจจุบัน** `FEATURE_PARTICIPATION_CASES` ไม่ปรากฏใน `backend/.env.test.example` และ default เป็น `false` ตาม `backend/src/config/env.js:237` (`=== 'true'`) router จึงไม่ถูก mount **ในชุด flag ที่ใช้รันเครื่องมือของเอกสารนี้** — **ค่าจริงของ flag บน production ประเมินจากเครื่องนี้ไม่ได้** (U10 · รอ A0-11/B0-1) ห้ามอ่านย่อหน้านี้ว่าผลกระทบบน production เป็นศูนย์

---

### S2 — สูง: `/api/school/audit-logs` ฝั่ง JSON ไม่ redact ขณะที่ฝั่ง CSV redact

**โค้ด** endpoint เดียวกัน สองเส้นทาง:
- CSV (`school.routes.js:1303-1319`) เรียก `auditRowsToCsv` (`school.routes.js:138-159`) ซึ่งส่ง `old_value`/`new_value` ผ่าน `redactAuditValue` ที่บรรทัด `151-152`
- JSON (`school.routes.js:1326-1338`) `SELECT ... al.old_value, al.new_value ...` แล้ว `return sendSuccess(res, rows, ...)` **ไม่มีการ redact ใด ๆ**

`redactAuditValue` ถูก import ไว้แล้วในไฟล์นี้ตั้งแต่ `school.routes.js:135` แต่ใช้เฉพาะใน helper ของ CSV

อีกสามไฟล์ที่มี endpoint แบบเดียวกัน **ปิดช่องนี้ไปแล้วทั้งหมด**:
- `province.routes.js:239-248` (comment เขียนไว้ตรง ๆ ว่า "The CSV path already does this; the JSON path was leaking raw values")
- `affiliation.routes.js:616-624`
- `admin.routes.js:665-676`

`school.routes.js` เป็นไฟล์เดียวที่ตกหล่น — และเป็นบทบาทที่มีสิทธิ์ต่ำที่สุดในสี่บทบาทนั้น

**สถานการณ์ที่ทำให้เสียหาย** บัญชีโรงเรียน (ที่ไม่ใช่ครูประจำสายชั้น — ครูถูก 403 ที่ `school.routes.js:1273`) เปิดหน้า audit log ตามปกติ response JSON คืนค่า `old_value` / `new_value` ดิบ ค่าที่ `redactObject` ตั้งใจจะปิดคือ `cid`, `cid_hash`, `health_note`, `raw_student_name`, `raw_student_code`, `password_hash`, `token`, และการ mask เบอร์โทร/`line_user_id` (`backend/src/utils/exportSecurity.js:66-77`) ผู้ที่มีสิทธิ์ดูหน้าจอนี้จึงเห็นค่าที่นโยบายของระบบเองระบุว่าต้องปิด และค่าเหล่านั้นยังไปติดใน network log ของ browser และใน log ตัวกลางใด ๆ ที่บันทึก response body

**ขอบเขตของผลกระทบ** `scopeWhere` (`school.routes.js:1288-1296`) ผูกกับโรงเรียนของผู้เรียกเสมอ **นี่จึงไม่ใช่การรั่วข้ามโรงเรียน** แต่เป็นเรื่อง data minimisation ภายในขอบเขตตนเอง ซึ่งเป็นคนละคำถามและตอบด้วย gaps=0 ไม่ได้

**Negative test ต้องพิสูจน์** ว่า `GET /api/school/audit-logs` (JSON) และ `?format=csv` คืนค่าที่ผ่านการ redact เหมือนกัน โดยยัด audit row ที่มี key ต้องห้ามลงไปก่อน แล้วยืนยันว่าไม่มี key ใดใน `SENSITIVE_KEYS` โผล่ในทั้งสองรูปแบบ — และ test เดียวกันต้องคลุมทั้งสี่ไฟล์ ไม่ใช่แค่ไฟล์ที่แก้

**การตัดสินใจที่ค้าง** รายการ field ที่ต้องปิดตามชุดข้อมูลและวัตถุประสงค์ คือ **รอ D0-2** และการจำแนกว่าแถวไหนเป็น Consent / Acknowledgement / Certification คือ **รอ D0-4** — แต่การทำให้สองเส้นทางของ endpoint เดียวกันตรงกันไม่ต้องรอใคร

---

### S3 — กลาง-สูง: verification timeline ให้ `transport` และ `driver` อ่าน `audit_logs` ได้ ขัดกับ RBAC matrix ที่ประกาศไว้ และเป็นไฟล์เดียวที่คืนค่า audit โดยไม่มี `redactAuditValue` อยู่ในไฟล์เลย

**โค้ด** `GET /api/verification/applications/:id/timeline` (`verification.routes.js:138-186`) เปิดให้ `requireRole('school','transport','province','admin','driver')` (`:140`) แล้ว query ตาราง `audit_logs` โดยตรง คืน `al.old_value, al.new_value` และ `u.display_name AS actor_name` (`:174-183`) guard ต่อบทบาทอยู่ที่ `:162-168` — driver ผูก `a.requested_by`, school ผูก `aps.school_id`, และ **บทบาทที่เหลือได้ `'TRUE'`**

`CLAUDE.md:961` (RBAC Matrix §8 ซึ่งระบุว่า "แก้ให้ตรงโค้ดจริง ตรวจกับ route ทุกไฟล์") ประกาศแถว Audit log ว่า `driver` = ❌ และ `transport` = ❌

นอกจากนี้ `verification.routes.js` เป็น **ไฟล์ route เพียงไฟล์เดียวที่คืน `old_value`/`new_value` ออกไปโดยไม่มีการอ้าง `redactAuditValue` เลยทั้งไฟล์** — grep ทั้ง `backend/src/routes` และ `backend/src/services` พบว่ามีเพียง 4 ไฟล์ที่อ้าง `redactAuditValue` (`admin`, `affiliation`, `province`, `school`) และมีเพียง 6 จุดในทั้งระบบที่ `SELECT` `al.old_value`/`al.new_value` ออกไปให้ผู้ใช้: `admin.routes.js:622, 653` (redact ที่ `:674`), `affiliation.routes.js:583, 605` (redact ที่ `:620-621`), `province.routes.js:207, 229` (redact ที่ `:244-245`), `school.routes.js:1307` ฝั่ง CSV (redact ที่ `:151-152`), `school.routes.js:1328` ฝั่ง JSON (**ไม่ redact — คือ S2**) และ `verification.routes.js:175` (ไม่ redact — ข้อนี้) research export redact ที่ `admin.routes.js:1033, 1046`

ดังนั้นเส้นทางที่คืนค่า audit ดิบมี **สองเส้นทาง ไม่ใช่เส้นทางเดียว** คือข้อนี้กับ S2 — ต่างกันตรงที่ S2 มี `redactAuditValue` อยู่ในไฟล์แล้วแต่ใช้ไม่ครบทุกเส้นทาง ส่วนไฟล์นี้ไม่มีเลย (มีอีกจุดที่ `driver.routes.js:1062-1067` ที่อ่าน `new_value` จาก `audit_logs` โดยไม่ redact แต่ **ไม่ได้คืนค่าออกไป** — ดึงเฉพาะ boolean `all_pass` ที่ `:1075` และผูกกับ `user_id = req.user.id` ของผู้เรียกเอง จึงไม่นับเป็นเส้นทางรั่ว)

**สถานการณ์ที่ทำให้เสียหาย** บัญชี `transport` ไล่ id ของคำขอตรวจสภาพรถ (เป็น auto-increment) แล้วอ่าน timeline ของทุกโรงเรียนได้ทั้งจังหวัด เนื้อหาที่ได้รวมข้อความอิสระที่เจ้าหน้าที่พิมพ์เอง — `reason` ตอนยกเลิก (`services/vehicleVerification.service.js:589-601`) และ `review_notes` ตอนโรงเรียนตรวจ (`vehicleVerification.service.js:1229-1235`) — พร้อมชื่อผู้ดำเนินการของโรงเรียนนั้น ข้อความอิสระคือช่องที่ PII หลุดเข้าไปได้โดยไม่มี key ให้ redactor จับ ขอบเขตถูกจำกัดด้วย `al.entity_type = 'vehicle_inspection_application'` (`verification.routes.js:179`) จึงไม่ใช่การเปิด audit log ทั้งระบบ แต่ก็ไม่ใช่ ❌ ตามที่เอกสารประกาศ

**Negative test ต้องพิสูจน์** ผลลัพธ์ที่ owner ตัดสิน — ถ้าตัดสินว่า transport ไม่ควรอ่าน ก็ต้องเป็น 403; ถ้าตัดสินว่าควรอ่าน ก็ต้องมี test ว่าค่าที่คืนผ่าน `redactAuditValue` และต้องแก้ `CLAUDE.md:961` ให้ตรง พร้อมเหตุผล — test เดียวกันควรคลุม S2 ด้วย เพราะเป็นสองเส้นทางเดียวกันที่คืนค่า audit ดิบ

**การตัดสินใจที่ค้าง** ใครมีสิทธิ์เห็น timeline ของคำขอตรวจสภาพรถ เป็นส่วนหนึ่งของ **รอ C0-2** (อำนาจอนุมัติ/ตรวจ) และ **รอ C0-3** (IA ต่อบทบาท) ทีมเทคนิคจะเลือกฝั่งใดฝั่งหนึ่งเองไม่ได้ เพราะทั้งสองฝั่งเปลี่ยนทั้งโค้ดและเอกสาร

---

### S4 — กลาง: participation รับ `scope_id` จาก request โดยไม่ตรวจว่ามีอยู่จริงหรือเกี่ยวข้องกับผู้เรียก

**โค้ด** `callerScope()` (`participation.routes.js:73-83`) คืน `null` สำหรับ `admin` และ `driver` โดยตั้งใจ ("must state the scope") ค่าที่ผู้ใช้ส่งมาจึงถูกใช้ตรง ๆ ผ่าน spread ที่ `participation.routes.js:164-170` `validateCaseInput()` (`services/participation.service.js:114-158`) ตรวจเพียงว่า `scope_type` อยู่ใน allowlist และ `scope_id` ไม่ว่างเมื่อไม่ใช่ `PROVINCE` (`:128-135`) — ไม่มีการตรวจว่ามีโรงเรียน/สังกัดนั้นอยู่จริง และ column ก็ไม่มี foreign key (`backend/migrations/050_participation_cases.sql:43` — `scope_id VARCHAR(20) NULL`)

`assigned_to` มีปัญหา **คนละแบบและแคบกว่า** ต้องระบุให้ตรง ไม่งั้น negative test จะเขียนจากสมมติฐานผิด: `participation.service.js:216` ตรวจแล้วว่าต้องมีค่าเมื่อ event เป็น `ASSIGNED` และ FK `fk_participation_case_assignee ... REFERENCES users (id)` ที่ `migrations/050_participation_cases.sql:88` ปฏิเสธ id ที่ไม่มีอยู่จริง สิ่งที่ **ไม่มี** คือการตรวจว่าผู้ใช้คนนั้นอยู่ในขอบเขตของเรื่องหรือมีบทบาทที่รับผิดชอบได้ — **ผู้ใช้ที่มีอยู่จริงคนใดในระบบก็ถูกตั้งเป็นผู้รับผิดชอบได้** (ค่าไหลผ่าน `participation.service.js:228` และเขียนลง DB ที่ `:336-339`) ส่วน `due_at` (`:229`) ไม่ถูกตรวจรูปแบบหรือช่วงเวลาเลย

**สถานการณ์ที่ทำให้เสียหาย** สองแบบ

1. คนขับยื่นเรื่องโดยตั้ง `scope_type='SCHOOL'` และ `scope_id` เป็น id ของโรงเรียนใดก็ได้ เรื่องนั้นจะเข้า inbox ของโรงเรียนที่ไม่มีความเกี่ยวข้องกับคนขับคนนั้นเลย (`scopeClause` ของ school จะจับได้เพราะตรง scope_id — `participation.routes.js:59`) ไม่ใช่การอ่านข้ามขอบเขต แต่เป็นการ **เขียนเข้าขอบเขตของหน่วยงานอื่น** ซึ่งเป็นช่องทาง spam และ social engineering เข้าคิวงานของโรงเรียน
2. `scope_id` เป็นค่าที่ไม่มีอยู่จริง เช่นพิมพ์ผิด — เรื่องนั้นจะไม่มีบทบาทใดเห็น (school เห็นเฉพาะ scope_id ตัวเอง, affiliation เห็นเฉพาะโรงเรียนใต้สังกัด) ยกเว้น province/admin ที่ได้ `1=1` (`participation.routes.js:45-46`) เรื่องกลายเป็น orphan ที่ไม่มีใครรับผิดชอบแต่ยังถูกนับใน `summariseParticipation` ของ province/admin ทำให้ตัวหารของ participation KPI ผิด

**Negative test ต้องพิสูจน์** ว่า `POST /api/participation/cases` ที่มี `scope_id` ซึ่งไม่มีอยู่ในตาราง `schools`/`affiliations` ถูกปฏิเสธ 400 และว่าบทบาทที่ไม่มีอำนาจยื่นข้ามหน่วยงานถูกปฏิเสธ 403 — และ `assigned_to` ที่เป็น **ผู้ใช้ซึ่งมีอยู่จริงแต่อยู่นอกขอบเขตของเรื่อง** ถูกปฏิเสธ (id ที่ไม่มีอยู่จริงถูก FK จับอยู่แล้ว จึงไม่ใช่เคสที่ต้องทดสอบ)

**การตัดสินใจที่ค้าง** ใครยื่นเรื่องเข้าหน่วยงานใดได้บ้าง และผู้รับผิดชอบ (`ASSIGNED`) มาจาก pool ไหน คือ **รอ C0-2** ตำแหน่งของ inbox ในเมนูคือ **รอ C0-3**

---

### S5 — กลาง: `/api/documents/:docType/:id/file` ไม่กันครูประจำสายชั้น ขณะที่โมดูลเดียวกันกัน

**โค้ด** `documents.routes.js:26` มี guard เพียง `authenticate, requireRole('driver','school','transport','admin')` ไม่มี `requireFullSchoolScope`

router นี้ mount ด้วย flag เดียวกับโมดูล registration (`app.js:139-146`) และ `registration.routes.js:170-192` บล็อกครูประจำสายชั้นออกจากโมดูลนั้น **ทั้งโมดูล** พร้อม comment ที่อธิบายเหตุผลไว้ยาว (`:172-188`) ว่า "การกรองเป็นทางเลือกที่ถูกปฏิเสธ" และอ้าง `CLAUDE.md §12` ข้อ 9 (RBAC ต้อง enforce ที่ backend — `CLAUDE.md:1264`)

ฝั่ง frontend `TEACHER_BLOCKED_PATHS` (`frontend/src/components/Sidebar.jsx:151-161`) ซ่อนหน้า `/school/registration-review` จากครู และ comment ระบุชัดว่า "Backend still 403s these paths" ซึ่งเป็นจริงสำหรับทั้ง 4 path ในรายการนั้น (`school.routes.js:1273, 1085/1219, 1942-2060` และ `registration.routes.js:189-192`) — **แต่ไฟล์เอกสารถูกดึงจากภายในหน้านั้น ไม่มีรายการเมนูของตัวเอง จึงไม่มีอะไรกันครูออกจาก endpoint ตรง ๆ**

**สถานการณ์ที่ทำให้เสียหาย** บัญชี `role='school'` ที่มี `grade_scope` เรียก `GET /api/documents/vehicle/<id>/file` โดยตรง scope ระดับโรงเรียนยังถูกบังคับอยู่ (`services/driverDocuments.service.js:326-337` ผูกผ่าน `inspection_application_schools`) จึงไม่ใช่การรั่วข้ามโรงเรียน แต่ครูที่ระบบตั้งใจให้เห็นเฉพาะชั้นตนได้อ่านไฟล์หลักฐานของคนขับและรถ (ใบขับขี่ ทะเบียนรถ ประกัน) ซึ่งเป็น PII ของคนขับ ขัดกับกฎที่โมดูลข้างเคียงบังคับไว้อย่างจงใจ

**Negative test ต้องพิสูจน์** ว่า token ของ `school` + `grade_scope` ได้ 403 จาก `/api/documents/:docType/:id/file` เหมือนที่ได้จาก `/api/school/registrations/*`

**สถานะปัจจุบัน** `FEATURE_DRIVER_REGISTRATION` ไม่ปรากฏใน `backend/.env.test.example` และ default เป็น `false` ตาม `env.js:224` router จึงไม่ถูก mount **ในชุด flag ที่ใช้รันเครื่องมือของเอกสารนี้** — **ค่าจริงบน production ประเมินจากเครื่องนี้ไม่ได้** (U10) การเปิด flag คือ **รอ C0-4**

---

### S6 — กลาง: research export ไม่ validate `from`/`to` ขณะที่ `/api/reports` validate

**โค้ด** `admin.routes.js:988-989` — `const from = req.query.from || '2020-01-01'; const to = req.query.to || ...` ไม่มีการตรวจรูปแบบใด ๆ เทียบกับ `report.routes.js:32-40, 45-59` ที่มี `isValidDate` / `isValidMonth` และตอบ 400 เมื่อผิดรูปแบบ

ค่า `from`/`to` ที่ไม่ถูกตรวจไหลไป 3 ที่:
1. `meta.date_range` ของชุดข้อมูลที่ส่งออก (`admin.routes.js:995`)
2. `entityId` ของ audit row `EXPORT` — `` `${from}_to_${to}` `` (`admin.routes.js:1171`)
3. ชื่อไฟล์ใน `Content-Disposition` (`admin.routes.js:1349-1351` สำหรับ xlsx และ `:1358-1360` สำหรับ json)

Query ทั้งหมดเป็น parameterized (`CLAUDE.md:1269` §12 ข้อ 14) จึงไม่ใช่ SQL injection

**สถานการณ์ที่ทำให้เสียหาย** เป็นเรื่องความน่าเชื่อถือของหลักฐาน ไม่ใช่การเข้าถึงข้อมูล: ชุดข้อมูลวิจัยประกาศช่วงเวลาของตัวเองจากค่าที่ไม่ถูกตรวจ และ audit row ที่ชุดข้อมูลนี้ใช้เป็นหลักฐานการส่งออกของตัวเอง (`admin.routes.js:1036-1046` อ่าน `action='EXPORT'` กลับมาใส่ใน `export_evidence`) บันทึก entity id ที่ไม่มีความหมาย ผลคือเมื่อถึงเวลาสอบทาน ชุดข้อมูลกับ audit trail ของมันจะกระทบยอดกันไม่ได้ ส่วนชื่อไฟล์ที่มีอักขระ `"` จะทำให้ header ของ `Content-Disposition` ผิดรูป — **ข้อนี้ทดสอบจริงบนเครื่องนี้แล้ว** (Node v24.15.0, `http.ServerResponse#setHeader`): ค่าที่มี CR หรือ LF ถูกปฏิเสธด้วย `ERR_INVALID_CHAR` ส่วน `"` ผ่านเข้าไปได้ จึงเป็นปัญหา header ผิดรูป **ไม่ใช่ response splitting** (เวอร์ชัน Node บน production ยังไม่ทราบจากเครื่องนี้)

**Negative test ต้องพิสูจน์** ว่า `from`/`to` ที่ไม่ตรงรูปแบบ `YYYY-MM-DD` ได้ 400 และว่าเมื่อผ่าน ค่าที่บันทึกใน audit row กับค่าใน `meta.date_range` เป็นค่าเดียวกัน

**การตัดสินใจที่ค้าง** field `period` ที่ต้องอยู่ใน export metadata ตาม A1-1 คือ **รอ C0-6** — ห้ามใช้ `from`/`to` ที่ผู้เรียกส่งมาแทน `period` ของ protocol

---

### S7 — กลาง-ต่ำ: RBAC matrix รายงานบทบาทกว้างกว่าที่บังคับจริงสำหรับ 2 route

**โค้ด** matrix ที่ generate ได้ระบุ `roles = admin, affiliation, province, school` สำหรับ:
- `GET /api/reports/policy` — แต่ `services/report.service.js:476-481` โยน 403 ให้ทุกบทบาทที่ไม่ใช่ province/admin
- `POST /api/reports/decision-log` — แต่ `report.routes.js:656-658` เทียบกับ `DECISION_LOG_ROLES = ['province','admin']` (`backend/src/utils/decisionLog.js:23`)

สาเหตุคือ generator อ่าน guard จาก router graph (`generate-rbac-matrix.js:5-11`) ซึ่งเห็นเฉพาะ `requireRole` ที่ `report.routes.js:16` และมองไม่เห็นการบังคับที่ชั้น service/handler

**สถานการณ์ที่ทำให้เสียหาย** ไม่ใช่ช่องโหว่ในระบบ แต่เป็นข้อผิดพลาดใน **ตัวส่งมอบของ A1-3** — "role-to-route/API/write-action matrix ฉบับ RC2" จะถูกเผยแพร่พร้อมสองแถวที่บอกว่าโรงเรียนอ่านรายงานเชิงนโยบายทั้งจังหวัดได้ ผู้ทบทวนภายนอกที่อ่าน matrix แล้วเชื่อ จะสรุปผิดทั้งสองทาง: อาจตกใจกับสิ่งที่ไม่มีอยู่ หรืออาจอนุมัติ matrix ที่รู้ว่าไม่ตรงโดยไม่รู้ว่าที่เหลือตรงหรือไม่

**Negative test ต้องพิสูจน์** ว่า token ของ `school` และ `affiliation` ได้ 403 จากทั้งสอง route และ matrix ที่ส่งมอบต้องมีคอลัมน์แยกระหว่าง "role ที่ผ่าน router guard" กับ "role ที่ได้ข้อมูลจริง"

---

### S8 — กลาง-ต่ำ: `/api/line` ไม่มี rate limit และ signature fail-open นอก production

**โค้ด** `GLOBAL_API_LIMITED_PREFIXES` (`app.js:21-36`) ไม่มี `/api/line` และ `line.routes.js` ไม่มี limiter ของตัวเองเลย (มีเฉพาะ `/api/parent`, `/api/reports`, `/api/visits`, `/api/qr`, `/api/consent` ที่มี limiter เฉพาะทาง)

`verifySignature()` (`line.routes.js:20-33`) คืน `env.app.nodeEnv !== 'production'` เมื่อไม่มี channel secret — คือ **ผ่านทุก request** ในทุก environment ที่ไม่ใช่ production comment ที่ `:14-17` อธิบายว่าตั้งใจให้ dev สะดวก

**สถานการณ์ที่ทำให้เสียหาย**
1. Staging ที่ตั้ง `NODE_ENV=staging` (ไม่ใช่ `production`) และยังไม่ได้ตั้ง `LINE_CHANNEL_SECRET` จะรับ webhook ที่ไม่ได้ลงนามจากใครก็ได้ ผู้โจมตีปลอม event ผูก/ยกเลิกการผูกบัญชีผู้ปกครองได้ — ตรงกับงาน B2-1/B2-2 ที่กำลังจะขอ LINE test channel จริง
2. `POST /api/line/process-notifications` เทียบ API key แบบ constant-time (`line.routes.js:543` เรียก `safeKeyEqual`) แต่ไม่มี rate limit ทำให้เดา key ทาง online ได้ไม่จำกัดจำนวนครั้ง
3. request ที่ signature ผิดทุกครั้งเสีย HMAC หนึ่งรอบ และเขียน `console.warn` หนึ่งบรรทัด (`line.routes.js:79`) โดยไม่มีเพดาน

**Negative test ต้องพิสูจน์** ว่าเมื่อไม่มี channel secret ระบบปฏิเสธ webhook ในทุก environment ที่ไม่ใช่ development ที่ระบุชัด และว่า `process-notifications` ถูก throttle — ข้อเสนอว่า "environment ใดจึงยอมให้ fail open ได้" เป็น **การตัดสินเชิงเทคนิคใน lane A ไม่มี C0/D0 ข้อใดครอบอยู่** ผู้ตัดสินคือ Technical owner ร่วมกับ operator ของ staging (งาน B2-2) ไม่ใช่ผู้ทบทวนฉบับนี้

**หมายเหตุ** กลไกที่กัน production ไว้ **มีอยู่ในโค้ดจริง ไม่ใช่แค่ comment**: `backend/src/config/env.js:23` (`PRODUCTION_REQUIRED = ['LINE_CHANNEL_SECRET', 'CRON_API_KEY']`), `:25-30` (บังคับเฉพาะเมื่อ `NODE_ENV === 'production'` — นอกจากนั้นคืน `[]`), `:126-131` (คืน error `Missing required production secrets (must be non-empty when NODE_ENV=production)`) และ `:143-146` (รัน validation ตอน module load ยกเว้นเมื่อ `NODE_ENV === 'test'`) comment ที่ `line.routes.js:14-17, 535-537` สอดคล้องกับโค้ดนั้น สิ่งที่ **ยังยืนยันไม่ได้จากเครื่องนี้** คือพฤติกรรมตอน boot จริง (exit code / ข้อความจริงเมื่อ secret ขาด) จึงคงไว้ใน U4 — และข้อนี้ **ไม่ลดความรุนแรงของ S8** เพราะช่องโหว่ของ S8 อยู่ที่ environment ที่ **ไม่ใช่** production (เช่น `NODE_ENV=staging`) ซึ่ง `PRODUCTION_REQUIRED` ไม่บังคับตามนิยามที่ `env.js:26` อยู่แล้ว

---

### S9 — ต่ำ: RBAC generator ประกาศกลไก auth ตาม prefix ไม่ใช่ตาม route

**โค้ด** `NON_ROLE_AUTH` (`generate-rbac-matrix.js:34-41`) จับคู่ด้วย prefix ของ path ผลคือ:
- `POST /api/line/process-notifications` ถูกติดป้าย `"LINE webhook signature"` ทั้งที่จริงป้องกันด้วย API key (`line.routes.js:532-546`) — คนละกลไก
- `/api/auth/recovery/*` **ทั้ง 11 route** ในไฟล์ `backend/src/routes/adminPasswordRecovery.routes.js` ถูกติดป้าย `"public or self-service"` เหมือนกันหมด ทั้งที่ **8 ใน 11 ต้องผ่าน `authenticate`** — 4 ตัวใต้ `/self/*` ผ่าน `selfServiceGate = [requireFeature, authenticate, requireRecoveryRole]` (`:320`, ใช้ที่ `:323-326`) และอีก 4 ตัวใต้ `/admin/*` ผ่าน `adminGate` ที่เพิ่ม `requireRole('admin')` (`:321`, ใช้ที่ `:328-331`) เหลือเพียง 3 route ที่เปิดจริง (`/config` `:122`, `/request` `:333`, `/complete` `:419`) ตรวจจาก matrix ที่ generate ใหม่: ทั้ง 11 แถวมี `auth_mechanism` เป็น `"public or self-service (login, refresh, change-password)"` แม้แถว `/admin/*` จะมี `roles: ["admin"]` และมี `authenticate` อยู่ใน `guards` แล้วก็ตาม

**สถานการณ์ที่ทำให้เสียหาย** ถ้ามีคนเพิ่ม route ใหม่ใต้ `/api/auth` หรือ `/api/line` โดยลืม guard ทั้งหมด generator จะติดป้ายให้ว่า "ไม่ต้องมี role guard" และรายงาน `findings=0` ตามเดิม — เครื่องมือที่ใช้เป็นหลักฐานว่า access control ครบ จะยืนยันสิ่งที่ตัวเองไม่ได้ตรวจ

**Negative test ต้องพิสูจน์** ว่า `rbacMatrix.unit.test.js` (มีอยู่แล้วที่ `backend/tests/rbacMatrix.unit.test.js`) fail เมื่อมี route ใต้ prefix เหล่านั้นที่ไม่มี middleware ที่ระบุกลไกจริง ๆ อยู่ใน stack — ไม่ใช่แค่ prefix ตรง

---

### S10 — ต่ำ / เฝ้าระวัง: การผูกบัญชี LINE ผูกด้วยหมายเลขโทรศัพท์

**โค้ด** `getChildrenByBoundPhone()` (`services/line.service.js:244-271`) join `line_bindings lb` เข้ากับ `parents p ON p.phone = lb.phone` — ตัวตนของผู้ปกครองผูกกับเบอร์ ไม่ใช่กับ row ของบุคคล comment ที่ `:245-249` ระบุว่าเป็นความตั้งใจ (พ่อและแม่ใช้เบอร์เดียวกันต้องเห็นลูกคนเดียวกัน) `isParentLinkedToVehicle()` ใน QR flow ใช้รูปแบบเดียวกัน (`services/qrAccess.service.js:31-44`)

**สถานการณ์ที่ทำให้เสียหาย** เมื่อเบอร์ถูกยกเลิกและผู้ให้บริการนำกลับมาขายใหม่ ผู้ถือเบอร์คนใหม่ที่ผ่าน bind flow (ต้องมีทั้งเบอร์และรหัสนักเรียน — `parent.routes.js:214, 275`) จะได้สิทธิ์ของผู้ปกครองเดิม และหลังจากผูกแล้ว ถ้าโรงเรียนเพิ่ม row ผู้ปกครองใหม่ที่ใช้เบอร์เดียวกันให้เด็กอีกคน เด็กคนนั้นจะปรากฏในรายการของบัญชีที่ผูกไว้เดิมทันทีโดยไม่ต้องผูกซ้ำ

**ที่ลดความเสี่ยงไว้แล้ว** `bindLimiter` 12 ครั้ง/10 นาที (`parent.routes.js:45-53`) และ comment ที่ `:39-44` บันทึก residual risk ไว้เองว่าทางแก้ที่แข็งแรงคือ OTP หรือ claim code จากโรงเรียน ซึ่งต้องการการตัดสินใจเรื่องผู้ให้บริการ SMS

**การตัดสินใจที่ค้าง** อายุการเก็บข้อมูลและกระบวนการเมื่อเจ้าของข้อมูลเปลี่ยน/เพิกถอน คือ **รอ D0-8** และผลของการถอนความยินยอมต่อ LINE binding คือ **รอ D0-6**

---

## 7. สิ่งที่ประเมินไม่ได้จากเครื่องนี้

รายการนี้ไม่ใช่ข้อจำกัดเชิงรูปแบบ — เป็นรายการของสิ่งที่ **ยังไม่รู้** และห้ามใครสรุปแทนด้วยเอกสารฉบับนี้

| # | สิ่งที่ประเมินไม่ได้ | เหตุผล | ต้องใช้อะไรจึงจะประเมินได้ |
|---|---|---|---|
| U1 | พฤติกรรมจริงของทุก finding | ณ เวลาที่แก้เอกสารนี้ sandbox MySQL (docker `lampang_mysql`, db `lampang_bus_sandbox`) และ backend `:3000` **ขึ้นแล้ว** แต่ **ยังไม่ได้รันชุด integration test ใดประกอบเอกสารนี้** — สิ่งที่ยิงจริงมีเพียง 2 request แบบไม่ยืนยันตัวตนใน §3.1 | รันชุด integration test บน sandbox (งาน A0-6) และเขียน negative test ตาม §8 |
| U2 | ว่า `redactAuditValue` มีผลจริงหรือไม่ใน S2 | ต้องรู้ว่ามี `logAudit` ใดเคยใส่ key ใน `SENSITIVE_KEYS` ลง `old_value`/`new_value` จริง ซึ่งต้องอ่านข้อมูลจริง | Query aggregate บน sandbox ที่มีข้อมูล synthetic — **ห้ามอ่าน production** |
| U3 | ว่า router ที่ปิดด้วย flag ทำงานอย่างไรเมื่อเปิด | ไม่ได้ mount ขณะรันเครื่องมือ | รันเครื่องมือทั้งสองใหม่ด้วย flag ชุดที่ owner อนุมัติ (**รอ C0-4**) |
| U4 | **พฤติกรรมตอน boot จริง** เมื่อ production ขาด secret (S8) — ไม่ใช่การมีอยู่ของกลไก | กลไกอ่านได้จาก source แล้ว (`config/env.js:23`, `:25-30`, `:126-131`, `:143-146`) แต่ไม่ได้รัน boot จึงไม่ทราบ exit code และข้อความจริง | รัน boot ใน sandbox ด้วย env ที่ขาด secret แล้วดู exit code |
| U5 | ชั้น nginx / Cloudflare, ความถูกต้องของ `trust proxy = 1` (`app.js:44`) และ key ที่ rate limiter ใช้จริง | อยู่นอก repository | Operator บน staging (งาน B2-2) |
| U6 | สิทธิ์ระดับ DB, grant ของ user ที่แอปใช้ | ไม่มีการเชื่อมต่อ | Operator gate (งาน B0-1) |
| U7 | ว่า LINE signature/webhook ทำงานปลายทางถึงปลายทาง | ต้องมี channel จริง | LINE test channel (งาน B2-1) |
| U8 | Timing attack, race condition, การชนกันของ transaction, ผลของ concurrency บน in-memory state | เป็นคุณสมบัติของ runtime | Load test + สภาพแวดล้อมหลาย instance (งาน A1-8/A1-9) |
| U9 | ว่า frontend เรียก endpoint ใดจริงบ้างตอน runtime | อ่าน source ได้ แต่ไม่ได้รัน browser | UI review script (งาน A2-3) |
| U10 | ค่าจริงของ feature flag บน production | ห้ามเข้า production | `feature-flags.redacted.log` จาก operator (งาน A0-11/B0-1) |
| U11 | ว่าช่องโหว่ที่ไม่ได้เขียนไว้ในเอกสารนี้ไม่มีอยู่ | นี่คือการอ่าน source ไม่ใช่ penetration test ไม่มีการ fuzz ไม่มีการยิง request | การทดสอบเจาะระบบโดยผู้ทดสอบภายนอก ซึ่ง **ไม่มีอยู่ในแผนปัจจุบัน** |

---

## 8. สรุปสิ่งที่ยังต้องทำเพื่อปิด A1-11

คอลัมน์ "ลำดับ" ด้านล่างเป็นลำดับการทำงานที่ผู้ทบทวนเสนอ **ไม่ใช่ลำดับความสำคัญตามเกณฑ์ของโครงการ** — เกณฑ์นั้นเป็นส่วนหนึ่งของ **C0-13** ซึ่งยังไม่ถูกตอบ (ดูคำเตือนต้น §6) เมื่อ C0-13 ถูกตอบแล้วต้องจัดลำดับนี้ใหม่

| ลำดับ | งาน | ขึ้นกับ |
|---|---|---|
| 1 | เขียน negative test ตาม S1–S9 ข้อละอย่างน้อยหนึ่ง test ที่ **fail กับโค้ดปัจจุบัน** ก่อนแก้ | S1/S3/S4 ขึ้นกับ **C0-2** (และ S1 ขึ้นกับ **C0-4** ด้วย), S3 ขึ้นกับ **C0-3**, S5 ขึ้นกับ **C0-4** |
| 2 | แก้ S2, S6, S7, S8, S9 — ห้าข้อนี้ไม่ขึ้นกับ C0/D0 ข้อใดในเชิงเนื้อหา (ส่วน *ลำดับ* ที่จะลงมือ ขึ้นกับ severity scheme ของ C0-13) | **C0-13** (เฉพาะลำดับ ไม่ใช่เนื้อหา) |
| 3 | รัน `cd backend && npm test -- crossSchoolIsolation exportSecurity gradeScope` บน sandbox MySQL และยืนยันว่า jest รายงานครบ 3 suite ตาม §13 ของแผน | Sandbox MySQL (A0-6) |
| 4 | ขยาย `crossSchoolIsolation.test.js` — ปัจจุบันครอบคลุมเพียง 5 test บน 4 endpoint (`/students`, `/students?school_id=` spoof, `/vehicles`, `/status-today`, `/dashboard?school_id=` spoof) ยังไม่แตะ reports/exports, audit-logs, verification, documents, participation | — |
| 5 | รันเครื่องมือทั้งสองใหม่ด้วย flag ชุดที่จะ deploy จริง แล้วเก็บผลลง `outputs/rbac-matrix/<run>/` | **C0-4** |
| 6 | ตัดสินว่า `CLAUDE.md:961` หรือ `verification.routes.js:140` ข้างใดผิด แล้วแก้ให้ตรงกัน | **C0-2 + C0-3** |

---

## 9. คำสั่งที่รันจริงเพื่อผลิตเอกสารนี้

```
cd backend && set -a && . ./.env.test.example && set +a \
  && node scripts/generate-rbac-matrix.js --json --out <TEMP>/rbac.json \
  && node scripts/audit-scope-enforcement.js --out <TEMP>/scope.json
```

`<TEMP>` เป็นไดเรกทอรีชั่วคราวนอก repository ตามข้อจำกัดของงานนี้ — **ไม่มีไฟล์ใดถูกเขียนลง `outputs/`**

ไม่มีการรัน test suite, ไม่มีการ deploy, ไม่มีการ commit และไม่มีการแก้ไฟล์อื่นนอกจากไฟล์นี้

**รอบแก้ไขเอกสาร (4 ก.ย. 2569)** — สิ่งที่รันเพิ่มเพื่อยืนยัน/แก้ข้อความ มีเพียงสามอย่าง และไม่มีการเขียนฐานข้อมูลใด ๆ:

1. รันเครื่องมือทั้งสองในบล็อกด้านบนซ้ำด้วย flag ชุดเดิม — ผลตรงกับตัวเลขเดิมทุกตัว (`249 routes, 0 findings` · `writes=75 scoped-role-reachable=30 org=25 self=5 actor-only=0 gaps=0 unmounted=12`)
2. `curl` สอง request แบบไม่ยืนยันตัวตนไปยัง `http://localhost:3000` ของ sandbox (ผลอยู่ใน §3.1)
3. สคริปต์ `node` สั้น ๆ บนเครื่องนี้เพื่อสังเกตพฤติกรรมของ `res.setHeader` กับอักขระ CR/LF/`"` (ผลอยู่ใน S6)

## 7. สถานะ findings เมื่ออ่านซ้ำที่ `a0e783e` (5 กันยายน 2569 ค่ำ)

อ่านโค้ดที่ commit ที่ production รันอยู่ (`docs/ops/deploy-2026-09-05-a0e783e.md`) เฉพาะจุดที่ finding แต่ละข้อชี้ **ยังเป็นการอ่านโค้ด ไม่ใช่การทดสอบเจาะระบบ** และเกณฑ์ความรุนแรงยังรอ C0-13

| finding | สถานะที่ `a0e783e` | หลักฐานที่อ่าน |
|---|---|---|
| S1 participation ไม่ผูกประเภทเหตุการณ์กับบทบาท | **ยังเปิด** | `participation.service.js` `ALLOWED_EVENTS` ยังคีย์ด้วย status ของ case เท่านั้น ไม่มีตารางบทบาท→event |
| S2 `/api/school/audit-logs` JSON ไม่ redact | **แก้แล้ว** | `school.routes.js` มี `redactVal` ครอบทั้งสาขา JSON ใต้ route `/audit-logs` (ราวบรรทัด 1385–1392) พร้อมคอมเมนต์อธิบายว่าห้ามประกาศซ้ำในฟังก์ชัน |
| S3 verification timeline อ่านข้าม scope ได้ | **แก้แล้ว** | `verification.routes.js` `/applications/:id/timeline` เพิ่ม correlated EXISTS ต่อบทบาท (driver = ผู้ยื่น, school = โรงเรียนที่ผูกกับคำขอ; fail-closed เมื่อไม่มี scopeId) |
| S4 participation รับ `scope_id` โดยไม่ตรวจว่ามีอยู่จริง | **ยังเปิด** | `participation.service.js` ตรวจแค่ว่ามีค่าเมื่อ scope ไม่ใช่ PROVINCE (ราวบรรทัด 131–135) ไม่ได้ตรวจกับตาราง schools/affiliations และไม่ได้เทียบกับ scope ของผู้เรียก |
| S5 `/api/documents/:docType/:id/file` ไม่กันครูประจำสายชั้น | **ยังเปิด** | `documents.routes.js:27` มีเพียง `requireRole('driver','school','transport','admin')` — โมดูล registration กันครูแล้ว (`registration.routes.js:196-208`) แต่ documents ไม่ |
| S6 research export ไม่ validate `from`/`to` | **แก้แล้ว** | `4271531` + `backend/tests/researchExportDateValidation.test.js` |
| S7 RBAC matrix รายงานบทบาทกว้างกว่าจริง 2 route | **ยังไม่ได้ตรวจซ้ำ** | ต้องเทียบ route ทั้งสองกับ handler ด้วยตา ยังไม่ได้ทำในรอบนี้ |

ฐานตัวเลข: matrix ที่ `a0e783e` = 250/267/293 route ตามสถานะ flag (เดิม 249/266/292; +1 = `GET /api/admin/operations/capacity-sample`) findings 0 ทุกสถานะ; scope audit เท่าเดิมทุกค่า (ดู `docs/audit/menu-baseline-2026-09-04.md` §12)
สิ่งที่ยังไม่มีในเอกสารนี้และควรอยู่ในรอบทบทวนถัดไป: endpoint `capacity-sample` (RR-10) และ frontend participation (`c077f03`) ซึ่งเข้ามาหลังฐาน `4b80b4b`

