# Import Preview / Apply / Rollback — การตรวจสอบกับฐานข้อมูลจริง — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกผลการเดินเส้นทาง preview → apply → rollback ผ่าน API จริงกับฐานข้อมูล `lampang_bus_sandbox` พร้อม snapshot ก่อน/หลังทุกขั้น** — งาน A1-10 ตาม `docs/project-closure/execution-plan-to-completion-2026-09-04.md:133,303`

เอกสารนี้ **ไม่ใช่**:

- ไม่ใช่การประกาศว่าฟีเจอร์นำเข้าพร้อมใช้งาน ไม่ใช่ผล UAT และไม่ใช่ sign-off ใด ๆ
- ไม่ใช่หลักฐานจาก production — ไม่มีการเข้าถึง production, ไม่มี deploy, ไม่มี migration นอก sandbox
- ไม่ใช่การทดสอบบน browser — ไม่ได้เปิดหน้าจอจริง ข้อสังเกตฝั่ง frontend ทั้งหมดอ่านจาก source
- ไม่ใช่การตัดสินเรื่อง retention / สิทธิ์เจ้าของข้อมูล — ข้อค้นพบหลายข้อในเอกสารนี้ต้องรอ **D0-8** (ดู §9)
- ไม่ใช่การแทนที่ jest 3 suite — ทั้งสองอย่างวัดคนละเรื่อง (ดู §3)

---

## 1. จุดที่บันทึกผล

| รายการ | ค่า |
|---|---|
| Repository | `D:/Projects/lampang-bus-work` (worktree; `git status --short` ขึ้นเฉพาะ `M scripts/e2e-review.mjs` และ `?? frontend/e2e-review.mjs` ซึ่งเป็นงานของ agent อื่น ไม่ใช่ของรอบนี้) |
| Branch | `feat/tracking-security-hardening` |
| HEAD ขณะตรวจ | `1b0c1a5` |
| Commit ที่ backend ที่รันอยู่รายงาน (`GET /health`) | `4b80b4b` |
| ความต่างของ 2 commit นั้นในส่วนที่เกี่ยว | `git diff --stat 4b80b4b..HEAD -- backend/src backend/migrations` คืน **0 ไฟล์** — process ที่รันอยู่จึงเป็น source เดียวกับที่อ่านในเอกสารนี้ |
| Backend | `http://127.0.0.1:3000` · `NODE_ENV=test` · Node v24.15.0 |
| ฐานข้อมูล | `lampang_bus_sandbox` บน container `lampang_mysql` (mysql:8.0) |
| `@@GLOBAL.sql_mode` | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| บัญชีที่ใช้ | `syn_school_001` (users.id = 558, scope `SCHOOL` / `SYNSCH001`) — login **ครั้งเดียว** แล้วใช้ token ซ้ำตลอด |
| ช่วงเวลาที่เดินเส้นทาง | 4 ก.ย. 2569 เวลา 22:23–22:39 น. (Asia/Bangkok) |
| ฐานข้อมูล `lampang_bus` ของนักพัฒนา | **ไม่ได้อ่าน ไม่ได้เขียน ไม่ได้อ้างอิง** |

### 1.1 ข้อจำกัดสำคัญ — มี agent อื่นเขียน DB เดียวกันพร้อมกัน

ตลอดช่วงที่ตรวจ มี e2e run ของ agent อื่นเขียนลง `lampang_bus_sandbox` พร้อมกัน (สังเกตจาก `audit_logs` แถว `LOGIN` ของ `syn_*` ทุกบทบาท, `CREATE pickup_point`, `EXPORT report_csv`, และนักเรียน `AUDIT9001`–`AUDIT9005` id 9001–9005 ที่ไม่ใช่ของรอบนี้)

ผลที่ตามมาและวิธีรับมือ:

- **ตัวเลขรวมทั้งตาราง (`COUNT(*)` ของ students / parents / audit_logs) ใช้เทียบ before/after ตรง ๆ ไม่ได้** ทุกข้อสรุปในเอกสารนี้จึงยึดจาก (ก) checksum ของ **เฉพาะแถวที่มีอยู่ก่อน** (§6.4) และ (ข) แถวที่ผูกกับ `students.import_batch_id` หรือ `student_code` ของรอบนี้เท่านั้น
- ตัวเลข `audit_logs` ที่อ้างในเอกสารนี้กรองด้วย `user_id = 558 AND entity_type IN ('student','vehicle','import_batch')` เสมอ ไม่ใช่ยอดรวมทั้งตาราง

## 2. วิธีตรวจ

1. อ่าน implementation และ 3 suite ก่อน (`studentImportPreview.service.js` 743 บรรทัด, `studentImportClassifier.js`, `school.routes.js:1716-1836`, migration 027 + 031)
2. เก็บ snapshot ก่อนเริ่ม: จำนวนแถว **และ** checksum เนื้อหา (`MD5(GROUP_CONCAT(MD5(CONCAT_WS(...)) ORDER BY ...))` ของทุกคอลัมน์ที่การนำเข้าแตะได้) ของ `students`, `parents`, `parent_student`, `vehicles` บวกกับ `import_batches`, `import_batch_rows`, `id_sequences.students` และ watermark ของ `audit_logs`
3. เดินทุกขั้นผ่าน **HTTP endpoint จริง** (`curl` ไป `/api/school/students/import/...`) ไม่ได้เรียก test helper และไม่ได้เรียก service function ตรง ๆ
4. เก็บ snapshot ซ้ำหลังทุกขั้น แล้ว `diff`

ไฟล์นำเข้าทุกไฟล์เป็น CSV UTF-8 with BOM หัวคอลัมน์ไทยตาม `frontend/public/templates/student_import_template_th.csv`

| ไฟล์ | sha256 (คำนวณในเครื่อง) | `import_batches.file_sha256` | ตรงกัน |
|---|---|---|:--:|
| `batch1.csv` | `c55413023b9ed839…09a7` | `c55413023b9ed839…09a7` | ✔ |
| `batch2.csv` | `cd1e43c63c8c1b0f…996e` | `cd1e43c63c8c1b0f…996e` | ✔ |
| `batch3.csv` | `c9f6d1071190a355…c160e` | `c9f6d1071190a355…c160e` | ✔ |

### 2.1 ข้อผิดพลาดของเครื่องมือที่พบระหว่างทาง และวิธีตัดออก

รอบแรกส่ง `reason` ภาษาไทยด้วย `curl -d '{"reason":"ทดสอบตรวจสอบ A1-10"}'` ผลที่เก็บใน `audit_logs.new_value` เป็น `���ͺ��Ǩ�ͺ A1-10` (hex `EFBFBD EFBFBD EFBFBD CD BA …`)

**เกือบรายงานผิดว่าเป็นบั๊กของแอป** ตรวจซ้ำแล้วพบว่า `EFBFBD` คือ U+FFFD และไบต์ที่รอดมาคือ `CD BA` ซึ่งตรงกับ `อบ` ใน **TIS-620** — แปลว่า command line ถูก Git Bash บน Windows แปลงจาก UTF-8 เป็น TIS-620 ก่อนถึง `curl` ไม่ใช่แอปทำพัง

ยืนยันโดยส่งซ้ำด้วย body ที่เขียนเป็นไฟล์ UTF-8 แล้วใช้ `--data-binary @file` ผลคือ:

```
reason: ทดสอบย้อนกลับซ้ำ รอบที่สอง
hex   : E0B897E0B894E0B8AA… (UTF-8 ถูกต้องทุกไบต์)
```

**สรุป: ข้อความไทยเดินทางผ่าน API → service → `audit_logs` ครบทุกไบต์** ทุกคำสั่งหลังจากนั้นในเอกสารนี้ส่ง body ภาษาไทยจากไฟล์เสมอ (ข้อควรระวังสำหรับผู้ที่ทำซ้ำ)

