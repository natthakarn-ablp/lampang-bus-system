# รายงานงานกลางคืน 2026-11-08 (ประมาณ 20:10–21:15 น. เวลาไทย)

ขอบเขต: DATA-001 → DOC-001 → PERF-001 (PR เท่านั้น) → PERF-002 (PR เท่านั้น) ตามรายงาน `SYSTEM_AUDIT_2026-11-08_1325.md`
คำตอบเจ้าของรอบแรก (ใช้ค่าแนะนำทั้งหมด): แจ้งเตือน backup ใช้ TECH target เดิมแต่ **ห้ามทดสอบส่งจริง**, cron ตรวจ backup **เตรียมไว้ ไม่ติดตั้ง**, restore drill **ข้อมูลสังเคราะห์ใน CI เท่านั้น**

## 1. Production ก่อน–หลัง
| | SHA | หลักฐาน |
|---|---|---|
| ก่อน | `ebea6997b523394d8a2e727f4abe6992370d970b` | `/health` ตอนเริ่ม |
| หลัง | `549cce9694cfbbd85721a10360e45be8782e9f2d` | deploy 13:51–13:52 UTC `result=ok`, `/health` commit 549cce9, DB connected |
| rollback ref | `ebea699` | deploy-history.log `rollback_ref=ebea699(running)` |
| backup ก่อน deploy | `lampang_bus_20261108_135049.sql.gz` (3.1 MB, sha256 สร้างแล้ว) | backup.log |
`feat` ล่าสุด = `be87fb4` (merge เอกสาร DOC-001) — **ไม่ deploy** เพราะเป็นเอกสารล้วน ไม่กระทบระบบ

