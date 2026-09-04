# แผนดำเนินการให้เสร็จ (Execution Plan To Completion) — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **แผนปฏิบัติจากจุดที่อยู่จริงไปถึง System Acceptance และ Project Closure** — ต่อยอดจาก `master-project-closure-plan.md` โดยไม่เปลี่ยน Phase/Exit gate เดิม แต่ระบุว่า *ใครทำอะไร เมื่อไร ต้องมีอะไรก่อน และหลักฐานอะไรถือว่าเสร็จ*

---

## 1. จุดตั้งต้นที่ยืนยันได้

| รายการ | ค่า |
|---|---|
| Release candidate (RC) | `cef4bd1` บน `feat/tracking-security-hardening` (ยังไม่ push, ยังไม่ deploy) |
| Production | `0060c3e` — ตามหลัง RC 15 commits; migration 050 ยังไม่ apply |
| Automated readiness | PASS 5 / PENDING 9 / **FAIL 0** (`outputs/automated-readiness/20260904-144021`) |
| Closure board | PENDING, 20 actions: operator 9 · uat-lead 5 · technical-owner 3 · project-owner 1 · line-uat-lead 1 · report-uat-lead 1 |
| Readiness scorecard | 80% (2026-08) — เหลือ UAT จริง + restore drill + อนุมัติ deploy |
| หลักฐานเทคนิคล่าสุด | 1,237 tests ผ่านบน MySQL 8 จริง (sandbox), migration 050 apply/rollback สะอาด, production ไม่เปลี่ยน |

สิ่งที่ **ยังไม่มีเลย** (ไม่ใช่แค่ยังไม่ผ่าน): frontend ของ participation workflow, ผลรัน load test, staging, บัญชี UAT ทดสอบ, evidence pack ทุกชนิด, ลายเซ็นทุกใบ

## 2. หลักการวางแผน

1. **สามเลนขนานกัน** — A (Automated: ทีมเทคนิค/Codex ทำได้เลย), B (Sandbox/External: ต้องมีเครื่อง/บริการ/หน้าต่างเวลา), C (Human decision/sign-off) เลน A ห้ามหยุดรอเลน C ถ้ามีงานที่ไม่ขึ้นกับการตัดสินใจ
2. **Critical path คือเลน C ไม่ใช่เลน A** — งานเทคนิคที่เหลือประมาณ 4–5 สัปดาห์คน แต่ UAT/DR/sign-off ขึ้นกับคนจริงและ maintenance window
3. **RC เดียวตลอดทาง** — ทุก evidence ต้องอ้าง commit เดียวกัน ถ้า RC เปลี่ยนหลัง UAT เริ่ม ต้องรัน regression + regenerate bundle ใหม่
4. **ไม่ปลอมหลักฐาน** — validator ผ่านแบบ `--allow-pending` ใช้ได้ระหว่างทาง แต่ชุดปิดโครงการ (§12 ของ master plan) ห้ามใช้
5. **เป้าหมายเวลา** — System Acceptance ภายใน **31 ตุลาคม 2569** เพื่อ rollout Phase 12A ทันเทอม 2/2569 (พฤศจิกายน 2569) ถ้า Phase 0 ไม่จบใน Wave 0 ให้เลื่อนตาม §7 ไม่บีบคุณภาพ

## 3. ภาพรวม Timeline