## 3. jest 3 suite ครอบอะไร และ **ไม่ได้** ครอบอะไร

รันจริงรอบนี้: `npx jest importPreviewWiring importApplyModes importRollback` → **3 suites / 28 tests / 0 failing / 0.956 วินาที**

เวลา 0.956 วินาทีคือคำตอบในตัว — suite ทั้งสามไม่ได้แตะฐานข้อมูลเลย:

- ทั้งสามไฟล์ **ไม่มี** `require('../src/config/database')` ทุกไฟล์ประกอบ mock pool ขึ้นเองแล้วส่งเข้า `analyzeRows` / `applyBatch` / `rollbackBatch` โดยตรง (`importPreviewWiring.test.js:13-30`, `importApplyModes.test.js:39-71`, `importRollback.test.js:14-33`)
- mock ตอบตาม **รูปประโยค SQL** (regex) ไม่ใช่ตาม schema จริง จึงไม่มีทางเจอ constraint, ความยาวคอลัมน์, FK, unique index, transaction หรือ isolation จริง
- `backend/tests/loadTestEnv.js` โหลด `.env.test` ด้วย `override: true` ซึ่งบังคับ `DB_NAME=lampang_bus_test` — **ถึงจะรัน `npm test` โดยตั้ง `DB_NAME=lampang_bus_sandbox` ไว้ suite ก็ไม่ได้วิ่งเข้า sandbox** ยืนยันแล้วว่า snapshot ของ sandbox ก่อน/หลังรัน jest ต่างกันเฉพาะ `audit_logs` ที่ agent อื่นเขียน (`S12` vs `S13`) ข้อนี้ขัดกับช่อง "สภาพแวดล้อม" ของ A1-10 ใน `execution-plan-to-completion-2026-09-04.md:303` ที่ระบุว่า "sandbox MySQL" — ควรแก้เป็น `lampang_bus_test`

| หัวข้อ | jest 3 suite | รอบนี้ (DB จริง) |
|---|:--:|:--:|
| ตรรกะการจำแนกแถว (classification) | ✔ | ✔ |
| การกั้นโหมด / confirm flag / selected rows | ✔ | ✔ |
| tenant scope 403 / selection ว่าง 400 | ✔ | ✔ |
| idempotency ระดับ branch | ✔ | ✔ |
| แถวถูกเขียนลงตารางจริงหรือไม่ | ✘ | ✔ |
| checksum เนื้อหาก่อน/หลัง | ✘ | ✔ |
| ความยาวคอลัมน์ / `STRICT_TRANS_TABLES` | ✘ | ✔ (§8.1) |
| transaction ต่อแถว + การคืนค่า `id_sequences` | ✘ | ✔ (§8.1) |
| ค่าใน `import_batches` หลัง apply/rollback | ✘ | ✔ (§10) |
| `audit_logs` เกิดจริงกี่แถว หน้าตาอย่างไร | ✘ | ✔ (§7) |
| Thai date/time ที่เขียนลง DB | ✘ | ✔ (§8 ของ §11) |
| encoding ไทยตลอดสาย | ✘ | ✔ (§2.1) |

## 4. Baseline ก่อนเริ่ม (S0 — 22:23 น.)

| ตาราง | จำนวนแถว | checksum เนื้อหา |
|---|---:|---|
| `students` (ทั้งหมด) | 360 | `cf0136acf4159571dcfcc4eac62ec3e4` |
| `students` ที่ `school_id='SYNSCH001'` | 36 | `b4f29c7b4ca763ae9fdea87e4bbf79b8` |
| `students` ที่ยัง active | 360 | — |
| `parents` | 360 | `8cfb7e5c1881ca9097ceb51db7c8c64d` |
| `parent_student` | 396 | `e0251d1a12d066b469a4f32dde527954` |
| `vehicles` | 60 | `497cae34dd52801e0f229788da8c9299` |
| `import_batches` | **0** | — |
| `import_batch_rows` | **0** | — |
| `audit_logs` แถวที่เกี่ยวกับ import (`entity_type IN ('import_batch','student','vehicle')`) | **0** | — |
| `id_sequences.students.next_value` | 361 | — |

`import_batches` มี 0 แถวแต่ AUTO_INCREMENT อยู่ที่ 112 (batch แรกของรอบนี้ได้ id 112) — เป็นร่องรอยของการ seed ไม่กระทบผลการตรวจ

## 5. ขั้นที่ 1 — Preview (batch 112)

`POST /api/school/students/import/preview` (multipart, `batch1.csv` 9 แถวข้อมูล) → HTTP 200, `batch_id = 112`

ผลการจำแนกตรงกับที่ออกแบบไฟล์ไว้ทุกแถว:

| แถว | รหัส | status | classification | `can_apply` |
|---:|---|---|---|:--:|
| 2 | AUD001 | READY | `INSERT_NEW` (จับคู่รถ `V-SYNc325ca7ae`) | ✔ |
| 3 | AUD002 | READY | `INSERT_NEW` (ไม่มีทะเบียนรถ) | ✔ |
| 4 | AUD003 | READY | `INSERT_NEW` (จับคู่รถ `V-SYN2f390d894`) | ✔ |
| 5 | S000001 | WARNING | `GUARDIAN_MISMATCH` | ✘ |
| 6 | S000011 | SKIP | `SKIP_DUPLICATE_SAME_SCHOOL` | ✘ |
| 7 | AUD004 | ERROR | `VEHICLE_NOT_FOUND` | ✘ |
| 8 | AUD001 (ซ้ำ) | ERROR | `DUPLICATE_ROW_IN_FILE` (อ้างแถวแรก = แถวที่ 2) | ✘ |
| 9 | (ว่าง) | ERROR | `INVALID_STUDENT_CODE` | ✘ |
| 10 | AUD005 | ERROR | `INVALID_GUARDIAN_PHONE` | ✘ |

สรุปที่ API คืน: `{total:9, ready:3, warning:1, skip:1, error:4, can_apply:3}`

**snapshot หลัง preview (S1) เทียบกับ S0 — ตาราง `students` / `parents` / `parent_student` / `vehicles` มี checksum และจำนวนแถวเท่าเดิมทุกค่า** สิ่งที่เพิ่มมีเพียง `import_batches` +1, `import_batch_rows` +9, `audit_logs` (import) +1 ตรงกับคำอธิบายใน `school.routes.js:1739-1741` ว่า preview ไม่เขียนข้อมูลนักเรียน

`import_batches` แถว 112 หลัง preview:

```
status=PREVIEWED  mode=preview  total_rows=9  success_rows=0
insert_count=3    skip_count=1  error_rows=4
created_at=2026-09-04 22:24:39   expires_at=2026-09-18 22:24:39  (= +14 วัน)
stored_file_path=…\backend\uploads\imports\import-558-1788535479561.csv
file_sha256=c55413023b9ed839…
```

## 6. ขั้นที่ 2–3 — Apply แล้ว Rollback (batch 112)

### 6.1 Apply

`POST /api/school/students/import/112/apply` body `{"mode":"insert_ready"}` → HTTP 200

```
applied=3  already_applied=0  failed=0  vehicle_blocked=0  stale=0  success_rows=3
details: row2→student 361, row3→student 362, row4→student 363
```

| ตาราง | S1 (หลัง preview) | S2 (หลัง apply) | ผลต่าง |
|---|---:|---:|---|
| `students` | 360 | 363 | +3 |
| `students` active | 360 | 363 | +3 |
| `parents` | 360 | 363 | +3 |
| `parent_student` | 396 | 399 | +3 |
| `vehicles` | 60 | 60 | ไม่เปลี่ยน |
| `id_sequences.students` | 361 | 364 | +3 |
| `audit_logs` (import) | 1 | 5 | +4 |

