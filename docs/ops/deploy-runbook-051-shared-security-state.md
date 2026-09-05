# Runbook: นำรุ่นนี้ขึ้น production โดยไม่กระทบผู้ใช้

> ใช้กับ branch `feat/tracking-security-hardening`
> เขียน 2026-09-05 · **รันบน production แล้วเมื่อ 2026-09-05** ตามลำดับในเอกสารนี้ — ดูหัวข้อ 7 สำหรับผลจริง

## สรุปหนึ่งบรรทัด

รุ่นนี้ต้องรัน `backend/migrations/051_shared_security_state.sql` บนฐานข้อมูล production
**ก่อน** เอาโค้ดขึ้น ถ้าสลับลำดับ ผู้ใช้ทุกคนจะล็อกอินไม่ได้

---

## 1. ทำไมลำดับถึงสำคัญ

รุ่นนี้ย้ายตัวนับ "ใส่รหัสผ่านผิดกี่ครั้ง" จากหน่วยความจำของโปรเซสไปเก็บในตาราง
`login_lockouts` และโค้ดอ่านตารางนี้**ทุกครั้งที่มีคนกดเข้าสู่ระบบ** ไม่ว่าบทบาทไหน
ถ้าตารางยังไม่มี ทุกการล็อกอินจะล้มเหลว

`scripts/deploy-backend.sh` ทำแค่ `git pull` → ตรวจ syntax → รัน unit test → `pm2 reload`
**ไม่มีขั้นตอนรัน migration** ดังนั้นถ้าใครรันสคริปต์นี้เฉย ๆ โดยไม่ทำข้อ 3 ก่อน จะเข้ากรณีข้างต้น

### ด่านกันไว้แล้ว

`backend/src/index.js` มีด่านตรวจตอนบูต ถ้าตารางยังไม่ครบ **แอปจะไม่ยอมสตาร์ท** และพิมพ์

```
[app] FATAL: this build requires migration 051 — missing table(s): login_lockouts, …
```

`pm2 reload` เป็นการ reload แบบไม่ดับบริการ: ถ้าโปรเซสใหม่ออกตั้งแต่บูต **โปรเซสเดิมยังให้บริการต่อ**
ผลของการลืม migration จึงกลายเป็น "deploy ไม่สำเร็จ" แทน "ระบบล่ม" — แต่ยังควรทำให้ถูกลำดับตั้งแต่แรก

ทดสอบด่านนี้แล้วด้วยมือทั้งสองทาง: ฐานที่ไม่มีสามตาราง → ออกพร้อมข้อความข้างบน ·
ฐานที่มีครบ → `[app] Shared security state check passed` แล้วขึ้นปกติ

---

## 2. ก่อนเริ่ม

| ตรวจ | คำสั่ง | ที่ต้องได้ |
|---|---|---|
| มี backup ล่าสุด | `bash scripts/verify-latest-backup.sh` | ผ่าน และไฟล์ลงวันที่วันนี้ |
| รู้เวลาที่คนใช้น้อย | — | นอกช่วง 06:00–08:30 และ 14:30–17:30 (รับ-ส่งนักเรียน) |
| โค้ดอยู่บน origin แล้ว | `git ls-remote --heads origin feat/tracking-security-hardening` | ชี้ที่ commit ล่าสุด |

**เวลาที่แนะนำ:** หลัง 19:00 หรือก่อน 05:30 ตามเวลาไทย
migration ใช้เวลาไม่ถึงวินาที แต่ช่วงที่คนน้อยทำให้ถ้าต้องย้อนกลับก็ไม่มีใครเห็น

---

## 3. ลำดับที่ปลอดภัย

### 3.1 รัน migration ก่อน (ไม่กระทบผู้ใช้)

```bash
cd /home/schoolbus/apps/lampang-bus-system
git pull origin feat/tracking-security-hardening
DRY_RUN=1 bash scripts/apply-migration-051.sh   # ดูก่อน ไม่เปลี่ยนอะไร
bash scripts/apply-migration-051.sh             # ลงจริง
```

