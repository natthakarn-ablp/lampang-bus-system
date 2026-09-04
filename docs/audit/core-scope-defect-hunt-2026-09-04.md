# Core Scope Defect Hunt — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกผลการล่าข้อบกพร่องแบบ adversarial บน sandbox ตาม Phase 5 ข้อ 4 ของ `docs/project-closure/master-project-closure-plan.md`** — ไม่ใช่ UAT ไม่ใช่ sign-off และไม่ใช่การรับรองว่า Core scope ผ่าน exit gate

เอกสารนี้ **ไม่ใช่**:

- ไม่ใช่หลักฐานว่า Core scope §4.1 ไม่มี Critical/Major เหลืออยู่ — เป็นผลของสิ่งที่ผู้ตรวจลองในรอบเดียว ไม่ใช่การพิสูจน์ว่าไม่มีอย่างอื่น
- ไม่ใช่ผลการทดสอบบน production — ทุกคำสั่งชี้ที่ `lampang_bus_sandbox` เท่านั้น
- ไม่ใช่การตัดสิน Logic ที่ยังรอเจ้าของระบบ — ข้อที่ขึ้นกับ decision ค้าง เขียนว่า "รอ <id>" ไว้
- ไม่ใช่การอนุมัติให้ปิด defect ใด — severity ในเอกสารนี้เป็นข้อเสนอของผู้ตรวจตามนิยาม §5 ของ master plan เจ้าของระบบเป็นผู้ชี้ขาด

---

## 1. จุดที่ทดสอบ

| รายการ | ค่า |
|---|---|
| Repository | `D:/Projects/lampang-bus-work` (worktree) |
| Branch | `feat/tracking-security-hardening` |
| Commit ของ worktree | `1b0c1a5` |
| Commit ที่ backend รายงานผ่าน `/health` | `4b80b4b` (process เริ่มก่อน checkout สองคอมมิตสุดท้าย) |
| ความต่างที่กระทบผลทดสอบ | `git diff --stat 4b80b4b..HEAD -- backend/src frontend/src` คืน **0 ไฟล์** — สองคอมมิตหลังแตะเฉพาะ `docs/`, `scripts/`, `backend/tests/` ดังนั้น source ที่รันอยู่กับที่อ่านเป็นชุดเดียวกัน |
| Backend | `http://127.0.0.1:3000`, `NODE_ENV=test` |
| Database | `lampang_bus_sandbox` (MySQL 8.0 ใน container `lampang_mysql`) — 58 ตาราง ข้อมูลสังเคราะห์ |
| วันที่ตามนาฬิกาเครื่อง | 4 กันยายน 2569 (Bangkok) |
| Term ที่ระบบ derive ได้ ณ เวลาทดสอบ | `2569-1` (อ่านจาก `checkin_logs.term_id` ของรายการที่สร้างระหว่างทดสอบ; ตาราง `terms` ว่าง จึงตกไปใช้ convention ใน `term.service.js`) |

## 2. ข้อจำกัดที่ต้องอ่านคู่กับผลทุกข้อ

1. **มี agent อีกตัวใช้ sandbox เดียวกันพร้อมกัน** — `audit_logs` แสดง import batch 112–115 ที่สร้างและย้อนกลับนักเรียน id 361–366 โดย user 558 (`syn_school_001`) ระหว่างที่ผู้ตรวจกำลังยิง request อยู่ ผลคือจำนวนนักเรียนขยับระหว่างรอบ (เช่น ป.4 ของ SYNSCH001 เห็น 3 คนแล้วเหลือ 2 คนภายในไม่กี่นาที) **จึงย้ายไปใช้ fixture ของตัวเองที่ id 9001–9005 และ 9101–9104 ทั้งหมด** และตรวจสถานะจากฐานข้อมูลก่อนและหลังทุกครั้ง ไม่อ้างสถานะที่ไม่ได้อ่านเอง
2. **Feature flag ปิดหมดบน sandbox** — `/api/participation`, `/api/qr`, `/api/eta`, `/api/geofences`, `/api/consent`, `/api/{driver,school}/registrations`, `/api/documents` และ `/api/auth/recovery/admin/*` ตอบ 404 ทั้งหมด จึงประเมินโมดูลเหล่านี้ไม่ได้ในรอบนี้ (§7)
3. **MySQL ใน container ตั้ง system timezone เป็น +07:00 อยู่แล้ว** — ต่างจากที่ comment ใน `backend/src/config/database.js:8-15` อธิบายไว้ว่า production รัน UTC ข้อบกพร่องที่จะโผล่เฉพาะเมื่อ DB server เป็น UTC จึงไม่ reproduce ที่นี่ (pool ยัง pin `+07:00` ให้ทุก connection อยู่ ผลจึงควรเหมือนกัน แต่ยังไม่ได้พิสูจน์บน DB ที่เป็น UTC จริง)
4. **ไม่ได้ทดสอบข้ามเที่ยงคืนเวลาไทยบนนาฬิกาจริง** — เวลาที่ทดสอบคือ 22:2x–22:5x น. ช่วง 00:00–07:00 ซึ่งเป็นช่วงเสี่ยงของ off-by-one ไม่ได้ถูกแตะ ต้องทดสอบซ้ำในช่วงเวลานั้นหรือด้วยนาฬิกาที่ควบคุมได้ (§7)
5. **LINE channel ไม่ได้ตั้งค่า** — แถวใน `notifications` ที่พบเป็นคิวรอส่ง (`sent = 0`) การส่งจริงยังพิสูจน์ไม่ได้ในสภาพแวดล้อมนี้
6. **Rate limit ของ login** — `backend/src/routes/auth.routes.js:55-57` อนุญาต 20 ครั้ง/IP/15 นาที และไม่มี test skip จึง login รวมทั้งงาน 11 ครั้งแล้ว reuse token ตลอด

## 3. วิธีการ

- Login หนึ่งครั้งต่อบัญชีแล้วใช้ token ซ้ำ: `syn_admin`, `syn_province`, `syn_aff_001`, `syn_aff_002`, `syn_transport`, `syn_school_001`, `syn_school_002`, `syn_drv_0001`, `syn_drv_0002` และบัญชีครูประจำสายชั้นที่สร้างระหว่างทดสอบ
- สร้าง route inventory จาก router graph จริงด้วย `backend/scripts/generate-rbac-matrix.js` (249 routes) ไม่ใช่จากการ grep ไฟล์ route แล้วยิงทุก route ด้วย token ของบทบาทที่ **ไม่มีสิทธิ์**
  - GET ที่ไม่มี path param: **415 การเรียก** — ปฏิเสธ (401/403) ทั้งหมด ยกเว้น 5 รายการที่ตอบ 404 เพราะ feature flag ปิด
  - POST/PUT/DELETE ที่ไม่มี path param: **178 การเรียก** — ปฏิเสธทั้งหมด ยกเว้น 15 รายการที่ตอบ 404 เพราะ feature flag ปิด
