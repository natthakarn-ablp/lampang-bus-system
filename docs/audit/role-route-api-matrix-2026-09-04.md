# Role-to-Route / API / Write-Action Matrix — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **matrix ระดับ release candidate ที่ผลิตจาก router graph จริง + การยิง request จริงไปยัง sandbox ที่รันอยู่** — ไม่ใช่การอนุมัติสิทธิ์ ไม่ใช่ผล UAT ไม่ใช่ penetration test และไม่ใช่หนังสือรับรองว่าไม่มีช่องโหว่ ทุกตัวเลขในเอกสารนี้เป็นของ commit และชุด feature flag ที่ระบุไว้ใน §1 เท่านั้น

Task: `A1-3` (Phase 5 checkbox 1 และ 4) ตาม `docs/project-closure/master-project-closure-plan.md:199, 202` และ `docs/project-closure/execution-plan-to-completion-2026-09-04.md:126`

**เอกสารนี้ยังไม่ปิด A1-3** — A1-3 ผูกกับ **C0-1 + C0-2** ซึ่งยังไม่มีคำตอบ ส่วนที่ทำได้โดยไม่ต้องรอ decision คือ matrix + การยืนยัน server-side scope (§3–§8) ส่วนที่ทำไม่ได้คือ regression test ต่อ logic decision C0-1/C0-2 (§10)

---

## 1. ฐานที่วัด

| รายการ | ค่า |
|---|---|
| Repository | `D:/Projects/lampang-bus-work` (worktree) branch `feat/tracking-security-hardening` |
| Commit ที่อ่าน source | `1b0c1a5` — `git status --porcelain` ขึ้นเฉพาะ `scripts/e2e-review.mjs` ซึ่งไม่อยู่ใน `backend/src` หรือ `frontend/src` |
| Backend ที่รันอยู่ | `http://127.0.0.1:3000` รายงาน `commit: 4b80b4b` จาก `GET /health` |
| `4b80b4b` ต่างจาก `1b0c1a5` อย่างไร | `git diff --stat 4b80b4b..1b0c1a5 -- backend/src frontend/src` คืน **0 ไฟล์** — ส่วนต่าง 2 commit แตะเฉพาะ `docs/`, `scripts/`, `backend/scripts/seed-synthetic-staging.js` และ `.gitattributes` ดังนั้น backend ที่รันอยู่ **มี runtime code เดียวกับ commit ที่อ่าน** |
| Feature flag ของ backend ที่รันอยู่ | อ่านจาก `data.features` ในผลลัพธ์ `POST /api/auth/login` ตอนทดสอบ: `adminPasswordRecovery`, `vehicleQr`, `driverShiftSelection`, `qrLevel3`, `eta`, `geofence`, `routeDeviation`, `driverRegistration`, `parentConsentRequired`, `participationCases` = **false ทั้ง 10 ตัว** |
| Environment ที่ใช้รัน generator | `scratchpad/sandbox.env` (`NODE_ENV=test`, `DB_NAME=lampang_bus_sandbox`) ไม่ตั้ง `FEATURE_*` ใด จึงเป็น false ทั้งหมดตาม `backend/src/config/env.js:205-238` — **ตรงกับ flag ของ backend ที่รันอยู่** |
| ฐานข้อมูลที่แตะ | `lampang_bus_sandbox` (อ่าน + ยิง request) และ `lampang_bus_test` (จาก jest ตาม `backend/.env.test`) — **ไม่แตะ `lampang_bus` และไม่แตะ production** |
| ที่เก็บผลดิบของ generator | ไดเรกทอรีชั่วคราวนอก repository — **ไม่ได้เขียนลง `outputs/rbac-matrix/`** ตามข้อจำกัดของงานรอบนี้ (ดู §10) |
| Node | v24.15.0 |

คำสั่งที่ใช้ (เขียนผลลัพธ์นอก repository):

```
cd backend && set -a && . <sandbox.env> && set +a \
  && node scripts/generate-rbac-matrix.js --json --out <TMP>/rbac.json \
  && node scripts/audit-scope-enforcement.js --out <TMP>/scope.json
```

ชุด "เทียบเท่า production" เติม `FEATURE_DRIVER_REGISTRATION=true` และชุด "flag ครบ" ตั้งครบ 10 ตัวตาม `env.js:205-238`

ผลดิบ (flag ปิดทั้งหมด):

```
[rbac]  249 routes, 0 findings
[scope] id-addressed writes=75 scoped-role-reachable=30 org=25 self=5 actor-only=0 gaps=0 unmounted=12
```

**เอกสารนี้ไม่ใช้ `findings=0` และ `gaps=0` เป็นข้อสรุป** — สองตัวเลขนั้นแปลว่า "ในกลุ่มที่เครื่องมือเลือกมาตรวจ ไม่พบสิ่งที่เครื่องมือรู้จัก" §2 ระบุว่ากลุ่มนั้นทิ้งอะไรไว้ข้างนอก และ §5–§8 คือการตรวจสิ่งที่อยู่ข้างนอก

---

## 2. เอกสารเดิมครอบคลุมอะไรแล้ว และฉบับนี้เพิ่มอะไร

| เอกสาร | ครอบคลุม | ไม่ครอบคลุม |
|---|---|---|
| `docs/audit/menu-baseline-2026-09-04.md` §9 | จำนวน route รวมและรายบทบาทใน 3 สถานะ flag; จำนวนเมนูรายบทบาท | ไม่มีตาราง route ราย endpoint; ไม่ระบุ guard ต่อ route; ไม่เทียบเมนูกับ API ราย endpoint; ไม่มีการทดสอบ scope |
| `docs/security/threat-rbac-idor-review-2026-09-04.md` | โมเดล scope ต่อบทบาท; ข้อจำกัด L1–L5 ของเครื่องมือ; read ที่ระบุด้วย id 10 รายการ; finding S1–S6 | ระบุเองที่ §3.1 และ U1 ว่า **แทบทั้งหมดเป็นการอ่าน source ยังไม่ได้ยิง request**; ไม่มีตาราง guard ครบทุก id-addressed write; ไม่ตรวจ write ที่ระบุ resource จาก body; ไม่เทียบกับ sidebar |

สิ่งที่เอกสารฉบับนี้เพิ่ม:

1. ตาราง **id-addressed write ครบทั้ง 63 route ที่ mount จริง** พร้อม guard และเลขบรรทัด (§4)
2. การตรวจ **write ที่ระบุ resource จาก request body ไม่ใช่จาก path** — 33 route ที่ `audit-scope-enforcement.js` ข้ามทั้งหมดโดยออกแบบ (§5)
3. จุดที่ **token ของเครื่องมือชี้ผิดที่** — ผ่านเพราะ token ที่ไม่ใช่ตัว resolve scope และตกเพราะ token ที่ตัวจริงใช้ชื่ออื่น (§6)
4. **Cross-check กับ frontend สองทิศทาง** ราย endpoint (§7)
5. **การยิง request จริงไปยัง backend ที่รันอยู่** ด้วย token จริง 3 บทบาท — 7 scope guard + 4 positive control + 1 query-spoof + 6 probe + 4 service-level role check พร้อมตรวจแถวในฐานข้อมูลก่อน/หลังทุกครั้งที่เป็น write (§8)
6. **การเทียบ matrix ที่ผลิตได้กับ RBAC matrix ที่ประกาศไว้ใน `CLAUDE.md` §8** และการชี้ว่า matrix เป็นเพดานไม่ใช่สิทธิ์ที่มีผลจริง (§3.4, §3.5)

---

## 3. Matrix รายบทบาท

### 3.1 ภาพรวมสามสถานะ flag

| สถานะ flag | route | write | read | มี role guard | ไม่มี role guard | findings |
|---|---:|---:|---:|---:|---:|---:|
| ปิดทั้งหมด (**= backend ที่รันอยู่**) | 249 | 120 | 129 | 226 | 23 | 0 |
| + `FEATURE_DRIVER_REGISTRATION=true` (เทียบเท่า production) | 266 | 130 | 136 | 243 | 23 | 0 |
| flag ครบ 10 ตัว | 292 | 142 | 150 | 263 | 29 | 0 |

จำนวน route ที่ไม่มี role guard เพิ่มจาก 23 เป็น 29 เมื่อเปิด flag ครบ เพราะ `/api/consent/*` (5 route) และ `GET /api/qr/vehicle/:qr_token` (1 route) ใช้ LINE id_token และ signed QR token แทน JWT role

