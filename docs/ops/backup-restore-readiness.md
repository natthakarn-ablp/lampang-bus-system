# Backup / restore readiness (DATA-001)

สถานะปัจจุบันของการสำรองข้อมูลฐานข้อมูล แยกเป็น 4 ขั้น เพื่อไม่ให้ความสำเร็จขั้นหนึ่งถูกนับแทนอีกขั้น
อัปเดตล่าสุด: 2026-11-08 (night work, ดู `docs/status/night-work-2026-11-08.md`)

| ขั้น | ความหมาย | หลักฐานล่าสุด | สถานะ |
|---|---|---|---|
| 1. สร้าง backup ได้ (local) | `scripts/backup-db.sh` สร้าง `lampang_bus_*.sql.gz` + `.sha256`, gzip อ่านได้ทั้งไฟล์ | `backup_status.py` บน production 2026-11-08 13:14 UTC: `local OK` ไฟล์ล่าสุดอายุ 0.6 ชม. 3.24 MB | ยืนยันแล้ว |
| 2. ส่งถึงปลายทางได้ (off-host) | ปลายทาง (Google Drive ผ่าน rclone) **ลิสต์เจอ** dump ล่าสุด + sidecar ขนาดตรงกับต้นทาง — ไม่ใช้ marker ในเครื่อง | รอบเดียวกัน: `offhost OK` ไฟล์ล่าสุดบน Drive อายุ 10.5 ชม. | ยืนยันแล้ว (ครั้งเดียว, ยังไม่มีการตรวจอัตโนมัติ) |
| 3. อ่านกลับตรวจได้ (readback) | ดาวน์โหลด dump ล่าสุดจาก Drive ลงโฟลเดอร์ชั่วคราว ตรวจ sha256 กับ sidecar บน Drive + gunzip ทั้งไฟล์ แล้วลบทิ้ง | รอบเดียวกัน: `readback OK` 3,240,002 bytes ใช้ 15.0 วินาที | ยืนยันแล้ว (ครั้งเดียว) |
| 4. กู้เข้า DB ได้ (restore) | นำ dump เข้า MySQL แยกแล้วเทียบทุกตาราง | **ข้อมูลสังเคราะห์ใน CI เท่านั้น** (`ops/backup/test-restore-roundtrip.sh`) — ยังไม่เคยกู้ backup จริง | **ยังไม่พิสูจน์กับ backup จริง** |

ไม่กำหนด RPO/RTO ในเอกสารนี้ — เป็นการตัดสินใจของเจ้าของระบบ ตัวเลขที่วัดได้จริงอยู่ในตารางด้านบนและในรายงาน CI

## ข้อสังเกตที่พบระหว่างตรวจ

1. **cron บน production ไม่ใช้ `CRON_TZ`** — เครื่องตั้งเวลาเป็น `Etc/UTC` และ cron ของ Ubuntu (`3.0pl1`) ไม่รองรับ `CRON_TZ`
   จึงรันตามเวลา UTC: backup จริงเกิด 02:30 UTC = **09:30 เวลาไทย** และ off-host sync 02:50 UTC = 09:50 เวลาไทย
   (หลักฐาน: ชื่อไฟล์ `lampang_bus_20261108_023001.sql.gz`, log `offhost-sync 2026-11-08T02:50:01+00:00 start`)
   งานอื่นใน crontab เดียวกัน (cleanup, prune, integrity) ก็เลื่อนเหมือนกัน — **ยังไม่ได้แก้** เพราะเป็นการเปลี่ยนตารางเวลาระบบ ต้องให้เจ้าของเลือกเวลา
2. off-host sync คัดลอก dump ทุกไฟล์ที่อยู่ในเครื่อง (`rclone copy` ไม่ลบปลายทาง) — สำเนาบน Drive จึงสะสมไม่มีกำหนดลบ (ข้อมูลส่วนบุคคล) ต้องให้เจ้าของกำหนด retention ปลายทาง
3. backup ระหว่าง deploy (`backup-db.sh` ที่รันก่อน deploy) จะถูกนับเป็น "ล่าสุด" ได้ ซึ่งถูกต้อง เพราะเป็น dump สมบูรณ์เหมือนกัน
4. rclone ทุกครั้งพิมพ์คำเตือน: *"This remote uses rclone's shared Google Drive client_id, which is being retired and will stop working during 2026"* (rclone v1.75.0) — ดูหัวข้อ client_id ด้านล่าง

## ตัวตรวจสถานะ: `ops/backup/backup_status.py`