- ทดสอบ IDOR เฉพาะจุดที่มี `:id` ด้วย resource ที่ **เป็นของ scope อื่นจริง ๆ** (สร้าง fixture ให้ scope หนึ่ง แล้วยิงด้วย token ของอีก scope)
- ทดสอบเช็กอิน/เช็กเอาต์/override/void/ซ้ำ/ข้ามโรงเรียน/ข้ามรถ ผ่าน HTTP จริง แล้วอ่านผลจาก `checkin_logs`, `daily_status`, `notifications`, `audit_logs` ด้วย SQL ตรง ไม่เชื่อ response อย่างเดียว
- ทดสอบ concurrency ด้วย HTTP request ที่ยิงพร้อมกันจริง (`Promise.all`) พร้อม **control แบบเรียงลำดับ** เสมอ เพื่อแยกว่าเป็นผลของจังหวะเวลา ไม่ใช่ของ payload
- ทดสอบ export scope ด้วยการ parse CSV ทั้งไฟล์ (รอบแรกอ่านผิดเพราะ harness ของผู้ตรวจตัด response ที่ 4,000 ตัวอักษร แก้แล้วยิงใหม่ ดู §6 ข้อ 6)

## 4. สรุปผล

| รหัส | ระดับที่เสนอ | เรื่อง | โมดูล |
|---|---|---|---|
| **CS5-01** | **Critical** | หลัง void รายการที่บันทึกผิดคน ปุ่ม "ส่งนักเรียนทั้งหมด" บันทึกว่าเด็กคนนั้นถูกส่งลงแล้ว และคิวแจ้งผู้ปกครอง | เช็กอิน/เช็กเอาต์ |
| **CS5-02** | **Critical** | วันหมดอายุประกันของรถถอยหลัง 1 วันทุกครั้งที่กด "แก้ไขข้อมูลรถ" แม้ไม่แตะช่องวันที่ | ข้อมูลรถ |
| **CS5-03** | **Major** | เมื่อ void รายการหนึ่งของรอบแล้ว รายการคู่ในรอบเดียวกันจะ void ไม่ได้อีกเลย ทั้งคนขับ โรงเรียน และ admin | เช็กอิน/เช็กเอาต์ |
| **CS5-04** | **Major** | กลไกกันกดซ้ำเป็นแบบอ่านแล้วค่อยเขียน จึงไม่กันการกดพร้อมกัน — เช็กอินซ้ำ 3 แถว พร้อมคิวแจ้งผู้ปกครอง 3 ครั้ง และเหตุฉุกเฉินซ้ำ 3 แถว | เช็กอิน / ฉุกเฉิน |
| **CS5-05** | **Major** | คำขอส่งตรวจรถนับผู้โดยสารเฉพาะนักเรียนที่ `term_id` ตรงกับภาคเรียนที่ derive ได้ ทำให้ยอดผู้โดยสารบนคำขอต่ำกว่าความจริง และบางกรณีส่งคำขอไม่ได้เลย | ตรวจรถ/ขนส่ง |
| **CS5-06** | **Major** | ประวัติ import แสดงว่า "ผู้ปกครองเปลี่ยน" ทุกแถวของทุก batch รวมถึงนักเรียนที่เพิ่งเพิ่มใหม่ | นำเข้าข้อมูล |
| CS5-07 | Minor | `:id` ที่ไม่ใช่ตัวเลขทำให้ตอบ HTTP 500 พร้อมข้อความ error ของ SQL | คำขอรถ/โอนย้าย |

พบ **Critical 2 ข้อ, Major 4 ข้อ, Minor 1 ข้อ** ทุกข้อทำซ้ำได้และมีสถานะฐานข้อมูลก่อนและหลังกำกับ

---

## 5. รายละเอียดข้อบกพร่อง

### CS5-01 · Critical · หลัง void แล้ว "ส่งนักเรียนทั้งหมด" บันทึกการส่งเด็กที่ไม่ได้ขึ้นรถ

**Route / Role** `POST /api/driver/checkin` → `POST /api/driver/checkin/:logId/void` → `POST /api/driver/checkout-all` (บทบาท `driver`)

**หน้าจอที่เข้าถึงได้จริง** ปุ่ม "ส่งนักเรียนทั้งหมด" อยู่ที่ `frontend/src/pages/driver/DriverDashboard.jsx:214-226`

**ขั้นตอนที่ทำซ้ำได้** (fixture: นักเรียน id 9104 โรงเรียน SYNSCH001 รถ `V-SYNc325ca7ae` ผูก LINE ผู้ปกครองไว้)

1. `POST /api/driver/checkin {student_id: 9104, session: "evening"}` → 201, `checkin_logs` id 7158 สถานะ `CHECKED_IN`, คิวแจ้งผู้ปกครอง `notifications` id 83 (`checkin`)
2. `POST /api/driver/checkin/7158/void {reason: "บันทึกผิดคน ยกเลิกรายการ"}` → 201 เขียนแถวชดเชย id 7159 สถานะ `CANCELLED` และรีเซ็ต `daily_status.evening_done = 0` ถูกต้อง
3. `POST /api/driver/checkout-all {session: "evening"}` → 201 `succeeded: [{log_id: 7160, student_id: 9104, status: "CHECKED_OUT"}]`

**ผลที่ควรได้** เด็กที่รายการขึ้นรถถูกยกเลิกไปแล้ว ต้องไม่อยู่ในชุดที่ "ส่งลง" ได้

**ผลที่ได้จริง** (อ่านจาก SQL หลังขั้นตอนที่ 3)

| ตาราง | ค่า |
|---|---|
| `checkin_logs` ของ 9104 วันนี้ | 7158 `CHECKED_IN` · 7159 `CANCELLED` · **7160 `CHECKED_OUT`** |
| `daily_status.evening_done` | กลับเป็น **1** |
| `notifications` | id 83 `checkin` · **id 84 `checkout`** ทั้งคู่จ่อคิวไปที่ LINE ของผู้ปกครองรายเดิม |

คือระบบบันทึกว่า "ส่งเด็กลงที่บ้านแล้ว" และเตรียมแจ้งผู้ปกครองเช่นนั้น สำหรับเด็กที่ไม่เคยขึ้นรถและรายการขึ้นรถถูกยกเลิกไปแล้ว ตรงกับนิยาม Critical "check-in/out ผิดคน" ใน master plan §5

**ตำแหน่งโค้ดที่รับผิดชอบ** `backend/src/services/checkin.service.js:608-616`

```
    `SELECT DISTINCT ci.student_id AS id
       FROM checkin_logs ci
      WHERE ci.vehicle_id = ? AND ci.session = ? AND ci.check_date = CURDATE()
        AND ci.status = 'CHECKED_IN'
        AND NOT EXISTS (
          SELECT 1 FROM checkin_logs co
           WHERE co.student_id = ci.student_id AND co.session = ci.session
             AND co.check_date = CURDATE() AND co.status = 'CHECKED_OUT')`,
```

คิวรีนี้เลือกจาก `checkin_logs` โดยตรงและ **ไม่ตัดแถวที่มีแถวชดเชย `CANCELLED` ตามหลัง** ขณะที่ตัวเขียน void ที่ `checkin.service.js:1238-1256` ออกแบบให้ `CANCELLED` เป็นแถวกลับรายการ และรีเซ็ตเฉพาะ `daily_status` เท่านั้น เส้นทางพี่น้องกัน `processCheckinAll` (`checkin.service.js:541-552`) อ่านจาก `daily_status` จึงถูกต้อง — ความไม่ตรงกันระหว่างสองเส้นทางนี้คือตัวปัญหา