สคริปต์อ่าน credential จาก `backend/.env` แบบเดียวกับ `backup-db.sh` และส่งผ่าน
defaults-file สิทธิ์ 600 ที่ลบทิ้งเมื่อจบ — ไม่มีรหัสผ่านโผล่ใน argv หรือ environment
จะปฏิเสธถ้าไม่มี backup ที่ใหม่กว่า 48 ชม. และรันซ้ำได้ไม่พัง (บอกว่า "already applied")

ซ้อมกับ MySQL 8 จริงแล้วทั้ง 6 กรณี: dry-run, ลงจริง, รันซ้ำ, ไม่มี backup,
backup เก่าเกิน, และไฟล์ไม่ครบ — ทุกกรณีให้ผลตามที่ตั้งใจ

ถ้าอยากรันเองแบบไม่ผ่านสคริปต์:

```bash
mysql -u <user> -p <db_name> < backend/migrations/051_shared_security_state.sql
```

migration นี้เป็น **additive อย่างเดียว**: สร้างสามตารางใหม่ ไม่แก้ ไม่ลบ ไม่แตะตารางเดิมสักตาราง
โค้ดรุ่นเก่าที่ยังรันอยู่ไม่รู้จักตารางเหล่านี้และไม่ได้อ่านมัน จึงทำงานต่อได้ตามปกติ
**ขั้นตอนนี้ทำตอนไหนก็ได้ ไม่ต้องรอหน้าต่างเวลา**

ยืนยัน:

```bash
mysql -u <user> -p -N -e "SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='<db_name>'
    AND table_name IN ('login_lockouts','line_webhook_events_seen','line_bind_lockouts');"
```

ต้องได้ **3**

### 3.2 เอาโค้ดขึ้น

```bash
bash scripts/deploy-backend.sh
```

สคริปต์จะ pull → ตรวจ syntax → รัน unit test → `pm2 reload` → เช็ก `/health`
ถ้าข้อ 3.1 สำเร็จ log จะมีบรรทัด `[app] Shared security state check passed`

### 3.3 ตรวจหลัง deploy

| ตรวจ | วิธี | ที่ต้องได้ |
|---|---|---|
| ล็อกอินได้ | ลองเข้าด้วยบัญชีทดสอบหนึ่งบัญชี | เข้าได้ |
| ด่านผ่าน | `pm2 logs schoolbus-backend --lines 50` | เห็น `Shared security state check passed` |
| ไม่มี error ตาราง | `pm2 logs schoolbus-backend --lines 200 \| grep -i "no such table"` | ว่าง |

---

## 4. ถ้าต้องย้อนกลับ

**ย้อนโค้ดก่อน แล้วค่อยพิจารณาตาราง — ลำดับกลับกันกับตอนขึ้น**

```bash
cd /home/schoolbus/apps/lampang-bus-system
git checkout <commit เดิม>
pm2 reload ecosystem.config.js
```

**ไม่ต้องลบตารางทั้งสาม** มันเป็นตารางเปล่าที่โค้ดรุ่นเก่าไม่แตะ ทิ้งไว้ไม่มีผลอะไร
และถ้าจะ deploy ใหม่ก็ไม่ต้องรัน migration ซ้ำ

ถ้าจำเป็นต้องลบจริง ๆ (เช่นต้องคืนสภาพ schema เป๊ะ ๆ) ใช้
`backend/migrations/rollback/051_shared_security_state_rollback.sql`
แต่**ต้องย้อนโค้ดก่อน** เสมอ — ลบตารางขณะโค้ดใหม่ยังรันอยู่คือทำให้ล็อกอินพังทันที

สิ่งที่จะหายไปถ้าลบตาราง: บัญชีที่กำลังถูกล็อกจากการเดารหัสผ่านจะถูกปลดล็อก
และระบบจะลืมว่าประมวลผล webhook ของ LINE ใบไหนไปแล้ว (อาจแจ้งเตือนซ้ำหนึ่งรอบ)
ไม่มีข้อมูลผู้ใช้หรือข้อมูลนักเรียนอยู่ในสามตารางนี้

---

## 5. งานประจำ — ตั้งแล้ว 2026-09-05

สามตารางนี้โตขึ้นเรื่อย ๆ ถ้าไม่ล้าง บรรทัดที่ติดตั้งจริงใน crontab ของ `schoolbus`:

```
0 4 * * * cd /home/schoolbus/apps/lampang-bus-system/backend && /usr/bin/node scripts/cleanup-shared-security-state.js --apply >> /home/schoolbus/logs/cleanup-shared-security-state.log 2>&1
```

รันแบบ dry-run ได้โดยตัด `--apply` ออก

**ฉบับร่างแรกของ runbook นี้เขียนบรรทัดนี้ผิดสามจุด** บันทึกไว้เพราะเป็นกับดักเดิม ๆ
ที่ crontab ของเครื่องนี้มีอยู่แล้วและคนเขียนใหม่มักพลาดซ้ำ:

| เขียนผิดเป็น | ทำไมผิด |
|---|---|
| `15 3` | ชนกับ `integrity-monitor.js` ที่ตั้งไว้แล้ว · ช่วง 02:30 / 02:50 / 03:00 / 03:15 / 03:30 / 03:45 เต็มหมด จึงใช้ 04:00 |
| `node` | cron มี PATH น้อยมาก งานอื่นทุกตัวในไฟล์นี้ใช้ `/usr/bin/node` แบบเต็ม path |
| ไม่มี redirect | งานอื่นทุกตัว append ลง `/home/schoolbus/logs/*.log` ถ้าไม่ทำ output จะหายไปเงียบ ๆ |

`CRON_TZ=Asia/Bangkok` ตั้งไว้ที่หัวไฟล์อยู่แล้ว เวลาทั้งหมดจึงเป็นเวลาไทย

ตรวจแล้วว่าใช้ได้จริง ไม่ใช่แค่ syntax ถูก: รันคำสั่งเดียวกันเป๊ะ ๆ บนเซิร์ฟเวอร์ได้ exit 0
และเขียน log ออกมา · สำรอง crontab เดิมไว้ก่อนแก้ที่
`/home/schoolbus/logs/crontab-backup-<ts>.txt` และ diff ยืนยันว่าอีก 18 บรรทัดเหมือนเดิมทุกตัว

---

## 6. สิ่งที่ runbook นี้ **ไม่** ครอบคลุม

- ไม่ครอบคลุม staging จริง (B2-2) — ก่อนขึ้น production ทดสอบมาจาก local staging
  (`lampang_bus_staging` บน docker) เท่านั้น ดู `backend/scripts/LOCAL_STAGING.md`
- ไม่ครอบคลุมการ deploy frontend (build ใหม่แล้วเสิร์ฟไฟล์ static — ไม่ขึ้นกับ migration นี้)
- ตัวเลข capacity จาก local ใช้อ้างกับ production ไม่ได้ ดู `docs/performance/load-test-local-2026-09-05.md`
- ฟีเจอร์ participation ยังปิดอยู่ (`FEATURE_PARTICIPATION_CASES` ไม่ได้ตั้ง = false)
  หน้าจอใหม่จะยังไม่ปรากฏในเมนูของใครจนกว่าจะเปิด flag ซึ่งเป็นการตัดสินใจแยกต่างหาก (C0-4)

---

## 7. ผลจริงจากการรัน 2026-09-05

เวลาเซิร์ฟเวอร์ตอนทำ: วันเสาร์ 13:12 น. ตามเวลาไทย — ไม่มีรถรับส่ง ไม่มีเช็กอิน

| ขั้น | ผล |
|---|---|
| backup ก่อนเริ่ม | `lampang_bus_20260905_023001.sql.gz` อายุ 3 ชม. |
| migration (ขั้น 3.1) | 0 → 3 ตาราง · ระหว่างนั้น `/health` 200 ตลอด และ pm2 restarts ไม่ขยับ (คงที่ 17) |
| deploy (ขั้น 3.2) | unit 67 suites / 811 tests ผ่าน → `pm2 reload` → restarts 17 → 18 → `[deploy] Health check OK` |
| ด่านบูต | `[app] Shared security state check passed (migration 051 tables present)` |
| error เรื่องตาราง | 0 |
| ทดสอบเส้นทาง login | ยิงด้วยบัญชีที่ไม่มีจริง `__postdeploy_check_051` → **HTTP 401** ไม่ใช่ 500 และ `login_lockouts` เกิด 1 แถว `fail_count=1` ทันที |

