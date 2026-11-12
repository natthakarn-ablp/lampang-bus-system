# ระบบรถรับส่งนักเรียนจังหวัดลำปาง — กติกากลางสำหรับ Claude Code / ผู้พัฒนา

> ไฟล์นี้เก็บเฉพาะ **กติกาที่ต้องทำตามทุกครั้ง** และชี้ไปยังแหล่งความจริง (โค้ด, migrations, เอกสารโมดูล).
> สเปกตั้งต้นฉบับเต็ม (สมัยย้ายจาก Google Sheets) ย้ายไป `docs/history/CLAUDE-original-spec.md` — เป็นประวัติ ไม่ใช่แหล่งความจริง.
> หมายเลขหัวข้อ §5.5, §8, §12 คงไว้ตามเดิมเพราะคอมเมนต์ในโค้ด/test อ้างถึง.

## 0. อ่านก่อนเริ่มงาน
1. `docs/INDEX.md` — สารบัญเอกสาร แยก "ปัจจุบัน" กับ "ประวัติ"
2. `docs/ARCHITECTURE.md` — ภาพรวมระบบ, runtime, การ deploy, backup
3. `docs/modules/<module>.md` — หน้าที่ จุดเข้า โค้ดหลัก ตาราง กติกา และคำสั่งทดสอบของแต่ละโมดูล
4. โค้ดจริงชนะเอกสารเสมอ: route mount อยู่ที่ `backend/src/app.js`, schema คือ `backend/migrations/*.sql` (001, 008–), feature flag ที่ `backend/src/config/env.js` และสถานะบน production ที่ `scripts/production-feature-flags.json`

## 1–3. ประวัติ, สถาปัตยกรรม, schema
- ที่มาจาก Google Sheets/GAS และ mapping ข้อมูลเดิม: `docs/history/CLAUDE-original-spec.md` §1, §7, §9
- สถาปัตยกรรมและโครงสร้างไฟล์จริง: `docs/ARCHITECTURE.md` (ไฟล์ใน §2.2 ของสเปกเดิม เช่น `district.routes.js`, `central.routes.js`, `line-bot/` **ไม่มีอยู่จริง**)
- Schema: อ่านจาก `backend/migrations/` ตามลำดับเลข — ไม่ใช่ SQL ในสเปกเดิม. migration ทุกตัวต้อง additive หรือมี rollback ใน `backend/migrations/rollback/` และ **deploy ไม่รัน migration** (เจ้าของ apply แยกทีละตัว)
- Status code ใน DB เป็นภาษาอังกฤษ (`CHECKED_IN`, `CHECKED_OUT`, `ABSENT`, `CANCELLED`, `PASSED`, `FAILED`, `NEEDS_FIX`, `PENDING` …) แปลเป็นไทยที่ frontend เท่านั้น

## 4. API conventions
- ทุก response เป็น `{ success, message, data, meta? }` หรือ `{ success:false, message, errors:[{field,message}], data:null }` — ใช้ `sendSuccess/sendError` ใน `backend/src/utils/response.js`
- HTTP: 200 / 201 สร้างใหม่ / 400 validation / 401 ไม่ได้ login / 403 สิทธิ์-scope / 404 / 409 ซ้ำหรือสถานะชน / 422 ประมวลผลไม่ได้ / 500
- Pagination `page`, `per_page` (≤100), `sort`, `order`

## 5. API endpoints
รายการจริงอยู่ใน `docs/modules/*.md` (ดึงจาก `router.*` ในโค้ด). หลักสำคัญ:
- เขต = `/api/affiliation/*`, จังหวัด = `/api/province/*` (ไม่มี `/api/district`, `/api/central`)
- รายงาน/Export ทุกบทบาทรวมที่ `/api/reports/*` (rate limit export)
- **§5.5** รายการรถระดับจังหวัดต้องตัดเบอร์โทรออก (summary level)
- route บางกลุ่มเปิดเฉพาะเมื่อ feature flag เปิด — ดู `backend/src/app.js` และ `docs/modules/README.md`

