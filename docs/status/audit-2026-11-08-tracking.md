# Architecture audit 2026-11-08 — finding tracker

รายงานต้นฉบับ `SYSTEM_AUDIT_2026-11-08_1325.md` เก็บไว้นอก repository (มีรายละเอียดภายในของเครื่อง production; repo นี้เป็น public) — ตารางนี้สรุปเฉพาะสิ่งที่ติดตาม
อัปเดตล่าสุด: 2026-11-08 (night work) · "production" = commit ที่ `/health` รายงาน

| Finding | สรุป | งานแก้ | PR | หลักฐาน | สถานะ production |
|---|---|---|---|---|---|
| OPS-001 | deploy ไม่บังคับ CI | gate `DEPLOY_TARGET_SHA` + Full Quality push สำเร็จ | #146 | CI run 42480368248; ติดตั้ง deploy-state 2026-11-08 | **ใช้จริง** (ebea699) |
| DATA-001 | ไม่มีหลักฐาน restore, client_id rclone จะหมดอายุ, แจ้งเตือน backup อยู่แค่ใน log | ตัวตรวจ 4 ขั้น + แจ้งเตือนแบบจำกัดความถี่ (ยังไม่เปิด) + restore round trip สังเคราะห์ใน CI + runbook client_id | #147 | CI 42484151024 / 42484169643; รันอ่านอย่างเดียวบน prod: local/offhost/readback OK | merged (07a7e4f); deploy ตามรายงานคืนนี้; **cron/แจ้งเตือน/client_id/restore จริง = รอเจ้าของ** |
| PERF-001 | ส่ง LINE ขณะถือ transaction | claim + lease + retry key + ส่งนอก transaction, migration 059 | #148 | unit + integration (LINE จำลอง) | **ยังไม่ merge** (needs-owner); production ยังไม่มี dispatcher ทำงานอัตโนมัติ |
| PERF-002 | notifications ไม่มี index/retention | index 059/060 + สคริปต์ลบแบบ opt-in ไม่มีค่าอายุเริ่มต้น | #149 (ซ้อนบน #148) | unit + EXPLAIN ใน CI | **ยังไม่ merge** (needs-owner) — ต้องการอายุข้อมูลจากเจ้าของ |
| DOC-001 | ไม่มี README/แผนที่โมดูล, CLAUDE.md ล้าสมัย | README, INDEX, ARCHITECTURE, modules/, CLAUDE.md ใหม่ (สเปกเดิมย้ายไป history) | (PR DOC-001) | — | เอกสารเท่านั้น |
| ARCH-001 | route ไฟล์ใหญ่ | ยังไม่ทำ (ไม่ refactor ทั้งไฟล์ตามคำสั่ง) | — | — | — |
| ARCH-002 | students เขียนจากหลายโมดูล | ยังไม่ทำ | — | — | — |
| PERF-003 | เช็กทั้งคันเป็น transaction ยาว | ยังไม่ทำ (ต้องวัดก่อน) | — | — | — |
| PERF-004 | pool queue ไม่จำกัด | ยังไม่ทำ (ค่าใน .env production) | — | — | — |
| OPS-002 | ไม่มี error tracking | ยังไม่ทำ (รอเจ้าของเลือก) | — | — | — |
| TEST-001 | ไม่มี lint | ยังไม่ทำ | — | — | — |
| FE-001 | polling ไม่กันผลเก่า | ยังไม่ทำ | — | — | — |
| DATA-002 | checkin_logs ไม่มี unique | ยังไม่ทำ | — | — | — |
| DATA-003 | migration ใช้มือ | อธิบายใน ARCHITECTURE §6 | DOC-001 | — | — |
| PERF-005 | export ใหญ่ | ยังไม่ทำ | — | — | — |
| ARCH-003 | helper ซ้ำ | ยังไม่ทำ | — | — | — |

ข้อค้นพบใหม่ระหว่างทำงาน 2026-11-08:
- cron บน production ไม่ใช้ `CRON_TZ` → งานรันตามเวลา UTC (backup 09:30 น. เวลาไทย) — รอเจ้าของเลือกเวลา
- ไม่มี dispatcher LINE ทำงานอัตโนมัติบน production
- กระบวนการสแกน secret สแกนทุก ref: false positive ใน branch หนึ่งทำให้ทุก branch ล้ม (เกิดกับ #148 → แก้ด้วย #150)