คอลัมน์ route / write / role guard / findings ของสามแถวนี้ตรงกับ `menu-baseline-2026-09-04.md` §9.1 ทุกช่อง (รันคนละรอบ คนละไดเรกทอรี ได้ค่าเดียวกัน) คอลัมน์ read และ "ไม่มี role guard" เป็นของเอกสารนี้ ไม่มีใน §9.1

### 3.2 route ที่แต่ละบทบาทเรียกได้ — แยก write / read และแยก "ระบุ resource ด้วย id ใน path"

`id-w` = write ที่มี `:param` ใน path · `id-r` = read ที่มี `:param` ใน path

**สถานะ flag ปิดทั้งหมด (backend ที่รันอยู่ตอนทดสอบ)**

| บทบาท | route ที่เรียกได้ | write | read | id-w | id-r |
|---|---:|---:|---:|---:|---:|
| driver | 37 | 21 | 16 | 5 | 3 |
| school | 69 | 31 | 38 | 19 | 6 |
| affiliation | 39 | 12 | 27 | 6 | 2 |
| province | 27 | **1** | 26 | 0 | 2 |
| transport | 26 | 10 | 16 | 8 | 5 |
| admin | 190 | 85 | 105 | 58 | 14 |
| **รวม route ที่มี id ใน path (ไม่นับซ้ำข้ามบทบาท)** | 82 | 63 | 19 | | |

**เทียบเท่า production (`FEATURE_DRIVER_REGISTRATION=true`)**

| บทบาท | route | write | read | id-w | id-r |
|---|---:|---:|---:|---:|---:|
| driver | 45 | 26 | 19 | 7 | 4 |
| school | 79 | 36 | 43 | 24 | 10 |
| affiliation | 39 | 12 | 27 | 6 | 2 |
| province | 27 | 1 | 26 | 0 | 2 |
| transport | 27 | 10 | 17 | 8 | 6 |
| admin | 200 | 90 | 110 | 63 | 18 |

**flag ครบ 10 ตัว**

| บทบาท | route | write | read | id-w | id-r |
|---|---:|---:|---:|---:|---:|
| driver | 53 | 30 | 23 | 8 | 6 |
| school | 86 | 38 | 48 | 25 | 13 |
| affiliation | 46 | 14 | 32 | 7 | 5 |
| province | 36 | 3 | 33 | 1 | 5 |
| transport | 35 | 14 | 21 | 11 | 8 |
| admin | 218 | 98 | 120 | 68 | 23 |

**วิธีอ่านตารางนี้** ผลรวมรายบทบาทมากกว่าจำนวน route ทั้งหมด เพราะ route หนึ่งเปิดให้หลายบทบาท คอลัมน์นี้คือ "route ที่บทบาทนั้นเรียกได้" ไม่ใช่ "route ที่เป็นของบทบาทนั้น"

**ข้อสังเกตที่ตัวเลขบอกและควรบันทึกไว้**

- `province` มี write **เพียง 1 route** ในสถานะ flag ปิด คือ `POST /api/reports/decision-log` (§5.3) ทั้งบทบาทเป็น read เกือบทั้งหมด
- `admin` เรียกได้ 190 จาก 249 route (76%) และ 85 จาก 120 write (71%) — การควบคุมของบทบาทนี้อยู่ที่ audit log ไม่ใช่ที่ scope
- `school` เป็นบทบาทที่มี id-addressed write มากที่สุดในกลุ่มที่มี scope แคบ (19 route) จึงเป็นพื้นผิว cross-tenant ที่ใหญ่ที่สุด

### 3.3 route 23 รายการที่ไม่มี `requireRole` และกลไกที่ใช้แทน

ตรวจครบทั้ง 23 รายการ (เท่ากันในสถานะ flag ปิดทั้งหมดและเทียบเท่า production; เป็น 29 เมื่อเปิด flag ครบ ตาม §3.1) กลไกที่ generator ประกาศไว้เป็นแบบ prefix ที่ `generate-rbac-matrix.js:34-41` และรายการ accepted-open ที่ `:49-70` — **ถ้อยคำของ generator หยาบกว่าโค้ดจริงในสองจุด ดู §6.3**

