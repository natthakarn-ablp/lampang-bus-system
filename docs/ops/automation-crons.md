# งานอัตโนมัติ: คิวงานค้าง, snapshot รายวัน, เฝ้าระวัง backup/health

เพิ่มเมื่อ 2026-11-13 (เป้าหมาย: ระบบเดินเองได้โดยไม่ต้องให้แอดมินตามทุกเรื่อง).
ทั้งสามสคริปต์ **ไม่ส่ง LINE** — โควตา LINE OA (~500 ข้อความ/เดือน) สงวนไว้ให้เหตุฉุกเฉินเท่านั้น
การแจ้งเตือนทั้งหมดเป็นแบบในระบบ (in-app) เก็บเป็นแถวใน `audit_logs` จึง **ไม่ต้องรัน migration**.

## เวลาในเครื่อง production

เครื่องตั้งเวลาเป็น **UTC** และ cron ของเครื่อง **ไม่รองรับ `CRON_TZ`** (บทเรียน 2026-11-08) —
ตัวเลขใน crontab คือเวลา UTC เสมอ เวลาไทย = UTC + 7 ชั่วโมง. อย่าใส่ `CRON_TZ=Asia/Bangkok`
แล้วคิดว่าได้ผล. สคริปต์คำนวณ "วันนี้" ตามเวลาไทย (Asia/Bangkok) เอง.

ทุกคำสั่งต้องรันจากโฟลเดอร์ `backend/` เพราะ `src/config/env.js` อ่าน `backend/.env` จาก working directory.

## บรรทัด crontab (ผู้ใช้ `schoolbus`) — เจ้าของเป็นผู้ติดตั้ง

```cron
# คิวงานค้าง: แจ้งในระบบ 08:00 น. เวลาไทย (01:00 UTC)
0 1 * * * cd /home/schoolbus/apps/lampang-bus-system/backend && /usr/local/bin/node scripts/pending-queue-alert.js >> /home/schoolbus/logs/pending-queue-alert.log 2>&1

# snapshot รายวัน หลังรอบเย็น 20:00 น. เวลาไทย (13:00 UTC)
0 13 * * * cd /home/schoolbus/apps/lampang-bus-system/backend && /usr/local/bin/node scripts/daily-snapshot.js >> /home/schoolbus/logs/daily-snapshot.log 2>&1

# เฝ้าระวัง backup + /health ทุก 30 นาที (แจ้งแอดมินในระบบไม่เกินวันละครั้งต่อปัญหา)
*/30 * * * * cd /home/schoolbus/apps/lampang-bus-system/backend && /usr/local/bin/node scripts/ops-watch.js >> /home/schoolbus/logs/ops-watch.log 2>&1
```

ก่อนติดตั้ง ให้ลองแบบไม่เขียนอะไรก่อน:

```bash
cd /home/schoolbus/apps/lampang-bus-system/backend
node scripts/pending-queue-alert.js --dry-run
node scripts/daily-snapshot.js --dry-run
node scripts/ops-watch.js --dry-run
```

### ติดตั้งด้วยสคริปต์ — `scripts/install-automation-crons.sh`

ใช้แทนการแก้ `crontab -e` ด้วยมือ (รันในฐานะผู้ใช้ `schoolbus` บนเครื่อง production):

```bash
cd /home/schoolbus/apps/lampang-bus-system
bash scripts/install-automation-crons.sh --dry-run   # ดู diff อย่างเดียว ไม่เขียนอะไร
bash scripts/install-automation-crons.sh             # ติดตั้งจริง
```

- **idempotent**: บรรทัดที่มีอยู่แล้ว (ตรงกันทุกตัวอักษร ไม่นับช่องว่างหัว-ท้าย) จะไม่ถูกเพิ่มซ้ำ — รันซ้ำกี่ครั้งก็ได้ ครั้งที่สองขึ้นไปจะขึ้น `no change needed` และไม่สร้าง backup.
- **ไม่ลบ/ไม่แก้บรรทัดอื่น** ใน crontab (backup, health-smoke ฯลฯ อยู่เหมือนเดิม); บรรทัดใหม่ต่อท้ายไฟล์.
- บรรทัดที่ถูกคอมเมนต์ (`# ...`) ไม่นับว่าติดตั้งแล้ว.
- ถ้ามีบรรทัด **ที่ยังทำงานอยู่** เรียกสคริปต์เดียวกันแต่เวลา/path ต่างไป สคริปต์จะไม่แตะบรรทัดนั้น ไม่เพิ่มบรรทัดที่สอง (กันรันซ้ำ) แสดง WARNING และจบด้วย exit 2 หลังจัดการบรรทัดอื่นแล้ว — ให้เจ้าของตัดสินเองว่าจะเก็บแบบไหน.
- พิมพ์ `diff -u` ของ crontab เดิม → ใหม่ทุกครั้งที่มีการเปลี่ยน.
- ก่อนเขียน สำรอง crontab เดิมไว้ที่ `/home/schoolbus/deploy-state/crontab.backup-<YYYYMMDDTHHMMSSZ>` (เวลา UTC). ย้อนกลับ: `crontab /home/schoolbus/deploy-state/crontab.backup-<stamp>`.
- หลังเขียน อ่าน `crontab -l` กลับมาเทียบกับสิ่งที่ตั้งใจเขียน ถ้าไม่ตรงจะหยุดและบอกคำสั่งย้อนกลับ.
- exit code: 0 สำเร็จ/ไม่ต้องเปลี่ยน, 1 ผิดพลาด (ไม่ได้เขียน หรือบอกวิธีย้อน), 2 มีบรรทัดชน (ดูด้านบน).
- **ไม่ติดตั้ง GPS stale alert** (`backend/scripts/gps-stale-alert.js`) — ตัวนั้นส่ง LINE จึงแยกให้เจ้าของตัดสินเปิดเอง ตาม `docs/ops/gps-stale-line-alert.md`.
- ทดสอบ: `backend/tests/installAutomationCrons.unit.test.js` (ใช้ `crontab` ปลอมบน PATH ไม่แตะ crontab จริง).

