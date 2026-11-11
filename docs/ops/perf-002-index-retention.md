# PERF-002 — index + retention for `notifications` / `line_message_logs`

สถานะ: PR ซ้อนบน PERF-001 (#148) — **ยังไม่ merge, ยังไม่ apply 059/060, ไม่ลบข้อมูล production, ยังไม่กำหนดอายุข้อมูล**

## สิ่งที่ตรวจ
- schema ล่าสุด (`tests/schema.sql` + migrations): `notifications` มีแค่ PK + FK `target_line_user_id`; `line_message_logs` มี PK + `idx_lml_line_user` — ไม่มี index สำหรับ query คิวหรือการลบตามอายุ
- query ที่ใช้จริง: คิว dispatcher (`sent=FALSE AND retry_count<3 AND created_at>=… ORDER BY created_at LIMIT 50`), และ query ลบตามอายุของสคริปต์ใหม่
- ขนาดตารางจริงบน production: **วัดไม่ได้** — คำขอนับแถวแบบ aggregate บน production ถูกระบบความปลอดภัยของ session ปฏิเสธ จึงไม่ได้ทำซ้ำ
- `cleanup-old-logs.js` รันด้วย `--apply` ทุกคืนบน production แล้ว → **ไม่เพิ่ม 2 ตารางนี้เข้าไป** (จะกลายเป็นการลบข้อมูลจริงทันทีที่ deploy โดยยังไม่มีการกำหนดอายุ)

## Index (ไม่ซ้ำกับ PERF-001)
| index | migration | ใช้กับ |
|---|---|---|
| `notifications(sent, retry_count, created_at)` | 059 (PERF-001) | คิว dispatcher |
| `notifications(created_at, id)` | 060 | ลบตามอายุ เรียง created_at, id |
| `line_message_logs(created_at)` | 060 | ลบตามอายุ |
หลักฐาน EXPLAIN: `tests/notificationRetention.test.js` พิมพ์ `[PERF-002 EXPLAIN]` ก่อน/หลัง index บนข้อมูลสังเคราะห์ 6,000/3,000 แถวใน CI log และ assert ว่า `line_message_logs` เปลี่ยนจาก full scan (`ALL`) เป็นใช้ `idx_lml_created`

## Cleanup: `backend/scripts/cleanup-notification-logs.js`
- dry-run เป็นค่าเริ่ม; ต้องระบุ `--notifications-days=N --line-log-days=N` เอง (ไม่มีค่าเริ่ม — เจ้าของเป็นผู้กำหนดตาม PDPA)
- ไม่ลบ notification ที่ยังรอส่ง (`sent=FALSE AND retry_count<3`), กำลังถูก claim (`claim_token` ไม่ว่าง), หรือ `UNKNOWN` ที่รอคนตรวจ — ลบเฉพาะ `sent=TRUE` หรือ `FAILED`/`SKIPPED` ที่ปิดแล้ว
- batch ละ ≤ 5,000 (ค่าเริ่ม 1,000) สูงสุด 50 batch/รอบ พัก 200 ms, transaction สั้นต่อ batch, `SKIP LOCKED`, DELETE ตรวจเงื่อนไขซ้ำ, ไม่แตะแถวอนาคต
- ต้องมี 059 ก่อน (ใช้คอลัมน์ `claim_token`, `delivery_state`)

ตัวอย่าง (หลังเจ้าของเลือกอายุ): `node backend/scripts/cleanup-notification-logs.js --notifications-days=<N> --line-log-days=<N>` (dry-run ดูจำนวน) แล้วจึงเพิ่ม `--apply`

## ทดสอบ
- `tests/cleanupNotificationLogs.unit.test.js` (ไม่ใช้ DB) 7 กรณี: บังคับระบุวัน, dry-run ไม่เปิด transaction, เงื่อนไขกันแถวค้าง, จำกัด batch
- `tests/notificationRetention.test.js` (MySQL ใน CI): EXPLAIN + ลบจริงบนข้อมูลสังเคราะห์ ตรวจว่าแถว pending/claimed/UNKNOWN และแถวใหม่กว่ากำหนดยังอยู่ครบ