**ผลข้างเคียงจากรากเดียวกัน** `getNoShowStudents` (`checkin.service.js:1127-1129`) ใช้เงื่อนไข `NOT EXISTS (... status = 'CHECKED_IN')` แบบเดียวกัน ผลคือ `GET /api/school/no-show` ไม่คืนเด็กกลับเข้ารายการ "ไม่ขึ้นรถ" หลัง void ขณะที่ `GET /api/school/missing` (ซึ่งอ่าน `daily_status`, `backend/src/routes/school.routes.js:537-554`) คืนกลับถูกต้อง — ยืนยันด้วย fixture 9101: หลัง void `missing` = `[9101, 9102, 9103]` แต่ `no-show` = `[9102, 9103]` ปัจจุบัน `no-show` ยังไม่มีหน้าจอ frontend เรียกใช้ (`grep -rn "no-show" frontend/src` ไม่พบ) จึงยังไม่มีผลที่ผู้ใช้เห็น แต่เป็นรากเดียวกันและจะโผล่ทันทีที่ต่อหน้าจอ

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร**

- ทั้งสามขั้นตอนเป็น HTTP request ปกติผ่าน token ของคนขับตัวจริง ไม่มีการเขียน DB ตรงระหว่างขั้นตอน
- หลักฐานคือแถวใน `checkin_logs`, `daily_status`, `notifications` ที่อ่านด้วย SQL หลังจบ ไม่ใช่การอ่านจาก response
- ทำซ้ำสองครั้งด้วย fixture คนละตัว (9101 ไม่ผูก LINE, 9104 ผูก LINE) ได้ผลเหมือนกัน
- `checkout-all` ในรอบนี้กระทบเฉพาะ fixture ของผู้ตรวจ — ตรวจ blast radius ด้วย SQL ก่อนยิง พบว่ามีเฉพาะ id 9001, 9002, 9101, 9103 เข้าเงื่อนไข

---

### CS5-02 · Critical · วันหมดอายุประกันถอยหลังวันละ 1 วันทุกครั้งที่บันทึกหน้าแก้ไขรถของโรงเรียน

**Route / Role** `GET /api/school/vehicles` → `PUT /api/school/vehicles/:id` (บทบาท `school` บัญชีเต็ม)

**หน้าจอ** `frontend/src/pages/school/VehicleList.jsx` ปุ่ม "แก้ไขข้อมูลรถ"

**สาเหตุ** คอลัมน์ชนิด `DATE` ถูกส่งออกทาง API เป็น instant ISO ไม่ใช่วันที่ปฏิทิน: mysql2 ตั้ง `timezone: '+07:00'` (`backend/src/config/database.js:16-26`) จึงอ่าน `2026-08-05` เป็นเที่ยงคืนตามเวลาไทย แล้ว `JSON.stringify` ได้ `"2026-08-04T17:00:00.000Z"` ฝั่งหน้าจอตัดสิบตัวแรกของสตริงนั้นมาใส่ช่องวันที่:

- `frontend/src/pages/school/VehicleList.jsx:47` — `insurance_expiry: v.insurance_expiry ? String(v.insurance_expiry).slice(0, 10) : ''`
- `frontend/src/pages/school/VehicleList.jsx:51-58` — `handleSaveEdit` ส่ง `editForm` ทั้งก้อนกลับด้วย `PUT`
- `backend/src/routes/school.routes.js:1249-1253` — เก็บค่าที่ส่งมาตามตรง
- ฝั่ง service ที่คืนค่าออกไปดิบ: `backend/src/services/school.service.js:288-290`

โค้ดชุดเดียวกันมีทางที่ถูกอยู่แล้วในระบบ: `backend/src/routes/driver.routes.js:748` ใช้ `dateOnly()` (`driver.routes.js:49-53`) ครอบก่อนส่งออก จึงคืน `"2026-09-19"` เป็นสตริงวันที่ และเส้นทาง `PUT /api/driver/profile` ไม่เพี้ยน — ยืนยันด้วยการทำ round trip เดียวกันบนรถ `V-SYN2e14ba3d3` แล้วค่าใน DB ไม่ขยับ ทั้งระบบมีจุดที่เรียก `dateOnly` ตอนส่ง response อยู่ **จุดเดียวเท่านั้น**

**ขั้นตอนที่ทำซ้ำได้** (รถ `V-SYNc325ca7ae` ค่าตั้งต้นใน DB `insurance_expiry = 2026-08-05`) ทำซ้ำสามรอบ แต่ละรอบทำสิ่งที่หน้าจอทำเป๊ะ ๆ คือ อ่าน `GET /api/school/vehicles` → เอาค่าที่ได้เข้าสูตร `String(x).slice(0,10)` → `PUT` กลับ **โดยไม่แตะช่องวันที่**

| รอบ | ค่าที่ API คืน | ค่าที่ตกลงในช่องฟอร์ม | ค่าใน DB หลังบันทึก |
|---|---|---|---|
| ก่อนเริ่ม | — | — | `2026-08-05` |
| 1 | `2026-08-04T17:00:00.000Z` | `2026-08-04` | `2026-08-04` |
| 2 | `2026-08-03T17:00:00.000Z` | `2026-08-03` | `2026-08-03` |
| 3 | `2026-08-02T17:00:00.000Z` | `2026-08-02` | `2026-08-02` |

**ผลที่ควรได้** บันทึกฟอร์มโดยไม่แก้ช่องวันที่ ต้องไม่เปลี่ยนวันหมดอายุ

**ผลที่ได้จริง** ถอยหลังหนึ่งวันต่อการบันทึกหนึ่งครั้ง สะสมไปเรื่อย ๆ โดยไม่มีสัญญาณเตือน

**ทำไมเสนอเป็น Critical** `insurance_expiry` ไม่ใช่ข้อความประกอบ แต่เป็นตัวตัดสินใน `computeEligibility` (`backend/src/services/vehicleVerification.service.js:68-83`) ซึ่งกำหนด `verification_status` ของรถ และเป็นตัวตั้งของ `GET /api/affiliation/vehicles-at-risk` กับหน้าขนส่ง การแก้ข้อมูลรถตามปกติจึงกัดกร่อนข้อมูลที่ระบบใช้ตัดสินความปลอดภัยของรถ ตรงกับ "ข้อมูลจริงเสีย" ใน master plan §5 — ถ้าเจ้าของระบบเห็นว่าควรเป็น Major เพราะไม่ใช่ข้อมูลเด็ก ก็เป็นการชี้ขาดที่รับได้ แต่กลไกการเสียหายเป็นแบบเงียบและสะสม

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร**

- ค่าที่ใส่กลับไม่ได้ถูกผู้ตรวจแต่งขึ้น แต่คำนวณจากสตริงที่ API คืนมาจริง ด้วยสูตรบรรทัดเดียวกับที่อยู่ใน `VehicleList.jsx:47` และส่ง object รูปเดียวกับที่ `handleSaveEdit` ส่ง
- ค่าก่อนและหลังอ่านจาก MySQL ตรง ไม่ผ่าน API
- มี control ที่ให้ผลตรงข้ามในระบบเดียวกัน: เส้นทาง `/api/driver/profile` ซึ่งครอบ `dateOnly()` ไว้ ทำ round trip เดิมแล้วค่าไม่ขยับ
- คืนค่า `insurance_expiry` กลับเป็น `2026-08-05` แล้วหลังทดสอบ

