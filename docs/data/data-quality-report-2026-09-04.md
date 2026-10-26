# Data Quality Report (A1-7) — เครื่องมือตรวจคุณภาพข้อมูล ทดสอบบน sandbox สังเคราะห์

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

จัดทำ: 4 กันยายน 2569 · branch `feat/tracking-security-hardening` · commit `1b0c1a5`

ฐานข้อมูลที่ตรวจ: `lampang_bus_sandbox` (MySQL 8.0 ใน container `lampang_mysql`) — **ข้อมูลสังเคราะห์ล้วน**

สถานะเอกสาร: **บันทึกผลการรันเครื่องมือตรวจบนข้อมูลสังเคราะห์ ไม่ใช่ผลของข้อมูลจริง ไม่ใช่ data certification ไม่ใช่ผล UAT และไม่ใช่ sign-off**

---

## 0. คำเตือนที่ต้องอ่านก่อนใช้ตัวเลขใดก็ตามในเอกสารนี้

> **ตัวเลขทุกตัวในเอกสารนี้มาจากฐานข้อมูลสังเคราะห์ `lampang_bus_sandbox` เท่านั้น**
> ไม่ได้บอกอะไรเลยเกี่ยวกับชุดข้อมูลจริงบน production — ไม่บอกว่าดี ไม่บอกว่าแย่ ไม่บอกว่าใกล้เคียง
> ข้อมูลชุดนี้ถูกสร้างขึ้นโดย seeder เพื่อการทดสอบ ดังนั้นค่าที่วัดได้สะท้อน **สิ่งที่ seeder เลือกจะใส่หรือไม่ใส่** เป็นหลัก ไม่ใช่สภาพข้อมูลของโรงเรียนจริง
> ห้ามอ้างเปอร์เซ็นต์ใดในเอกสารนี้ในรายงานความพร้อม ในเอกสารวิจัย หรือต่อผู้บริหาร โดยไม่ติดคำว่า "sandbox สังเคราะห์" กำกับทุกครั้ง

**สิ่งที่เอกสารนี้เป็น** — เป็นการสร้าง *เครื่องมือวัด* ตาม Phase 6 checkbox 1 และ 2 ของ `master-project-closure-plan.md` แล้วเอาไปรันกับ input ที่รู้คำตอบอยู่แล้ว เพื่อพิสูจน์ว่าตัวตรวจแต่ละตัวยิงจริงและอ่านผลได้จริง

**สิ่งที่เอกสารนี้ไม่ใช่** — deliverable จริงของ A1-7 คือการเอาชุด SQL ในภาคผนวก §13 ไปรันกับฐานข้อมูล production โดยผู้มีอำนาจ แล้วให้โรงเรียน/ต้นสังกัด/จังหวัด/ขนส่งรับรองผลตาม Phase 6 checkbox 3-4 **การรันกับ production ไม่ใช่งานของรอบนี้และทำที่นี่ไม่ได้ตามข้อจำกัดของงาน**

**ไม่มี PII ในเอกสารนี้** — ทุกตัวเลขเป็น count / percentage / distribution ที่ไหนต้องชี้แถวที่มีปัญหา ใช้ **id เท่านั้น** ไม่มีชื่อนักเรียน ไม่มีเบอร์โทร ไม่มีเลขบัตร ไม่มี LINE user id ไม่มีทะเบียนรถจริง แม้เป็นตัวอย่าง

---

## 1. ขอบเขตตาม master plan

Phase 6 ของ `docs/project-closure/master-project-closure-plan.md` บรรทัดที่งานนี้รับผิดชอบ:

- [x] สร้าง aggregate data-quality score โดยไม่ export PII → §3
- [x] ตรวจ school-affiliation mapping, active/inactive, ownership, duplicate/orphan และข้อมูลที่จำเป็นต่อ LINE/check-in → §4–§10

checkbox ที่เหลือของ Phase 6 (การรับรองโดยโรงเรียน/ต้นสังกัด/จังหวัด/ขนส่ง, การผูก certification กับ term/batch/hash, workflow แก้ข้อมูล, retention/archival/DSR) **ไม่ได้อยู่ในงานนี้** และหลายข้อยังติดการตัดสินใจที่ค้างอยู่ ดู §11

---

## 2. วิธีการ สภาพแวดล้อม และข้อจำกัดของ snapshot

### 2.1 วิธีอ่านฐานข้อมูล

- อ่านอย่างเดียวทั้งหมด — ทุก session ตั้ง `SET SESSION TRANSACTION READ ONLY;` แล้ว `START TRANSACTION WITH CONSISTENT SNAPSHOT;` ก่อนคิวรีแรก ไม่มีคำสั่งเขียนแม้แต่คำสั่งเดียว
- ไม่แตะฐาน `lampang_bus` (ฐานของผู้พัฒนาบนเซิร์ฟเวอร์เดียวกัน) และไม่แตะ production
- ฟิลด์ที่ถือว่า "จำเป็น" ต่อ LINE และ check-in **อ่านมาจากโค้ด ไม่ได้เดา** — อ้างอิงไฟล์และบรรทัดไว้ใน §9 และ §10

### 2.2 snapshot

| รายการ | ค่า |
|---|---|
| snapshot หลัก | 2026-09-04 22:28:36 (Asia/Bangkok) |
| snapshot เสริม | 22:29:32, 22:30:10, 22:31:44 |
| จำนวนตารางในฐาน | 58 |

### 2.3 ข้อจำกัดสำคัญ — ฐานข้อมูลถูกเขียนโดย agent อื่นระหว่างที่ตรวจ

ระหว่างรันชุดคิวรี มี agent อื่นกำลังรัน E2E test กับ backend ตัวเดียวกันและเขียนลงฐาน sandbox นี้พร้อมกัน ยืนยันได้จาก `created_at` ของ `students` และ `checked_at` ของ `checkin_logs`:

| ชั่วโมงที่สร้าง | students | parents | checkin_logs |
|---|---:|---:|---:|
| 2026-09-04 21:00 (seed) | 360 | 360 | — |
| 2026-08-26 … 2026-09-04 07:00/16:00 (seed, ย้อนหลัง) | — | — | 6,500 |
| 2026-09-04 22:00 (agent อื่น) | 7 | 3 | 8 |

**ผลที่ตามมา** ตัวเลขดิบ ณ snapshot (เช่น students active = 364) ไม่ใช่ตัวเลขของชุดข้อมูลตั้งต้น เพื่อไม่ให้เครื่องมือรายงานสิ่งที่ agent อื่นทำว่าเป็นคุณภาพข้อมูล เอกสารนี้จึงแยกรายงานเป็นสองชั้น:

- **cohort ตั้งต้น (seed)** — แถวที่ `created_at < 2026-09-04 22:00:00` = นักเรียน 360 / ผู้ปกครอง 360 / checkin_logs 6,500 / daily_status 3,600 → ใช้คำนวณคะแนนใน §3
- **cohort จากการทดสอบพร้อมกัน (E2E)** — นักเรียน 7 (active 4: id 9001-9004, soft-deleted 3: id 361-363), ผู้ปกครอง 3, checkin_logs 8 → รายงานแยกและ **ไม่นับเป็นข้อบกพร่องของข้อมูล**

นี่คือข้อจำกัดของสภาพแวดล้อมรอบนี้ ไม่ใช่คุณสมบัติของเครื่องมือ ถ้ารันกับ production ต้องรันในช่วงที่ไม่มีการเขียนแข่ง หรือรับว่าเป็น point-in-time snapshot และระบุเวลากำกับ

### 2.4 ปริมาณข้อมูลตั้งต้น ณ snapshot

| entity | total | active | soft-deleted |
|---|---:|---:|---:|
| affiliations | 3 | 3 | 0 |
| schools | 10 | 10 | 0 |
| vehicles | 60 | 60 | 0 |
| drivers | 66 | 66 | 0 |
| students | 367 | 364 | 3 |
| parents | 363 | 363 | 0 |
| users | 282 | 282 | 0 |
| parent_student | 399 | approved 399 | — |
| driver_vehicle_assignments | 60 | active 60 | 0 |
| checkin_logs | 6,503 | — | — |
| daily_status | 3,601 | — | — |
| **line_bindings** | **0** | — | — |
| **line_users** | **0** | — | — |
| **consent_records** | **0** | — | — |
| **terms** | **0** | — | — |

สี่ตารางท้ายที่ว่างเปล่าเป็นเงื่อนไขสำคัญในการอ่านผล §9 และ §10

---

## 3. Aggregate data-quality score

> ทุกค่าในหัวข้อนี้คำนวณจาก **cohort ตั้งต้นของข้อมูลสังเคราะห์** (นักเรียน 360, รถ 60, คนขับ 66, โรงเรียน 10) ไม่ใช่ข้อมูลจริง

### 3.1 ตัวชี้วัดรายมิติ

| # | มิติ | ตัวหาร | ผ่าน | % |
|---|---|---:|---:|---:|
| D1 | โรงเรียนมี affiliation | 10 | 10 | 100.00 |
| D2 | นักเรียนสังกัดโรงเรียนที่ยังใช้งานและโรงเรียนนั้นมีต้นสังกัด | 360 | 360 | 100.00 |
| D3 | นักเรียนผูกกับรถที่ยังใช้งาน | 360 | 360 | 100.00 |
| D4 | นักเรียนมีความสัมพันธ์ผู้ปกครองที่ `approved = TRUE` | 360 | 360 | 100.00 |
| D5 | ฟิลด์ครบพอที่ผู้ปกครองจะผูก LINE ได้ (§9.1) | 360 | 360 | 100.00 |
| D6 | ผูก LINE จริงแล้วและแจ้งเตือนถึงได้ (§9.2) | 360 | 0 | 0.00 |
| D7 | พร้อมเช็กอินครบสาย (§10.1) | 360 | 357 | 99.17 |
| D8 | คนขับมี active assignment กับรถที่ยังใช้งาน | 66 | 60 | 90.91 |
| D9 | active assignment มีผู้อนุมัติและเวลาอนุมัติครบ | 60 | 0 | 0.00 |
| D10 | รถที่มี verification_status แล้วมี `verification_updated_at` | 60 | 15 | 25.00 |
| D11 | รถมี `qr_token` | 60 | 0 | 0.00 |
| D12 | ไม่ซ้ำบน natural key ที่ schema บังคับ (§7.1) | 6 key | 6 | 100.00 |
| D13 | `is_deleted` กับ `deleted_at` สอดคล้องกัน | 7 ตาราง | 7 | 100.00 |
| D14 | `checkin_logs.term_id` ตรงกับ convention ของวันที่ในแถว (§10.4) | 6,508 ※ | 8 | 0.12 |
| D15 | `daily_status` มี `checkin_logs` คู่ในวันเดียวกัน (§10.3) | 3,600 | 3,570 | 99.17 |

※ D14 คำนวณจาก snapshot 22:29:32 (checkin_logs 6,508 แถว) ไม่ใช่ snapshot หลัก 22:28:36 (6,503 แถว) เพราะคิวรี term convention รันในรอบเสริม ผลต่าง 5 แถวมาจากการเขียนของ agent อื่นในระหว่างนั้น ดู §2.3

**ค่าเฉลี่ยไม่ถ่วงน้ำหนักของ 15 มิติ = 67.62%**

### 3.2 เหตุผลที่ห้ามอ่านตัวเลข 67.62% ว่าเป็นคำตัดสิน

1. **น้ำหนักยังไม่มีใครกำหนด** — D11 (qr_token) กับ D4 (ผู้ปกครองอนุมัติ) ไม่ควรมีน้ำหนักเท่ากัน แต่ยังไม่มีผู้มีอำนาจกำหนดว่าเท่าไร → **รอ C0-13** (severity scheme)
2. **เกณฑ์ผ่านยังไม่มี** — Phase 6 exit gate เขียนว่า "Critical/Major data defect = 0" แต่การจัดว่าอะไรเป็น Critical/Major/Minor คือสิ่งที่ C0-13 ต้องตอบ → **รอ C0-13**
3. **นิยาม "ฟิลด์ที่จำเป็น" ยังไม่มีใครรับรอง** — เอกสารนี้ derive จากโค้ดว่าฟิลด์ใดทำให้ flow ทำงานหรือพัง แต่ "ฟิลด์ใดโรงเรียนต้องกรอกให้ครบตามนโยบาย" เป็นคนละคำถามและยังไม่ถูกตอบ → **รอ D0-2** (data inventory และวัตถุประสงค์ต่อชุดข้อมูล)
4. **สี่มิติที่ได้ 0% (D6, D9, D11, D14) เป็นลักษณะของ seeder ทั้งหมด ไม่ใช่สภาพของแอปพลิเคชัน** — ดู §9.2, §8.3, §10.2, §10.4 คะแนนรวมจึงถูกกดโดยสิ่งที่ seeder เลือกไม่ใส่ ไม่ใช่โดยข้อบกพร่องของระบบ นี่คือเหตุผลตรง ๆ ว่าทำไมคะแนนนี้ใช้ตัดสินอะไรไม่ได้จนกว่าจะรันกับข้อมูลจริง