## 2. สถานะงาน
| งาน | โค้ดเสร็จ | CI ผ่าน | merge แล้ว | เปิดใช้จริง |
|---|---|---|---|---|
| DATA-001 ตัวตรวจ backup 4 ขั้น + restore round trip สังเคราะห์ + runbook | ✅ | ✅ | ✅ #147 | สคริปต์อยู่บนเซิร์ฟเวอร์แล้ว (deploy 549cce9) แต่ **cron/แจ้งเตือนยังไม่ติดตั้ง** (ตามคำตอบเจ้าของ) |
| CI fix: `.gitleaksignore` fingerprint | ✅ | ✅ | ✅ #150 | อยู่ใน 549cce9 |
| DOC-001 README / INDEX / ARCHITECTURE / modules / CLAUDE.md ใหม่ | ✅ | ✅ | ✅ #151 (`be87fb4`) | เอกสารเท่านั้น |
| PERF-001 ส่ง LINE นอก transaction + lease + retry key (migration 059) | ✅ | ✅ (head 85581ac) | ❌ ตั้งใจไม่ merge (needs-owner) | ❌ |
| PERF-002 index 060 + สคริปต์ลบแบบ opt-in | ✅ | PR run ผ่าน; push run ล้มจาก test เวลาคร่อมขอบ → แก้แล้ว (9dc103c) รอ CI รอบใหม่ | ❌ ตั้งใจไม่ merge (needs-owner, ซ้อนบน #148) | ❌ |

## 3. PR / commit / run และผลทดสอบสำคัญ
- **#147** (`1f9334a` → merge `07a7e4f`): CI 42484151024 (push) / 42484169643 (PR) ผ่าน; `test-backup-status.py` 21/21 (rclone 1.75.0 จริง + LINE จำลอง); **restore round trip สังเคราะห์: 62 ตาราง, mismatch 0, 20,000 แถว, dump 312 KB, backup 0.5 วินาที, restore 2.1 วินาที**
- **#150** (merge `549cce9`): push CI **42486132747** ผ่านทุก job → ใช้เป็น `DEPLOY_TARGET_SHA`; deploy รัน unit test บนเซิร์ฟเวอร์ 210 suites / 2,786 tests ผ่าน
- **#151** (merge `be87fb4`): เอกสาร, CI ของ head ผ่าน
- **#148** PERF-001 (`6861b79`, `f71213c`, `85581ac`): unit + integration (MySQL + LINE จำลองที่ dedupe ตาม key): ไม่มี row lock ค้างระหว่าง LINE ช้า, รับแล้วแต่คำตอบหาย → key เดิม ส่งถึง 1 ครั้ง, worker หยุดหลัง claim → ไม่ส่งซ้ำ, worker เก่าเขียนทับไม่ได้, worker ซ้อน 3 ตัว ส่งครั้งเดียวต่อแถว, 5xx/4xx, key หมดอายุ
- **#149** PERF-002: EXPLAIN บนข้อมูลสังเคราะห์ (CI run 42485927762):
  - คิว dispatcher: ก่อน `ALL` 6,092 แถว + filesort → หลัง `range` ~3 แถว
  - ลบ `line_message_logs` ตามอายุ: ก่อน `ALL` 3,000 → หลัง `range` ด้วย `idx_lml_created`
  - ลบ `notifications` ตามอายุ: ยัง `ALL` เพราะข้อมูลทดสอบเข้าเงื่อนไข ~53% (optimizer เลือก scan ถูกต้อง) — index จะมีผลเมื่อสัดส่วนแถวเก่าน้อย
  - ทดลองลบจริงบนข้อมูลสังเคราะห์: ลบ 3,235 + 2,550 แถว แถว pending/claimed/UNKNOWN และแถวใหม่ยังอยู่ครบ

## 4. DATA-001 — ยืนยันได้แค่ไหน
| ขั้น | ผล | หลักฐาน |
|---|---|---|
| สร้าง backup | **ยืนยัน** | `local OK` (ไฟล์ใหม่สุดอายุ 0.0 ชม., sha256 + gunzip ทั้งไฟล์) |
| ส่งถึงปลายทาง (Google Drive) | **ยืนยัน จากรายการบนปลายทางจริง** ไม่ใช่ marker | `offhost OK` ไฟล์ล่าสุดบน Drive อายุ 10.5–11.1 ชม. ขนาดตรงต้นทาง |
| อ่านกลับตรวจได้ | **ยืนยัน 1 ครั้ง** | `readback OK` ดาวน์โหลด 3,240,002 bytes ตรวจ sha256 กับ sidecar บน Drive + gunzip ใน 15.0 วินาที แล้วลบ |
| กู้เข้า DB | **ยังไม่พิสูจน์กับ backup จริง** | พิสูจน์เฉพาะสคริปต์จริงกับข้อมูลสังเคราะห์ใน CI (ข้อ 3) |
- ยังไม่มีการตรวจอัตโนมัติ/แจ้งเตือน — ขั้นตอนติดตั้งพร้อมใน `docs/ops/backup-restore-readiness.md`
- rclone ยังใช้ shared client_id ที่ rclone ประกาศว่า "will stop working during 2026" — ขั้นตอนสร้าง client_id ของหน่วยงานพร้อมใน runbook, **blocked: ต้องใช้บัญชี Google ของเจ้าของ**
- ไม่กำหนด RPO/RTO แทนเจ้าของ: ที่วัดได้คือ backup วันละครั้ง + backup ก่อน deploy, readback 15 วินาที, restore สังเคราะห์ 2.1 วินาที (ฐานจริง 3.1 MB บีบอัด ยังไม่ได้วัด)

## 5. งานที่ไม่ได้ทำ / เหตุผล / คำตัดสินที่ต้องการ
1. **ติดตั้ง cron ตรวจ backup + แจ้งเตือน** — เจ้าของเลือกให้เตรียมไว้ก่อน → ตัดสิน: ติดตั้งหรือไม่ และยืนยันว่า `TECH_LINE_TARGET_ID` คือกลุ่มผู้ดูแลเทคนิค (ทดสอบส่ง 1 ครั้ง)
2. **rclone client_id ของหน่วยงาน** — ต้อง login Google ของเจ้าของ (ขั้นตอนใน runbook; ห้ามปิดช่องทางเดิมก่อนช่องทางใหม่ผ่าน 7 วัน)
3. **กู้ backup จริง** — ต้องมีเครื่อง/ฐานแยกที่เจ้าของอนุญาต (ไม่ใช่ VPS production, ไม่ใช่ GitHub Actions)
4. **เวลา cron**: เครื่องเป็น UTC และ cron ไม่รองรับ `CRON_TZ` → backup จริง 09:30 น., sync 09:50 น. เวลาไทย (ไม่ใช่ 02:30 ตามคอมเมนต์) และงาน cleanup อื่นเลื่อนเหมือนกัน → ตัดสิน: ต้องการเวลาไหน
5. **retention ปลายทาง Drive**: `rclone copy` ไม่ลบ สำเนาสะสมไม่มีกำหนด → ตัดสินอายุเก็บ
6. **PERF-001 (#148)**: merge? apply 059? เปิดตัวส่ง LINE อัตโนมัติ? (ปัจจุบัน **production ไม่มี dispatcher ทำงานอัตโนมัติ** — แถวแจ้งเตือนถูกสร้างแต่ไม่ถูกส่ง; สคริปต์เดิมตั้งให้ push เฉพาะ `emergency` เพราะโควตา LINE)
7. **PERF-002 (#149)**: อายุเก็บ `notifications` / `line_message_logs` (รายงานตรวจเสนอ 90 วัน — ไม่ได้ตั้งแทน) และ apply 060
8. **สิทธิ์ครูประจำชั้น** — เอกสารแยก "พฤติกรรมโค้ด" กับ "นโยบายรอยืนยัน" แล้ว ยังต้องการคำตัดสิน
9. ARCH-001/002, PERF-003/004/005, OPS-002, TEST-001, FE-001, DATA-002, ARCH-003 — นอกลำดับงานคืนนี้ (ดู `docs/status/audit-2026-11-08-tracking.md`)
10. ขนาดตารางจริงบน production — คำสั่งนับแถวแบบ aggregate บน production ถูกระบบความปลอดภัยของ session ปฏิเสธ จึงไม่ได้ทำ

## 6. ผลกระทบที่พบและการกู้คืน
- **Secret scan ล้มทุก branch ชั่วคราว (~13:20–13:47 UTC)**: test ของ #148 มี `retryKey: '<UUID ตัวอย่างจากเอกสาร LINE>'` gitleaks จับเป็น generic-api-key และ workflow สแกน **ทุก ref** จึงทำให้ push CI ของ merge `07a7e4f` ล้มด้วย (run 42485046745) → ไม่ได้ deploy 07a7e4f. การ force-push เพื่อเขียนประวัติใหม่ **ถูกระบบความปลอดภัยปฏิเสธ** (ไม่ได้ลองซ้ำ) → แก้แบบไม่ทำลายประวัติ: เปลี่ยน test เป็น UUID สร้างตอนรัน (f71213c) + เพิ่ม fingerprint ใน `.gitleaksignore` (#150) → CI กลับมาผ่าน
- test ที่เขียนเองล้มใน CI 3 จุด (worker ซ้อนคาดหวังเกินจริง, multi-statement ใน test connection, เวลาคร่อมขอบอายุ) — แก้ที่ test ไม่ลด assertion หลัก (ส่งครั้งเดียว/ไม่ลบแถวที่ต้องเก็บ)
- ไม่มีผลกระทบต่อผู้ใช้; deploy ครั้งเดียวผ่านทุกขั้น ไม่ต้อง rollback
- เครื่องนี้ RAM ต่ำ: ระบบหยุด background watcher 2 ตัว (ไม่กระทบงาน)

## 7. ขั้นตอนถัดไป (เรียงลำดับ)
1. ยืนยัน TECH target แล้วติดตั้ง cron ตรวจ backup (คำสั่งพร้อมใน `docs/ops/backup-restore-readiness.md` ข้อ "ขั้นตอนเปิดใช้") + ทดสอบแจ้งเตือน 1 ครั้ง
2. สร้าง Google OAuth client (Desktop app, publish) → remote ใหม่ → รันคู่ 7 วันด้วย `backup_status.py`
3. เลือกเวลา cron (UTC vs ไทย) และ retention บน Drive
4. ตัดสิน PERF-001: merge #148 → deploy (ยังทำงานแบบเดิมจนกว่า apply 059) → apply 059 ด้วยสคริปต์แบบ 056–058 → restart
5. ตัดสินอายุข้อมูล → merge #149 → apply 060 → dry-run `cleanup-notification-logs.js` ก่อน `--apply`
6. จัดเครื่องแยกสำหรับกู้ backup จริง 1 ครั้ง แล้วบันทึก `restore-drill/latest.json`
7. ตัดสินนโยบายสิทธิ์ครูประจำชั้น แล้วปรับ CLAUDE.md §8 / โค้ด ให้ตรง

## 8. Checkpoint และคำสั่งเริ่มต่อ
- บันทึกงาน: `docs/status/night-work-2026-11-08.md` + รายงานนี้ บน branch `night/tracker`
- clone ทำงาน: `D:\Projects\SchoolBus-Lampang\worktrees\night-1108` (+ worktrees `night-perf`, `night-perf2`, `night-ci`, `night-tracker`)
- เริ่มต่อ:
  ```bash
  cd D:/Projects/SchoolBus-Lampang/worktrees/night-1108 && git fetch origin
  gh pr list --state open                          # 148, 149 (needs-owner)
  gh pr checks 149                                 # รอบหลัง 9dc103c
  ssh <alias> 'curl -s 127.0.0.1:3000/health'      # ควรเป็น 549cce9
  ```
- deploy ครั้งถัดไปต้องใช้ `DEPLOY_TARGET_SHA=<merge SHA เต็มที่ push CI ผ่าน>` และ backup ก่อนเสมอ