| Wave | ช่วง | เป้าหมายหลัก | Phase ที่ปิด/ขยับ |
|---|---|---|---|
| **0 — Unblock** | 4–11 ก.ย. 2569 | ได้ Logic decisions, deploy RC, ตั้ง sandbox | 0 (C), 1 (deploy), เริ่ม 2/4/7 |
| **1 — Build** | 12–25 ก.ย. | ปิดงานเทคนิคที่ไม่ต้องรอใคร | 2, 4 (UI), 5, 7 (code) |
| **2 — Simplify + Prepare** | 26 ก.ย.–9 ต.ค. | เมนูตาม IA ที่อนุมัติ, เตรียม UAT/staging | 3, 8 (prep), 9 (staging), 6 (เริ่ม) |
| **3 — Prove** | 10–23 ต.ค. | UAT ทุกบทบาท, load test, DR drill | 8, 9, 10, 6, 7 (sign-off) |
| **4 — Accept** | 24–31 ต.ค. | คู่มือ/อบรม, validators strict, ลงนาม | 11, hard gates ทั้งหมด → **System Acceptance** |
| **12A — Rollout** | พ.ย. 2569–มี.ค. 2570 | pilot → ขยาย wave ตามเทอม 2/2569 | 12A, 13 (เก็บข้อมูล) |
| **Hypercare + Closure** | 30 วันหลัง wave สุดท้าย (ประมาณ เม.ย. 2570) | ส่งมอบ ลงนามปิดโครงการ | 14 |

Phase 12B (เทอม 1/2570) เป็นงานต่อเนื่องหลังปิดโครงการ scope 12A — ไม่อยู่ในเส้นทางปิดโครงการนี้ เว้นแต่ owner กำหนดใหม่

## 4. Wave 0 — Unblock (4–11 ก.ย. 2569)

จุดประสงค์: เอาสิ่งที่ block งานทุกเลนออกให้หมดในสัปดาห์เดียว

### 4.1 เลน C — การตัดสินใจที่ต้องได้ภายใน 11 ก.ย.

| # | คำถาม | ผู้ตัดสิน | ถ้าไม่ตอบ จะ block อะไร |
|---|---|---|---|
| C0-1 | Rollout แรกใครเช็กเด็ก: บัญชีโรงเรียนเต็ม หรือครู grade scope; นิยาม check-in/out, absent, leave, override, void | Product owner + ผู้แทนโรงเรียน | Phase 5 logic tests, Phase 3 เมนู driver/school, UAT script |
| C0-2 | เจ้าของอนุมัติ transfer / vehicle request / roster-registration / inspection — ระดับเดียว ไม่ซ้ำ queue | Product owner + ต้นสังกัด | Phase 3 request queues, Phase 4 event embedding |
| C0-3 | Target IA ต่อบทบาทตาม `role-menu-participatory-research-audit-2026-09-04.md` — อนุมัติ/แก้ | Product owner | Phase 3 ทั้งหมด |
| C0-4 | Feature ที่ `accept` / `pilot` / `defer` จาก 10 flags: ADMIN_PASSWORD_RECOVERY, DRIVER_REGISTRATION, DRIVER_SHIFT_SELECTION, ETA, GEOFENCE, PARENT_CONSENT_REQUIRED, PARTICIPATION_CASES, QR_LEVEL, ROUTE_DEVIATION, VEHICLE_QR | Project owner | ขอบเขต UAT, คู่มือ, DPO decision |
| C0-5 | คำตอบ 6 ข้อใน `decision-package-account-recovery-roles-2026-09-04.md` (โดยเฉพาะคนขับที่ login ด้วยทะเบียนรถ) | Project owner + ฝ่ายทะเบียน | Phase 5 recovery ทุกบทบาท, hard gate "account recovery ทุก role" |
| C0-6 | นิยาม "การบริหารแบบมีส่วนร่วม", คำถามวิจัย, ประชากร, เครื่องมือ, pre/post window; ผู้ปกครอง/นักเรียน/ครูย่อยอยู่ใน population หรือเป็น external evidence | Research lead + อาจารย์ที่ปรึกษา | Phase 2 dictionary, Phase 13 baseline freeze |
| C0-7 | แต่งตั้งชื่อจริง: Project owner, Product owner, Technical owner, Operator, Data owner, UAT lead, Research lead, DPO | ผู้มีอำนาจหน่วยงาน | ทุกช่องลงนาม |
| C0-8 | Maintenance window สำหรับ deploy RC และ DR drill (อย่างน้อย 2 หน้าต่าง) | Operator + Owner | Phase 1 deploy, Phase 10 |