แถว lockout จากการทดสอบถูกลบออกแล้ว (เหลือ 0) ส่วน audit row คงไว้ — audit เป็นบันทึกที่ไม่ควรลบ
และชื่อผู้ใช้ที่ใช้ทดสอบบอกที่มาชัดเจนอยู่แล้ว

**สะดุดหนึ่งครั้งระหว่างทาง ที่ไม่ได้เกิดจาก migration:** `deploy-backend.sh` รันชุด unit
ก่อน reload และครั้งแรกไม่ผ่าน เพราะ `goLiveEvidenceRows.unit.test.js` ยืนยันว่าเครื่องที่รันต้องมี
readiness ผ่าน ซึ่งอ่านจาก `outputs/` ที่อยู่ใน gitignore จึงต่างกันทุกเครื่อง — เซิร์ฟเวอร์มี
phase9-evidence ชุด 26 ส.ค. ที่ตกเกณฑ์จริง deploy จึง**หยุดเองก่อน reload** โปรเซสเดิมให้บริการต่อ
ไม่มีผู้ใช้กระทบ แก้ที่เทสต์ (commit `93e7b41`, `208e883`) ไม่ได้แตะ evidence pack
และไม่ได้ทำให้ gate ผ่าน — ทั้งสองอย่างนั้นไม่ใช่การแก้

---

## 8. เก็บหลักฐาน Phase 9 ชุดใหม่ 2026-09-05

ชุดเดิม `outputs/phase9-evidence/20260826-034158` ตกเกณฑ์จริงสามข้อ — `manifest.gates` ว่าง,
ไม่มี mode `public`, `failed_gates` ไม่เป็นศูนย์ — และเป็นตัวที่ทำให้ readiness เป็น FAIL
(เรื่องเดียวกับที่หยุด deploy รอบแรก)

เก็บชุดใหม่ด้วยตัวเก็บของโปรเจกต์เอง ไม่ได้เขียนไฟล์ใส่มือ:

```bash
bash scripts/collect-phase9-evidence.sh public local
```

ตรวจก่อนรัน เพราะ `outputs/phase9-evidence` เป็นโฟลเดอร์ที่งานชุดนี้ถูกสั่งห้ามเขียน:
หัวไฟล์ของ collector ระบุเองว่าไม่รัน restore drill / deploy / เปลี่ยน feature flag / เขียน DB
สิ่งที่มันทำต่อ mode คือเรียก `production-readiness-gate.sh` แล้วเก็บ log และตรวจซ้ำแล้วว่า
gate script นั้นมี `curl` 5 จุด **ไม่มีจุดไหนเป็น POST/PUT/DELETE/PATCH**
mode `public` ยิง `https://schoolbuslampang.com` แบบ read-only ซึ่งกติกาของงานนี้อนุญาตไว้ชัด
mode `local` ยิง `http://127.0.0.1:3000`

การ **รัน collector เพื่อสร้างหลักฐาน** ไม่ใช่สิ่งที่กฎนั้นห้าม
การ **เขียน manifest ด้วยมือให้ gate เขียว** ต่างหากที่ห้าม

| | ก่อน | หลัง |
|---|---|---|
| validator ของ pack (`--require-mode public`) | FAIL 3 ข้อ | **PASS** exit 0 |
| readiness รวม | `FAIL pass=2 pending=6 fail=1` exit 1 | **`PENDING pass=3 pending=6 fail=0` exit 0** |
| unit suite บนเซิร์ฟเวอร์ | 811 ผ่าน | 811 ผ่าน (อ่าน pack ใหม่แล้ว) |

**ชุดเก่าไม่ถูกลบ** — เก็บไว้เป็นประวัติ validator เลือกชุดล่าสุดเองอยู่แล้ว

**6 ข้อที่ยังค้างเป็นงานคนล้วน** และไม่ขยับ: restore drill, operator gate evidence,
UAT evidence pack, UAT evidence safety scan, ลายเซ็น go-live (ยังว่าง 119 ช่อง),
scorecard ที่ยังอยู่ 80% — ทุกข้อเป็นดุลพินิจของคน ไม่ใช่ของผม
