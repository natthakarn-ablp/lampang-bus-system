# แผนดำเนินการให้เสร็จ (Execution Plan To Completion) — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **แผนปฏิบัติจากจุดที่อยู่จริงไปถึง System Acceptance และ Project Closure** — ต่อยอดจาก `master-project-closure-plan.md` โดยไม่เปลี่ยน Phase/Exit gate เดิม แต่ระบุว่า *ใครทำอะไร เมื่อไร ต้องมีอะไรก่อน และหลักฐานอะไรถือว่าเสร็จ*

---

## 1. จุดตั้งต้นที่ยืนยันได้

| รายการ | ค่า |
|---|---|
| Release candidate (RC) | `cef4bd1` บน `feat/tracking-security-hardening` (ยังไม่ push, ยังไม่ deploy) |
| Production | `0060c3e` — ตามหลัง RC 15 commits; migration 050 ยังไม่ apply |
| Automated readiness | **อ่านค่าจริงจาก report ล่าสุดเสมอ** — `outputs/automated-readiness/<run>/summary.md` และ `manifest.json` (`totals.pass/pending/fail`) ห้าม hardcode ตัวเลขในเอกสารนี้ ค่าจะเปลี่ยนทุกครั้งที่ gate/หลักฐานเปลี่ยน |
| Closure board | **อ่านค่าจริงจาก** `outputs/go-live-closure-status/<run>/summary.md` (Owner Board + Next Actions) |
| Readiness scorecard | 80% (2026-08) — เหลือ UAT จริง + restore drill + อนุมัติ deploy |
| หลักฐานเทคนิคล่าสุด | 1,237 tests ผ่านบน MySQL 8 จริง (sandbox), migration 050 apply/rollback สะอาด, production ไม่เปลี่ยน |

สิ่งที่ **ยังไม่มีเลย** (ไม่ใช่แค่ยังไม่ผ่าน): frontend ของ participation workflow, ผลรัน load test จาก environment ที่ใช้ปิด capacity gate (ตัว suite มีแล้วที่ `backend/scripts/load-test.js`), staging, บัญชี UAT ทดสอบ, evidence pack ทุกชนิด, ลายเซ็นทุกใบ

## 2. หลักการวางแผน

1. **สี่เลนขนานกัน** — A (Automated: ทีมเทคนิค/Codex ทำได้เลย), B (Sandbox/External: ต้องมีเครื่อง/บริการ/หน้าต่างเวลา), C (Owner/Product decision), D (DPO/legal decision) เลน A ห้ามหยุดรอเลน C/D ถ้ามีงานที่ไม่ขึ้นกับการตัดสินใจ — แต่ถ้าขึ้นกับ ต้องรอ ห้ามเดาแทน
2. **Critical path คือเลน C/D ไม่ใช่เลน A** — งานเทคนิคที่เหลือประมาณ 4–5 สัปดาห์คน แต่ UAT/DR/sign-off ขึ้นกับคนจริงและ maintenance window
3. **RC เดียวตลอดทาง** — ทุก evidence ต้องอ้าง commit เดียวกัน ถ้า RC เปลี่ยนหลัง UAT เริ่ม ต้องรัน regression + regenerate bundle ใหม่
4. **ไม่ปลอมหลักฐาน** — validator ผ่านแบบ `--allow-pending` ใช้ได้ระหว่างทาง แต่ชุดปิดโครงการ (§12 ของ master plan) ห้ามใช้
5. **แยก automated evidence กับ human gate ให้ขาด** — งานที่ต้องอาศัยลายเซ็น การอนุมัติ หรือผู้ใช้จริง อยู่ใน §14 และห้ามอ้าง validator/report ใด ๆ เป็นหลักฐานว่าเสร็จ (validator ตรวจได้แค่ว่า "ช่องยังว่าง" ไม่ได้ตรวจว่า "คนอนุมัติแล้ว")
6. **เป้าหมายเวลาเป็น optimistic lower bound** — วันที่ในเอกสารนี้คือกรณีที่ decision ทุกข้อมาตรงเวลา, staging/LINE test channel ได้ตามขอ, และ UAT ไม่พบ Critical/Major ดู §10.1 สำหรับ contingency

## 3. ภาพรวม Timeline

| Wave | ช่วง (optimistic) | เป้าหมายหลัก | Phase ที่ปิด/ขยับ |
|---|---|---|---|
| **0 — Unblock** | 4–11 ก.ย. 2569 | ได้ Owner + DPO decisions, deploy RC, ตั้ง sandbox | 0 (C/D), 1 (rebaseline + deploy), เริ่ม 2/4/7 |
| **1 — Build** | 12–25 ก.ย. | ปิดงานเทคนิคที่ไม่ต้องรอใคร | 2, 4 (UI), 5, 6 (report), 7 (code) |
| **2 — Simplify + Prepare** | 26 ก.ย.–9 ต.ค. | เมนูตาม IA ที่อนุมัติ, เตรียม UAT/staging | 3, 8 (prep), 9 (staging), 6 (เริ่ม), 11 (prep) |
| **3 — Prove** | 10–23 ต.ค. | UAT ทุกบทบาท, load test, DR drill | 8, 9, 10, 6, 7 (sign-off) |
| **4 — Accept** | 24–31 ต.ค. | คู่มือ/อบรม, validators strict, ลงนาม | 11, hard gates ทั้งหมด → **System Acceptance** |
| **12A — Rollout** | พ.ย. 2569–มี.ค. 2570 | pilot → ขยาย wave ตามเทอม 2/2569 | 12A, 13 (เก็บข้อมูล) |
| **12B — Expand** | พ.ค.–ก.ย. 2570 (เทอม 1/2570) | ขยาย driver check-in/shift, parent LINE, ทีละ advanced feature | 12B, 13 (เปรียบเทียบกับ 12A) |
| **Hypercare + Closure** | 30 วันหลัง wave สุดท้ายของ scope ที่รับรอง | ส่งมอบ ลงนามปิดโครงการ | 14 |

**31 ตุลาคม 2569 เป็น optimistic lower bound ไม่ใช่กำหนดส่ง** — ดู §10.1 เงื่อนไขที่ทำให้เลื่อนและช่วงเวลาสำรอง

Phase 12B (เทอม 1/2570) อยู่ในเอกสารนี้เพื่อกำหนด gate และผู้รับผิดชอบไว้ล่วงหน้า แต่ **ไม่อยู่ในเงื่อนไขของ System Acceptance** — โครงการปิด scope 12A ได้โดยไม่ต้องรอ 12B เว้นแต่ owner กำหนดใหม่เป็นลายลักษณ์อักษร

## 4. Wave 0 — Unblock (4–11 ก.ย. 2569)

จุดประสงค์: เอาสิ่งที่ block งานทุกเลนออกให้หมดในสัปดาห์เดียว

### 4.1 เลน C — การตัดสินใจของ Owner/Product ที่ต้องได้ภายใน 11 ก.ย.

