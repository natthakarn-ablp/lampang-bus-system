# Architecture — ระบบรถรับส่งนักเรียนจังหวัดลำปาง

ปรับปรุง 2026-11-08 (DOC-001) จากโค้ดบน `feat/tracking-security-hardening` และการอ่านสถานะ production แบบอ่านอย่างเดียว
รายละเอียดรายโมดูล: [`docs/modules/`](modules/README.md) · สารบัญเอกสาร: [`docs/INDEX.md`](INDEX.md)

## 1. เทคโนโลยี
| ชั้น | ที่ใช้จริง | แหล่ง |
|---|---|---|
| Backend | Node.js ≥20 (CI 22, production v22), Express 4, mysql2 (SQL ตรงแบบ parameterized), jsonwebtoken, bcrypt, helmet, express-rate-limit, multer, exceljs, pdfkit, @line/bot-sdk 10.6 | `backend/package.json` |
| Frontend | React 18 + Vite + Tailwind, react-router 7, axios, Leaflet, @line/liff (ไม่มี TypeScript/ESLint) | `frontend/package.json` |
| Database | MySQL 8.0, migrations SQL `backend/migrations/` (001, 008–058 + rollback บางตัว) | — |
| ภายนอก | LINE Messaging API (push), LINE LIFF id_token, Google Drive ผ่าน rclone (backup นอกเครื่อง) | — |

## 2. Runtime บน production
```
ผู้ใช้เว็บ / LIFF ──HTTPS──> nginx ──/──────────> frontend/dist (SPA; ไม่มีไฟล์อื่นของ repo)
                                 ├─/manual/───> docs/manual-html (คู่มือสาธารณะ — ไฟล์ในโฟลเดอร์นี้ถูกเผยแพร่)
                                 └─/api/──────> PM2 "schoolbus-backend" (fork, 1 process) ──> MySQL 8 (เครื่องเดียวกัน)
LINE Platform ──webhook──> /api/line/webhook                                    └─> LINE push (เฉพาะเมื่อเรียก)
```
- VPS เดียว RAM 2 GB / 2 CPU; PM2 `max_memory_restart 500M` (`ecosystem.config.js`)
- เวลาเครื่องเป็น **UTC** และ cron ของเครื่องไม่รองรับ `CRON_TZ` → งาน cron รันตามเวลา UTC (เช่น backup 02:30 UTC = 09:30 น. เวลาไทย) ทั้งที่คอมเมนต์ใน crontab เขียนว่าเวลาไทย
- งานตามเวลา (crontab ของผู้ใช้ `schoolbus`): backup DB, sync backup ขึ้น Google Drive, health-check ทุก 5 นาที, cleanup revoked tokens / imports / log เก่า (`cleanup-old-logs.js --apply`), integrity monitor, prune GPS, cleanup shared security state; systemd timer: `schoolbus-health-smoke` (30 นาที), `schoolbus-housekeeping` (รายสัปดาห์)
- **ไม่มีตัวส่ง LINE notification อัตโนมัติ**: แถวใน `notifications` ถูกสร้างตอนเช็กชื่อ แต่ไม่มี cron/timer เรียก `dispatch-notifications.js` หรือ `POST /api/line/process-notifications` (ตรวจ 2026-11-08). การแจ้งเหตุฉุกเฉินเข้ากลุ่มส่งตรงตอนรายงาน

## 3. โครงสร้างโค้ด
```
backend/src/app.js            mount ทุก route + flag gate      backend/src/index.js   boot guard ตรวจ schema/migration
backend/src/routes/*.routes.js  HTTP + ตรวจสิทธิ์ (บางไฟล์มี SQL: school 2.8k, admin 2.4k บรรทัด)
backend/src/services/*.js     กติกาธุรกิจ + SQL                   backend/src/middleware/  auth, roleGuard, rate limit, error
backend/src/utils/            response, audit, เวลาไทย, export security
backend/scripts/              งาน cron / ops (dry-run เป็นค่าเริ่มเกือบทั้งหมด)
backend/tests/                *.unit.test.js = ไม่ใช้ DB; *.test.js อื่น = MySQL (CI)
frontend/src/pages/<role>/    หน้าแต่ละบทบาท                    scripts/, ops/          deploy, backup, ตรวจระบบ
```
แผนที่โมดูล (หน้าที่ → ไฟล์ → ตาราง → ความเสี่ยง): [`docs/modules/README.md`](modules/README.md)