---

### CS5-03 · Major · void รายการหนึ่งของรอบแล้ว รายการคู่ในรอบเดียวกัน void ไม่ได้อีกเลย

**Route / Role** `POST /api/driver/checkin/:logId/void`, `POST /api/school/checkin/:logId/void`, `POST /api/admin/checkin/:logId/void`

**ขั้นตอนที่ทำซ้ำได้** (fixture 9102 รถ `V-SYNc325ca7ae`)

1. `POST /api/driver/checkin {student_id: 9102, session: "evening"}` → log 7149 `CHECKED_IN`
2. `POST /api/driver/checkout {student_id: 9102, session: "evening"}` → log 7150 `CHECKED_OUT`
3. `POST /api/driver/checkin/7150/void` → 201 เขียนแถวชดเชย 7151 `CANCELLED`
4. `POST /api/driver/checkin/7149/void` → **409** `รายการนี้ถูกยกเลิกไปแล้ว` (`ALREADY_VOIDED`)
5. `POST /api/school/checkin/7149/void` → **409** เหมือนกัน
6. `POST /api/admin/checkin/7149/void` → **409** เหมือนกัน

**ผลที่ควรได้** log 7149 ยังไม่เคยถูกยกเลิก ต้องยกเลิกได้ อย่างน้อยต้องมีบทบาทหนึ่งที่แก้ไขได้

**ผลที่ได้จริง** ไม่มีบทบาทใดยกเลิกได้ แถว `CHECKED_IN` ที่บันทึกผิดคงอยู่ในประวัติอย่างถาวรในสถานะที่ยังมีผล

**ตำแหน่งโค้ดที่รับผิดชอบ** `backend/src/services/checkin.service.js:1216-1227`

```
    // 3. Idempotency: reject if a CANCELLED compensating row for this
    //    student/session/date was already written AFTER the target log.
    const [dupVoid] = await conn.query(
      `SELECT id FROM checkin_logs
        WHERE student_id = ? AND session = ? AND check_date = ?
          AND status = 'CANCELLED' AND id > ?
        LIMIT 1`,
      [log.student_id, log.session, log.check_date, log.id]
    );
```

เงื่อนไข `id > ?` จับ **แถว `CANCELLED` ใด ๆ ที่มี id สูงกว่า** ไม่ใช่แถวที่ชดเชย log นี้จริง เมื่อรอบหนึ่งมีสอง log (ขึ้นรถและลงรถ) การ void ตัวใดตัวหนึ่งจะสร้างแถว `CANCELLED` ที่ id สูงกว่าทั้งคู่เสมอ อีกตัวจึงถูกปฏิเสธตลอด ตารางไม่มีคอลัมน์ที่ชี้ว่าแถวชดเชยนี้ชดเชย log ไหน

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร** ทำซ้ำสองครั้งด้วย fixture คนละตัว (361 และ 9102) และยิงจากสามบทบาทที่ใช้คนละ route กันแต่เรียก `voidCheckin` ตัวเดียวกัน ได้ 409 พร้อม code `ALREADY_VOIDED` ทุกครั้ง ขณะที่ `checkin_logs` แสดงว่า log เป้าหมายยังเป็น `CHECKED_IN` และไม่มีแถวชดเชยที่อ้างถึงมัน

---

### CS5-04 · Major · กลไกกันกดซ้ำไม่ปลอดภัยเมื่อกดพร้อมกัน (เช็กอิน และเหตุฉุกเฉิน)

**Route / Role** `POST /api/driver/checkin` และ `POST /api/driver/emergency` (บทบาท `driver`) และ `POST /api/school/checkin-override` (บทบาท `school`)

**ขั้นตอนที่ทำซ้ำได้ พร้อม control**

| กรณี | วิธียิง | ผล |
|---|---|---|
| เช็กอินซ้ำ แบบเรียงลำดับ (control) | ยิงครั้งที่ 2 หลังครั้งที่ 1 ตอบกลับ | ครั้งที่ 2 = **409** `รายการนี้ถูกบันทึกไปแล้ว` เกิด 1 แถว 1 คิวแจ้งเตือน |
| เช็กอินซ้ำ แบบพร้อมกัน 3 ครั้ง (fixture 9005 ผูก LINE) | `Promise.all` 3 request เหมือนกันทุกไบต์ | **201 ทั้งสาม** → `checkin_logs` 7143, 7144, 7145 ทั้งหมด `CHECKED_IN` รอบเดียวกัน และ `notifications` 79, 80, 81 คิวไปหาผู้ปกครองคนเดียวกันสามใบ |
| เช็กอินซ้ำ แบบพร้อมกัน 5 ครั้ง (fixture 9003) | `Promise.all` 5 request | 201 ทั้งห้า → 5 แถว `CHECKED_IN` |
| คนขับเช็กอิน + โรงเรียนยืนยันแทน พร้อมกัน (fixture 9002) | `Promise.all` 2 request คนละบทบาท | 201 ทั้งคู่ → log 7135 (โรงเรียน) และ 7136 (คนขับ) การขึ้นรถครั้งเดียวถูกบันทึกโดยผู้กระทำสองคน |
| เหตุฉุกเฉินซ้ำ แบบเรียงลำดับ (control) | ยิง 3 ครั้งเรียงกัน | ครั้งที่ 2 และ 3 ตอบ 200 `duplicate: true` อ้าง id เดิม เกิด **1 แถว** |
| เหตุฉุกเฉินซ้ำ แบบพร้อมกัน 3 ครั้ง | `Promise.all` 3 request เหมือนกัน | **201 ทั้งสาม `duplicate: false`** → `emergency_logs` 36, 37, 38 เวลาเดียวกัน เนื้อหาเดียวกัน |

**ผลที่ควรได้** ตามที่โค้ดตั้งใจไว้เอง `backend/src/services/emergency.service.js:4-14` เขียนว่ากลไกนี้มีไว้เพราะปุ่มฉุกเฉินคือสิ่งที่คนขับที่กำลังตกใจจะกดรัว และเพราะการเชื่อมต่อมือถือที่ไม่นิ่งจะ retry POST เดิม — ทั้งสองกรณีคือการยิงพร้อมกัน ซึ่งเป็นกรณีที่กลไกไม่ครอบคลุม

**ผลที่ได้จริง** กันได้เฉพาะการกดซ้ำที่ห่างพอให้ธุรกรรมแรก commit ก่อน

**ตำแหน่งโค้ดที่รับผิดชอบ**

- `backend/src/services/checkin.service.js:334-358` — `SELECT ... FROM checkin_logs WHERE student_id = ? AND session = ? AND check_date = CURDATE() ORDER BY id DESC LIMIT 1` แล้วค่อย `INSERT` ไม่มี `FOR UPDATE` และไม่มี lock บนคีย์ทางธุรกิจ
- `backend/src/services/emergency.service.js:51-65` — รูปแบบเดียวกัน อ่านแล้วค่อยเขียน
- ระดับ schema: `checkin_logs` ไม่มี unique key บน `(check_date, student_id, session)` และ `emergency_logs` ไม่มี unique key ที่เทียบเท่า จึงไม่มีด่านสุดท้ายที่ฐานข้อมูลจะจับให้ (`daily_status` มี `uk_ds_date_student` จึงไม่ซ้ำ — นี่คือเหตุผลที่ `daily_status` รอด แต่ `checkin_logs` ไม่รอด)
- `POST /api/school/checkin-override` ตรวจ `daily_status` ก่อนเข้าธุรกรรม (`checkin.service.js:792-812`) การตรวจนี้อยู่นอก transaction จึงแข่งกับเส้นทางคนขับได้