| # | คำถาม | ผู้ตัดสิน | ถ้าไม่ตอบ จะ block อะไร |
|---|---|---|---|
| C0-1 | Rollout แรกใครเช็กเด็ก: บัญชีโรงเรียนเต็ม หรือครู grade scope; นิยาม check-in/out, absent, leave, override, void | Product owner + ผู้แทนโรงเรียน | Phase 5 logic tests, Phase 3 เมนู driver/school, UAT script |
| C0-2 | เจ้าของอนุมัติ transfer / vehicle request / roster-registration / inspection — ระดับเดียว ไม่ซ้ำ queue | Product owner + ต้นสังกัด | Phase 3 request queues, Phase 4 event embedding (A1-2), A0-4 |
| C0-3 | Target IA ต่อบทบาทตาม `role-menu-participatory-research-audit-2026-09-04.md` — อนุมัติ/แก้ | Product owner | Phase 3 ทั้งหมด, A0-4 (ตำแหน่งเมนู) |
| C0-4 | Feature ที่ `accept` / `pilot` / `defer` จาก 10 flags: ADMIN_PASSWORD_RECOVERY, DRIVER_REGISTRATION, DRIVER_SHIFT_SELECTION, ETA, GEOFENCE, PARENT_CONSENT_REQUIRED, PARTICIPATION_CASES, **QR_LEVEL3** (`FEATURE_QR_LEVEL3`), ROUTE_DEVIATION, VEHICLE_QR — พร้อมยืนยัน Core scope และ pilot scope | Project owner | ขอบเขต UAT, คู่มือ, DPO decision, A1-2 (ถ้า PARTICIPATION_CASES = defer) |
| C0-5 | คำตอบ **18 role gates** ใน `decision-package-account-recovery-roles-2026-09-04.md` (6 บทบาท × 3 gate: province/affiliation/transport/school/driver/parent) โดยเฉพาะ `driver_username_is_person_or_vehicle` และ `multi_shift_vehicle_requires_separate_accounts_or_school_approval` สำหรับคนขับที่ login ด้วยทะเบียนรถ | Project owner + ฝ่ายทะเบียน (+ DPO ตาม §7 ของ decision package) | Phase 5 recovery ทุกบทบาท (A1-4), hard gate "account recovery ทุก role" |
| C0-6 | นิยาม "การบริหารแบบมีส่วนร่วม", **กรอบทฤษฎี**, คำถามวิจัย, ประชากร/กลุ่มตัวอย่าง, **ตัวแปร**, เครื่องมือ, pre/post window; ผู้ปกครอง/นักเรียน/ครูย่อย/**ผู้เข้าประชุม** อยู่ใน population หรือเป็น external evidence | Research lead + อาจารย์ที่ปรึกษา | Phase 2 dictionary (A0-3), A1-1 (`period` ใน export metadata), Phase 13 baseline freeze |
| C0-7 | แต่งตั้งชื่อจริง: Project owner, Product owner, Technical owner, Operator, Data owner, UAT lead, Research lead, DPO | ผู้มีอำนาจหน่วยงาน | ทุกช่องลงนาม |
| C0-8 | Maintenance window สำหรับ deploy RC และ DR drill (อย่างน้อย 2 หน้าต่าง) | Operator + Owner | Phase 1 deploy, Phase 10 |
| C0-9 | คำขอรายชื่อ legacy: ยังมีภาระงานค้างที่ต้องรักษา หรือรวมกับ Driver Registration ได้ — ถ้ามีงานค้าง ต้องเคลียร์ก่อนซ่อน legacy ตาม master plan Phase 3 | Product owner + ผู้แทนโรงเรียน | A2-1 (Driver/School menu merge) — ห้ามรวม queue ก่อนได้คำตอบ |
| C0-10 | Province readiness เป็นงานประจำของจังหวัด หรือเป็นหน้าสำหรับ Project owner/Operator เท่านั้น (ตัดสินว่าย้ายไป secondary governance หรือไม่) | Product owner + ผู้แทนจังหวัด | A2-1 แถว Province, C0-3 |
| C0-11 | เกณฑ์ "พร้อมประเมิน": metric coverage กี่เปอร์เซ็นต์, external evidence ชนิดใดนับ, minimum observation period เท่าใด | Research lead + Product owner | A1-1 exit gate ("ไม่มี PASS จาก heuristic") ตัดสินไม่ได้ถ้าไม่มีเกณฑ์ — ห้ามทีมเทคนิคตั้งเกณฑ์เอง |
| C0-12 | ผู้ปกครอง/ครู ส่ง feedback/ข้อเสนอ **ในระบบ** หรือเก็บผ่าน **เครื่องมือวิจัยภายนอก** | Product owner + Research lead + DPO | A1-2b (parent/teacher feedback channel), Phase 13 external evidence |
| C0-13 | Change governance: issue workflow, severity scheme, change approval authority และ release freeze policy (ใครอนุมัติการแก้หลัง freeze, freeze เริ่ม/สิ้นสุดเมื่อใด) | Project owner + Technical owner | A3-1 (defect triage), A4-1 (ประกาศ change freeze), กติกา RC3 freeze ใน §6 |

### 4.2 เลน D — การตัดสินใจของ DPO/legal ที่ต้องได้ภายใน 11 ก.ย.

ทั้งหมดมาจาก `docs/pdpa-consent-and-data-confirmation-plan.md` §3 และ Phase C0 เอกสารนั้นระบุชัดว่าเป็น **prerequisite** ไม่ใช่งานตามหลัง จึงต้องอยู่ใน Wave 0 ไม่ใช่ Wave 2/3

| # | การตัดสินใจ | ผู้ตัดสิน | ถ้าไม่ตอบ จะ block อะไร |
|---|---|---|---|
| D0-1 | ระบุ **controller / processor** ของระบบและของแต่ละหน่วยงานที่เข้าใช้ | DPO/legal + Project owner | ทุก consent/notice text, ข้อความ privacy notice ในคู่มือ |
| D0-2 | **Data inventory + purpose** ต่อชุดข้อมูล (นักเรียน ผู้ปกครอง คนขับ ยานพาหนะ GPS LINE identity participation comments) | DPO/legal | A1-7, A1-12, D0-3 |
| D0-3 | **Lawful basis รายวัตถุประสงค์** รวมข้อขัดแย้งที่ระบุไว้: `/api/parent/children` คืนรายชื่อบุตรหลานก่อน consent gate ขณะที่ status/history/ETA มี gate — ต้องตัดสินว่าใช้ฐานใดและบังคับ gate ให้สอดคล้อง | DPO/legal | A1-6 (parent endpoint gate), A1-2b |
| D0-4 | จำแนกทุกแถวใน Matrix §4 ของ PDPA plan ว่าเป็น **Consent / Acknowledgement / Certification** | DPO/legal | A1-6, A1-7 (หน้ารับรองข้อมูล), schema ของตาราง acknowledgement/certification |
| D0-5 | อนุมัติ **ข้อความไทย ฉบับย่อ/เต็ม + เวอร์ชัน + กติกา hash** ที่จะเก็บใน `notice_version`/`notice_hash`/`text_snapshot` | DPO/legal | A1-6, A1-7 — ห้าม implement UI ด้วยข้อความ draft |
| D0-6 | **ผลเมื่อถอนความยินยอม** รายวัตถุประสงค์ และข้อมูลที่ยังประมวลผลด้วยฐานอื่นได้ต่อ | DPO/legal | A1-6 withdrawal cascade (QR/ParentStatus/LIFF/LINE/report/export) |
| D0-7 | **Canonical parent consent type** — `parent_tracking_optin` vs `qr_parent_optin` และ migration/compatibility plan | DPO/legal + Technical owner | A1-6, migration ของ consent records |
| D0-8 | **Retention period ต่อชุดข้อมูล และสิทธิ์เจ้าของข้อมูล** (เข้าถึง/แก้ไข/ลบ/คัดค้าน/พกพา) พร้อมช่องทางและ SLA | DPO/legal | A1-12 (retention/archival/data-subject request workflow), A2-6 (ช่องทางในคู่มือ) |

รูปแบบ: ทีมเทคนิคจัดทำ **decision register** (`docs/project-closure/decision-register.md`) ที่มีคำถาม ทางเลือก ผลกระทบ และช่องลงชื่อ/วันที่ — ผู้ตัดสินตอบในเอกสารนั้นเท่านั้น ห้าม Codex กรอกแทน และห้ามถือว่า "validator ผ่าน" เป็นคำตอบของข้อใด

### 4.3 เลน A — งานเทคนิคที่เริ่มได้ทันที

"เริ่มได้ทันที" หมายถึง **ส่วนที่ไม่ขึ้นกับคำตอบของเลน C/D เท่านั้น** ถ้า task ใดมีส่วนที่ต้องใช้คำตอบ (A0-3 ต้องใช้ C0-6/C0-11, A0-4 ต้องใช้ C0-2/C0-3/C0-4) ให้เว้นช่องนั้นไว้ว่างพร้อมหมายเหตุว่ารอ decision ข้อใด **ห้ามเติมค่าเองแล้วค่อยแก้ทีหลัง** เพราะค่าที่เดาไว้จะไหลเข้า test, export metadata และ evidence ก่อนที่ใครจะทันตรวจ

| # | งาน | ผลลัพธ์/หลักฐาน |
|---|---|---|
| A0-1 | Push `cef4bd1` ไป origin; เปิด PR/ตรวจ diff `0060c3e..cef4bd1` เป็น release note | `CHANGELOG.md` อัปเดต, PR link |
| A0-2 | สร้าง decision register จาก C0-1…C0-13 และ D0-1…D0-8 พร้อม impact analysis ต่อข้อ | `docs/project-closure/decision-register.md` |
| A0-3 | Phase 2: เขียน metric/data dictionary จาก `researchReadiness.service.js` + `measurementFramework.js` (สูตร, ตัวหาร, missing-data rule, freshness, version) และแยก namespace ของ operational KPI / participation KPI / research outcome / external evidence ไม่ให้ปะปน — **ช่อง `research_period` และ `population` ปล่อยว่างรอ C0-6 ห้ามเติมเอง** | `docs/research/metric-dictionary.md` + unit test ที่ fail ถ้า metric ใดไม่มี dictionary entry |
| A0-4 | Phase 4: ออกแบบ participation inbox/dashboard UI spec (หน้าเดียวรวมทุก role) — **ระบุ queue structure และผู้ทำ ASSIGNED/DECIDED เป็นตัวแปรที่รอ C0-2, ตำแหน่งเมนูรอ C0-3, และทั้ง spec รอ C0-4 ยืนยันว่า PARTICIPATION_CASES ไม่ถูก defer** | `docs/project-closure/participation-ui-spec.md` ที่ระบุจุดรอ decision ไว้ชัด |
| A0-5 | Phase 7: refresh-token rotation + replay detection, export rate-limit ให้ครอบทุก export route, export streaming สำหรับชุดใหญ่ | code + tests; ไม่แตะ policy ของ localStorage token (ดู A1-5) |
| A0-6 | ตั้ง local staging: `docker-compose` MySQL 8 + synthetic data generator (masked จาก schema ไม่ใช่จาก production) | `backend/scripts/seed-synthetic-staging.js`, README |
| A0-7 | Phase 11 prep: content audit คู่มือทั้ง 8 เล่มเทียบ feature flags/เมนูรุ่น RC ติดป้ายส่วนที่ล้าสมัย | `docs/manual-audit/rc-content-audit-2026-09.md` |
| A0-8 | Phase 1: สร้าง Current Status ฉบับเดียวจาก production commit และติดป้าย `historical` ให้เอกสาร snapshot เก่าที่ขัดกัน | `docs/project-closure/current-status-<rc>.md` + รายการเอกสารที่ติดป้าย |
| A0-9 | Phase 1: secret/PII scan ของ source, diff, reports และ evidence (ไม่ใช่เฉพาะ UAT evidence) | `outputs/automated-readiness/<run>/logs/secret-scan-*.log` FAIL = 0 |
| A0-10 | Phase 1: บันทึก baseline menu counts, API inventory และ usage aggregate **ก่อน** ปรับเมนู เพื่อให้ C3-1 วัด before/after ได้ | `docs/audit/menu-baseline-<rc>.md`, `outputs/rbac-matrix/<run>/` |
| A0-11 | Phase 1: dump feature-flag whitelist ทั้ง 10 flags แบบไม่แสดง secret เป็นหลักฐานแยก | `outputs/operator-gates/<run>/feature-flags.redacted.log` (สร้างโดย operator ใน B0-1) |
| A0-12 | Phase 1: สร้างโครง evidence folder ของ RC พร้อม timestamp/checksum | `outputs/phase9-evidence/<run>/manifest.json` |
| A0-13 | Phase 1 rebaseline run: unit/integration tests, frontend build, UI label/hybrid guard, migration baseline และ dependency/security audit บน RC ที่ deploy แล้ว | `bash scripts/production-readiness-gate.sh local` → `fail=0` และ `warn=0` |

### 4.4 เลน B — Operator (ในหน้าต่างเวลาที่ได้จาก C0-8)

| # | งาน | คำสั่ง/หลักฐาน |
|---|---|---|
| B0-1 | Production read-only gate บนเซิร์ฟเวอร์ + ตรวจ timezone/cron/disk/RAM/swap/certificate + feature-flag whitelist | `bash scripts/production-readiness-gate.sh production` → `outputs/operator-gates/<run>/production-gate.redacted.log` |
| B0-2 | อนุมัติแล้ว deploy RC ตาม runbook + apply migration 050 (มี rollback ที่พิสูจน์แล้ว) | `SCHOOLBUS_DEPLOY_APPROVED=true`, postdeploy gate, `/health.data.commit == cef4bd1` |
| B0-3 | Monitor 30–60 นาทีหลัง deploy | `create-operator-gate-evidence-pack.js` → validator ผ่าน |

**Exit Wave 0:** decision register ตอบครบ C0-1…C0-13 และ D0-1…D0-8 (หรือระบุวันตอบที่ผูกกับ §10), RC บน production, operator-gate evidence pack แรกผ่าน validator

## 5. Wave 1 — Build (12–25 ก.ย.)

งานเทคนิคที่ปิดได้โดยไม่ต้องรอ UAT — ทุกข้อจบด้วย test + evidence และรวมใน RC ถัดไป (`RC2`)

| # | Phase | ต้องมีก่อน | งาน | Exit evidence |
|---|---|---|---|---|
| A1-1 | 2 | **C0-6 + C0-11** | ปิด dictionary/freshness/allowlist ให้ครบ; ลบทุกข้อความ "พร้อมประเมิน" ที่มาจาก raw count และแทนด้วยเกณฑ์จาก C0-11; ยกเลิก `dme_mie_ready: true` แบบ hardcode; export research metadata (version, period จาก C0-6, query hash) | Phase 2 exit gate: ไม่มี PASS จาก heuristic; test ป้องกัน regression |
| A1-2 | 4 | **C0-2 + C0-3 + C0-4** | สร้าง participation inbox + case detail + aggregate dashboard (behind `FEATURE_PARTICIPATION_CASES`); ฝัง event ใน emergency / vehicle request / transfer / roster / inspection / policy decision; เก็บ field ครบตาม master plan (ผู้ริเริ่ม ผู้เข้าร่วม ทางเลือก มติ เหตุผล ผู้รับผิดชอบ SLA ผลลัพธ์ การแจ้งผลกลับ) | sandbox: 1 workflow ต่อ role เดินครบ SUBMITTED→FEEDBACK_SENT→CLOSED; cross-scope tests; append-only test |
| A1-2b | 4 | **C0-12 + D0-3 + D0-4** | Parent/teacher feedback channel ตาม scope ที่ owner/DPO อนุมัติ — ถ้า C0-12 เลือก "เครื่องมือภายนอก" ให้บันทึกเป็น defer พร้อม owner/date และ **ไม่ต้องสร้างในระบบ** | UI + tests หรือบันทึก defer ที่ owner ลงนาม |
| A1-3 | 5 | **C0-1 + C0-2** | Role-to-route/API/write-action matrix ฉบับ RC2 (จาก `outputs/rbac-matrix` + router graph) และ regression tests ต่อ Logic decision C0-1/C0-2; ยืนยัน server-side scope ทุก query/write action | matrix ใน `docs/audit/`, tests ผ่าน |
| A1-4 | 5 | **C0-5 (18 gates)** | Account recovery ครบทุกบทบาทตามคำตอบ C0-5; parent LINE re-link flow; ตั้ง `gatesConfirmed` เฉพาะบทบาทที่ตอบครบ | tests + UAT script ต่อบทบาท; diff ของ `accountRecoveryPolicy.js` อ้าง decision package |
| A1-5 | 7 | — | ปิด: refresh-token rotation/replay, export rate-limit/streaming, legacy weak-password forced rotation; จัดทำ **risk-acceptance draft สำหรับ localStorage token โดยคง JWT ตาม CLAUDE.md §12 ข้อ 3** (ดู §5.1) | security tests, `docs/security/residual-risk-register.md` |
| A1-6 | 7 | **D0-3 + D0-4 + D0-5 + D0-6 + D0-7** | ปิดช่องว่าง consent: ParentStatus consent UI, `/api/parent/children` gate ตาม D0-3, feature dependency กันเปิด parent consent โดยไม่มีช่องทาง, canonical consent type ตาม D0-7 พร้อม migration, withdrawal cascade ตาม D0-6 (QR/ParentStatus/LIFF/LINE/report/export) | tests ต่อ cascade ทุกช่องทาง; ข้อความใน UI ตรงกับเวอร์ชันที่ D0-5 อนุมัติ |
| A1-7 | 6 | **D0-2 + D0-4 + C0-1 + C0-2** | Aggregate data-quality score + รายงาน duplicate/orphan/mapping โดยไม่ export PII; หน้ารับรองข้อมูลต่อบทบาทตามการจำแนกใน D0-4 | `docs/data/data-quality-report-<ts>.md` แบบ aggregate; certification schema append-only + tests |
| A1-8 | 9 | A0-6 | รัน `backend/scripts/load-test.js` บน local staging ramp 50/200/500/1,000 — **ติดป้าย "local, ไม่เทียบเท่า production"** ใช้หา bottleneck ก่อน staging จริง | `outputs/load-test/local-<ts>/` + รายการ index/pool/cache ที่ต้องปรับ |
| A1-9 | 9 | A1-8 | ย้าย in-memory state (lockout / dedup / linking) ไป DB หรือ Redis ตามผล A1-8 | tests; single-instance caveat ถูกลบจาก backlog |
| A1-10 | 5 | — | Import preview / apply / rollback validation ใน sandbox ครบทุกโหมด รวม reports, Thai date/time และ audit | tests: `importPreviewWiring`, `importApplyModes`, `importRollback` + evidence จาก sandbox |
| A1-11 | 7 | A1-3 | Threat / RBAC / IDOR / cross-scope review ทุกบทบาท รวม research export และ participation workflow | `docs/security/threat-rbac-idor-review-<rc>.md` + negative tests ต่อ finding |
| A1-12 | 6 | **D0-8** | Correction / transfer / retention / archival / data-subject request workflow: กำหนดขั้นตอน ผู้รับผิดชอบ SLA และช่องทาง แล้ว implement ส่วนที่เป็นระบบ | `docs/data/retention-and-data-subject-requests.md` + tests ของ workflow ที่ implement |
| A1-13 | 7 | **D0-1…D0-8** | DPIA + incident playbook สำหรับ 4 สถานการณ์: ข้อมูลเด็ก, LINE ส่งผิดคน, export หลุด, participation comments | `docs/security/dpia-<rc>.md`, `docs/ops/incident-playbook.md` (DPO ลงนามใน C3-4) |
| B1-1 | 7 | C0-8 | หมุน secrets ที่ครบกำหนด (JWT secret, LINE channel secret/token, DB password) โดยไม่บันทึกค่าใน git/evidence | `docs/ops/secret-rotation-log.md` แบบไม่มีค่า secret + postdeploy gate ผ่านหลังหมุน |

### 5.1 localStorage token — คงสถาปัตยกรรม JWT ไว้

`CLAUDE.md` §12 ข้อ 3 กำหนดว่า **"JWT สำหรับ auth — ห้ามใช้ session/cookie"** ดังนั้น:

- ทางเลือก httpOnly cookie **ถูกเอาออกจาก implementation queue** ไม่มี task ใดในแผนนี้ที่สร้างมันได้
- A1-5 ทำเฉพาะสิ่งที่อยู่ในกรอบเดิม: short TTL + refresh rotation + replay detection และ **บันทึก localStorage residual risk** ลง `docs/security/residual-risk-register.md`
- การจะเปลี่ยนไปใช้ cookie ต้องผ่านลำดับนี้ก่อน และห้ามเริ่มเขียนโค้ดก่อนครบ: (1) Owner + Technical owner อนุมัติ **spec change ของ CLAUDE.md §12 ข้อ 3** เป็นลายลักษณ์อักษร → (2) แก้ CLAUDE.md → (3) ประเมิน CSRF/SameSite/logout/refresh ใหม่ทั้งชุด → (4) เปิด task ใหม่ในแผนรุ่นถัดไป
- C2-2 (DPO review) ตัดสินเฉพาะว่า **ยอมรับ residual risk ของ localStorage ได้หรือไม่** ไม่ใช่เลือกสถาปัตยกรรม auth

**Exit Wave 1:** RC2 tag; full suite ผ่านบน sandbox MySQL; Phase 2 exit gate ผ่าน; Phase 4 closed loop พิสูจน์ใน sandbox; residual security เหลือเฉพาะข้อที่มี risk-acceptance draft

## 6. Wave 2 — Simplify + Prepare (26 ก.ย.–9 ต.ค.)

| # | Phase | เลน | ต้องมีก่อน | งาน | Exit evidence |
|---|---|---|---|---|---|
| A2-1 | 3 | A | **C0-3 + C0-9 + C0-10** | ปรับเมนูตาม IA ที่อนุมัติ: Driver รวม registration/application; School รวมรถ+เพิ่มรถ, roster+registration (เฉพาะเมื่อ C0-9 ยืนยันว่าเคลียร์งานค้างแล้ว), map/live เป็น tabs; Affiliation รวมโรงเรียน+บัญชี, request queues, map/risk; Province รวมเครือข่าย+แผนที่ และย้าย readiness ตาม C0-10; Transport verification+inspection queue เดียว; Admin ~23 → 8 กลุ่ม และรวมหน้าวิจัยเป็น module เดียว | menu inventory ก่อน/หลัง เทียบกับ baseline จาก A0-10 |
| A2-2 | 3 | A | A2-1 | Redirect map สำหรับ old routes (คงอย่างน้อย 1 release) + feature flag ซ่อนก่อนลบ; page/action telemetry แบบไม่มี PII พร้อม retention ตาม D0-8 | `docs/ui/redirect-map.md`, tests deep link/back/permission-denied |
| A2-3 | 3 | A | A2-1 | ตรวจ keyboard/focus/contrast/target size/responsive 390-768-1440 ด้วย browser-review script | `outputs/ui-review/<ts>/` |
| A2-4 | 8 | A | C0-1…C0-5 | สร้างบัญชี sandbox ทุกบทบาทด้วย `seed-production-uat-users.js` บน **sandbox DB เท่านั้น**; UAT script ต่อบทบาท = top tasks + negative + cross-scope + recovery + old-route redirect + participation case | `SCHOOLBUS_UAT_CREDENTIALS_FILE` (นอก git), `docs/uat/scripts/<role>.md` |
| A2-5 | 11 | A | A2-1, A0-7 | Regenerate คู่มือ HTML/PDF + screenshots จาก RC2 บน sandbox; quick guide ต่อ role สอน top tasks | `scripts/build-manual-pdf.sh` ผ่าน; manual audit ไม่มีป้ายล้าสมัย |
| A2-6 | 11 | A | **D0-1 + D0-8 + C0-13** | เพิ่มหัวข้อ troubleshooting, support channel, account recovery, privacy/data-subject request, feedback และ incident channel ลงคู่มือทุกเล่ม | คู่มือมีทั้ง 6 หัวข้อ พร้อมช่องทางจริงและ SLA จาก D0-8 |
| B2-1 | 8 | B | C0-4 | ขอ LINE test channel/LIFF test account จาก provider; ผู้ปกครองทดสอบ = synthetic | LINE test config นอก git |
| B2-2 | 9 | B | งบประมาณ | ตั้ง staging ใกล้ production (VPS ขนาดเดียวกัน, masked/synthetic data) | staging URL + `docs/ops/staging.md` |
| C2-1a | 6 | C | A1-7, A0-6 | **ซ้อมบน sandbox:** Data owner ของโรงเรียน/ต้นสังกัดตัวแทน ทดลองตรวจ/แก้ข้อมูลผ่าน UI บน sandbox ที่มีข้อมูล masked/synthetic ตามรายงาน A1-7 — **นี่คือแหล่ง UAT evidence ของ Phase 6** | ภาพ redacted + delta log จาก sandbox audit trail; รวมใน UAT evidence pack |
| C2-1b | 6 | C | C2-1a, C0-13 | **แก้ข้อมูลจริงบน production:** เฉพาะ Data owner ที่ได้รับมอบหมายจริง แก้ข้อมูลของหน่วยงานตนเองผ่าน production UI เป็นงานประจำภายใต้ change approval ของ C0-13 — **ห้ามใช้บัญชีทดสอบ ห้าม bulk import ห้ามนับเป็น UAT evidence และห้ามถือว่าเป็น write UAT** | delta ใน production audit trail + บันทึกอนุมัติต่อ batch; อ้างเป็นหลักฐาน "data readiness" เท่านั้น |
| C2-2 | 7 | C/D | D0-1…D0-8 | DPO/legal review รอบรวม: ตรวจว่าคำตอบ D0-1…D0-8 ถูก implement ตรงตามที่ตัดสิน, DPIA (A1-13), และ **ยอมรับหรือไม่ยอมรับ residual risk ของ localStorage token ภายใต้สถาปัตยกรรม JWT เดิม** | DPO decision memo ลงนาม |

**Exit Wave 2:** RC3 (freeze สำหรับ UAT ตาม policy ของ C0-13 — หลังจากนี้แก้เฉพาะ Critical/Major); UAT scripts + accounts + LINE test พร้อม; staging ขึ้น; คู่มือตรง RC3 และมีครบ 6 หัวข้อของ A2-6

## 7. Wave 3 — Prove (10–23 ต.ค.)

| # | Phase | เลน | งาน | Exit evidence |
|---|---|---|---|---|
| C3-1 | 8 | C | ผู้แทนจริงทุกบทบาททำ UAT บน sandbox ตาม script; วัด task completion/time/error/help request เทียบ baseline A0-10; เก็บภาพ redacted | `create-uat-evidence-pack.js` → `validate-uat-evidence-pack.js` **strict** ผ่าน, `scan-uat-evidence-safety.js` ผ่าน |
| C3-2 | 8 | C | LINE parent UAT (link, status, notification, consent, withdrawal, re-link) ด้วย test account | ส่วน LINE ใน evidence pack |
| A3-1 | 8 | A | Triage defect รายวันตาม severity/workflow ของ C0-13; แก้เฉพาะ Critical/Major → RC3.x; regression + regenerate bundle ทุกครั้งที่ RC เปลี่ยน | defect log Critical=0, Major=0 |
| B3-1 | 9 | B | Load test บน staging จริง: ramp 50/200/500/1,000, peak, soak 60 นาที; เก็บ p50/p95/p99, error, DB pool, CPU/RAM/swap, event-loop lag, LINE queue | รายงานทำซ้ำได้; ถ้าไม่ผ่านเกณฑ์ (error <1%, read p95 ≤1s, write p95 ≤2s) → ประกาศ limit จริง ไม่อ้าง 1,000 |
| B3-2 | 10 | B | Restore drill ลง `lampang_bus_restore_drill` จาก backup ล่าสุด; พิสูจน์ production aggregate ไม่เปลี่ยน | `create-restore-drill-evidence-pack.js` → validator ผ่าน |
| B3-3 | 10 | B | Controlled reboot ใน maintenance window; PM2/nginx/MySQL/cron กลับภายใน RTO; ทดสอบ rollback code/frontend/flag/migration | operator-gate evidence pack #2 |
| B3-4 | 10 | B | เปิด external uptime/disk/cert/backup alerts; กำหนด RPO/RTO/retention/off-host owner/on-call/restore frequency เป็นลายลักษณ์อักษร | `docs/ops/sla-rto-rpo.md` ลงนาม Operator |
| B3-5 | 10 | B | ตรวจ log rotation, DB/OS timezone, disk threshold และ incident escalation path จริง (ใครถูกเรียก ภายในกี่นาที ช่องทางใด) | `outputs/operator-gates/<run>/ops-hygiene.redacted.log` + escalation matrix ใน `docs/ops/sla-rto-rpo.md` |
| C3-3 | 6 | C | Data owner certification ครบ rollout scope (โรงเรียน → ต้นสังกัด → จังหวัด → ขนส่ง) ผูก term/batch/hash ตาม D0-4 | certification records ใน DB + export aggregate |
| C3-4 | 7 | C/D | DPO ลงนาม residual risk + consent matrix + DPIA (A1-13); owner ลงนาม risk acceptance | เอกสารลงนามใน evidence package |

**Exit Wave 3:** UAT/restore/operator evidence packs ผ่าน validator แบบ strict; capacity report ลงนาม Technical owner + Operator; Critical=0/Major=0; Data + DPO sign-off ครบ

## 8. Wave 4 — Accept (24–31 ต.ค.)

ลำดับใน Wave นี้เป็น **ลำดับบังคับ** เพราะ `A4-2` (ฉบับก่อนหน้าของเอกสารนี้ ปัจจุบันแยกเป็น A4-2a/A4-2b) กับ C4-2 เคยอ้างอิงกันเป็นวงกลม: `A4-2` เดิมต้องรัน validator โดยไม่ใช้ `--allow-pending` ซึ่ง `validate-go-live-signoff.js` จะ FAIL ตราบใดที่ยังไม่มีลายเซ็น ส่วน C4-2 กำหนดให้ลงนามเมื่อ "ไม่มีฟิลด์ค้าง" ซึ่งอ่านได้ว่ารอ validator ผ่านก่อน แผนนี้ตัดวงกลมโดยแยก dry run ออกจาก strict run

| ลำดับ | # | Phase | เลน | งาน | Exit evidence |
|---:|---|---|---|---|---|
| 1 | C4-1 | 11 | C | อบรม admin/จังหวัด/สังกัด/โรงเรียน/ครู/ขนส่ง/คนขับ/ผู้ปกครอง; competency exercise; attendance | Training sign-off |
| 2 | A4-1 | 11 | A | Regenerate คู่มือรอบสุดท้ายจาก RC final; ประกาศ scope/capacity/privacy/change freeze ตาม policy C0-13 | manual audit ผ่าน |
| 3 | **A4-2a** | — | A | **Dry run ก่อนลงนาม:** รันชุด §12 ของ master plan ด้วย `--allow-pending` แล้วพิสูจน์ว่างานที่เหลือ **รอเฉพาะการลงนามและการปรับ scorecard** ไม่มีงานเทคนิคหรือ evidence pack ที่ยังไม่มี | `owner-actions.json` มี `fail = 0` และทุกแถวที่เหลือมี `id` อยู่ในชุดนี้เท่านั้น: `signoff-*`, `approval-*`, `readiness-go-live-signoff`, `readiness-scorecard-overall` (สองรายการหลังมี `category = readiness-verifier` ตาม schema ของ `create-go-live-bundle.js` ไม่ใช่ `signoff`) |
| 4 | **C4-2** | — | C | Owner, Technical owner, Operator, UAT lead, DPO, ตัวแทนหน่วยงานลงนาม System Acceptance โดยดูจากผล A4-2a ไม่ใช่รอ validator ผ่าน | `UAT_SIGNOFF` + `PHASE9_OWNER_OPERATOR_APPROVAL` กรอกครบทุกฟิลด์ (ปัจจุบันค้าง 119) |
| 5 | **A4-2b** | — | A | **Strict run หลังลงนาม:** รันชุด §12 ของ master plan บนเซิร์ฟเวอร์ **โดยไม่ใช้ `--allow-pending`** | ทุก validator PASS, closure status = PASS, action rows = 0 |
| 6 | A4-3 | — | A | Tag release, สร้าง final evidence package ตาม §11 พร้อม checksums | immutable bundle |

**Exit Wave 4 = System Acceptance:** Hard gates §10 ครบทุกข้อ; readiness 100% จาก evidence ที่ validator รับรอง

## 9. Phase 12A, 12B, 13, 14 — หลัง System Acceptance

| ช่วง | # | งาน | Gate |
|---|---|---|---|
| ต้น พ.ย. 2569 | R13-1 | **Baseline freeze** ก่อน intervention ตาม protocol ที่ Research lead อนุมัติ; บันทึก contamination/confounders | Research lead ลงนาม dataset freeze |
| พ.ย. 2569 | P12A-1 | Pilot wave 1: 1–2 โรงเรียน + ต้นสังกัด 1 เขต; โรงเรียนเป็นผู้เช็กเด็กตาม C0-1; LINE เฉพาะ workflow ที่ผ่าน DPO/UAT | Critical=0, Major กระทบ wave=0, monitor ปกติ, owner อนุมัติขยาย |
| ธ.ค. 2569–ก.พ. 2570 | P12A-2 / R13-2 / R13-3 / R13-4 | ขยาย wave 2–3; snapshot ตาม schedule พร้อม freshness/completeness; เก็บ external evidence (แบบสอบถาม/สัมภาษณ์/บันทึกประชุม/workload diary) ตาม consent; เชื่อมหลักฐานระบบกับ participation case ด้วย pseudonymous ID | gate ต่อ wave |
| มี.ค. 2570 | R13-5 | ปิดเทอม; post-measurement ตาม protocol; วิเคราะห์แยก operational / participation / perceived benefit / equity | Research lead รับรอง protocol adherence |
| มี.ค.–เม.ย. 2570 | R13-6 | **Missing-data / sensitivity / triangulation review** และตรวจว่าไม่มีข้อความอ้าง causal effect เกิน design | Research lead + อาจารย์ที่ปรึกษารับรองข้อจำกัด |
| มี.ค.–เม.ย. 2570 | R13-7 | **Reproducible export** พร้อม data dictionary, version, query + checksum และ disclosure review ก่อนเผยแพร่ | export รันซ้ำได้ checksum ตรง; disclosure review ลงนาม |
| พ.ค.–ก.ย. 2570 | P12B-1 | **Phase 12B (เทอม 1/2570):** ขยายคนขับให้ check-in/out/shift ตาม Logic C0-1 และผล 12A | Critical=0, Major กระทบ wave=0, owner อนุมัติ |
| พ.ค.–ก.ย. 2570 | P12B-2 | ขยาย Parent LINE adoption/feedback/notification ตาม policy ที่ DPO อนุมัติ (D0-3/D0-6) | DPO ยืนยันขอบเขต, monitor ปกติ |
| พ.ค.–ก.ย. 2570 | P12B-3 | พิจารณา ETA / geofence / route deviation / QR **ทีละ feature ไม่เปิดรวมกัน** แต่ละตัวต้องมี DPO decision + UAT + rollback flag | เปิดได้เฉพาะ feature ที่มีหลักฐานครบต่อตัว |
| พ.ค.–ก.ย. 2570 | P12B-4 | เปรียบเทียบ KPI, incident, response time, workload และ participation closure กับ Phase 12A | รายงานเปรียบเทียบ 12A/12B |
| 30 วันหลัง wave สุดท้าย | H14-1 / H14-2 / H14-3 | Hypercare: เฝ้าระวังรายวันสัปดาห์แรก→รายสัปดาห์; สรุป incident/support/adoption/data quality/participation closure/uptime/capacity; ปิด Critical/Major และย้าย Minor เข้า maintenance backlog พร้อม owner/date | รายงาน hypercare |
| ประมาณ เม.ย. 2570 (scope 12A) | H14-4 | ส่งมอบ **asset/access**: repository, deployment, secret ownership, DB/backup, LINE Console, domain/DNS, monitoring (ไม่ส่ง secret ผ่าน git) | checklist ส่งมอบลงนามสองฝ่าย |
| ประมาณ เม.ย. 2570 | H14-5 | ส่งมอบ **ความรู้**: architecture, schema, API/RBAC matrix, research/metric dictionary, operator runbook, DR procedure, คู่มือทุกเล่ม และ training records | ผู้รับมอบยืนยันว่าใช้เอกสารทำงานได้จริง (walkthrough อย่างน้อย 1 รอบ) |
| ประมาณ เม.ย. 2570 | H14-6 | Tag final release + immutable closure/research evidence bundle พร้อม checksums | bundle + checksum ตรวจซ้ำได้ |
| ประมาณ เม.ย. 2570 | H14-7 | ยืนยัน operator ประจำ, SLA หลังส่งมอบ, งบประมาณ/renewal (โดเมน, VPS, LINE, certificate) และผู้ดูแลหลังส่งมอบเป็นชื่อจริง | `docs/ops/post-handover-ownership.md` ลงนามโดยผู้มีอำนาจงบประมาณ |
| ประมาณ เม.ย. 2570 | H14-8 | ลงนาม System Acceptance, Dataset Freeze และ Project Closure ตามขอบเขตจริง | Definition of Done §14 ครบ 12 ข้อ |

## 10. กติกาเมื่อเลื่อน (Slip Rules)

| เหตุการณ์ | ผลที่ตามมา | ห้ามทำ |
|---|---|---|
| Phase 0 (C0-*) ตอบไม่ครบภายใน 11 ก.ย. | Wave 1 ทำเฉพาะงานที่ไม่ขึ้นกับคำตอบ: A1-5, A1-8, A1-9, A1-10, A1-11 (บางส่วน), B1-1; **A1-1, A1-2, A1-2b, A1-3, A1-4, A1-6, A1-7 หยุดรอ**; Wave 2–4 เลื่อนวันต่อวัน; ถ้าเกิน 25 ก.ย. pilot 12A หดเหลือ 1 โรงเรียน | เดา Logic แทน owner; ตั้งเกณฑ์ "พร้อมประเมิน" เอง |
| DPO/Research lead ไม่อนุมัติ หรือยังไม่ตัดสิน D0-* | งานที่ผูกกับข้อนั้นหยุด: D0-3/5/6/7 ค้าง → A1-6 หยุด; D0-4 ค้าง → A1-7 หน้ารับรองหยุด; D0-8 ค้าง → A1-12 และ A2-6 หยุด; feature ที่เกี่ยวข้อง flag = off ตอน rollout และย้ายเป็น defer พร้อม owner/date | เปิด feature โดยไม่มี decision; implement UI ด้วยข้อความ consent ฉบับ draft |
| ไม่มี LINE test channel/LIFF test account | C3-2 (LINE parent UAT) เลื่อน; parent LINE workflow ทั้งชุดเป็น **defer** ไม่ใช่ PASS; Phase 12A เปิดเฉพาะ workflow ที่ไม่ใช้ LINE; hard gate "Consent/Acknowledgement ผ่าน UAT" ยังไม่ผ่าน | ทดสอบ LINE ด้วยบัญชีผู้ปกครองจริง; ประกาศว่า LINE พร้อมใช้ |
| staging ไม่มี หรือไม่มีงบประมาณ | B3-1 ทำไม่ได้ → Phase 9 exit gate ไม่ผ่าน → **ห้ามอ้างตัวเลข capacity ใด ๆ** ให้ประกาศเฉพาะผลจาก A1-8 พร้อมป้าย "local, ไม่เทียบเท่า production"; rollout จำกัดที่ pilot ขนาดเล็กจนกว่าจะมี staging | ใช้ผล local staging เป็นหลักฐานปิด capacity gate; ยิง write load ใส่ production |
| Scenario ใดวัดไม่ได้เพราะ rate limit หรือ consent gate (ดู §13.1) | ระบุในรายงานว่า **ไม่ได้วัด** พร้อมเหตุผล; ถ้า `login` วัดไม่ได้ ให้ประกาศว่า capacity ที่รับรองครอบเฉพาะ authenticated traffic หลัง login ไม่รวม login เอง | นับ error rate ของ scenario ที่ถูก throttle รวมเข้ากับ error rate ทั้งชุด; ปิด limiter เพื่อให้ตัวเลขผ่าน |
| Load environment ไม่เทียบเท่า production (CPU/RAM/disk/network ต่างชั้น) | ผล load test ใช้ได้เฉพาะเป็น regression trend; ต้องระบุ delta ของ spec ในรายงาน และประกาศ capacity limit ตามผลจริงคูณ margin ที่ Technical owner ลงนาม | อ้าง 1,000 concurrent users |
| npm registry / `npm audit` ใช้ไม่ได้ | gate แสดง `NOT EVALUATED` และ automated readiness item เป็น **PENDING** ต้องรันซ้ำเมื่อ registry กลับมา ก่อนขึ้น Wave 4 | แก้ผลเป็น PASS; ข้าม dependency audit ในชุดปิดโครงการ |
| Migration หรือ rollback ล้มเหลวใน drill | หยุด deploy ทันที; กลับ RC ก่อนหน้า; หา root cause + เพิ่ม test ก่อนลองใหม่; Phase 10 exit gate ไม่ผ่าน | deploy ต่อโดยหวังว่า rollback จะไม่ต้องใช้ |
| ไม่มี maintenance window ก่อน 23 ต.ค. | Phase 10 ไม่ผ่าน → System Acceptance เลื่อน; pilot ทำได้เฉพาะเมื่อ owner ลงนาม risk acceptance ชั่วคราวเป็นลายลักษณ์อักษร | ข้าม restore drill |
| UAT พบ Major หลัง RC3 freeze | แก้ → RC3.x → regression เต็ม → regenerate bundle/closure ใหม่ทั้งชุด ตาม change approval ของ C0-13 | patch แล้วใช้ evidence เก่า |
| UAT ไม่ผ่าน หรือ training competency ไม่ผ่านในบทบาทใด | บทบาทนั้น **ไม่อยู่ใน accepted scope** ของ rollout รอบนี้; แก้ UX/คู่มือ/อบรมแล้วทดสอบซ้ำ; hard gate "UAT ทุกบทบาท" ยังไม่ผ่าน | ประกาศ System Acceptance โดยข้ามบทบาทนั้นเงียบ ๆ |
| Production incident ระหว่าง Wave 3–4 หรือ hypercare | หยุดขยาย wave; ทำ incident playbook (A1-13); เขียน post-mortem; แก้แล้วรัน regression + regenerate evidence ก่อนกลับเข้าแผน; ถ้าเป็น Critical ให้ถอย RC | ปิด incident โดยไม่มี post-mortem; ขยาย wave ระหว่างยังไม่ปิดสาเหตุ |

### 10.1 Contingency ของกำหนดเวลา

| สมมติฐาน | ถ้าเป็นจริง | ถ้าไม่เป็นจริง (buffer) |
|---|---|---|
| C0-* และ D0-* ตอบครบภายใน 11 ก.ย. | Wave 1 เริ่ม 12 ก.ย. | ทุกวันที่ช้า = เลื่อนทั้งสายวันต่อวัน; ถ้าช้าเกิน 2 สัปดาห์ ให้ตั้งกำหนดใหม่ ไม่บีบ Wave 3 |
| staging + LINE test channel ได้ภายใน 9 ต.ค. | Wave 3 เริ่มตามแผน | +2–4 สัปดาห์ (จัดหา/งบประมาณ) |
| UAT ไม่พบ Critical/Major | Wave 4 เริ่ม 24 ต.ค. | +1–2 สัปดาห์ต่อรอบแก้ + regression + regenerate evidence |
| maintenance window ได้ 2 หน้าต่างก่อน 23 ต.ค. | Phase 10 ปิดใน Wave 3 | +1–3 สัปดาห์ ตามรอบ window ของหน่วยงาน |

**ช่วงที่สมเหตุสมผลสำหรับ System Acceptance: 31 ต.ค. 2569 (optimistic) ถึงประมาณกลางเดือน ธ.ค. 2569 (ถ้า slip 2–3 ข้อพร้อมกัน)** ถ้าเลยกลาง ธ.ค. ให้ทบทวนว่า rollout 12A ยังทันเทอม 2/2569 หรือควรเลื่อนไปเทอม 1/2570 พร้อมกับ 12B

## 11. งานถัดไปทันทีของทีมเทคนิค (ลำดับที่จะทำจริง)

1. `A0-1` push RC + release note — **รอ owner ยืนยันก่อน push**
2. `A0-2` decision register (C0-1…C0-13 + D0-1…D0-8) → ส่งให้ owner/research lead/DPO ภายในวันถัดไป
3. `A0-8` current status + ติดป้าย historical
4. `A0-3` metric dictionary + guard test (Phase 2) — เว้นช่องที่รอ C0-6 ไว้
5. `A0-5` refresh-token rotation, export rate-limit/streaming (Phase 7)
6. `A0-6` local staging + synthetic seed (เตรียม Phase 9)
7. `A0-9` / `A0-10` secret-PII scan + menu/API baseline
8. `A0-4` participation UI spec (ระบุจุดรอ C0-2/C0-3/C0-4)
9. `A0-7` manual content audit
10. `A1-10` import preview/apply/rollback validation
11. `A1-7` data-quality aggregate report → ส่งให้ Data owner เริ่ม C2-1a ได้เร็ว (ส่วนหน้ารับรองรอ D0-4)

ทุกข้อจบด้วย commit แยก, tests ผ่าน, และรัน `collect-automated-readiness-evidence.js` เพื่อยืนยันว่า FAIL ยังเป็น 0 — **อ่านค่า PASS/PENDING จาก report ที่รันจริง ห้ามคัดลอกตัวเลขจากเอกสารนี้**

## 12. การติดตาม

- อัปเดตตารางนี้ทุกสิ้น Wave (เปลี่ยน `[ ]` เป็น `[x]` พร้อมวันที่และ path หลักฐาน) — ห้ามติ๊กโดยไม่มี path
- Closure board (`outputs/go-live-closure-status/<run>/summary.md`) เป็นแหล่งเดียวของ "ใครค้างอะไร" — regenerate หลังทุก evidence pack ใหม่
- Readiness score ตาม §9 ของ master plan คิดจาก validator เท่านั้น; รายงาน owner ทุกสัปดาห์เป็นตัวเลขจริง + Critical/Major count + วันที่ decision ค้าง

### Checklist ระดับ Wave

- [ ] Wave 0 — decision register ครบ C0-1…C0-13 + D0-1…D0-8 / RC บน production / operator-gate pack #1
- [ ] Wave 1 — RC2 / Phase 2 gate / Phase 4 closed loop / security residual มี draft / import + threat review ปิด
- [ ] Wave 2 — RC3 freeze / UAT scripts+accounts+LINE test / staging / คู่มือตรง RC3 + 6 หัวข้อของ A2-6
- [ ] Wave 3 — UAT+restore+operator packs strict PASS / capacity report ลงนาม / Data+DPO sign-off
- [ ] Wave 4 — A4-2a dry run เหลือเฉพาะแถวลายเซ็น / C4-2 ลงนาม / A4-2b strict ไม่ใช้ `--allow-pending` / final evidence package
- [ ] 12A — baseline freeze / pilot wave 1 / ขยาย wave ตาม gate
- [ ] 12B — driver check-in/shift / parent LINE / advanced feature ทีละตัว / รายงานเปรียบเทียบ
- [ ] 14 — hypercare / asset + knowledge handover / งบ-renewal-ผู้ดูแล / Project Closure ลงนาม

## 13. A-task ที่เป็น machine-actionable — คำสั่ง, validator และ exit criteria

ทุกแถวในตารางนี้รันได้จาก worktree โดยไม่ต้องขออนุมัติจาก owner/operator และตัดสินผลจาก exit code + ข้อความที่ validator พิมพ์ ไม่ใช่จากการอ่านด้วยตา

คอลัมน์ **ต้องมี** ระบุสิ่งที่ต้องเตรียมก่อน: `-` คือรันได้ทันที, `sandbox MySQL` คือชุด integration (`npm test`) ที่ต้องมีฐานข้อมูล sandbox ตาม `backend/.env.test.example` — **ไม่ใช่ production**, `env` คือต้อง export ตัวแปรจาก `backend/.env.test.example` ก่อน

หมายเหตุสำคัญเรื่อง jest pattern: `backend/jest.unit.config.js` จำกัด `testMatch` ไว้ที่ `**/tests/**/*.unit.test.js` และ `tests/securityEnv.test.js` เท่านั้น การส่งชื่อไฟล์ `*.test.js` ที่ไม่ใช่ unit เข้ากับ `npm run test:unit` จะ **ไม่ error แต่ไม่รันไฟล์นั้น** และ exit 0 — เป็น false green แบบเดียวกับที่ npm audit เคยเป็น ดังนั้นชุด integration ต้องเรียกด้วย `npm test` เสมอ

| # | ต้องมี | คำสั่ง | Validator / expected output | Exit criteria |
|---|---|---|---|---|
| A0-3 | - | `cd backend && npm run test:unit -- researchIntegrityGuard` | `tests/researchIntegrityGuard.unit.test.js` | suite ผ่าน; ทุก metric ใน `measurementFramework.js` มี dictionary entry |
| A0-9 | - | `node scripts/collect-automated-readiness-evidence.js --out-dir outputs/automated-readiness` | `logs/secret-scan-head.log`, `logs/secret-scan-staged.log` | ทั้งสอง check เป็น `PASS` (`no secret patterns found`) |
| A0-10 | env | `cd backend && set -a && . ./.env.test.example && set +a && node scripts/generate-rbac-matrix.js --json --out ../outputs/rbac-matrix/<run>/rbac-matrix.json && node scripts/audit-scope-enforcement.js --out ../outputs/rbac-matrix/<run>/scope-enforcement.json` | `[rbac] wrote ... (N routes, M findings)` และ `[scope] ... gaps=0` | ทั้งสองคำสั่ง exit 0; `findings=0` และ `gaps=0`; เก็บ menu inventory คู่กันใน `docs/audit/menu-baseline-<rc>.md` |
| A0-13 | - | `bash scripts/production-readiness-gate.sh local` | บรรทัด `[gate] summary pass=N warn=N fail=N skip=N` | `fail=0` **และ** `warn=0`; ถ้ามี `NOT EVALUATED` ให้ถือว่ายังไม่ผ่านและรันซ้ำ |
| A1-1 | - | `cd backend && npm run test:unit` | test ที่ fail เมื่อพบข้อความ "พร้อมประเมิน" จาก raw count หรือ `dme_mie_ready` hardcode | suite ผ่าน; `grep -r "พร้อมประเมิน" frontend/src backend/src` ไม่พบใน path ที่คำนวณจาก raw count |
| A1-2 / A1-2b | - | `cd backend && npm run test:unit -- participation` | `tests/participation.unit.test.js` | ครบทุก event type และ append-only test ผ่าน |
| A1-3 / A1-11 | sandbox MySQL | `cd backend && npm test -- crossSchoolIsolation exportSecurity gradeScope` | `crossSchoolIsolation.test.js`, `exportSecurity.test.js`, `gradeScope.unit.test.js` | 0 failing; ไม่มี route ที่เข้าถึงข้ามขอบเขตได้; ตรวจว่า jest รายงาน suite ครบ 3 ไฟล์ ไม่ใช่แค่ไฟล์เดียว |
| A1-4 | - | `cd backend && npm run test:unit -- accountRecoveryPolicy decisionLogValidation` | `accountRecoveryPolicy.unit.test.js`, `decisionLogValidation.unit.test.js` | บทบาทที่ยังไม่ตอบ C0-5 ต้องยัง `gatesConfirmed=false` |
| A1-5 | sandbox MySQL | `cd backend && npm run test:unit -- securityEnv` **และ** `cd backend && npm test -- authSessionHardening securityHardening` | `securityEnv.test.js` (unit) + `authSessionHardening.test.js`, `securityHardening.test.js` (integration) | 0 failing **ทั้งสองคำสั่ง**; jest ต้องรายงานว่ารัน `authSessionHardening.test.js` จริง (ไฟล์นี้ไม่อยู่ใน unit project จึงไม่ถูกรันโดย `test:unit`); `docs/security/residual-risk-register.md` มีรายการ localStorage token |
| A1-6 | sandbox MySQL | `cd backend && npm run test:unit -- parentConsent` **และ** `cd backend && npm test -- consent parentConsentRoute qrAccess lineBindGuard` | `parentConsentGate.unit.test.js`, `parentConsentListGate.unit.test.js` (unit) + `consent.test.js`, `parentConsentRoute.test.js`, `qrAccess.test.js`, `lineBindGuard.test.js` (integration) | 0 failing ทั้งสองคำสั่ง; ทุกช่องทางใน D0-6 (QR/ParentStatus/LIFF/LINE/report/export) ต้องมี test ที่รันจริง — นับจาก suite ที่ jest รายงาน ไม่ใช่จากชื่อ pattern |
| A1-8 | local staging (A0-6) | `node backend/scripts/load-test.js --target http://127.0.0.1:3000 --sandbox --users 50,200,500,1000 --duration 60 --out outputs/load-test/local-<ts>/report.json` | `[load] stage users=…` ต่อ stage และ `[load] wrote …/report.json` | ไฟล์ report มี `stages[]` ครบ 4 ระดับพร้อม p50/p95/p99; `max_users_reached=1000`; **`supports_1000_user_claim` ใช้อ้างไม่ได้เพราะรันบน local** ให้ติดป้าย "local, ไม่เทียบเท่า production"; **อ่าน §13.1 ก่อนตีความ error rate** — 2 ใน 9 scenario วัดไม่ได้ด้วยเหตุผลที่ไม่เกี่ยวกับ capacity |
| A1-10 | sandbox MySQL | `cd backend && npm test -- importPreviewWiring importApplyModes importRollback` | `importPreviewWiring.test.js`, `importApplyModes.test.js`, `importRollback.test.js` | 0 failing และ jest รายงาน suite ครบ 3 ไฟล์; rollback คืนสภาพครบทุกแถว |
| A4-2a | - | `node scripts/create-go-live-bundle.js --allow-pending` → `node scripts/validate-go-live-bundle.js <bundle> --allow-pending` → `node scripts/summarize-go-live-closure.js --bundle <bundle> --allow-pending` → `node scripts/validate-go-live-closure-status.js <closure> --allow-pending` | `owner-actions.json` | `fail=0` และทุก `id` ที่เหลืออยู่ในชุด `signoff-*` / `approval-*` / `readiness-go-live-signoff` / `readiness-scorecard-overall` เท่านั้น |
| A4-2b | - | คำสั่งชุดเดียวกัน **ไม่ใส่ `--allow-pending`** และ `node scripts/verify-100-readiness.js` | `[ready-100] PASS`, `[go-live-bundle] PASS`, `[closure-status] PASS` | exit code 0 ทุกคำสั่ง; action rows = 0 |

