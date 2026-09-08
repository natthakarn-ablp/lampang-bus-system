# Phase 9 Owner/Operator Approval 2026-08 — School Safe Connect ลำปาง

เอกสารนี้ใช้เป็นใบขออนุมัติรอบสุดท้ายก่อนประกาศระบบพร้อมใช้งาน 100%

## สถานะก่อนขออนุมัติ

| Evidence | สถานะ |
|---|---|
| Local gate | PASS: `pass=14 warn=0 fail=0` (รันล่าสุด 8 ก.ย. 2569 ที่ `228b1a0` — `outputs/automated-readiness/20260908-140635/logs/local-gate.log`; ตัวเลขเดิมที่บันทึกไว้ตอนร่างเอกสารคือ `pass=13` — gate ชุดเดียวกันวันนี้รายงาน 14 ข้อ) |
| Public external gate | PASS: `pass=5 warn=0 fail=0` against `https://schoolbuslampang.com` (รันล่าสุด 8 ก.ย. 2569 — `outputs/automated-readiness/20260908-140635/logs/public-gate.log`) |
| Evidence pack | `outputs/phase9-evidence/20260825-201200/summary.md` |
| Evidence validator | PASS via `scripts/validate-phase9-evidence.js` |
| UAT evidence safety scan | ต้อง PASS ผ่าน `scripts/scan-uat-evidence-safety.js` ก่อนแนบหลักฐาน UAT |
| UAT sign-off draft | สร้างด้วย `scripts/create-go-live-signoff-draft.js` เพื่อช่วยย้ายผลจาก evidence pack เข้า sign-off โดยไม่เขียนทับเอกสารหลัก |
| Restore drill evidence | ต้องสร้างด้วย `scripts/create-restore-drill-evidence-pack.js`, กรอกผลจาก operator, และ PASS ผ่าน `scripts/validate-restore-drill-evidence.js` |
| Operator gate evidence | ต้องสร้างด้วย `scripts/create-operator-gate-evidence-pack.js`, กรอกผล production/postdeploy/monitor, และ PASS ผ่าน `scripts/validate-operator-gate-evidence.js` |
| Go-live bundle | สร้างด้วย `node scripts/create-go-live-bundle.js --allow-pending` และตรวจด้วย `validate-go-live-bundle.js` ก่อน review; เปิด `SOURCE_STATE.md`, `ACTION_PLAN.md`, `ACTION_ITEMS.csv`, รายงานจาก `scripts/summarize-go-live-closure.js`, และ `outputs/automated-readiness/<timestamp>/summary.md` เพื่อปิดงานค้าง; ตรวจรายงาน closure ด้วย `scripts/validate-go-live-closure-status.js`; รอบสุดท้ายต้องไม่มี pending |
| Production data | Real data; do not write during gate checks |

## สิ่งที่ขออนุมัติ

ให้กรอก `APPROVED` ในคอลัมน์อนุมัติเมื่อ owner/operator อนุมัติ scope นั้นแล้ว

| Scope | อนุมัติ | หมายเหตุ |
|---|---|---|
| Run production read-only gate on server | | ไม่เขียน production DB |
| Create/use restore drill DB `lampang_bus_restore_drill` | | อนุญาตให้ drop/recreate เฉพาะ test DB นี้เท่านั้น |
| Run restore drill from latest backup into drill DB | | ต้องเทียบ aggregate counts และยืนยัน production ไม่เปลี่ยน |
| Deploy approved commit/worktree | | ใช้ runbook เดิมของ operator; ห้ามเปิด feature flag ใหม่ถ้าไม่ได้อนุมัติแยก |
| Run postdeploy gate and 30-60 minute monitor | | ต้อง `fail=0` ก่อนประกาศ full green |

## ไม่อยู่ในขอบเขตอนุมัตินี้

- ห้าม import, update, delete, truncate, reset, seed หรือ migrate production DB โดยไม่มีใบอนุมัติแยก
- ห้าม flip feature flag สำคัญ เช่น QR/consent/ETA/geofence/route deviation โดยไม่มี policy และ owner approval แยก
- ห้ามเผยแพร่ DB password, LINE secret, token, backup credential หรือข้อมูลส่วนบุคคลของนักเรียน/ผู้ปกครองใน evidence
- ห้ามใช้ production สำหรับ UAT ที่สร้างหรือแก้ข้อมูล

## ลำดับการรันที่อนุมัติแล้วเท่านั้น

### 1. Public evidence จากเครื่องนอก server