**สิ่งที่ชุดทดสอบเดิมมองไม่เห็น** `backend/tests/emergencyDoubleTap.test.js` ยิงสอง request แบบ `await` เรียงกัน จึงผ่านเสมอ ไม่มี test ใดในชุดยิงพร้อมกัน

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร** ทุกกรณีมี control แบบเรียงลำดับที่ใช้บัญชี endpoint payload และ fixture ชุดเดียวกัน ต่างกันแค่จังหวะ — control ให้ 409 หรือ `duplicate: true` อย่างถูกต้อง ส่วนแบบพร้อมกันให้แถวซ้ำ หลักฐานคือแถวใน `checkin_logs`, `emergency_logs`, `notifications` ที่อ่านด้วย SQL

---

### CS5-05 · Major · คำขอส่งตรวจรถนับผู้โดยสารด้วย term filter ที่ไม่มีการ re-stamp

**Route / Role** `POST /api/verification/school/applications` (บทบาท `school` บัญชีเต็ม)

**ขั้นตอนที่ทำซ้ำได้ โดยสลับตัวแปรเดียว** รถ `V-SYN2e14ba3d3` มีนักเรียนของ SYNSCH002 ใช้บริการอยู่ 8 คน (เช้า 7 เย็น 5) ทั้งหมดมี `term_id = '2568-2'`

| สถานะ | สิ่งที่เปลี่ยน | ผลของ `POST /api/verification/school/applications {vehicle_id: "V-SYN2e14ba3d3"}` |
|---|---|---|
| A | `students.term_id = '2568-2'` ทุกคน | **403** `โรงเรียนนี้ไม่มีนักเรียนที่ใช้รถคันดังกล่าว` (`SCHOOL_NOT_RELATED_TO_VEHICLE`) |
| B | เปลี่ยน `term_id` ของนักเรียน **หนึ่งคน** เป็น `'2569-1'` ไม่แตะอย่างอื่น | **201** สร้างคำขอ `VIA-20260904-FC407D` |

คำขอที่สร้างในสถานะ B บันทึก `rider_summary_json` เป็น

```
{"schools": [{"school_id": "SYNSCH002", ..., "peak_rider_count": 1, "evening_rider_count": 1, "morning_rider_count": 1}],
 "total_schools": 1, "peak_rider_count": 1, "evening_rider_count": 1, "morning_rider_count": 1}
```

ขณะที่ความจริงคือ 8 คน (เช้า 7 เย็น 5)

**ผลที่ควรได้** เอกสารส่งตรวจต้องสะท้อนจำนวนเด็กที่ใช้รถจริงและโรงเรียนที่ใช้รถร่วมกันจริง

**ผลที่ได้จริง** นับเฉพาะเด็กที่ `term_id` ตรงกับภาคเรียนที่ derive จากปฏิทิน จำนวนที่ปรากฏบนคำขอจึงต่ำกว่าความจริง และในสถานะ A ส่งคำขอไม่ได้เลยพร้อมข้อความที่บอกสาเหตุผิด (บอกว่าไม่มีนักเรียนใช้รถคันนี้ ทั้งที่มี 8 คน)

**ทำไมสำคัญ** `peak_rider_count` ที่ถูก freeze ไว้บนคำขอ คือค่าที่นำไปเทียบกับ `certified_capacity` ใน `computeEligibility` (`backend/src/services/vehicleVerification.service.js:80-83` เรียกจาก `:863-870` ตอนปิดผลตรวจ) การนับต่ำกว่าจริงทำให้เงื่อนไข `CAPACITY_EXCEEDED` ไม่ทำงานตามที่ตั้งใจ

**ตำแหน่งโค้ดที่รับผิดชอบ**

- `backend/src/services/vehicleVerification.service.js:268-278` — เงื่อนไขความเกี่ยวข้องโรงเรียนกับรถ `AND (term_id = ? OR term_id IS NULL)`
- `backend/src/services/vehicleVerification.service.js:296-308` — คิวรีนับผู้โดยสารต่อโรงเรียน ใช้ filter เดียวกัน
- `backend/src/services/vehicleVerification.service.js:251` — `currentTerm` มาจาก `getCurrentTerm(pool)`
- `backend/src/services/term.service.js:36-61` — เมื่อ `terms` ว่าง ภาคเรียนถูก derive จากปฏิทินล้วน (`2026-09-04` → `2569-1`; ข้าม 11 ต.ค. จะกลายเป็น `2569-2` ทันที)
- `students.term_id` ถูกเขียน **เฉพาะตอน INSERT** เท่านั้น (`backend/src/routes/school.routes.js:1646`, `backend/src/services/studentImportPreview.service.js:444` และ `:545`, `backend/src/services/rosterRequest.service.js:329`, `backend/src/services/studentTransfer.service.js:130`) ไม่มีจุดใดในระบบ re-stamp เมื่อขึ้นภาคเรียนใหม่

**Logic ที่ต้องให้เจ้าของระบบชี้ขาด** โรงเรียนต้องนำเข้ารายชื่อใหม่ทุกภาคเรียนหรือไม่ ถ้าใช่ ระบบต้องบอกสาเหตุที่แท้จริงและมีทางแก้ให้ผู้ใช้ ถ้าไม่ใช่ การนับผู้โดยสารต้องเลิกผูกกับ `term_id` — **รอ C0-2** (เจ้าของการอนุมัติ roster/registration และ vehicle inspection) เอกสารนี้ไม่เลือกทางให้

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร** สลับเฉพาะค่า `students.term_id` ของนักเรียนหนึ่งคน โดยไม่แตะ payload ไม่แตะบัญชี ไม่แตะรถ แล้วผลพลิกจาก 403 เป็น 201 จำนวนผู้โดยสารจริงนับจาก `students` ด้วย SQL แยกต่างหาก และตัวเลขบนคำขออ่านจาก `vehicle_inspection_applications.rider_summary_json` ตรง

---

### CS5-06 · Major · ประวัติ import แสดงว่า "ผู้ปกครองเปลี่ยน" ทุกแถวของทุก batch

**Route / Role** `GET /api/school/students/import/:batchId` และ `GET /api/school/students/import/:batchId/report` (บทบาท `school` บัญชีเต็ม)

**ขั้นตอนที่ทำซ้ำได้** นำเข้าไฟล์ CSV สองแถวเป็นนักเรียนใหม่ทั้งคู่ที่ยังไม่มีผู้ปกครองเดิมในระบบ (batch 118 ของ SYNSCH002)

