# PERF-001 — LINE dispatcher without a held transaction

สถานะ: โค้ด + migration 059 + tests พร้อมใน PR — **ยังไม่ merge/deploy, ยังไม่ apply 059** (เป็นงานเปลี่ยน schema + ระบบส่ง LINE ต้องให้เจ้าของตัดสิน)

## ปัญหาเดิม
`line.service.js` `processUnsentNotifications` เปิด transaction → `SELECT … FOR UPDATE SKIP LOCKED` 50 แถว → เรียก LINE ทีละแถว (SDK 10.6.0 ไม่มี timeout) → commit ท้าย batch
- LINE ช้า/ค้าง = connection + row lock ค้างนานเท่ากัน (pool ค่าเริ่ม 10)
- process ตายหลัง LINE รับแล้วแต่ก่อน commit → แถวกลับเป็น `sent=FALSE` → ส่งซ้ำรอบถัดไป

## ข้อเท็จจริงที่ตรวจแล้ว (2026-11-08)
- งานแจ้งเตือนถูก INSERT ใน transaction เดียวกับการเช็กชื่ออยู่แล้ว (`checkin.service.js`) — ไม่ต้องแก้ฝั่งนั้น
- **production ไม่มีตัว dispatch ทำงานอัตโนมัติ**: ไม่มี cron/timer ของ `dispatch-notifications.js` หรือการเรียก `POST /api/line/process-notifications` (ไม่มี `dispatch.log`) → ความเสี่ยงนี้ยังไม่เกิดจริง แต่จะเกิดทันทีที่เปิด dispatcher ซึ่งเป็นการตัดสินใจของเจ้าของ (โควตา LINE — สคริปต์ตั้งให้ push เฉพาะ `emergency`)
- @line/bot-sdk ที่ติดตั้งจริง 10.6.0: `pushMessage(request, xLineRetryKey)` รองรับ retry key แต่ `HTTPFetchClient.post` ไม่ส่ง `AbortSignal` → ตั้ง timeout ผ่าน SDK ไม่ได้ จึงเรียก `POST /v2/bot/message/push` ด้วย `fetch` + `AbortController` เอง
- เอกสาร LINE "Retrying an API request" (อ่าน 2026-11-08): key ใช้ได้ 24 ชม. หลังคำขอแรก; ส่งซ้ำด้วย key เดิมที่รับไปแล้วได้ 409 + `x-line-accepted-request-id`; retry เฉพาะ 500/timeout; 4xx ไม่ต้อง retry; ห้ามเปลี่ยนผู้รับ/เนื้อหาเมื่อใช้ key เดิม; 200 = LINE รับคำขอ ไม่รับประกันว่าผู้ใช้ได้รับ

## การออกแบบ (`backend/src/services/lineDispatch.service.js`)
1. **claim** (transaction สั้น): เลือกแถวที่ `sent=FALSE AND retry_count<3 AND (claimed_until IS NULL OR claimed_until<NOW())` ด้วย `FOR UPDATE SKIP LOCKED` → ตั้ง `claim_token` (UUID ต่อรอบ), `claimed_until = NOW()+300s`, `retry_key = COALESCE(retry_key, UUID())`, `first_attempt_at`, `attempt_count+1` → commit **ก่อน** ส่ง ⇒ key ถูกบันทึกก่อนส่งครั้งแรก
2. **send** นอก transaction, concurrency 4, timeout 10 วินาที, ผู้รับ/ข้อความ/key เดิมทุกครั้ง; ตรวจว่าผู้รับยังผูกกับนักเรียนอยู่ (P-07) ก่อนส่ง
3. **settle** `UPDATE … WHERE id=? AND claim_token=?` — worker เก่าที่ lease หมดและถูก worker ใหม่ claim ไปแล้ว เขียนทับไม่ได้ (นับเป็น `lost`)