ไม่แตะฐานข้อมูล อ่านไฟล์ในเครื่องและลิสต์/ดาวน์โหลดจากปลายทางเท่านั้น เขียนเฉพาะ `--state-dir` (`latest.json`, `alert-state.json`, mode 600)

สถานะต่อขั้น: `OK`, `STALE` (เก่ากว่า `--max-age-hours`, ค่าเริ่ม 26), `MISSING`, `CHECKSUM_MISSING`, `CHECKSUM_MISMATCH`, `GZIP_BAD`, `SIZE_MISMATCH`, `UNREACHABLE` (ตรวจปลายทางไม่ได้), `NOT_RUN`, `UNPROVEN`
exit 0 เมื่อ local + offhost (+ readback ถ้าสั่ง) เป็น OK ทั้งหมด; ขั้น restore รายงานอย่างเดียว ไม่ทำให้ exit ล้ม

แจ้งเตือน (`--alert`): ส่งไป `TECH_LINE_TARGET_ID` ใน `/etc/schoolbus/health-alert.env` (ปลายทางเดียวกับ `health-smoke-alert.sh` — ห้ามเป็นกลุ่มฉุกเฉินของโรงเรียน)
- ส่งครั้งเดียวต่อ "ลายเซ็นความล้มเหลว" (เช่น `offhost=STALE`) — ถ้าเปลี่ยนชนิดความล้มเหลวจะส่งทันที
- ถ้ายังล้มแบบเดิม ส่งเตือนซ้ำได้ไม่บ่อยกว่า `--alert-repeat-hours` (ค่าเริ่ม 12)
- กลับมาปกติ ส่งข้อความ "recovered" 1 ครั้ง
- ส่งไม่สำเร็จ (เครือข่าย/token) จะไม่บันทึกว่าส่งแล้ว รอบถัดไปลองใหม่
- ข้อความมีเฉพาะชื่อขั้น สถานะ อายุ และชื่อไฟล์ backup — ไม่มี token/รหัสผ่าน/ข้อมูลนักเรียน

ทดสอบ: `RCLONE_TEST_BIN=<rclone 1.75.0> python3 ops/backup/test-backup-status.py` (21 กรณี, rclone จริงกับปลายทางเป็นโฟลเดอร์ในเครื่อง + LINE จำลอง) — รันใน CI ผ่าน `ops/backup/run-synthetic-tests.sh`

### ขั้นตอนเปิดใช้ (ยังไม่ได้ทำ — รอเจ้าของสั่ง)

หลัง deploy commit ที่มีไฟล์นี้แล้ว ให้เจ้าของรันบนเซิร์ฟเวอร์ (ผู้ใช้ `schoolbus`):

```bash
# 1) ลองรันมือ ไม่ส่งแจ้งเตือน
bash -c 'set -a; . /home/schoolbus/apps/lampang-bus-system/scripts/offhost-backup-sync.env; set +a; \
  python3 /home/schoolbus/apps/lampang-bus-system/ops/backup/backup_status.py \
  --remote "$OFFHOST_RCLONE_REMOTE" --rclone /home/schoolbus/.local/bin/rclone --readback'

# 2) ติดตั้ง cron (ตรวจทุกวัน 04:10 UTC = 11:10 ไทย หลัง sync 02:50 UTC; readback ทุกวัน ไฟล์ ~3 MB)
( crontab -l; echo '10 4 * * * bash -c '"'"'set -a; . /home/schoolbus/apps/lampang-bus-system/scripts/offhost-backup-sync.env; . /etc/schoolbus/health-alert.env; set +a; python3 /home/schoolbus/apps/lampang-bus-system/ops/backup/backup_status.py --remote "$OFFHOST_RCLONE_REMOTE" --rclone /home/schoolbus/.local/bin/rclone --readback --alert'"'"' >> /home/schoolbus/logs/backup-status.log 2>&1' ) | crontab -
```

ย้อนกลับ: `crontab -l | grep -v backup_status.py | crontab -` (ไม่มีผลกับ backup/sync เดิม)
ถ้าต้องการทดสอบส่งแจ้งเตือนจริง ให้เจ้าของยืนยันว่า `TECH_LINE_TARGET_ID` เป็นกลุ่ม/บัญชีผู้ดูแลเทคนิคก่อน แล้วรันข้อ 1 พร้อม `--alert --max-age-hours 0` หนึ่งครั้ง (จะได้ข้อความ FAIL) และรันปกติอีกครั้ง (ได้ recovered)

## rclone client_id ของหน่วยงาน