## 1. คิวงานค้าง — `scripts/pending-queue-alert.js`

ตรรกะ: `backend/src/services/pendingQueue.service.js`. หน้าจอ: กระดิ่งด้านบน (desktop) และการ์ด
"งานรออนุมัติ" บนหน้าหลักของโรงเรียน/สังกัด/จังหวัด/ขนส่ง (`GET /api/<role>/pending-summary`).

| คิว | ผู้ตัดสิน | รอเกิน 7 วัน แจ้ง |
|---|---|---|
| รับนักเรียนย้ายเข้า (ต่างสังกัด) | โรงเรียนปลายทาง | สังกัดของโรงเรียนปลายทาง |
| คำขอปรับรายชื่อจากคนขับ (`roster_change_requests`) | โรงเรียน | สังกัด |
| คำขอขึ้นทะเบียนรถจากคนขับ (flag `FEATURE_DRIVER_REGISTRATION`) | โรงเรียน | สังกัด |
| โอนย้ายนักเรียนในสังกัด | สังกัด | จังหวัด |
| คำขอเกี่ยวกับรถ | สังกัด | จังหวัด |
| รถรอตรวจสภาพ / การตรวจที่เริ่มแล้วยังไม่สรุป / เอกสารรอตรวจ | ขนส่ง | จังหวัด |

- โรงเรียนที่ไม่มีสังกัด: แจ้งจังหวัดโดยตรง. บัญชีครูประจำสายชั้นไม่เห็นคิว (ตัดสินไม่ได้).
- รอเกิน `PENDING_OVERDUE_DAYS` (ค่าเริ่ม 3) = "ค้างนาน" และสร้างแจ้งเตือน 1 ครั้งต่อรายการถึงผู้ตัดสิน;
  เกิน `PENDING_ESCALATE_DAYS` (ค่าเริ่ม 7) สร้างอีก 1 ครั้งถึงระดับถัดไป. ตั้งค่าได้ใน `backend/.env`.
- กันซ้ำด้วย `audit_logs.entity_type='pending_alert'`, `entity_id='pq:<คิว>:<รายการ>:O|E'` — รันซ้ำกี่ครั้งก็ไม่สร้างเพิ่ม.
- ไม่มีชื่อนักเรียนในข้อความ (ประเภทคำขอ ทะเบียนรถ ชื่อโรงเรียนเท่านั้น).
- ไม่มีคิว "คำขอผูกผู้ปกครอง" เพราะระบบไม่มีขั้นอนุมัติผูกผู้ปกครองโดยโรงเรียน.

## 2. snapshot รายวัน — `scripts/daily-snapshot.js`

ใช้ตัวคำนวณเดียวกับปุ่ม "บันทึก snapshot" (`POST /api/admin/snapshots/run`,
`backend/src/services/dailySnapshot.service.js`) บันทึก `run_type='auto'`.
ถ้าวันนั้นมี snapshot ระดับระบบอยู่แล้ว (manual / baseline / auto) จะไม่ทำอะไร — ไม่เขียนทับ baseline.
หมายเหตุ: unique key `(snapshot_date, scope_type, scope_id)` ไม่กันซ้ำเพราะ `scope_id` เป็น NULL;
สคริปต์จึงตรวจเองก่อนเขียน. ย้อนหลังรายวันได้ด้วย `--date YYYY-MM-DD`
(ตัวเลข completion อ่านจาก `daily_status` ของวันนั้น ส่วนจำนวนนักเรียน/รถเป็นค่าปัจจุบัน).

## 3. เฝ้าระวัง backup/health — `scripts/ops-watch.js`

`backend/src/services/opsWatch.service.js`:

- **backup** อ่าน log ของ `scripts/backup-db.sh` (ค่าเริ่ม `/home/schoolbus/backups/lampang-bus/backup.log`,
  ตั้ง `BACKUP_LOG` ได้ — **ตรวจกับ crontab จริงว่า backup เขียน log ไปที่ไหน**):
  `FAILED` = รอบล่าสุดมี `ERROR` หรือเริ่มเกิน 2 ชม. แล้วไม่มี `done`;
  `STALE` = รอบสำเร็จล่าสุดเก่ากว่า `OPS_BACKUP_MAX_AGE_HOURS` (26); `MISSING` = ไม่มี log/ไม่มีรอบ.
- **health** `GET HEALTH_URL` (ค่าเริ่ม `http://127.0.0.1:$PORT/health`) ต้องได้ 200, `success:true`, DB connected ภายใน 5 วินาที.
- ปัญหาแต่ละแบบสร้างแจ้งเตือนในระบบให้แอดมิน **วันละครั้ง** (`audit_logs.entity_type='ops_alert'`,
  `entity_id='<backup|health>:<สถานะ>:<YYYYMMDD>'`) แสดงที่กระดิ่งของแอดมินใต้หัว "แจ้งเตือนระบบ" (3 วันล่าสุด).
- exit code: 0 ปกติ, 1 พบปัญหา, 2 บันทึกไม่ได้ (เช่น DB ล่ม — ดูได้จาก log ของ cron เท่านั้น).
- ไม่แทนที่ `health-check.sh` / `ops/backup/backup_status.py` / health-smoke (ช่องทางเทคนิคเดิม).