| ผลจาก LINE | สถานะ | ทำต่อ |
|---|---|---|
| 2xx | `ACCEPTED`, `sent=TRUE`, เก็บ `x-line-request-id` | จบ (หมายถึง LINE รับคำขอ ไม่ใช่ผู้ปกครองได้รับ) |
| 409 + `x-line-accepted-request-id` | `ACCEPTED` | จบ — ครั้งก่อนสำเร็จแต่คำตอบหาย |
| timeout / network / 5xx | `UNKNOWN`, `retry_count+1` | รอบถัดไปส่งด้วย key เดิม |
| 429 | `PENDING`, `retry_count+1` | รอบถัดไป key เดิม |
| 4xx อื่น | `FAILED`, `retry_count=3` | ไม่ส่งอีก |
| key อายุ ≥ 23 ชม. และยังไม่ ACCEPTED | `UNKNOWN`, `RETRY_KEY_EXPIRED_OUTCOME_UNKNOWN`, `retry_count=3` | **ไม่สร้าง key ใหม่ส่งซ้ำอัตโนมัติ** — ให้คนตรวจ |
| ครบ 3 ครั้งด้วยผล unknown | คง `UNKNOWN` | ให้คนตรวจ |

worker ตายกลางงาน → lease หมด → รอบถัดไป claim ใหม่ ใช้ key เดิม → ถ้าครั้งก่อน LINE รับแล้วจะได้ 409 → ไม่ส่งซ้ำ

## ความเข้ากันได้โค้ดเก่า/ใหม่
- `processUnsentNotifications` ตรวจคอลัมน์ 059 ก่อน (cache ผลบวกตลอด process, ผลลบ 5 นาที) — ไม่มีคอลัมน์ → ใช้ dispatcher เดิมไม่เปลี่ยนพฤติกรรม ⇒ deploy โค้ดก่อน apply 059 ได้
- 059 เป็น additive (คอลัมน์ nullable/default + index) โค้ดเก่าไม่อ่านคอลัมน์ใหม่ ⇒ apply 059 ก่อนโค้ดใหม่ก็ได้
- **ห้ามรัน dispatcher เก่าและใหม่พร้อมกันหลัง apply 059** (ตัวเก่าไม่เคารพ lease) — production มี PM2 process เดียวและยังไม่มี cron dispatch จึงเกิดได้เฉพาะถ้ามีคนรันสคริปต์เก่าค้างไว้มือ
- `/api/health` จะแสดง pending migration เพิ่มเป็น 3 จนกว่าจะ apply 059

## ลำดับเปิดใช้ที่เสนอ (ต้องได้รับอนุมัติแต่ละขั้น)
1. merge + deploy โค้ด (ยังทำงานแบบเดิมเพราะไม่มีคอลัมน์)
2. backup → owner apply 059 ด้วยสคริปต์แบบเดียวกับ 056–058 → `--verify`
3. restart backend (หรือรอ cache ผลลบ 5 นาที) → dispatcher ใหม่ทำงานเมื่อถูกเรียก
4. การเปิด cron dispatch เป็นการตัดสินใจแยก (โควตา/ชนิดข้อความ)

Rollback: deploy โค้ดก่อนหน้า (อ่านคอลัมน์ไม่เป็น ignore) แล้วถ้าจำเป็น `rollback/059_notification_dispatch_lease_rollback.sql`; แถวที่ ACCEPTED แล้วมี `sent=TRUE` จึงไม่ถูกส่งซ้ำ

## การทดสอบ
- `tests/lineDispatch.unit.test.js` (ไม่ใช้ DB): header retry key/token/body, timeout ตัดที่ 200 ms, 409, network error, ตารางจำแนกผล, schema probe
- `tests/lineDispatch.test.js` (MySQL จริงใน CI + LINE จำลองที่ dedupe ตาม key): ส่งปกติ, **ไม่มี row lock ค้างระหว่าง LINE ช้า** (`FOR UPDATE NOWAIT` จาก connection อื่นสำเร็จ), **รับแล้วแต่คำตอบหาย** → ส่งซ้ำ key เดิม ได้ 409 ส่งถึง 1 ครั้ง, **worker หยุดหลัง claim** → lease หมด → ใช้ key เดิม ไม่ส่งซ้ำ, **worker เก่าเขียนทับไม่ได้**, **worker ซ้อน 3 ตัว** 12 แถวส่งครั้งเดียวต่อแถว, 5xx/4xx, key หมดอายุ
- ไม่ได้ทดสอบกับ LINE จริง (ห้ามส่งข้อความถึงผู้ใช้จริง)