รูปแบบ: ทีมเทคนิคจัดทำ **decision register** (`docs/project-closure/decision-register.md`) ที่มีคำถาม ทางเลือก ผลกระทบ และช่องลงชื่อ/วันที่ — ผู้ตัดสินตอบในเอกสารนั้นเท่านั้น ห้าม Codex กรอกแทน

### 4.2 เลน A — งานเทคนิคทันที (ไม่ต้องรอ C)

| # | งาน | ผลลัพธ์/หลักฐาน |
|---|---|---|
| A0-1 | Push `cef4bd1` ไป origin; เปิด PR/ตรวจ diff `0060c3e..cef4bd1` เป็น release note | `CHANGELOG.md` อัปเดต, PR link |
| A0-2 | สร้าง decision register จาก C0-1…C0-8 พร้อม impact analysis ต่อข้อ | `docs/project-closure/decision-register.md` |
| A0-3 | Phase 2: เขียน metric/data dictionary จาก `researchReadiness.service.js` + `measurementFramework.js` (สูตร, ตัวหาร, missing-data rule, freshness, version) และ test ที่ fail ถ้า metric ใดไม่มี dictionary entry | `docs/research/metric-dictionary.md` + unit test |
| A0-4 | Phase 4: ออกแบบ participation inbox/dashboard UI spec (หน้าเดียวรวมทุก role, ไม่เพิ่มเมนูต่อ action) รอ C0-3 เฉพาะตำแหน่งในเมนู | `docs/project-closure/participation-ui-spec.md` |
| A0-5 | Phase 7: เริ่ม refresh-token rotation + replay detection, export rate-limit ให้ครอบทุก export route, export streaming สำหรับชุดใหญ่ | code + tests; ไม่แตะ policy ของ localStorage token (ต้อง C) |
| A0-6 | ตั้ง local staging: `docker-compose` MySQL 8 + synthetic data generator (masked จาก schema ไม่ใช่จาก production) | `backend/scripts/seed-synthetic-staging.js`, README |
| A0-7 | Phase 11 prep: content audit คู่มือทั้ง 8 เล่มเทียบ feature flags/เมนูรุ่น RC ติดป้ายส่วนที่ล้าสมัย | `docs/manual-audit/rc-content-audit-2026-09.md` |

### 4.3 เลน B — Operator (ในหน้าต่างเวลาที่ได้จาก C0-8)

| # | งาน | คำสั่ง/หลักฐาน |
|---|---|---|
| B0-1 | Production read-only gate บนเซิร์ฟเวอร์ | `bash scripts/production-readiness-gate.sh production` → `outputs/operator-gates/<ts>/production-gate.redacted.log` |
| B0-2 | อนุมัติแล้ว deploy RC ตาม runbook + apply migration 050 (มี rollback ที่พิสูจน์แล้ว) | `SCHOOLBUS_DEPLOY_APPROVED=true`, postdeploy gate, `/health.data.commit == cef4bd1` |
| B0-3 | Monitor 30–60 นาทีหลัง deploy | `create-operator-gate-evidence-pack.js` → validator ผ่าน |

**Exit Wave 0:** decision register ตอบครบ 8 ข้อ (หรือระบุวันตอบที่ผูกกับ §7), RC บน production, operator-gate evidence pack แรกผ่าน validator

## 5. Wave 1 — Build (12–25 ก.ย.)

งานเทคนิคที่ปิดได้โดยไม่ต้องรอ UAT — ทุกข้อจบด้วย test + evidence และรวมใน RC ถัดไป (`RC2`)