## 6. Export
`exceljs` (Excel), CSV พร้อม BOM `﻿`, `pdfkit` + ฟอนต์ไทย. export ต้องผ่าน `utils/exportSecurity` และเขียน audit log

## 8. RBAC
ตารางด้านล่างคือ **พฤติกรรมโค้ด** (ตรวจล่าสุด 2026-06-26, ปรับ 2026-10-24, 2026-11-07, 2026-11-12) ไม่ใช่การรับรองนโยบาย · ✅ ได้ · ❌ ไม่ได้ · ⚠️ มีเงื่อนไข

| กลุ่มสิทธิ์ | driver | school | affiliation | province | transport | admin |
|---|---|---|---|---|---|---|
| เช็กอิน/เช็กเอาท์ | ✅ รถตน | ⚠️ ยืนยันแทน+เหตุผล / ครูเช็กที่โรงเรียน | ❌ | ❌ | ❌ | ❌ |
| จัดการนักเรียน (CRUD/import) | ❌ (ยื่นคำขอ roster) | ✅ own school | ❌ | ❌ | ❌ | ✅ |
| ครูประจำชั้นรายห้อง (`/api/school/homeroom-teachers`, flag `FEATURE_HOMEROOM_TEACHERS`) | ดูชื่อ+เบอร์ครูของเด็กในรถตน | ✅ บัญชีหลักแก้ไข · ครูสายชั้นดูชั้นตน (เจ้าของยืนยัน 2026-11-12) | ❌ | ❌ | ❌ | ✅ |
| Dashboard เขต | ❌ | ❌ | ✅ own | ภาพรวมจังหวัดผ่าน `/api/province` | ❌ | ✅ |
| Dashboard จังหวัด | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| ตรวจสภาพรถ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| ตรวจสอบรถ/คนขับ (verification) | ❌ | ✅ ยื่น | ❌ | ✅ ดู | ✅ ตรวจ | ✅ |
| จัดการผู้ใช้ | ❌ | บัญชีครูของโรงเรียน (full scope) | ✅ บัญชีหลักของโรงเรียนในสังกัด: สร้าง/แก้ชื่อ/รีเซ็ต/ปิด-เปิด/ลบ/กู้คืน (`/api/affiliation/users`, เจ้าของยืนยัน 2026-11-12) — ไม่รวมบัญชีครู | ❌ | ❌ | ✅ |
| รายงาน `/api/reports` + Export | ❌ | ✅ own | ✅ เขต | ✅ จังหวัด | ❌ | ✅ |
| Audit log | ❌ | ✅ โรงเรียนตน | ✅ เขตตน | ✅ | ❌ | ✅ |
| โอนย้ายนักเรียน | ❌ | ✅ ยื่น/ยกเลิก; โรงเรียนปลายทางอนุมัติข้ามเขต | ✅ อนุมัติในเขต | ❌ | ❌ | ✅ |
| คำขอเกี่ยวกับรถ | ❌ | ✅ ยื่น | ✅ อนุมัติในเขต | ❌ | ❌ | ✅ |
| readiness | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

**ครูประจำชั้น** (`role='school'` + `users.grade_scope`):
- *พฤติกรรมโค้ดปัจจุบัน*: อ่านได้เฉพาะชั้นตน และ **เขียนได้บางเส้นทาง** (แก้ข้อมูลนักเรียนบางฟิลด์, ย้ายรถ, นำออก/กู้คืน, นำเข้าทีละ 1 คน, ลา, เดินทางเอง, ครูเช็กชื่อ, เช็กชื่อย้อนหลัง, เพิ่ม/แก้รถบางฟิลด์, **จุดรับส่งเฉพาะสายชั้นตน — เจ้าของยืนยันแล้ว 2026-11-11**) — รายการพร้อมบรรทัดโค้ด: `docs/modules/students-import.md` หัวข้อ "สิทธิ์ครูประจำชั้น"; เส้นทางจัดการอื่นถูกกันด้วย `requireFullSchoolScope`
- *นโยบาย*: **รอเจ้าของยืนยัน** ว่าสิทธิ์เขียนข้างต้นเป็นสิ่งที่ตั้งใจหรือไม่ (สเปกเดิมเขียนว่า read-only) — อย่าแก้โค้ดหรือเอกสารให้เป็นอย่างใดอย่างหนึ่งจนกว่าเจ้าของตัดสิน