| prefix | จำนวน | กลไกจริงที่อ่านจากโค้ด |
|---|---:|---|
| `/api/auth` (login, refresh, logout, me, change-password) | 6 | public หรือ self-service; `authenticate` อยู่บน logout/me/change-password |
| `/api/auth/recovery` (config, request, complete, self/*) | 6 | `requireFeature` + (สำหรับ `self/*`) `authenticate` + `requireRecoveryRole` — flag ปิดอยู่ |
| `/api/parent/children*` | 4 | `requireParentLineAuth` (`parent.routes.js:70`) |
| `/api/parent/line/bind-preview`, `bind-confirm` | 2 | **ไม่ผ่าน `requireParentLineAuth`** — ตรวจ id_token เองในตัว handler ที่ `parent.routes.js:234` และ `:293` แล้วตอบ 401 ถ้าไม่ผ่าน ถูกต้องตามการออกแบบเพราะยังไม่มี binding ให้ยืนยัน แต่ป้ายของ generator ไม่ตรง (§6.3) |
| `/api/line/webhook` | 1 | LINE signature (`line.routes.js:77-78`) |
| `/api/line/process-notifications` | 1 | **CRON API key ไม่ใช่ LINE signature** (`line.routes.js:532-547`) — fail closed ใน production, ปล่อยผ่านใน dev/test (§6.3) |
| `/api/terms/current` | 1 | `authenticate` ทุกบทบาท (accepted exception) |
| `/api/visits/track` | 1 | public counter + limiter เฉพาะตัว (`app.js:172-188`) |
| `/health` | 1 | public liveness probe |

---

### 3.4 matrix นี้เป็น "เพดาน" ไม่ใช่ "สิทธิ์ที่มีผลจริง"

`generate-rbac-matrix.js` อ่าน `requireRole` ที่อยู่ในสาย middleware เท่านั้น ถ้า handler หรือ service ตรวจบทบาทซ้ำอีกชั้น matrix จะ **รายงานเกินจริง** พบสองกรณีในสถานะ flag ปิด — ทั้งสองยืนยันด้วยการยิงจริงแล้ว (§8.6)

| Route | matrix บอกว่า | ที่มีผลจริง | ตรวจซ้ำที่ |
|---|---|---|---|
| `GET /api/reports/policy` | admin, affiliation, province, school | **province, admin** | `services/report.service.js:475-481` โยน 403 `FORBIDDEN` |
| `POST /api/reports/decision-log` | admin, affiliation, province, school | **province, admin** | `routes/report.routes.js:656-658` เทียบกับ `DECISION_LOG_ROLES` ที่ `utils/decisionLog.js:23` |

ผลต่อตัวเลขใน §3.2 (สถานะ flag ปิดทั้งหมด):

| บทบาท | write ตาม matrix | write ที่ใช้ได้จริง | read ตาม matrix | read ที่ใช้ได้จริง |
|---|---:|---:|---:|---:|
| school | 31 | **30** | 38 | **37** |
| affiliation | 12 | **11** | 27 | **26** |
| province | 1 | 1 | 26 | 26 |

**ข้อควรจำสำหรับผู้ใช้เอกสารนี้**: ตัวเลขใน §3.2 คือ "route ที่ผ่าน role guard ระดับ router" ไม่ใช่ "route ที่ทำงานสำเร็จ" การนับสิทธิ์ที่มีผลจริงต้องยิงจริงหรืออ่าน service ทุกตัว — เอกสารนี้ทำได้เฉพาะสองกรณีข้างบนกับ 7 guard ใน §8.1

### 3.5 เทียบกับ RBAC matrix ที่ประกาศไว้ใน `CLAUDE.md` §8

`CLAUDE.md` §8 มีตาราง RBAC ที่ระบุว่า "อัปเดต 2026-06-26 — แก้ให้ตรงโค้ดจริง" เทียบราย cell กับ router graph รอบนี้ พบ **สามช่องที่ไม่ตรงกับโค้ดปัจจุบัน** (ทั้งสามเป็นความคลาดของเอกสาร ไม่ใช่ของแอป)

| ช่องใน `CLAUDE.md` §8 | ที่เอกสารนั้นระบุ | ที่ router graph บอก | หลักฐาน |
|---|---|---|---|
| โอนย้ายนักเรียนข้ามโรงเรียน / affiliation | `❌⁵` พร้อมเชิงอรรถ "ยังไม่ implement — admin อนุมัติทั้งหมด (TODO)" | **affiliation อนุมัติได้จริง** | `POST /api/affiliation/transfer-requests/:id/approve` (`affiliation.routes.js:751`) เรียก `transfer.approveAndApply` ที่ `:758` และเขียน audit `approved_by_affiliation: true` ที่ `:760` |
| คำขอเกี่ยวกับรถ / affiliation | `❌⁵` เชิงอรรถเดียวกัน | **affiliation อนุมัติได้จริง** | `POST /api/affiliation/vehicle-requests/:id/approve` (`:803`) เรียก `vr.approveVehicleRequest` ที่ `:809` |
| เช็กอิน/เช็กเอาท์ / admin | `❌` | **แม่นเฉพาะ `/api/driver/checkin`** — admin เรียก `POST /api/school/checkin-override` (`school.routes.js:615`), `/checkin-override/all` (`:672`), `POST /api/school/checkin/:logId/void` (`:2099`) และ `POST /api/admin/checkin/:logId/void` ได้ | matrix แถว school area `/api/school/checkin-override [2/2w] roles=admin,school` |

ผลที่ตามมา: **มีคิวอนุมัติสองชั้นอยู่จริงในโค้ด** สำหรับ transfer request และ vehicle request (affiliation อนุมัติได้ และ admin ก็อนุมัติได้ผ่าน `/api/admin/{student-transfer,vehicle}-requests/:id/{approve,reject}`) ซึ่งเป็นสิ่งที่ **C0-2 ตั้งใจจะยุบให้เหลือระดับเดียว** — เอกสารนี้บันทึกสภาพ ไม่เสนอว่าจะยุบชั้นไหน

นอกจากนี้ `CLAUDE.md` §5.5 ระบุว่า "`GET /api/province/reports/policy` ยังไม่มีในระบบ (404 ทุก path)" ซึ่งถูกต้องสำหรับ **path นั้น** แต่ `GET /api/reports/policy` **มีอยู่จริงและทำงาน** (`report.routes.js:107`) ขณะที่ §5.8 ซึ่งเป็นรายการ endpoint ของ `/api/reports/*` **ไม่ได้ระบุ `/policy` ไว้** — รายการใน §5.8 จึงไม่ครบ

---

## 4. id-addressed write ทุกรายการ และ guard ที่ resolve scope ฝั่ง server

63 route ที่ mount จริงในสถานะ flag ปิด (`audit-scope-enforcement.js` รายงาน 75 เพราะนับจาก **ไฟล์ route** ไม่ใช่จาก router graph; 12 รายการที่ต่างกันคือ router ที่ flag ปิดอยู่ — ดู §4.6)

### 4.1 `school.routes.js` — 16 route (roles: admin, school)

Guard ระดับ router: `school.routes.js:158` `router.use(authenticate, requireRole('school','admin'))`
ตัว resolve scope: `resolveSchoolId(req)` — `school.routes.js:44-47` คืน `req.user.scopeId` สำหรับทุกบทบาทที่ไม่ใช่ admin (admin เท่านั้นที่อ่าน `req.query.school_id || req.body?.school_id`)
ตัวกันครูประจำสายชั้น: `requireFullSchoolScope` — `school.routes.js:88-98` (**ไม่ใช่ตัว resolve scope** เป็นตัวปิด write ของบัญชีครู)

| Method | Path | ประกาศที่ | resolve scope ที่ |
|---|---|---|---|
| DELETE | `/api/school/pickup-points/:id` | `:394` | `resolveSchoolId` `:396` |
| PUT | `/api/school/pickup-points/:id/students` | `:453` | `resolveSchoolId` `:455` |
| DELETE | `/api/school/leaves/:id` | `:599` | `resolveSchoolId` `:601` |
| PUT | `/api/school/roster-requests/:id` | `:751` | `resolveSchoolId` `:753` |
| PUT | `/api/school/students/:id` | `:768` | `resolveSchoolId` `:770` → `WHERE s.id=? AND s.school_id=?` `:782` |
| DELETE | `/api/school/students/:id` | `:975` | `resolveSchoolId` `:977` → `WHERE s.id=? AND s.school_id=?` `:986` |
| POST | `/api/school/students/:id/restore` | `:1014` | `resolveSchoolId` `:1016` |
| PUT | `/api/school/vehicles/:id` | `:1219` | `resolveSchoolId` `:1221` → `validateVehicleServesSchool` `:1226` (`services/pickupPoint.service.js:584`) |
| POST | `/api/school/students/import/:batchId/apply` | `:1765` | `resolveSchoolId` `:1767` |
| POST | `/api/school/students/import/:batchId/rollback` | `:1811` | `resolveSchoolId` `:1813` |
| POST | `/api/school/students/transfer-requests/:id/cancel` | `:1847` | `resolveSchoolId` `:1850` |
| POST | `/api/school/students/:studentId/transfer-request` | `:1855` | `resolveSchoolId` `:1860` → `studentTransfer.service.js:28` เทียบ `st.school_id` แล้ว 403 |
| POST | `/api/school/vehicles/requests/:id/cancel` | `:1881` | `resolveSchoolId` `:1884` |
| POST | `/api/school/teacher-accounts/:id/reset-password` | `:2010` | `resolveSchoolId` `:2012` |
| DELETE | `/api/school/teacher-accounts/:id` | `:2060` | `resolveSchoolId` `:2062` |
| POST | `/api/school/checkin/:logId/void` | `:2099` | `resolveSchoolId` `:2101` → `checkin.service.js:1206-1213` ตรวจใน locked transaction |

ทั้ง 16 route มี `requireFullSchoolScope` เป็น middleware ตัวแรกด้วย (บรรทัดเดียวกับที่ประกาศ route)

### 4.2 `affiliation.routes.js` — 6 route (roles: admin, affiliation)

Guard ระดับ router: `affiliation.routes.js:162` · resolve scope: `resolveAffiliationId(req)` — `:164-167` คืน `req.user.scopeId` สำหรับ non-admin

| Method | Path | ประกาศที่ | resolve scope ที่ |
|---|---|---|---|
| POST | `/api/affiliation/school-accounts/:id/reset-password` | `:370` | `resolveAffiliationId` `:372` → `affiliationAdmin.service.js:74-85` JOIN `schools.affiliation_id = ?` |
| PUT | `/api/affiliation/school-accounts/:id` | `:385` | `resolveAffiliationId` `:387` → `affiliationAdmin.service.js:119-129` JOIN เดียวกัน |
| POST | `/api/affiliation/transfer-requests/:id/approve` | `:751` | `resolveAffiliationId` `:754` |
| POST | `/api/affiliation/transfer-requests/:id/reject` | `:769` | `resolveAffiliationId` `:772` |
| POST | `/api/affiliation/vehicle-requests/:id/approve` | `:803` | `resolveAffiliationId` `:806` |
| POST | `/api/affiliation/vehicle-requests/:id/reject` | `:816` | `resolveAffiliationId` `:819` |

### 4.3 `driver.routes.js` — 5 route (role: driver)

Guard ระดับ router: `driver.routes.js:88` `router.use(authenticate, requireRole('driver'))` · resolve scope: `checkinSvc.getDriverVehicle(pool, req.user)` — `services/checkin.service.js:66`

| Method | Path | ประกาศที่ | resolve scope ที่ |
|---|---|---|---|
| POST | `/api/driver/shifts/:id/end` | `:186` | `req.user.driver_id` จาก token `:189` |
| DELETE | `/api/driver/pickup-points/:id` | `:338` | `getDriverVehicle` `:343` → เทียบ `point.vehicle_id` แล้ว 403 ที่ `:349` |
| PUT | `/api/driver/pickup-points/:id/students` | `:391` | `getDriverVehicle` `:401` → 403 ที่ `:407` |
| DELETE | `/api/driver/leave/:id` | `:942` | `getDriverVehicle` `:946` |
| POST | `/api/driver/checkin/:logId/void` | `:1295` | `getDriverVehicle` `:1302` → `checkin.service.js:1201-1205` เทียบ `log.vehicle_id` ใน locked transaction แล้ว 403 |

### 4.4 `verification.routes.js` — 9 route

Guard ระดับ router: `verification.routes.js:14` `router.use(authenticate)` เท่านั้น — role guard อยู่ราย route

| Method | Path | roles | ประกาศที่ | resolve scope ที่ |
|---|---|---|---|---|
| POST | `/applications/:id/ready` | school, admin | `:83` | `schoolIdFor(req)` `:89` (`:16-21`) → `vehicleVerification.service.js:541-545` เทียบ `issuing_school_id` ใน `FOR UPDATE` |
| POST | `/applications/:id/cancel` | school, admin | `:99` | เหมือนกัน `:105` |
| POST | `/applications/:id/review` | school, admin | `:117` | `schoolIdFor` `:123` → `vehicleVerification.service.js:1210-1211` |
| POST | `/transport/vehicles/:id/drivers` | transport, admin | `:206` | role-only (ไม่มี scope แคบกว่า) — `req.body.driver_id` `:212` เป็น **payload** ไม่ใช่ scope |
| POST | `/transport/drivers/:id/qualification` | transport, admin | `:224` | role-only |
| POST | `/transport/applications/:id/start` | transport, admin | `:249` | role-only |
| POST | `/transport/attempts/:id/finalize` | transport, admin | `:266` | role-only |
| DELETE | `/transport/attempts/:id` | transport, admin | `:290` | role-only |
| POST | `/transport/documents/:kind/:id/review` | transport, admin | `:328` | role-only + `requireDocFeature` |

### 4.5 route ที่ไม่มี scope แคบกว่าโดยนิยาม — 27 route

`admin.routes.js` 25 route (`:203, 279, 317, 341, 457, 483, 502, 527, 570, 1451, 1465, 1487, 1500, 1531, 1540, 1549, 1562, 1575, 1594, 1612, 1633, 1655, 1708, 1729, 1762`) — guard เดียวคือ `admin.routes.js:94` `router.use(authenticate, requireRole('admin'))`

`transport.routes.js` 2 route (`PUT`/`DELETE /api/transport/inspections/:id` ที่ `:240` และ `:270`) — guard คือ `transport.routes.js:14` `router.use(authenticate, requireRole('transport','admin'))`

**ข้อความที่ต้องระบุให้ตรง**: กลุ่มนี้ "ไม่มี guard ที่ resolve scope" เพราะ `admin` และ `transport` ถูกนิยามว่าไม่มีขอบเขตแคบกว่าทั้งระบบ ไม่ใช่เพราะไม่มีใครใส่ guard นิยามนี้อยู่ในโค้ดของเครื่องมือ (`audit-scope-enforcement.js:45`) และใน `CLAUDE.md` **ยังไม่มี owner decision ที่ยืนยันนิยามนี้เป็นลายลักษณ์อักษร** ถ้า C0-2 ตัดสินว่า `transport` ต้องเห็นเฉพาะรถในความรับผิดชอบ 2 route นี้จะกลายเป็นช่องว่างทันที — **รอ C0-2**

### 4.6 12 route ที่ไม่ถูกนับเพราะ router ปิดด้วย flag

`geofence.routes.js` PUT/DELETE `/:id` · `participation.routes.js` POST `/cases/:id/events` · `qr.routes.js` POST `/vehicle/:id/token`, `/vehicle/:id/revoke` · `registration.routes.js` 7 route

รายการนี้ตรงกับที่ `menu-baseline-2026-09-04.md` §9.5 และ `threat-rbac-idor-review-2026-09-04.md` §5.1 บันทึกไว้ **สิ่งที่เอกสารนี้ปิดเพิ่มได้หนึ่งข้อ**: `menu-baseline` §9.5 ระบุว่า `DELETE /api/driver/registrations/documents/:kind/:id` ถูกจัดเป็น `actor-scoped only` และ "ยังไม่มีใครยืนยันข้อนี้ในเอกสารใด" — ตรวจแล้ว **แถวถูก key ด้วย actor จริง**: `services/driverDocuments.service.js:286-288` เทียบ `doc.uploaded_by` กับ `userId` ภายใน `FOR UPDATE` transaction และ 403 `NOT_OWNER` ถ้าไม่ตรง พร้อมล็อกเอกสารที่ `review_status='APPROVED'` เพิ่มอีกชั้นที่ `:291-293`

---

## 5. Write ที่ระบุ resource จาก body ไม่ใช่จาก path — กลุ่มที่เครื่องมือไม่แตะเลย

`audit-scope-enforcement.js:142` ตัด route ที่ไม่มี `:` ใน path ออกก่อนตรวจทุกครั้ง ในสถานะ flag ปิด มี **33 write route ที่ไม่มี `:` ใน path และบทบาทที่มี scope แคบเรียกได้** ซึ่งไม่เคยถูกตรวจโดยเครื่องมือใดในโครงการ

รันวิธีเดียวกับเครื่องมือ (token match + ตัด `logAudit(...)` ออกจากหน้าต่างค้นหา) กับกลุ่มนี้:

| ผล | จำนวน | หมายเหตุ |
|---|---:|---|
| organisation-scoped | 16 | `school.routes.js` 10, `affiliation.routes.js` 5, `verification.routes.js` 1 |
| self-scoped | 14 | `driver.routes.js` ทั้งหมด ผ่าน `getDriverVehicle` |
| ไม่พบ token | 3 | ตรวจด้วยมือทั้งสามข้อ ด้านล่าง |

### 5.1 `POST /api/driver/applications` (`driver.routes.js:1257`) — รับ `req.body.vehicle_id`

**ไม่ใช่ finding** — service ตรวจสิทธิ์ก่อนเสมอ: `services/vehicleVerification.service.js:1026-1041` query `driver_vehicle_assignments` ที่ `is_active = TRUE AND authorization_status='AUTHORIZED'` และผูก `driver_id` กับ `users.id = ?` ที่มาจาก token ถ้าไม่ตรงจะ 403 `DRIVER_NOT_AUTHORIZED_FOR_VEHICLE` เครื่องมือมองไม่เห็นเพราะตัวแปรชื่อ `driverUserId` ไม่ใช่ `driverId` ที่อยู่ในรายการ token (`audit-scope-enforcement.js:71-77`)

### 5.2 `POST /api/driver/change-password` (`driver.routes.js:884`)

**ไม่ใช่ finding** — resource คือบัญชีของผู้เรียกเอง ผูกกับ `req.user.id`

### 5.3 `POST /api/reports/decision-log` (`report.routes.js:654`) — write เดียวของบทบาท province

**ไม่ใช่ finding แต่เป็นสิ่งประดิษฐ์ของเครื่องมือที่ควรบันทึก** — handler ทั้งตัวมีผลข้างเคียงเพียงอย่างเดียวคือเขียนแถว `audit_logs` ผ่าน `logAudit(...)` โดย `user_id` และ `scope_id` มาจาก token ที่ `:664-679` ไม่มี id ใด ๆ จาก body เข้าไปในการกำหนดขอบเขต แต่เครื่องมือ **ตัด `logAudit(...)` ทิ้งก่อนค้นหา token** (ตามเจตนาที่ `audit-scope-enforcement.js:78-83` เพื่อกัน pass แบบว่างเปล่า) จึงเหลือ handler ที่ไม่มี token เลย — เป็นกรณีที่กติกากันการผ่านแบบว่างเปล่า ทำให้ handler ที่ถูกต้องดูเหมือนไม่มี scope

route นี้ยัง re-check บทบาทซ้ำในตัว handler ที่ `report.routes.js:656-658` (`DECISION_LOG_ROLES`) นอกเหนือจาก `router.use(authenticate, requireRole('school','affiliation','province','admin'))` ที่ `report.routes.js:16`

### 5.4 สิ่งที่กลุ่มนี้ยังไม่ได้พิสูจน์

ทั้ง 33 route ตรวจแบบ static เท่านั้น (ยกเว้นที่ยิงจริงใน §8) — token ที่พบไม่ได้พิสูจน์ว่า SQL predicate ถูก และ **ไม่มีเครื่องมืออัตโนมัติตัวใดในโครงการเฝ้ากลุ่มนี้อยู่** regression ที่ทำให้ `POST /api/school/students/move` รับ `school_id` จาก body ตรง ๆ จะไม่ทำให้ `gaps` ขยับจาก 0

---

## 6. จุดที่ผลของเครื่องมือกับโค้ดจริงไม่ตรงกัน

ทั้งสามข้อนี้ **ไม่ใช่ application defect** แต่ทำให้ผลของเครื่องมือถูกอ่านผิดได้ และควรแก้ที่เครื่องมือก่อนใช้ `gaps=0` เป็นหลักฐานปิด gate

### 6.1 `verification.routes.js` — ผ่านด้วย token ที่ไม่ใช่ตัว resolve scope

`audit-scope-enforcement.js` จัด `POST /applications/:id/{ready,cancel,review}` เป็น `organisation` โดยจับ token `requireFullSchoolScope` (`ORG_SCOPE_TOKENS` ที่ `:49-64`) แต่ `requireFullSchoolScope` ใน `verification.routes.js:23-32` เป็น **ตัวกันบัญชีครูประจำสายชั้น ไม่ใช่ตัว resolve scope** ตัวที่ resolve scope จริงคือ `schoolIdFor(req)` ที่ `:16-21` ซึ่ง **ไม่อยู่ในรายการ token เลย**

ผลที่ตามมา: ถ้าใครลบ `schoolIdFor` แล้วส่ง `req.body.school_id` เข้าไปตรง ๆ เครื่องมือจะยัง `organisation` เหมือนเดิม ข้อนี้ทำให้ข้อจำกัด L5 ใน `threat-rbac-idor-review-2026-09-04.md` §2 แรงกว่าที่เขียนไว้ — ไม่ใช่แค่ "predicate อาจผิด" แต่ "token ที่จับได้อาจไม่ใช่ predicate เลย"

(สภาพปัจจุบันถูกต้อง — scope ถูกบังคับที่ service ตาม §4.4)

### 6.2 token ที่ตกเพราะชื่อไม่ตรง

`driverUserId` (§5.1) และ handler ที่ผลลัพธ์ทั้งหมดอยู่ใน `logAudit` (§5.3) — สองรูปแบบนี้ทำให้ผลออกมาเป็น `none` ทั้งที่โค้ดถูก

### 6.3 ป้ายกลไก auth ของ `generate-rbac-matrix.js` หยาบกว่าโค้ดจริง

`NON_ROLE_AUTH` (`generate-rbac-matrix.js:34-41`) ประกาศเป็น **prefix** จึงเหมารวมทั้ง router:

- `/api/line` ถูกป้ายว่า "LINE webhook signature" ทั้ง prefix แต่ `POST /api/line/process-notifications` ใช้ **CRON API key** (`line.routes.js:543`) ไม่ใช่ signature และในสภาพ `NODE_ENV != production` ที่ไม่ตั้ง `CRON_API_KEY` จะ **ปล่อยผ่านโดยไม่ยืนยันตัวตน** ตามที่เขียนไว้ที่ `line.routes.js:537-541` — เป็นพฤติกรรมที่ประกาศไว้และ fail closed ใน production (`env.js` บังคับ `CRON_API_KEY` ตอน boot) แต่ **สภาพ sandbox ที่ใช้ทำ UAT จะมี endpoint ที่เขียนได้โดยไม่ต้อง auth** ผู้ออกแบบ UAT ต้องรู้ข้อนี้
- `/api/parent` ถูกป้ายว่า "LINE id_token via requireParentLineAuth" แต่ `bind-preview`/`bind-confirm` **ไม่ผ่าน middleware นั้น** ตรวจ id_token เองในตัว handler (`parent.routes.js:234, 293`) ถูกต้องตามการออกแบบ แต่ป้ายทำให้อ่านผิดว่ามี middleware คุมอยู่

---

## 7. Cross-check กับ frontend

วิธี: อ่าน `to:` ทุกตัวจาก `Sidebar.jsx` แยกตาม `NAV_MAP` (`Sidebar.jsx:143`) → map ไปยัง route ใน `App.jsx` → หา component file → ดึง literal `api.<verb>('<path>')` จากไฟล์นั้นและ component ที่มัน import (ลึก 2 ชั้น) → เทียบกับ matrix
ผลดิบเขียนไว้นอก repository เช่นเดียวกับ §1

### 7.1 ทิศทาง A — เมนูมีให้บทบาทนั้น แต่ API เรียกไม่ได้

**ไม่พบรายการที่เป็นปัญหา** — หลังตัดสองกลุ่มที่ไม่ใช่ช่องว่างของบทบาทออก:

1. route ที่ auth ด้วยกลไกอื่น (`POST /api/auth/login`, `/api/auth/logout`, `GET /api/terms/current`) ซึ่ง `roles` ว่างโดยการออกแบบ
2. widget ที่ render เฉพาะ admin ในหน้า layout ที่ใช้ร่วมกัน: `GET /api/admin/pending-requests-count` เรียกใน `components/TopNavbar.jsx:69` ใต้ `if (!isAdmin) return undefined;` ที่ `:67`; `GET /api/province/schools` และ `GET /api/province/affiliations` เรียกใน `components/AdminScopeSelector.jsx:17, 58` ซึ่ง render ใต้ `{isAdmin && <AdminSchoolSelector />}` (`pages/school/SchoolLayout.jsx:32`) และ `{isAdmin && <AdminAffiliationSelector />}` ในไฟล์คู่ของ affiliation

### 7.2 ทิศทาง B — API เรียกได้ตาม matrix แต่ไม่มีทางเข้าใน UI เลย

นี่คือทิศทางที่อันตรายกว่า เพราะ endpoint ยังทำงานอยู่โดยไม่มีใครดูแลผ่านหน้าจอ

จาก 249 route มี **37 route ที่ไม่พบ literal ของ path นั้นในไฟล์ใดใต้ `frontend/src`** ตัดสองกลุ่มที่เป็น false negative ของวิธีค้นหาออกก่อน:

- `/api/reports/export/{csv,excel,pdf}` และ `/monthly/{csv,excel,pdf}` รวม 6 route — มี UI จริง แต่ URL ถูกประกอบจากตัวแปรที่ `components/ExportButtons.jsx:17, 50`
- `GET /health` — เป็น probe ของ operator ไม่ใช่ของ SPA

เหลือ **30 route ที่ไม่มีทางเข้าใน UI จริง**:

**write 13 รายการ**

| Method | Path | roles | อ่านว่าอย่างไร |
|---|---|---|---|
| POST | `/api/admin/checkin/:logId/void` | admin | admin-only ทั้ง 8 รายการนี้ ทำงานได้เต็มรูปแบบผ่าน API แต่ไม่มีปุ่มใดในระบบเรียก — เป็นพื้นผิวสำหรับ support ที่ไม่มี UI และไม่มีขั้นตอนที่เขียนไว้ในคู่มือ |
| POST | `/api/admin/driver-assignments/:assignmentId/end` | admin | |
| PATCH | `/api/admin/emergencies/:id` | admin | |
| DELETE | `/api/admin/emergencies/:id` | admin | |
| PUT | `/api/admin/vehicles/:id` | admin | |
| DELETE | `/api/admin/vehicles/:id` | admin | |
| POST | `/api/admin/vehicles/:id/merge` | admin | |
| POST | `/api/admin/verification/applications/:id/cancel` | admin | |
| POST | `/api/auth/recovery/self/link-line` | (self-service) | 3 รายการนี้อยู่ใต้ `FEATURE_ADMIN_PASSWORD_RECOVERY` ซึ่งปิดอยู่ → dark launch ตามที่ตั้งใจ |
| POST | `/api/auth/recovery/self/regenerate-codes` | (self-service) | |
| DELETE | `/api/auth/recovery/self/line` | (self-service) | |
| POST | `/api/line/webhook` | (LINE signature) | server-to-server ไม่ควรมี UI |
| POST | `/api/line/process-notifications` | (CRON key) | server-to-server — ดู §6.3 |

**ข้อสรุปที่สำคัญของทิศทางนี้: ไม่มี write route ที่บทบาทซึ่งมี scope แคบ (school / affiliation / driver / transport / province) เรียกได้ และไม่มีทางเข้าใน UI** ทั้ง 13 รายการเป็น admin-only, self-service ที่ปิด flag อยู่ หรือ server-to-server

**read 17 รายการ** — 13 รายการเรียกได้โดยบทบาทที่ไม่ใช่ admin:

| Path | roles | หมายเหตุ |
|---|---|---|
| `GET /api/school/missing` | admin, school | หน้า `/school/missing` ใน `App.jsx:244` เป็น `<Navigate to="/school" replace />` — หน้าถูกถอดแล้ว API ยังอยู่ |
| `GET /api/school/no-show` | admin, school | ไม่มี literal ในไฟล์ frontend ใดเลย |
| `GET /api/school/students/template` | admin, school | ดาวน์โหลด template import |
| `GET /api/affiliation/missing` | admin, affiliation | |
| `GET /api/driver/leaves` | driver | |
| `GET /api/driver/search-students` | driver | |
| `GET /api/province/trend` | admin, province | |
| `GET /api/readiness/summary` | admin, province | |
| `GET /api/transport/vehicles/check-plate` | admin, transport | ฝั่ง school มีของตัวเองที่ `pages/school/SchoolBulkVehicles.jsx:67` ฝั่ง transport ไม่มีผู้เรียก |
| `GET /api/transport/vehicles/expiring` | admin, transport | |
| `GET /api/transport/vehicles/pending` | admin, transport | |
| `GET /api/verification/transport/documents/vehicle/:vehicleId` | admin, transport | mount อยู่แต่ `requireDocFeature` (`verification.routes.js:309-314`) ตอบ 404 เมื่อ `driverRegistration` ปิด — บน production ที่ flag เปิด endpoint นี้ทำงานโดยไม่มี UI |
| `GET /api/verification/transport/documents/driver/:driverId` | admin, transport | เช่นเดียวกัน |

อีก 4 รายการเป็น admin-only หรือ auth กลไกอื่น: `GET /api/admin/emergencies`, `GET /api/admin/operations/health`, `GET /api/auth/me` (frontend เก็บ user จาก payload ของ login ไม่เรียก endpoint นี้) และ `GET /api/auth/recovery/self/status` (dark launch)

**สิ่งที่รายการนี้ยังไม่ตอบ** — ไม่ได้แปลว่า 30 route นี้ควรลบ อาจเป็น API สำหรับ integration, สำหรับ support หรือเป็นซากที่ควรถอด **การตัดสินว่าอะไรอยู่อะไรไป เป็นการเปลี่ยน scope ของระบบ — รอ C0-3 (target IA) และ C0-13 (change governance)** เอกสารนี้ทำได้แค่บันทึกว่ามันมีอยู่

### 7.3 บัญชีครูประจำสายชั้น — เมนูมี ปุ่มมี แต่ backend ปฏิเสธ

`TEACHER_BLOCKED_PATHS` (`Sidebar.jsx:151-161`) ตัดเมนู 4 รายการออกจากบัญชีครู เหลือ 9 รายการ ในจำนวนที่เหลือ หน้า `/school/vehicles` (`pages/school/VehicleList.jsx`) **ไม่มีการเรียก `isGradeTeacher` เลย** ขณะที่หน้าอื่นของโมดูลเดียวกันมี (`SchoolApprovals.jsx:23`, `SchoolPickupMap.jsx:24`, `StudentSearch.jsx`, `VehicleVerification.jsx`, `SchoolBulkVehicles.jsx:75`, `SchoolTeacherAccounts.jsx:150`, `SchoolAuditLog.jsx:13`, `SchoolRegistrationReview.jsx:30`)

ผลคือครูประจำสายชั้นเห็นปุ่มแก้ไขรถและกดได้ แล้ว `PUT /school/vehicles/${id}` (`VehicleList.jsx:55`) จะถูก `requireFullSchoolScope` ที่ `school.routes.js:1219` ปฏิเสธด้วย 403 พร้อมข้อความไทย

**นี่ไม่ใช่ช่องโหว่** — backend enforce ถูกต้อง เป็นความไม่สม่ำเสมอของ UI ที่ทำให้ผู้ใช้เจอ error ที่หลีกเลี่ยงได้ **จะแก้อย่างไรขึ้นกับ C0-1** (ถ้าครูเช็กเด็กได้ ชุดสิทธิ์ทั้งชุดเปลี่ยน) จึงยังไม่เสนอวิธีแก้ที่นี่

---

## 8. การยืนยันจริงกับ backend ที่รันอยู่

**เงื่อนไขการทดสอบ** — `POST /api/auth/login` 3 ครั้ง (syn_school_001, syn_aff_001, syn_drv_0001) แล้วใช้ token ซ้ำทุกครั้ง ตาม rate limit ที่ `auth.routes.js:55-61` (20 ครั้ง/IP/15 นาที ไม่มี test skip) · ตรวจแถวในฐานข้อมูลก่อนและหลังทุกการทดสอบที่เป็น write

ระหว่างการทดสอบมี agent อื่นเขียน `lampang_bus_sandbox` อยู่พร้อมกัน (เห็นแถว `IMPORT`, `CREATE checkin`, `EXPORT` ของ user อื่นใน `audit_logs` ระหว่างช่วงเวลาเดียวกัน) จึง **ไม่ใช้ audit log เป็นหลักฐานว่าไม่มีการเขียน** แต่ใช้การเทียบแถวเป้าหมายโดยตรง (`updated_at`, ค่าฟิลด์, จำนวนแถว)

### 8.1 Guard ที่ยืนยันแล้ว 7 ตัว

| # | Guard (file:line) | คำขอที่ยิง | ผลที่สังเกตได้ | สภาพฐานข้อมูลหลังยิง |
|---|---|---|---|---|
| G1 | `resolveSchoolId` `school.routes.js:44-47` → predicate `:782` | `PUT /api/school/students/2` ด้วย token `syn_school_001` (SYNSCH001) — นักเรียน id 2 เป็นของ SYNSCH002 | **404** `ไม่พบนักเรียนในโรงเรียนนี้` | `students.id=2` `first_name`, `is_deleted=0`, `updated_at=2026-09-04 21:23:53` ไม่เปลี่ยน |
| G2 | เดียวกัน → predicate `:986` | `DELETE /api/school/students/2` | **404** ข้อความเดียวกัน | `is_deleted` ยังเป็น 0 |
| G3 | `resolveSchoolId` `:2101` → `checkin.service.js:1206-1213` (ใน `FOR UPDATE`) | `POST /api/school/checkin/7110/void` — log 7110 เป็นของนักเรียน SYNSCH002 | **404** `ไม่พบนักเรียนในโรงเรียนนี้` | `checkin_logs.id=7110` `status=CHECKED_OUT`, `checked_at` ไม่เปลี่ยน |
| G4 | `resolveSchoolId` `:1221` → `validateVehicleServesSchool` (`pickupPoint.service.js:584`) | `PUT /api/school/vehicles/V-SYN2e14ba3d3` — รถคันนี้รับส่งเฉพาะนักเรียน SYNSCH002 | **404** `ไม่พบรถคันนี้ในโรงเรียนของท่าน` | `vehicles.owner_name` และ `updated_at` ไม่เปลี่ยน |
| G5 | `resolveSchoolId` `:1860` → `studentTransfer.service.js:28` | `POST /api/school/students/2/transfer-request` (`destination_school_id=SYNSCH004` ซึ่งถูกต้อง เพื่อให้ผ่าน validation ไปถึงชั้น scope) | **403** `ไม่มีสิทธิ์ส่งคำขอสำหรับนักเรียนของโรงเรียนอื่น` | `student_transfer_requests` = 0 แถว ทั้งก่อนและหลัง |
| G6 | `getDriverVehicle` (`checkin.service.js:66`) → `checkin.service.js:1201-1205` | `POST /api/driver/checkin/7110/void` ด้วย token `syn_drv_0001` (driver_id 263 มี active assignment กับ `V-SYNc325ca7ae`) — log 7110 อยู่บน `V-SYN943417fd9` | **403** `รายการนี้ไม่ใช่ของรถคุณ` | log 7110 ไม่เปลี่ยน |
| G7 | `resolveAffiliationId` `affiliation.routes.js:164-167` → `affiliationAdmin.service.js:119-129` | `PUT /api/affiliation/school-accounts/560` ด้วย token `syn_aff_001` (SYNAFF01) — user 560 เป็นบัญชีของ SYNSCH003 ใต้ SYNAFF03 | **404** `ไม่พบบัญชีนี้ในสังกัด` | `users.id=560` `is_active=1`, `updated_at=2026-09-04 21:23:53` ไม่เปลี่ยน |

**ข้อสังเกตที่มีค่าจาก G6** — คำตอบเป็น **403 พร้อมข้อความว่า "ไม่ใช่ของรถคุณ"** ไม่ใช่ 404 แปลว่า handler อ่านแถวเจอจริงแล้วจึงปฏิเสธด้วยเงื่อนไข scope ไม่ใช่ปฏิเสธเพราะหาไม่เจอ — เป็นหลักฐานว่า predicate ทำงาน ไม่ใช่ว่า id ไม่มีอยู่

### 8.2 Positive control — พิสูจน์ว่า 403/404 ข้างบนมาจาก scope ไม่ใช่จาก endpoint พัง

| คำขอ | ผล |
|---|---|
| `GET /api/school/students?per_page=100` (school token) | 200, 41 แถว |
| `GET /api/driver/status-today` (driver token) | 200, `vehicle.id = V-SYNc325ca7ae` — ตรงกับ `driver_vehicle_assignments` แถวเดียวของ driver 263 ในฐานข้อมูล |
| `GET /api/affiliation/schools` (affiliation token) | 200, 4 แถว: `SYNSCH001, SYNSCH004, SYNSCH007, SYNSCH010` — ตรงกับ `SELECT id FROM schools WHERE affiliation_id='SYNAFF01'` พอดี |
| `GET /api/affiliation/school-accounts` (affiliation token) | 200, มี user 558 (SYNSCH001) |

### 8.3 Query spoof — scope จาก token ชนะ query parameter

`GET /api/school/students?school_id=SYNSCH002&per_page=100` ด้วย token `syn_school_001` คืน **41 แถว ชุดเดียวกันทุก id** กับคำขอที่ไม่ใส่ `school_id` เลย และสุ่มตรวจ 8 id แรก (271, 151, 31, 261, 141, 21, 351, 231) ในฐานข้อมูลได้ `school_id='SYNSCH001'` ครบทั้ง 8

ถ้อยคำที่ถูกคือ **ignored** ไม่ใช่ "ผลลัพธ์ว่าง" — ตรงกับที่ `threat-rbac-idor-review-2026-09-04.md` §4.3 ระบุไว้ และตรงกับ test ที่มีอยู่แล้ว (`backend/tests/crossSchoolIsolation.test.js:81`)

### 8.4 การซ่อนเมนูไม่ใช่ตัวควบคุม — พิสูจน์ด้วยการเรียก endpoint ที่ไม่มีเมนู

ข้อนี้ตอบ checkbox "ยืนยัน server-side scope ทุก query/write action ไม่พึ่งการซ่อนเมนู" (`master-project-closure-plan.md:202`) โดยตรง

| คำขอ | ผล | อ่านว่าอย่างไร |
|---|---|---|
| `GET /api/school/no-show` (school token) | **200** พร้อมข้อมูลจริง | หน้า `/school/missing` ถูกเปลี่ยนเป็น redirect และไม่มีเมนู แต่ API ยังทำงานเต็มรูปแบบ — **การถอดเมนูไม่ได้ปิด endpoint** |
| `GET /api/school/missing` (school token) | **200** | เช่นเดียวกัน |
| `GET /api/driver/search-students?q=…` (driver token) | **200** | ไม่มี UI ใดเรียก endpoint นี้ |
| `GET /api/admin/users` (school token) | **403** `You do not have permission to access this resource` | role guard ทำงานที่ server ไม่ใช่ที่เมนู |
| `GET /api/school/students` (driver token) | **403** ข้อความเดียวกัน | เช่นเดียวกัน |
| `GET /api/participation/cases` (school token) | **404** | router ที่ปิดด้วย flag ไม่ถูก mount จริง ไม่ใช่แค่ซ่อนเมนู (`app.js:196-198`) |

**สรุปของหัวข้อนี้**: การซ่อนเมนูไม่ได้ปิดอะไรเลย (สามแถวแรก) แต่การควบคุมสิทธิ์จริงอยู่ที่ role guard และ scope predicate ฝั่ง server (สามแถวหลัง) ซึ่งเป็นสภาพที่ถูกต้อง — พร้อมกันนั้นก็แปลว่า **ตัวเลข "จำนวนเมนู" ใน `menu-baseline` ใช้ประเมินพื้นผิวของ API ไม่ได้เลย**

### 8.5 บทบาทที่ถูกปฏิเสธที่ชั้น service ทั้งที่ matrix บอกว่าเรียกได้

ยืนยันข้อสรุปของ §3.4 ด้วยการยิงจริง:

| คำขอ | ผล | สภาพฐานข้อมูล |
|---|---|---|
| `GET /api/reports/policy` (school token) | **403** `เฉพาะส่วนกลาง/ผู้ดูแลระบบเท่านั้น` code `FORBIDDEN` | — (read) |
| `GET /api/reports/policy` (affiliation token) | **403** ข้อความเดียวกัน | — (read) |
| `GET /api/reports/daily` (school token) — control | **200** | พิสูจน์ว่า router `/api/reports` เข้าถึงได้จริงด้วย token เดียวกัน |
| `POST /api/reports/decision-log` (school token) | **403** `บทบาทนี้ไม่มีสิทธิ์บันทึกการตัดสินใจ` | `SELECT COUNT(*) FROM audit_logs WHERE entity_type='decision_log' AND user_id=558` = **0** ทั้งก่อนและหลัง |

### 8.6 Integration test ที่รันจริง

```
cd backend && npx jest --runInBand --testPathPattern "crossSchoolIsolation|exportSecurity|gradeScope"
→ Test Suites: 5 passed, 5 total   Tests: 75 passed, 75 total   Time: 3.285 s
   (crossSchoolIsolation, exportSecurity, gradeScope, gradeScopeCounts, reportGradeScope)
```

ตรงตาม exit evidence ของ A1-3 ใน `execution-plan-to-completion-2026-09-04.md:298` ซึ่งกำหนดว่า jest ต้องรายงาน suite ครบไม่ใช่ไฟล์เดียว — ที่นี่รายงาน 5 suite (มากกว่า 3 ไฟล์ที่แผนระบุ เพราะ pattern จับ `gradeScopeCounts` และ `reportGradeScope` ด้วย)

หมายเหตุการปฏิบัติงาน: คำสั่งนี้ค้างหลังเทสต์จบด้วย `Jest did not exit one second after the test run has completed` (open handle) เวลารวมที่กระบวนการอยู่คือหลายนาที ทั้งที่เทสต์ใช้เวลา 3.3 วินาที — ใครรันตามต้องรู้ว่านี่ไม่ใช่เทสต์ช้าหรือเทสต์ค้าง

---

## 9. สรุปสิ่งที่ตรวจแล้วในรอบนี้

| กลุ่ม | จำนวน | วิธีตรวจ | ผล |
|---|---:|---|---|
| id-addressed write ที่ mount จริง | 63 | อ่าน guard + เลขบรรทัดทุกรายการ (§4) | ทุกรายการที่บทบาทมี scope แคบเรียกได้ resolve scope จาก token; ที่เหลือเป็น admin/transport ซึ่งไม่มี scope แคบตามนิยาม (นิยามนี้รอ C0-2) |
| write ที่ระบุ resource จาก body | 33 | static token scan + อ่านด้วยมือ 3 รายการที่ตก (§5) | ไม่พบรายการที่รับ scope จาก body/query โดยไม่ derive ใหม่จาก token |
| id-addressed read ที่บทบาท scope แคบเรียกได้ | 10 | อ้างผลที่ `threat-rbac-idor-review-2026-09-04.md` §4.2 ตรวจไว้แล้ว — ตัวเลข 10 ตรงกับ matrix รอบนี้ | ไม่ตรวจซ้ำ |
| Sidebar → API (ทิศทาง A) | 74 เมนู | map ไป component แล้วเทียบ API (§7.1) | ไม่พบเมนูที่นำไปสู่ API ที่บทบาทนั้นเรียกไม่ได้ |
| API → UI (ทิศทาง B) | 249 route | ค้น literal ใน `frontend/src` (§7.2) | 30 route ไม่มีทางเข้าใน UI; ในนั้นไม่มี write ที่บทบาท scope แคบเรียกได้ |
| Guard ที่ยิงจริง | 7 scope guard + 4 positive control + 1 query spoof + 6 probe + 4 service-level role check | curl ไปยัง `127.0.0.1:3000` + ตรวจแถวใน DB (§8) | ทุกข้อปฏิเสธข้ามขอบเขต และไม่มีแถวเป้าหมายใดเปลี่ยน |
| RBAC matrix ที่ประกาศไว้ vs โค้ด | ตาราง `CLAUDE.md` §8 | เทียบราย cell กับ router graph (§3.5) | 3 ช่องไม่ตรงกับโค้ดปัจจุบัน + §5.8 ของ `CLAUDE.md` ขาด `/api/reports/policy` |

**ไม่พบ application defect ในรอบนี้** สิ่งที่พบทั้งหมดจัดกลุ่มได้เป็น:

- **ความคลาดเคลื่อนของเครื่องมือ audit** (§6.1, §6.2, §6.3) — ทำให้ `gaps=0` และป้าย auth ถูกอ่านผิดได้ แต่โค้ดที่บังคับสิทธิ์อยู่ถูกต้อง
- **ความคลาดเคลื่อนของเอกสาร** (§3.5) — `CLAUDE.md` §8 สามช่องและ §5.8 หนึ่งรายการล้าหลังโค้ด · ผู้ที่แก้ `CLAUDE.md` ได้ต้องเป็นผู้ดูแล spec ไม่ใช่งานรอบนี้ (`CLAUDE.md` §12 ข้อ 11 ห้ามแก้ schema/spec เองโดยไม่ถาม)
- **matrix รายงานเกินจริง** (§3.4) — เป็นข้อจำกัดที่มาจากวิธีวัด ไม่ใช่จากแอป การป้องกันซ้ำที่ชั้น service เป็นสิ่งที่ควรมี
- **ความไม่สม่ำเสมอของ UI** (§7.3) — backend ปฏิเสธถูกต้องอยู่แล้ว ทิศทางการแก้ขึ้นกับ C0-1

---

## 10. สิ่งที่เอกสารนี้ยังไม่ครอบคลุม

| รายการ | สถานะ |
|---|---|
| Regression test ต่อ logic decision C0-1 / C0-2 | **ยังทำไม่ได้** — เป็นครึ่งหนึ่งของ A1-3 ตาม `execution-plan-to-completion-2026-09-04.md:126` และขึ้นกับคำตอบที่ยังไม่มี |
| บัญชีครูประจำสายชั้น (grade scope) ยังไม่ได้ทดสอบจริง | **ยังไม่ได้ทดสอบ** — ในฐานข้อมูล sandbox มีบัญชีครูเพียงหนึ่งบัญชี (`syn_teacher_p4`, SYNSCH001, `ป.4`) และ `is_active = 0` ซึ่ง login ไม่ได้ (`auth.routes.js:160`) และถูก re-check ทุก request (`middleware/auth.js:76`) — **ไม่แก้ข้อมูลเพื่อให้ทดสอบได้** เพราะเป็น state ที่ agent อื่นอาจอ้างอิงอยู่ ต้องให้ผู้ดูแล sandbox เปิดใช้งานหรือ seed บัญชีใหม่ก่อน แล้วจึงทดสอบ `requireFullSchoolScope` และ `resolveGradeScope` จริง (Phase 8 กำหนดให้ต้องมีบัญชี "school teacher" — `master-project-closure-plan.md:240`) |
| `outputs/rbac-matrix/<run>/` ของ baseline รอบนี้ | **ยังไม่มี** — ผลดิบเขียนไว้นอก repository ตามข้อจำกัดของงานรอบนี้ ต้องให้ผู้มีสิทธิ์รันแล้วเก็บลง path จริงก่อนใช้เป็น evidence ปิด gate; run เก่าที่มีอยู่ (`outputs/rbac-matrix/20260904T044804Z/`) เป็น flag คนละชุด (routes 283) **ใช้แทนไม่ได้** |
| Route ที่ปิดด้วย flag (`participation`, `qr`, `consent`, `eta`, `geofence`, `route-deviation`, `registration`, `documents`) | ตรวจได้เฉพาะระดับ static ตาม §4.6 — **ยังไม่ได้ยิง request จริง** เพราะ backend ที่รันอยู่ปิด flag ทั้ง 10 ตัว ถ้า C0-4 ตัดสินให้เปิด flag ใด **ต้องรัน generator ทั้งสองใหม่ด้วยชุด flag ที่จะใช้จริงและทดสอบ §8 ซ้ำ** ก่อนอ้าง matrix นี้ |
| การพิสูจน์ว่า SQL predicate ถูกในทุก route | **ไม่ได้ทำ** — §8 พิสูจน์ 7 guard จาก 63 id-addressed write ที่เหลือเป็นการอ่าน source |
| หน้าจอจริง | **ไม่ได้เปิด browser** ในรอบนี้ — ผลของ §7 คือสิ่งที่โค้ดกำหนด ไม่ใช่สิ่งที่ผู้ใช้เห็น |
| Research export และ participation workflow | อยู่ในขอบเขตของ A1-11 (`threat-rbac-idor-review-2026-09-04.md` §5.2, §5.3) ไม่ทำซ้ำที่นี่ |

### 10.1 ข้อเสนอเชิงเครื่องมือ (ยังไม่ทำ ต้องมีคนรับผิดชอบก่อน)

สามข้อนี้จะทำให้ `gaps=0` มีน้ำหนักขึ้น — เสนอไว้เป็นรายการงาน ไม่ใช่การตัดสินใจ:

1. แยก `requireFullSchoolScope` ออกจาก `ORG_SCOPE_TOKENS` และเพิ่ม `schoolIdFor`, `schoolScope`, `driverUserId` เข้าไปแทน (แก้ §6.1, §6.2)
2. ขยาย `audit-scope-enforcement.js` ให้ตรวจ write ที่ไม่มี `:` ใน path ด้วย โดยแยกรายงานคนละกลุ่ม (แก้ §5)
3. เปลี่ยน `NON_ROLE_AUTH` จาก prefix เป็นราย route พร้อม assert ว่า guard ที่ประกาศไว้อยู่ในสาย middleware จริง (แก้ §6.3)

---

## 11. ค่าที่ยังเติมไม่ได้ ห้ามเดา

| ช่อง | ค่า |
|---|---|
| ครูประจำสายชั้นเช็กเด็กได้หรือไม่ และนิยาม check-in / check-out / absent / leave / override / void | **รอ C0-1** — เป็นตัวกำหนดว่า `requireFullSchoolScope` ควรอยู่บน route ใดบ้าง และ §7.3 ควรแก้ที่ UI หรือแก้ที่สิทธิ์ |
| เจ้าของการอนุมัติต่อประเภทคำขอ | **รอ C0-2** — matrix รอบนี้แสดงว่า transfer request และ vehicle request **อนุมัติได้ทั้งจาก affiliation และจาก admin** (`/api/affiliation/{transfer,vehicle}-requests/:id/approve` และ `/api/admin/{student-transfer,vehicle}-requests/:id/approve`) ซึ่งเป็นคิวสองชั้นที่ C0-2 ตั้งใจจะยุบ · และเป็นตัวกำหนดว่านิยาม "transport ไม่มี scope แคบ" ใน §4.5 ถูกหรือไม่ |
| ชุด feature flag ที่ถือเป็น RC | **รอ C0-4** — เป็นตัวกำหนดว่าตารางใดใน §3.2 คือ matrix ของรุ่นที่จะรับรอง ตัวเลขต่างกันมากถึง 43 route ระหว่างคอลัมน์แรกกับคอลัมน์สุดท้าย |
| 30 route ที่ไม่มีทางเข้าใน UI (§7.2) จะคงไว้ ถอด หรือทำ UI | **รอ C0-3** (target IA) และ **C0-13** (change governance) |
| เกณฑ์ความรุนแรงของ finding | **รอ C0-13** — เอกสารนี้ไม่ประกาศระดับความรุนแรงให้ข้อใด |

---

ตัวเลขและ matrix ในเอกสารนี้ผลิตจาก source ที่ commit `1b0c1a5` และจากการยิง request ไปยัง backend sandbox ที่รันอยู่ในเครื่อง (`127.0.0.1:3000`, runtime code เดียวกัน) ตามที่ระบุใน §1 · การเขียนที่เกิดขึ้นในการจัดทำเอกสารนี้มีเพียงคำขอที่ระบบปฏิเสธ (§8.1) ซึ่งตรวจสอบแล้วว่าไม่มีแถวใดเปลี่ยน และการรัน jest บน `lampang_bus_test` ซึ่งเป็นฐานข้อมูลใช้แล้วทิ้งตาม `backend/package.json:9` · ไม่มีการเข้าถึง production ไม่มี deploy ไม่มี migration และไม่มีการอ่านหรือเขียน `lampang_bus`