### 13.1 ข้อจำกัดของการวัดใน load-test suite (วัดจริงแล้ว ไม่ใช่ข้อสันนิษฐาน)

รันจริงบน sandbox (50 users / 30 วินาที / 264,454 requests, commit `4b80b4b`) ผลคือ **7 ใน 9 scenario error = 0 (p95 = 13ms, 8,814 rps) แต่อีก 2 scenario error เกือบ 100% ด้วยเหตุผลที่ไม่เกี่ยวกับ capacity เลย**

| scenario | error rate ที่วัดได้ | สาเหตุจริง | ใช้ตัวเลขนี้อ้าง capacity ได้ไหม |
|---|---:|---|---|
| `login` | **99.98%** (31,675/31,680) | `loginLimiter` ที่ `backend/src/routes/auth.routes.js:55-57` = 20 ครั้ง/15 นาที/IP และ **ไม่มี `skip` สำหรับ test** ต่างจาก limiter อีก 5 ตัวในแอปที่ skip ทั้งหมด — generator ยิงจาก IP เดียว จึงถูกตัดทิ้งตั้งแต่ครั้งที่ 21 | **ไม่ได้** |
| `parent_status` | **99.77%** (26,390/26,450) | consent gate ปฏิเสธเพราะ sandbox ไม่มี `consent_records` ซึ่งรอ D0-5/D0-7 อยู่ (`seed-synthetic-staging.js` เตือนไว้เองตอน seed) | **ไม่ได้** |
| อีก 7 scenario | 0% | — | ได้ ภายใต้ข้อจำกัดของ environment |