| ขั้น | ผล |
|---|---|
| `POST /students/import/preview` | แต่ละแถวคืน `guardian_current: null`, `guardian_input: "ผู้ปกครองนำเข้าหนึ่ง"`, **`guardian_mismatch: false`** ← ถูกต้อง |
| `POST /students/import/118/apply` | `applied: 2` |
| `GET /students/import/118/report` | ทุกแถว **`guardian_mismatch: "yes"`** |
| `GET /students/import/118` | ทุกแถว **`guardian_mismatch: true`** พร้อม `guardian_current: null`, `guardian_input: null` |
| ตรวจฐานข้อมูล | `SELECT guardian_diff_json, guardian_diff_json IS NULL, JSON_TYPE(guardian_diff_json) FROM import_batch_rows WHERE batch_id = 118` → ค่า `null`, `IS NULL` = **0**, `JSON_TYPE` = `NULL` |

**ผลที่ควรได้** แถวที่ไม่มีการเปลี่ยนผู้ปกครองต้องไม่ถูกทำเครื่องหมายว่าเปลี่ยน

**ผลที่ได้จริง** ทุกแถวถูกทำเครื่องหมายว่าเปลี่ยน หน้าจอ `frontend/src/pages/school/ImportHistoryModal.jsx:213-217` จึงขึ้นบรรทัด "ผู้ปกครอง: — → —" ใต้ทุกแถวของทุก batch

**ตำแหน่งโค้ดที่รับผิดชอบ** `backend/src/services/studentImportPreview.service.js:266`

```
         JSON.stringify(r.guardian_mismatch ? { current: r.guardian_current, input: r.guardian_input } : null),
```

`JSON.stringify(null)` คืนสตริง `'null'` ไม่ใช่ SQL NULL คอลัมน์ `guardian_diff_json` (ผ่าน `CAST(? AS JSON)`) จึงเก็บ JSON literal `null` ซึ่ง **ไม่ใช่ SQL NULL** ทำให้เงื่อนไข `(guardian_diff_json IS NOT NULL) AS guardian_mismatch` ที่ `:611` (report) และ `:662` (batch detail) เป็นจริงทุกแถว

**ทำไมเสนอเป็น Major** master plan §4.1 นับ "ประวัติ import" เป็น Core scope และ §5 นิยาม Major ว่ารวม "report ผิด" รายงานนี้กล่าวข้อเท็จจริงที่ไม่จริงในทุกแถว ผลที่ตามมาที่สำคัญกว่าคือ การเปลี่ยนผู้ปกครองจริงจะแยกไม่ออกจากสัญญาณเท็จเมื่อย้อนกลับมาตรวจภายหลัง ซึ่งเป็นการสูญเสียกลไกควบคุมหนึ่งตัว
ข้อเท็จจริงที่บรรเทาและควรอ่านคู่กัน: หน้าจอ preview ก่อนกด apply ใช้ค่าที่คำนวณในหน่วยความจำและถูกต้อง จุดตัดสินใจจึงยังไม่ถูกให้ข้อมูลผิด ถ้าเจ้าของระบบชั่งแล้วเห็นว่าเป็น Minor ก็เป็นการชี้ขาดที่รับได้

**ตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบอย่างไร** เปรียบเทียบสาม response ของ batch เดียวกันแถวเดียวกัน (preview / report / batch detail) และยืนยันสาเหตุที่ระดับ storage ด้วย `JSON_TYPE()` และ `IS NULL` ใน MySQL โดยตรง ไม่ได้อนุมานจากโค้ดอย่างเดียว

---

### CS5-07 · Minor · `:id` ที่ไม่ใช่ตัวเลขทำให้ตอบ HTTP 500 พร้อมข้อความ SQL

`GET /api/affiliation/vehicle-requests/abc`, `GET /api/affiliation/transfer-requests/abc` และ `GET /api/school/vehicles/requests/abc` ตอบ **500** `Unknown column 'NaN' in 'where clause'`

`parseInt('abc', 10)` ได้ `NaN` แล้วถูกส่งเข้า placeholder ของ mysql2 ซึ่ง format เป็น identifier `NaN` (`backend/src/routes/affiliation.routes.js:746`, `:758`, `:798`, `:808`; `backend/src/routes/school.routes.js:1875`, `:1881`) ไม่มีการรั่วของข้อมูลและไม่ใช่ช่องทาง injection (ยังเป็น parameterised query) แต่ควรตอบ 400 และไม่ควรส่งข้อความ error ของฐานข้อมูลออกไปหา client บาง route ในระบบตรวจ `Number.isInteger` ไว้แล้ว (เช่น `school.routes.js:603-604`) — เป็นความไม่สม่ำเสมอ ไม่ใช่การออกแบบ

---

## 6. สิ่งที่ตรวจแล้วเป็นพฤติกรรมที่ถูกต้อง

บันทึกไว้เพราะผลที่สะอาดโดยแสดงวิธีตรวจ มีค่าเท่ากับผลที่พบข้อบกพร่อง

1. **RBAC ข้ามบทบาท** — 415 GET และ 178 write ด้วย token ของบทบาทที่ไม่มีสิทธิ์ ปฏิเสธหมด (401/403) ที่เหลือเป็น 404 จาก feature flag ที่ปิด ไม่มีรายการใดหลุดเป็น 2xx
2. **Scope ของโรงเรียน** — `syn_school_001` ยิง `?school_id=SYNSCH002` ที่ `/api/school/students` ยังได้แต่นักเรียนของตัวเอง; `PUT/DELETE/restore /api/school/students/2`, `POST /api/school/leave`, `POST /api/school/checkin-override`, `POST /api/school/checkin/6477/void` และ `POST /api/school/students/2/transfer-request` ต่อ resource ของ SYNSCH002 ได้ 403/404 ทุกข้อ
3. **Scope ของต้นสังกัด** — `syn_aff_001` อ่าน อนุมัติ และปฏิเสธคำขอโอนย้ายและคำขอรถของ SYNAFF02 ได้ 404 `ไม่พบคำขอ หรือคำขอนี้ไม่ได้อยู่ในสังกัดของคุณ`; สร้างบัญชีโรงเรียน รีเซ็ตรหัสผ่าน ปิดบัญชี และแจ้งเตือนโรงเรียนของ SYNAFF02 ได้ 403/404 ทุกข้อ; `?affiliation_id=SYNAFF02` ไม่มีผลกับบัญชีที่ไม่ใช่ admin
4. **เช็กอินผิดคนหรือผิดรถ** — คนขับ 1 เช็กอินและเช็กเอาต์นักเรียนของรถคันอื่น ได้ 404 `Student not found in this vehicle` (`checkin.service.js:320-330`); void log ของรถคันอื่นได้ 403 `รายการนี้ไม่ใช่ของรถคุณ`; เช็กอินซ้ำแบบเรียงลำดับได้ 409; เช็กอินหลังเช็กเอาต์ในรอบเดียวกันได้ 409 `นักเรียนถูกส่งแล้วในรอบนี้`
5. **การยืนยันแทนคนขับทั้งรอบ (rollout ระยะแรก)** — `POST /api/school/checkin-override/all` ของ SYNSCH002 ได้ชุดผู้มีสิทธิ์ = `{9005}` ตรงกับที่คำนวณด้วย SQL อิสระเป๊ะ ๆ ไม่มีนักเรียนนอกโรงเรียนหลุดเข้ามา และเคารพทั้งการลา รอบที่ปิด และรายการที่ทำไปแล้ว
6. **Scope ของรายงานและ export** — parse CSV ทั้งไฟล์จาก `/api/reports/export/csv?date=2026-09-03`

   | บัญชี | แถว | โรงเรียนที่ปรากฏ |
   |---|---:|---|
   | `syn_school_001` | 41 | 1 (ของตัวเอง) |
   | `syn_school_001` + `&school_id=SYNSCH002` | 41 | 1 (ของตัวเอง — param ถูกละเว้น) |
   | `syn_school_001` + `&affiliation_id=SYNAFF02` | 41 | 1 (ของตัวเอง) |
   | `syn_aff_001` | 149 | 4 (SYNSCH001/004/007/010 = SYNAFF01 ครบ) |
   | `syn_aff_001` + `&school_id=SYNSCH002` | 0 | — (filter ตัดกัน ไม่ขยายสิทธิ์) |
   | `syn_province` / `syn_admin` | 366 | 10 |

   ตรรกะที่รองรับอยู่ที่ `backend/src/services/report.service.js:30-66` — filter จาก query string ทำได้แค่ **แคบลง** ไม่มีทางกว้างขึ้น
   หมายเหตุ: รอบแรกอ่านผลนี้ผิดเพราะ harness ของผู้ตรวจตัด response ที่ 4,000 ตัวอักษร ทำให้เห็น 22 แถวเท่ากันทุกบทบาท แก้ harness แล้วยิงใหม่จึงได้ตารางข้างบน — เป็นความผิดของเครื่องมือทดสอบ ไม่ใช่ของระบบ