| # | Phase | งาน | Exit evidence |
|---|---|---|---|
| A1-1 | 2 | ปิด dictionary/freshness/allowlist ให้ครบ; ลบทุกข้อความ "พร้อมประเมิน" ที่มาจาก raw count; export research metadata (version, period, query hash) | Phase 2 exit gate: ไม่มี PASS จาก heuristic; test ป้องกัน regression |
| A1-2 | 4 | สร้าง participation inbox + case detail + aggregate dashboard (behind `FEATURE_PARTICIPATION_CASES`); ฝัง event ใน emergency / vehicle request / transfer / roster / inspection / policy decision | sandbox: 1 workflow ต่อ role เดินครบ SUBMITTED→FEEDBACK_SENT→CLOSED; cross-scope tests |
| A1-3 | 5 | Role-to-route/API/write-action matrix ฉบับ RC2 (จาก `outputs/rbac-matrix` + router graph) และ regression tests ต่อ Logic decision C0-1/C0-2 | matrix ใน `docs/audit/`, tests ผ่าน |
| A1-4 | 5 | Account recovery ครบทุกบทบาทตามคำตอบ C0-5; parent LINE re-link flow | tests + UAT script ต่อบทบาท |
| A1-5 | 7 | ปิด: refresh-token rotation/replay, export rate-limit/streaming, legacy weak-password forced rotation; จัดทำ risk-acceptance draft สำหรับ localStorage token (ทางเลือก: คง JWT + short TTL + rotation vs. เปลี่ยนเป็น httpOnly cookie ซึ่งขัดกฎ "JWT ไม่ใช้ cookie" ใน CLAUDE.md → ต้อง owner ตัดสิน) | security tests, `docs/security/residual-risk-register.md` |
| A1-6 | 7 | ปิดช่องว่าง consent: ParentStatus consent UI, feature dependency กันเปิด parent consent โดยไม่มีช่องทาง, withdrawal cascade (QR/ParentStatus/LIFF/LINE/report/export) | tests ต่อ cascade ทุกช่องทาง |
| A1-7 | 6 | Aggregate data-quality score + รายงาน duplicate/orphan/mapping โดยไม่ export PII; หน้ารับรองข้อมูลต่อบทบาท (acknowledgement/certification ตาม PDPA plan) | `docs/data/data-quality-report-<ts>.md` แบบ aggregate |
| A1-8 | 9 | รัน `backend/scripts/load-test.js` บน local staging (A0-6) ramp 50/200/500/1,000 — **ติดป้าย "local, ไม่เทียบเท่า production"** ใช้หา bottleneck ก่อน staging จริง | `outputs/load-test/local-<ts>/` + รายการ index/pool/cache ที่ต้องปรับ |
| A1-9 | 9 | ย้าย in-memory state (lockout / dedup / linking) ไป DB หรือ Redis ตามผล A1-8 | tests; single-instance caveat ถูกลบจาก backlog |

**Exit Wave 1:** RC2 tag; full suite ผ่านบน sandbox MySQL; Phase 2 exit gate ผ่าน; Phase 4 closed loop พิสูจน์ใน sandbox; residual security เหลือเฉพาะข้อที่มี risk-acceptance draft

## 6. Wave 2 — Simplify + Prepare (26 ก.ย.–9 ต.ค.)