**ผลต่อ B3-1 บน staging** ข้อจำกัดทั้งสองข้อ **ไม่หายไปเองเมื่อย้ายไป staging**:

- `loginLimiter` นับต่อ IP ถ้า load generator ยิงจากเครื่องเดียว scenario `login` จะถูก throttle เหมือนเดิมไม่ว่าเซิร์ฟเวอร์จะแรงแค่ไหน → ต้องเลือกอย่างใดอย่างหนึ่ง: กระจาย generator หลาย IP, หรือประกาศไว้ชัดว่า **ไม่ได้วัด login throughput** ห้ามยกเลิก limiter เพื่อให้ตัวเลขสวยขึ้น เพราะนั่นคือการวัดระบบที่ไม่ใช่ระบบที่จะ deploy
- `parent_status` วัดไม่ได้จนกว่า D0-5/D0-7 จะตอบและมี consent record จริงในชุดข้อมูลทดสอบ

**กติกา** ถ้ารายงาน capacity ยังมี 2 scenario นี้ error ~100% ให้ระบุในรายงานว่า **ไม่ได้วัด** ห้ามนับรวมใน error rate รวม และห้ามตีความว่า capacity ไม่ผ่าน — ทั้งสองอย่างทำให้ Phase 9 exit gate ตัดสินผิดคนละทาง