```bash
BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public
BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public
node scripts/validate-phase9-evidence.js outputs/phase9-evidence/<timestamp> --require-mode public
node scripts/scan-uat-evidence-safety.js outputs/uat-evidence/<timestamp>
node scripts/create-go-live-signoff-draft.js outputs/uat-evidence/<timestamp>
node scripts/create-operator-gate-evidence-pack.js --base-url http://127.0.0.1:3000
node scripts/create-go-live-bundle.js --allow-pending --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp> --allow-pending
node scripts/summarize-go-live-closure.js --bundle outputs/go-live-bundle/<timestamp> --allow-pending
node scripts/validate-go-live-closure-status.js outputs/go-live-closure-status/<timestamp> --allow-pending
node scripts/collect-automated-readiness-evidence.js --bundle outputs/go-live-bundle/<timestamp> --closure outputs/go-live-closure-status/<timestamp>
```

### 2. Production read-only gate บน server

```bash
cd /home/schoolbus/apps/lampang-bus-system
set -o pipefail
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh production 2>&1 | tee outputs/operator-gates/<timestamp>/production-gate.redacted.log
```

### 3. Restore drill หลัง operator ยืนยัน target แล้ว

```bash
cd /home/schoolbus/apps/lampang-bus-system
node scripts/create-restore-drill-evidence-pack.js
mysql -e "CREATE DATABASE IF NOT EXISTS lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
set -o pipefail
RESTORE_DB=lampang_bus_restore_drill bash scripts/restore-drill-db.sh 2>&1 | tee outputs/restore-drill/<timestamp>/restore-drill-output.redacted.log
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
```

ก่อนปิดข้อนี้ ต้องยืนยันจาก output ว่า backup checksum/gzip ผ่าน, restore ลง `lampang_bus_restore_drill`, table/row counts สำคัญตรงหรืออธิบายได้, production aggregate counts ไม่เปลี่ยน และ restore drill evidence validator PASS

### 4. Deploy approved commit/worktree

ให้ operator ใช้ runbook/deploy workflow เดิมของ server และต้องเก็บ commit hash ที่ deploy จริงไว้ใน evidence

### 5. Postdeploy gate และ monitor

```bash
cd /home/schoolbus/apps/lampang-bus-system
set -o pipefail
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh postdeploy 2>&1 | tee outputs/operator-gates/<timestamp>/postdeploy-gate.redacted.log
pm2 logs schoolbus-backend --lines 100 --nostream > outputs/operator-gates/<timestamp>/monitor-pm2.redacted.log 2>&1
tail -n 100 /home/schoolbus/backups/lampang-bus/health-check.log > outputs/operator-gates/<timestamp>/monitor-health-check.redacted.log 2>&1
tail -n 100 /home/schoolbus/logs/offhost-sync.log > outputs/operator-gates/<timestamp>/monitor-offhost-sync.redacted.log 2>&1
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
```

## บันทึกการเปลี่ยนแปลง production ที่เกิดขึ้นก่อนการลงนาม (อ้างอิงเท่านั้น — ไม่ใช่การอนุมัติ)

เพิ่ม 5 ก.ย. 2569 · **แก้ให้ตรงกับความจริง 8 ก.ย. 2569** ตารางเดิมบันทึกไว้สามรายการของวันที่ 5 ก.ย. ความจริงคือ **วันที่ 7 ก.ย. วันเดียวมีการ deploy 14 รอบ** และมีเพียงรอบเดียวในจำนวนนั้นที่มีบันทึกของตัวเอง
ที่มาของตารางที่ 1 คือ `/home/schoolbus/logs/deploy-history.log` บนเซิร์ฟเวอร์ ซึ่งสคริปต์ `deploy-backend.sh` เขียนเองทุกครั้ง จึงเป็นหลักฐานที่ครบกว่าเอกสารใด ๆ ในโครงการ อ่านเมื่อ 8 ก.ย. 2569 · เวลาในตารางแปลงเป็นเวลาไทยแล้ว (UTC+7)
ช่องอนุมัติและลายเซ็นด้านล่าง **ยังว่าง** และต้องเป็นบุคคลตามบทบาทกรอกเอง แบบฟอร์มรับรองย้อนหลังอยู่ที่ `docs/ops/retrospective-attestation-2026-09-05.md`

### ตารางที่ 1 · การ deploy ทุกรอบ

