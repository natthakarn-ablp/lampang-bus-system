# บันทึกการเปลี่ยนแปลงระบบ — Self-service + Hardening (6 เฟส)

> **วันที่:** 28 มิถุนายน 2569
> **Branch:** `security/audit-fixes-2026-06-18` → **merge เข้า `main` แล้ว** (fast-forward, HEAD = `9931804`)
> **สถานะ:** **Deploy ขึ้น prod แล้ว** (เครื่องนี้ = production, schoolbuslampang.com) · unit suite 208 ผ่าน
> **หลักการกำกับ:** (1) ระบบเดินได้เองไม่พึ่งแอดมินรายวัน (2) ไม่มีค่าใช้จ่ายเพิ่ม

---

## สารบัญ

1. [ที่มา](#1-ที่มา)
2. [Phase 1 — ภาคเรียนแบบ Dynamic](#2-phase-1--ภาคเรียนแบบ-dynamic)
3. [Phase 2 — Retention/Archival log อัตโนมัติ](#3-phase-2--retentionarchival-log-อัตโนมัติ)
4. [Phase 3 — Rate-limit export/import (#27)](#4-phase-3--rate-limit-exportimport-27)
5. [Phase 4 — UI ตรวจเอกสารฝั่ง transport](#5-phase-4--ui-ตรวจเอกสารฝั่ง-transport)
6. [Phase 5 — แจ้ง LINE เมื่อเอกสารถูก reject](#6-phase-5--แจ้ง-line-เมื่อเอกสารถูก-reject)
7. [Phase 6 — รายงานเชิงนโยบาย](#7-phase-6--รายงานเชิงนโยบาย)
8. [บันทึกการ Deploy](#8-บันทึกการ-deploy)
9. [Migration ใหม่](#9-migration-ใหม่)
10. [การทดสอบ](#10-การทดสอบ)
11. [งานที่เหลือ (user-gated)](#11-งานที่เหลือ-user-gated)

---

## 1. ที่มา

ตรวจ backlog ทั้งหมดแล้วกรองด้วยหลักการถาวร 2 ข้อ (ดู memory `feedback_no_admin_dependence_no_cost`)
จึงเลือกทำเฉพาะงานที่ **ลด/ตัดงานแอดมินรายวัน** และ **ไม่เพิ่มค่าใช้จ่าย**. หลายอย่างที่ summary เก่าว่าค้าง
จริงๆ ทำไปแล้ว (redesign merged, transport pending/expiring, refresh-token rotation #7, affiliation อนุมัติคำขอในเขตเองได้)
จึงไม่ทำซ้ำ. งานที่ **ไม่ทำ** เพราะขัดหลักการ: LINE binding option C (เพิ่มงานคนกลาง), OTP/SMS (มีค่าใช้จ่าย).

แต่ละเฟส commit แยกกัน, มี unit test, ผ่าน `node -c`/esbuild/app-graph smoke ก่อน deploy.

---

## 2. Phase 1 — ภาคเรียนแบบ Dynamic
**commit `c2b84d0`**

**ปัญหา:** `env.app.currentTerm` อ่านจาก .env ครั้งเดียวตอน boot → ทุกเทอมแอดมินต้องแก้ .env + `pm2 restart`.

**แก้:** [backend/src/services/term.service.js](../backend/src/services/term.service.js) (ใหม่) resolve เทอมจาก
`terms.is_current` — cache แบบ TTL 60s (single pm2 fork), **fallback เป็น env เมื่อไม่มีแถว** (deploy ก่อน migration 046 ได้)
- `getCurrentTerm(pool)` (async, source of truth) · `getCurrentTermCachedSync()` (ใช้บน hot path)
- `setCurrentTerm` flip แบบ atomic (`FOR UPDATE` → set all FALSE → set target TRUE → audit → invalidate cache) → เปลี่ยนเทอม **โดยไม่ restart**
- ผู้บริโภค ~10 จุดเปลี่ยนมาใช้ helper: checkin / studentImportPreview / vehicleRegistration / vehicleVerification / studentTransfer / rosterRequest / school.routes
- Endpoint (admin เท่านั้น): `GET/POST /api/admin/terms`, `POST /api/admin/terms/:id/current`
- UI: [frontend/src/pages/admin/TermSettings.jsx](../frontend/src/pages/admin/TermSettings.jsx) (เมนู "ภาคเรียนปัจจุบัน")
- Migration **046** seed `2568-2` เป็น current

---

## 3. Phase 2 — Retention/Archival log อัตโนมัติ
**commit `82d0979`**

**ปัญหา:** `audit_logs`/`checkin_logs` โตไม่จำกัด สุดท้ายต้องมีคนล้างมือ.

**แก้:** [backend/scripts/cleanup-old-logs.js](../backend/scripts/cleanup-old-logs.js) + migration **047** (ตาราง `audit_logs_archive`, `checkin_logs_archive` ผ่าน `CREATE TABLE LIKE`)
- archive→ลบ `audit_logs` + `checkin_logs`; hard-delete `daily_status` (ephemeral)
- **dry-run เป็น default**, `--apply` ต้องระบุเอง; แต่ละ batch archive+delete ใน 1 transaction; ไม่แตะ row อนาคต; chunked กัน lock ยาว
- ช่วงเก็บข้อมูลเป็น CLI flag (default ชั่วคราว: audit 365d, checkin 730d, daily 30d)
- **cron 03:45 ยังไม่ติดตั้ง / ยังไม่เปิด `--apply`** จนกว่าจะ confirm ช่วงเวลา (ดู §11)

---

## 4. Phase 3 — Rate-limit export/import (#27)
**commit `8df0754`**

**ปัญหา (audit 2026-06-18 #27):** `exportLimiter` คุมแค่ `/api/reports`; audit-log CSV + research-export + import/template
ใน school/admin/affiliation/province เหลือแค่ floor 120/min.

**แก้:** [backend/src/middleware/rateLimiters.js](../backend/src/middleware/rateLimiters.js) (ใหม่) — 40 req/5 นาที/IP
- `importExportLimiter` (endpoint export/import เฉพาะ) · `exportFormatLimiter` (คุมเฉพาะ `?format=` บน route ที่ทำทั้ง browse+export เช่น audit-logs → browse ปกติไม่โดน)
- ใส่ที่ route ที่หลุดทั้ง 4 ไฟล์ · skip ใน test

---

## 5. Phase 4 — UI ตรวจเอกสารฝั่ง transport
**commit `d8dd606`**

**ปัญหา:** API ตรวจเอกสารฝั่ง transport มีแล้ว ([verification.routes.js](../backend/src/routes/verification.routes.js)) แต่ไม่มี UI.

**แก้:** ดึง logic เดิมจากหน้าโรงเรียนมาเป็น component ใช้ร่วม
[frontend/src/components/DocumentReviewPanel.jsx](../frontend/src/components/DocumentReviewPanel.jsx) (parameterized ด้วย `apiBase`)
- ใช้ทั้งหน้า [SchoolRegistrationReview](../frontend/src/pages/school/SchoolRegistrationReview.jsx) (refactor inline→shared, ไม่ drift) และ
  [VerificationQueue](../frontend/src/pages/transport/VerificationQueue.jsx) (เพิ่ม panel ในรายละเอียดรถ, ส่ง vehicle_id + คนขับหลัก)
- ดูไฟล์ผ่าน blob route ที่ต้อง auth · กดผ่าน/ไม่ผ่านได้

---

## 6. Phase 5 — แจ้ง LINE เมื่อเอกสารถูก reject
**commit `6332f28`**

**แก้:** [driverDocuments.service.js](../backend/src/services/driverDocuments.service.js) `reviewDocument` — เมื่อ `REJECTED`
push ข้อความ LINE ไปยัง **ผู้อัปโหลด** (resolve `line_user_id` จาก `line_users` source of truth, fallback `drivers`)
แบบ best-effort หลัง commit (ล้มเหลวไม่กระทบผลตรวจ) · LINE free tier — ไม่มีค่าใช้จ่าย

---

## 7. Phase 6 — รายงานเชิงนโยบาย
**commit `9931804`**

**แก้:** `getPolicyReport` ใน [report.service.js](../backend/src/services/report.service.js) + route `GET /api/reports/policy`
(province/admin เท่านั้น — guard ก่อนแตะ DB). คืน: ยอดรวมทั้งจังหวัด, % เช็กอินเช้า/เย็นวันนี้, เหตุฉุกเฉิน 30 วัน,
และตารางแยกรายสังกัด (โรงเรียน/นักเรียน/รถ). ใช้ pattern `/api/reports/*` เดิม (ไม่ใช่ `/api/province/reports/*`).

---

## 8. บันทึกการ Deploy

ลำดับที่ทำจริง (28 มิ.ย. 2569 ~04:40 UTC / 11:40 ICT):

1. **Backup:** `scripts/backup-db.sh` → `/home/schoolbus/backups/lampang-bus/lampang_bus_20260628_043954.sql.gz` (836K + sha256)
2. **Migration:** apply 046 + 047 (additive/idempotent) → `migration-status.js --backfill` → **41 ไฟล์ · 0 untracked · 0 drift**
   - ยืนยัน: `terms.2568-2 is_current=1`, ตาราง `audit_logs_archive`/`checkin_logs_archive` สร้างแล้ว
3. **Backend:** boot-check (`require app.js`) → `pm2 restart schoolbus-backend` → `/health` = commit `9931804`, db connected
   - smoke: `/api/admin/terms`, `/api/reports/policy`, `/api/documents/...`, transport docs route → ตอบ 401 (mounted) · `getCurrentTerm` → `2568-2`
4. **Frontend:** `npx vite build --outDir dist-new` (build แยก ไม่ทับ live) → สร้าง symlink `manual`/`docs` → **atomic swap** `dist`
   - bundle หลัก `index-tkcz4WCl.js` → `index-CPlmiIcR.js` · backup เก่าที่ `frontend/dist.bak-20260628_044329`
   - ยืนยัน: SPA เสิร์ฟ bundle ใหม่, `/manual/` = 200
5. **Merge:** `git branch -f main HEAD` (fast-forward, main ไม่ได้ checkout) → **main = `9931804` = prod**

> **บทเรียนที่ยึด:** ไม่ `npm run build` ทับ `frontend/dist` ที่ nginx เสิร์ฟตรงๆ — build ลง `dist-new` แล้ว swap (กัน window ที่ asset ไม่ครบ)

---

## 9. Migration ใหม่

| ไฟล์ | เนื้อหา | ลักษณะ |
|------|--------|--------|
| `046_seed_current_term.sql` | INSERT `terms('2568-2', is_current=TRUE)` ON DUPLICATE KEY + collapse multi-current | additive, idempotent |
| `047_log_archive_tables.sql` | `audit_logs_archive`/`checkin_logs_archive` ผ่าน `CREATE TABLE IF NOT EXISTS ... LIKE` | additive, idempotent |

> วิธีบันทึก ledger: apply SQL แล้ว `node backend/scripts/migration-status.js --backfill` (prod box ไม่มี auto-runner — ดู memory `project_migration_tracking_workflow`)

---

## 10. การทดสอบ

- **Unit:** `npx jest --config jest.unit.config.js` → **208 ผ่าน (21 suites)**; เพิ่มไฟล์ใหม่ `term.unit.test.js`, `cleanupOldLogs.unit.test.js`, `reportService.unit.test.js` + เคส reject-notify ใน `driverDocuments.unit.test.js`
- **Syntax:** `node -c` ทุกไฟล์ backend · esbuild transform ทุกหน้า frontend · `vite build` ผ่าน (integration gate จริง)
- **Smoke หลัง deploy:** route ใหม่ mounted (401), `getCurrentTerm`→DB, SPA bundle ใหม่, retention dry-run รันกับ schema จริงได้ (เจอ daily_status 137 แถวเก่า)

---

## 11. งานที่เหลือ (user-gated)

- **Retention cron 03:45 + `--apply`** — สคริปต์ + ตาราง archive พร้อม, dry-run ผ่าน แต่ **ยังไม่เปิด** จนกว่าจะ confirm ช่วงเก็บข้อมูลจริง (PDPA + รายงานย้อนหลัง). ติดตั้งผ่าน `crontab -e`:
  `45 3 * * * cd .../backend && /usr/bin/node scripts/cleanup-old-logs.js --apply >> /home/schoolbus/logs/cleanup-old-logs.log 2>&1`
- **Push GitHub** — `main` + branch อยู่ local เท่านั้น (prod box ไม่มี git credential) รอ token
- **Screenshots คู่มือ + UAT Phase 10.14** (driver applications, affiliation approvals, driver documents, school registration review) → `docs/manual-html/screenshots/`