---

## 4. School ↔ affiliation mapping

> ตัวเลขจากข้อมูลสังเคราะห์

| ตัวชี้วัด | ค่า |
|---|---:|
| โรงเรียนที่ยังใช้งาน | 10 |
| ที่ `affiliation_id IS NULL` | 0 |
| **ความครบของการ mapping** | **100.00%** |

| รหัสตรวจ | ตัวตรวจ | ผล |
|---|---|---:|
| S2-1 | โรงเรียนที่ยังใช้งานชี้ไป affiliation ที่ถูกลบแล้ว | 0 |
| S2-2 | `affiliation_id` ที่ไม่มีในตาราง `affiliations` | 0 |
| S2-3 | นักเรียนที่ยังใช้งานอยู่ในโรงเรียนที่ถูกลบแล้ว | 0 |
| S2-4 | นักเรียนที่ยังใช้งานอยู่ในโรงเรียนที่ไม่มีต้นสังกัด | 0 |
| S2-5 | ต้นสังกัดที่ไม่มีโรงเรียนที่ยังใช้งานเลย | 0 |

การกระจายตัว (id เท่านั้น) — ตัวเลขนักเรียนรวม cohort จาก E2E ด้วย:

| affiliation_id | โรงเรียนทั้งหมด | โรงเรียนที่ใช้งาน | นักเรียนที่ใช้งาน |
|---|---:|---:|---:|
| SYNAFF01 | 4 | 4 | 147 |
| SYNAFF02 | 3 | 3 | 109 |
| SYNAFF03 | 3 | 3 | 108 |

**อ่านผล** มิตินี้สะอาดทั้งหมดบน input ที่รู้คำตอบอยู่แล้ว — เป็นการยืนยันว่าตัวตรวจ S2-1…S2-5 ทำงาน ไม่ใช่ข้อสรุปว่าการ mapping บน production ครบ FK `fk_schools_affiliation` บังคับ S2-2 ให้เป็น 0 อยู่แล้วโดยโครงสร้าง แต่ **S2-1 (ชี้ไปต้นสังกัดที่ถูก soft-delete) FK บังคับไม่ได้** เพราะเป็น soft delete — ตัวตรวจนี้จึงมีค่าจริงเมื่อรันกับ production

---

## 5. Ownership (ใครเป็นเจ้าของข้อมูลแถวไหน)

> ตัวเลขจากข้อมูลสังเคราะห์

| รหัสตรวจ | ตัวตรวจ | ผล |
|---|---|---:|
| S3-17 | ผู้ใช้ scope `SCHOOL` ที่ `scope_id` ไม่มีในตาราง schools | 0 |
| S3-18 | ผู้ใช้ scope `AFFILIATION` ที่ `scope_id` ไม่มีในตาราง affiliations | 0 |
| S3-19 | บัญชี role `driver` ที่ `driver_id` เป็น NULL | 0 |
| S3-20 | `users.driver_id` ชี้ไปคนขับที่ถูกลบแล้ว | 0 |
| S3-21 | โรงเรียนที่ใช้งานอยู่แต่ไม่มีบัญชีโรงเรียนเลย | 0 |
| S5-11 | active assignment ที่สถานะ `AUTHORIZED` แต่ไม่มี `authorized_by`/`authorized_at` | **60 / 60** |

การกระจายบัญชีผู้ใช้:

| role | scope_type | grade_scope | จำนวน | is_active | ไม่เคย login |
|---|---|---|---:|---:|---:|
| driver | — | ไม่ตั้ง | 66 | 66 | 64 |
| school | SCHOOL | ไม่ตั้ง | 210 | 210 | 203 |
| affiliation | AFFILIATION | ไม่ตั้ง | 3 | 3 | 1 |
| province | PROVINCE | ไม่ตั้ง | 1 | 1 | 0 |
| transport | — | ไม่ตั้ง | 1 | 1 | 0 |
| admin | — | ไม่ตั้ง | 1 | 1 | 0 |

### 5.1 ข้อสังเกตที่ต้องให้ผู้มีอำนาจตัดสิน ไม่ใช่ให้ทีมเทคนิคตัดสิน

**(ก) โรงเรียนละ 21 บัญชีสิทธิ์เต็ม ไม่มีบัญชีใดถูกจำกัด grade scope เลย**

ณ snapshot ทั้ง 10 โรงเรียนมี `role='school'` โรงเรียนละ 21 บัญชี (รวม 210) และ **ทุกบัญชีมี `grade_scope IS NULL`** ซึ่งตาม CHECK constraint `chk_users_grade_scope` แปลว่าเป็นบัญชีโรงเรียนเต็มสิทธิ์ทั้งหมด ไม่มีบัญชีครูที่ถูกจำกัดระดับชั้นแม้แต่บัญชีเดียว (ตัวเลข 21 ต่อโรงเรียนเป็นของ cohort ตั้งต้น การรันซ้ำภายหลังอาจได้ค่ามากกว่านี้จากบัญชีที่ agent อื่นสร้างระหว่างทดสอบ)

บนข้อมูลสังเคราะห์นี่เป็นการตั้งค่าของ seeder ไม่ใช่ข้อบกพร่องของระบบ — แต่ตัวตรวจนี้คือสิ่งที่ต้องรันกับ production เพราะถ้า production มีรูปแบบเดียวกัน แปลว่าครูทุกคนเห็นและเช็กเด็กได้ทั้งโรงเรียน

จะเรียกสภาพนี้ว่าถูกหรือผิด ขึ้นกับคำตอบของ **C0-1** (บัญชีโรงเรียนเต็มเท่านั้น หรือครู grade scope ทำได้ด้วย) และ **C0-5 gate 10-12** (`school_main_account_ownership_evidence`, `teacher_subaccount_binds_separately`, `revocation_window_on_transfer`) → **รอ C0-1 และ รอ C0-5**

**(ข) active assignment 60/60 ไม่มีร่องรอยผู้อนุมัติ**

`driver_vehicle_assignments` ทั้ง 60 แถวมี `authorization_status = 'AUTHORIZED'` แต่ `authorized_by` และ `authorized_at` เป็น NULL ทั้งหมด — สิทธิ์ขับรถของคนขับทุกคนในชุดนี้จึงไม่มีร่องรอยว่าใครอนุมัติเมื่อไร

seeder เขียนแถวเหล่านี้ตรงเข้าฐานโดยไม่ผ่าน flow อนุมัติ จึงเป็นลักษณะของข้อมูลทดสอบ ไม่ใช่พฤติกรรมของระบบ ว่าบน production ต้องมี `authorized_by` ครบทุกแถวหรือไม่ ขึ้นกับ **C0-2** (เจ้าของการอนุมัติแต่ละประเภท) → **รอ C0-2**

---

## 6. Orphan

> ตัวเลขจากข้อมูลสังเคราะห์

### 6.1 ความครบของฟิลด์หลักในตาราง students (ณ snapshot, active 364 รวม cohort E2E)

| ฟิลด์ | ที่ว่าง |
|---|---:|
| `school_id` | 0 |
| `vehicle_id` | 1 |
| `student_code` | 0 |
| `cid_hash` | 0 |
| `grade` | 0 |
| `classroom` | 0 |
| `term_id` | 0 |

บน cohort ตั้งต้น 360 คน ทั้งเจ็ดฟิลด์ว่าง 0 — แถวเดียวที่ไม่มี `vehicle_id` เป็นนักเรียนที่ agent E2E สร้าง

### 6.2 ผลตัวตรวจ orphan

| รหัสตรวจ | ตัวตรวจ | snapshot | cohort ตั้งต้น |
|---|---|---:|---:|
| S3-1 | นักเรียนที่ใช้งานอยู่แต่ไม่มี parent_student เลย | 4 | **0** |
| S3-2 | นักเรียนที่ไม่มี parent link ที่ `approved = TRUE` | 4 | **0** |
| S3-3 | นักเรียนที่ไม่มีผู้ปกครองที่มีเบอร์โทร | 4 | **0** |
| S3-4 | นักเรียนกำพร้าสมบูรณ์ (ไม่มีทั้งโรงเรียน รถ และผู้ปกครอง) | 0 | 0 |
| S3-5 | ผู้ปกครองที่ใช้งานอยู่แต่ไม่ผูกกับนักเรียนคนใดเลย | 0 | 0 |
| S3-6 | parent_student ที่ชี้ไปนักเรียนที่ถูก soft-delete | 3 | **0** |
| S3-7 | parent_student ที่ชี้ไปผู้ปกครองที่ถูก soft-delete | 0 | 0 |
| S3-9 | นักเรียนที่ใช้งานอยู่ผูกกับรถที่ถูกลบแล้ว | 0 | 0 |
| S3-10 | รถที่ใช้งานอยู่แต่ไม่มีนักเรียนเลย | 0 | 0 |
| S3-11 | รถที่ใช้งานอยู่แต่ไม่มี active driver assignment | 0 | 0 |
| S3-12 | รถที่มีนักเรียนแต่ไม่มีคนขับ | 0 | 0 |
| S3-13 | **คนขับที่ใช้งานอยู่แต่ไม่มี active assignment** | **6** | **6** |
| S3-14 | คนขับที่มีรถ active มากกว่าหนึ่งคัน | 0 | 0 |
| S3-15 | active assignment บนรถที่ถูกลบ | 0 | 0 |
| S3-16 | active assignment บนคนขับที่ถูกลบ | 0 | 0 |
| S3-22 | `daily_status.student_id` เป็น NULL | 0 | 0 |
| S3-23 | `daily_status` ชี้ไปนักเรียนที่ไม่มีอยู่ | 0 | 0 |
| S3-24 | `checkin_logs` ชี้ไปนักเรียนที่ไม่มีอยู่ | 0 | 0 |
| S3-26 | `checkin_logs.vehicle_id` ต่างจากรถปัจจุบันของนักเรียน | 0 | 0 |

### 6.3 คนขับ 6 คนที่ไม่มีรถ (id: 323, 324, 325, 326, 327, 328)

มีคนขับ 66 คน แต่มีรถ 60 คัน และ active assignment 60 แถวแบบหนึ่งคนต่อหนึ่งคัน — คนขับ 6 คนสุดท้ายจึงไม่มีรถ บัญชีผู้ใช้ของทั้งหกคน (users id: 633, 634, 635, 636, 637, 638) resolve รถไม่ได้ทั้งทาง relational และทาง legacy plate (ดู §10.2 S7-9)

**นี่ไม่ใช่ข้อบกพร่องของแอปพลิเคชัน** — `getDriverVehicle` ตั้งใจ fail closed เมื่อ resolve รถไม่ได้ (`checkin.service.js:120-193`) พฤติกรรมนี้ถูกต้องตามที่ออกแบบ สิ่งที่ตัวตรวจจับได้คือ *สภาพข้อมูล* ว่ามีบัญชีคนขับที่เข้าระบบได้แต่ปฏิบัติงานไม่ได้ ซึ่งบน production เป็นข้อมูลที่ควรรู้ก่อนเปิดใช้

### 6.4 parent_student ที่ค้างหลัง soft-delete นักเรียน (S3-6 = 3 แถว, student id 361-363)

ทั้งสามแถวเกิดจาก agent E2E ที่ลบนักเรียนที่มันสร้างเอง ระบบ soft-delete นักเรียนแล้วปล่อยแถว `parent_student` ไว้ **ตรวจแล้วว่าไม่กระทบ flow ใด** เพราะทุกคิวรีที่ใช้ความสัมพันธ์นี้ (`line.service.js:107-122`, `line.service.js:246-268`, `checkin.service.js:398-419`) join ด้วยเงื่อนไข `s.is_deleted = FALSE` เสมอ จึงกรองออกอยู่แล้ว — รายงานไว้เป็นข้อสังเกตของ retention ไม่ใช่ข้อบกพร่อง ว่าแถวเหล่านี้ต้องถูกลบเมื่อใด → **รอ D0-8**

