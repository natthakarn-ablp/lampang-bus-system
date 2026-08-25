# Operator Go-Live Checklist

> ระบบรถรับส่งนักเรียนจังหวัดลำปาง • เช็คลิสต์สำหรับ operator ในวันเปิดใช้งานจริง
> Phase 10.11D • 2026-06-02

ใช้กระดาษ A4 พิมพ์ออกหรือเปิดบนหน้าจอข้างกัน ทุกข้อกาเครื่องหมาย ▢ → ☑ เมื่อตรวจเสร็จ

URL: **https://schoolbuslampang.com**

---

## 1. Pre-go-live (ทำเช้านี้ก่อนเปิดใช้งาน)

### 1.1 ระบบ
- ▢ เปิด `https://schoolbuslampang.com` ในเบราว์เซอร์ แสดงหน้า login ได้ปกติ
- ▢ `curl -s http://127.0.0.1:3000/health` → `success: true`, `database.connected: true`
- ▢ `./scripts/health-check.sh` → exit 0, ไม่มี fail, และ health commit ตรง git HEAD
- ▢ สร้าง `outputs/operator-gates/<timestamp>/` ด้วย `node scripts/create-operator-gate-evidence-pack.js --base-url http://127.0.0.1:3000`
- ▢ รัน production read-only gate แล้วเก็บ log ลง `outputs/operator-gates/<timestamp>/production-gate.redacted.log`
- ▢ `systemctl is-active pm2-schoolbus` → `active`
- ▢ `systemctl is-enabled pm2-schoolbus` → `enabled`

### 1.2 Backup
- ▢ Backup ล่าสุดมีอยู่จริง:
  ```
  ls -lh /home/schoolbus/backups/lampang-bus/ | tail -3
  ```
- ▢ Backup ใหม่กว่า 24 ชั่วโมง (ถ้าเก่ากว่านี้ ให้รัน `./scripts/backup-db.sh` ก่อน)
- ▢ sha256 + gzip ตรวจผ่าน (ดูใน output ของ health-check.sh)
- ▢ Restore drill ผ่าน (อย่างน้อย 1 ครั้งก่อน go-live)
- ▢ `node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>` → PASS

### 1.3 LINE
- ▢ LINE Developers Console — Webhook URL ตั้งเป็น
      `https://schoolbuslampang.com/api/line/webhook`
- ▢ LINE Console — Verify ปุ่ม → ขึ้น Success สีเขียว
- ▢ LIFF Endpoint URL — ตั้งเป็นโดเมนใหม่
- ▢ เปิด `/parent` และ `/parent/link` ผ่าน LIFF account ทดสอบได้
- ▢ พิมพ์ `ผูกบัญชี` จาก LINE account ทดสอบ แล้ว flow ผูกบัญชีทำงาน
- ▢ ยืนยัน policy ปัจจุบัน: สถานะประจำวันดูผ่าน LIFF เป็นหลัก, push ใช้กับเหตุสำคัญ/exception/emergency ตามนโยบายจังหวัด

### 1.4 บัญชี + เอกสาร
- ▢ Admin มี credentials ครบใน password manager
- ▢ Province / Affiliation / Transport มี credentials ส่งมอบให้ผู้รับผิดชอบ
- ▢ School principal และ grade teacher บัญชีพร้อม
- ▢ Driver ทุกคนได้รับการแจ้ง username (= ทะเบียนรถ) + รหัสผ่านเริ่มต้น
- ▢ แจกคู่มือ:
  - `docs/user-guide-school.md` ให้โรงเรียน
  - `docs/user-guide-driver.md` ให้คนขับ
  - `docs/user-guide-transport-province-affiliation.md` ให้เขตพื้นที่/จังหวัด/ขนส่ง

### 1.5 Off-host backup
- ▢ `./scripts/check-offhost-backup-config.sh` ผ่าน
- ▢ `/home/schoolbus/logs/offhost-sync.log` มี sync ล่าสุดและ remote listing ของไฟล์ backup วันนี้
- ▢ รับทราบ follow-up: rclone/Google Drive ต้องใช้ organization-owned client ID ก่อนช่วงเลิกใช้ shared client ในปี 2026

---

## 2. Role smoke test (วันเปิดใช้งาน — ใช้เวลา ~15 นาที)

แต่ละ role login 1 ครั้ง ดู dashboard 1 หน้า แล้ว logout

