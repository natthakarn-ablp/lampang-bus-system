# Changelog

บันทึกการเปลี่ยนแปลงของระบบรถรับ-ส่งนักเรียนจังหวัดลำปาง
รูปแบบอ้างอิง [Keep a Changelog](https://keepachangelog.com/th-TH/1.1.0/)

---

## [Unreleased · `feat/tracking-security-hardening`] — 2026-09-05

**ยังไม่ push และยังไม่ merge** — 69 commit นำหน้า `origin/main` (`3cab155`)
ส่วนนี้บันทึกว่าอะไรอยู่บนกิ่งนี้ ไม่ได้แปลว่าพร้อม deploy และไม่ใช่คำประกาศว่าระบบผ่าน UAT
หรือ PDPA — สถานะเหล่านั้นยังรอหลักฐานและลายเซ็นตามแผนปิดโครงการ

> **หมายเหตุถึงผู้อ่านแผน:** งาน A0-1 ในแผนปิดโครงการเขียนไว้ว่า "push `cef4bd1`;
> ทำ release note จาก diff `0060c3e..cef4bd1`" ซึ่งเป็นช่วง 15 commit
> ตอนนี้ `cef4bd1` เป็นบรรพบุรุษของ HEAD ไปแล้วและมีอีก 38 commit ต่อจากนั้น
> ช่วงที่แผนระบุจึงล้าสมัย — ส่วนนี้เขียนจากช่วงจริง `origin/main..HEAD`
> ตามบทเรียนว่าถ้าเอกสารกับสภาพจริงไม่ตรงกัน ให้ตรวจก่อนว่าฝั่งไหนผิด

### 🔐 Security & privacy

- **Refresh-token replay detection** — refresh token ที่ถูก revoke ไปแล้วและถูกนำมาใช้ซ้ำ
  หลังพ้นช่วงผ่อนผัน 10 วินาที ถือว่ามีสองฝ่ายถือ token ใบเดียวกัน ระบบจะยุติทุก session
  ของบัญชีนั้นและบันทึก audit (`9379495`) ทำโดยไม่แก้ schema — ใช้แถว sentinel ใน
  `revoked_tokens` (มี DDL proposal สำหรับทางที่สะอาดกว่าใน `9f929cd`)
- **Web client เก็บ refresh token ใบใหม่แล้ว** (`4f754ae`) — interceptor เดิมเก็บเฉพาะ
  access token ทิ้งใบที่ rotation ออกให้ เมื่อรวมกับ replay detection ข้างบน ผู้ใช้เว็บ
  ทุกคนจะถูกบังคับออกจากระบบทุกอุปกรณ์ตั้งแต่การ refresh ครั้งที่สอง — พบจากการอ่าน
  residual-risk register (RR-02/RR-03) ก่อนที่จะถึงมือผู้ใช้
- **Path parameter ที่เป็นตัวเลข ตรวจจากสตริงดิบ ไม่ใช่ค่าที่ถูกแปลงแล้ว** (`f5375dc`) —
  `parseInt('1e5')`, `'1abc'`, `'1.9'`, `' 1'`, `'+1'`, `'01'` ล้วนได้ `1` ทั้งหมด
  92 จุดเรียกใน 10 ไฟล์ route ย้ายมาใช้ guard เดียวกัน
- **PDPA: `/api/school/audit-logs` ฝั่ง JSON เป็นตัวเดียวในสี่บทบาทที่ยังคืน
  `parent_phone` และ `line_user_id` ดิบ** (`241a542`) ฝั่ง CSV redact อยู่แล้ว
- **`/api/affiliation/audit-logs` เป็นตัวเดียวในสี่ที่ไม่มี `exportFormatLimiter`** (`21325cd`)
- **RBAC / scope**: ตรวจจาก router graph จริง (`b35bbf1`), grade boundary
  (`516da32`), consent gate ของรายชื่อบุตรหลาน (`dbc19a5`)
- **`from`/`to` ของ research export ต้องเป็นวันที่ที่มีอยู่จริง** (A1-11 S6) — ค่าสองตัวนี้
  ไหลไปอยู่ใน `meta.date_range` ของชุดข้อมูล ใน `entity_id` ของ audit row `EXPORT`
  ที่ชุดข้อมูลอ้างเป็นหลักฐานของตัวเอง และในชื่อไฟล์ header ทั้งหมดนี้ไม่เคยถูกตรวจ
  พร้อมกันนี้รวม `isValidDate` ห้าสำเนาในห้า router ให้เหลือหนึ่ง
  (`utils/calendarDate.js`) — สี่ในห้าเป็น regex ที่รับ `2026-13-45`

### 🐛 Fixed — พบจากการทดสอบกับฐานข้อมูลจริง

- **DATE เดินถอยหลังหนึ่งวัน** ใน 6 จุด: วันหมดอายุประกันของ transport (`ca8c9ae`),
  การลาและ audit row ของการตรวจสภาพ (`46e4fdf`), รถของ province และ affiliation
  (`be807d7`) — mysql2 แปลง DATE เทียบกับ timezone +07:00 ของ connection
- **การขึ้นรถที่ถูกยกเลิกยังถูกนับว่ามาเรียน และ duplicate guard ไม่รอด concurrency** (`6aabf2d`)
- **รายงานผลนำเข้าไม่ได้บอกว่าเกิดอะไรกับแต่ละแถวจริง ๆ** (`840b15a`, `ccbd8df`)
- **ฟิลด์ยาวเกินคืน 500 แทนที่จะเป็น 400** และไม่บอกว่าฟิลด์ไหน (`622fe41`, `99e7734`)
- **Export CSV/Excel สร้างทั้งก้อนในหน่วยความจำ** → เปลี่ยนเป็น stream (`e6e06f2`)

### 🧪 เครื่องมือวัดผล — หยุดรายงานว่า "ผ่าน" ทั้งที่ยังไม่ได้ตรวจ

รูปแบบเดียวกันปรากฏสี่ครั้งบนกิ่งนี้ ทุกครั้งคือ "รันไม่ได้" ถูกรายงานเป็น "ตรวจแล้วไม่พบปัญหา"

- npm audit รายงานว่าสะอาดจาก report ที่ parse ไม่ได้ (`307c28e`, `53641e6`)
- `git()` ใน readiness collector คืน `''` เมื่อล้มเหลว ทำให้ worktree ที่อ่านไม่ได้กลายเป็น
  "worktree clean" และ diff ที่อ่านไม่ได้กลายเป็น "ไม่พบ secret" (`b0d8d2a`)
- teardown ของชุดทดสอบไล่ลำดับ FK จาก `information_schema` แทนรายการที่เขียนด้วยมือ
  และรายงานแถวที่เหลือค้างเป็นความล้มเหลวของรอบนั้น (`9a1b720`)
- **load test นับ 404 ว่าเป็นคำขอที่ทำงานสำเร็จ** — scenario ที่มีน้ำหนักมากที่สุด (0.20)
  ชี้ไปที่ path ที่ไม่มีอยู่จริง จึงได้ p95 สวยงามจาก 404 handler ตอนนี้แยก
  served / rate_limited / rejected / failed และ scenario ที่ไม่เคยถูก served
  รายงานเป็น `NOT MEASURED` (`cb3f4a2`)

### ♿ Accessibility

- **วัด contrast จริงใน `capture.mjs`** (`8ff4cdf`) — เดิมวัดเฉพาะ target size 44×44
  และ focus ring ส่วน contrast เป็นข้อความในเอกสารรีวิว รอบแรกที่วัด: 307 จุดตกเกณฑ์
  บน 75 จาก 136 หน้า
- **ย้ายทุกสีตัวอักษรไปโทนที่ผ่าน 4.5:1** (`9337933`) — ตอนนี้ 136 หน้า, ตัวอักษรที่ถูกวัด
  7,443 จุด, ตกเกณฑ์ 0, วัดไม่ได้ 0 รวมถึงปุ่ม "รีเฟรชข้อมูล" ที่อยู่ที่ 1.2:1
  (แทบมองไม่เห็นจนกว่าจะเอาเมาส์ไปวาง) บนสองหน้า

### 🔒 A1-9 — ย้ายตัวนับความปลอดภัยออกจากหน่วยความจำของโปรเซส

`migration 051` เพิ่มสามตาราง (`login_lockouts`, `line_webhook_events_seen`,
`line_bind_lockouts`) พร้อม rollback — apply แล้วเฉพาะฐานที่ทิ้งได้ **ไม่แตะ `lampang_bus`
และไม่แตะ production** เดิมตัวนับทั้งสามอยู่ใน `Map` ของโปรเซสเดียว ซึ่งคอมเมนต์ในโค้ดเขียน
เงื่อนไขไว้เอง: ถ้ารันหลาย instance ต้องย้ายก่อน ผลคือเพดาน 10 ครั้งกลายเป็น 10×N และการ deploy
หนึ่งครั้งปลดล็อกทุกบัญชีที่กำลังถูกล็อกอยู่ (ข้อหลังเกิดแม้มี instance เดียว)

ตารางที่สี่ (`line_link_sessions`) **จงใจไม่สร้าง** เพราะเก็บเบอร์โทรแบบอ่านได้ ซึ่งรอ DPO
ตัดสินใน D0-8 — สถานะการผูกบัญชี LINE จึงยังอยู่ในหน่วยความจำ ผลเสียคือผู้ใช้อาจต้องเริ่ม
ขั้นตอนใหม่ ไม่ใช่มาตรการที่อ่อนลง

### 👥 หน้าจอ participation (Phase 4) — API มีมาตั้งแต่ `1cccee8` แต่ไม่มีหน้าบ้านเลย

`grep -ril participation frontend/src` เคยคืนค่าว่าง และไม่มี route ใดในทั้ง 102 route
ที่พาไปถึง — handler ทั้งห้าตัวเข้าไม่ถึงจากตัวผลิตภัณฑ์ ตอนนี้มีสามหน้าจอ (รายการรวม,
รายละเอียด + ลำดับเหตุการณ์ + ฟอร์มบันทึก, ยื่นเรื่องใหม่) เมนูถูก gate ด้วย
`participationCases` แบบเดียวกับฟีเจอร์ dark อื่น

ทดสอบบนสแต็กจริง (backend + staging DB + เบราว์เซอร์) ไม่ใช่แค่ build ผ่าน — พบและแก้บั๊กที่
`vite build`, `check:hybrid-ui` และ `check:labels:strict` ผ่านหมดแต่หน้าพังจริง: `FormField`
รับ `children` เป็น render prop ไม่ใช่ node

### 🧰 Infrastructure & staging

- **Sandbox ที่ทดสอบ end-to-end ได้โดยไม่แตะ production** (`b64034a`)
- **Local staging ขึ้นจริงครั้งแรก** — seeder เขียนไว้ตั้งแต่ 4 ก.ย. แต่ header ของมันระบุเองว่า
  "ยังไม่เคยรันจริง" ตอนนี้รันแล้ว: 58 ตาราง, 50 โรงเรียน, 1,800 นักเรียน,
  64,440 checkin_logs พร้อม README (`backend/scripts/LOCAL_STAGING.md`)
- **Load test บน local staging** — วัดได้ 3 จาก 9 scenario, `supports_1000_user_claim`
  = false, คอขวดคือ pool 10 connection กับ 8 round-trip เรียงกันใน `getDailyReport()`
  ไม่ใช่ index (`docs/performance/load-test-local-2026-09-05.md`)

### 📄 เอกสารที่เพิ่มขึ้นและยัง**ไม่ใช่**การอนุมัติ

`docs/project-closure/`, `docs/security/threat-rbac-idor-review-2026-09-04.md`,
`docs/security/residual-risk-register.md` (RR-01…RR-09), `docs/ui/redirect-map.md`,
`docs/performance/` — ทุกฉบับมีช่องตัดสินใจที่ยังว่าง และช่องเหล่านั้นต้องให้คนกรอก

---

## [Unreleased] — 2026-07-07

ชุดการเปลี่ยนแปลงบน branch `feat/date-derived-term` ที่ยังไม่ได้ merge เข้า main
(รอทีม review + push ขึ้น GitHub ก่อน deploy ถัดไป)

### 🔧 Fixed — แก้ bug จากการตรวจสอบเซิร์ฟเวอร์จริง

- **`cleanup-expired-imports`**: เมื่อลบไฟล์ import (หรือพบว่าไฟล์หายไปแล้ว)
  ระบบจะ NULL `import_batches.stored_file_path` ด้วย ก่อนหน้านี้ record ยังชี้ไปไฟล์ที่
  หายไป ทำให้ `integrity-monitor` นับ `expired_import_files = 102` ซ้ำทุกวัน
  และ ops เพิกเฉยต่อ alert จริง (`827cd90`)
- **`cleanup-expired-imports`**: เพิ่ม orphan-file sweep — ลบไฟล์ใน `uploads/imports/`
  ที่ไม่มี `import_batches` record ใดอ้างถึง (จับไฟล์จาก preview ที่ reject ตั้งแต่
  validation เช่น `.xls` รุ่นเก่า) ลดไฟล์ใน disk จาก 301 → 211 (`827cd90`)
- **`vehicleAdmin.softDeleteVehicle`**: ปิด `driver_vehicle_assignments` ที่ active
  อยู่ (`is_active=0`, `end_date`) ก่อน soft-delete รถ กัน orphan assignment
  ที่ `integrity-monitor` ตรวจพบ 6 รายการ — data fix รันไปแล้วใน DB (`827cd90`)
- **`errorHandler`**: แยก log level — client error 4xx (JWT หมดอายุ, business validation,
  duplicate) ไม่ log ใน production แล้ว เหลือเฉพาะ genuine 5xx
  ลด log noise หลายร้อยบรรทัด/วัน (`827cd90`)

### 🛡️ Security — ป้องกัน zip bomb + CSV/plate canonical

- **`xlsxPreflight` (module ใหม่)**: ตรวจ ZIP structure ของ `.xlsx` ก่อน ExcelJS
  อ่าน — จำกัด entries (≤2000), uncompressed bytes (≤50MB), compression ratio
  (≤100x) ป้องกัน zip bomb ที่ทำให้ server ค้าง/OOM ตอน import (`d8669af`)
- **`csv` (module ใหม่)**: CSV parser ที่จัดการ quoted fields ถูกต้อง
  แทน `split(',')` เดิมที่พังตอนเจอ comma ในชื่อ (`d8669af`)
- **`studentImportPreview` + `school.routes` + `affiliation.routes`**: ทุก read
  ผ่าน `xlsxPreflight.readWorkbookSafely()` + `csv.parseCsvRecords()` (`d8669af`, `ef9fd48`)
- **Import apply**: เพิ่ม row locking `FOR UPDATE` กัน race condition + บันทึก
  `success_rows` / `completed_at` บน batch (`d8669af`)
- **Parent lookup**: กรอง `parent_student.approved = TRUE` กันแก้ผู้ปกครองที่ยัง
  ไม่ยืนยัน (`d8669af`)

### 🚗 Plate — บังคับจังหวัด + canonical aliases

- **`validatePlateNo`**: บังคับว่าทะเบียนต้องมีจังหวัด (`PLATE_PROVINCE_REQUIRED`)
  และจังหวัดต้องเป็นจังหวัดที่รู้จัก (`PLATE_PROVINCE_INVALID`) (`ad5d6f7`)
- **`plateIdentity`**: เปลี่ยน alias table เดิม (มีแค่ Bangkok) เป็นตารางครบ
  77 จังหวัด + คำย่อไทย (`กทม`) + คำย่อโรมัน (`BKK`, `LPG`) + รูปแบบ `จ.ขอนแก่น` (`ad5d6f7`)
- **Import matcher**: ลบ fuzzy/prefix-match fallback ที่เคย match plate ผิด
  ตอนนี้ surface `AMBIGUOUS_PLATE_NEEDS_PROVINCE` แทนการเดา (`ad5d6f7`)

### 📚 Docs / Cleanup

- **คู่มือ PDF**: regenerate คู่มือผู้ใช้ 8 ไฟล์ (`043f3bb`)
- **dist backups**: ลบ `frontend/dist.bak-*` สองโฟลเดอร์ (build snapshot เก่า) (`043f3bb`)
- **ad-hoc test files**: ลบ `test_exceljs_error.js`, `test_full_flow.js`,
  `test_scenario.js` (debug script ที่ไม่ใช้ใน build)

### ⚠️ Breaking — ต้องตรวจก่อน merge

- **ทะเบียนรถเก่า 5 คัน** ที่ไม่มีจังหวัดครบ จะไม่สามารถบันทึกผ่าน admin UI ได้จนกว่าจะ
  เติมจังหวัด (`บน1467`, `บง 8851`, `นข3147`, `นข4749`, `จษร 7414 อยุธยา`) —
  ดูรายละเอียดใน `Action-Required-5-Vehicles-Without-Province.md` นอก repo

---

## วิธี deploy ถัดไป

```bash
# หลัง review ผ่าน + test ในเครื่อง dev:
git push origin feat/date-derived-term
# สร้าง PR → merge เข้า main → ใน server:
git checkout main && git pull
cd backend && npm ci --omit=dev
cd ../frontend && npm run build
pm2 reload schoolbus-backend
```

---

## ก่อนหน้านี้

ดูประวัติเต็มด้วย `git log --oneline` บน branch `main`