## 4. เส้นทางข้อมูลหลัก
- **เช็กชื่อ** (`services/checkin.service.js`): transaction เดียว ล็อกแถวนักเรียน `FOR UPDATE` → `checkin_logs` + `daily_status` + แถวคิว `notifications` + `audit_logs`; มี deadlock retry. ไม่เรียก LINE ระหว่างคำขอ
- **แจ้งเตือน LINE**: คิวในตาราง `notifications` → `line.service.processUnsentNotifications` (ตัวปัจจุบันถือ transaction ระหว่างเรียก LINE — PERF-001 เตรียมแก้ใน PR #148)
- **ผู้ปกครอง**: LIFF id_token → `line_bindings` (โทรศัพท์) → เด็กที่ `parent_student.approved`
- **นำเข้านักเรียน**: preview (ไม่เขียน) → apply ทีละแถวใน transaction + `import_batches` → rollback ได้
- **รายงาน/Export**: `/api/reports/*` อ่านอย่างเดียว ตรวจ scope ตาม token, จำกัดอัตรา

## 5. Feature flags
อ่านใน `backend/src/config/env.js`; route ที่ถูก gate อยู่ใน `app.js`. สถานะจริงบน production: `scripts/production-feature-flags.json` (ต้องแก้ไฟล์นี้ทุกครั้งที่เปิด/ปิดจริง). เปิด/ปิดด้วย `scripts/enable-feature-flag.sh` (ย้อนเองเมื่อ health ล้ม). เปิด flag = การตัดสินใจของเจ้าของ

## 6. Migrations
- ไฟล์ใหม่เท่านั้น ห้ามแก้ของเก่า (`npm run check:migrations` ตรวจ checksum กับ `schema_migrations` + `legacy-drift-baseline.json`)
- **deploy ไม่รัน migration**; เจ้าของ apply ทีละตัวด้วยสิทธิ์ DDL (runtime user ไม่มี DDL) — ดู runner `scripts/apply-migration-0xx.*`
- boot guard ใน `backend/src/index.js` ตรวจคอลัมน์/ตารางที่ฟีเจอร์ต้องใช้; `/api/health` แสดงจำนวน migration ค้าง (052/053 ตั้งใจยังไม่ apply)

## 7. CI และ deploy
- CI `.github/workflows/full-quality.yml` (ทุก push/PR): unit + integration กับ MySQL + check:migrations + rehearsal ฐานข้อมูล/backup + frontend build + UI gates + Playwright + gitleaks (สแกนประวัติ **ทุก ref** — false positive ในทุก branch ทำให้ทุก branch ล้ม จัดการด้วย `.gitleaksignore`)
- deploy: `scripts/deploy-backend.sh` บนเซิร์ฟเวอร์ ต้องมี `DEPLOY_TARGET_SHA` = SHA เต็มที่ Full Quality แบบ push ผ่าน (`scripts/deploy-ci-gate.js`, `docs/ops/DEPLOY_CI_GATE.md`); มี lock, ตรวจ tree สะอาด, `npm ci`, unit test ด้วย `.env` ของเซิร์ฟเวอร์, reload, ตรวจ health commit, publish frontend พร้อมสำเนา `dist.prev-*`
- ก่อน deploy: backup DB ใหม่ (deploy ไม่ backup ให้); หลัง deploy: `/health` commit, หน้าเว็บ, API ที่ต้อง login ตอบ 401, log

## 8. Backup / restore
สถานะแยก 4 ขั้น (สร้าง/ส่งนอกเครื่อง/อ่านกลับ/กู้เข้า DB) และหลักฐานล่าสุด: [`docs/ops/backup-restore-readiness.md`](ops/backup-restore-readiness.md). ตัวตรวจ `ops/backup/backup_status.py`; การกู้คืนพิสูจน์แล้วเฉพาะข้อมูลสังเคราะห์ใน CI

## 9. ความเสี่ยงที่ทราบ (จากการตรวจ 2026-11-08)
ตารางติดตาม finding → PR → หลักฐาน → สถานะ production: [`docs/status/audit-2026-11-08-tracking.md`](status/audit-2026-11-08-tracking.md)