---

## 7. Duplicate detection

> ตัวเลขจากข้อมูลสังเคราะห์

### 7.1 natural key ที่ schema บังคับความไม่ซ้ำอยู่แล้ว

| รหัสตรวจ | key | dup group |
|---|---|---:|
| S4-1 | `students (school_id, student_code)` — `uk_school_student_code` | 0 |
| S4-5 | `vehicles.normalized_plate` — `uq_vehicles_normalized_plate` | 0 |
| S4-6 | `vehicles.canonical_plate` ในกลุ่มที่ยังใช้งาน — `uq_vehicles_active_canonical` | 0 |
| S4-15 | `users.username` (เทียบแบบไม่สนตัวพิมพ์) — `uq_users_username` | 0 |
| S4-18 | `daily_status (check_date, student_id)` — `uk_ds_date_student` | 0 |
| S4-20 | `driver_vehicle_assignments (driver_id, vehicle_id)` ที่ active — `uq_dva_active_driver_vehicle` | 0 |

หกตัวนี้เป็น 0 โดยโครงสร้าง — คงไว้เพื่อ **ยืนยันว่า constraint ยังบังคับอยู่จริงในฐานที่ตรวจ** ถ้าตัวใดไม่เป็น 0 บน production แปลว่าฐานนั้นสร้างมาโดยไม่มี constraint ครบ

### 7.2 key ที่ schema ไม่บังคับ — ตัวตรวจที่มีค่าจริง

| รหัสตรวจ | ตัวตรวจ | dup group | แถวที่เกี่ยว |
|---|---|---:|---:|
| S4-2 | นักเรียนที่ `cid_hash` ซ้ำ (คนเดียวถูกลงทะเบียนสองครั้ง) | 0 | 0 |
| S4-3 | `student_code` ซ้ำข้ามโรงเรียน | 0 | 0 |
| S4-4 | นักเรียนชื่อ-นามสกุลซ้ำในโรงเรียนเดียวกัน | **120** | **360** |
| S4-7 | รถที่ใช้งานอยู่แต่ `canonical_plate` ว่าง | 0 | 0 |
| S4-8 | ผู้ปกครองที่เบอร์โทรซ้ำ | **0** | 0 |
| S4-9 | เบอร์โทรเดียวที่ผูกลูกอยู่มากกว่าหนึ่งโรงเรียน | **36** | — |
| S4-10 | ผู้ปกครองที่ชื่อ+เบอร์ซ้ำ | 0 | 0 |
| S4-11 | นักเรียนที่มีแถวผู้ปกครองมากกว่าหนึ่ง | 36 | — |
| S4-12 | ผู้ปกครองที่มีลูกมากกว่าหนึ่งคน | 36 | — |
| S4-13 | คนขับที่เบอร์โทรซ้ำ | 0 | 0 |
| S4-14 | คนขับที่ชื่อซ้ำ | **24** | **66** |
| S4-16 | โรงเรียนที่มีบัญชีสิทธิ์เต็มมากกว่าหนึ่ง | 10 | 210 |
| S4-17 | line_users ที่ `parent_id` ซ้ำ | 0 | 0 |
| S4-19 | `checkin_logs` ซ้ำที่ (วันที่ + นักเรียน + รอบ + สถานะ) | 0 | 0 |
| S4-21 | รถหนึ่งคันที่มีคนขับ active มากกว่าหนึ่งคน | 0 | 0 |

### 7.3 อ่านผล

- **S4-4 = 120 กลุ่ม ครอบคลุมนักเรียนทั้ง 360 คน** แปลว่าทุกคนอยู่ในกลุ่มชื่อซ้ำ (เฉลี่ยกลุ่มละ 3 คน) และ **S4-14 = 24 กลุ่ม ครอบคลุมคนขับทั้ง 66 คน** ทั้งสองค่าเกิดจาก seeder ใช้คลังชื่อขนาดเล็กแล้วสุ่มซ้ำ **ไม่ใช่ข้อบกพร่อง** และไม่ได้แปลว่าตัวตรวจผิด — ตัวตรวจทำงานถูกต้อง เพียงแต่บน input นี้สัญญาณอิ่มตัวที่ 100% ค่าที่มีความหมายจริงต้องมาจาก production
- **S4-8 = 0 กับ S4-11 = 36 พร้อมกัน** แปลว่าในชุดนี้ นักเรียน 36 คนมีผู้ปกครองสองแถว แต่สองแถวนั้น **ใช้คนละเบอร์** ดังนั้น **เส้นทาง "พ่อกับแม่ใช้เบอร์เดียวกัน" ที่ `line.service.js:241-268` ออกแบบมารองรับโดยเฉพาะ ยังไม่ถูกทดสอบด้วยข้อมูลชุดนี้เลย** เป็นช่องว่างของชุดข้อมูลทดสอบที่ควรบันทึกไว้
- **S4-9 = 36** เบอร์โทร 36 เบอร์ผูกลูกที่อยู่คนละโรงเรียน ซึ่งเป็นเคสที่ binding แบบอิงเบอร์รองรับโดยตั้งใจ (`line.service.js:261-268` ดึงลูกจากทุกแถว parents ที่ใช้เบอร์เดียวกัน โดยไม่จำกัดโรงเรียน) — ไม่ใช่ข้อบกพร่อง แต่เป็นข้อเท็จจริงที่ DPO ต้องเห็นตอนตอบ **D0-3** เพราะหมายความว่า LINE binding หนึ่งอันแสดงข้อมูลข้ามโรงเรียนได้ → **รอ D0-3**

---

## 8. Active / inactive consistency

> ตัวเลขจากข้อมูลสังเคราะห์

### 8.1 ความสอดคล้องของ tombstone

`is_deleted` กับ `deleted_at` ตรงกันทั้ง 7 ตาราง (students, schools, affiliations, vehicles, drivers, parents, users) — ไม่มีแถวที่ `is_deleted = 1` แต่ `deleted_at` ว่าง และไม่มีแถวที่ยังใช้งานแต่มี `deleted_at`

### 8.2 ตัวตรวจสถานะอื่น

| รหัสตรวจ | ตัวตรวจ | ผล |
|---|---|---:|
| S5-1 | ผู้ใช้ `is_active = 0` แต่ยังไม่ถูกลบ | 0 |
| S5-2 | ผู้ใช้ที่ถูกลบแต่ `is_active = 1` | 0 |
| S5-3 | binding ที่ active แต่มี `unbound_at` | 0 (ตารางว่าง) |
| S5-4 | binding ที่ปิดแล้วแต่ไม่มี `unbound_at` | 0 (ตารางว่าง) |
| S5-5 | binding ที่ active แต่ไม่มี `bound_at` | 0 (ตารางว่าง) |
| S5-6 | line_users ที่ verified แต่ไม่มี `linked_at` | 0 (ตารางว่าง) |
| S5-7 | assignment ที่ปิดแล้วแต่ไม่มี `end_date` | 0 |
| S5-8 | assignment ที่ active แต่ `end_date` ผ่านไปแล้ว | 0 |
| S5-9 | assignment ที่ active แต่ `valid_until` ผ่านไปแล้ว | 0 |
| S5-10 | assignment ที่ active แต่สถานะไม่ใช่ `AUTHORIZED` | 0 |
| S5-11 | assignment `AUTHORIZED` ที่ไม่มีผู้อนุมัติ | **60** |
| S5-12 | **นักเรียนที่ปิดทั้งรอบเช้าและรอบเย็น** | **3** |

**S5-12 = 3 (student id: 225, 231, 237)** — นักเรียนสามคนนี้มี `morning_enabled = 0` และ `evening_enabled = 0` พร้อมกัน `getRoster` กรองด้วย `AND s.morning_enabled = TRUE` หรือ `AND s.evening_enabled = TRUE` (`checkin.service.js:229-231`) จึงไม่มีรอบใดที่คนขับเห็นทั้งสามคนนี้ ทั้งที่ยังนับเป็นนักเรียนที่ใช้งานอยู่และผูกรถอยู่

**เป็นสภาพข้อมูลที่ตัวตรวจควรจับ ไม่ใช่ข้อบกพร่องของโค้ด** — โค้ดกรองตามที่สั่งอย่างถูกต้อง แต่ว่าสภาพ "นักเรียนที่ใช้งานอยู่แต่ไม่อยู่ในรอบใดเลย" ถือเป็น data defect ระดับใดหรือเป็นสภาพที่ยอมรับได้ (เช่น นักเรียนที่ผู้ปกครองรับส่งเอง) ขึ้นกับนิยาม absent/leave ที่ **C0-1** ต้องตอบ → **รอ C0-1**

### 8.3 สถานะการตรวจสภาพรถ

| verification_status | จำนวน | เอกสารหมดอายุอย่างน้อยหนึ่งใบ |
|---|---:|---:|
| ELIGIBLE | 15 | 3 |
| EXPIRING | 15 | 3 |
| INELIGIBLE | 15 | 3 |
| UNVERIFIED | 15 | 3 |

| รหัสตรวจ | ตัวตรวจ | ผล |
|---|---|---:|
| S5-13 | รถสถานะ `ELIGIBLE` ที่มีเอกสารหมดอายุแล้ว | **3** |
| S5-14 | รถที่มีสถานะแล้วแต่ไม่มี `verification_updated_at` | **45 / 45** |
| S5-15 | รถที่จำนวนนักเรียนเกิน `certified_capacity` | 0 |

รถทั้ง 60 คันมีวันหมดอายุครบทั้งสี่ฟิลด์ (`insurance_expiry`, `registration_expiry`, `compulsory_insurance_expiry`, `tax_expiry`) และมี `certified_capacity` ครบ นักเรียนต่อคันอยู่ระหว่าง 6-9 คน เฉลี่ย 6.08

**S5-13 (id: V-SYN15ddd58c9, V-SYN81b91e5b9, V-SYNb4873e1af)** — สามคันนี้ seeder เขียนสถานะลงตรง ๆ โดยไม่ผ่านตัวคำนวณ จึงเป็นลักษณะของข้อมูลทดสอบ **ไม่ได้ reproduce ผ่านแอป และไม่รายงานว่าเป็นข้อบกพร่อง**

แต่ตัวตรวจนี้มีค่าบน production เพราะ `refreshVehicleEligibility` ถูกเรียกแบบ event-driven เท่านั้น (จาก `driverShift.service.js:259,310`, `transport.service.js:386,442,491`, `vehicleVerification.service.js:955`) ไม่มี job ตามเวลา — เอกสารที่หมดอายุไปเฉย ๆ โดยไม่มี event มากระตุ้น จะทำให้สถานะที่เก็บไว้ค้างเป็น `ELIGIBLE` ได้ ความเสี่ยงนี้โค้ดเองก็รับรู้ (`utils/inspectionDates.js:1-12` เขียนว่า "could otherwise keep a bus ELIGIBLE well past a real certification window")

**ต้องมีผู้ตัดสินว่าสถานะที่ค้างแบบนี้ยอมรับได้หรือไม่ และใครรับผิดชอบให้คำนวณใหม่** — เรื่องนี้ใกล้เคียง **C0-2** (เจ้าของการอนุมัติ vehicle inspection) แต่ **ยังไม่มีข้อใดใน decision register ที่ตอบเรื่องรอบการคำนวณสถานะใหม่โดยตรง** ควรเพิ่มเป็นคำถามใหม่ ทีมเทคนิคตั้งกฎเองไม่ได้

---

## 9. ฟิลด์ที่ LINE ต้องใช้จริง (derive จากโค้ด)

> ตัวเลขจากข้อมูลสังเคราะห์

### 9.1 เงื่อนไขที่โค้ดบังคับ — ขั้นผูกบัญชี

จาก `line.service.js:107-122` (`findLinkablePhoneByStudentAndPhone`) และ `utils/studentImportClassifier.js:55-58`:

