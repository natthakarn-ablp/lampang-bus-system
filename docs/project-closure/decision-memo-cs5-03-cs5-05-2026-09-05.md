# Decision memo — CS5-03 (void แล้ว void คู่ไม่ได้) และ CS5-05 (term filter ไม่ re-stamp)

> จัดทำ 5 กันยายน 2569 ตามข้อ E ของคำสั่งเจ้าของระบบ: รวมข้อเสนอที่มีอยู่ใน `docs/audit/core-scope-defect-hunt-2026-09-04.md` (§CS5-03, §CS5-05, §10)
> เป็นเอกสารตัดสินใจฉบับเดียว พร้อมทางเลือก migration/rollback และเทสต์ **ไม่มีการตัดสิน logic แทนเจ้าของโครงการ และไม่มีไฟล์ migration ถูกสร้าง**
> ทั้งสองข้อเป็น Major ที่แผนแม่ §5 บอกว่าต้องแก้ก่อน System Acceptance และผูกกับ decision C0-1 (นิยาม check-in/void) และ C0-2/C0-3 (ภาคเรียน/รายชื่อ)

---

## A. CS5-03 — void รายการหนึ่งของรอบแล้ว รายการคู่ในรอบเดียวกัน void ไม่ได้อีก

### A.1 ข้อเท็จจริง (ยืนยันแล้วในรายงาน audit ด้วย fixture 361 และ 9102 จากสามบทบาท)

`voidCheckin` (`backend/src/services/checkin.service.js` ราวบรรทัด 1216–1227) กัน idempotency ด้วย

```sql
SELECT id FROM checkin_logs
 WHERE student_id = ? AND session = ? AND check_date = ?
   AND status = 'CANCELLED' AND id > ?
 LIMIT 1
```

เงื่อนไข `id > ?` จับแถว `CANCELLED` **ใด ๆ** ที่มี id สูงกว่า log เป้าหมาย ไม่ใช่แถวที่ชดเชย log นั้น เมื่อรอบหนึ่งมีสอง log (CHECKED_IN + CHECKED_OUT) การ void ตัวหลังจะสร้างแถว CANCELLED ที่ id สูงกว่าทั้งคู่ แถว CHECKED_IN จึงถูกมองว่า "ถูกยกเลิกไปแล้ว" (409 `ALREADY_VOIDED`) ทั้งที่ยังมีผลอยู่ และไม่มีบทบาทใดแก้ได้

**รากของปัญหา** ตาราง `checkin_logs` ไม่มีคอลัมน์เชื่อมแถว CANCELLED กับแถวที่มันกลับรายการ ทุกอย่างจึงต้องอนุมานจากลำดับ id หรือจากธง `daily_status` ซึ่งแบกความหมายสองอย่าง (audit §10.7)

### A.2 ทางเลือก

| | ทางเลือก A1 — แก้ predicate อย่างเดียว | ทางเลือก A2 — เพิ่มคอลัมน์เชื่อม `voided_by_log_id` | ทางเลือก A3 — A2 + unique key เฉพาะแถวที่ยังมีผล (audit §10.4 ตัวเลือก B) |
|---|---|---|---|
| สิ่งที่ทำ | เปลี่ยน dedup เป็น "มีแถว CANCELLED ที่ **สร้างหลัง** log นี้ **และ** ก่อน log ถัดไปของรอบเดียวกัน" หรือเก็บ id เป้าหมายใน `checkin_logs.source`/JSON | migration additive: `ALTER TABLE checkin_logs ADD COLUMN voided_by_log_id BIGINT NULL, ADD KEY idx_cl_voided_by (voided_by_log_id)`; `voidCheckin` UPDATE แถวต้นทางให้ชี้แถวชดเชยในธุรกรรมเดียวกัน; dedup = `voided_by_log_id IS NOT NULL` | A2 + generated column `active_dedupe_key` + `UNIQUE KEY uk_cl_active_dedupe` (DDL อยู่ใน audit §10.4) ปิด CS5-04 (กดซ้ำพร้อมกัน) ในชั้นฐานข้อมูลไปพร้อมกัน |
| แก้ CS5-03 | ✅ | ✅ (ถูกต้องตรงไปตรงมา) | ✅ |
| แก้ CS5-01 side-effect §10.7 (void CHECKED_OUT ทำให้เด็กที่ขึ้นรถจริงถูกรายงานว่าไม่ได้ขึ้น) | ❌ ยังต้องอนุมานจาก `daily_status` | ✅ อนุมานได้ตรงจากคอลัมน์ | ✅ |
| แก้ CS5-04 (race condition) | ❌ | ❌ (ต้องใช้ lock ระดับแอป §10.1 แยก) | ✅ ระดับ DB (defence in depth) + lock ระดับแอป |
| schema เปลี่ยน | ไม่ | ใช่ (additive, nullable, backfill = NULL ทั้งหมด) | ใช่ (additive + generated column + unique) |
| ต้องล้างข้อมูลก่อน | ไม่ | ไม่ | **ใช่** — pre-flight ใน §10.3 ต้องได้ 0 แถวซ้ำ (check_date, student_id, session, status) ไม่งั้น ALTER ล้ม; บน production ยังไม่ได้รัน pre-flight |
| ผูกกับ decision | — | C0-1 (นิยาม void) | **C0-1 โดยตรง**: ต้องตอบก่อนว่า "เช็กอินใหม่หลัง void ในรอบเดียวกัน" ต้องทำได้หรือไม่ (A3 อนุญาต เพราะแถวที่ void แล้วหลุดจาก key; ตัวเลือก A ของ §10.3 ไม่อนุญาต) |
| rollback | revert โค้ด | `ALTER TABLE checkin_logs DROP COLUMN voided_by_log_id` (ปลอดภัยเมื่อ deploy โค้ดเก่ากลับก่อน) | DROP unique/generated column/`voided_by_log_id` ตามลำดับย้อน; ข้อมูลไม่หาย |
| ความเสี่ยงต่อข้อมูลจริง | ต่ำ | ต่ำ (nullable, ไม่มี backfill) | ปานกลาง (ALTER บนตาราง log ใหญ่: ต้องดูขนาดตารางบน production + ทำใน maintenance window C0-8) |