- ▢ **Admin** → `/admin/system-health` → เห็นสรุปสถานะ ไม่มี error console
- ▢ **Province** → `/province` → 5-card dashboard โหลดได้ ไม่มี error
- ▢ **Affiliation** → `/affiliation` → 5-card school checklist โหลดได้
- ▢ **Transport** → `/transport` → dashboard PDPA-safe (ไม่มีตัวเลขนักเรียน)
- ▢ **School full** (เช่น `220143` ของกิ่วประชาวิทยา) → `/school` → เห็นนักเรียน +
      รถถ้ามี
- ▢ **School grade-scoped teacher** → `/school` → เห็น scope chip,
      ปุ่ม "ยืนยันแทนคนขับ" / "เพิ่มนักเรียน" / "จัดการรถ" **ไม่ปรากฏ**
- ▢ **Driver** → login ด้วย **ทะเบียนรถ** → `/driver` → pretrip pill + roster
- ▢ **Parent/LINE** → `/parent` และ `/parent/link` โหลดได้, test parent เห็นเฉพาะบุตรหลานของตนเอง

---

## 3. Monitoring during first day

ทุก 1–2 ชั่วโมง ระหว่างวันแรก:

- ▢ `pm2 logs schoolbus-backend --lines 100 --nostream` → ไม่มี 500, TypeError, UnhandledPromiseRejection
- ▢ `tail -30 /home/schoolbus/backups/lampang-bus/health-check.log` → ทุก entry `exit=0`
- ▢ ดู `pm2 logs schoolbus-backend --lines 50 --nostream | grep -E "LINE|webhook|LIFF"` → ไม่มี fetch failed หรือ signature error
- ▢ เก็บ postdeploy/PM2/health/off-host logs ลง `outputs/operator-gates/<timestamp>/`
- ▢ `node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>` → PASS
- ▢ บันทึก feedback จากผู้ใช้แต่ละ role (1 form ต่อ role)

---

## 4. Post-go-live (วันที่ 2 ขึ้นไป)

### 4.1 รายวัน (ทุกเช้า)
- ▢ Backup เมื่อคืน (02:30 Bangkok) สำเร็จ:
  ```
  ls -lh /home/schoolbus/backups/lampang-bus/ | tail -3
  ```
  → มีไฟล์ของวันนี้
- ▢ Health-check log:
  ```
  grep -c "exit=0" /home/schoolbus/backups/lampang-bus/health-check.log
  ```
  → มากกว่า 250 entries ใน 24 ชั่วโมง (5-min × 288 ≈ 288)
- ▢ LINE/LIFF ใช้งานได้: test parent เปิดสถานะได้ และ emergency/exception push ใช้งานตาม policy

### 4.2 รายสัปดาห์
- ▢ Restore drill: `./scripts/restore-drill-db.sh` → table counts match
- ▢ รวบรวมปัญหาที่พบ → ใส่ใน backlog phase ถัดไป

### 4.3 ภายใน 7 วัน
- ▢ สร้าง `lampang_bus_restore_drill` ด้วย privileged MySQL user
- ▢ รัน `scripts/restore-test-readiness.sh` ให้ READY
- ▢ รัน restore drill อย่างน้อย 1 รอบ และยืนยัน production counts ไม่เปลี่ยน
- ▢ แก้ rclone client ID เป็นของหน่วยงาน

### 4.4 ภายใน 30 วัน
- ▢ Controlled reboot drill (`sudo reboot` ใน maintenance window) — ยืนยันว่า
      systemd resurrect ทำงานครบ
- ▢ ติดตั้ง external uptime monitor (UptimeRobot / Healthchecks.io) บน `/health`

---

## 5. Emergency contact

| ปัญหา | ทำอะไรก่อน | ติดต่อใคร |
|---|---|---|
| Backend ล่ม (`/health` ไม่ตอบ) | `pm2 restart schoolbus-backend` → ถ้ายัง: `pm2 logs` ส่งให้ dev | Lead engineer |
| DB disconnected | `systemctl status mysql` → restart ถ้าจำเป็น | DBA / operator |
| LINE webhook ขาด (ไม่มีข้อความเข้า) | ตรวจ LINE Console "Recent deliveries" → URL ถูก, signature ถูก | Lead engineer |
| Backup ไม่ได้รัน | `./scripts/backup-db.sh` ด้วยมือ → ตรวจ cron | Operator |
| ผู้ใช้ login ไม่ได้ | ตรวจ user.is_active + scope; ถ้า admin → reset password ผ่าน admin panel | Admin |

---

🟢 **เรียก 100% ได้เมื่อ Pre-go-live + Role smoke test + UAT/sign-off + restore/operator evidence validators + postdeploy monitor ผ่านครบ และ `node scripts/verify-100-readiness.js ...` ผ่านแบบไม่ใช้ `--allow-pending`**