| เงื่อนไข | ที่มาในโค้ด |
|---|---|
| `parents.phone` ตรงกับที่ผู้ปกครองพิมพ์ **แบบตรงตัวอักษร** | `line.service.js:120` `WHERE p.phone = ?` |
| เบอร์ต้องเป็นตัวเลข 10 หลักหลัง normalize | `studentImportClassifier.js:58` |
| `parents.is_deleted = FALSE` | `line.service.js:120` |
| `parent_student.approved = TRUE` | `line.service.js:117` |
| `students.is_deleted = FALSE` | `line.service.js:118` |
| `students.student_code` ตรงกับที่พิมพ์ (fallback เป็น `CAST(id AS CHAR)`) | `line.service.js:118-119` |

ผลตรวจบน cohort ตั้งต้น (ผู้ปกครอง 360, นักเรียน 360):

| ตัวชี้วัด | ค่า |
|---|---:|
| ผู้ปกครองที่เบอร์ว่าง | 0 |
| ผู้ปกครองที่เบอร์เป็นตัวเลข 10 หลัก | 360 / 360 |
| ผู้ปกครองที่เบอร์มีอักขระที่ไม่ใช่ตัวเลข (ขีด เว้นวรรค) | 0 |
| ผู้ปกครองที่ชื่อว่าง | 0 |
| นักเรียนที่ `student_code` ว่าง | 0 |
| **S6-1 นักเรียนที่ฟิลด์ครบพอผูก LINE ได้** | **360 / 360 (100.00%)** |

> ข้อสังเกตที่สำคัญกว่าตัวเลข: การ join ใช้ `p.phone = lb.phone` แบบเทียบสตริงตรง ๆ ไม่มีการ normalize ตอน join ในชุดสังเคราะห์เบอร์ทุกเบอร์เป็นตัวเลขล้วน 10 หลักเหมือนกันหมด **เงื่อนไขนี้จึงไม่ถูกทดสอบเลย** บนข้อมูลจริงที่เบอร์อาจถูกบันทึกโดยมีขีดคั่น มีช่องว่างต่อท้าย หรือเป็นรูปแบบสากล ตัวตรวจ `phone_non_digit_chars` และ `phone_not_10_digits` (คิวรีใน §13 บล็อก S6) เป็นสองตัวที่ต้องดูก่อนเปิดใช้ LINE เพราะเบอร์ที่รูปแบบต่างกันแม้แต่อักขระเดียวจะทำให้ join ระหว่าง `parents.phone` กับ `line_bindings.phone` ไม่ติด และผู้ปกครองจะผูกบัญชีไม่สำเร็จโดยที่ระบบไม่ได้รายงานว่าข้อมูลผิด

### 9.2 เงื่อนไขที่โค้ดบังคับ — ขั้นแจ้งเตือน

จาก `checkin.service.js:398-419` ผู้รับแจ้งเตือนต้องผ่านครบทั้งสาย: `parent_student.approved = TRUE` → `parents` (ไม่ถูกลบ, เบอร์ไม่ว่าง) → `line_bindings` (เบอร์ตรง, `is_active = TRUE`) → `line_users` (`user_type = 'parent'`, `verified = TRUE`)

| รหัสตรวจ | ตัวตรวจ | ผล |
|---|---|---:|
| S6-2 | ผู้ปกครองที่มี binding ที่ยัง active | **0** |
| S6-3 | `line_bindings.phone` ที่ไม่ตรงกับผู้ปกครองคนใด | 0 |
| S6-4 | `line_bindings` ที่ไม่มีแถวใน `line_users` | 0 |
| S6-5 | binding active ที่ line_user ยังไม่ verified หรือไม่ใช่ parent | 0 |
| S6-6 | `line_users` ประเภท parent ที่ไม่มี `parent_id` | 0 |
| S6-7 | `line_users.parent_id` ที่ไม่ใช่ผู้ปกครองที่ยังใช้งาน | 0 |
| S6-8 | ค่า legacy `parents.line_user_id` ที่ยังค้าง | 0 |
| S6-9 | ค่า legacy `drivers.line_user_id` ที่ยังค้าง | 0 |
| S6-10 | **นักเรียนที่การแจ้งเตือนเช็กอินจะส่งถึงผู้ปกครองได้จริง** | **0 / 360 (0.00%)** |

### 9.3 อ่านผล — ครึ่ง LINE ของเครื่องมือนี้ยังไม่ถูกทดสอบ

`line_bindings`, `line_users` และ `consent_records` **ว่างเปล่าทั้งสามตาราง** ในชุดข้อมูลนี้ ค่า 0 ของ S6-2 ถึง S6-10 จึงเป็น 0 เพราะไม่มีข้อมูลให้ตรวจ ไม่ใช่เพราะข้อมูลสะอาด

พูดให้ตรง: **ตัวตรวจ S6-3, S6-4, S6-5, S6-7 ยังพิสูจน์ไม่ได้ว่าทำงาน** เพราะไม่เคยเจอแถวเลยแม้แต่แถวเดียว ต่างจากตัวตรวจในหัวข้ออื่นที่มีข้อมูลจริงให้กรอง ข้อนี้ต้องบันทึกไว้เป็นข้อจำกัดของรอบนี้ และควรแก้ด้วยการเพิ่ม LINE fixture ลงใน seeder ก่อนจะอ้างว่าชุดตรวจนี้ครบ

ส่วน D6 = 0% ใน §3 จะถือเป็นข้อบกพร่องหรือไม่ ขึ้นกับว่า LINE binding เป็นข้อบังคับของทุกคนหรือเป็น opt-in และ consent ชนิดใดเป็นชนิดหลัก → **รอ C0-4** (สถานะ `FEATURE_PARENT_CONSENT_REQUIRED` / `FEATURE_VEHICLE_QR`), **รอ D0-3** (ฐานกฎหมาย) และ **รอ D0-7** (canonical parent consent type)

---

## 10. ฟิลด์ที่ check-in ต้องใช้จริง (derive จากโค้ด)

> ตัวเลขจากข้อมูลสังเคราะห์

### 10.1 สายที่ต้องครบเพื่อให้เช็กอินนักเรียนหนึ่งคนได้

จาก `checkin.service.js:120-193` (resolve รถของคนขับ), `:229-286` (`getRoster`) และ `:318-395` (transaction เช็กอิน) โดย `FEATURE_DRIVER_SHIFT_SELECTION` ไม่ได้ตั้งค่าใน `sandbox.env` จึงเป็น `false` และใช้เส้นทาง shift-independent:

| เงื่อนไข | ที่มาในโค้ด |
|---|---|
| บัญชีคนขับ resolve รถได้หนึ่งคันเท่านั้น (relational หรือ legacy plate) | `checkin.service.js:126-193` |
| รถต้อง `is_deleted = FALSE` และมี active assignment | `checkin.service.js:129-131, 170-183` |
| นักเรียน `is_deleted = FALSE` และ `vehicle_id` ตรงกับรถที่ resolve ได้ | `checkin.service.js:322-326` |
| นักเรียนเปิดรอบที่กำลังเช็ก | `checkin.service.js:229-231` |
| `students.cid_hash` ต้องมีค่า (ถูกคัดลอกลง `checkin_logs` และ `daily_status`) | `checkin.service.js:355-357, 375-390` |
| term id ของวันนั้น (ได้จาก convention ตามวันที่ ไม่ใช่จากตาราง) | `term.service.js:36-63` |

### 10.2 ผลตรวจ

| รหัสตรวจ | ตัวตรวจ | ผล (snapshot) |
|---|---|---:|
| S7-1 | นักเรียนที่ใช้งานอยู่และผูกรถ | 363 |
| S7-2 | ขนาด roster รอบเช้า | 345 |
| S7-3 | ขนาด roster รอบเย็น | 311 |
| S7-4 | นักเรียนที่ไม่เปิดรอบใดเลย | **3** |
| S7-5 | นักเรียนที่ `cid_hash` ว่าง | 0 |
| S7-6 | นักเรียนที่ resolve ชื่อโรงเรียนไม่ได้ | 0 |
| S7-7 | บัญชีคนขับที่ resolve รถได้ทาง relational | 60 |
| S7-8 | บัญชีคนขับที่ resolve ได้เฉพาะทาง legacy plate | 0 |
| S7-9 | **บัญชีคนขับที่ resolve ไม่ได้เลยทั้งสองทาง** | **6** |
| S7-10 | **รถที่ใช้งานอยู่แต่ไม่มี `qr_token`** | **60 / 60** |
| S7-13 | `morning_done = 1` แต่ไม่มี `morning_ts` | 0 |
| S7-14 | `evening_done = 1` แต่ไม่มี `evening_ts` | 0 |
| S7-15 | `daily_status.vehicle_id` ต่างจากรถของนักเรียน | 0 |
| S7-16 | `checkin_logs.checked_by` ที่ไม่ใช่ผู้ใช้ที่มีอยู่ | 0 |
| S7-17 | `checkin_logs` ที่ `term_id` เป็น NULL | 0 |
| S7-18 | `term_id` ที่ผิดรูปแบบ `NNNN-[123]` | 0 |

บน cohort ตั้งต้น: นักเรียน 357/360 (99.17%) ผ่านครบสาย ที่ขาดคือสามคนใน §8.2

**S7-10 = 60/60** รถทุกคันไม่มี `qr_token` — จะถือเป็นข้อบกพร่องหรือไม่ ขึ้นกับสถานะของ `FEATURE_VEHICLE_QR` และ `FEATURE_QR_LEVEL3` ถ้าถูก defer ค่า 0 คือคำตอบที่ถูกต้อง → **รอ C0-4**

### 10.3 daily_status ที่ไม่มี checkin_logs คู่ (S7-11 = 30 แถว)

30 แถวนี้เป็นของนักเรียน 3 คน (id 225, 231, 237) × 10 วัน และ **ทุกแถวมี `morning_done = 0` และ `evening_done = 0`** — เป็นแถวโครงที่ seeder สร้างให้นักเรียนทุกคนทุกวัน ทั้งที่สามคนนี้ไม่ได้เปิดรอบใดเลยจึงไม่มี log

ตรวจแล้วว่า **แอปพลิเคชันเขียน `daily_status` ได้จากจุดเดียวเท่านั้น** คือใน transaction ของ check-in ที่เขียน `checkin_logs` พร้อมกัน (`checkin.service.js:375-390`) และแก้ค่าอีกจุดเดียวคือ path void ที่เขียน compensating log ก่อนเสมอ (`checkin.service.js:1238-1256`) ไม่มี code path ใดสร้าง `daily_status` โดยไม่มี log ดังนั้น 30 แถวนี้เป็นผลของ seeder แน่นอน **ไม่ใช่ข้อบกพร่อง**

และนั่นทำให้ตัวตรวจ S7-11 มีค่าสูงบน production เพราะมันจับได้ว่ามีการเขียน `daily_status` นอกเส้นทางของแอป (เช่น การแก้ฐานตรง ๆ) ซึ่งเป็นสิ่งที่ Phase 6 checkbox 5 ห้ามไว้ ("แก้ข้อมูลผ่าน UI/audit trail เท่านั้น")

### 10.4 term_id ไม่ตรงกับ convention ของวันที่ (D14)

`term.service.js:36-63` กำหนด term จาก **วันที่บนปฏิทินกรุงเทพของแถวนั้น** ไม่ใช่จาก pointer ใด และเป็นฟังก์ชัน total ที่ครอบคลุมทุกวันรวมช่วงปิดเทอม เทียบค่าที่เก็บจริงกับ convention ได้:

| `term_id` ที่เก็บ | convention ของวันที่ | จำนวนแถว |
|---|---|---:|
| `2568-2` | `2569-1` | **6,500** |
| `2569-1` | `2569-1` | 8 |

6,500 แถวคือ log ที่ seeder เขียนย้อนหลังสำหรับวันที่ 26 ส.ค. – 4 ก.ย. 2569 แล้ว stamp ด้วยค่า env `CURRENT_TERM=2568-2` ส่วน 8 แถวที่ตรง convention คือแถวที่ backend เขียนสดระหว่างการทดสอบพร้อมกัน — **แอปพลิเคชัน stamp ถูก seeder stamp ผิด**

ตาราง `terms` ว่าง 0 แถว ซึ่ง **ไม่ทำให้ระบบพัง** เพราะชั้น convention เป็น total อยู่แล้วโดยเจตนา (comment ที่ `term.service.js:1-17` อธิบายว่าออกแบบมาแทน pointer ที่เคยค้าง) แต่แปลว่าชั้น window ที่ผู้ดูแลแก้ได้ (`terms.start_date`/`end_date`) ไม่มีข้อมูลเลยในฐานนี้