นักเรียนที่เกิดขึ้นถูกต้องตามไฟล์ทุกคอลัมน์ รวม `import_batch_id=112`, `morning_enabled/evening_enabled=1`, `cid_hash` = SHA-256 ของ `import-SYNSCH001-<student_code>` (marker สังเคราะห์ ไม่ใช่ hash ของเลขบัตรจริง — ตรงกับ CLAUDE.md §12 ข้อ 5)

### 6.2 Rollback

`POST /api/school/students/import/112/rollback` body `{"selected_row_ids":[2,3,4], "reason":"…"}` → HTTP 200

```
rolled_back=3  already_rolled_back=0  skipped=0  failed=0
```

### 6.3 rollback คืนสภาพเดิมหรือไม่ — คำตอบตรง ๆ

**คืน "สภาพที่ใช้งาน" แต่ไม่คืน "สภาพข้อมูล"** เทียบ S0 (ก่อนเริ่ม) กับ S3 (หลัง rollback):

| รายการ | S0 | S3 | คืนสภาพ |
|---|---:|---:|:--:|
| `students` ที่ยัง active | 360 | **360** | ✔ |
| `students` ทั้งหมด | 360 | **363** | ✘ เหลือ 3 แถว soft-deleted |
| checksum `students` | `cf0136ac…` | `7d8265a0…` | ✘ |
| `parents` | 360 | **363** | ✘ เหลือ 3 แถว **ที่ยัง `is_deleted=0`** |
| checksum `parents` | `8cfb7e5c…` | `7ef512c7…` (เท่ากับ S2 ทุกไบต์) | ✘ rollback ไม่แตะ `parents` เลย |
| `parent_student` | 396 | **399** | ✘ เหลือ 3 ลิงก์ `approved=1` ชี้ไปนักเรียนที่ถูกลบ |
| `id_sequences.students` | 361 | **364** | ✘ id ที่ใช้ไปแล้วไม่คืน |
| `import_batches` / `import_batch_rows` | 0 / 0 | 1 / 9 | ✘ **โดยตั้งใจ** — คือ audit trail |
| `audit_logs` (import) | 0 | 9 | ✘ **โดยตั้งใจ** |

สิ่งที่ rollback ทำจริง (`studentImportPreview.service.js:716`) คือ `UPDATE students SET is_deleted=TRUE, deleted_at=NOW(), vehicle_id=NULL` เท่านั้น — ไม่ลบ `parents`, ไม่ลบ `parent_student`, ไม่คืนค่า `id_sequences`

หลักฐานสภาพที่เหลือ:

```
id  student_code  is_deleted  deleted_at            vehicle_id  parent_id  p.is_deleted  ps.approved
361 AUD001        1           2026-09-04 22:26:45   NULL        1699       0             1
362 AUD002        1           2026-09-04 22:26:45   NULL        1700       0             1
363 AUD003        1           2026-09-04 22:26:45   NULL        1701       0             1
```

ข้อควรระวังที่ตามมา (อ่านจาก source ไม่ได้ทดสอบในรอบนี้): `linkParent` (`studentImportPreview.service.js:291-321`) จับคู่ผู้ปกครองซ้ำ**ด้วยเบอร์โทร** ฉะนั้นผู้ปกครองที่ค้างจากการ rollback จะถูกนำกลับมาใช้ซ้ำเมื่อมีการนำเข้าครั้งถัดไปที่ใช้เบอร์เดียวกัน พร้อมลิงก์เดิมที่ยังชี้ไปนักเรียนที่ถูกลบ — ผลกระทบต่อสิทธิ์การมองเห็นของผู้ปกครองเป็นเรื่องของ A1-6/A1-12 ไม่ได้ประเมินในเอกสารนี้ ส่วนจะต้องลบหรือไม่ **รอ D0-8**

### 6.4 พิสูจน์ว่า rollback ไม่แตะข้อมูลนอก batch

จุดนี้สำคัญกว่าตัวเลขรวม เพราะเป็นสิ่งเดียวที่ agent อื่นทำให้ปนไม่ได้ — คำนวณ checksum เฉพาะแถวที่มีอยู่ก่อนเริ่ม แล้วเทียบกับ S0:

| ชุดแถว | ที่ S0 | ที่ S3 (หลัง rollback) | เท่ากัน |
|---|---|---|:--:|
| `students` ที่ `id <= 360` (360 แถว) | `cf0136acf4159571dcfcc4eac62ec3e4` | `cf0136acf4159571dcfcc4eac62ec3e4` | ✔ |
| `parents` ที่ `id <= 1698` (360 แถว) | `8cfb7e5c1881ca9097ceb51db7c8c64d` | `8cfb7e5c1881ca9097ceb51db7c8c64d` | ✔ |
| `parent_student` ที่ `student_id <= 360` (396 แถว) | `e0251d1a12d066b469a4f32dde527954` | `e0251d1a12d066b469a4f32dde527954` | ✔ |

**ตรงกันทุกไบต์** ทั้ง preview, apply และ rollback ไม่ได้แก้แถวใดที่มีอยู่ก่อน รวมถึงนักเรียน `S000001` แถว `GUARDIAN_MISMATCH` ที่ preview เตือนไว้แต่ไม่ได้ยืนยัน — ข้อมูลผู้ปกครองเดิมไม่ถูกแตะ

## 7. `import_batch` และ `audit_logs` ครบทั้ง 3 ขั้นหรือไม่

**CLAUDE.md §12 ข้อ 16 — "ทุก import ต้องสร้าง import_batch"**

`runPreview` (`studentImportPreview.service.js:248-253`) สร้างแถวใน `import_batches` ทุกครั้งภายใน transaction เดียวกับ `import_batch_rows` รอบนี้ preview 6 ครั้ง ได้ `import_batches` 6 แถว (id 112–117) ไม่มีการนำเข้าใดที่ไม่มี batch

**CLAUDE.md §12 ข้อ 8 — "ทุก CREATE/UPDATE/DELETE/EXPORT/IMPORT ต้องเขียน audit_logs"**

นับเฉพาะแถวของ `user_id=558` ที่ `entity_type IN ('student','vehicle','import_batch')` ตลอดรอบ:

| ขั้น | action / entity_type | จำนวน | เขียนที่ | `ip_address` |
|---|---|---:|---|---|
| Preview | `IMPORT` / `import_batch` | 6 | `school.routes.js:1757` | `127.0.0.1` |
| Apply | `IMPORT` / `import_batch` | 8 | `school.routes.js:1783` | `127.0.0.1` |
| Apply (ต่อแถวที่ insert) | `CREATE` / `student` | 6 | service:449 | **NULL** |
| Apply (สร้างรถอัตโนมัติ) | `CREATE` / `vehicle` | 1 | service:367 | **NULL** |
| Apply (กู้คืน / อัปเดตผู้ปกครอง) | `UPDATE` / `student` | 2 | service:503, 550 | **NULL** |
| Rollback | `DELETE` / `import_batch` | 6 | `school.routes.js:1822` | `127.0.0.1` |
| Rollback (ต่อแถว) | `DELETE` / `student` | 6 | service:717 | **NULL** |

รวม 33 แถวจากเส้นทางนำเข้า (บวกอีก 1 แถว `DELETE student` จากการลบนักเรียน 361 ผ่าน endpoint ปกติตอนคืนสภาพ §14 ซึ่งไม่ใช่ขั้นตอนนำเข้า)

ครบทั้งสามขั้น ไม่มีขั้นใดเงียบ และแถวระดับ batch บันทึกตัวเลขผลลัพธ์ + `reason` ภาษาไทยครบ