**ข้อเสนอของผู้ช่วย (ไม่ใช่การตัดสิน):** A2 เป็นขั้นต่ำที่ปิด CS5-03 อย่างถูกต้องและปิด §10.7 ไปด้วยโดยไม่แตะ CS5-04; A3 คือ A2 บวกด่านสุดท้ายในฐานข้อมูล แต่ต้องมีคำตอบ C0-1 ก่อนเพราะมันบังคับความหมายของ "เช็กอินซ้ำหลัง void"

### A.3 เทสต์ที่ต้องมี (ทุกทางเลือก)

- regression ตามขั้นตอนใน audit CS5-03 (checkin → checkout → void log หลัง → void log แรก ต้องได้ 201 ไม่ใช่ 409) จากสาม route (`driver`, `school`, `admin`)
- void ซ้ำแถวเดิม → 409 (idempotency ยังอยู่)
- void CHECKED_OUT แล้ว `getNoShowStudents` ต้อง**ไม่**แสดงชื่อเด็กที่ CHECKED_IN ยังมีผล (§10.7)
- ถ้า A3: เช็กอินซ้ำพร้อมกัน 3 request ต้องได้แถวเดียว + 2 × 409 (`Promise.all` ไม่ใช่ `await` เรียง — ชุดเดิม `emergencyDoubleTap.test.js` ยิงเรียงจึงมองไม่เห็น); และ "เช็กอินใหม่หลัง void" ต้องผ่านตามคำตอบ C0-1
- `tests/schema.sql` ต้องเพิ่มคอลัมน์/คีย์ให้ตรง migration (บทเรียน 051) + ด่าน boot ไม่จำเป็นถ้าโค้ดทนคอลัมน์ว่าง แต่ถ้าโค้ดอ่าน `voided_by_log_id` โดยตรง ต้องมีด่านแบบ `assertSharedSecurityStateMigrationPresent`

### A.4 สิ่งที่ต้องการจากเจ้าของโครงการ

1. คำตอบ C0-1: เช็กอินใหม่หลัง void ในรอบเดียวกัน ต้องทำได้หรือไม่
2. เลือก A1 / A2 / A3
3. ถ้า A2/A3: อนุมัติเขียน migration แยก + maintenance window (C0-8) + ผลนับแถวซ้ำจาก pre-flight บน production (อ่านอย่างเดียว) ก่อนตัดสิน A3

---

## B. CS5-05 — คำขอส่งตรวจรถนับผู้โดยสารด้วย term filter ที่ไม่มีการ re-stamp

### B.1 ข้อเท็จจริง