**บน production ตัวตรวจนี้คือของจริง** — ถ้าเจอ log ที่ `term_id` ไม่ตรง convention ของ `check_date` แปลว่ามีข้อมูลที่ถูก stamp ด้วย term ผิด ซึ่งจะทำให้รายงานรายภาคเรียนคลาดเคลื่อน จะแก้ย้อนหลังหรือไม่ ใครอนุมัติการแก้ข้อมูลจริง เป็นเรื่องของ change approval → **รอ C0-13**

### 10.5 การกระจายของ log ที่มีอยู่

| status | session | source | จำนวน |
|---|---|---|---:|
| CHECKED_IN | morning | web | 3,420 |
| CHECKED_IN | evening | web | 1 |
| CHECKED_OUT | evening | web | 3,081 |
| CANCELLED | evening | web | 1 |

ไม่มี log ที่ `source = 'line'` หรือ `'auto'` และไม่มี `status = 'ABSENT'` เลย — อีกหนึ่งช่องว่างของชุดข้อมูลทดสอบ ตัวตรวจที่เกี่ยวกับ absent/void จึงยังไม่ถูกทดสอบด้วยข้อมูลจริง

---

## 11. เรื่องที่ตัดสินไม่ได้ในเอกสารนี้

| หัวข้อ | ทำไมตัดสินไม่ได้ | รอข้อ |
|---|---|---|
| ฟิลด์ใดเป็น "จำเป็น" ตามนโยบาย (ต่างจาก "จำเป็นเชิงเทคนิค" ที่ derive จากโค้ดแล้วใน §9-§10) | ต้องมี data inventory และวัตถุประสงค์ต่อชุดข้อมูลก่อน | **รอ D0-2** |
| retention — แถวใดเก่าเกินกำหนดและต้องถูกลบ/archive รวมถึง `parent_student` ที่ค้างหลัง soft-delete (§6.4) | ยังไม่มีระยะเก็บรักษาต่อชุดข้อมูล | **รอ D0-8** |
| severity ของแต่ละ finding และเกณฑ์ผ่านของ Phase 6 exit gate | severity scheme ยังไม่ถูกกำหนด | **รอ C0-13** |
| น้ำหนักของแต่ละมิติในคะแนนรวม §3 | เหตุผลเดียวกับข้างบน | **รอ C0-13** |
| จะแก้ `term_id` ย้อนหลังหรือไม่ ใครอนุมัติ (§10.4) | change approval ของการแก้ข้อมูลจริง | **รอ C0-13** |
| โรงเรียนละ 21 บัญชีสิทธิ์เต็มถูกหรือผิด (§5.1ก) | ต้องรู้ก่อนว่าใครเป็นผู้เช็กเด็ก และบัญชีครูต้องถูกจำกัด scope หรือไม่ | **รอ C0-1**, **รอ C0-5** |
| active assignment ต้องมี `authorized_by` ครบหรือไม่ (§5.1ข) | ต้องรู้เจ้าของการอนุมัติก่อน | **รอ C0-2** |
| นักเรียนที่ไม่เปิดรอบใดเลยถือเป็น defect หรือสภาพที่ยอมรับได้ (§8.2) | ขึ้นกับนิยาม absent/leave | **รอ C0-1** |
| `qr_token` ว่างทั้ง 60 คันถือเป็น defect หรือไม่ (§10.2) | ขึ้นกับสถานะ feature flag QR | **รอ C0-4** |
| LINE binding เป็นข้อบังคับหรือ opt-in และ consent ชนิดใดเป็นหลัก (§9.3) | ขึ้นกับ scope และฐานกฎหมาย | **รอ C0-4**, **รอ D0-3**, **รอ D0-7** |
| LINE binding ที่ข้ามโรงเรียนได้ (§7.3) ยอมรับได้หรือไม่ | ขอบเขตการเปิดเผยข้อมูลข้ามโรงเรียน | **รอ D0-3** |
| ต้องมีการคำนวณ `verification_status` ใหม่ตามรอบเวลาหรือไม่ (§8.3) | **ยังไม่มีข้อใดใน decision register ครอบคลุมโดยตรง** — ใกล้เคียง C0-2 ที่สุด ควรเพิ่มเป็นคำถามใหม่ | — |

---

## 12. สิ่งที่ชุดตรวจนี้ยังไม่ครอบคลุม

บันทึกไว้เพื่อไม่ให้เข้าใจผิดว่าครบแล้ว:

1. **ตัวตรวจฝั่ง LINE ยังไม่ถูกพิสูจน์** — S6-3, S6-4, S6-5, S6-7 ไม่เคยเจอแถวเลยเพราะ `line_bindings`/`line_users` ว่าง (§9.3)
2. **เคสพ่อแม่ใช้เบอร์เดียวกันยังไม่ถูกทดสอบ** — S4-8 = 0 ทั้งที่เป็นเคสที่ binding แบบอิงเบอร์ออกแบบมารองรับโดยเฉพาะ (§7.3)
3. **เบอร์โทรรูปแบบไม่มาตรฐานยังไม่ถูกทดสอบ** — ทุกเบอร์ในชุดนี้เป็นตัวเลข 10 หลักล้วน (§9.1)
4. **ไม่มี log `ABSENT`, `source='line'`, `source='auto'`** จึงยังไม่ได้ตรวจเส้นทางการลาและการยกเลิก (§10.5)
5. **ตารางที่ว่างและยังไม่มีตัวตรวจที่ยิงได้จริง** — `consent_records` 0, `notifications` 0, `student_leaves` 0, `driver_qualifications` 0, `vehicle_inspections` 0, `student_pickup_points` 0
6. **provenance ของการนำเข้ายังบางมาก** — `import_batches` 2 แถว และนักเรียนเพียง 5 คนมี `import_batch_id` ที่เหลือ 364 คนไม่มี ทำให้ยังตรวจการผูก certification เข้ากับ batch (Phase 6 checkbox 4) ไม่ได้
7. **audit_logs มีเพียง 128 แถว** ส่วนใหญ่เกิดจากการทดสอบวันนี้ จึงยังตรวจ audit coverage ตาม Phase 6 checkbox 5 ไม่ได้
8. **ไม่ได้ตรวจอะไรเลยที่ต้องอ่านข้อมูลจริง** — ตามข้อจำกัดของงาน

---

## 13. ภาคผนวก — ชุด SQL ที่ใช้

**เงื่อนไขการนำไปใช้**

- ชุดนี้ **อ่านอย่างเดียวทั้งหมด** ไม่มีคำสั่งเขียน และห่อด้วย `READ ONLY` + `CONSISTENT SNAPSHOT` เพื่อให้ทุกตัวเลขมาจากจุดเวลาเดียวกัน
- ผลลัพธ์เป็น count / percentage / id เท่านั้น **ไม่ดึงชื่อ เบอร์โทร เลขบัตร ทะเบียนรถ หรือ LINE user id ออกมาแม้แต่ฟิลด์เดียว** ถ้าจะแก้คิวรีก่อนนำไปรัน ต้องรักษาคุณสมบัตินี้ไว้
- **การนำชุดนี้ไปรันกับฐานข้อมูล production ไม่ใช่งานของรอบนี้ และไม่ได้รับอนุญาตให้ทำในสภาพแวดล้อมนี้** ผู้ที่จะรันต้องเป็นผู้มีอำนาจตามที่ Phase 6 checkbox 3 กำหนด และต้องบันทึก commit, เวลา, และผู้รัน กำกับผลทุกครั้ง
- ก่อนรันกับ production ให้ตรวจสองอย่างก่อน: (1) ไม่มีการเขียนแข่งในช่วงเวลาที่รัน หรือยอมรับว่าเป็น point-in-time snapshot แล้วระบุเวลากำกับผล (ดู §2.3) (2) บล็อกใน §13.1 เป็นคิวรีเฉพาะของ sandbox รอบนี้ **ห้ามนำไปรวมกับชุดหลัก**