7. **บัญชีครูประจำสายชั้น (grade scope)** — สร้างบัญชี `syn_teacher_p4` (`grade_scope = 'ป.4'`) ผ่าน API แล้วทดสอบจริง: การบังคับเปลี่ยนรหัสผ่านครั้งแรกทำงาน (403 `MUST_CHANGE_PASSWORD`); การอ่านทุกรายการถูกตรึงที่ ป.4; `?grade=ป.2`, `?grade_scope=ป.2` และ `?school_id=SYNSCH002` ไม่มีผล; การเขียนทุกช่องทาง (`checkin-override`, `checkin-override/all`, `PUT/DELETE students/:id`, `leave`, `void`, `teacher-accounts`) และการอ่านที่เป็นทั้งโรงเรียนโดยธรรมชาติ (`audit-logs`, `vehicles/all`) ได้ 403; `/api/reports/export/csv` คืน 3 แถวเฉพาะ ป.4; `/api/reports/policy` ได้ 403
8. **Scope ของ audit log** — ดึงทั้งชุดแล้วตรวจทีละแถว: `syn_school_001` เห็นเฉพาะผู้กระทำที่ `scope_id = SYNSCH001` และ entity นักเรียนของ SYNSCH001 เท่านั้น (id 361–366 ทั้งหมดเป็นของ SYNSCH001); `syn_aff_001` เห็นผู้กระทำจาก SYNSCH001/007/010 และตัวเอง ไม่มีของ SYNAFF02 หลุดเข้ามา
9. **Scope ของเหตุฉุกเฉิน** — คนขับ 1 (รถ `V-SYNc325ca7ae` รับเด็ก SYNSCH001) แจ้งเหตุ แล้ว SYNSCH001, SYNAFF01, จังหวัด และ admin เห็น ส่วน SYNSCH002 และ SYNAFF02 เห็น 0 รายการ
10. **Scope ของชุดข้อมูลนำเข้า** — `syn_school_002` อ่าน รายงาน apply และ rollback batch 114 ของ SYNSCH001 ได้ 403 `ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้` ทั้งสี่ endpoint (`studentImportPreview.service.js:571-573`, `:607-608`, `:658-659`, `:729-731`)
11. **Scope ของจุดรับส่ง** — จุดรับส่งของ SYNSCH002 บนรถคันที่สอง: โรงเรียนอื่นและคนขับคันอื่นได้ 403 ทุก verb ส่วนเจ้าของลบได้ 200
12. **Scope ของคำขอส่งตรวจรถ** — `vehicleVerification.service.js:426-458` บังคับ join `inspection_application_schools` สำหรับบทบาท `school` และบังคับ `a.requested_by = ?` สำหรับ `driver`; route timeline (`verification.routes.js:138-187`) มีเงื่อนไขคู่ขนานฝังใน SQL
13. **คำขอเปลี่ยนรายชื่อของคนขับ** — `rosterRequest.service.js:90-104` บังคับว่านักเรียนต้องอยู่โรงเรียนที่รถคันนี้ให้บริการ และ `:113-117` บังคับว่าการถอนต้องเป็นเด็กบนรถคันนั้น ส่วน `/api/driver/search-students` ถูกจำกัดไว้ที่โรงเรียนที่รถให้บริการอยู่แล้ว (`driver.routes.js:974-1000`)
14. **การเลือกรถของคนขับ** — `checkin.service.js:121-190` ไม่เดาเมื่อกำกวม: มอบหมายมากกว่าหนึ่งคันจะโยน `MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS` แทนที่จะหยิบมั่ว (ใน sandbox ยังเป็น 1:1 ทั้ง 60 รายการ จึงไม่มีข้อมูลจริงที่ชนกรณีนี้)
15. **การนำเข้าแบบ preview → apply → report → rollback** — ทำครบวงจรบน SYNSCH002 ได้ผลตามที่คาด (preview 2 แถว READY → apply 2 → rollback ตามแถวที่เลือก) ยกเว้นประเด็น CS5-06
16. **การมอบรถข้ามโรงเรียน** — `POST /api/school/students/move` ให้ย้ายเด็กไปรถของโรงเรียนอื่นได้ ตรวจแล้วเป็นพฤติกรรมตามการออกแบบ ไม่ใช่ข้อบกพร่อง: `GET /api/school/vehicles/all` (`school.routes.js:1032-1048`) ระบุไว้ในโค้ดว่าเป็น dropdown ของกองรถร่วมระดับจังหวัด และตัดชื่อเจ้าของรถออกเพื่อ data minimization
17. **การซ่อน feature ที่ยังไม่รับรอง** — `/api/participation`, `/api/qr`, `/api/eta`, `/api/geofences`, `/api/consent`, `/api/{driver,school}/registrations`, `/api/documents` และ `/api/auth/recovery/admin/*` ตอบ 404 ไม่ใช่ 403 คือ router ไม่ถูก mount เลย ตรงตามข้อกำหนด "ซ่อนทั้ง menu/API อย่างปลอดภัย" ของ master plan §4.2 (สถานะบน production ต่างจากนี้ ดู §7)
18. **การผูก instant ของ DATE ในฝั่งอ่าน** — ตรวจ `.slice(0,10)` และ `.split('T')[0]` ทั้ง `frontend/src` พบสี่จุด: `VehicleList.jsx:47` (= CS5-02), `DriverProfile.jsx:70` (ปลอดภัยเพราะ backend ครอบ `dateOnly` ไว้ — ทำ round trip แล้วค่าไม่ขยับ), `TermSettings.jsx:189` และ `DocumentReviewPanel.jsx:102` (แสดงผลอย่างเดียว จะแสดงเร็วไปหนึ่งวัน แต่ตาราง `terms` ว่างและ feature เอกสารปิดอยู่ จึงยังไม่มีข้อมูลให้แสดงผิดใน sandbox) ส่วนการเปรียบเทียบแบบ `new Date(v.insurance_expiry) < new Date()` ในหน้าขนส่งใช้ instant จึงไม่เพี้ยน

