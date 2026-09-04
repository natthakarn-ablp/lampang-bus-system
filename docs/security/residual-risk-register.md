# Residual Risk Register — ความเสี่ยงด้านความมั่นคงปลอดภัยที่ยังคงเหลือ

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

จัดทำ: 4 กันยายน 2569

สถานะเอกสาร: **ร่างทะเบียนความเสี่ยงเพื่อเสนอผู้มีอำนาจตัดสินว่าจะยอมรับหรือไม่ยอมรับ — ไม่ใช่การอนุมัติ ไม่ใช่การยอมรับความเสี่ยง ไม่ใช่ผลการทดสอบ ไม่ใช่หลักฐาน UAT และไม่ใช่ sign-off**

ทุกช่องลงนามในเอกสารนี้ยังว่าง และสถานะของทุกรายการคือ **"รอ owner/DPO ตัดสิน"** เอกสารนี้ไม่ระบุว่ารายการใด "ผ่าน" "ปิดแล้ว" "ตรวจสอบยืนยันแล้ว" หรือ "พร้อมใช้งานจริง" — ระบุเพียงว่า *โค้ดปัจจุบันมีอะไร ไม่มีอะไร และอะไรที่ตรวจจากเครื่องนี้ไม่ได้*

เอกสารอ้างอิง:

- `docs/project-closure/execution-plan-to-completion-2026-09-04.md` — A1-5 (บรรทัด 128), §5.1 (บรรทัด 139–147), A1-5 exit evidence (บรรทัด 299)
- `docs/project-closure/master-project-closure-plan.md` — Phase 7 (บรรทัด 227, 234)
- `docs/project-closure/notes.md` — บรรทัด 22–23 (รายการ residual ที่ต้อง fix หรือมี risk acceptance)
- `docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md` — บรรทัด 53–70 (backlog ตั้งต้นจาก audit 2026-06-18)
- `CLAUDE.md` §12 ข้อ 3 (บรรทัด 1252)

---

## 1. ฐานของการตรวจสอบ

| รายการ | ค่า |
|---|---|
| Branch / commit ที่อ่านโค้ด | `feat/tracking-security-hardening` @ `4b80b4b` — `git status --short` ไม่มีรายการ ` M` เลย (ไม่มีไฟล์ tracked ใดถูกแก้ค้างไว้ขณะอ่าน) มีเพียงไฟล์ใหม่ที่ยังไม่ track หนึ่งไฟล์ใต้ `backend/` คือ `backend/scripts/seed-synthetic-staging.js` ซึ่งเอกสารนี้ไม่ได้อ้างอิงบรรทัดใดจากไฟล์นั้น |
| ความสัมพันธ์กับ RC ในแผน | `git diff --stat cef4bd1..4b80b4b` ไม่มีไฟล์ใดใน `backend/src/` หรือ `frontend/src/` เปลี่ยน (เปลี่ยนเฉพาะ `scripts/`, `docs/`, `backend/tests/`, `.gitattributes`) — บรรทัดที่อ้างในเอกสารนี้จึงตรงกับ RC `cef4bd1` ตาม §1 ของ execution plan; §5 อ้างบรรทัดใน `backend/tests/` ซึ่งเป็น directory ที่เปลี่ยนในช่วงนี้ — ตรวจ `git diff --name-status cef4bd1..4b80b4b` แล้วไฟล์ทดสอบที่เปลี่ยนมีสามไฟล์ ขึ้นต้นด้วย `A` (ไฟล์ใหม่) ทั้งหมด คือ `closureReportSchema.unit.test.js`, `goLiveEvidenceRows.unit.test.js`, `readinessGateNpmAudit.unit.test.js` ไม่ใช่ไฟล์ทดสอบที่ §5 อ้างถึง |
| วิธีตรวจ | อ่าน source ในเครื่องนี้เท่านั้น |
| สิ่งที่ **ไม่ได้** ทำระหว่างจัดทำเอกสารนี้ | ไม่ได้รันชุดทดสอบ ไม่ได้ deploy ไม่ได้ต่อ production ไม่ได้แตะ database ไม่ได้เปลี่ยน feature flag |
| ผลที่ตามมา | ทุกข้อความในทะเบียนนี้เป็น **ข้อความจากการอ่านโค้ด** ไม่ใช่ผลการทดสอบ — สิ่งที่ยืนยันจากเครื่องนี้ไม่ได้อยู่ใน §6 |

## 2. กรอบสถาปัตยกรรมที่ทะเบียนนี้ไม่เปลี่ยน

`CLAUDE.md` บรรทัด 1252 กำหนดว่า **"JWT สำหรับ auth — ห้ามใช้ session/cookie"**

ตาม §5.1 ของ execution plan (บรรทัด 143–146):

- ทางเลือก httpOnly cookie **ถูกเอาออกจาก implementation queue** — ทะเบียนนี้จึง **ไม่เสนอ** การย้ายไป cookie เป็น action item ของรายการใด
- การจะเปลี่ยนต้องผ่านลำดับนี้ก่อนเท่านั้น: (1) Owner + Technical owner อนุมัติ spec change ของ `CLAUDE.md` §12 ข้อ 3 เป็นลายลักษณ์อักษร → (2) แก้ `CLAUDE.md` → (3) ประเมิน CSRF/SameSite/logout/refresh ใหม่ทั้งชุด → (4) เปิด task ใหม่ในแผนรุ่นถัดไป
- สิ่งที่ C2-2 (DPO review, บรรทัด 164) และ C3-4 (บรรทัด 181) ตัดสินคือ **ยอมรับ residual risk ภายใต้สถาปัตยกรรม JWT เดิมได้หรือไม่** ไม่ใช่การเลือกสถาปัตยกรรม auth