```sql
-- ============================================================================
-- Data Quality Instrument (A1-7) — READ ONLY
-- ห้ามแก้ให้ดึงฟิลด์ที่เป็น PII ออกมา: ให้คงเป็น count / percentage / id เท่านั้น
-- ============================================================================
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET SESSION TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;
SELECT NOW() AS snapshot_taken_at, DATABASE() AS db;

-- ── S1 ปริมาณข้อมูล ─────────────────────────────────────────────────────────
SELECT 'affiliations' AS entity, COUNT(*) AS total, SUM(is_deleted=0) AS active, SUM(is_deleted=1) AS soft_deleted FROM affiliations
UNION ALL SELECT 'schools',  COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM schools
UNION ALL SELECT 'vehicles', COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM vehicles
UNION ALL SELECT 'drivers',  COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM drivers
UNION ALL SELECT 'students', COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM students
UNION ALL SELECT 'parents',  COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM parents
UNION ALL SELECT 'users',    COUNT(*), SUM(is_deleted=0), SUM(is_deleted=1) FROM users
UNION ALL SELECT 'parent_student', COUNT(*), SUM(approved=1), NULL FROM parent_student
UNION ALL SELECT 'line_bindings',  COUNT(*), SUM(is_active=1), SUM(is_active=0) FROM line_bindings
UNION ALL SELECT 'line_users',     COUNT(*), SUM(verified=1), SUM(verified=0) FROM line_users
UNION ALL SELECT 'driver_vehicle_assignments', COUNT(*), SUM(is_active=1), SUM(is_active=0) FROM driver_vehicle_assignments
UNION ALL SELECT 'checkin_logs',   COUNT(*), NULL, NULL FROM checkin_logs
UNION ALL SELECT 'daily_status',   COUNT(*), NULL, NULL FROM daily_status
UNION ALL SELECT 'consent_records',COUNT(*), SUM(consent_status='granted'), SUM(consent_status='withdrawn') FROM consent_records
UNION ALL SELECT 'terms', COUNT(*), SUM(is_current=1), NULL FROM terms;

-- ── S2 school ↔ affiliation mapping ─────────────────────────────────────────
SELECT COUNT(*) AS schools_active, SUM(affiliation_id IS NULL) AS aff_null,
       ROUND(100.0*SUM(affiliation_id IS NOT NULL)/NULLIF(COUNT(*),0),2) AS pct_mapped
FROM schools WHERE is_deleted=0;

SELECT 'S2-1 school_active_points_to_deleted_affiliation' AS chk, COUNT(*) AS n
  FROM schools s JOIN affiliations a ON a.id=s.affiliation_id WHERE s.is_deleted=0 AND a.is_deleted=1
UNION ALL SELECT 'S2-2 school_affiliation_id_not_in_affiliations', COUNT(*)
  FROM schools s LEFT JOIN affiliations a ON a.id=s.affiliation_id WHERE s.affiliation_id IS NOT NULL AND a.id IS NULL
UNION ALL SELECT 'S2-3 active_students_in_soft_deleted_school', COUNT(*)
  FROM students st JOIN schools sc ON sc.id=st.school_id WHERE st.is_deleted=0 AND sc.is_deleted=1
UNION ALL SELECT 'S2-4 active_students_in_school_without_affiliation', COUNT(*)
  FROM students st JOIN schools sc ON sc.id=st.school_id WHERE st.is_deleted=0 AND sc.affiliation_id IS NULL
UNION ALL SELECT 'S2-5 affiliations_with_zero_active_schools', COUNT(*)
  FROM affiliations a WHERE a.is_deleted=0
   AND NOT EXISTS (SELECT 1 FROM schools s WHERE s.affiliation_id=a.id AND s.is_deleted=0);

SELECT a.id AS affiliation_id, COUNT(s.id) AS schools_total, SUM(s.is_deleted=0) AS schools_active,
       (SELECT COUNT(*) FROM students st JOIN schools sc2 ON sc2.id=st.school_id
         WHERE sc2.affiliation_id=a.id AND st.is_deleted=0) AS students_active
FROM affiliations a LEFT JOIN schools s ON s.affiliation_id=a.id GROUP BY a.id ORDER BY a.id;

-- ── S3 orphan / ownership ───────────────────────────────────────────────────
SELECT COUNT(*) AS students_active, SUM(school_id IS NULL) AS no_school, SUM(vehicle_id IS NULL) AS no_vehicle,
       SUM(student_code IS NULL OR TRIM(student_code)='') AS no_student_code,
       SUM(cid_hash IS NULL OR TRIM(cid_hash)='') AS no_cid_hash,
       SUM(grade IS NULL OR TRIM(grade)='') AS no_grade,
       SUM(classroom IS NULL OR TRIM(classroom)='') AS no_classroom,
       SUM(term_id IS NULL) AS no_term_id
FROM students WHERE is_deleted=0;

SELECT 'S3-1 students_active_no_parent_link' AS chk, COUNT(*) AS n
  FROM students st WHERE st.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id=st.id)
UNION ALL SELECT 'S3-2 students_active_no_APPROVED_parent_link', COUNT(*)
  FROM students st WHERE st.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id=st.id AND ps.approved=1)
UNION ALL SELECT 'S3-3 students_active_no_parent_with_phone', COUNT(*)
  FROM students st WHERE st.is_deleted=0 AND NOT EXISTS (
    SELECT 1 FROM parent_student ps JOIN parents p ON p.id=ps.parent_id
     WHERE ps.student_id=st.id AND ps.approved=1 AND p.is_deleted=0 AND p.phone IS NOT NULL AND TRIM(p.phone)<>'')
UNION ALL SELECT 'S3-4 students_fully_orphan', COUNT(*)
  FROM students st WHERE st.is_deleted=0 AND st.school_id IS NULL AND st.vehicle_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id=st.id)
UNION ALL SELECT 'S3-5 parents_active_no_student_link', COUNT(*)
  FROM parents p WHERE p.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM parent_student ps WHERE ps.parent_id=p.id)
UNION ALL SELECT 'S3-6 parent_student_to_deleted_student', COUNT(*)
  FROM parent_student ps JOIN students s ON s.id=ps.student_id WHERE s.is_deleted=1
UNION ALL SELECT 'S3-7 parent_student_to_deleted_parent', COUNT(*)
  FROM parent_student ps JOIN parents p ON p.id=ps.parent_id WHERE p.is_deleted=1
UNION ALL SELECT 'S3-8 parent_student_approved_without_approver', COUNT(*)
  FROM parent_student WHERE approved=1 AND (approved_by IS NULL OR approved_at IS NULL)
UNION ALL SELECT 'S3-9 active_students_on_soft_deleted_vehicle', COUNT(*)
  FROM students st JOIN vehicles v ON v.id=st.vehicle_id WHERE st.is_deleted=0 AND v.is_deleted=1
UNION ALL SELECT 'S3-10 vehicles_active_no_students', COUNT(*)
  FROM vehicles v WHERE v.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM students s WHERE s.vehicle_id=v.id AND s.is_deleted=0)
UNION ALL SELECT 'S3-11 vehicles_active_no_ACTIVE_driver_assignment', COUNT(*)
  FROM vehicles v WHERE v.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.vehicle_id=v.id AND d.is_active=1)
UNION ALL SELECT 'S3-12 vehicles_with_students_but_no_driver', COUNT(*)
  FROM vehicles v WHERE v.is_deleted=0
   AND EXISTS (SELECT 1 FROM students s WHERE s.vehicle_id=v.id AND s.is_deleted=0)
   AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.vehicle_id=v.id AND d.is_active=1)
UNION ALL SELECT 'S3-13 drivers_active_no_ACTIVE_assignment', COUNT(*)
  FROM drivers d WHERE d.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.driver_id=d.id AND a.is_active=1)
UNION ALL SELECT 'S3-14 drivers_with_MULTIPLE_active_vehicles', COUNT(*) FROM (
    SELECT a.driver_id FROM driver_vehicle_assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.is_deleted=0
     WHERE a.is_active=1 GROUP BY a.driver_id HAVING COUNT(DISTINCT a.vehicle_id)>1) x
UNION ALL SELECT 'S3-15 dva_active_on_soft_deleted_vehicle', COUNT(*)
  FROM driver_vehicle_assignments a JOIN vehicles v ON v.id=a.vehicle_id WHERE a.is_active=1 AND v.is_deleted=1
UNION ALL SELECT 'S3-16 dva_active_on_soft_deleted_driver', COUNT(*)
  FROM driver_vehicle_assignments a JOIN drivers d ON d.id=a.driver_id WHERE a.is_active=1 AND d.is_deleted=1
UNION ALL SELECT 'S3-17 users_SCHOOL_scope_id_not_in_schools', COUNT(*)
  FROM users u LEFT JOIN schools s ON s.id=u.scope_id WHERE u.is_deleted=0 AND u.scope_type='SCHOOL' AND s.id IS NULL
UNION ALL SELECT 'S3-18 users_AFFILIATION_scope_id_not_found', COUNT(*)
  FROM users u LEFT JOIN affiliations a ON a.id=u.scope_id WHERE u.is_deleted=0 AND u.scope_type='AFFILIATION' AND a.id IS NULL
UNION ALL SELECT 'S3-19 users_role_driver_without_driver_id', COUNT(*)
  FROM users WHERE is_deleted=0 AND role='driver' AND driver_id IS NULL
UNION ALL SELECT 'S3-20 users_driver_id_to_deleted_driver', COUNT(*)
  FROM users u JOIN drivers d ON d.id=u.driver_id WHERE u.is_deleted=0 AND d.is_deleted=1
UNION ALL SELECT 'S3-21 schools_active_without_school_user', COUNT(*)
  FROM schools sc WHERE sc.is_deleted=0 AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.is_deleted=0 AND u.role='school' AND u.scope_type='SCHOOL' AND u.scope_id=sc.id)
UNION ALL SELECT 'S3-22 daily_status_student_id_null', COUNT(*) FROM daily_status WHERE student_id IS NULL
UNION ALL SELECT 'S3-23 daily_status_orphan_student', COUNT(*)
  FROM daily_status ds LEFT JOIN students s ON s.id=ds.student_id WHERE ds.student_id IS NOT NULL AND s.id IS NULL
UNION ALL SELECT 'S3-24 checkin_logs_orphan_student', COUNT(*)
  FROM checkin_logs cl LEFT JOIN students s ON s.id=cl.student_id WHERE cl.student_id IS NOT NULL AND s.id IS NULL
UNION ALL SELECT 'S3-25 checkin_logs_term_id_not_in_terms', COUNT(*)
  FROM checkin_logs cl LEFT JOIN terms t ON t.id=cl.term_id WHERE cl.term_id IS NOT NULL AND t.id IS NULL
UNION ALL SELECT 'S3-26 checkin_logs_vehicle_ne_student_vehicle', COUNT(*)
  FROM checkin_logs cl JOIN students s ON s.id=cl.student_id WHERE cl.vehicle_id <> s.vehicle_id;

-- ── S4 duplicate ────────────────────────────────────────────────────────────
SELECT 'S4-1 students school_id+student_code' AS chk, COUNT(*) AS dup_groups, COALESCE(SUM(c),0) AS rows_involved FROM (
  SELECT school_id, student_code, COUNT(*) c FROM students WHERE is_deleted=0 AND student_code IS NOT NULL
   GROUP BY school_id, student_code HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-2 students cid_hash', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT cid_hash, COUNT(*) c FROM students WHERE is_deleted=0 GROUP BY cid_hash HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-3 student_code reused across schools', COUNT(*), 0 FROM (
  SELECT student_code FROM students WHERE is_deleted=0 AND student_code IS NOT NULL
   GROUP BY student_code HAVING COUNT(DISTINCT school_id)>1) x
UNION ALL SELECT 'S4-4 students same name in same school', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT school_id, first_name, last_name, COUNT(*) c FROM students WHERE is_deleted=0
   GROUP BY school_id, first_name, last_name HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-5 vehicles normalized_plate', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT normalized_plate, COUNT(*) c FROM vehicles WHERE is_deleted=0 GROUP BY normalized_plate HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-6 vehicles canonical_plate', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT canonical_plate, COUNT(*) c FROM vehicles WHERE is_deleted=0 AND canonical_plate IS NOT NULL
   GROUP BY canonical_plate HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-7 vehicles canonical_plate NULL', COUNT(*), 0
  FROM vehicles WHERE is_deleted=0 AND (canonical_plate IS NULL OR TRIM(canonical_plate)='')
UNION ALL SELECT 'S4-8 parents same phone', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT phone, COUNT(*) c FROM parents WHERE is_deleted=0 AND phone IS NOT NULL AND TRIM(phone)<>''
   GROUP BY phone HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-9 phone spanning >1 school', COUNT(*), 0 FROM (
  SELECT p.phone FROM parents p JOIN parent_student ps ON ps.parent_id=p.id JOIN students s ON s.id=ps.student_id
   WHERE p.is_deleted=0 AND s.is_deleted=0 AND p.phone IS NOT NULL AND TRIM(p.phone)<>''
   GROUP BY p.phone HAVING COUNT(DISTINCT s.school_id)>1) x
UNION ALL SELECT 'S4-10 parents same name+phone', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT name, phone, COUNT(*) c FROM parents WHERE is_deleted=0 GROUP BY name, phone HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-11 students with >1 parent row', COUNT(*), 0 FROM (
  SELECT student_id FROM parent_student GROUP BY student_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-12 parents with >1 child', COUNT(*), 0 FROM (
  SELECT parent_id FROM parent_student GROUP BY parent_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-13 drivers same phone', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT phone, COUNT(*) c FROM drivers WHERE is_deleted=0 AND phone IS NOT NULL AND TRIM(phone)<>''
   GROUP BY phone HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-14 drivers same name', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT name, COUNT(*) c FROM drivers WHERE is_deleted=0 GROUP BY name HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-15 users username case-insensitive', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT LOWER(username) u, COUNT(*) c FROM users WHERE is_deleted=0 GROUP BY LOWER(username) HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-16 >1 full school account per school', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT scope_id, COUNT(*) c FROM users
   WHERE is_deleted=0 AND role='school' AND scope_type='SCHOOL' AND grade_scope IS NULL
   GROUP BY scope_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-17 line_users same parent_id', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT parent_id, COUNT(*) c FROM line_users WHERE parent_id IS NOT NULL GROUP BY parent_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-18 daily_status date+student', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT check_date, student_id, COUNT(*) c FROM daily_status GROUP BY check_date, student_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-19 checkin_logs date+student+session+status', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT check_date, student_id, session, status, COUNT(*) c FROM checkin_logs
   GROUP BY check_date, student_id, session, status HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-20 dva active driver+vehicle', COUNT(*), COALESCE(SUM(c),0) FROM (
  SELECT driver_id, vehicle_id, COUNT(*) c FROM driver_vehicle_assignments WHERE is_active=1
   GROUP BY driver_id, vehicle_id HAVING COUNT(*)>1) x
UNION ALL SELECT 'S4-21 vehicle with >1 active driver', COUNT(*), 0 FROM (
  SELECT vehicle_id FROM driver_vehicle_assignments WHERE is_active=1
   GROUP BY vehicle_id HAVING COUNT(DISTINCT driver_id)>1) x;

-- ── S5 active / inactive ────────────────────────────────────────────────────
SELECT role, scope_type, IF(grade_scope IS NULL,'no','yes') AS grade_scope_set, COUNT(*) AS n,
       SUM(is_active=1) AS is_active, SUM(is_deleted=1) AS deleted, SUM(last_login IS NULL) AS never_logged_in
FROM users GROUP BY role, scope_type, grade_scope_set ORDER BY role;

SELECT 'students' AS entity, SUM(is_deleted=1 AND deleted_at IS NULL) AS deleted_without_ts,
       SUM(is_deleted=0 AND deleted_at IS NOT NULL) AS active_with_ts FROM students
UNION ALL SELECT 'schools',      SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM schools
UNION ALL SELECT 'affiliations', SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM affiliations
UNION ALL SELECT 'vehicles',     SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM vehicles
UNION ALL SELECT 'drivers',      SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM drivers
UNION ALL SELECT 'parents',      SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM parents
UNION ALL SELECT 'users',        SUM(is_deleted=1 AND deleted_at IS NULL), SUM(is_deleted=0 AND deleted_at IS NOT NULL) FROM users;

SELECT 'S5-1 users is_active=0 but not deleted' AS chk, COUNT(*) AS n FROM users WHERE is_active=0 AND is_deleted=0
UNION ALL SELECT 'S5-2 users deleted but is_active=1', COUNT(*) FROM users WHERE is_deleted=1 AND is_active=1
UNION ALL SELECT 'S5-3 line_bindings active with unbound_at', COUNT(*) FROM line_bindings WHERE is_active=1 AND unbound_at IS NOT NULL
UNION ALL SELECT 'S5-4 line_bindings inactive without unbound_at', COUNT(*) FROM line_bindings WHERE is_active=0 AND unbound_at IS NULL
UNION ALL SELECT 'S5-5 line_bindings active without bound_at', COUNT(*) FROM line_bindings WHERE is_active=1 AND bound_at IS NULL
UNION ALL SELECT 'S5-6 line_users verified without linked_at', COUNT(*) FROM line_users WHERE verified=1 AND linked_at IS NULL
UNION ALL SELECT 'S5-7 dva inactive without end_date', COUNT(*) FROM driver_vehicle_assignments WHERE is_active=0 AND end_date IS NULL
UNION ALL SELECT 'S5-8 dva active with past end_date', COUNT(*) FROM driver_vehicle_assignments WHERE is_active=1 AND end_date IS NOT NULL AND end_date < CURDATE()
UNION ALL SELECT 'S5-9 dva active with past valid_until', COUNT(*) FROM driver_vehicle_assignments WHERE is_active=1 AND valid_until IS NOT NULL AND valid_until < CURDATE()
UNION ALL SELECT 'S5-10 dva active not AUTHORIZED', COUNT(*) FROM driver_vehicle_assignments WHERE is_active=1 AND authorization_status<>'AUTHORIZED'
UNION ALL SELECT 'S5-11 dva AUTHORIZED without authorizer', COUNT(*) FROM driver_vehicle_assignments WHERE authorization_status='AUTHORIZED' AND (authorized_by IS NULL OR authorized_at IS NULL)
UNION ALL SELECT 'S5-12 students on neither session', COUNT(*) FROM students WHERE is_deleted=0 AND morning_enabled=0 AND evening_enabled=0;

SELECT verification_status, COUNT(*) AS n,
       SUM(insurance_expiry IS NULL) AS no_ins_exp, SUM(registration_expiry IS NULL) AS no_reg_exp,
       SUM(compulsory_insurance_expiry IS NULL) AS no_cmp_exp, SUM(tax_expiry IS NULL) AS no_tax_exp,
       SUM(certified_capacity IS NULL) AS no_capacity,
       SUM(insurance_expiry < CURDATE() OR registration_expiry < CURDATE()
        OR compulsory_insurance_expiry < CURDATE() OR tax_expiry < CURDATE()) AS any_doc_expired
FROM vehicles WHERE is_deleted=0 GROUP BY verification_status;

SELECT 'S5-13 ELIGIBLE with an expired document' AS chk, COUNT(*) AS n FROM vehicles
 WHERE is_deleted=0 AND verification_status='ELIGIBLE'
   AND (insurance_expiry < CURDATE() OR registration_expiry < CURDATE()
     OR compulsory_insurance_expiry < CURDATE() OR tax_expiry < CURDATE())
UNION ALL SELECT 'S5-14 status set without verification_updated_at', COUNT(*) FROM vehicles
 WHERE is_deleted=0 AND verification_status<>'UNVERIFIED' AND verification_updated_at IS NULL
UNION ALL SELECT 'S5-15 assigned students exceed certified_capacity', COUNT(*) FROM (
  SELECT v.id FROM vehicles v JOIN students s ON s.vehicle_id=v.id AND s.is_deleted=0
   WHERE v.is_deleted=0 AND v.certified_capacity IS NOT NULL
   GROUP BY v.id, v.certified_capacity HAVING COUNT(s.id) > v.certified_capacity) x;

-- ── S6 ฟิลด์ที่ LINE ต้องใช้ (derive จาก line.service.js / checkin.service.js) ──
SELECT COUNT(*) AS parents_active,
       SUM(phone IS NULL OR TRIM(phone)='') AS phone_missing,
       SUM(phone IS NOT NULL AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]',''))=10) AS phone_10_digits,
       SUM(phone IS NOT NULL AND TRIM(phone)<>'' AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]',''))<>10) AS phone_not_10_digits,
       SUM(phone IS NOT NULL AND phone <> REGEXP_REPLACE(phone,'[^0-9]','')) AS phone_non_digit_chars,
       SUM(name IS NULL OR TRIM(name)='') AS name_missing
FROM parents WHERE is_deleted=0;

SELECT 'S6-1 students bindable (code + approved + 10-digit phone)' AS chk, COUNT(DISTINCT s.id) AS n
FROM students s
JOIN parent_student ps ON ps.student_id=s.id AND ps.approved=1
JOIN parents p ON p.id=ps.parent_id AND p.is_deleted=0
WHERE s.is_deleted=0 AND s.student_code IS NOT NULL AND TRIM(s.student_code)<>''
  AND CHAR_LENGTH(REGEXP_REPLACE(p.phone,'[^0-9]',''))=10;

SELECT 'S6-2 parents with ACTIVE binding' AS chk, COUNT(*) AS n
  FROM parents p JOIN line_bindings lb ON lb.phone=p.phone AND lb.is_active=1 WHERE p.is_deleted=0
UNION ALL SELECT 'S6-3 line_bindings.phone matching no active parent', COUNT(*)
  FROM line_bindings lb LEFT JOIN parents p ON p.phone=lb.phone AND p.is_deleted=0 WHERE p.id IS NULL
UNION ALL SELECT 'S6-4 line_bindings without line_users row', COUNT(*)
  FROM line_bindings lb LEFT JOIN line_users lu ON lu.line_user_id=lb.line_user_id WHERE lu.line_user_id IS NULL
UNION ALL SELECT 'S6-5 active binding but line_user unverified/not parent', COUNT(*)
  FROM line_bindings lb JOIN line_users lu ON lu.line_user_id=lb.line_user_id
 WHERE lb.is_active=1 AND (lu.verified=0 OR lu.user_type<>'parent')
UNION ALL SELECT 'S6-6 line_users type=parent without parent_id', COUNT(*)
  FROM line_users WHERE user_type='parent' AND parent_id IS NULL
UNION ALL SELECT 'S6-7 line_users.parent_id not an active parent', COUNT(*)
  FROM line_users lu LEFT JOIN parents p ON p.id=lu.parent_id AND p.is_deleted=0
 WHERE lu.parent_id IS NOT NULL AND p.id IS NULL
UNION ALL SELECT 'S6-8 legacy parents.line_user_id still set', COUNT(*)
  FROM parents WHERE line_user_id IS NOT NULL AND TRIM(line_user_id)<>''
UNION ALL SELECT 'S6-9 legacy drivers.line_user_id still set', COUNT(*)
  FROM drivers WHERE line_user_id IS NOT NULL AND TRIM(line_user_id)<>''
UNION ALL SELECT 'S6-10 students reachable by notify resolver', COUNT(DISTINCT ps.student_id)
  FROM parent_student ps
  JOIN parents p ON p.id=ps.parent_id AND p.is_deleted=0 AND p.phone IS NOT NULL AND TRIM(p.phone)<>''
  JOIN line_bindings lb ON lb.phone=p.phone AND lb.is_active=1
  JOIN line_users lu ON lu.line_user_id=lb.line_user_id AND lu.user_type='parent' AND lu.verified=1
 WHERE ps.approved=1;

-- ── S7 ฟิลด์ที่ check-in ต้องใช้ (derive จาก checkin.service.js) ──────────────
SELECT 'S7-1 students active on a vehicle' AS chk, COUNT(*) AS n FROM students WHERE is_deleted=0 AND vehicle_id IS NOT NULL
UNION ALL SELECT 'S7-2 morning roster size', COUNT(*) FROM students WHERE is_deleted=0 AND vehicle_id IS NOT NULL AND morning_enabled=1
UNION ALL SELECT 'S7-3 evening roster size', COUNT(*) FROM students WHERE is_deleted=0 AND vehicle_id IS NOT NULL AND evening_enabled=1
UNION ALL SELECT 'S7-4 students on neither session', COUNT(*) FROM students WHERE is_deleted=0 AND morning_enabled=0 AND evening_enabled=0
UNION ALL SELECT 'S7-5 students with blank cid_hash', COUNT(*) FROM students WHERE is_deleted=0 AND (cid_hash IS NULL OR TRIM(cid_hash)='')
UNION ALL SELECT 'S7-6 students whose school name is unresolvable', COUNT(*)
  FROM students s LEFT JOIN schools sc ON sc.id=s.school_id
 WHERE s.is_deleted=0 AND (sc.id IS NULL OR sc.name IS NULL OR TRIM(sc.name)='')
UNION ALL SELECT 'S7-7 driver users resolvable via relational link', COUNT(*) FROM (
  SELECT u.id FROM users u
  JOIN driver_vehicle_assignments a ON a.driver_id=u.driver_id AND a.is_active=1
  JOIN vehicles v ON v.id=a.vehicle_id AND v.is_deleted=0
  WHERE u.is_deleted=0 AND u.role='driver' AND u.driver_id IS NOT NULL
  GROUP BY u.id HAVING COUNT(DISTINCT v.id)=1) x
UNION ALL SELECT 'S7-8 driver users resolvable ONLY via legacy plate', COUNT(*) FROM users u
 WHERE u.is_deleted=0 AND u.role='driver' AND u.driver_id IS NULL
   AND EXISTS (SELECT 1 FROM vehicles v WHERE v.is_deleted=0 AND (v.plate_no=u.username OR v.normalized_plate=u.username))
UNION ALL SELECT 'S7-9 driver users resolvable by NEITHER path', COUNT(*) FROM users u
 WHERE u.is_deleted=0 AND u.role='driver'
   AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.is_deleted=0
                    WHERE a.driver_id=u.driver_id AND a.is_active=1)
   AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.is_deleted=0 AND (v2.plate_no=u.username OR v2.normalized_plate=u.username))
UNION ALL SELECT 'S7-10 vehicles active without qr_token', COUNT(*) FROM vehicles WHERE is_deleted=0 AND (qr_token IS NULL OR TRIM(qr_token)='')
UNION ALL SELECT 'S7-11 daily_status with no checkin_log same day', COUNT(*) FROM daily_status ds
 WHERE NOT EXISTS (SELECT 1 FROM checkin_logs cl WHERE cl.student_id=ds.student_id AND cl.check_date=ds.check_date)
UNION ALL SELECT 'S7-12 checkin_log with no daily_status same day', COUNT(*) FROM checkin_logs cl
 WHERE NOT EXISTS (SELECT 1 FROM daily_status ds WHERE ds.student_id=cl.student_id AND ds.check_date=cl.check_date)
UNION ALL SELECT 'S7-13 morning_done without morning_ts', COUNT(*) FROM daily_status WHERE morning_done=1 AND morning_ts IS NULL
UNION ALL SELECT 'S7-14 evening_done without evening_ts', COUNT(*) FROM daily_status WHERE evening_done=1 AND evening_ts IS NULL
UNION ALL SELECT 'S7-15 daily_status.vehicle_id ne student vehicle', COUNT(*) FROM daily_status ds
  JOIN students s ON s.id=ds.student_id WHERE ds.vehicle_id IS NOT NULL AND ds.vehicle_id<>s.vehicle_id
UNION ALL SELECT 'S7-16 checkin_logs.checked_by not a user', COUNT(*) FROM checkin_logs cl
  LEFT JOIN users u ON u.id=cl.checked_by WHERE cl.checked_by IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'S7-17 checkin_logs with null term_id', COUNT(*) FROM checkin_logs WHERE term_id IS NULL
UNION ALL SELECT 'S7-18 checkin_logs term_id not matching convention regex', COUNT(*)
  FROM checkin_logs WHERE term_id IS NOT NULL AND term_id NOT REGEXP '^[0-9]{4}-[123]$';

SELECT status, session, source, COUNT(*) AS n FROM checkin_logs GROUP BY status, session, source ORDER BY status, session;

-- ── S8 term_id เทียบ convention ของวันที่ (term.service.js:36-63) ────────────
-- ทำซ้ำตรรกะ computeTermIdByConvention: md = MONTH*100+DAY
--   516..1011      → เทอม 1 ปีการศึกษา = YEAR
--   1012..1031     → เทอม 2 ปีการศึกษา = YEAR      (ช่วงปิด → เทอมที่กำลังจะถึง)
--   1101..1231     → เทอม 2 ปีการศึกษา = YEAR
--   0101..0401     → เทอม 2 ปีการศึกษา = YEAR-1
--   0402..0515     → เทอม 1 ปีการศึกษา = YEAR      (ช่วงปิด → เทอมที่กำลังจะถึง)
-- ปีที่แสดงเป็น พ.ศ. = ปีการศึกษา + 543
SELECT cl.term_id AS stored_term_id,
  CONCAT(
    CASE WHEN (MONTH(cl.check_date)*100+DAY(cl.check_date)) <= 401 THEN YEAR(cl.check_date)-1+543
         ELSE YEAR(cl.check_date)+543 END, '-',
    CASE WHEN (MONTH(cl.check_date)*100+DAY(cl.check_date)) BETWEEN 516 AND 1011 THEN 1
         WHEN (MONTH(cl.check_date)*100+DAY(cl.check_date)) > 1011 THEN 2
         WHEN (MONTH(cl.check_date)*100+DAY(cl.check_date)) <= 401 THEN 2
         ELSE 1 END) AS convention_term_id,
  COUNT(*) AS n
FROM checkin_logs cl GROUP BY stored_term_id, convention_term_id ORDER BY n DESC;

-- ── S9 ตัวตั้ง/ตัวหารของ aggregate score (§3) ────────────────────────────────
SELECT 'students_active' AS metric, COUNT(*) AS n FROM students WHERE is_deleted=0
UNION ALL SELECT 'with_school', COUNT(*) FROM students WHERE is_deleted=0 AND school_id IS NOT NULL
UNION ALL SELECT 'school_has_affiliation', COUNT(*) FROM students s JOIN schools sc ON sc.id=s.school_id
  WHERE s.is_deleted=0 AND sc.is_deleted=0 AND sc.affiliation_id IS NOT NULL
UNION ALL SELECT 'with_vehicle_active', COUNT(*) FROM students s JOIN vehicles v ON v.id=s.vehicle_id AND v.is_deleted=0 WHERE s.is_deleted=0
UNION ALL SELECT 'with_approved_parent', COUNT(DISTINCT ps.student_id)
  FROM parent_student ps JOIN students s ON s.id=ps.student_id AND s.is_deleted=0 WHERE ps.approved=1
UNION ALL SELECT 'line_bindable', COUNT(DISTINCT s.id) FROM students s
  JOIN parent_student ps ON ps.student_id=s.id AND ps.approved=1
  JOIN parents p ON p.id=ps.parent_id AND p.is_deleted=0
 WHERE s.is_deleted=0 AND s.student_code IS NOT NULL AND TRIM(s.student_code)<>''
   AND CHAR_LENGTH(REGEXP_REPLACE(p.phone,'[^0-9]',''))=10
UNION ALL SELECT 'line_bound', COUNT(DISTINCT ps.student_id) FROM parent_student ps
  JOIN students s ON s.id=ps.student_id AND s.is_deleted=0
  JOIN parents p ON p.id=ps.parent_id AND p.is_deleted=0
  JOIN line_bindings lb ON lb.phone=p.phone AND lb.is_active=1
  JOIN line_users lu ON lu.line_user_id=lb.line_user_id AND lu.user_type='parent' AND lu.verified=1
 WHERE ps.approved=1
UNION ALL SELECT 'checkin_ready_full_chain', COUNT(*) FROM students s
  JOIN vehicles v ON v.id=s.vehicle_id AND v.is_deleted=0
 WHERE s.is_deleted=0 AND (s.morning_enabled=1 OR s.evening_enabled=1)
   AND s.cid_hash IS NOT NULL AND TRIM(s.cid_hash)<>''
   AND EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.vehicle_id=v.id AND a.is_active=1);

SELECT 'schools_active' AS metric, COUNT(*) AS n, SUM(affiliation_id IS NOT NULL) AS ok FROM schools WHERE is_deleted=0
UNION ALL SELECT 'vehicles_active', COUNT(*), SUM(qr_token IS NOT NULL AND TRIM(qr_token)<>'') FROM vehicles WHERE is_deleted=0
UNION ALL SELECT 'vehicles_status_dated', COUNT(*), SUM(verification_status='UNVERIFIED' OR verification_updated_at IS NOT NULL) FROM vehicles WHERE is_deleted=0
UNION ALL SELECT 'drivers_active', COUNT(*), SUM(EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.driver_id=drivers.id AND a.is_active=1)) FROM drivers WHERE is_deleted=0
UNION ALL SELECT 'dva_active', COUNT(*), SUM(authorized_by IS NOT NULL AND authorized_at IS NOT NULL) FROM driver_vehicle_assignments WHERE is_active=1
UNION ALL SELECT 'parents_active', COUNT(*), SUM(CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]',''))=10) FROM parents WHERE is_deleted=0;

-- ── S10 id ของแถวที่ตัวตรวจจับได้ (id เท่านั้น ห้ามเพิ่มฟิลด์อื่น) ────────────
SELECT 'S3-13 drivers with no active assignment' AS chk, GROUP_CONCAT(d.id ORDER BY d.id) AS ids
  FROM drivers d WHERE d.is_deleted=0
   AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.driver_id=d.id AND a.is_active=1);
SELECT 'S5-12 students enabled on neither session' AS chk, GROUP_CONCAT(id ORDER BY id) AS ids
  FROM students WHERE is_deleted=0 AND morning_enabled=0 AND evening_enabled=0;
SELECT 'S5-13 vehicles ELIGIBLE with an expired document' AS chk, GROUP_CONCAT(id ORDER BY id) AS ids
  FROM vehicles WHERE is_deleted=0 AND verification_status='ELIGIBLE'
   AND (insurance_expiry < CURDATE() OR registration_expiry < CURDATE()
     OR compulsory_insurance_expiry < CURDATE() OR tax_expiry < CURDATE());
SELECT 'S3-1 active students with no parent link' AS chk, GROUP_CONCAT(st.id ORDER BY st.id) AS ids
  FROM students st WHERE st.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id=st.id);
SELECT 'S3-6 parent_student rows pointing at a soft-deleted student' AS chk, GROUP_CONCAT(ps.student_id ORDER BY ps.student_id) AS ids
  FROM parent_student ps JOIN students s ON s.id=ps.student_id WHERE s.is_deleted=1;
SELECT 'S7-9 driver accounts resolvable by neither path' AS chk, GROUP_CONCAT(u.id ORDER BY u.id) AS ids
  FROM users u WHERE u.is_deleted=0 AND u.role='driver'
   AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.is_deleted=0
                    WHERE a.driver_id=u.driver_id AND a.is_active=1)
   AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.is_deleted=0 AND (v2.plate_no=u.username OR v2.normalized_plate=u.username));
SELECT 'S7-11 daily_status rows with no checkin_log that day' AS chk,
       GROUP_CONCAT(DISTINCT ds.student_id ORDER BY ds.student_id) AS student_ids, COUNT(*) AS rows_n
  FROM daily_status ds
 WHERE NOT EXISTS (SELECT 1 FROM checkin_logs cl WHERE cl.student_id=ds.student_id AND cl.check_date=ds.check_date);

-- ── S11 ความครบรายโรงเรียน (school id เท่านั้น) ──────────────────────────────
SELECT sc.id AS school_id,
       COUNT(s.id) AS students_active,
       SUM(s.vehicle_id IS NOT NULL) AS with_vehicle,
       SUM(EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id=s.id AND ps.approved=1)) AS with_approved_parent,
       SUM(s.morning_enabled=1) AS morning_on,
       SUM(s.evening_enabled=1) AS evening_on,
       (SELECT COUNT(*) FROM users u WHERE u.is_deleted=0 AND u.role='school' AND u.scope_id=sc.id) AS school_accounts,
       (SELECT SUM(u2.grade_scope IS NULL) FROM users u2 WHERE u2.is_deleted=0 AND u2.role='school' AND u2.scope_id=sc.id) AS full_privilege_accounts
FROM schools sc LEFT JOIN students s ON s.school_id=sc.id AND s.is_deleted=0
WHERE sc.is_deleted=0 GROUP BY sc.id ORDER BY sc.id;

COMMIT;
```

