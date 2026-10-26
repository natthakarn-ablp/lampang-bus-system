# Deploy Readiness Report — Lampang Bus System

> ⚠️ **เอกสารนี้เป็น snapshot วันที่ 2026-04-03 (ก่อน go-live)** เก็บไว้เป็น
> ประวัติเท่านั้น สถานะจริงล่าสุดดู
> [`docs/project-closure/handoff-2026-09-05.md`](project-closure/handoff-2026-09-05.md) และ
> [`docs/project-closure/current-status-2026-09-04.md`](project-closure/current-status-2026-09-04.md)
> (ปลายทางเดิม `production-readiness.md` และ `STATUS-2026-06-23.md` เป็น historical แล้วเช่นกัน — แก้ปลายทาง 5 ก.ย. 2569 ตาม `current-status-2026-09-04.md` §5 #31)
>
> สรุปการเปลี่ยนแปลงหลังเอกสารนี้เขียน:
> - ระบบขึ้น production แล้วที่ https://schoolbuslampang.com (nginx + Cloudflare + PM2 + systemd)
> - ไม่ได้ใช้ Docker Compose บน production (ใช้ system MySQL ที่ 127.0.0.1 + Node.js ตรง ๆ ผ่าน PM2)
> - ไม่มี Adminer บน production (docker-compose.yml ห้ามนำขึ้น prod)
> - มี Thai font (THSarabunNew) สำหรับ PDF export แล้ว
> - รหัสผ่าน default '1234' ถูกบังคับเปลี่ยนผ่าน `must_change_password=TRUE` ทุกบัญชี
> - migration ขยายจาก 4 ไฟล์ → 39 ไฟล์ (001–039) รวม vehicle verification, driver pool/shifts, consent, QR
> - เพิ่มฟีเจอร์ใหม่ 2026-06-22: ใบส่งตรวจรวมหลายโรงเรียน, คิวตรวจรถ, คนขับหลายคัน, Deployment Readiness dashboard

**Generated:** 2026-04-03 (historical snapshot)
**Branch:** main
**Git status:** Clean (committed)

## Infrastructure (สถานะ ณ 2026-04-03 — ก่อน production)

| Component | Status (snapshot) | สถานะปัจจุบัน (2026-06-23) |
|-----------|--------|--------|
| MySQL 8.0 (Docker) | Running, healthy | ใช้ system MySQL 8.0 ที่ 127.0.0.1 (ไม่ใช้ Docker บน prod) |
| Adminer | Running on :8080 | ไม่ทำงานบน production (ห้าม deploy docker-compose.yml) |
| Backend (Node.js) | Local dev (nodemon) | PM2 fork mode + systemd `pm2-schoolbus.service` |
| Frontend (Vite) | Local dev | Build แล้ว ให้ nginx 伺服 static |
| Dockerfile | NOT EXISTS | ไม่จำเป็น — ใช้ PM2 + nginx แทน Docker |
| Nginx config | NOT EXISTS | มีแล้ว — เป็น entrypoint :80/:443 + TLS ผ่าน certbot |
| Thai font (backend PDF) | NOT EXISTS | มีแล้ว — THSarabunNew ฝังใน PDF export |

## Migrations (สถานะ ณ 2026-04-03 — ก่อนขยายระบบ)

> ปัจจุบัน (2026-06-23) มี migration 001–039 รวม 39 ไฟล์ ดูรายการเต็มใน
> `backend/migrations/` และสถานะ apply ผ่าน `node scripts/migration-status.js`

| Migration | Content | Status (snapshot) |
|-----------|---------|--------|
| 001_initial_schema.sql | 22 tables + indexes | ✅ Applied |
| 008_phase8_leaves_requests.sql | student_leaves + roster_change_requests + photo_url | ✅ Applied |
| 009_roster_request_new_student.sql | student_id nullable + new_student_data JSON | ✅ Applied |
| 010_must_change_password.sql | users.must_change_password column | ✅ Applied |

## Accounts (สถานะ ณ 2026-04-03 — ก่อนบังคับเปลี่ยนรหัสผ่าน)

> ปัจจุบัน (2026-06-23) ทุกบัญชีถูกตั้ง `must_change_password=TRUE` และบังคับเปลี่ยน
> รหัสผ่านตอน login ครั้งแรก รหัส default '1234' ไม่ใช้แล้ว

| Role | Count (snapshot) | Password status (snapshot) |
|------|-------|----------------|
| admin | 1 | Changed (secure) |
| school | 3 | Default '1234' — RISK (snapshot) |
| driver | 57 | Default '1234' — RISK (snapshot) |
| affiliation | 5 | Default '1234' — RISK (snapshot) |
| province | 1 | Default '1234' — RISK (snapshot) |

## Smoke Test Results

| # | Test | Result |
|---|------|--------|
| 1 | Admin login | NOT VERIFIED (password unknown) |
| 2 | Force change password | NOT VERIFIED |
| 3 | Admin province dashboard | NOT VERIFIED |
| 4 | School login | ✅ PASS |
| 5 | Create vehicle + driver | ✅ PASS |
| 6 | Driver first login | ✅ PASS |
| 7 | PDF print summary | NOT VERIFIED (browser) |
| 8 | Audit log + filters | ✅ PASS (after collation fix) |
| 9 | Leave flow | NOT VERIFIED (browser) |
| 10 | Emergency count | ✅ PASS |

## Bugs Fixed During Audit

1. **Collation mismatch in audit-logs** — `CAST(s.id AS CHAR)` without explicit collation caused 500 error on school and affiliation audit endpoints. Fixed by adding `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`.

## Release Decision (snapshot 2026-04-03)

**DEPLOY WITH CONDITIONS** (สถานะ ณ เวลานั้น — ทุกเงื่อนไขถูกปิดหมดแล้วหลัง go-live)

> ปัจจุบัน (2026-06-23) ระบบขึ้น production แล้ว ทุกเงื่อนไขข้อ 1–4 ถูกปิดครบ
> ดูสถานะล่าสุดใน [`docs/production-readiness.md`](production-readiness.md)

Conditions (historical):
1. Admin password must be reset or known before production go-live ✅
2. All seeded passwords should be changed for production ✅ (บังคับเปลี่ยนผ่าน must_change_password)
3. Browser-based tests (PDF, leave flow, UI navigation) must pass manually ✅
4. Backend collation fix must be committed ✅