**ข้อควรระวังในการนับซ้ำ:** บัญชี `syn_school_001` (id 558) ถูก e2e run ของ agent อื่นใช้พร้อมกัน (§1.1) การนับด้วย `user_id=558` เพียงอย่างเดียวจึงได้แถวที่ไม่ใช่ของรอบนี้ปนมาด้วย เช่น `UPDATE vehicle` 3 แถว ซึ่งเส้นทางนำเข้าไม่มีทางเขียน — ตัวเลขในตารางข้างบนกรองด้วย `entity_id` ของ batch 112–117 และนักเรียน id 361–366 แล้ว

ข้อสังเกตสองข้อ (ไม่ถือเป็นข้อบกพร่อง เพราะกฎข้อ 8 ไม่ได้กำหนดฟิลด์):

- แถว audit ที่เขียนจาก service มี `ip_address = NULL` ทั้งหมด (service ไม่ได้รับ `req`) มีเฉพาะแถวระดับ batch ที่เขียนจาก route เท่านั้นที่มี IP หากต้องสอบสวนย้อนหลังว่า "ใครลบนักเรียนคนนี้จากเครื่องไหน" จะได้เฉพาะ `user_id` ต้องไปโยงกับแถว `import_batch` ในเวลาเดียวกันเอง
- เบอร์โทรผู้ปกครองใน audit ถูก mask แล้ว (`099****01` — `maskPhone`, `studentImportClassifier.js:11-14`) ตรงกับที่ตั้งใจไว้

**CLAUDE.md §12 ข้อ 7 — "import นักเรียน → สร้าง import_batch + INSERT/UPDATE students ทุกแถว + เขียน audit_logs (atomic)"**

implementation ปัจจุบันเป็น **transaction ต่อแถว** ไม่ใช่ transaction เดียวทั้ง batch (`applyInsertRow`/`applyGuardianRow`/`applyReactivateRow` เปิด connection + `beginTransaction` ของตัวเอง) และแถว `import_batches` ถูกสร้างคนละ transaction ตั้งแต่ตอน preview

รอบนี้ยืนยันว่า atomicity **ระดับแถว** ทำงานจริง (§8.1) — คือหนึ่งแถวได้ครบทั้ง `students` + `parents` + `parent_student` + `audit_logs` + `import_batch_rows` หรือไม่ได้เลย ส่วนการตีความว่ากฎข้อ 7 ต้องการ atomicity ระดับ batch ทั้งก้อนหรือไม่ (ซึ่งจะขัดกับดีไซน์ "apply บางส่วนได้ / apply ต่อได้" ของ 10.13B-4) เป็นคำถามเชิงออกแบบ **ไม่ตัดสินในเอกสารนี้**

## 8. เส้นทางความล้มเหลว

### 8.1 การนำเข้าที่ล้มเหลวกลางทาง (batch 113)

ไฟล์ 3 แถว โดยแถวกลางมี `ชื่อ` ยาว 150 ตัวอักษร ขณะที่ `students.first_name` เป็น `varchar(100)` และ MySQL อยู่ใน `STRICT_TRANS_TABLES`

**preview บอกว่าแถวนี้ READY / "พร้อมนำเข้า" / `can_apply=true`** (`{total:3, ready:3, error:0}`) — ดู §10 ข้อ D4

apply → HTTP 200 `{applied:2, failed:1}`:

```
row 2 → APPLIED (student 364)
row 3 → APPLY_FAILED
row 4 → APPLIED (student 365)     ← แถวหลังจุดที่ล้มยังทำงานต่อ
```

สิ่งที่ระบบทำ วัดจาก DB:

| รายการ | ก่อน apply | หลัง apply | อ่านว่าอย่างไร |
|---|---:|---:|---|
| `students` | 367 | 369 | +2 แถวที่สำเร็จ **แถวที่ล้มไม่ทิ้งนักเรียนค้าง** |
| `parents` | 363 | 365 | +2 **แถวที่ล้มไม่ทิ้งผู้ปกครองค้าง** |
| `parent_student` | 399 | 401 | +2 |
| `id_sequences.students` | 364 | **366** | +2 เท่านั้น — id ที่จองให้แถวที่ล้มถูกคืนพร้อม rollback ของ transaction **ไม่มี id หาย** |

`import_batch_rows` แถว 3: `status=APPLY_FAILED`, `applied_at=NULL`, `new_student_id=NULL`, `error_detail=ER_DATA_TOO_LONG`
`import_batches` แถว 113: `status=APPLIED_PARTIAL`, `success_rows=2`

**สรุปเส้นทางนี้: การแยก transaction ต่อแถวทำงานถูกต้อง แถวที่ล้มไม่ทิ้งข้อมูลครึ่ง ๆ กลาง ๆ และไม่หยุดแถวที่เหลือ** — นี่คือสิ่งที่ mock ใน jest ทดสอบไม่ได้เลย

### 8.2 apply ซ้ำแถวเดิม (batch 113 รอบสอง)

ยิง apply body เดิมซ้ำ → HTTP 200 `{applied:0, failed:1, details:[{row:3, APPLY_FAILED}]}`

- แถว 2 และ 4 ถูกกรองออกด้วยเงื่อนไข `applied_at IS NULL` (`service:580`) จึงไม่มีทางเกิดนักเรียนซ้ำ — **`students`/`parents`/`parent_student` ไม่เปลี่ยนแม้แต่ไบต์เดียว**
- แถว 3 ถูกลองใหม่แล้วล้มเหมือนเดิม
- **แต่** `import_batches` แถว 113 ถูกเขียนทับ: `success_rows` 2 → **0**, `applied_at` `22:29:37` → `22:31:31` (ดู §10 ข้อ D1)

### 8.3 rollback ซ้ำ (batch 112 รอบสอง)

ยิง rollback แถว 2,3,4 ซ้ำ → HTTP 200

```
rolled_back=0  already_rolled_back=3  skipped=0  failed=0
details: ทั้ง 3 แถว = ALREADY_ROLLED_BACK
```

- **ไม่มีการเปลี่ยนแปลงข้อมูลใด ๆ** snapshot ก่อน/หลังต่างกันเฉพาะ `audit_logs` +1 แถว (แถวระดับ batch ของ route) ไม่มีแถว `DELETE student` เพิ่ม
- `import_batch_rows.rolled_back_at` ของทั้ง 3 แถวยังเป็น `22:26:45` (เวลาจริงของการ rollback) ถูกต้อง
- **แต่** `import_batches.rolled_back_at` ถูกเลื่อนเป็น `22:27:54` คือเวลาของการ "ยิงซ้ำที่ไม่ได้ทำอะไร" (ดู §10 ข้อ D1)

### 8.4 รถหายระหว่าง preview กับ apply (batch 115)

ไฟล์อ้างทะเบียน `กก 9111 ลำปาง` ที่ไม่มีในระบบ

| การเรียก | ผล |
|---|---|
| preview **ไม่ส่ง** `auto_create_vehicle` | `VEHICLE_NOT_FOUND` / ERROR / `can_apply=false` |
| preview **ส่ง** `auto_create_vehicle=true` | `INSERT_NEW_AUTO_VEHICLE` / READY / "พร้อมนำเข้า (ระบบจะสร้างรถอัตโนมัติตอนนำเข้า)" |
| apply **ไม่ส่ง** flag | `vehicle_blocked=1` — ไม่มีข้อมูลใดถูกเขียน |
| apply **ส่ง** flag | สร้างรถ `V-0a70bf3b30bf` (`UNVERIFIED`, `vehicle_type=รถตู้`) + นักเรียน 366 + audit `CREATE vehicle` |