**ผลข้างเคียงอีกข้อ: ชุดทดสอบอัตโนมัติหลายชุดรันพร้อมกันจากเครื่องเดียวไม่ได้**

`loginLimiter` นับต่อ IP ไม่ใช่ต่อ process ดังนั้น E2E sweep, load test และ agent ที่ทดสอบ API พร้อมกันจะ**แย่ง budget 20 login/15 นาที ก้อนเดียวกัน** สังเกตจริงเมื่อ 4 ก.ย. 2569: E2E sweep รอบหนึ่งมี 4 บทบาทจาก 6 login ไม่ผ่านด้วย HTTP 429 ทั้งที่บัญชีถูกต้อง เพราะมี workflow อื่นทดสอบ API อยู่พร้อมกัน — รายงานรอบนั้นขึ้น critical 4 ข้อที่ไม่ใช่บั๊กของระบบเลยสักข้อ

**กติกา** จัดคิวชุดทดสอบให้รันทีละชุด หรือแยก IP; และก่อนตีความผลรันใด ๆ ที่มี login ล้มเหลว ให้ตรวจ HTTP status ก่อนเสมอ — `429` แปลว่าการวัดใช้ไม่ได้ ไม่ใช่ระบบพัง

## 14. งานที่เป็น human / external gate — ห้ามอ้าง automated evidence