| # | วันเวลา (ไทย) | commit | เนื้อหาโดยย่อ | ผล | บันทึก |
|---:|---|---|---|---|---|
| 1 | 5 ก.ย. 20:38–20:40 | `c0b0d49` | ปิดงานค้าง handoff §2 ข้อ 1–9 | สำเร็จ | `docs/ops/deploy-2026-09-05-c0b0d49.md` |
| 2 | 5 ก.ย. 21:58–22:04 | `a0e783e` | รวม frontend rebuild | สำเร็จ | `docs/ops/deploy-2026-09-05-a0e783e.md` |
| 3 | 6 ก.ย. 08:45–08:46 | `14caf5b` | แก้สคริปต์ deploy ตาม review (สองรอบก่อนหน้าหยุดกลางทางโดยตั้งใจ) | สำเร็จ | `docs/ops/deploy-2026-09-06-14caf5b.md` |
| 4 | 7 ก.ย. 07:41–07:42 | `f60aee5` | คู่มือ + ภาพประกอบคนขับ | สำเร็จ | `docs/ops/deploy-2026-09-07-f60aee5.md` |
| 5 | 7 ก.ย. 08:22–08:23 | `7c220ee` | เลิกเผยแพร่เอกสารภายใน เหลือเฉพาะคู่มือ | สำเร็จ | **ไม่มี** |
| 6 | 7 ก.ย. 10:44–10:45 | `313906d` | สคริปต์ลง migration 050 | สำเร็จ | **ไม่มี** |
| 7 | 7 ก.ย. 10:57–10:58 | `f326b5c` | สคริปต์เปิด/ปิด feature flag ที่ถอยกลับเองได้ | สำเร็จ | **ไม่มี** |
| 8 | 7 ก.ย. 11:05–11:06 | `5ce2c9e` | แก้ LINE login ให้กลับหน้าเดิม | สำเร็จ | **ไม่มี** |
| 9 | 7 ก.ย. 13:12–13:13 | `d591923` | ชื่อผู้ใช้ที่ถูกลบแล้วอธิบายตัวเองแทน "Duplicate entry" | สำเร็จ | **ไม่มี** |
| 10 | 7 ก.ย. 13:28–13:29 | `6fc7ff5` | ลบบัญชีแล้วปล่อย LINE ที่ผูกไว้ | สำเร็จ | **ไม่มี** |
| 11 | 7 ก.ย. 13:48–13:49 | `21196c1` | รหัสกู้คืนเป็นทางเลือกตามค่าตั้ง | สำเร็จ | **ไม่มี** |
| 12 | 7 ก.ย. 14:11 | `f90eee2` | เลิกแจกรหัสกู้คืนที่เซิร์ฟเวอร์ไม่ตรวจ | **หยุดก่อนแตะ PM2** (`exit=1`) — production ยังรัน `21196c1` | **ไม่มี** |
| 13 | 7 ก.ย. 14:14 | `4f9c894` | (รอบแก้ต่อจากข้อ 12) | **หยุดก่อนแตะ PM2** (`exit=1`) — production ยังรัน `21196c1` | **ไม่มี** |
| 14 | 7 ก.ย. 14:16–14:17 | `4f9c894` | ชุดทดสอบเลิกอ่านค่าตั้งของเครื่องที่รัน | สำเร็จ | **ไม่มี** |
| 15 | 7 ก.ย. 15:24–15:25 | `9edc79f` | คู่มือการกู้รหัสผ่านและสองฟีเจอร์ที่เปิดวันนั้น | สำเร็จ | **ไม่มี** |
| 16 | 7 ก.ย. 18:58 | `bc931d6` | ใบแจ้งหกสังกัดว่ารีเซ็ตรหัสโรงเรียนเองได้ | **หยุดก่อนแตะ PM2** (`exit=1`) — production ยังรัน `9edc79f` | **ไม่มี** |
| 17 | 7 ก.ย. 19:02–19:03 | `67c3768` | จังหวัดรีเซ็ตรหัสผ่านสังกัด/ขนส่ง + หน้าความปลอดภัยบัญชีหลายบทบาท | สำเร็จ — **รันอยู่จนถึงปัจจุบัน** | **ไม่มี** |

**อ่านตารางนี้อย่างไร** วันที่ 7 ก.ย. มี 14 รอบ (ข้อ 4–17) สำเร็จ 11 รอบ และ **หยุดกลางทางโดยไม่แตะ PM2 3 รอบ** การหยุดทั้งสามครั้งคือสคริปต์ทำงานถูกต้อง มันตรวจพบปัญหาก่อนสั่ง `pm2 reload` แล้วคืนสภาพเดิม production จึงไม่เคยตกจากเหตุนี้ · ในทั้ง 14 รอบ มีเพียงข้อ 4 ที่มีเอกสารบันทึกของตัวเอง

### ตารางที่ 2 · การเปลี่ยนแปลงฐานข้อมูลและค่าตั้ง

