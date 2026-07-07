# Changelog

บันทึกการเปลี่ยนแปลงของระบบรถรับ-ส่งนักเรียนจังหวัดลำปาง
รูปแบบอ้างอิง [Keep a Changelog](https://keepachangelog.com/th-TH/1.1.0/)

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