รายการต่อไปนี้ **ไม่มีคำสั่งที่ทำให้ผ่านได้** validator ทำได้อย่างเดียวคือรายงานว่า "ยังว่าง" การที่ validator ไม่ FAIL ไม่ได้แปลว่ามีคนอนุมัติ

| # | ผู้รับผิดชอบ | ต้องส่งมอบอะไร | สิ่งที่ automated tooling ทำได้แค่นั้น |
|---|---|---|---|
| C0-1…C0-13 | Product owner / Project owner / Research lead / Operator | คำตอบ + ชื่อ + วันที่ ใน `decision-register.md` | ตรวจว่าไฟล์มีช่องครบ ไม่ตรวจว่าคำตอบถูก |
| D0-1…D0-8 | DPO/legal | decision memo ลงนาม | ตรวจว่ามีไฟล์ ไม่ตรวจความถูกต้องทางกฎหมาย |
| B0-1, B0-2, B0-3 | Operator | รัน gate บนเซิร์ฟเวอร์จริงและแนบ redacted log | ตรวจโครง evidence pack เท่านั้น |
| B1-1 | Operator | หมุน secret จริงและบันทึกวันที่ (ไม่บันทึกค่า) | ตรวจว่าไม่มีค่า secret หลุดใน git/evidence |
| B2-1, B2-2 | Operator / provider | LINE test channel, staging host | — |
| B3-1…B3-5 | Operator / Technical owner | ผลรันจริงจาก staging และ maintenance window | validate โครง evidence pack |
| C2-1a / C2-1b / C3-3 | Data owner | ตรวจ/แก้/รับรองข้อมูลจริง | ตรวจว่ามี certification record ไม่ตรวจว่าข้อมูลถูก |
| C3-1, C3-2 | UAT lead + ผู้แทนบทบาท | UAT จริงกับคนจริง พร้อมภาพ redacted | `validate-uat-evidence-pack.js` ตรวจว่าช่องครบ |
| C3-4 | DPO + Owner | ลายเซ็น residual risk / consent matrix / DPIA | `validate-go-live-signoff.js` ตรวจว่าช่องว่างเหลือกี่ช่อง |
| C4-1 | Trainer + ผู้เข้าอบรม | attendance + competency exercise ที่ผ่านจริง | — |
| C4-2 | Owner, Technical owner, Operator, UAT lead, DPO, ตัวแทนหน่วยงาน | ลายเซ็น System Acceptance | นับฟิลด์ที่ยังว่าง (ปัจจุบัน 119) |
| H14-4, H14-5, H14-7 | Technical owner + ผู้รับมอบ | ส่งมอบ asset/ความรู้/งบประมาณ พร้อมผู้รับยืนยัน | ตรวจ checklist ว่ามีครบ ไม่ตรวจว่าผู้รับใช้ได้จริง |
| H14-8 | ผู้มีอำนาจ | ลายเซ็นปิดโครงการ | — |