| # | เหตุการณ์ | วันเวลา (ไทย) | บันทึก | สถานะการรับรอง |
|---:|---|---|---|---|
| 1 | migration 051 ลง `lampang_bus` | 5 ก.ย. 13:12 | `docs/ops/deploy-runbook-051-shared-security-state.md` §7 | รอรับรองย้อนหลัง |
| 2 | ตั้ง `FEATURE_ADMIN_PASSWORD_RECOVERY=true` | 7 ก.ย. 09:39 | `docs/project-closure/owner-answers-2026-09-07.md` ข้อ 5 | รอรับรองย้อนหลัง |
| 3 | migration 050 ลง `lampang_bus` (`participation_cases`, `participation_case_events`) | 7 ก.ย. ประมาณ 12:15 | `docs/project-closure/owner-answers-2026-09-07.md` ข้อ 5 (ต่อ) | รอรับรองย้อนหลัง |
| 4 | ตั้ง `FEATURE_PARTICIPATION_CASES=true` | 7 ก.ย. 12:55 | `docs/project-closure/owner-answers-2026-09-07.md` ข้อ 5 (ต่อ) | รอรับรองย้อนหลัง |
| 5 | ตั้ง `ADMIN_RECOVERY_REQUIRE_CODE=false` (ลิงก์ LINE เป็นด่านเดียว) | 7 ก.ย. | `docs/project-closure/decision-2026-09-07-admin-recovery-single-factor.md` | รอรับรองย้อนหลัง |

### สิ่งที่ตรวจสอบแล้วเมื่อ 8 ก.ย. 2569 (อ่านอย่างเดียว)

| ตรวจอะไร | ผล |
|---|---|
| `http://127.0.0.1:3000/health` บนเซิร์ฟเวอร์ | `commit: 67c3768` · `database.connected: true` · `node v20.20.2` · `environment: production` |
| โปรเซสเริ่มเมื่อไร (`process.uptime()` 69,960 วินาที ณ 07:29 UTC) | 7 ก.ย. 19:03 น. — ตรงกับบรรทัด `end result=ok head=67c3768` ในประวัติ deploy และรันต่อเนื่องมา 19 ชม. 26 นาทีโดยไม่ restart |
| `GET /api/auth/recovery/config` (สาธารณะ) | `admin_password_recovery: true` · `requires_recovery_code: false` · จังหวัด/สังกัด/โรงเรียน/ขนส่ง/คนขับ ปิดด้วยเหตุ `decision_gates_unconfirmed` |
| ไฟล์ `assets/index-Dwb_iTiF.js` ที่เว็บจริงเสิร์ฟ | มีข้อความ "บัญชีสังกัดและขนส่ง" "ความปลอดภัยบัญชี" และเส้นทาง `unit-accounts` / `reset-password` — frontend ของข้อ 17 ขึ้นแล้ว |

**สิ่งที่ต้องทำก่อนลงนาม** การ deploy 13 รอบในตารางที่ 1 ไม่มีบันทึกของตัวเอง ผู้ลงนามต้องเลือกอย่างใดอย่างหนึ่ง — ให้จัดทำบันทึกย้อนหลังจากประวัติบนเซิร์ฟเวอร์ หรือรับรองย้อนหลังโดยระบุว่าใช้ `deploy-history.log` เป็นหลักฐานแทนบันทึกรายรอบ

## Sign-off

| ผู้อนุมัติ | บทบาท | ผล | วันที่/เวลา | ลายเซ็น | หมายเหตุ |
|---|---|---|---|---|---|
| | Owner | PASS / PASS WITH CONDITIONS / FAIL | | | |
| | Technical owner | PASS / PASS WITH CONDITIONS / FAIL | | | |
| | Operator | PASS / PASS WITH CONDITIONS / FAIL | | | |
| | DPO/Legal | PASS / PASS WITH CONDITIONS / FAIL | | | เฉพาะ consent/QR/LINE policy |

ระบบเรียก 100% ได้เมื่อทุก gate ในเอกสารนี้ผ่าน, restore drill evidence validator PASS, operator gate evidence validator PASS, `docs/UAT_SIGNOFF_2026-08.md` ผ่านครบทุกบทบาท, `node scripts/validate-go-live-signoff.js` PASS, `node scripts/verify-100-readiness.js` PASS, และ postdeploy monitor ไม่มี error pattern ใหม่

ก่อนลงนามรอบสุดท้าย ให้สร้างและตรวจ go-live bundle โดยไม่ใส่ `--allow-pending`, รัน `node scripts/summarize-go-live-closure.js --bundle outputs/go-live-bundle/<timestamp>`, `node scripts/validate-go-live-closure-status.js outputs/go-live-closure-status/<timestamp>`, และ `node scripts/collect-automated-readiness-evidence.js --bundle outputs/go-live-bundle/<timestamp> --closure outputs/go-live-closure-status/<timestamp>` ให้ผ่าน, แล้วแนบ `outputs/go-live-bundle/<timestamp>/summary.md`, `SOURCE_STATE.md`, `ACTION_PLAN.md`, `ACTION_ITEMS.csv`, `outputs/go-live-closure-status/<timestamp>/summary.md`, และ `outputs/automated-readiness/<timestamp>/summary.md` กับเอกสารนี้