ดังนั้น RR-01 ด้านล่างจึงบันทึกความเสี่ยงของ localStorage **ภายใต้กรอบ JWT ที่มีอยู่** คือ access token TTL สั้น + refresh rotation + replay detection ตามที่ §5.1 บรรทัด 144 กำหนด

---

## 3. ทะเบียนความเสี่ยงคงเหลือ

### RR-01 — Access/refresh token เก็บใน `localStorage` (รายการหลัก)

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | Web SPA เก็บทั้ง `access_token` และ `refresh_token` ใน `localStorage` ซึ่ง JavaScript ที่รันใน origin เดียวกันอ่านได้ทั้งหมด |
| ตำแหน่งในโค้ด | เขียนตอน login: `frontend/src/hooks/useAuth.jsx:30-31`; อ่านใส่ Authorization header ทุก request: `frontend/src/api/axios.js:10-11`; อ่าน refresh token: `frontend/src/api/axios.js:59,82`; เขียน access token ใหม่หลัง refresh: `frontend/src/api/axios.js:85`; อ่าน token ตรงสำหรับดาวน์โหลดไฟล์: `frontend/src/components/ExportButtons.jsx:48`, `frontend/src/pages/admin/ResearchExport.jsx:76`; ล้างตอน logout/refresh ล้มเหลว: `frontend/src/hooks/useAuth.jsx:48`, `frontend/src/api/axios.js:93`, `frontend/src/pages/ChangePassword.jsx:48-49` |
| เหตุที่ยังเปิด | เป็นผลจากกฎสถาปัตยกรรมที่ยังมีผลบังคับ (`CLAUDE.md:1252`) ไม่ใช่จากงานที่ค้าง — §5.1 ระบุว่าการเปลี่ยนต้องผ่าน spec change ก่อน จึงไม่มี task ใดในแผนที่ปิดข้อนี้ได้ด้วยการแก้โค้ด |
| มาตรการที่มีอยู่ (ตรวจจากโค้ด) | 1) CSP ระดับหน้า `frontend/index.html:15` — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` 2) ไม่พบ `dangerouslySetInnerHTML` ในทั้ง `frontend/src/` (พบเพียง `innerHTML` แบบอ่านเพื่อสั่งพิมพ์ที่ `frontend/src/pages/reports/SummaryReport.jsx:62`) จึงพึ่ง escaping ปกติของ React เป็นด่านหลัก 3) backend ตรวจสถานะบัญชีกับ DB **ทุก request** `backend/src/middleware/auth.js:70-81` — บัญชีที่ถูกปิด/ลบถูกปฏิเสธทันที ไม่ต้องรอ token หมดอายุ 4) token ที่ออกก่อนการเปลี่ยนรหัสผ่านใช้ไม่ได้ทันที ทั้ง access token (`backend/src/middleware/auth.js:88-93`) และ refresh token (`backend/src/routes/auth.routes.js:355-362`) → การเปลี่ยนรหัสผ่านเป็นช่องทางเพิกถอนที่ใช้ได้จริง 5) algorithm ถูกตรึงเป็น HS256 ทั้งฝั่ง sign และ verify (`auth.routes.js:23,90,99`, `auth.js:45`) ปิด alg-confusion / `alg:none` 6) refresh token ถูก rotate ทุกครั้งที่ใช้ (`auth.routes.js:366-374`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | ถ้ามี XSS หรือ dependency ฝั่ง frontend ถูกแทรกโค้ด script ใน origin เดียวกันอ่าน token ทั้งสองใบได้ แล้วเรียก API ในสิทธิ์และ scope ของผู้ใช้รายนั้นได้จนกว่า access token จะหมดอายุ และต่ออายุเองได้ด้วย refresh token ที่ขโมยไป การเพิกถอนต้องอาศัยการเปลี่ยนรหัสผ่านหรือปิดบัญชี ไม่มีกลไก "ยุติทุก session ของผู้ใช้รายนี้" แยกต่างหากในโค้ด นอกจากนี้มาตรการ CSP ยังอ่อนกว่าที่ควรตาม RR-07 |
| ชุดข้อมูลที่ได้รับผลกระทบ และฐานทางกฎหมาย | **รอ D0-2** (data inventory + purpose) และ **รอ D0-3** (lawful basis รายวัตถุประสงค์) — ห้ามระบุเองว่า token ที่หลุดเข้าถึงข้อมูลชุดใดในความหมายของ PDPA |
| ค่า TTL ที่ใช้จริง | `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` เป็น environment variable บังคับ (`backend/src/config/env.js:12-13,170-174`) ค่าใน template คือ `24h` และ `7d` (`backend/.env.example:22-23`) ซึ่งตรงกับ `CLAUDE.md:703` — **ค่าที่ตั้งบน production ตรวจจากเครื่องนี้ไม่ได้ (§6)** และ §5.1 บรรทัด 144 ระบุมาตรการเป็น "short TTL" โดยไม่มีที่ใดในโค้ดหรือเอกสารใน repository กำหนดตัวเลขว่า "short" คือเท่าใด — การตัดสินว่า 24h เข้าเกณฑ์หรือไม่จึงเป็นการตัดสิน ไม่ใช่ข้อเท็จจริงที่อ่านได้จาก repo (มีข้อสังเกตเดิมให้ทบทวนค่า 24h ที่ `docs/audit/SYSTEM_AUDIT_REPORT.md:1012`); ค่าเป้าหมายใหม่ต้องกำหนดโดย Technical owner (ชื่อจริง **รอ C0-7**) และผ่าน change approval ตาม **C0-13** — ห้ามทีมเทคนิคตั้งค่าเองในเอกสารนี้ |
| ผู้ต้องรับความเสี่ยง | DPO/legal (ตาม C2-2 บรรทัด 164) ร่วมกับ Project owner (ตาม C3-4 บรรทัด 181) — ชื่อจริง **รอ C0-7** |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** (ยังไม่มี severity scheme ที่อนุมัติ ห้ามตั้งระดับเอง) |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-02 — Refresh-token replay detection ยังไม่มี (rotation มีแล้ว)

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | `/api/auth/refresh-token` หมุน token ทุกครั้งที่ใช้ (เพิกถอน jti เดิม ออกใบใหม่) แต่เมื่อมีการนำ token ที่ถูกหมุนไปแล้วกลับมาใช้ซ้ำ ระบบตอบ 401 เฉย ๆ ไม่ได้ถือว่าเป็นสัญญาณการขโมยและไม่ได้เพิกถอนสายของ token ที่ออกต่อจากนั้น |
| ตำแหน่งในโค้ด | route: `backend/src/routes/auth.routes.js:319`; ตรวจ revocation list: `:334-339`; rotation: `:366-374`; `jti` ของใบใหม่ถูก destructure ที่ `:369` แต่ **ไม่ถูกบันทึกที่ใดเลย** (`grep -rn "newJti"` พบที่บรรทัด 369 บรรทัดเดียวในทั้ง repository) จึงไม่มี lineage/family id ให้เพิกถอนเป็นชุด; ตาราง `revoked_tokens` เป็น blacklist ราย jti ตาม `CLAUDE.md:711-717` |
| เหตุที่ยังเปิด | replay detection ต้องเก็บสายของ token (family/lineage) ซึ่งเป็นการเพิ่มโครงสร้างข้อมูล ไม่ใช่การแก้บรรทัดเดียว; อยู่ในขอบเขต A1-5 (บรรทัด 128) ซึ่งยังไม่ได้ทำในโค้ดที่อ่าน |
| มาตรการที่มีอยู่ | rotation ทุกครั้งที่ใช้ (`:366-374`) จำกัด refresh token ที่ถูกขโมยให้ใช้ได้ครั้งเดียวแทนที่จะใช้ได้ตลอด 7 วัน; blacklist ตรวจก่อนออก token ใหม่ (`:334-339`); rate limit เฉพาะ endpoint นี้ 30 ครั้ง/5 นาที/IP (`:63-69`); logout เขียน jti ลง blacklist (`:393,409-412`); เปลี่ยนรหัสผ่านทำให้ refresh token เดิมใช้ไม่ได้ (`:355-362`); runbook กำหนด cron ล้าง `revoked_tokens` 03:00 (`docs/OPERATOR_RUNBOOK.md:15`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | ถ้าผู้โจมตีได้ refresh token ไปและใช้ **ก่อน** ผู้ใช้จริง ผู้โจมตีจะได้ token ใบใหม่ ส่วนผู้ใช้จริงจะได้ 401 และถูกบังคับ login ใหม่ — ระบบไม่ตีความเหตุการณ์นี้ว่าเป็นการขโมยและไม่เพิกถอนใบที่ผู้โจมตีถืออยู่ ไม่มี audit event เฉพาะสำหรับการใช้ token ที่ถูกเพิกถอนแล้ว (ไม่พบ `logAudit` ในสาขา `:338-339`) จึงไม่มีร่องรอยให้ตรวจย้อนหลัง นอกจากนี้ `:372` เป็น `INSERT` ธรรมดา (ไม่ใช่ `ON DUPLICATE KEY UPDATE` แบบที่ logout ใช้ที่ `:409-411`) ถ้ามีการเรียกซ้ำสองครั้งที่ผ่านการตรวจ `:334-339` ไปพร้อมกัน ใบที่แพ้จะชน `ER_DUP_ENTRY` แล้วถูกส่งต่อด้วย `return next(err)` (`:386-387`) ไปยัง error handler ซึ่ง map `ER_DUP_ENTRY` เป็น **409** (`backend/src/middleware/errorHandler.js:30` ต่อไว้ท้ายสุดที่ `backend/src/app.js:253`) ไม่ใช่ 401 อย่างที่ client คาด — **ข้อนี้อ่านจาก source ยังไม่ได้ทดสอบ runtime** (ความพยายาม login บน sandbox เมื่อ 4 ก.ย. ถูก rate limit ตอบ 429 จึงยังไม่ได้ยิงจริง) |
| ทางเลือกในการปิด (ยังไม่อนุมัติ ไม่ใช่ข้อผูกพัน) | บันทึกสาย token แล้วเพิกถอนทั้งสายเมื่อพบการใช้ซ้ำ พร้อม audit event — อยู่ในกรอบ JWT เดิม ไม่กระทบ `CLAUDE.md` §12 ข้อ 3 |
| ผู้ต้องรับความเสี่ยง | Technical owner (ชื่อจริง **รอ C0-7**); ลำดับความสำคัญและกำหนดเวลาแก้ **รอ C0-13** |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-03 — Frontend ทิ้ง refresh token ใบใหม่ที่ได้จาก rotation

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | Backend ส่ง `refresh_token` ใบใหม่กลับมาใน response ของ `/api/auth/refresh-token` (`backend/src/routes/auth.routes.js:376-384`) แต่ interceptor ฝั่ง frontend บันทึกเฉพาะ `access_token` และไม่เก็บใบใหม่ ทำให้ค่าใน `localStorage` ยังเป็นใบเดิมที่เพิ่งถูกเพิกถอนไป |
| ตำแหน่งในโค้ด | `frontend/src/api/axios.js:81-85` (`const newToken = res.data.data.access_token; localStorage.setItem('access_token', newToken);` — ไม่มีการอ่าน `res.data.data.refresh_token`) เทียบกับการเพิกถอนใบเดิมที่ `backend/src/routes/auth.routes.js:371-374` |
| เหตุที่ยังเปิด | เป็นข้อบกพร่องของโค้ดที่ยังไม่ถูกหยิบขึ้นมาแก้ ไม่ใช่ข้อจำกัดเชิงสถาปัตยกรรม; อยู่ในขอบเขต A1-5 (บรรทัด 128) |
| มาตรการที่มีอยู่ | เมื่อ refresh ล้มเหลว interceptor ล้าง storage แล้วส่งผู้ใช้ไปหน้า login (`frontend/src/api/axios.js:90-95`) ผู้ใช้จึงไม่ค้างอยู่ในสถานะที่ token ใช้ไม่ได้ |
| ความเสี่ยงคงเหลือหลังมาตรการ | ผลรวมคือมาตรการ rotation ของ RR-02 **ทำงานได้เพียงรอบเดียวต่อการ login หนึ่งครั้ง**: หลังการ refresh ครั้งแรก ค่าที่ client ถืออยู่คือใบที่ถูกเพิกถอนแล้ว การ refresh ครั้งถัดไปจะถูกปฏิเสธที่ `auth.routes.js:338-339` และผู้ใช้ถูกบังคับ login ใหม่โดยไม่มีข้อความอธิบาย เป็นทั้งปัญหาความต่อเนื่องการใช้งาน (ผู้ใช้หลุดกลางงาน) และทำให้มาตรการที่อ้างใน §5.1 บรรทัด 144 ไม่ทำงานเต็มรูปแบบ; **ยังไม่มีการทดสอบยืนยันพฤติกรรมนี้จากการรันจริง** — ข้อความนี้มาจากการอ่านโค้ดสองฝั่งประกอบกัน |
| ผู้ต้องรับความเสี่ยง | Technical owner (ชื่อจริง **รอ C0-7**); การจัดลำดับและ change approval **รอ C0-13** |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-04 — Export rate limit ยังไม่ครอบทุก route

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | `GET /api/affiliation/audit-logs` รองรับ `?format=csv` แต่ไม่ได้ผูก `exportFormatLimiter` ต่างจาก route เทียบเท่าของ school/province/admin |
| ตำแหน่งในโค้ด | ไม่มี limiter: `backend/src/routes/affiliation.routes.js:546` (สาขา CSV อยู่ที่ `:578-596`) และไฟล์นี้ import เฉพาะ `importExportLimiter` ที่ `:11`; เทียบกับ route ที่มี limiter แล้ว: `backend/src/routes/school.routes.js:1273`, `backend/src/routes/province.routes.js:188`, `backend/src/routes/admin.routes.js:604`; `GET /api/admin/research-export/preview` (route นิยามที่ `admin.routes.js:1368`; `:1367` เป็น comment หัวข้อ) ก็ไม่มี limiter แต่คืนเฉพาะตัวนับและสถานะ `evidence_readiness` (`:1386-1400`) ไม่ใช่ชุดข้อมูลรายบุคคล |
| เหตุที่ยังเปิด | เป็นช่องที่หลงเหลือจากการไล่ผูก limiter รอบ audit 2026-06-18 (`docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md:56-57`) ยังไม่มีใครไล่ปิดรอบสุดท้าย; อยู่ในขอบเขต A1-5 (บรรทัด 128) |
| มาตรการที่มีอยู่ | 1) global floor 120 request/นาที/IP ครอบ `/api/affiliation` อยู่แล้ว (`backend/src/app.js:21-33,115-127`) 2) CSV ของ audit log ถูกจำกัดที่ 5,000 แถวต่อครั้ง พร้อมแจ้ง truncation (`affiliation.routes.js:581-596`) 3) ทุกครั้งที่ export มีการเขียน audit log (`affiliation.routes.js:593-594`) 4) เนื้อหาถูก neutralise กัน formula injection และ redact ค่าที่อ่อนไหวผ่าน `backend/src/utils/exportSecurity.js:25-40,66-76` |
| ความเสี่ยงคงเหลือหลังมาตรการ | ผู้ใช้ที่ authenticate แล้วในบทบาท affiliation ดึง audit log ได้สูงสุด 5,000 แถวต่อ request ที่อัตราถึง 120 request/นาที ซึ่งสูงกว่าเพดาน 40 request/5 นาที ที่ใช้กับ route ประเภทเดียวกัน — เป็นทั้งภาระ DB (pool = 10 ตาม `backend/src/app.js:114`) และการดึงข้อมูลออกจำนวนมากในเวลาสั้น |
| การจำแนกว่าเป็นข้อมูลส่วนบุคคลหรือไม่ และ retention ของไฟล์ที่ export ออกไป | **รอ D0-2** และ **รอ D0-8** |
| ผู้ต้องรับความเสี่ยง | Technical owner (ชื่อจริง **รอ C0-7**) |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-05 — Export ยังสร้างชุดข้อมูลทั้งก้อนในหน่วยความจำ (ไม่มี streaming และไม่มีเพดานแถว)

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | Report export และ research export ดึงผลลัพธ์ทั้งชุดเข้าหน่วยความจำ แล้วประกอบเป็น string CSV หรือ workbook ทั้งใบก่อนส่งออก ไม่มี streaming และไม่มีเพดานจำนวนแถว |
| ตำแหน่งในโค้ด | query ที่ไม่มี `LIMIT`: `backend/src/services/report.service.js:441-466`; ประกอบ CSV ในหน่วยความจำ: `backend/src/routes/report.routes.js:217-249`; ประกอบ workbook ในหน่วยความจำแล้วจึงเขียนลง response: `backend/src/routes/report.routes.js:256-305`; report รายเดือน: `:472,497,535`; research export CSV/Excel: `backend/src/routes/admin.routes.js:1177-1256` และ `:1259-1354`; ค้นหา `createReadStream` และ `.pipe(` ใน `backend/src` พบ 4 จุด ไม่ใช่จุดเดียว: ส่งไฟล์เอกสารที่ `backend/src/routes/documents.routes.js:82,84` และ `doc.pipe(res)` ของ PDFKit ที่ `backend/src/routes/report.routes.js:325,549` — สองจุดหลังทยอยส่ง *ไฟล์ PDF ที่ประกอบเสร็จแล้ว* ออกทาง response จริง แต่ยังดึงชุดข้อมูลทั้งชุดเข้าหน่วยความจำก่อน (`report.routes.js:314,538`) ส่วนเส้นทาง CSV/Excel ที่รายการนี้พูดถึงไม่มี stream เลย |
| เหตุที่ยังเปิด | การเปลี่ยนเป็น streaming ต้องแก้ทั้ง query, การประกอบไฟล์ และการทดสอบ เป็นงานที่ backlog เดิมระบุว่า "full fix is a larger change" (`docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md:53,58`); อยู่ในขอบเขต A1-5 (บรรทัด 128) |
| มาตรการที่มีอยู่ | 1) `/api/reports/*` ถูกจำกัด 40 request/5 นาที/IP (`backend/src/app.js:155-163`) 2) research export ถูกจำกัดด้วย `importExportLimiter` (`backend/src/routes/admin.routes.js:986`) 3) CSV ของ audit log (คนละ route) มีเพดาน 5,000 แถว 4) ทุก export เขียน audit log (`report.routes.js:246-248`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | หน่วยความจำที่ใช้ต่อ request แปรผันตามขนาดชุดข้อมูลโดยไม่มีขอบเขตบน — ผู้ใช้ระดับ province/admin ที่ scope กว้างสามารถทำให้ backend ใช้หน่วยความจำสูงจนกระทบ instance เดียวที่ให้บริการอยู่ ปริมาณจริงยัง **ประเมินเป็นตัวเลขไม่ได้** เพราะยังไม่มีผลรัน load test จาก environment ที่ใช้ปิด capacity gate (execution plan §1 และ A1-8 บรรทัด 131) |
| ผู้ต้องรับความเสี่ยง | Technical owner + Operator (ชื่อจริง **รอ C0-7**) |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-06 — บัญชีที่ย้ายมาจากระบบเดิมยังไม่ถูกบังคับเปลี่ยนรหัสผ่านที่อ่อน

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | สคริปต์ย้ายข้อมูลจาก Excel ตั้งรหัสผ่านตั้งต้นเป็น `'1234'` เมื่อไฟล์ต้นทางไม่ระบุค่า และ INSERT โดยไม่ตั้ง `must_change_password` ค่าคอลัมน์จึงเป็น FALSE ตาม default ของ schema — ระบบไม่มีกลไกใดที่บังคับให้บัญชีเหล่านี้เปลี่ยนรหัสผ่านภายหลัง |
| ตำแหน่งในโค้ด | ค่าตั้งต้น: `backend/scripts/migrate-from-excel.js:405`; INSERT ที่ไม่ตั้ง flag: `:421-428`; default ของคอลัมน์: `backend/migrations/010_must_change_password.sql:6`; นโยบายความยาวขั้นต่ำ 8 ตัวอักษรและ blocklist: `backend/src/utils/passwordPolicy.js:17-47` ซึ่งถูกเรียกเฉพาะตอน **ตั้งหรือเปลี่ยน** รหัสผ่าน (ครบทั้ง 8 จุดตาม `grep -rn validatePassword backend/src`: `backend/src/routes/auth.routes.js:277`, `backend/src/routes/admin.routes.js:146,293`, `backend/src/routes/school.routes.js:1973,2035`, `backend/src/routes/adminPasswordRecovery.routes.js:454`, `backend/src/routes/driver.routes.js:899`, `backend/src/services/affiliationAdmin.service.js:91,314` — ทุกจุดเป็นเส้นทางตั้ง/เปลี่ยน/reset รหัสผ่านทั้งสิ้น) ไม่ได้ถูกเรียกตอน login (`auth.routes.js:124`); ไม่มีสคริปต์หรือ migration ใดใน `backend/scripts/` และ `backend/migrations/` ที่ตั้ง `must_change_password` ให้บัญชีเดิมเป็นชุด |
| เหตุที่ยังเปิด | การบังคับหมุนรหัสผ่านเป็นชุดกระทบผู้ใช้จริงทุกคนพร้อมกัน จึงต้องมีขอบเขตบัญชี หน้าต่างเวลา และการสื่อสารที่ผู้มีอำนาจอนุมัติก่อน ไม่ใช่การตัดสินใจของทีมเทคนิค |
| มาตรการที่มีอยู่ | 1) การ reset โดย admin/โรงเรียน/ต้นสังกัด ตั้ง `must_change_password = TRUE` เสมอ (`backend/src/routes/admin.routes.js:302`, `backend/src/routes/school.routes.js:2044`, `backend/src/services/affiliationAdmin.service.js:103`) 2) เมื่อ flag เป็น TRUE backend ปิดทุก route ยกเว้น `/api/auth/me`, `/api/auth/change-password`, `/api/auth/logout` (`backend/src/middleware/auth.js:11-15,103-110`) และอ่านค่าสดจาก DB ทุก request (`:95`) 3) ล็อกการเดารหัสผ่านรายบัญชี 10 ครั้ง/15 นาที (`backend/src/routes/auth.routes.js:35-52`) ซ้อนบน rate limit 20 ครั้ง/15 นาที/IP (`:55-61`) 4) หน่วงเวลาให้เท่ากันในสาขา user-not-found/disabled กันการนับชื่อผู้ใช้ (`:29`) 5) bcrypt cost 12 (`:18`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | บัญชีใดก็ตามที่ถูกย้ายเข้ามาและยังไม่เคยเปลี่ยนรหัสผ่านอาจยังใช้รหัสสั้นกว่าเกณฑ์ 8 ตัวอักษรที่บังคับกับรหัสใหม่ทุกใบ การล็อกรายบัญชีจำกัดการเดาแบบต่อเนื่อง แต่ไม่ช่วยกรณีที่รหัสผ่านตั้งต้นเป็นค่าที่คาดเดาได้และรู้กันในวงกว้าง — **จำนวนบัญชีที่อยู่ในสภาพนี้จริงตรวจจากเครื่องนี้ไม่ได้ (§6)** |
| ขอบเขตบัญชีที่ต้องบังคับหมุน | **รอ C0-4** (ยืนยัน Core scope และ pilot scope ว่าบทบาท/หน่วยงานใดอยู่ใน rollout) |
| หน้าต่างเวลาที่ดำเนินการได้ | **รอ C0-8** (maintenance window) |
| ผู้ต้องรับความเสี่ยง | Project owner + Technical owner (ชื่อจริง **รอ C0-7**) |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-07 — CSP ยังอนุญาต `'unsafe-inline'` และ `'unsafe-eval'` ใน `script-src`

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | CSP ที่ประกาศผ่าน meta tag อนุญาต `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net` ซึ่งลดทอนคุณค่าของ CSP ในฐานะมาตรการชดเชยของ RR-01 |
| ตำแหน่งในโค้ด | `frontend/index.html:15`; หมายเหตุ TODO ที่เขียนไว้เองว่าต้องรัดกุมขึ้น (drop `'unsafe-inline'`/`'unsafe-eval'` ใช้ hash/nonce และย้ายไปเป็น HTTP header ที่ nginx) อยู่ที่ `frontend/index.html:11-13`; ตัวอย่าง header ฝั่ง nginx ในเอกสาร deploy ยังถูก comment ไว้ที่ `docs/deployment-hardening.md:74`; `helmet()` ถูกใช้ที่ `backend/src/app.js:47`; ตาม topology ที่ `docs/deployment-hardening.md:69` ระบุ (nginx เสิร์ฟ SPA เอง helmet ครอบเฉพาะ `/api`) header ของ helmet จะไม่ครอบหน้า SPA — แต่โค้ดยังมีอีกเส้นทางหนึ่งที่ `backend/src/app.js:238-245` ซึ่ง Express เสิร์ฟ `frontend/dist` และ `index.html` เองเมื่อ `NODE_ENV=production` ถ้า production เดินเส้นนั้น helmet จะครอบหน้า SPA ด้วย; **production ใช้เส้นทางใดจริงตรวจจากเครื่องนี้ไม่ได้ (§6)** |
| เหตุที่ยังเปิด | การถอด `'unsafe-inline'`/`'unsafe-eval'` ต้องยืนยันกับ build จริงก่อนว่า SPA และ LIFF ยังทำงาน ซึ่งต้องมี staging — staging ยังไม่มี (execution plan §1 และ B2-2 บรรทัด 161) |
| มาตรการที่มีอยู่ | ส่วนที่เหลือของ CSP ยังจำกัดจริง: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (`frontend/index.html:15`); LIFF SDK ถูก bundle จาก npm ผ่าน dynamic import ไม่ได้โหลดจาก CDN (`frontend/src/utils/liff.js:16,22-30`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | CSP ปัจจุบันไม่กัน inline script ที่ถูกแทรกเข้ามา จึงไม่ถือเป็นด่านที่หยุดการอ่าน token ใน `localStorage` ได้ — RR-01 จึงพึ่ง escaping ของ React เป็นด่านหลักจริง ๆ ไม่ใช่ CSP |
| ผู้ต้องรับความเสี่ยง | Technical owner (ชื่อจริง **รอ C0-7**) |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** |

### RR-08 — สถานะความปลอดภัยบางส่วนอยู่ในหน่วยความจำของ instance เดียว

| หัวข้อ | เนื้อหา |
|---|---|
| คำอธิบาย | การล็อกบัญชีจากการ login ผิดซ้ำเก็บอยู่ใน `Map` ในหน่วยความจำของ process ไม่ได้อยู่ใน store ที่ใช้ร่วมกัน — comment ในโค้ดระบุเงื่อนไขนี้ไว้เอง |
| ตำแหน่งในโค้ด | `backend/src/routes/auth.routes.js:31-52` (comment ที่ `:31-34` ระบุว่าเป็น single-instance pm2 fork และต้องย้ายไป Redis/DB ถ้า deploy หลาย instance); รายการเดียวกันถูกบันทึกไว้แล้วที่ `docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md:68-70` และ `docs/project-closure/notes.md:22` |
| เหตุที่ยังเปิด | ผูกกับงาน A1-9 (execution plan บรรทัด 132) ซึ่งต้องรอผล A1-8 (load test บน local staging) ก่อนจึงจะตัดสินได้ว่าย้ายไป DB หรือ Redis |
| มาตรการที่มีอยู่ | comment ในโค้ด (`auth.routes.js:31-34` — "Single-instance (pm2 fork)") และ `docs/project-closure/notes.md:22` ระบุตรงกันว่า production เป็น backend instance เดียว ถ้าเป็นจริงตามนั้นการล็อกยังทำงานตามที่ออกแบบ — **จำนวน instance จริงบนเซิร์ฟเวอร์ยังไม่ได้ยืนยันจากเครื่องนี้ (§6)**; rate limit ต่อ IP ยังทำงานอยู่ทุกชั้น (`auth.routes.js:55-69`, `backend/src/app.js:115-127`) |
| ความเสี่ยงคงเหลือหลังมาตรการ | ถ้ามีการ scale เป็นหลาย instance โดยไม่ย้าย state ก่อน การล็อกรายบัญชีจะอ่อนลงตามจำนวน instance โดยไม่มีสัญญาณเตือน — เป็นความเสี่ยงเชิงปฏิบัติการที่จะเกิดตอนขยายระบบ ไม่ใช่ตอนนี้ |
| ผู้ต้องรับความเสี่ยง | Technical owner + Operator (ชื่อจริง **รอ C0-7**) |
| ระดับความรุนแรงตาม severity scheme | **รอ C0-13** |
| สถานะ | **รอ owner/DPO ตัดสิน** (บันทึกไว้เพื่อไม่ให้ตกหล่น; งานแก้ติดตามที่ A1-9) |

---

## 4. รายการใน backlog เดิมที่ไม่ตรงกับโค้ดปัจจุบันแล้ว

`docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md` เขียนขึ้นเมื่อ 18 มิถุนายน 2569 ข้อความบางส่วนไม่ตรงกับโค้ดที่อ่านในวันนี้ บันทึกไว้เพื่อไม่ให้มีใครหยิบไปทำซ้ำหรืออ้างเป็นความเสี่ยงที่ยังเปิดอยู่ **ข้อความด้านล่างมาจากการอ่านโค้ด ไม่ใช่ผลการทดสอบ**

| ข้อความใน backlog | โค้ดปัจจุบัน | สิ่งที่ยังเหลือ |
|---|---|---|
| `:54-55` "refresh tokens are still not rotated on use" | มี rotation ที่ `backend/src/routes/auth.routes.js:366-374` | replay detection ยังไม่มี → RR-02; ฝั่ง frontend ยังไม่เก็บใบใหม่ → RR-03 |
| `:56-57` "embedded export/import endpoints in school/admin/affiliation/province still uncovered" | มี `backend/src/middleware/rateLimiters.js` และผูกแล้วที่ `school.routes.js:1273,1345,1424,1741,1765,1811`, `admin.routes.js:604,986`, `province.routes.js:188`, `affiliation.routes.js:420,483,517` | `affiliation.routes.js:546` ยังไม่ผูก → RR-04 |
| `:59-60` "CSP added as mitigation" | CSP มีจริงที่ `frontend/index.html:15` | ยังอนุญาต `'unsafe-inline'`/`'unsafe-eval'` → RR-07 |
| `#7` เดิม (access token ถูก invalidate เมื่อเปลี่ยนรหัสผ่าน) | บังคับทั้งฝั่ง access token ทุก request (`backend/src/middleware/auth.js:88-93`) และฝั่ง refresh (`auth.routes.js:355-362`) พร้อม backfill `password_changed_at` ที่ `backend/migrations/043_password_changed_at_backfill.sql:10-16` | — |
| `:58` "Export streaming — report/CSV/Excel still buffer the full dataset in memory" | ยังตรงกับโค้ดปัจจุบัน | → RR-05 |
| `:65-66` "existing weak passwords not force-rotated" | ยังตรงกับโค้ดปัจจุบัน | → RR-06 |

## 5. หลักฐานที่ทะเบียนนี้ยังไม่มี

execution plan บรรทัด 299 กำหนด exit evidence ของ A1-5 ไว้ว่าต้องรัน `securityEnv` (unit) และ `authSessionHardening`, `securityHardening` (integration) แล้วไม่มี test ล้มเหลว พร้อมกับให้มีรายการ localStorage token ในเอกสารฉบับนี้ สถานะที่อ่านได้จากไฟล์ทดสอบในเครื่อง:

| รายการ | สิ่งที่พบ |
|---|---|
| `backend/tests/securityEnv.test.js` | describe block ครอบ LINE webhook signature, `getMissingProductionSecrets`, progressive deployment policy, `validateEnvOrExit` (`:29,82,119,173`) — ไม่มี assertion เรื่อง token rotation/replay, export limit หรือ legacy password |
| `backend/tests/authSessionHardening.test.js` | มี describe block เดียวคือ forced password-change enforcement (`:46`) |
| `backend/tests/securityHardening.test.js` | import batch tenant isolation, path-traversal guard, PII masking (`:21,34,49`) |
| การทดสอบ refresh token | ทั้ง repository มีเฉพาะ `backend/tests/auth.test.js` ที่เรียก `/api/auth/refresh-token`; `:140-154` ตรวจเพียงว่าได้ `access_token` ใหม่ ไม่ได้ตรวจว่าได้ `refresh_token` ใหม่และไม่ได้ตรวจว่าใบเดิมถูกเพิกถอน; `:165-186` ตรวจเส้นทาง logout → reuse → 401 เท่านั้น |
| การทดสอบ rate limit ของ export | ค้นหา `exportFormatLimiter` และ `importExportLimiter` ใน `backend/tests` ไม่พบผลลัพธ์ — ไม่มีไฟล์ทดสอบที่ยืนยันว่า route export **รายตัว** ผูก limiter ครบ (ช่องที่ RR-04 พูดถึง); ที่มีคือ `backend/tests/appRateLimitOrder.unit.test.js:24-93` ซึ่งตรวจการต่อ limiter **ระดับ mount** (รายการ prefix ของ global limiter, ลำดับ mount ที่ต้องอยู่ก่อน router ที่มันคุ้มกัน และ `/api/reports` ต้องมี limiter เฉพาะของตัวเอง) |

จึงยังไม่มีหลักฐานเชิงทดสอบรองรับรายการใน §3 และเอกสารฉบับนี้ **ไม่ใช่** หลักฐานตาม exit evidence ของ A1-5

## 6. สิ่งที่ตรวจสอบจากเครื่องนี้ไม่ได้

| รายการ | เหตุผล |
|---|---|
| ค่า `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` ที่ตั้งจริงบน production | เป็น environment variable บนเซิร์ฟเวอร์ ไม่อยู่ใน repository (`backend/src/config/env.js:170-174`) และห้ามเข้าถึง production |
| จำนวนบัญชีที่ยังใช้รหัสผ่านตั้งต้นจากการย้ายข้อมูล | ต้องอ่านฐานข้อมูลจริง ซึ่งเป็นข้อมูลจริงและอ่านได้แบบ read-only aggregate เท่านั้นตาม `docs/project-closure/notes.md:13` |
| cron ล้าง `revoked_tokens` 03:00 ทำงานจริงหรือไม่ | มีเฉพาะที่เอกสารกำหนดไว้ (`docs/OPERATOR_RUNBOOK.md:15`, `CLAUDE.md:722-732`) ต้องให้ operator ยืนยันบนเซิร์ฟเวอร์ |
| nginx ส่ง header `Content-Security-Policy` หรือไม่ | ตัวอย่างใน `docs/deployment-hardening.md:74` ยังเป็น comment; config จริงอยู่บนเซิร์ฟเวอร์ |
| ระบบรันกี่ instance จริง | ต้องดูจาก PM2 บนเซิร์ฟเวอร์ (RR-08 อ้างข้อนี้) |
| production เสิร์ฟหน้า SPA ด้วย nginx หรือด้วย Express เอง | โค้ดรองรับทั้งสองทาง — `backend/src/app.js:238-245` เสิร์ฟ `frontend/dist` เมื่อ `NODE_ENV=production` ส่วน `docs/deployment-hardening.md:69` ระบุว่า nginx เป็นผู้เสิร์ฟ; ต้องดู config จริงบนเซิร์ฟเวอร์ (มีผลต่อขอบเขตของ helmet ใน RR-07) |
| ขนาดชุดข้อมูล export จริงและผลกระทบต่อหน่วยความจำ | ต้องมีผลรัน load test ซึ่งยังไม่มี (execution plan §1, A1-8 บรรทัด 131, B3-1 บรรทัด 175) |

## 7. ค่าที่เว้นว่างเพราะรอ decision

ห้ามเติมค่าในตารางนี้ก่อนได้คำตอบตาม `docs/project-closure/execution-plan-to-completion-2026-09-04.md` §4.1 และ §4.2 การเดาค่าจะไหลเข้า test, export metadata และ evidence ก่อนที่ใครจะทันตรวจ

| ช่องที่เว้นว่าง | ใช้ใน | รอ |
|---|---|---|
| ระดับความรุนแรงของทุกรายการ (RR-01…RR-08) | จัดลำดับงานแก้และ defect triage | **C0-13** |
| ชื่อจริงของผู้รับความเสี่ยงทุกช่อง | §8 และช่องลงนามในชุดปิดโครงการ | **C0-7** |
| ชุดข้อมูลและฐานทางกฎหมายที่ได้รับผลกระทบเมื่อ token หลุด | RR-01 | **D0-2**, **D0-3** |
| การจำแนกว่าไฟล์ export เป็นข้อมูลส่วนบุคคลหรือไม่ และ retention ของไฟล์ | RR-04, RR-05 | **D0-2**, **D0-8** |
| ขอบเขตบัญชีที่ต้องบังคับหมุนรหัสผ่าน | RR-06 | **C0-4** |
| หน้าต่างเวลาสำหรับบังคับหมุนรหัสผ่านและงานที่ต้อง deploy | RR-06 และงานแก้ทุกข้อ | **C0-8** |
| ค่า TTL เป้าหมายของ access token | RR-01 | Technical owner กำหนด (ชื่อจริง **รอ C0-7**) ผ่าน change approval ตาม **C0-13** |

## 8. ช่องบันทึกการตัดสินใจ

ห้ามให้ทีมเทคนิคหรือเครื่องมืออัตโนมัติกรอกตารางนี้ ผู้มีอำนาจตามที่แต่งตั้งใน C0-7 เป็นผู้กรอกเท่านั้น และการที่ validator ผ่านไม่ถือเป็นคำตอบของข้อใด

| รหัส | ผลการตัดสิน | เงื่อนไขที่แนบมากับการตัดสิน | ผู้ตัดสิน | ตำแหน่ง | วันที่ |
|---|---|---|---|---|---|
| RR-01 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-02 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-03 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-04 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-05 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-06 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-07 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |
| RR-08 | ☐ ยอมรับ ☐ ไม่ยอมรับ ☐ ให้แก้ก่อน | | | | |

การตัดสินของ DPO/legal ต่อ RR-01 อยู่ในขอบเขตของ C2-2 (execution plan บรรทัด 164) และลายเซ็นรับความเสี่ยงอยู่ใน C3-4 (บรรทัด 181) — เอกสารฉบับนี้เป็นข้อมูลประกอบการตัดสินเท่านั้น ไม่ใช่ตัวลายเซ็น