| # | Phase | เลน | งาน | Exit evidence |
|---|---|---|---|---|
| A2-1 | 3 | A | ปรับเมนูตาม IA ที่อนุมัติ (C0-3): Driver รวม registration/application; School รวมรถ+เพิ่มรถ, roster+registration, map/live เป็น tabs; Affiliation รวมโรงเรียน+บัญชี, request queues; Province รวมเครือข่าย+แผนที่; Transport verification+inspection queue เดียว; Admin ~23 → 8 กลุ่ม | menu inventory ก่อน/หลัง |
| A2-2 | 3 | A | Redirect map สำหรับ old routes (คงอย่างน้อย 1 release) + feature flag ซ่อนก่อนลบ; page telemetry แบบไม่มี PII พร้อม retention | `docs/ui/redirect-map.md`, tests deep link/back/permission-denied |
| A2-3 | 3 | A | ตรวจ keyboard/focus/contrast/target size/responsive 390-768-1440 ด้วย browser-review script | `outputs/ui-review/<ts>/` |
| A2-4 | 8 | A | สร้างบัญชี sandbox ทุกบทบาท (admin, province, affiliation, school full, school teacher, driver, transport) ด้วย `seed-production-uat-users.js` บน **sandbox DB เท่านั้น**; UAT script ต่อบทบาท = top tasks + negative + cross-scope + recovery + old-route redirect + participation case | `SCHOOLBUS_UAT_CREDENTIALS_FILE` (นอก git), `docs/uat/scripts/<role>.md` |
| B2-1 | 8 | B | ขอ LINE test channel/LIFF test account จาก provider; ผู้ปกครองทดสอบ = synthetic | LINE test config นอก git |
| B2-2 | 9 | B | ตั้ง staging ใกล้ production (VPS ขนาดเดียวกัน, masked/synthetic data) | staging URL + `docs/ops/staging.md` |
| A2-5 | 11 | A | Regenerate คู่มือ HTML/PDF + screenshots จาก RC2 บน sandbox ตามผล A0-7; quick guide ต่อ role สอน top tasks | `scripts/build-manual-pdf.sh` ผ่าน; manual audit ไม่มีป้ายล้าสมัย |
| C2-1 | 6 | C | Data owner ของแต่ละโรงเรียน/ต้นสังกัดใน rollout scope เริ่มตรวจ/แก้ข้อมูลผ่าน UI ตามรายงาน A1-7 | delta log ใน audit trail |
| C2-2 | 7 | C | DPO/legal review: data inventory, lawful basis, LINE, QR, retention, DPIA; ตัดสิน localStorage token risk | DPO decision memo ลงนาม |

**Exit Wave 2:** RC3 (freeze สำหรับ UAT — หลังจากนี้แก้เฉพาะ Critical/Major); UAT scripts + accounts + LINE test พร้อม; staging ขึ้น; คู่มือตรง RC3

## 7. Wave 3 — Prove (10–23 ต.ค.)

| # | Phase | เลน | งาน | Exit evidence |
|---|---|---|---|---|
| C3-1 | 8 | C | ผู้แทนจริงทุกบทบาททำ UAT บน sandbox ตาม script; วัด task completion/time/error/help request; เก็บภาพ redacted | `create-uat-evidence-pack.js` → `validate-uat-evidence-pack.js` **strict** ผ่าน, `scan-uat-evidence-safety.js` ผ่าน |
| C3-2 | 8 | C | LINE parent UAT (link, status, notification, consent, withdrawal, re-link) ด้วย test account | ส่วน LINE ใน evidence pack |
| A3-1 | 8 | A | Triage defect รายวัน; แก้เฉพาะ Critical/Major → RC3.x; regression + regenerate bundle ทุกครั้งที่ RC เปลี่ยน | defect log Critical=0, Major=0 |
| B3-1 | 9 | B | Load test บน staging จริง: ramp 50/200/500/1,000, peak, soak 60 นาที; เก็บ p50/p95/p99, error, DB pool, CPU/RAM/swap, event-loop lag, LINE queue | รายงานทำซ้ำได้; ถ้าไม่ผ่านเกณฑ์ (error <1%, read p95 ≤1s, write p95 ≤2s) → ประกาศ limit จริง ไม่อ้าง 1,000 |
| B3-2 | 10 | B | Restore drill ลง `lampang_bus_restore_drill` จาก backup ล่าสุด; พิสูจน์ production aggregate ไม่เปลี่ยน | `create-restore-drill-evidence-pack.js` → validator ผ่าน |
| B3-3 | 10 | B | Controlled reboot ใน maintenance window; PM2/nginx/MySQL/cron กลับภายใน RTO; ทดสอบ rollback code/frontend/flag/migration | operator-gate evidence pack #2 |
| B3-4 | 10 | B | เปิด external uptime/disk/cert/backup alerts; กำหนด RPO/RTO/on-call เป็นลายลักษณ์อักษร | `docs/ops/sla-rto-rpo.md` ลงนาม Operator |
| C3-3 | 6 | C | Data owner certification ครบ rollout scope (โรงเรียน → ต้นสังกัด → จังหวัด → ขนส่ง) ผูก term/batch/hash | certification records ใน DB + export aggregate |
| C3-4 | 7 | C | DPO ลงนาม residual risk + consent matrix; owner ลงนาม risk acceptance | เอกสารลงนามใน evidence package |