ระบบไม่จำเจตนา `auto_create_vehicle` จาก preview — `runPreview` ไม่เก็บค่านี้ลง `import_batches` ทำให้ apply ที่ไม่ส่ง flag ซ้ำจะ block ทั้งที่ preview บอกว่าพร้อม **ไม่ถือเป็นข้อบกพร่อง** เพราะ frontend คำนวณ flag ใหม่จาก classification ของแถวเอง (`ImportHistoryModal.jsx:139`, `ImportPreviewModal.jsx:182`) ผู้ใช้จริงจึงไม่เจอ — แต่ผู้เรียก API ตรง ๆ (เช่น script) จะเจอ

**rollback batch 115 → นักเรียน 366 ถูก soft-delete แต่รถที่สร้างอัตโนมัติยังอยู่ครบ** checksum `vehicles` ก่อน/หลัง rollback เท่ากันทุกไบต์ (`73ca91049326ddb1f10d509269ba350c`) รถคันนั้นตอนนี้เป็น `UNVERIFIED`, `is_deleted=0`, มีนักเรียน 0 คน

### 8.5 ขอบเขตของ rollback — ครอบเฉพาะแถวที่ INSERT

`rollbackRow` (`service:701`) รับเฉพาะแถวที่ `status='APPLIED'` **และ** มี `new_student_id` ทดสอบจริงกับ 4 กรณี:

| แถว | สภาพ | ผล |
|---|---|---|
| batch 113 แถว 3 | `APPLY_FAILED` | `NOT_ELIGIBLE_FOR_ROLLBACK` (ถูกต้อง — ไม่มีอะไรให้ย้อน) |
| batch 116 แถว 2 | `REACTIVATED` | `NOT_ELIGIBLE_FOR_ROLLBACK` |
| batch 117 แถว 2 | `GUARDIAN_UPDATED` | `NOT_ELIGIBLE_FOR_ROLLBACK` |
| batch 112 แถว 2–4 | `APPLIED` + `cid_hash` ตรง | `ROLLED_BACK` |

**ผลที่ต้องบันทึกไว้ให้ชัด: จาก 4 โหมดของ apply ฟีเจอร์ rollback ย้อนได้เพียงโหมดเดียว** การกู้คืนนักเรียน (`reactivate_student_confirmed`) และการอัปเดตผู้ปกครอง (`update_guardian_confirmed`) เมื่อทำแล้วไม่มีปุ่มย้อนกลับในแอป ต้องแก้ด้วยมือ — ข้อความ exit criteria ของ A1-10 ที่เขียนว่า "rollback คืนสภาพครบทุกแถว" (`execution-plan-to-completion-2026-09-04.md:303`) จึงเป็นจริงเฉพาะแถวที่เป็นการเพิ่มนักเรียนใหม่เท่านั้น ควรแก้ถ้อยคำ

การ์ดความปลอดภัยของ rollback ที่ยืนยันจาก source และเห็นผลจริง: ตรวจ `school_id` + `student_code` ตรงกัน, ตรวจ `cid_hash` ว่าเท่ากับ marker ของการนำเข้านั้น (ถ้าไม่ตรง = `NOT_SAFE_TO_ROLLBACK`), และไม่แตะนักเรียนที่ถูกลบไปแล้ว

## 9. โหมด apply ครบทั้ง 4 (ทดสอบกับ DB จริง)

ทุกกรณีใช้ข้อมูลสังเคราะห์ที่รอบนี้สร้างเองทั้งหมด **ไม่ได้แก้ข้อมูลนักเรียนหรือผู้ปกครองที่ seed ไว้แม้แถวเดียว** (พิสูจน์ที่ §6.4)

| โหมด | batch | ผล |
|---|---|---|
| `insert_ready` | 112, 113, 115 | เพิ่มนักเรียนใหม่ · ข้ามแถว `GUARDIAN_MISMATCH`/`SOFT_DELETED` ทั้งหมด |
| `reactivate_student_confirmed` | 116 | ส่ง `selected_row_ids:[2]` + `confirm_reactivate:true` → กู้คืนเฉพาะแถว 2 (นักเรียน 361: `is_deleted` 1→0, `deleted_at`→NULL, `grade` ป.5→ป.6, `classroom` 1→2, ผูกรถกลับ, `term_id`=2569-1) **แถว 3 ที่ไม่ได้เลือกไม่ถูกแตะ** |
| `update_guardian_confirmed` | 117 | ไม่ส่ง `confirm_guardian_update` → `guardian_updated=0` ไม่มีอะไรเปลี่ยน · ส่ง flag → อัปเดตชื่อผู้ปกครองของนักเรียน 361 (เบอร์เดิม จึงเข้าเส้นทาง "แก้ชื่อในแถวเดิม" ไม่สร้างผู้ปกครองซ้ำ) พร้อม audit ที่ mask เบอร์ |
| `mixed_confirmed` | — | **ไม่ได้ทดสอบกับ DB จริงในรอบนี้** ครอบเฉพาะใน `importApplyModes.test.js` ด้วย mock |

## 10. ข้อบกพร่องที่ยืนยันแล้ว

ทุกข้อในหัวข้อนี้ทำซ้ำได้ด้วยการยิง endpoint จริงและอ่านค่าจากตารางจริง ไม่ได้อ่านจากผลของ mock

### D1 · ตัวเลขสรุประดับ batch ถูกเขียนทับด้วยผลของ "ครั้งล่าสุด" ไม่ใช่ผลของ "การนำเข้า" — ความรุนแรง: กลาง

`applyBatch` (`studentImportPreview.service.js:595-600`) คำนวณ `successRows` จากตัวนับของ **รอบที่กำลังรันเท่านั้น** แล้ว `UPDATE import_batches SET status=?, applied_at=NOW(), success_rows=?, completed_at=NOW()` แบบไม่มีเงื่อนไข เช่นเดียวกัน `rollbackBatch` (`:738-739`) `UPDATE ... rollback_status=?, rolled_back_at=NOW()` ทุกครั้งที่ถูกเรียก

ที่วัดได้:

| กรณี | ค่าที่ควรเป็น | ค่าที่บันทึกจริง |
|---|---|---|
| batch 113 หลัง apply ครั้งแรก แล้ว apply ซ้ำ | `success_rows=2`, `applied_at=22:29:37` | **`success_rows=0`, `applied_at=22:31:31`** ทั้งที่นักเรียน 364, 365 มีอยู่จริงและมี `import_batch_id=113` |
| batch 112 หลัง rollback สำเร็จ แล้ว rollback ซ้ำ (no-op) | `rolled_back_at=22:26:45` | **`22:27:54`** |
| batch 116 (reactivate) และ 117 (guardian) หลังยิง rollback ที่ได้ `skipped=1` | `rollback_status=NULL` | **`ROLLED_BACK`** |

กรณีที่สามอันตรายที่สุด: `anyActive` (`:738`) นับเฉพาะแถวที่ `status='APPLIED'` แถวที่เป็น `GUARDIAN_UPDATED`/`REACTIVATED` จึงนับไม่ได้เลย ผลคือ batch ที่ **ไม่มีอะไรถูกย้อนกลับเลย** ถูกประทับว่า `ROLLED_BACK` และ `listBatches` (`:633`) ส่งค่านี้ขึ้นหน้าประวัติการนำเข้าให้โรงเรียนเห็น — โรงเรียนอาจสรุปว่าการอัปเดตผู้ปกครองถูกยกเลิกแล้ว ทั้งที่ยังมีผลอยู่