**parent** ยืนยันผ่าน LINE id_token (ไม่ใช่ JWT role) เห็นเฉพาะเด็กที่ผูกไว้. Scope: driver = รถที่ active assignment; school = `school_id` ของ token; affiliation = โรงเรียนในเขต; province = ทั้งจังหวัด (อ่านเป็นหลัก); transport = รถ + ตรวจสภาพ (ไม่เห็น PII นักเรียน); admin = ทุกอย่าง ยกเว้นเช็กอินและ parent API

## 12. Development rules (คงเลขข้อเดิม)
1. MySQL 8.0 เท่านั้น, utf8mb4_unicode_ci (ใช้ CHECK constraint)
2. bcrypt cost 12
3. JWT สำหรับ auth (ไม่ใช้ session/cookie)
4. Timezone Asia/Bangkok ในข้อมูลและการแสดงผล (เครื่อง production ตั้งเป็น UTC — cron รันตามเวลา UTC เพราะ cron ของเครื่องไม่รองรับ `CRON_TZ`)
5. **ห้ามเก็บเลขบัตรประชาชนจริง** — เก็บเฉพาะ `cid_hash`
6. Response ตาม §4
7. ใช้ transaction ให้ atomic: เช็กชื่อ (log + daily_status + คิว notifications + audit), import, ผูก/ยกเลิก LINE, อนุมัติ, ตรวจสภาพ — แต่ **ห้ามเรียกบริการภายนอก (LINE ฯลฯ) ขณะถือ transaction**
8. ทุก CREATE/UPDATE/DELETE/EXPORT/IMPORT เขียน `audit_logs`
9. RBAC/scope บังคับที่ backend เสมอ
10. Soft delete: students, vehicles, parents, users, schools, affiliations
11. เปลี่ยน schema ด้วย migration ใหม่ (additive / มี rollback) และให้เจ้าของ apply — ห้ามแก้ migration เก่า (มี checksum ledger + `legacy-drift-baseline.json`)
12. งานใหญ่ทำทีละส่วน มี test ทุกการแก้ PR เล็กตามหน้าที่
13. Status code เก็บเป็นอังกฤษ
14. Parameterized queries เสมอ
15. Export ตาม §6
16. นำเข้านักเรียนต้องมี `import_batch`

## 14. การทำงานกับระบบจริง (สรุป — รายละเอียดใน `docs/ARCHITECTURE.md`)
- branch ที่ production ใช้: `feat/tracking-security-hardening` (PR merge แบบ merge commit)
- deploy ผ่าน `scripts/deploy-backend.sh` เท่านั้น และต้องมี `DEPLOY_TARGET_SHA` = SHA เต็มที่ Full Quality แบบ push ผ่านแล้ว (OPS-001, `docs/ops/DEPLOY_CI_GATE.md`) — ห้าม bypass
- test: `cd backend && npx jest --config jest.unit.config.js --runInBand --forceExit` (ไม่ใช้ DB); `npm run test:ci` ต้องมี MySQL test DB; unit test ที่ deploy รันใช้ `.env` ของเซิร์ฟเวอร์ — **pin feature flag ใน test เสมอ**
- ห้าม commit ข้อมูลเด็ก, secret, backup — repository นี้เป็น **public**
- ห้ามส่ง LINE ถึงผู้ใช้จริงเพื่อทดสอบ