**Exit Wave 3:** UAT/restore/operator evidence packs ผ่าน validator แบบ strict; capacity report ลงนาม Technical owner + Operator; Critical=0/Major=0; Data + DPO sign-off ครบ

## 8. Wave 4 — Accept (24–31 ต.ค.)

| # | Phase | เลน | งาน | Exit evidence |
|---|---|---|---|---|
| C4-1 | 11 | C | อบรม admin/จังหวัด/สังกัด/โรงเรียน/ครู/ขนส่ง/คนขับ/ผู้ปกครอง; competency exercise; attendance | Training sign-off |
| A4-1 | 11 | A | Regenerate คู่มือรอบสุดท้ายจาก RC final; ประกาศ scope/capacity/privacy/change freeze | manual audit ผ่าน |
| A4-2 | — | A | รันชุดคำสั่ง §12 ของ master plan บนเซิร์ฟเวอร์ **โดยไม่ใช้ `--allow-pending`**: bundle → closure → `verify-100-readiness.js` | ทุก validator PASS, closure status = PASS, action rows = 0 |
| C4-2 | — | C | Owner, Technical owner, Operator, UAT lead, DPO, ตัวแทนหน่วยงานลงนาม System Acceptance | `UAT_SIGNOFF` + `PHASE9_OWNER_OPERATOR_APPROVAL` ไม่มีฟิลด์ค้าง (ปัจจุบัน 119) |
| A4-3 | — | A | Tag release, สร้าง final evidence package ตาม §11 พร้อม checksums | immutable bundle |

**Exit Wave 4 = System Acceptance:** Hard gates §10 ครบทุกข้อ; readiness 100% จาก evidence ที่ validator รับรอง

## 9. Phase 12A, 13, 14 — หลัง System Acceptance

| ช่วง | งาน | Gate |
|---|---|---|
| ต้น พ.ย. 2569 | **Baseline freeze** (Phase 13) ก่อน intervention ตาม protocol ที่ Research lead อนุมัติ; บันทึก confounders | Research lead ลงนาม dataset freeze |
| พ.ย. 2569 | Pilot wave 1: 1–2 โรงเรียน + ต้นสังกัด 1 เขต; โรงเรียนเป็นผู้เช็กเด็กตาม C0-1; LINE เฉพาะ workflow ที่ผ่าน DPO/UAT | Critical=0, Major กระทบ wave=0, monitor ปกติ, owner อนุมัติขยาย |
| ธ.ค. 2569–ก.พ. 2570 | ขยาย wave 2–3 ตามลำดับ; snapshot ตาม schedule พร้อม freshness/completeness; เก็บ external evidence (แบบสอบถาม/สัมภาษณ์/บันทึกประชุม) ตาม consent | gate ต่อ wave |
| มี.ค. 2570 | ปิดเทอม; post-measurement ตาม protocol; วิเคราะห์แยก operational / participation / perceived benefit / equity | Research lead รับรอง protocol adherence |
| 30 วันหลัง wave สุดท้าย | Hypercare: เฝ้าระวังรายวัน→รายสัปดาห์; สรุป incident/support/adoption/data quality/uptime/capacity | รายงาน hypercare |
| ประมาณ เม.ย. 2570 | Phase 14: ส่งมอบ repo/deploy/secret ownership/DB-backup/LINE Console/DNS/monitoring (ไม่ส่ง secret ผ่าน git); tag final; ลงนาม System Acceptance, Dataset Freeze, Project Closure; defer list เข้า maintenance roadmap พร้อม owner/date | Definition of Done §14 ครบ 12 ข้อ |

## 10. กติกาเมื่อเลื่อน (Slip Rules)