**ตัดข้อสงสัยว่าเป็นเครื่องมือทดสอบอย่างไร:** ทั้งสองครั้งเป็น `POST` ธรรมดาไปยัง route จริงด้วย body เดียวกัน; response ของ API เองรายงานถูกต้อง (`rolled_back:0, skipped:1`); ข้อมูลระดับแถวใน `import_batch_rows` ถูกต้องทุกค่า (`applied_at=22:29:37`, `rolled_back_at=22:26:45`, `rollback_status=NOT_ELIGIBLE_FOR_ROLLBACK`) — เพี้ยนเฉพาะคำสั่ง `UPDATE import_batches` ระดับ batch ซึ่งอ่านจาก source ได้ตรง ๆ ว่าเขียนทับแบบไม่มีเงื่อนไข

ขอบเขตความเสียหาย: ข้อมูลนักเรียนไม่เสีย และกู้ตัวเลขที่ถูกต้องกลับมาได้จาก `import_batch_rows` เสมอ (`getBatchDetail` คำนวณ `summary` ใหม่จากแถว จึงถูกต้อง) เสียเฉพาะ "บันทึกว่าเกิดอะไรขึ้น" ซึ่งเป็นสิ่งที่โครงการนี้ทั้งโครงการตั้งใจจะรักษา ไม่พบ script ใดใน `backend/scripts/` หรือ `scripts/` ที่อ่าน `import_batches.success_rows` ผลกระทบจึงจำกัดที่หน้าจอโรงเรียนและผู้ที่อ่านตารางเป็นหลักฐาน

### D2 · `error_rows` / `insert_count` ค้างที่ค่าตอน preview หน้าประวัติกับหน้ารายละเอียดขัดกันเอง — ความรุนแรง: กลางค่อนต่ำ

`runPreview` ตั้ง `insert_count`/`skip_count`/`error_rows` จากผลการวิเคราะห์ (`:250-252`) และ `applyBatch` **ไม่เคยแก้สามคอลัมน์นี้** ขณะที่ `listBatches` (`:632-647`) ส่งค่าดิบเหล่านี้ขึ้นหน้าประวัติ

batch 113 (1 แถวล้มเหลว, เข้าจริง 2 แถว) แสดงบนหน้าประวัติว่า:

```
status=APPLIED_PARTIAL  insert_count=3  error_count=0
```

แต่ `GET /students/import/113` (หน้ารายละเอียด ซึ่งนับใหม่จากแถว) คืน `summary = {error:1, applied:2}` — สองหน้าจอในระบบเดียวกันรายงานไม่ตรงกัน และ `ImportHistoryModal.jsx:160-161` ยังไฮไลต์ `error_count` เป็นสีแดงเมื่อ `>0` จึงไม่มีสัญญาณใดบนหน้าประวัติที่บอกว่ามีแถวล้มเหลว

**ตัดข้อสงสัยว่าเป็นเครื่องมือทดสอบอย่างไร:** อ่านจาก JSON ที่ endpoint ทั้งสองคืนโดยตรง และเทียบกับค่าในตาราง `import_batches` ที่ query ตรง — ตรงกันทั้งสามแหล่ง

### D3 · แถวที่ล้มตอน apply ยังแสดงข้อความ "พร้อมนำเข้า" และไม่มีช่องทางใดบอกสาเหตุ — ความรุนแรง: กลางค่อนต่ำ

เมื่อแถวล้ม ระบบเขียน `status='APPLY_FAILED'` และ `error_detail` แต่ **ไม่แตะ `message_th`** (`service:461`) ผลที่โรงเรียนเห็นจาก `GET /students/import/113`:

```
row 3 · status=APPLY_FAILED · message_th="พร้อมนำเข้า" · can_rollback=false
```

`getBatchDetail` (`:660-667`) และ `getReport` (`:609-614`) **ไม่มี `error_detail` ในรายการคอลัมน์ที่ SELECT** ทั้งคู่ สาเหตุจริง (`ER_DATA_TOO_LONG`) จึงอยู่แต่ในฐานข้อมูล โรงเรียนไม่มีทางรู้ว่าต้องแก้อะไรในไฟล์

ซ้ำเติมด้วย `can_continue_apply` (`:646`) ที่ยังเป็น `true` เพราะแถวนั้นยังมี `can_apply=1` และ `applied_at IS NULL` — หน้าจอจึงชวนให้กด "นำเข้าต่อ" ซ้ำไปเรื่อย ๆ กับแถวที่จะล้มเหมือนเดิมทุกครั้ง (ยืนยันแล้วใน §8.2)

**ตัดข้อสงสัยว่าเป็นเครื่องมือทดสอบอย่างไร:** อ่านจาก response ของทั้งสอง endpoint และตรวจรายการคอลัมน์ใน SELECT ของทั้งสองฟังก์ชันในไฟล์ service

### D4 · preview ประกาศ READY กับแถวที่ยาวเกินความกว้างคอลัมน์ปลายทาง — ความรุนแรง: ต่ำถึงกลาง

`classifyImportRow` (`studentImportClassifier.js:20-88`) ตรวจ "ต้องมีค่า" และตรวจรูปแบบเบอร์โทร แต่**ไม่ตรวจความยาว** ขณะที่ปลายทางคือ `first_name`/`last_name` `varchar(100)`, `prefix` `varchar(20)`, `grade`/`classroom` `varchar(20)`, `student_code` `varchar(50)` และ MySQL อยู่ใน `STRICT_TRANS_TABLES`

ผลคือแถวที่ชื่อยาว 150 ตัวอักษรได้ `status=READY`, `message_th="พร้อมนำเข้า"`, `can_apply=true` แล้วไปล้มตอน apply — ขัดกับหน้าที่ของ preview ที่มีไว้เพื่อให้ READY แปลว่า "กดแล้วเข้าแน่"

**ตัดข้อสงสัยว่าเป็นเครื่องมือทดสอบอย่างไร:** ตั้งใจใส่ค่ายาวเกินเอง; ยืนยัน `sql_mode` มี `STRICT_TRANS_TABLES` จริงก่อนทดสอบ (ถ้าไม่ strict MySQL จะตัดข้อความแทนที่จะ error ซึ่งเป็นบั๊กคนละแบบ); `import_batch_rows.error_detail` บันทึก `ER_DATA_TOO_LONG` ตรงตามที่คาด

### ข้อสังเกตเล็กที่ไม่ยกเป็นข้อบกพร่อง

- ข้อความตอบกลับของ rollback ที่ไม่ได้ย้อนอะไรเลยคือ "ย้อนกลับสำเร็จ · ข้าม 1" (`school.routes.js:1830`) คำว่า "สำเร็จ" ชวนเข้าใจผิด แต่ตัวเลขในข้อมูลถูกต้อง
- `import_batches.mode` ยังเป็น `'preview'` หลัง apply เสมอ (ไม่มีจุดใดอัปเดต) โหมด apply จริงอยู่ใน `audit_logs.new_value` เท่านั้น
- preview ที่ไม่ส่ง `auto_create_vehicle` แล้ว apply ส่ง flag (หรือกลับกัน) ทำให้ผลไม่ตรงกับที่ preview บอก — frontend คำนวณ flag เองจาก classification จึงไม่กระทบผู้ใช้จริง (§8.4)

## 11. Thai date/time (CLAUDE.md §12 ข้อ 4)

### สิ่งที่พิสูจน์ได้ในสภาพแวดล้อมนี้

**session ของ pool ถูกตรึงที่ +07:00 จริง** — probe แบบอ่านอย่างเดียวผ่าน pool ของแอปเอง (`backend/src/config/database.js:37-40` ตั้ง `SET time_zone='+07:00'` ทุก connection):

```
@@session.time_zone = +07:00      ← ค่าที่ hook ของ pool ตั้ง
@@global.time_zone  = SYSTEM
CURDATE()           = 2026-09-04 00:00 +07:00
```