`vehicleVerification.service.js` (ราวบรรทัด 268–278 และ 296–308) กรองนักเรียนด้วย `(term_id = ? OR term_id IS NULL)` โดย `?` = ภาคเรียนปัจจุบันจาก `getCurrentTerm()` ซึ่งเมื่อตาราง `terms` ว่างจะ derive จากปฏิทิน (`term.service.js:36-61`: 4 ก.ย. 2569 → `2569-1`; ข้าม 11 ต.ค. → `2569-2`)
แต่ `students.term_id` ถูกเขียน**เฉพาะตอน INSERT** (school.routes, studentImportPreview, rosterRequest, studentTransfer) ไม่มีจุดใด re-stamp เมื่อขึ้นภาคเรียนใหม่
ผลที่วัดได้: รถที่มีนักเรียนใช้จริง 8 คน (term เก่า) → 403 "โรงเรียนนี้ไม่มีนักเรียนที่ใช้รถคันดังกล่าว"; เปลี่ยน term ของเด็กคนเดียว → 201 พร้อม `peak_rider_count = 1` แทนที่จะเป็น 8 และค่านี้ถูก freeze ไปเทียบ `certified_capacity` ตอนปิดผลตรวจ

**คำถามทางธุรกิจที่ยังไม่มีคำตอบ (audit ระบุเอง):** โรงเรียนต้องนำเข้ารายชื่อใหม่ทุกภาคเรียนหรือไม่ ถ้าใช่ ระบบต้องบอกเหตุผลจริงและมีทางแก้ให้ผู้ใช้ ถ้าไม่ใช่ ระบบต้องไม่ใช้ `term_id` เป็นตัวตัดสินว่าเด็ก "ยังใช้รถอยู่"

### B.2 ทางเลือกเชิง logic ของภาคเรียน/รายชื่อ (ต้องเลือกก่อนแตะโค้ด)

| | B1 — รายชื่อ "ต่อเนื่องจนกว่าจะเปลี่ยน" | B2 — รายชื่อ "ต้องยืนยันทุกภาคเรียน" | B3 — นับจากพฤติกรรมจริง |
|---|---|---|---|
| นิยาม | นักเรียนที่ยัง active และผูกรถอยู่ นับเป็นผู้โดยสารของรถนั้นทุกภาคเรียน จนกว่าจะถูกย้าย/ถอน/จบ | เมื่อขึ้นภาคเรียนใหม่ โรงเรียนต้องยืนยันรายชื่อ (import/roster confirm) เด็กที่ยังไม่ยืนยันไม่นับ | ผู้โดยสาร = เด็กที่มี check-in บนรถคันนั้นใน N วันทำการล่าสุด |
| แก้ CS5-05 อย่างไร | ตัด `term_id` ออกจากเงื่อนไขความเกี่ยวข้องและการนับ (ใช้ `is_deleted = 0` + `vehicle_id` + สถานะ active) | คง filter แต่เพิ่ม (ก) job/ขั้นตอน re-stamp หรือ "ยืนยันรายชื่อภาคเรียนใหม่" ที่โรงเรียนกดได้, (ข) ข้อความ error ที่บอกว่า "มีนักเรียน 8 คนของภาคเรียนก่อน ยังไม่ยืนยันภาคเรียนนี้" แทน 403 ปัจจุบัน | นับจาก `checkin_logs`/`daily_status` ในช่วงหน้าต่างเวลา ไม่พึ่ง `term_id` |
| schema | ไม่ต้อง | ต้องมีที่เก็บ "ยืนยันภาคเรียนแล้ว" — ทางเลือก DDL ใน B.3 | ไม่ต้อง |
| ความเสี่ยง | เด็กที่ย้ายออกแต่ไม่ถูกถอนจะถูกนับเกิน (ทำให้รถ "เต็ม" เร็วกว่าจริง — ปลอดภัยฝั่งกำลังคน แต่ปิดผลตรวจยากขึ้น) | ภาระโรงเรียนทุกเทอม; ถ้าไม่ยืนยันทัน คำขอส่งตรวจจะยื่นไม่ได้ (ปัญหาเดิมแต่มีข้อความบอก) | ช่วงเปิดเทอม/ปิดเทอมนับได้ต่ำผิด; ต้องนิยาม N และวันหยุด (ผูก C0-1) |
| ผูกกับ decision | C0-2/C0-3 (นิยามภาคเรียนกับรายชื่อ) | C0-2/C0-3 + กระบวนการโรงเรียน (Phase 11 คู่มือ) | C0-1 + C0-2 |