## 7. สิ่งที่ประเมินไม่ได้ในรอบนี้

| เรื่อง | เหตุผล | สิ่งที่ต้องมีก่อนจึงประเมินได้ |
|---|---|---|
| Participation case/event (Core scope §4.1) | `FEATURE_PARTICIPATION_CASES` ปิด `/api/participation` ตอบ 404 แม้ตาราง `participation_cases` จะมี 20 แถว | **รอ C0-4** |
| Parent LINE binding / status / notification | ยืนยันตัวตนด้วย LIFF id_token ที่ LINE เป็นผู้ตรวจ (`lineIdToken.service.js:42-79`) ไม่มี bypass สำหรับ test และ channel ไม่ได้ตั้งค่าใน sandbox | บัญชีทดสอบ LINE และ channel จริง (Phase 8) และ **รอ D0-3/D0-5** สำหรับ consent |
| การลืมรหัสผ่านของ admin และการกู้คืนทุกบทบาท | `FEATURE_ADMIN_PASSWORD_RECOVERY` ปิด `/api/auth/recovery/admin/*` ตอบ 404 | **รอ C0-5** (18 gate) |
| Driver registration และเอกสารคนขับ | `FEATURE_DRIVER_REGISTRATION` ปิดใน sandbox ทั้งที่ master plan §3 ระบุว่าเปิดอยู่บน production — สภาพแวดล้อมทดสอบกับ production จึงไม่ตรงกันในจุดนี้ | ตั้ง flag ให้ตรงกับ production แล้วทดสอบซ้ำ |
| ETA / geofence / route deviation / QR | flag ปิดทั้งหมด | **รอ C0-4** |
| พฤติกรรมข้ามเที่ยงคืนเวลาไทยบนนาฬิกาจริง | ทดสอบเวลา 22:2x–22:5x น. ไม่ได้แตะช่วง 00:00–07:00 ซึ่งเป็นช่วงที่รถรอบเช้าวิ่งและเป็นช่วงที่ off-by-one จะโผล่ | รันชุดเดิมซ้ำในช่วงเวลานั้น หรือด้วยนาฬิกาที่ควบคุมได้ บน DB ที่ตั้ง UTC แบบ production |
| พฤติกรรมข้ามภาคเรียนบนนาฬิกาจริง | ไม่ได้เลื่อนนาฬิกาข้ามวันที่ 11 ต.ค. ผลใน CS5-05 พิสูจน์ผ่าน `students.term_id` ซึ่งเป็นตัวแปรเดียวกันที่ขอบภาคเรียนจะทำให้เปลี่ยน | ทดสอบที่ขอบจริงหรือด้วยนาฬิกาที่ควบคุมได้ |
| สมรรถนะที่โหลดรับรอง | ไม่ได้อยู่ในขอบเขตงานนี้ | Phase 9 |
| ระบบสำรองและกู้คืนข้อมูล | ไม่ได้อยู่ในขอบเขตงานนี้ | Phase 10 |
| นิยาม check-in / check-out / absent / leave / override / void และผู้มีสิทธิ์เช็ก | ทดสอบได้แต่ว่าโค้ดทำอะไร ไม่ได้ทดสอบว่าที่ทำนั้นตรงกับที่ตกลงไว้ เพราะยังไม่มีข้อตกลง | **รอ C0-1** |
| ระดับที่ควรอนุมัติ transfer / vehicle request / roster / inspection | ปัจจุบันทั้ง admin และต้นสังกัดอนุมัติ transfer และ vehicle request ได้ (`affiliation.routes.js:751-830` และ `admin.routes.js`) ซึ่งเป็นคิวสองชั้นที่ C0-2 ตั้งใจจะตัด — ไม่ใช่ข้อบกพร่องจนกว่าจะมีข้อสรุป | **รอ C0-2** |

## 8. การคืนสภาพ sandbox

ทุกสิ่งที่สร้างระหว่างทดสอบถูกเก็บกวาดผ่านเส้นทางของแอปเองเมื่อทำได้:

| รายการ | วิธีคืนสภาพ |
|---|---|
| นักเรียน fixture id 9001–9005 และ 9101–9104 | soft delete (`is_deleted = 1`, `vehicle_id = NULL`) และคืน `term_id` เป็น `2568-2` |
| นักเรียนจาก import batch 118 (id 367, 368) | rollback ผ่าน `POST /students/import/118/rollback` |
| คำขอโอนย้าย id 4, คำขอรถ id 34, คำขอส่งตรวจ id 1 | ยกเลิกผ่าน API ของแต่ละ workflow |
| การลา id 329 | ยกเลิกผ่าน `DELETE /api/school/leaves/329` |
| บัญชีครู `syn_teacher_p4` (user id 840) | ลบผ่าน `DELETE /api/school/teacher-accounts/840` |
| เหตุฉุกเฉิน id 35–39 | ลบผ่าน `DELETE /api/admin/emergencies/:id` |
| ผู้ปกครองทดสอบ id 99001 และ LINE binding `U-AUDIT-9003` | soft delete และ unbind แล้วลบแถว `notifications` ที่เกี่ยวข้อง |
| `vehicles.insurance_expiry` ของ `V-SYNc325ca7ae` | คืนเป็น `2026-08-05` (ค่าตั้งต้นก่อนการทดสอบ CS5-02) |

ตรวจหลังเก็บกวาด: `SELECT COUNT(*) FROM students WHERE is_deleted = 0` = **360** เท่ากับตอนเริ่ม และ `vehicles.insurance_expiry` ของรถทั้งสองคันที่แตะกลับเป็นค่าเดิม

สิ่งที่ **ไม่ได้** ลบโดยตั้งใจ: แถวใน `checkin_logs`, `daily_status` และ `audit_logs` ที่เกิดจากการทดสอบ — เป็นหลักฐานของข้อบกพร่องในเอกสารนี้ และการลบ audit log ด้วยมือขัดกับหลัก append-only ของระบบ ทุกแถวผูกกับนักเรียน fixture ที่ถูก soft delete แล้ว

ไม่มีคำสั่งใดในงานนี้แตะฐานข้อมูล `lampang_bus` ทุกคำสั่งระบุ `lampang_bus_sandbox` อย่างชัดแจ้ง

## 9. สิ่งที่ต้องทำต่อ

1. CS5-01 และ CS5-02 เป็น Critical ตามนิยาม §5 ซึ่ง master plan กำหนดว่า "ต้องแก้และ regression/UAT ใหม่; ห้าม rollout" — ต้องมี owner, fix commit และผล retest ก่อนอ้าง System Acceptance
2. CS5-03 ถึง CS5-06 เป็น Major ซึ่ง "ต้องแก้ก่อน System Acceptance"
3. ทุกข้อยังไม่มี regression test — Phase 5 ข้อ 4 กำหนดให้ "ปิด Critical/Major defect และเพิ่ม regression/negative tests" การเพิ่ม test ที่ยิงพร้อมกันจริง ไม่ใช่ `await` เรียงกัน เป็นเงื่อนไขที่ CS5-04 ต้องการโดยเฉพาะ
4. §7 ทั้งตารางยังประเมินไม่ได้ อย่านับว่า Core scope ถูกตรวจครบเพียงเพราะเอกสารนี้มีอยู่