อ้างอิงเอกสารทางการ <https://rclone.org/drive/#making-your-own-client-id> (อ่านเมื่อ 2026-11-08): shared client_id "is being retired and will stop working during 2026" และการสร้างของตนเอง "is now required rather than merely recommended"

ขั้นตอน (ต้องใช้บัญชี Google ของเจ้าของ — **blocked: ต้องให้เจ้าของทำ** ไม่มีค่าใช้จ่าย):
1. Google API Console → สร้าง/เลือก project → เปิด Google Drive API
2. OAuth consent screen → Audience "External" (หรือ "Internal" ถ้าเป็น Google Workspace ของหน่วยงาน) → เพิ่ม scope `.../auth/drive` (และตามเอกสาร `docs`, `drive.metadata.readonly`) → เพิ่มตัวเองเป็น test user
3. Create OAuth client → ชนิด **Desktop app** → จด client ID / secret (เก็บนอก repo)
4. **Publish app** — ถ้าค้างที่ Testing สิทธิ์จะหมดอายุทุก 1 สัปดาห์ (เอกสารระบุ "any grants will expire after a week") ซึ่งจะทำให้ backup off-host หยุดเงียบ ๆ
5. สร้าง remote **ใหม่** (เช่น `gdrive-org`) แทนการแก้ `gdrive` เดิม: บนเครื่องที่มีเบราว์เซอร์รัน `rclone config` ใส่ client ID/secret แล้วทำ web authorization (เครื่องเซิร์ฟเวอร์ไม่มีเบราว์เซอร์ → ทำตาม <https://rclone.org/remote_setup/>) แล้วคัดลอกส่วน `[gdrive-org]` ไปยัง rclone.conf บนเซิร์ฟเวอร์ (mode 600)
6. พิสูจน์ช่องทางใหม่ **ก่อน** ปิดช่องทางเดิม:
   `rclone copy /home/schoolbus/backups/lampang-bus gdrive-org:lampang-bus-backups-org --include 'lampang_bus_*.sql.gz*'` แล้วรัน `backup_status.py --remote gdrive-org:lampang-bus-backups-org --readback` ต้องได้ offhost/readback OK
7. รันคู่กันอย่างน้อย 7 วัน (เปลี่ยน `OFFHOST_RCLONE_REMOTE` เป็นของใหม่ แต่ยังเก็บ remote เดิม) ตรวจด้วย `backup_status.py` ทุกวัน จากนั้นจึงเลิกใช้ remote เดิม — ห้ามลบ remote/โฟลเดอร์เดิมก่อนช่องทางใหม่ผ่าน
ตัวเลือก scope ที่แคบกว่าคือ `drive.file` (rclone เห็นเฉพาะไฟล์ที่ตัวเองสร้าง) — ใช้ได้กับ remote ใหม่ที่เขียนลงโฟลเดอร์ใหม่ แต่จะมองไม่เห็นไฟล์เดิมที่ client_id เก่าสร้างไว้; ยังไม่ได้ทดสอบ

## Restore drill

ทำได้แล้ว (2026-11-08): `ops/backup/test-restore-roundtrip.sh` ใน CI — ใช้ `scripts/backup-db.sh` และ `scripts/restore-drill-db.sh` ตัวจริง กับ schema ที่ migrate ครบ (`lampang_bus_test`) + ตารางสังเคราะห์ 20,000 แถว (ภาษาไทย/NULL/JSON) เทียบ `COUNT(*)` + `CHECKSUM TABLE` ทุกตาราง, routines, triggers และรายงานเวลา backup/restore ใน job summary — ปิด event scheduler ระหว่างทดสอบ

ยังไม่ได้ทำ: กู้ **backup จริง** — ต้องมีสภาพแวดล้อมที่
- แยกจาก production, ไม่มีสิทธิ์เขียน production, ไม่มี worker/cron/LINE ทำงาน, event scheduler ปิด
- จัดเก็บข้อมูลจริงในขอบเขตที่เจ้าของอนุญาต จำกัดการเข้าถึง และลบหลังจบ
- ไม่ใช่ VPS production (RAM 2 GB) และไม่ใช่ GitHub Actions
เมื่อพร้อม: `RESTORE_DB=lampang_bus_restore_drill ENV_FILE=<operator env ของ MySQL แยก> scripts/restore-drill-db.sh <dump>` แล้วบันทึกผลเป็น JSON `{"completed_at": "<ISO+tz>", "result": "PASS", "source": "<dump name>"}` ที่ `/home/schoolbus/backups/restore-drill/latest.json` เพื่อให้ `backup_status.py` รายงานขั้น restore