### 13.1 คิวรีเสริมสำหรับ sandbox รอบนี้เท่านั้น — ห้ามนำไปรันกับ production

ใช้แยก cohort ตั้งต้นออกจากแถวที่ agent อื่นเขียนระหว่างตรวจ (§2.3) บน production ไม่มี cohort แบบนี้ ให้ตัดทิ้ง

```sql
SELECT DATE_FORMAT(created_at,'%Y-%m-%d %H:00') AS created_hour, COUNT(*) AS students
  FROM students GROUP BY created_hour ORDER BY created_hour;
SELECT DATE_FORMAT(created_at,'%Y-%m-%d %H:00') AS created_hour, COUNT(*) AS parents
  FROM parents GROUP BY created_hour ORDER BY created_hour;
SELECT DATE_FORMAT(checked_at,'%Y-%m-%d %H:00') AS logged_hour, COUNT(*) AS logs
  FROM checkin_logs GROUP BY logged_hour ORDER BY logged_hour;
```

---

## 14. บันทึกการตรวจสอบตัวเอง

ตามกติกาของรอบงานนี้ ทุกอย่างที่จะรายงานว่าเป็นข้อบกพร่องของแอปพลิเคชันต้อง reproduce ให้เห็นและอธิบายให้ได้ว่าตัดความเป็นไปได้ว่าเป็นปัญหาของเครื่องมือทดสอบออกไปอย่างไร