| เหตุการณ์ | ผลที่ตามมา | ห้ามทำ |
|---|---|---|
| Phase 0 ตอบไม่ครบภายใน 11 ก.ย. | Wave 1 ทำเฉพาะงานที่ไม่ขึ้นกับคำตอบ (A1-1, A1-5, A1-6, A1-7, A1-8, A1-9); Wave 2–4 เลื่อนวันต่อวัน; ถ้าเกิน 25 ก.ย. pilot 12A หดเหลือ 1 โรงเรียน | เดา Logic แทน owner |
| Load test ไม่ผ่านเกณฑ์ | ประกาศ capacity limit + degradation policy ตามผลจริง; rollout wave จำกัดตาม limit | อ้าง 1,000 users |
| ไม่มี maintenance window ก่อน 23 ต.ค. | Phase 10 ไม่ผ่าน → System Acceptance เลื่อน; pilot ทำได้เฉพาะเมื่อ owner ลงนาม risk acceptance ชั่วคราวเป็นลายลักษณ์อักษร | ข้าม restore drill |
| UAT พบ Major หลัง RC3 freeze | แก้ → RC3.x → regression เต็ม → regenerate bundle/closure ใหม่ทั้งชุด | patch แล้วใช้ evidence เก่า |
| DPO ยังไม่ตัดสิน feature ใด | feature นั้น flag=off ตอน rollout และย้ายเป็น defer พร้อม owner/date | เปิดโดยไม่มี decision |

## 11. งานถัดไปทันทีของทีมเทคนิค (ลำดับที่จะทำจริง)

1. `A0-1` push RC + release note — **รอ owner ยืนยันก่อน push**
2. `A0-2` decision register → ส่งให้ owner/research lead/DPO ภายในวันถัดไป
3. `A0-3` metric dictionary + guard test (Phase 2)
4. `A0-5` refresh-token rotation, export rate-limit/streaming (Phase 7)
5. `A0-6` local staging + synthetic seed (เตรียม Phase 9)
6. `A0-4` participation UI spec → `A1-2` สร้าง UI ทันทีที่ C0-3 ตอบเรื่องตำแหน่งเมนู
7. `A0-7` manual content audit
8. `A1-7` data-quality aggregate report → ส่งให้ Data owner เริ่ม C2-1 ได้เร็ว

ทุกข้อจบด้วย commit แยก, tests ผ่าน, และรัน `collect-automated-readiness-evidence.js` เพื่อยืนยันว่า FAIL ยังเป็น 0

## 12. การติดตาม

- อัปเดตตารางนี้ทุกสิ้น Wave ในเอกสารนี้ (เปลี่ยน `[ ]` เป็น `[x]` พร้อมวันที่และ path หลักฐาน) — ห้ามติ๊กโดยไม่มี path
- Closure board (`outputs/go-live-closure-status/<ts>/summary.md`) เป็นแหล่งเดียวของ "ใครค้างอะไร" — regenerate หลังทุก evidence pack ใหม่
- Readiness score ตาม §9 ของ master plan คิดจาก validator เท่านั้น; รายงาน owner ทุกสัปดาห์เป็นตัวเลข + Critical/Major count + วันที่ decision ค้าง

### Checklist ระดับ Wave

- [ ] Wave 0 — decision register ครบ 8 ข้อ / RC บน production / operator-gate pack #1
- [ ] Wave 1 — RC2 / Phase 2 gate / Phase 4 closed loop / security residual มี draft
- [ ] Wave 2 — RC3 freeze / UAT scripts+accounts+LINE test / staging / คู่มือตรง RC3
- [ ] Wave 3 — UAT+restore+operator packs strict PASS / capacity report ลงนาม / Data+DPO sign-off
- [ ] Wave 4 — validators ไม่ใช้ `--allow-pending` / ลงนาม System Acceptance / final evidence package
- [ ] 12A — baseline freeze / pilot wave 1 / ขยาย wave ตาม gate
- [ ] 14 — hypercare / handover / Project Closure ลงนาม