**ทุก timestamp ที่การนำเข้าเขียน ใช้ `NOW()` ฝั่ง server บน session ที่ตรึงแล้ว** ไม่มีที่ใดในเส้นทางนี้คำนวณเวลาจากฝั่ง JS: `created_at`/`expires_at` ที่ `runPreview` (`:251` — `DATE_ADD(NOW(), INTERVAL 14 DAY)`), `applied_at` (`:457, 508, 555, 598`), `rolled_back_at` (`:707, 719, 739`), `approved_at` ของ `parent_student` (`:321, 493`) ผลที่วัดได้ตรงกันทุกแถว:

| เหตุการณ์ | เวลาใน DB (Asia/Bangkok) | UTC จริงขณะยิง |
|---|---|---|
| preview batch 112 | `2026-09-04 22:24:39` | `15:24:39Z` |
| apply batch 112 | `2026-09-04 22:25:27` | `15:25:27Z` |
| rollback batch 112 | `2026-09-04 22:26:45` | `15:26:45Z` |
| `expires_at` ของ batch 112 | `2026-09-18 22:24:39` | = +14 วันพอดี ไม่มีการเลื่อนวัน |

**`term_id` มาจากวันที่ตามปฏิทินกรุงเทพ ไม่ใช่จาก env** นักเรียนที่นำเข้าได้ `term_id = 2569-1` ขณะที่นักเรียนที่ seed ไว้ทั้ง 360 คนเป็น `2568-2` และไฟล์ env ของ sandbox ตั้ง `CURRENT_TERM=2568-2` ตรวจแล้วว่า**ถูกต้องตามการออกแบบ ไม่ใช่บั๊ก**:

- `term.service.js` ไม่ได้อ่าน `env.app.currentTerm` เลย (grep ทั้ง `backend/src` พบการอ้างถึงเพียงจุดประกาศใน `config/env.js:193`)
- ตาราง `terms` ว่าง (0 แถว) `deriveTermIdFromDate` จึงตกไปใช้ convention ล้วน
- 4 ก.ย. อยู่ในช่วง 16 พ.ค.–11 ต.ค. → ภาคเรียนที่ 1 ปีการศึกษา 2026 → `2026+543 = 2569-1` ตรงกับที่ `computeTermIdByConvention` คืน
- ทั้ง `getCurrentTerm(pool)` และ `computeTermIdByConvention(today)` คืน `2569-1` เท่ากัน และ `bangkokToday()` ระบุ `timeZone: 'Asia/Bangkok'` แบบตรงไปตรงมา จึงไม่ขึ้นกับ timezone ของเครื่อง

**ข้อความไทยครบทุกไบต์ตลอดสาย** — ชื่อ, นามสกุล, ชั้น (`ป.5`), ทะเบียนรถ (`นข 1000 ลำปาง`), ชื่อผู้ปกครอง และ `reason` ของ rollback เดินทางจาก CSV UTF-8 → API → `raw_json`/`normalized_json`/`audit_logs` โดยเทียบ hex แล้วตรงกับต้นฉบับ (§2.1)

### สิ่งที่พิสูจน์ **ไม่ได้** ในสภาพแวดล้อมนี้ (ห้ามอ้างว่าผ่าน)

- **การตรึง `+07:00` ป้องกันอะไรได้จริง วัดไม่ได้ที่นี่** เพราะ container MySQL ตั้ง system timezone เป็น Asia/Bangkok อยู่แล้ว (`SELECT NOW()` = 22:28 ขณะ `UTC_TIMESTAMP()` = 15:28) และเครื่อง Windows ที่รัน Node ก็เป็น GMT+0700 ถ้าการตรึงเสียไป wall-clock ก็จะยังถูกอยู่ดี สิ่งที่ยืนยันได้จริงมีเพียง "`@@session.time_zone` เท่ากับ `+07:00`" การพิสูจน์เต็มต้องรันบน DB ที่ตั้ง UTC ซึ่งทำไม่ได้โดยไม่ restart stack (ข้อห้ามของรอบนี้)
- **`process.env.TZ` ไม่ถึง Node บนเครื่องนี้** — `set -a; . sandbox.env` ทำให้ shell มี `TZ=Asia/Bangkok` แต่ `process.env.TZ` ใน Node เป็น `undefined` (ขณะที่ `NODE_ENV` ผ่านปกติ) เป็นพฤติกรรมของ MSYS2/Git Bash บน Windows ไม่ใช่เรื่องของแอป และไม่กระทบข้อสรุปข้างบนเพราะเส้นทางนำเข้าไม่พึ่ง timezone ของ process เลย
- **การแสดงผลบนหน้าจอไม่ได้ตรวจ** API คืนเวลาเป็น ISO ลงท้าย `Z` (เช่น `2026-09-04T15:24:39.000Z`) และ `ImportHistoryModal.jsx:33` แปลงด้วย `toLocaleString('th-TH', {dateStyle:'short', timeStyle:'short'})` **โดยไม่ระบุ `timeZone`** จึงแสดงตาม timezone ของ browser ผู้ใช้ ไม่ได้บังคับ Asia/Bangkok — เป็นรูปแบบเดียวกับอีกราว 60 จุดในโปรเจกต์ และ `frontend/src/utils/thaiTime.js` มีเฉพาะ helper ระดับ "วันที่" ไม่มี formatter ระดับวันที่-เวลาให้เรียกใช้ **ไม่ยกเป็นข้อบกพร่องของงานนำเข้า** เพราะเป็นแบบแผนทั้งระบบและเป็นคำถามว่าจะบังคับเขตเวลาให้ผู้ใช้นอกประเทศหรือไม่ — ควรตัดสินรวมทีเดียว ไม่ใช่แก้เฉพาะหน้าจอนี้

## 12. เรื่องที่ต้องรอการตัดสินใจ

| เรื่อง | สถานะ |
|---|---|
| นักเรียนที่ถูก rollback ยังเหลือแถว soft-deleted ค้างถาวร จะเก็บนานเท่าไร / ลบเมื่อไร | **รอ D0-8** (แถว "ข้อมูลนักเรียนที่จบ/ย้ายออก") |
| ผู้ปกครองและลิงก์ `parent_student` ที่การนำเข้าสร้างแล้ว rollback ไม่ลบ (ยัง `is_deleted=0`, `approved=1`) | **รอ D0-8** |
| ไฟล์ต้นฉบับที่ preview เก็บไว้ 14 วัน มีชื่อ-เบอร์ผู้ปกครองครบ (รอบนี้เหลือ 6 ไฟล์ `import-558-*.csv` ใน `backend/uploads/imports/`) | **รอ D0-8** (แถว "Import batch / ไฟล์ต้นทาง") |
| `import_batch_rows.normalized_json` เก็บเบอร์โทรผู้ปกครองแบบไม่ mask ในฐานข้อมูล (ต่างจาก `audit_logs` ที่ mask) จะเก็บนานเท่าไร | **รอ D0-8** และเกี่ยวกับ **D0-2** (data inventory) |
| รถที่สร้างอัตโนมัติแล้ว rollback ไม่ลบ ค้างเป็น `UNVERIFIED` ไม่มีนักเรียน | **รอ D0-8** ร่วมกับเจ้าของกระบวนการตรวจสภาพรถ |
| ควรเพิ่มการย้อนกลับสำหรับโหมด reactivate / guardian update หรือไม่ | เกี่ยวกับ **A1-12** (correction workflow) และ **C0-13** (change governance) — **ไม่ตัดสินในเอกสารนี้** |

## 13. สิ่งที่ยังไม่ได้ตรวจ