**เอกสารนี้ไม่รายงานข้อบกพร่องของแอปพลิเคชันแม้แต่ข้อเดียว** ทุกค่าที่ผิดปกติถูกตามกลับไปจนถึงต้นเหตุแล้ว และทุกข้อลงเอยที่ seeder หรือที่ agent ซึ่งรันทดสอบพร้อมกัน:

| ค่าที่ผิดปกติ | ต้นเหตุที่ตามได้ | หลักฐานที่ใช้ตัดสิน |
|---|---|---|
| `checkin_logs` 6,500 แถว term_id ไม่ตรง convention | seeder stamp จาก env `CURRENT_TERM` | 8 แถวที่ backend เขียนสดในช่วงเดียวกัน stamp `2569-1` ถูกต้อง |
| `daily_status` 30 แถวไม่มี log คู่ | seeder สร้างแถวโครงล่วงหน้า | แอปเขียน `daily_status` ได้จากจุดเดียวที่เขียน `checkin_logs` พร้อมกัน (`checkin.service.js:375-390`) และ path void เขียน compensating log ก่อนเสมอ (`:1238-1256`) |
| รถ `ELIGIBLE` 3 คันที่เอกสารหมดอายุ | seeder เขียนสถานะตรงเข้าฐาน | ไม่ได้เรียกผ่าน `refreshVehicleEligibility` เลย ไม่ได้ reproduce ผ่าน API |
| assignment 60 แถวไม่มีผู้อนุมัติ | seeder ไม่ผ่าน flow อนุมัติ | เช่นเดียวกัน |
| นักเรียน 4 คนไม่มีผู้ปกครอง, parent_student ค้าง 3 แถว | agent E2E ที่รันพร้อมกัน | `created_at` อยู่ในชั่วโมง 22:00 คนละ cohort กับ seed ที่ 21:00 |
| คนขับ 6 คนไม่มีรถ | มีคนขับ 66 คนแต่รถ 60 คัน | เป็นสัดส่วนของชุดข้อมูล ไม่ใช่ความผิดพลาดของโค้ด และ `getDriverVehicle` fail closed ถูกต้อง |
| ชื่อซ้ำ 120/24 กลุ่ม | คลังชื่อของ seeder เล็ก | ครอบคลุม 100% ของแถว ซึ่งเป็นลายเซ็นของข้อมูลสังเคราะห์ ไม่ใช่ของข้อมูลจริง |

สิ่งที่เอกสารนี้เสนอแทน คือ **ตัวตรวจ** เหล่านี้ควรถูกนำไปรันกับข้อมูลจริง ที่นั่นค่าเดียวกันอาจแปลว่าอย่างอื่นโดยสิ้นเชิง และการตีความต้องรอคำตอบใน §11 ก่อน
