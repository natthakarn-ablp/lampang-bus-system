# Runbook: นำรุ่นนี้ขึ้น production โดยไม่กระทบผู้ใช้

> ใช้กับ branch `feat/tracking-security-hardening` (44 commit นับจากที่อยู่บน origin เดิม)
> เขียน 2026-09-05 · **ยังไม่มีใครรันบน production** — เอกสารนี้คือลำดับที่ปลอดภัย ไม่ใช่บันทึกว่าทำแล้ว

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

## 5. งานประจำที่ต้องตั้งเพิ่ม (ทำภายหลังได้)

สามตารางนี้โตขึ้นเรื่อย ๆ ถ้าไม่ล้าง ใช้รูปแบบเดียวกับ `cleanup-revoked-tokens.js`:

```
15 3 * * *  cd /home/schoolbus/apps/lampang-bus-system/backend && node scripts/cleanup-shared-security-state.js --apply
```

รันแบบ dry-run ก่อนได้โดยตัด `--apply` ออก
ไม่ตั้งก็ไม่พัง แต่ตารางจะโตไปเรื่อย ๆ

---

## 6. สิ่งที่ runbook นี้ **ไม่** ครอบคลุม

- **ยังไม่เคยรันบน production หรือ staging จริง** ทดสอบมาจาก local staging
  (`lampang_bus_staging` บน docker) เท่านั้น — ดู `backend/scripts/LOCAL_STAGING.md`
- ไม่ครอบคลุมการ deploy frontend (build ใหม่แล้วเสิร์ฟไฟล์ static — ไม่ขึ้นกับ migration นี้)
- ตัวเลข capacity จาก local ใช้อ้างกับ production ไม่ได้ ดู `docs/performance/load-test-local-2026-09-05.md`
- ฟีเจอร์ participation ยังปิดอยู่ (`FEATURE_PARTICIPATION_CASES` ไม่ได้ตั้ง = false)
  หน้าจอใหม่จะยังไม่ปรากฏในเมนูของใครจนกว่าจะเปิด flag ซึ่งเป็นการตัดสินใจแยกต่างหาก (C0-4)