**ห้ามในทุกกรณี:** กรอกชื่อ/ลายเซ็น/วันที่/ผล PASS แทนคน, สร้าง evidence pack ที่ไม่ได้มาจากการรันจริง, หรือใช้ `--allow-pending` ในชุดปิดโครงการ

## 15. ภาคผนวก — Mapping จาก checkbox ใน master plan ไปยัง Task ID

ครอบคลุม checkbox ทั้งหมด **118 ข้อ** ใน `master-project-closure-plan.md` (Phase 0–14 จำนวน 101 ข้อ + Hard Gates §10 จำนวน 17 ข้อ) Phase 12 ในเอกสารนั้นเขียนเป็น bullet ไม่ใช่ checkbox จึง map ผ่านแถว P12A-*/P12B-* ใน §9 ของเอกสารนี้แทน

หมายเหตุ: เลขบรรทัดอ้างอิงตาม `master-project-closure-plan.md` ฉบับ 4 กันยายน 2569 ถ้าเอกสารนั้นถูกแก้ ให้ regenerate ตารางนี้ใหม่

### Phase 0 - Governance, Logic And Research Protocol Freeze

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 121 | แต่งตั้ง Project owner, Product owner, Technical owner, Operator, Data owner, UAT lead, Research lead และ DPO/contact | C0-7 |
| 2 | 122 | ยืนยัน Core scope, pilot scope และ feature ที่ `accept`, `pilot` หรือ `defer` | C0-4 |
| 3 | 123 | ยืนยัน Logic ของ rollout ระยะแรกว่าบัญชีโรงเรียนเต็มหรือครู grade scope เป็นผู้เช็กเด็ก พร้อมนิยาม check-in/out, absent, leave, override และ void | C0-1 |
| 4 | 124 | ยืนยันเจ้าของการอนุมัติ transfer, vehicle request, roster/registration และ vehicle inspection ไม่ให้ queue ซ้ำหลายระดับ | C0-2 |
| 5 | 125 | ยืนยันนิยาม "การบริหารแบบมีส่วนร่วม", กรอบทฤษฎี, คำถามวิจัย, ประชากร/กลุ่มตัวอย่าง, ตัวแปร, เครื่องมือ และช่วง pre/post กับอาจารย์ที่ปรึกษา/Research lead | C0-6 |
| 6 | 126 | ตัดสินว่าผู้ปกครอง นักเรียน ครูบัญชีย่อย และผู้เข้าประชุมอยู่ใน research population หรือเป็น external evidence | C0-6 |
| 7 | 127 | อนุมัติ target information architecture ต่อบทบาทตาม audit ล่าสุด โดยยังไม่ลบ route/API เดิม | C0-3 + C0-10 |
| 8 | 128 | กำหนด issue workflow, severity, change approval, maintenance window และ release freeze | C0-8 + C0-13 |

### Phase 1 - Technical Rebaseline And Evidence Reset

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 140 | สร้าง Current Status จาก production commit เดียว และติดป้ายเอกสารเก่าที่เป็น historical | A0-8 |
| 2 | 141 | ตรวจ production แบบ read-only: commit, PM2, health, DB timezone, migration, cron, disk, RAM, swap และ certificate | B0-1 |
| 3 | 142 | ตรวจ feature flags แบบ whitelist โดยไม่แสดง secrets | B0-1 + A0-11 |
| 4 | 143 | รัน unit/integration tests, frontend build, UI label/hybrid guard, migration baseline และ dependency/security audit | A0-13 |
| 5 | 144 | สร้าง evidence folders ใหม่สำหรับ release candidate พร้อม timestamp/checksum | A0-12 |
| 6 | 145 | ตรวจ secret/PII scan ของ source, diff, reports และ evidence | A0-9 |
| 7 | 146 | บันทึก baseline menu counts, API inventory และข้อมูลการใช้งานแบบ aggregate | A0-10 |

### Phase 2 - Research Integrity Remediation

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 154 | เปลี่ยนคำว่า "พร้อมประเมิน" ที่อิง raw action count เป็น "มีหลักฐานระบบเบื้องต้น" จนกว่า metric coverage จะครบ | A1-1 (ต้องมี C0-11) |
| 2 | 155 | ยกเลิก `dme_mie_ready: true` แบบ hardcode และส่งออก readiness แยก metric พร้อมเหตุผล/วันที่หลักฐาน | A1-1 |
| 3 | 156 | เพิ่ม validation/allowlist/length limit ให้ decision-log และกำหนดว่าบังคับในเหตุการณ์ใด | A1-1 |
| 4 | 157 | แยก operational KPI, participation KPI, research outcome และ external evidence ไม่ให้ปะปน | A0-3 + A1-1 |
| 5 | 158 | สร้าง data dictionary, metric formula, denominator, missing-data rule, research period และ version ของเครื่องมือ | A0-3 (ต้องมี C0-6) |
| 6 | 159 | เพิ่ม freshness rule ให้ snapshot และห้ามเปรียบเทียบ baseline/post ที่อยู่นอก protocol | A1-1 |
| 7 | 160 | เพิ่ม test ป้องกัน readiness เกินหลักฐานและ export metadata ผิด | A0-3 + A1-1 |

### Phase 3 - Menu And Information Architecture Simplification

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 168 | เพิ่ม page/action telemetry แบบ data-minimized และกำหนด retention เพื่อใช้ตัดสินเมนูจากหลักฐาน ไม่เก็บ PII | A2-2 |
| 2 | 169 | Driver รวม registration/application และคงงานวันนี้/แผนที่/ฉุกเฉิน/โปรไฟล์ให้เข้าถึงเร็ว | A2-1 (ต้องมี C0-9) |
| 3 | 170 | School รวมรถ+เพิ่มรถ, legacy roster+registration, vehicle workflow และ map/live โดยใช้ tabs/action ในหน้าเดิม | A2-1 (ต้องมี C0-9) |
| 4 | 171 | Affiliation รวมโรงเรียน+บัญชี, request queues และ map/risk | A2-1 |
| 5 | 172 | Province รวมเครือข่ายข้อมูลและแผนที่ ย้าย readiness ไป secondary governance | A2-1 (ต้องมี C0-10) |
| 6 | 173 | Transport รวม verification/inspection เป็น end-to-end queue | A2-1 |
| 7 | 174 | Admin ลดทางเข้าหลักจากประมาณ 23 เป็น 8 กลุ่ม และรวมหน้าวิจัยเป็น module เดียว | A2-1 |
| 8 | 175 | เก็บ old routes เป็น redirect/compatibility อย่างน้อยหนึ่ง release และซ่อนด้วย feature flag ก่อนลบ | A2-2 |
| 9 | 176 | ทดสอบ keyboard, focus, mobile navigation, deep link, browser back และ permission-denied state | A2-3 |

### Phase 4 - Participatory Administration Workflow MVP

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 184 | ออกแบบ `participation_cases` และ append-only `participation_case_events` แบบ additive migration พร้อม rollback | B0-2 + A1-2 |
| 2 | 185 | รองรับ event ขั้นต่ำ: `SUBMITTED`, `ACKNOWLEDGED`, `COMMENTED`, `CONSULTED`, `DECIDED`, `ASSIGNED`, `COMPLETED`, `FEEDBACK_SENT` | A1-2 |
| 3 | 186 | ฝัง event ใน emergency, vehicle request, transfer, roster/registration, inspection และ policy decision เดิม | A1-2 (ต้องมี C0-2) |
| 4 | 187 | เก็บผู้ริเริ่ม ผู้เข้าร่วม ทางเลือก มติ เหตุผล ผู้รับผิดชอบ SLA ผลลัพธ์ และการแจ้งผลกลับ โดยไม่เก็บข้อมูลเกินจำเป็น | A0-4 + A1-2 |
| 5 | 188 | เพิ่ม inbox "งานที่ต้องมีส่วนร่วม" แบบรวม ไม่สร้างเมนูใหม่ต่อ action | A0-4 + A1-2 |
| 6 | 189 | เพิ่ม parent/teacher feedback channel ตาม scope ที่ owner/DPO อนุมัติ | A1-2b (ต้องมี C0-12 + D0-3) |
| 7 | 190 | เพิ่ม aggregate participation dashboard แยกจาก operational dashboard | A1-2 |
| 8 | 191 | ทดสอบ cross-scope, append-only audit, duplicate submission, reassignment และ closed feedback loop | A1-2 |

### Phase 5 - Core Logic And Product Closure

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 199 | สร้าง role-to-route/API/write-action matrix ฉบับ release candidate | A1-3 |
| 2 | 200 | ปิด logic conflict ของ school first check-in, teacher grade scope, transfer, vehicle request, registration, assignment และ inspection | A1-3 (ต้องมี C0-1 + C0-2) |
| 3 | 201 | ทดสอบ import preview/apply/rollback, reports, Thai date/time และ audit ใน sandbox | A1-10 |
| 4 | 202 | ยืนยัน server-side scope ทุก query/write action ไม่พึ่งการซ่อนเมนู | A1-3 + A1-11 |
| 5 | 203 | ปิด Critical/Major defect และเพิ่ม regression/negative tests | A3-1 |
| 6 | 204 | ทำ Admin recovery pilot แล้วขยายครบทุกสิทธิ์ตาม `docs/password-recovery-all-roles-roadmap.md` | A1-4 (ต้องมี C0-5) |
| 7 | 205 | Feature ขั้นสูงที่ไม่อยู่ accepted scope ต้องซ่อนทั้ง menu/API อย่างปลอดภัย | A2-1 + A1-3 |