- โหมด `mixed_confirmed` กับ DB จริง (ครอบเฉพาะ mock)
- ไฟล์ `.xlsx` — รอบนี้ใช้ CSV ทั้งหมด เส้นทาง `readWorkbookSafely` / ExcelJS จึงไม่ได้เดิน
- เพดาน 5,000 แถว (`MAX_IMPORT_ROWS`) และพฤติกรรมกับไฟล์ขนาดใหญ่จริง
- การนำเข้าพร้อมกันสองผู้ใช้ (เส้นทาง `ER_DUP_ENTRY` ใน `linkParent:306-319`)
- `rollback` ของ batch ที่ยังไม่เคย apply (batch 114 เหลือสถานะ `PREVIEWED` ไว้)
- สิทธิ์ไฟล์ `0600` ของไฟล์ที่เก็บไว้ (`school.routes.js:1746`) — `chmod` ไม่มีผลบน Windows (`ls -l` แสดง `-rw-r--r--`) **ต้องตรวจซ้ำบน Linux**
- `cleanup-expired-imports.js` — ไม่ได้รัน เพราะยังไม่มี batch ใดหมดอายุ
- การแสดงผลบน browser จริง

---

## 14. สภาพ sandbox ที่ทิ้งไว้

`lampang_bus_sandbox` **ไม่ได้ถูกล้างหรือ reseed** และไม่มีการเขียนด้วย SQL ตรงเลย — ทุกการเปลี่ยนแปลงเกิดจากการเรียก endpoint ของแอป

**ไม่มีนักเรียนที่รอบนี้สร้างเหลือสถานะ active แม้แต่คนเดียว** (`SELECT COUNT(*) FROM students WHERE import_batch_id IN (112..117) AND is_deleted=0` = 0)

| สิ่งที่เหลือไว้ | รายละเอียด |
|---|---|
| `students` 6 แถว soft-deleted | id 361–366 รหัส `AUD001`, `AUD002`, `AUD003`, `AUDF01`, `AUDF03`, `AUDV01` ทั้งหมด `school_id='SYNSCH001'`, `is_deleted=1`, `vehicle_id=NULL` |
| `parents` 6 แถว | id 1699–1704 เบอร์ `0990000001/2/3/11/13/21` **ยัง `is_deleted=0`** (id 1699 ชื่อถูกแก้เป็น `นางผู้ปกครองคนใหม่ ทดสอบ` จากการทดสอบโหมด guardian update) |
| `parent_student` 6 ลิงก์ | `approved=1` ชี้ไปนักเรียนที่ถูกลบข้างต้น |
| `vehicles` 1 คัน | `V-0a70bf3b30bf` / `กก 9111 ลำปาง` / `UNVERIFIED` / `is_deleted=0` / นักเรียน 0 คน (จากการทดสอบ auto-create) |
| `import_batches` 6 แถว | id **112–117** พร้อม `import_batch_rows` 17 แถว — **นี่คือหลักฐานของเอกสารนี้ ไม่ควรลบทิ้งก่อนตรวจทาน** (ตารางมีมากกว่านี้ เพราะ agent อื่นสร้าง batch ของ `syn_school_002` ไว้ด้วย) |
| `audit_logs` 34 แถว | 33 แถวจากเส้นทางนำเข้า (§7) + 1 แถว `DELETE student` ของการลบนักเรียน 361 ตอนคืนสภาพ |
| ไฟล์ที่เก็บไว้ | 6 ไฟล์ `import-558-*.csv` ใน `backend/uploads/imports/` (`1788535479561`, `1788535767054`, `1788535933422`, `1788535933610`, `1788536288710`, `1788536310827`) `expires_at` = 18 ก.ย. 2569 **มี PII ของผู้ปกครองสังเคราะห์** — ไฟล์ `import-559-*` ในไดเรกทอรีเดียวกันเป็นของ agent อื่น |
| `id_sequences.students` | 361 → **367** |
| `students` 1 คนที่ลบผ่าน endpoint ปกติ | id 361 ถูก `DELETE /api/school/students/361` หลังทดสอบโหมด reactivate/guardian เสร็จ เพื่อไม่ให้เหลือ active |

สิ่งที่ **ไม่ได้** แตะ: นักเรียน/ผู้ปกครอง/ลิงก์/รถที่ seed ไว้เดิมทั้งหมด (checksum ตรงกันทุกไบต์ §6.4), ฐานข้อมูล `lampang_bus`, ไฟล์ใน `outputs/`, และเอกสาร sign-off ทุกฉบับ

ไม่ได้ commit, ไม่ได้ push, ไม่ได้แก้ไฟล์ใดใน repository นอกจากเอกสารฉบับนี้ (script probe ชั่วคราวที่ใช้ตรวจ timezone ถูกลบแล้ว — `git status --short` กลับมาเหลือเฉพาะไฟล์ของ agent อื่น)

### ถ้าต้องการล้างร่องรอยของรอบนี้ออกจาก sandbox

รันตามลำดับ (ทำลายหลักฐานของเอกสารนี้ — ทำหลังตรวจทานแล้วเท่านั้น) และ **ห้ามรันกับฐานข้อมูลอื่น**:

```sql
-- ลำดับสำคัญ: ลูกก่อนแม่
DELETE FROM parent_student WHERE student_id BETWEEN 361 AND 366;
DELETE FROM parents  WHERE phone IN ('0990000001','0990000002','0990000003','0990000011','0990000013','0990000021');
DELETE FROM students WHERE id BETWEEN 361 AND 366;
DELETE FROM import_batch_rows WHERE batch_id BETWEEN 112 AND 117;
DELETE FROM import_batches    WHERE id       BETWEEN 112 AND 117;
DELETE FROM vehicles WHERE id = 'V-0a70bf3b30bf';
DELETE FROM audit_logs WHERE user_id = 558 AND entity_type IN ('import_batch','vehicle')
   AND entity_id IN ('112','113','114','115','116','117','V-0a70bf3b30bf');
DELETE FROM audit_logs WHERE user_id = 558 AND entity_type = 'student' AND entity_id BETWEEN '361' AND '366';
UPDATE id_sequences SET next_value = 361 WHERE name = 'students';   -- เฉพาะเมื่อไม่มี id ≥ 361 เหลืออยู่
```

ไฟล์ที่เก็บไว้ลบด้วยเครื่องมือของแอปเอง ไม่ใช่ `rm`:

```
node backend/scripts/cleanup-expired-imports.js            # dry-run
node backend/scripts/cleanup-expired-imports.js --apply    # ลบเฉพาะไฟล์ของ batch ที่หมดอายุ + ไฟล์กำพร้า
```

หมายเหตุ: ณ วันที่จัดทำ ทั้ง 6 batch ยังไม่หมดอายุ (`expires_at` = 18 ก.ย. 2569) script จึงจะยังไม่ลบไฟล์เหล่านี้

---

## 15. หลักฐานดิบ

Snapshot ทุกขั้น (`S0`–`S15`), response JSON ทุกครั้งที่เรียก (`P1`–`P23`), ไฟล์ CSV ต้นทาง (`batch1`–`batch5`) และ SQL ที่ใช้ทำ snapshot อยู่ที่:

```
C:\Users\natta\AppData\Local\Temp\claude\D--Projects\93bbaeeb-605e-4f26-b8e3-249c65cbbd67\scratchpad\import-audit\
```

**เป็นไดเรกทอรีชั่วคราวของ session** ไม่ได้อยู่ใน repository และไม่ถือเป็น evidence pack ถ้าต้องใช้เป็นหลักฐานปิดงาน ต้องให้ผู้มีสิทธิ์ทำซ้ำแล้วเก็บลง path ที่กำหนดแยกต่างหาก

ตารางในเอกสารนี้อ่านค่าจากฐานข้อมูลและจาก response จริงทั้งหมด **ห้ามคัดลอกตัวเลขจากเอกสารนี้ไปใช้แทนการรันจริง** ถ้ามีการแก้ `studentImportPreview.service.js` หรือ `school.routes.js` หลังจากนี้ ต้องเดินเส้นทางนี้ใหม่ทั้งชุด