**ข้อสังเกตของผู้ช่วย:** ทุกทางเลือกต้องแก้ข้อความ 403 ปัจจุบันให้บอกเหตุที่แท้จริง เพราะวันนี้ผู้ใช้เห็น "ไม่มีนักเรียนที่ใช้รถคันนี้" ทั้งที่มี 8 คน — ข้อนี้แก้ได้โดยไม่รอ decision (presentation) แต่**ยังไม่ได้แก้**ในรอบนี้เพราะข้อความที่ถูกต้องขึ้นกับ B1/B2/B3

### B.3 DDL เฉพาะทางเลือกที่ต้องใช้ schema (B2 เท่านั้น)

ทางเลือก B2 ต้องรู้ว่าเด็กคนไหน "ยืนยันภาคเรียนนี้แล้ว" สองวิธี:

(i) re-stamp คอลัมน์เดิม — ไม่มี DDL: เพิ่ม endpoint/ขั้นตอน "ยืนยันรายชื่อภาคเรียน" ที่ `UPDATE students SET term_id = <current> WHERE school_id = ? AND id IN (...)` พร้อม audit log — ข้อเสีย: ประวัติภาคเรียนก่อนหายจากแถวเด็ก

(ii) ตารางยืนยันแยก (เก็บประวัติ) — DDL เสนอ (ยังไม่สร้างไฟล์ migration):

```sql
CREATE TABLE IF NOT EXISTS student_term_confirmations (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  student_id    INT         NOT NULL,
  term_id       VARCHAR(10) NOT NULL,
  vehicle_id    VARCHAR(20) NULL,          -- รถ ณ ตอนยืนยัน (ถ้าต้องการ freeze)
  confirmed_by  INT         NULL,          -- users.id
  confirmed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source        ENUM('import','roster','manual') NOT NULL DEFAULT 'manual',
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_term (student_id, term_id),
  KEY idx_term_vehicle (term_id, vehicle_id),
  CONSTRAINT fk_stc_student FOREIGN KEY (student_id) REFERENCES students (id),
  CONSTRAINT fk_stc_user    FOREIGN KEY (confirmed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- rollback: DROP TABLE IF EXISTS student_term_confirmations;  (additive; ไม่แตะ students)
```

การนับผู้โดยสารใน B2(ii) จะ JOIN ตารางนี้ด้วย `term_id = current` แทน `students.term_id`; import/roster confirm เขียนแถวยืนยันให้อัตโนมัติ

### B.4 เทสต์ที่ต้องมี (ทุกทางเลือก)

- ทำซ้ำ CS5-05 state A/B: รถที่มีนักเรียน 8 คน term เก่า → ต้อง**ไม่**ได้ 403 แบบไม่มีคำอธิบาย และ `peak_rider_count` ต้องสะท้อนกติกาที่เลือก (8 ใน B1; 0 พร้อมข้อความ "ยังไม่ยืนยันภาคเรียนนี้ 8 คน" ใน B2; ค่าจาก check-in ใน B3)
- ข้ามภาคเรียนบนนาฬิกาจริง: audit ระบุว่าไม่ได้เลื่อนนาฬิกาทดสอบ (§ตาราง "พฤติกรรมข้ามภาคเรียนบนนาฬิกาจริง") → ต้องมีเทสต์ที่ mock `getCurrentTerm` เป็น term ถัดไปแล้วยืนยันพฤติกรรม
- `rider_summary_json` ที่ freeze บนคำขอต้องตรงกับผลนับใหม่ในทุกกรณี และ `computeEligibility` เทียบ `certified_capacity` กับค่านั้น

### B.5 สิ่งที่ต้องการจากเจ้าของโครงการ

1. เลือก B1 / B2 / B3 (หรือผสม เช่น B1 เป็นค่าตั้งต้น + B2 เป็นทางเลือกเมื่อโรงเรียนต้องการ)
2. ถ้า B2: เลือก (i) หรือ (ii) และอนุมัติ migration แยก
3. คำตอบ C0-2/C0-3 เรื่องนิยามภาคเรียนและวงจรรายชื่อ ซึ่งเอกสารนี้ไม่ตัดสินแทน

---

## C. สิ่งที่เอกสารนี้ไม่ได้ทำ

- ไม่แก้โค้ด ไม่สร้าง migration ไม่แตะ schema ไม่แก้ข้อมูล (ตามข้อจำกัด production ในคำสั่ง)
- ไม่ได้รัน pre-flight นับแถวซ้ำใน `checkin_logs` บน production (เป็น read-only แต่ควรทำใน maintenance window พร้อม operator)
- ไม่ได้ตัดสินว่า "เช็กอินใหม่หลัง void" ทำได้หรือไม่ และไม่ได้ตัดสินนิยามผู้โดยสารต่อภาคเรียน