### Phase 6 - Data Readiness, Ownership And Certification

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 213 | สร้าง aggregate data-quality score โดยไม่ export PII | A1-7 |
| 2 | 214 | ตรวจ school-affiliation mapping, active/inactive, ownership, duplicate/orphan และข้อมูลที่จำเป็นต่อ LINE/check-in | A1-7 |
| 3 | 215 | โรงเรียนรับรองข้อมูลตนเอง ต้นสังกัดรับรอง coverage จังหวัดรับรองภาพรวม และขนส่งรับรองผลตรวจ | C3-3 |
| 4 | 216 | ผูก certification กับ term/batch/report/hash/exception ตาม `docs/pdpa-consent-and-data-confirmation-plan.md` | A1-7 (ต้องมี D0-4) |
| 5 | 217 | แก้ข้อมูลผ่าน UI/audit trail เท่านั้น และบันทึก delta ระหว่าง UAT | C2-1a + C2-1b |
| 6 | 218 | กำหนด correction, transfer, retention, archival และ data-subject request workflow | A1-12 (ต้องมี D0-8) |

### Phase 7 - Security, PDPA, Consent And Legal Closure

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 226 | ทำ threat/RBAC/IDOR/cross-scope review ทุกบทบาทรวม research export และ participation workflow | A1-11 |
| 2 | 227 | ปิดหรือรับรอง refresh-token rotation, localStorage token, export rate limit/streaming และ legacy password risks | A1-5 |
| 3 | 228 | หมุน secrets ที่ครบกำหนดโดยไม่บันทึกค่าใน git/evidence | B1-1 |
| 4 | 229 | DPO/legal รับรอง data inventory, purpose, lawful basis, minimization, retention, LINE, QR และข้อมูลอ่อนไหว | D0-1…D0-8 (ผ่าน C2-2) |
| 5 | 230 | แยก Consent, Acknowledgement และ Data Certification พร้อม version/snapshot/withdrawal | D0-4 + A1-7 |
| 6 | 231 | ปิดช่องว่าง ParentStatus consent, parent endpoint gate, feature dependency และ withdrawal cascade ทุกช่องทาง | A1-6 (ต้องมี D0-3, D0-5, D0-6, D0-7) |
| 7 | 232 | ทำ DPIA/incident playbook สำหรับข้อมูลเด็ก, LINE ผิดคน, export หลุด และ participation comments | A1-13 |

### Phase 8 - Full Role UAT, Usability And Accessibility

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 240 | สร้าง sandbox/test accounts: admin, province, affiliation, school full, school teacher, driver, transport และ LINE parent | A2-4 |
| 2 | 241 | ใช้ synthetic data และ LINE test account ห้ามเขียนทดสอบกับข้อมูลเด็กจริง | A2-4 + B2-1 |
| 3 | 242 | ทดสอบ top tasks, negative paths, refusal/consent, cross-scope, recovery และ old-route redirects | C3-1 |
| 4 | 243 | วัด task completion, time-on-task, error, help request และความสับสนของเมนูก่อน/หลังปรับ | C3-1 (เทียบกับ baseline จาก A0-10) |
| 5 | 244 | ทดสอบ participation case ตั้งแต่เสนอจน feedback sent | C3-1 |
| 6 | 245 | ตรวจ responsive 390/768/1440, keyboard, focus, contrast, target size และ screen reader labels | A2-3 + C3-1 |
| 7 | 246 | เก็บภาพ redacted/audit IDs และรัน evidence validator แบบ strict | C3-1 |

### Phase 9 - Capacity 1,000 Users And Infrastructure

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 256 | สร้าง staging ใกล้ production ด้วย synthetic/masked data | A0-6 + B2-2 |
| 2 | 257 | สร้าง workload สำหรับ login, dashboards, school check-in, reports, participation events, GPS และ parent status | A1-8 |
| 3 | 258 | รัน ramp 50/200/500/1,000, peak และ soak อย่างน้อย 60 นาที | B3-1 |
| 4 | 259 | เก็บ p50/p95/p99, throughput, error, DB pool/slow query, CPU/RAM/swap, event-loop lag และ LINE queue | B3-1 |
| 5 | 260 | เกณฑ์เริ่มต้น: error <1%, ไม่มีข้อมูลซ้ำ/หาย, read p95 <=1 วินาที, write p95 <=2 วินาที และฟื้นหลัง peak ได้ | B3-1 |
| 6 | 261 | ย้าย shared state ไป Redis/DB ก่อน scale หลาย instance และปรับ index/pool/cache/report streaming ตามผล | A1-9 |
| 7 | 262 | ประกาศ capacity limit/degradation policy ตามผลจริง | B3-1 |

### Phase 10 - Resilience, DR And Production Operations

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 270 | กำหนด RPO/RTO, retention, off-host backup owner, on-call และ restore frequency | B3-4 |
| 2 | 271 | ทำ scratch restore และพิสูจน์ production aggregate ไม่เปลี่ยน | B3-2 |
| 3 | 272 | ทำ controlled reboot แล้วตรวจ PM2/nginx/MySQL/cron กลับมาภายใน RTO | B3-3 |
| 4 | 273 | เปิดและทดสอบ external uptime/disk/certificate/backup alerts | B3-4 |
| 5 | 274 | ทดสอบ rollback code, frontend, feature flags และ migration | B3-3 |
| 6 | 275 | ตรวจ log rotation, timezone, disk threshold และ incident escalation | B3-5 |
| 7 | 276 | ทำ operator gate และ monitor 30-60 นาทีด้วย redacted evidence | B0-3 + B3-3 |

### Phase 11 - Manuals, Training And Change Management

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 284 | Regenerate คู่มือ/ภาพ/PDF/เว็บไซต์ตามเมนูและ feature flags รุ่นจริง | A2-5 + A4-1 |
| 2 | 285 | ทำ quick guide แยก role โดยสอน top tasks ไม่สอนทุกหน้าที่ซ่อนอยู่ | A2-5 |
| 3 | 286 | เพิ่ม troubleshooting, support, recovery, privacy, feedback และ incident channels | A2-6 |
| 4 | 287 | อบรม admin, จังหวัด, สังกัด, โรงเรียน, ครู, ขนส่ง, คนขับ และผู้ปกครอง | C4-1 |
| 5 | 288 | เก็บ attendance, competency exercise, feedback และคำถามค้าง | C4-1 |
| 6 | 289 | จัดทำประกาศ scope, capacity, privacy และ change freeze | A4-1 (ต้องมี C0-13) |

### Phase 13 - Research Data Collection And Evaluation

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 318 | Freeze baseline ก่อน intervention ตามวัน/กลุ่มที่กำหนด และบันทึก contamination/confounders | R13-1 |
| 2 | 319 | รัน snapshot ตาม schedule พร้อม freshness/completeness checks | R13-2 |
| 3 | 320 | เก็บ external evidence: แบบสอบถาม สัมภาษณ์ บันทึกประชุม และ workload diary ตาม consent/ethics approval | R13-3 |
| 4 | 321 | เชื่อมหลักฐานระบบกับ participation case โดยใช้ pseudonymous IDs | R13-4 |
| 5 | 322 | วิเคราะห์แยก operational outcome, participation process, perceived benefit และ equity | R13-5 |
| 6 | 323 | ทำ missing-data/sensitivity/triangulation review และไม่อ้าง causal effect เกิน design | R13-6 |
| 7 | 324 | สร้าง reproducible export พร้อม data dictionary, version, query/checksum และ disclosure review | R13-7 |

### Phase 14 - Hypercare, Handover And Formal Closure

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 332 | เฝ้าระวังรายวันสัปดาห์แรกและรายสัปดาห์จนจบ hypercare | H14-1 |
| 2 | 333 | สรุป incident, support, adoption, data quality, participation closure, uptime และ capacity | H14-2 |
| 3 | 334 | ปิด Critical/Major; Minor เข้า maintenance backlog พร้อม owner/date | H14-3 |
| 4 | 335 | ส่งมอบ repository, deployment, secret ownership, DB/backup, LINE Console, domain/DNS และ monitoring โดยไม่ส่ง secret ผ่าน git | H14-4 |
| 5 | 336 | ส่งมอบ architecture, schema, API/RBAC, research dictionary, runbook, DR, manuals และ training records | H14-5 |
| 6 | 337 | Tag final release และสร้าง immutable closure/research evidence bundle พร้อม checksums | H14-6 |
| 7 | 338 | ยืนยัน operator, SLA, งบ/renewal และผู้ดูแลหลังส่งมอบ | H14-7 |
| 8 | 339 | ลงนาม System Acceptance, Dataset Freeze และ Project Closure ตามขอบเขตจริง | H14-8 |

### 10. Hard Gates ก่อนประกาศ 100%

| # | บรรทัด | Checkbox ใน master plan | Task ID |
|---:|---:|---|---|
| 1 | 395 | Release candidate commit ตรงกับ `/health.data.commit` และ server worktree สะอาด | B0-2 + A4-2b |
| 2 | 396 | Tests/build/dependency/security/migration validators ผ่าน | A0-13 + A4-2b |
| 3 | 397 | Research protocol/metric dictionary ถูก freeze และไม่มี hardcoded readiness หรือคำว่า "พร้อมประเมิน" จาก raw action count | A0-3 + A1-1 + C0-11 |
| 4 | 398 | Menu/IA ผ่าน role usability UAT และ old routes มี redirect/rollback ที่ตรวจได้ | A2-1 + A2-2 + C3-1 |
| 5 | 399 | Participation workflow พิสูจน์ closed feedback loop ตาม accepted scope | A1-2 + C3-1 |
| 6 | 400 | UAT evidence pack ทุกบทบาทผ่าน strict validator | C3-1 |
| 7 | 401 | Account recovery ทุก login role และ parent LINE re-link ผ่าน UAT ตาม policy ของบทบาท | A1-4 + C0-5 |
| 8 | 402 | Critical = 0, Major = 0 | A3-1 |
| 9 | 403 | Data owner รับรองข้อมูลใน rollout scope | C3-3 |
| 10 | 404 | DPO/legal decision ครบตาม feature ที่เปิด | D0-1…D0-8 + C3-4 |
| 11 | 405 | Consent/Acknowledgement/Data Certification ผ่าน Matrix และ UAT ใน `docs/pdpa-consent-and-data-confirmation-plan.md` | D0-4 + A1-6 + A1-7 + C3-2 |
| 12 | 406 | Capacity test ผ่านค่าที่ประกาศ โดยเฉพาะคำกล่าวรองรับ 1,000 concurrent users | B3-1 |
| 13 | 407 | Backup/off-host/restore/reboot/rollback/monitor ผ่านพร้อมหลักฐาน | B3-2 + B3-3 + B3-4 + B3-5 |
| 14 | 408 | คู่มือและเว็บไซต์ตรงกับ release ปัจจุบัน | A4-1 |
| 15 | 409 | Training attendance และ role competency ครบ | C4-1 |
| 16 | 410 | Owner, Technical owner, Operator, UAT lead, DPO และตัวแทนหน่วยงานลงนามตามขอบเขตจริง | C4-2 |
| 17 | 411 | Final readiness, bundle และ closure validators ผ่านโดยไม่มี `--allow-pending` | A4-2b |
