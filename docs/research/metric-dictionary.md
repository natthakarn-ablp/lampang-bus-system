# Metric & Data Dictionary — กรอบการวัดผลและตัวชี้วัดวิจัย

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

จัดทำ: 4 กันยายน 2569 — ถอดจาก source ที่ commit `4b80b4b` บน branch `feat/tracking-security-hardening`

สถานะเอกสาร: **พจนานุกรมตัวชี้วัดที่ถอดจากโค้ดที่มีอยู่จริง เพื่อใช้เป็นเอกสารอ้างอิงของ Phase 2 (งาน A0-3)** — เอกสารนี้ **ไม่ใช่** การอนุมัติ research protocol, **ไม่ใช่** หลักฐานการทดสอบหรือ UAT, **ไม่ใช่** ผลการวิจัย และ **ไม่ใช่** การรับรองว่าตัวชี้วัดใดพร้อมประเมิน

หลักการเขียน: ทุกข้อเท็จจริงในเอกสารนี้อ้าง `file:line` ของ source ที่อ่านจริง สิ่งที่ยังไม่มีคำตอบจากผู้มีอำนาจถูกเว้นเป็น `รอ C0-6` หรือ `รอ C0-11` และ **ห้ามเติมค่าแทน** ตาม `docs/project-closure/execution-plan-to-completion-2026-09-04.md:89`

งานต้นทาง: A0-3 ใน `docs/project-closure/execution-plan-to-completion-2026-09-04.md:95` · ข้อกำหนด Phase 2 ใน `docs/project-closure/master-project-closure-plan.md:150-163`

---

## 1. ขอบเขต แหล่งที่มา และสิ่งที่เอกสารนี้ไม่ได้ทำ

### 1.1 Source ที่อ่านครบทั้งไฟล์

| ไฟล์ | ขนาด | บทบาทในระบบวัดผล |
|---|---|---|
| `backend/src/config/researchMetrics.js` | 472 บรรทัด | Registry ตัวชี้วัด 24 รายการ + หมวด + ชนิดหลักฐาน + ค่าคงที่ freshness/observation gap |
| `backend/src/services/researchReadiness.service.js` | 308 บรรทัด | ฟังก์ชันบริสุทธิ์ที่ตัดสินว่าแต่ละ metric มีหลักฐานพอหรือยัง |
| `backend/src/config/researchProtocol.js` | 61 บรรทัด | สถานะ protocol (frozen/version/window/population) + registry หลักฐานภายนอก |
| `backend/src/routes/admin.routes.js` | — | ผู้สร้าง context จาก DB (`loadResearchEvidenceContext` :36-79), ผู้เขียน snapshot (:804-900), research export (:986-), preview (:1368-) |
| `backend/migrations/013_daily_snapshots.sql` | 29 บรรทัด | schema ของ `daily_snapshots` |
| `backend/migrations/014_snapshot_research_phase.sql` | 7 บรรทัด | เพิ่มคอลัมน์ `research_phase` |
| `backend/src/utils/audit.js` | — | ตัวเขียน `audit_logs` ตัวเดียวของระบบ (:8-12 action ที่ถูกต้อง, :44-48 INSERT) |
| `frontend/src/config/measurementFramework.js` | 491 บรรทัด | Registry ชุดที่สอง (ฝั่ง UI) พร้อม target/threshold/caution รายบทบาท |
| `frontend/src/pages/admin/MeasurementFramework.jsx` | 206 บรรทัด | หน้าที่ render registry ฝั่ง UI |
| `frontend/src/utils/evidenceStatus.js` | — | คำแปลสถานะหลักฐานฝั่ง UI |
| `backend/tests/researchReadiness.unit.test.js` | 301 บรรทัด | ทดสอบพฤติกรรมของ readiness service |

หมายเหตุ: งาน A0-3 ระบุ path `backend/src/config/measurementFramework.js` — ไฟล์ชื่อนี้ **ไม่มีอยู่ใน backend** ไฟล์จริงที่ทำหน้าที่นี้คือ `frontend/src/config/measurementFramework.js` (registry ฝั่ง UI) ส่วนต้นทางที่ `researchReadiness.service.js` import จริงคือ `backend/src/config/researchMetrics.js` (`researchReadiness.service.js:16-24`) เอกสารนี้จึงถอดจาก **ทั้งสองไฟล์** และเปรียบเทียบกันใน §6

### 1.2 สิ่งที่เอกสารนี้ไม่ทำ

- ไม่กำหนดช่วงวิจัย ไม่กำหนดประชากร ไม่ตั้งเกณฑ์ผ่าน — ทั้งสามเป็นอำนาจของ Research lead/Product owner (C0-6, C0-11)
- ไม่แก้โค้ดใด ๆ — exit evidence ของ A0-3 ระบุ unit test ที่ fail เมื่อ metric ใดไม่มี dictionary entry ไว้ด้วย (`execution-plan-to-completion-2026-09-04.md:95`) ไฟล์ที่แผนระบุเป็น validator ของ A0-3 คือ `backend/tests/researchIntegrityGuard.unit.test.js` (`execution-plan-to-completion-2026-09-04.md:291`) **ไฟล์นั้นมีอยู่จริง (105 บรรทัด) และรันผ่าน** — รัน `npx jest -c jest.unit.config.js researchIntegrityGuard` บนเครื่อง sandbox เมื่อ 4 ก.ย. 2569 ได้ 1 suite / 6 tests ผ่าน — แต่ assertion ทั้ง 6 ข้อ **ไม่มีข้อใดตรวจว่า metric ใดมี dictionary entry** ตรวจเพียงว่า: ไม่มี literal `dme_mie_ready` ใน backend (`:45-49`), ไม่มี `research_claims_allowed: true` (`:51-59`), `researchProtocol.js` ยังเป็น `frozen: false` / `research_lead_signed_off: false` (`:61-69`), ไม่มี heuristic `>= N` คู่กับ "พร้อมประเมิน" ใน UI (`:75-94`) และ 3 หน้า UI อ่าน `evidence_readiness` (`:96-103`) — **การที่คำสั่ง A0-3 ในแผนรันผ่านวันนี้จึงยังไม่ใช่หลักฐานว่าเกณฑ์ "ทุก metric มี dictionary entry" ถูกตรวจ** assertion ที่ตรวจเรื่องนั้นยังไม่มี และงานเพิ่ม assertion อยู่ที่ §10 ข้อ 5
- ไม่ยืนยันค่าจริงจากฐานข้อมูล production — เครื่องที่จัดทำเอกสารไม่มีสิทธิ์เข้าถึง (ดู §9)

---

## 2. ช่องที่ห้ามเติมเอง — รอการตัดสินใจ

`execution-plan-to-completion-2026-09-04.md:61` (C0-6) และ `:66` (C0-11) ระบุว่าค่าต่อไปนี้เป็นการตัดสินใจของคน ไม่ใช่ของทีมเทคนิค ทุกช่องด้านล่างจึงเว้นว่างตลอดทั้งเอกสาร

| ช่องข้อมูล | สถานะ | เจ้าของการตัดสินใจ | ผลถ้ามีคนเดาแทน |
|---|---|---|---|
| นิยาม "การบริหารแบบมีส่วนร่วม" และกรอบทฤษฎี | **รอ C0-6** | Research lead + อาจารย์ที่ปรึกษา | ตัวชี้วัดหมวด participation วัดคนละเรื่องกับที่ประกาศ |
| คำถามวิจัยและตัวแปร | **รอ C0-6** | Research lead | metric ที่เก็บไม่ตอบคำถามวิจัย |
| ประชากร / กลุ่มตัวอย่าง | **รอ C0-6** | Research lead | ตัวหารทุกตัวผิด และ export ระบุ population ไม่ได้ |
| ผู้ปกครอง / นักเรียน / ครูสายชั้น / ผู้เข้าประชุม อยู่ใน population หรือเป็น external evidence | **รอ C0-6** | Research lead + Product owner | ข้อมูลบุคคลถูกดึงเข้าชุดวิจัยโดยไม่มีฐานรองรับ |
| ช่วงวิจัย (`research_period`): baseline window และ post window | **รอ C0-6** | Research lead | export metadata ประกาศช่วงที่ไม่มีใครอนุมัติ (งาน A1-1) |
| เครื่องมือและเวอร์ชันเครื่องมือ (DME-6 / MIE-6) | **รอ C0-6** | Research lead | หลักฐานภายนอกอ้างเครื่องมือที่ไม่มีนิยาม |
| เกณฑ์ "พร้อมประเมิน": metric coverage กี่เปอร์เซ็นต์ | **รอ C0-11** | Research lead + Product owner | Phase 2 exit gate ตัดสินไม่ได้ |
| ชนิด external evidence ที่นับได้ | **รอ C0-11** | Research lead + Product owner | หลักฐานคุณภาพต่างกันถูกนับเท่ากัน |
| Minimum observation period | **รอ C0-11** | Research lead + Product owner | pre/post ที่สั้นเกินไปถูกรายงานเป็นผล |
| เกณฑ์ผ่าน/target รายตัวชี้วัด | **รอ C0-11** | Product owner + Research lead | ตัวเลขที่อยู่ใน UI (§6) กลายเป็นเกณฑ์โดยไม่มีใครอนุมัติ |

### 2.1 ค่าคงที่สองตัวในโค้ดที่ยัง **ไม่ใช่** คำตอบของ C0-11

โค้ดตั้งตัวเลขไว้สองตัวเพื่อกันไม่ให้ระบบรายงานค่าที่เก่าเกินไปหรือช่วงสังเกตที่สั้นเกินไป **ทั้งสองเป็น engineering guard ไม่ใช่เกณฑ์ที่ผ่านการอนุมัติ**

| ค่าคงที่ | ค่าในโค้ด | ที่มา | สถานะเชิงการตัดสินใจ |
|---|---|---|---|
| `SNAPSHOT_FRESHNESS_MAX_AGE_DAYS` | 14 วัน | `researchMetrics.js:64` (คอมเมนต์ :58-63 อธิบายว่าเทียบเท่าประมาณสองสัปดาห์ทำการ) | ยังไม่ผ่าน C0-11 |
| `MIN_BASELINE_POST_GAP_DAYS` | 30 วัน | `researchMetrics.js:70` (คอมเมนต์ :66-69) | ยังไม่ผ่าน C0-11 — C0-11 ระบุ "minimum observation period เท่าใด" เป็นคำถามที่ Research lead + Product owner ต้องตอบโดยตรง |

เมื่อ C0-11 มีคำตอบ ต้องแก้ค่าทั้งสองให้ตรงกับที่อนุมัติ หรือบันทึกไว้ว่าคำตอบตรงกับค่าเดิม — **ห้ามถือว่าค่าปัจจุบันคือคำตอบ**

---

## 3. Namespace: การแยกสี่หมวดไม่ให้ปะปน

`master-project-closure-plan.md:154` กำหนดให้ "แยก operational KPI, participation KPI, research outcome และ external evidence ไม่ให้ปะปน" หมวดถูกนิยามที่ `researchMetrics.js:30-35` และผูกกับทุก metric ผ่าน field `category`

### 3.1 นิยามและจำนวนตัวชี้วัดต่อหมวด

| หมวด (`category`) | ชื่อไทยที่ export ใช้ | สิ่งที่หมวดนี้อ้างได้ | สิ่งที่หมวดนี้อ้างไม่ได้ | จำนวน metric |
|---|---|---|---|---|
| `operational_kpi` | ตัวชี้วัดการดำเนินงาน คำนวณจากระบบได้โดยตรง (`admin.routes.js:1149`) | ระบบถูกใช้อย่างไร ข้อมูลครบแค่ไหน งานถูกปิดเร็วแค่ไหน | ผลกระทบ (effect) ของระบบต่อพฤติกรรมหรือความปลอดภัย | 14 |
| `participation_kpi` | ตัวชี้วัดการมีส่วนร่วม ต้องมีเหตุการณ์เสนอ/พิจารณา/มติ/แจ้งผลกลับ (`:1150`) | มีการเสนอ พิจารณา ตัดสิน และแจ้งผลกลับหรือไม่ | คุณภาพหรือความเป็นธรรมของการมีส่วนร่วม | 3 |
| `research_outcome` | ผลลัพธ์เชิงวิจัย ต้องมี protocol, baseline และช่วงสังเกตที่กำหนด (`:1151`) | การเปลี่ยนแปลง pre/post ภายใต้ protocol ที่ freeze แล้ว | ข้อสรุปเชิงสาเหตุเกินกว่าที่ design รองรับ | 4 |
| `external_evidence` | ต้องใช้เครื่องมือภายนอก เช่น แบบสอบถาม สัมภาษณ์ บันทึกประชุม (`:1152`) | สิ่งที่ระบบไม่มีทางรู้เอง เช่น ความพึงพอใจ ภาระงาน มติที่ประชุม | ค่าใด ๆ ที่ไม่มี record พร้อมเวอร์ชันเครื่องมือ | 3 |

รวม 24 ตัวชี้วัด (`researchMetrics.js:72-444`) จำนวนต่อหมวดนับจาก field `category` ของแต่ละรายการในไฟล์เดียวกัน

รายชื่อ metric ต่อหมวด (ใช้เป็น allowlist เวลาแยก export):

- `operational_kpi` (14): `province.report_engagement_duration`, `affiliation.alert_to_view_latency`, `school.data_completeness_rate`, `school.timeliness_of_data_entry`, `school.correction_rate`, `driver.pre_departure_checkin_rate`, `driver.completion_consistency`, `driver.usage_continuity_streak`, `transport.risk_closure_within_sla`, `transport.unresolved_risk_volume`, `transport.time_to_close_risk`, `admin.active_account_rate`, `admin.password_reset_frequency`, `admin.data_health_score`
- `participation_kpi` (3): `province.dashboard_usage_before_decision`, `affiliation.proactive_follow_up_actions`, `affiliation.pending_school_follow_up_rate`
- `research_outcome` (4): `province.proactive_awareness_rate`, `affiliation.proactive_detection_rate`, `transport.non_recurrence_rate`, `admin.onboarding_issue_rate`
- `external_evidence` (3): `province.evidence_based_policy_actions`, `school.work_burden_reduction`, `driver.ux_satisfaction_elderly`

### 3.2 กฎการไม่ปะปน — ต้องบังคับใน export ทุกฉบับ

1. **ห้ามเฉลี่ยข้ามหมวด** — `summarise()` นับแยกเป็น `by_status` และ `by_category` และไม่คืนคะแนนรวมข้ามหมวด (`researchReadiness.service.js:202-214`) มี unit test คุมพฤติกรรมนี้ (`researchReadiness.unit.test.js:277`)
2. **ห้ามยกระดับตัวเลขระบบเป็นผลวิจัย** — `evaluateMetric()` ตั้ง `research_claim_allowed: false` แบบตายตัวให้ทุก metric (`researchReadiness.service.js:198`) และ `buildEvidenceReadiness()` คืน `research_claims_allowed = (ไม่มี blocker เหลือ)` (`:293`) โดย blocker รวมถึง protocol ที่ยังไม่ freeze และการยังไม่มีลายเซ็น Research lead (`:265-270`)
3. **ทุกแถวใน export ต้องพก `category` ติดไปด้วย** — `data_dictionary.metrics` ส่ง `category` ทุกแถว (`admin.routes.js:1154-1161`) การตัดคอลัมน์นี้ออกตอนทำรายงานย่อยคือการทำให้สี่หมวดปะปนกัน
4. **สถานะรายบทบาทไม่ใช่คะแนนข้ามหมวด** — `roleCoverage()` รวมทุกหมวดของบทบาทเดียวกันเป็น `coverage_pct` (`researchReadiness.service.js:232-234`) ค่านี้อ่านได้เฉพาะว่า "หลักฐานครอบคลุมกี่ส่วนของตัวชี้วัดบทบาทนั้น" และ **เกณฑ์ว่าเท่าใดจึงพอ รอ C0-11**
5. **ปริมาณการใช้งานไม่ใช่หมวดใดใน 4 หมวด** — `action_total` ถูกส่งคู่กับหมายเหตุ `'ปริมาณการใช้งาน ไม่ใช่เกณฑ์ความพร้อมประเมิน'` (`researchReadiness.service.js:244-245`) ห้ามวางในตารางเดียวกับ metric โดยไม่มีป้ายนี้ (unit test คุมที่ `researchReadiness.unit.test.js:195`)

### 3.3 จุดที่ยังปะปนอยู่จริง ณ commit นี้

| จุด | หลักฐาน | ผลกระทบ |
|---|---|---|
| `summary.dme_mie` รวมตัวเลขที่คำนวณจาก snapshot (DME) กับช่องที่ต้องใช้เครื่องมือภายนอก (MIE) ไว้ใน object เดียว | `admin.routes.js:1088-1140` ประกอบเป็น `result.summary` ที่ `:1142` | ผู้อ่านเห็นสองสถานะทางหลักฐานในตารางเดียว ช่อง MIE เป็น `null` พร้อมคอมเมนต์ "pending" (`:1103-1106`) ซึ่งช่วยได้บางส่วนแต่ไม่มี `category` กำกับ |
| ตัวเลขใน `dme_mie` ไม่มี `key` และไม่มี `category` ที่ผูกกับ registry | เทียบ `:1088-1140` กับ `researchMetrics.js:72-444` | ดู §7 — ตัวเลขเหล่านี้ไม่มี dictionary entry |
| Registry ฝั่ง UI ไม่มีแนวคิดเรื่องหมวดเลย | `frontend/src/config/measurementFramework.js:38-491` — แต่ละ metric object มี 8 ฟิลด์คือ `title`, `desc`, `target`, `sources`, `readiness`, `forms`, `why`, `evidence` (นับได้ฟิลด์ละ 24 ครั้ง = 24 metric) ส่วน `thresholds` เป็นของระดับบทบาท ไม่ใช่ระดับ metric (`:93, 168, 242, 316, 391, 467`) และคำว่า `category:` **ไม่ปรากฏในไฟล์นี้เลย (0 ครั้ง)** เทียบกับ `researchMetrics.js` ที่กำหนด `category` ครบทั้ง 24 รายการ | หน้าจอเดียวแสดงตัวชี้วัดสี่หมวดปนกัน โดยไม่มีป้ายบอกว่าอันไหนอ้างได้แค่ไหน |

---

## 4. นิยามร่วมของทุกตัวชี้วัด

### 4.1 คำศัพท์สถานะหลักฐาน — ไม่มีค่าใดแปลว่า "พร้อมประเมิน"

| ค่า | ป้ายไทย | ความหมาย |
|---|---|---|
| `system_evidence` | มีหลักฐานระบบเบื้องต้น | เงื่อนไขหลักฐานของ metric ครบทุกข้อ **แต่ยังไม่ใช่ผลวิจัย** |
| `partial_evidence` | มีหลักฐานบางส่วน | ครบบางเงื่อนไข |
| `evidence_missing` | ยังไม่มีหลักฐานพอ | ไม่ครบสักเงื่อนไข หรือไม่มีเงื่อนไขให้ตรวจเลย |

ที่มา: `researchMetrics.js:45-56` · คำแปลฝั่ง UI `frontend/src/utils/evidenceStatus.js:15-25` · การตัดสินสถานะ `researchReadiness.service.js:168-172` · unit test ที่ยืนยันว่าไม่มี metric ใดถูกเรียกว่า "พร้อมประเมิน" `backend/tests/researchReadiness.unit.test.js:142`

### 4.2 ชนิดหลักฐานที่ metric เรียกใช้ได้ 4 แบบ

| ค่าใน `requires` | เงื่อนไขผ่าน | โค้ดที่ตรวจ |
|---|---|---|
| `system_snapshot` | มีแถวใน `daily_snapshots` และอายุไม่เกินเกณฑ์ freshness | `researchReadiness.service.js:111-116` |
| `baseline_pair` | มี baseline + post, ห่างกันไม่น้อยกว่า `MIN_BASELINE_POST_GAP_DAYS`, protocol frozen และทั้งคู่อยู่ในหน้าต่าง protocol | `:117-123` เรียก `evaluateBaselinePair` `:79-103` |
| `audit_event` | `audit_logs.entity_type` ทุกค่าที่ระบุใน `required_events` ต้องมีจำนวน > 0 | `:124-135` นับจาก query ที่ `admin.routes.js:45-58` |
| `external_instrument` | มี record ใน `EXTERNAL_EVIDENCE_REGISTRY` ที่ `collected === true` **และ** มี `instrument_version` | `:136-146` |

### 4.3 Freshness rule (ใช้กับทุก metric ที่ `requires` มี `system_snapshot`)

- อายุ snapshot = จำนวนวันเต็มระหว่าง `snapshot_date` ล่าสุดกับวันอ้างอิง (`researchReadiness.service.js:34-39, 58`)
- `fresh = age <= 14` (`:59` เทียบ `researchMetrics.js:64`)
- snapshot ที่เก่ากว่าเกณฑ์ **ไม่ถูกทิ้ง** แต่ถูกตีตรา `fresh: false` พร้อม `age_days` และ `reason: 'snapshot_stale'` (`:60-69`) เพื่อไม่ให้ตัวเลขที่คำนวณจากมันถูกอ่านเป็นสถานะปัจจุบัน
- วันถูกแปลงเป็นวันปฏิทินกรุงเทพก่อนแสดงผล (`:65` เรียก `toBangkokDate` ที่ `backend/src/utils/thaiTime.js:33`) เพราะ mysql2 คืนคอลัมน์ DATE เป็น instant 17:00Z ของวันก่อนหน้า
- ค่า freshness เดินทางไปกับตัวเลขใน export เสมอ (`admin.routes.js:1128-1129` และหมายเหตุ `:1135`)

### 4.4 Snapshot rule — ใครเขียน เขียนเมื่อไร เขียนอะไร

| ประเด็น | ข้อเท็จจริงในโค้ด |
|---|---|
| ผู้เขียนแถว `daily_snapshots` | มีเพียง `POST /api/admin/snapshots/run` (`admin.routes.js:804-900`) ทั้ง repository |
| ตัวกระตุ้น | คำสั่งของ admin ผ่าน API — **ไม่มี cron/scheduler ใน repository ที่เรียก endpoint นี้** ค้นสตริง `snapshots/run` ทั้ง repo พบ 7 ไฟล์: route เอง (`admin.routes.js:801, 804`), ปุ่มในหน้า admin ฝั่ง frontend source (`frontend/src/pages/admin/ResearchMetrics.jsx:91` — `api.post('/admin/snapshots/run', …)` ผูกกับปุ่ม "Snapshot วันนี้" / "สร้าง Baseline"), frontend bundle ที่ build จากหน้านั้น (`frontend/dist/assets/ResearchMetrics-*.js`), เอกสาร audit เก่า 2 ไฟล์ (`docs/manual-audit/phase-10-3a-api-permission-matrix.md:47`, `phase-10-3a-gap-analysis.md:78`), `outputs/rbac-matrix/20260904T044804Z/rbac-matrix.json:594-595` และเอกสารฉบับนี้ — ทั้งหมดเป็นผู้เรียกแบบ "คนกด" หรือเอกสาร ไม่มีตัวตั้งเวลา ยืนยันเพิ่ม: `setInterval` เดียวใน `backend/src` คือ `line.service.js:63` (สวีป LINE linking state) และ `backend/package.json` ไม่มี dependency ตระกูล cron/scheduler |
| `run_type` ที่เขียนได้จริง | `'baseline'` หรือ `'manual'` เท่านั้น (`:810`) — ค่า `'auto'` ที่ ENUM รองรับ (`013_daily_snapshots.sql:23`) ไม่มีผู้เขียน |
| `scope_type` ที่เขียนได้จริง | `'system'` พร้อม `scope_id = NULL` เสมอ (`:880`) — ENUM รองรับ `'school'`/`'affiliation'` (`013_daily_snapshots.sql:5`) แต่ไม่มีโค้ดใดเขียนค่าเหล่านั้น |
| ความถี่ | ไม่มีการบังคับ; unique key คือ `(snapshot_date, scope_type, scope_id)` (`013_daily_snapshots.sql:26`) และใช้ `REPLACE INTO` (`:874-880`) — รันซ้ำวันเดิมจะ **ทับ** ค่าเดิมโดยไม่เก็บประวัติ |
| baseline | ป้องกันซ้ำเฉพาะภายใน 24 ชั่วโมง (`:812-822`) ไม่มีกลไกบังคับว่า baseline มีได้ชุดเดียวต่อ protocol |
| ตราประทับช่วงวิจัย | คอลัมน์ `research_phase VARCHAR(50) NULL` (`014_snapshot_research_phase.sql:2-3`) รับค่าอิสระจาก request body (`:809`) **ไม่มี allowlist** ค่าที่ยอมรับ |

**ผลที่ตามมาซึ่งต้องระบุในทุกรายงาน:** freshness ของทุก `operational_kpi` ที่อ่านจาก snapshot ขึ้นกับการที่มีคนกดปุ่ม ไม่ใช่กระบวนการอัตโนมัติ และเพราะ snapshot มีเฉพาะ scope ระดับ `system` ตัวชี้วัดที่ประกาศ `role: 'driver'` / `'school'` / `'transport'` จึง **แยกรายบทบาทหรือรายหน่วยงานไม่ได้จากข้อมูลที่มีอยู่**

### 4.5 Baseline/post rule

`evaluateBaselinePair()` (`researchReadiness.service.js:79-103`) ปฏิเสธคู่ baseline/post ใน 5 กรณี และคืนเหตุผลเสมอ

| เหตุผลที่คืน | เงื่อนไข | บรรทัด |
|---|---|---|
| `no_baseline_snapshot` / `no_post_snapshot` | ขาด snapshot ฝั่งใดฝั่งหนึ่ง | :84-86 |
| `observation_period_too_short` | ห่างกันน้อยกว่า 30 วัน (ค่าปัจจุบัน — รอ C0-11 ยืนยัน) | :88-90 |
| `research_protocol_not_frozen` | `RESEARCH_PROTOCOL.frozen !== true` | :91-93 |
| `baseline_outside_protocol_window` | baseline อยู่ก่อน `protocol.baseline_start` | :94-98 |
| `post_outside_protocol_window` | post อยู่หลัง `protocol.post_end` | :99-101 |

ณ commit นี้ `frozen: false` (`researchProtocol.js:21`), `baseline_start: null` / `post_end: null` (`:27-30`), `population_defined: false` (`:33`), `research_lead_signed_off: false` (`:49`) จึงไม่มีคู่ baseline/post ใดผ่านได้เลย เหตุผลที่ระบบคืนคือ `research_protocol_not_frozen` และ **นี่คือคำตอบที่ถูกต้อง ไม่ใช่ error** (คอมเมนต์ `researchProtocol.js:12-16`) unit test ยืนยันว่า build มาตรฐานต้องไม่อ้างว่า protocol freeze แล้ว (`researchReadiness.unit.test.js:290`)

### 4.6 Instrument และเวอร์ชันเครื่องมือ

| ประเด็น | สถานะ |
|---|---|
| รหัสเครื่องมือที่ metric อ้าง | `DME-6` และ `MIE-6` (field `instrument` ใน `researchMetrics.js`) |
| นิยามของ DME-6 / MIE-6 | **ไม่มีไฟล์หรือเอกสารใดใน repository ที่นิยามเครื่องมือทั้งสอง** — ค้นทั้ง repo พบสตริงนี้เฉพาะใน `researchMetrics.js`, `researchProtocol.js`, `backend/tests/researchReadiness.unit.test.js`, `frontend/src/config/measurementFramework.js` และ bundle ที่ build จากไฟล์เหล่านั้น |
| ทะเบียนเวอร์ชันเครื่องมือ | `RESEARCH_PROTOCOL.instrument_versions` เป็น object ว่างที่ freeze ไว้ (`researchProtocol.js:45`) |
| ทะเบียนหลักฐานภายนอกที่เก็บได้แล้ว | `EXTERNAL_EVIDENCE_REGISTRY` เป็น object ว่าง (`researchProtocol.js:59`) unit test ยืนยันว่าเป็นค่าที่ ship จริง (`researchReadiness.unit.test.js:298`) |
| กฎการนับหลักฐานภายนอก | record ที่ไม่มี `instrument_version` ถูกปฏิเสธด้วยเหตุผล `external_evidence_unversioned` (`researchReadiness.service.js:142-144`) |

**สรุปที่ใช้กับทุก metric ในเอกสารนี้: instrument version = ไม่มี (registry ว่าง) และ "เครื่องมือรุ่นใดใช้กับช่วงใด" รอ C0-6**

### 4.7 สามช่องที่เว้นว่างเหมือนกันทั้ง 24 ตัวชี้วัด

| ช่อง | ค่า |
|---|---|
| `research_period` (baseline window / post window) | **รอ C0-6** |
| `population` (ประชากร/กลุ่มตัวอย่าง และการนับผู้ปกครอง/นักเรียน/ครูสายชั้น/ผู้เข้าประชุม) | **รอ C0-6** |
| เกณฑ์ "พร้อมประเมิน" และ target รายตัวชี้วัด | **รอ C0-11** |

ในตารางรายตัวชี้วัด §5 สามช่องนี้ปรากฏเป็นแถวเดียวชื่อ "ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน" เพื่อให้เห็นทันทีว่ายังว่าง

ปัจจุบัน research export **ไม่มีฟิลด์ `research_period` หรือ `population` เลย** — `meta` มีเพียง `date_range` ที่มาจาก query string โดยมีค่าเริ่มต้น `from = '2020-01-01'` และ `to =` วันนี้ตามเวลากรุงเทพ (`admin.routes.js:988-989, 1001`) ช่วงนี้เป็น **พารามิเตอร์ของผู้เรียก API ไม่ใช่ช่วงวิจัย** การเติมฟิลด์ `research_period` เป็นงาน A1-1 ซึ่งรอ C0-6

---

## 5. Metric dictionary — 24 ตัวชี้วัด

วิธีอ่านตาราง: "แหล่งข้อมูล" ระบุ table.column จริงเมื่อพิสูจน์ได้จากโค้ด และระบุว่า "ไม่มีแหล่งข้อมูลในระบบ" เมื่อสูตรอ้างสิ่งที่ยังไม่ถูกเก็บ · "ข้อจำกัดที่ตรวจพบ" คือช่องว่างระหว่างสิ่งที่สูตรบอกกับสิ่งที่ระบบเก็บจริง ไม่ใช่ความเห็น

### 5.1 บทบาท province

#### 5.1.1 `province.dashboard_usage_before_decision`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | การเปิดดูข้อมูลก่อนการตัดสินใจ (`researchMetrics.js:78`) |
| หมวด | `participation_kpi` (`:79`) |
| นับอะไร | จำนวนครั้งที่มีการเปิดดู dashboard ภายใน 2 ชั่วโมงก่อนมีการบันทึกการตัดสินใจ เทียบกับจำนวนการตัดสินใจทั้งหมด |
| สูตร | `count(dashboard_view within 2h before a recorded decision) / count(decisions)` (`:80`) |
| ตัวตั้ง | `audit_logs` ที่ `entity_type = 'dashboard_view'` ภายใน 2 ชั่วโมงก่อน `decision_log` (`:81`) |
| ตัวหาร | จำนวน `decision_log` ในช่วงเวลา (`:82`) |
| แหล่งข้อมูล | `audit_logs.entity_type`, `audit_logs.created_at` — `decision_log` ถูกเขียนที่ `backend/src/routes/report.routes.js:667` (action `CREATE`, เฉพาะบทบาท `province`/`admin` ตาม `backend/src/utils/decisionLog.js:23`) · **`dashboard_view` ไม่มีผู้เขียนในระบบ** |
| Missing-data rule | ถ้าไม่มี `decision_log` ในช่วง ให้รายงานเป็น `null` ห้ามแทนด้วย 0 (`:83`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; `requires: [audit_event]` (`:85`) จึงขึ้นกับการมีอยู่ของ event ไม่ใช่อายุ snapshot |
| หลักฐานที่ต้องมี | `audit_event` ของ `decision_log` และ `dashboard_view` (`:86`) |
| Instrument + version | `instrument: null` (`:87`) → ไม่มีเครื่องมือภายนอก |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ไม่มีโค้ดใดใน `backend/src` เขียน `entityType: 'dashboard_view'` (ตรวจรายการ entity type ที่มีผู้เขียนทั้งหมด) ดังนั้น metric นี้จะคืน `missing_audit_events:dashboard_view` ตลอด ไม่ว่าจะมีการเปิด dashboard จริงกี่ครั้ง · หน้าต่าง 2 ชั่วโมงยังไม่ถูก implement เป็น query ที่ใดในโค้ด — มีเฉพาะการตรวจว่า event มีอยู่หรือไม่ (`researchReadiness.service.js:124-135`) |

#### 5.1.2 `province.proactive_awareness_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราการรับรู้เหตุการณ์ผ่านระบบก่อนช่องทางเดิม (`researchMetrics.js:93`) |
| หมวด | `research_outcome` (`:94`) |
| นับอะไร | สัดส่วนเหตุการณ์สำคัญที่จังหวัดรับรู้จากระบบก่อนได้รับแจ้งทางโทรศัพท์ |
| สูตร | `(events known via system first) / (all significant events)` (`:95`) |
| ตัวตั้ง | `emergency_logs` ที่ province เปิดดูก่อนเวลาที่ได้รับแจ้งทางโทรศัพท์ (`:96`) |
| ตัวหาร | `emergency_logs` ทั้งหมดในช่วง (`:97`) |
| แหล่งข้อมูล | `emergency_logs.reported_at` (schema ใน `CLAUDE.md` §3.2 ตาราง 8) · **เวลาที่ได้รับแจ้งทางโทรศัพท์ไม่มีคอลัมน์ใดในระบบ** ต้องมาจากการสังเกต/สัมภาษณ์ (`sources: ['SL','OB','IL']` `:99`) |
| Missing-data rule | เหตุการณ์ที่ไม่มีเวลาแจ้งทางโทรศัพท์ต้องถูกตัดออกจากตัวส่วน **และต้องรายงานจำนวนที่ตัด** (`:98`) |
| Freshness / snapshot rule | ไม่อ่าน snapshot โดยตรง แต่ `baseline_pair` บังคับให้ทั้ง baseline และ post อยู่ในหน้าต่าง protocol (`:100`, ตรรกะ `researchReadiness.service.js:79-103`) |
| หลักฐานที่ต้องมี | `baseline_pair` + `external_instrument` (`:100`) |
| Instrument + version | `MIE-6` (`:102`) — **ไม่มีนิยามเครื่องมือใน repo และ `instrument_versions` ว่าง** (`researchProtocol.js:45`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ตัวตั้งต้องเทียบ timestamp สองชุดที่มีเพียงชุดเดียวอยู่ในระบบ · ยังไม่มี record หลักฐานภายนอกใด ๆ (`EXTERNAL_EVIDENCE_REGISTRY` ว่าง) จึงคืน `missing_external_evidence` เสมอ |

#### 5.1.3 `province.evidence_based_policy_actions`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | จำนวนการสั่งการที่อ้างอิงข้อมูลจากระบบ (`researchMetrics.js:108`) |
| หมวด | `external_evidence` (`:109`) |
| นับอะไร | จำนวนคำสั่ง/มติที่อ้างอิงข้อมูลจากระบบอย่างชัดเจน ต่อเดือน |
| สูตร | `count(policy actions citing system data) per month` (`:110`) |
| ตัวตั้ง | คำสั่ง/มติที่อ้างอิงข้อมูลระบบ จากบันทึกประชุมหรือการสัมภาษณ์ (`:111`) |
| ตัวหาร | เดือน (`:112`) — เป็นอัตราต่อหน่วยเวลา ไม่ใช่สัดส่วน |
| แหล่งข้อมูล | นอกระบบทั้งหมด: บันทึกประชุม (`MM`) และการสัมภาษณ์ (`IV`) (`:114`) |
| Missing-data rule | เดือนที่ไม่มีบันทึกประชุมให้เป็น `null` **ห้ามนับเป็น 0** (`:113`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; ความสดของหลักฐานคือ `collected_at` ของ record ภายนอก (`researchReadiness.service.js:145`) |
| หลักฐานที่ต้องมี | `external_instrument` (`:115`) |
| Instrument + version | `DME-6` (`:117`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน** |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | "อ้างอิงข้อมูลระบบอย่างชัดเจน" ยังไม่มีนิยามเชิงปฏิบัติการ (ต้องเป็นการอ้างชื่อรายงาน? แนบไฟล์ export? อ้าง URL?) — ขึ้นกับ C0-6 · ระบบไม่มีช่องเชื่อมบันทึกประชุมกับรายงาน (registry ฝั่ง UI เสนอ "meeting reference field ในรายงาน PDF" เป็นการปรับที่ยังไม่ทำ `frontend/src/config/measurementFramework.js:105`) |

#### 5.1.4 `province.report_engagement_duration`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ระยะเวลาที่ใช้กับรายงาน (`researchMetrics.js:123`) |
| หมวด | `operational_kpi` (`:124`) |
| นับอะไร | มัธยฐานของเวลา (วินาที) ระหว่างการเปิดรายงานกับการปิดหรือ export |
| สูตร | `median(seconds between report open and report close or export)` (`:125`) |
| ตัวตั้ง | ผลต่างเวลาระหว่าง `report_view` กับ `EXPORT` หรือการออกจากหน้า (`:126`) |
| ตัวหาร | จำนวน session ที่เปิดรายงาน (`:127`) |
| แหล่งข้อมูล | `audit_logs` — `EXPORT` มีผู้เขียนจริง (เช่น `report_csv`, `report_excel`, `report_pdf`, `report_monthly_*` ใน `backend/src/routes/report.routes.js`) · **`report_view` ไม่มีผู้เขียน** |
| Missing-data rule | session ที่ไม่มีเหตุการณ์ปิดต้องถูกตัดออก **และรายงานสัดส่วนที่ตัด** (`:128`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; `requires: [audit_event]` (`:130`) |
| หลักฐานที่ต้องมี | `audit_event` ของ `report_view` (`:131`) |
| Instrument + version | `instrument: null` (`:132`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ไม่มี `entityType: 'report_view'` ที่ใดใน `backend/src` และไม่มีการเก็บ session duration ที่ frontend — metric คืน `missing_audit_events:report_view` เสมอ · แนวคิด "session" ยังไม่มีนิยามในระบบ (ไม่มีตาราง session; auth เป็น JWT stateless ตาม `CLAUDE.md` §5.1) |

### 5.2 บทบาท affiliation

#### 5.2.1 `affiliation.proactive_detection_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราการตรวจพบปัญหาเชิงรุก (`researchMetrics.js:140`) |
| หมวด | `research_outcome` (`:141`) |
| นับอะไร | สัดส่วนปัญหาที่สังกัดพบเองก่อนโรงเรียนแจ้ง |
| สูตร | `(issues found by affiliation before school report) / (all issues)` (`:142`) |
| ตัวตั้ง | ปัญหาที่สังกัดพบก่อนโรงเรียนแจ้ง (`:143`) |
| ตัวหาร | ปัญหาทั้งหมดในช่วง (`:144`) |
| แหล่งข้อมูล | `emergency_logs` (`IL`) + การสังเกต (`OB`) + system log (`SL`) (`:146`) — **ไม่มีคอลัมน์ใดบันทึกว่าใครพบก่อน** |
| Missing-data rule | ต้องมี baseline ก่อนใช้ระบบ มิฉะนั้นรายงานเป็น `null` (`:145`) |
| Freshness / snapshot rule | ผ่าน `baseline_pair` เท่านั้น (`:147`) — ไม่อ่าน snapshot ล่าสุดโดยตรง |
| หลักฐานที่ต้องมี | `baseline_pair` (`:147`) |
| Instrument + version | `MIE-6` (`:149`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน** (สังเกต: metric นี้ระบุ instrument ไว้แต่ **ไม่ได้** ใส่ `external_instrument` ใน `requires` จึงไม่มีการตรวจว่าเครื่องมือถูกใช้จริง) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | นิยาม "ปัญหา" (issue) ไม่มีตารางรองรับ — ระบบมี `emergency_logs` และ `vehicle_inspections` แต่ไม่มี entity ชื่อ issue · การประกาศ `instrument` โดยไม่ประกาศ `external_instrument` ทำให้ metric อาจได้สถานะ `system_evidence` โดยไม่เคยมีใครใช้ MIE-6 |

#### 5.2.2 `affiliation.alert_to_view_latency`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ระยะเวลาจากการแจ้งเตือนถึงการเปิดดู (`researchMetrics.js:155`) |
| หมวด | `operational_kpi` (`:156`) |
| นับอะไร | มัธยฐานของเวลาระหว่างการแจ้งเตือนกับการเปิดดูครั้งแรก |
| สูตร | `median(view_time - alert_time)` (`:157`) |
| ตัวตั้ง | ผลต่างเวลาแจ้งเตือนกับเวลาเปิดดูครั้งแรก (`:158`) |
| ตัวหาร | จำนวนการแจ้งเตือน (`:159`) |
| แหล่งข้อมูล | `notifications.created_at` / `notifications.sent_at` (schema `CLAUDE.md` §3.2 ตาราง 9) สำหรับเวลาแจ้ง · **`alert_view` ไม่มีผู้เขียนใน `audit_logs`** |
| Missing-data rule | การแจ้งเตือนที่ไม่เคยถูกเปิดดูต้องรายงานแยกเป็น `never_viewed` **ห้ามตัดทิ้งเงียบ** (`:160`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; `requires: [audit_event]` (`:162`) |
| หลักฐานที่ต้องมี | `audit_event` ของ `alert_view` (`:163`) |
| Instrument + version | `DME-6` (`:164`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน**; ไม่ได้อยู่ใน `requires` เช่นกัน |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ไม่มี `entityType: 'alert_view'` ที่ใดใน `backend/src` → คืน `missing_audit_events:alert_view` เสมอ · ยังไม่มีนิยามว่า "alert" หมายถึงแถวใดใน `notifications` (ทุกชนิด หรือเฉพาะ `emergency`) |

#### 5.2.3 `affiliation.proactive_follow_up_actions`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | การติดตามและปิดเรื่องเชิงรุก (`researchMetrics.js:170`) |
| หมวด | `participation_kpi` (`:171`) |
| นับอะไร | สัดส่วน participation case ที่เดินจนถึงสถานะ `FEEDBACK_SENT` เทียบกับ case ที่ส่งถึงสังกัด |
| สูตร | `(cases reaching FEEDBACK_SENT) / (cases raised to affiliation)` (`:172`) |
| ตัวตั้ง | participation case ที่ปิด feedback loop ครบ (`:173`) |
| ตัวหาร | participation case ที่ส่งถึงสังกัด (`:174`) |
| แหล่งข้อมูล | `participation_cases` และ `participation_case_events` (`backend/src/routes/participation.routes.js:117-150`) · หลักฐานที่ readiness ตรวจคือ `audit_logs.entity_type = 'participation_case'` ซึ่งถูกเขียนที่ `participation.routes.js:175` |
| Missing-data rule | case ที่ยังไม่ถึงกำหนด SLA ต้องแยกรายงาน **ไม่นับเป็นล้มเหลว** (`:175`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; `requires: [audit_event]` (`:177`) |
| หลักฐานที่ต้องมี | `audit_event` ของ `participation_case` (`:178`) |
| Instrument + version | `MIE-6` (`:179`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | route ทั้งชุดถูก mount เฉพาะเมื่อ `FEATURE_PARTICIPATION_CASES=true` (`backend/src/app.js:196-197`, ค่า flag อ่านจาก `backend/src/config/env.js:237`) ถ้า C0-4 ตัดสินให้ defer feature นี้ metric จะไม่มีทางมีหลักฐานเลย · readiness ตรวจเพียงว่า event `participation_case` มีอยู่ ไม่ได้ตรวจว่ามี case ใดถึง `FEEDBACK_SENT` จริง (`researchReadiness.service.js:124-135`) |

#### 5.2.4 `affiliation.pending_school_follow_up_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | สัดส่วนโรงเรียนที่ยังค้างการติดตาม (`researchMetrics.js:185`) |
| หมวด | `participation_kpi` (`:186`) |
| นับอะไร | สัดส่วนโรงเรียนที่มีงานค้างเกิน SLA เทียบกับโรงเรียนในสังกัด |
| สูตร | `(schools with open follow-up beyond SLA) / (schools in scope)` (`:187`) |
| ตัวตั้ง | โรงเรียนที่มีงานค้างเกิน SLA (`:188`) |
| ตัวหาร | โรงเรียนในสังกัด (`:189`) |
| แหล่งข้อมูล | `schools` (ตัวหาร) + `participation_cases` ผ่าน `audit_logs.entity_type = 'participation_case'` (ตัวตั้ง) |
| Missing-data rule | โรงเรียนที่ inactive ต้องถูกตัดออกจากตัวส่วน **และรายงานจำนวนที่ตัด** (`:190`) |
| Freshness / snapshot rule | `requires` มี `system_snapshot` ด้วย (`:192`) รวมเป็น 2 เงื่อนไข สถานะจึงขึ้นกับว่าเงื่อนไขอีกข้อผ่านหรือไม่ (`researchReadiness.service.js:165-172`): ถ้ามี event `participation_case` อยู่ **แต่** snapshot เก่ากว่า 14 วัน → `partial_evidence` (met 1 จาก 2) · ถ้าไม่มี event ด้วย → `evidence_missing` (met 0) ซึ่งเป็นกรณีที่เกิดจริงเมื่อ router participation ไม่ถูก mount เพราะ `FEATURE_PARTICIPATION_CASES` ปิด (`app.js:196-197`) |
| หลักฐานที่ต้องมี | `audit_event` (`participation_case`) + `system_snapshot` (`:192-193`) |
| Instrument + version | `instrument: null` (`:194`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **ค่า SLA ไม่มีอยู่ในโค้ดใด ๆ** — ไม่มีคอลัมน์ due date ในเส้นทางที่อ่านได้จาก readiness · `daily_snapshots` ไม่มีคอลัมน์เกี่ยวกับ follow-up ที่ค้าง (`013_daily_snapshots.sql:7-20`) การประกาศ `system_snapshot` จึงเป็นการตรวจความสดของข้อมูลที่ไม่ได้ใช้คำนวณ metric นี้ · "โรงเรียน inactive" ไม่มีนิยามในระบบ (ตาราง `schools` มีเพียง `is_deleted`) |

### 5.3 บทบาท school

#### 5.3.1 `school.data_completeness_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความครบถ้วนของข้อมูลนักเรียน (`researchMetrics.js:202`) |
| หมวด | `operational_kpi` (`:203`) |
| นับอะไร | สัดส่วนนักเรียนที่มีรถผูกไว้แล้ว เทียบกับนักเรียนทั้งหมดใน snapshot |
| สูตร | `students_with_vehicle / total_students` (`:204`) |
| ตัวตั้ง | `daily_snapshots.students_with_vehicle` (`:205`) |
| ตัวหาร | `daily_snapshots.total_students` (`:206`) |
| แหล่งข้อมูล | `daily_snapshots.students_with_vehicle` / `.total_students` (`013_daily_snapshots.sql:7-8`) ซึ่งคำนวณตอนสร้าง snapshot จาก `SELECT COUNT(*) AS total, SUM(vehicle_id IS NOT NULL) AS with_vehicle FROM students WHERE is_deleted = FALSE` (`admin.routes.js:825-829`) |
| Missing-data rule | `total_students = 0` ให้รายงาน `null` **ห้ามรายงาน 0%** (`:207`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:209`) → ใช้ได้เมื่อ snapshot ใหม่กว่า 14 วัน มิฉะนั้นสถานะลดเป็น `evidence_missing` พร้อมเหตุผล `snapshot_stale` (`researchReadiness.service.js:114`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:209`) |
| Instrument + version | `DME-6` (`:211`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **"ครบถ้วน" ตามสูตรนี้แปลว่า "มี `vehicle_id`" เท่านั้น** ขณะที่ registry ฝั่ง UI นิยามตัวชี้วัดชื่อเดียวกันว่าครบทั้ง ชื่อ/ชั้น/รถ/ผู้ปกครอง/เบอร์โทร (`frontend/src/config/measurementFramework.js:202`) — สองนิยามนี้ให้ตัวเลขคนละค่า ต้องเลือกนิยามเดียวและบันทึกไว้ ซึ่งขึ้นกับตัวแปรที่ C0-6 กำหนด · snapshot เป็น scope `system` เท่านั้น จึงแยกรายโรงเรียนไม่ได้แม้ metric จะประกาศ `role: 'school'` |

#### 5.3.2 `school.timeliness_of_data_entry`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความทันเวลาในการบันทึกข้อมูล (`researchMetrics.js:217`) |
| หมวด | `operational_kpi` (`:218`) |
| นับอะไร | มัธยฐานของชั่วโมงระหว่างวันที่เกิดเหตุการณ์กับเวลาที่บันทึกลงระบบ |
| สูตร | `median(hours between event date and audit_logs.created_at)` (`:219`) |
| ตัวตั้ง | ผลต่างเวลาเหตุการณ์กับเวลาบันทึก (`:220`) |
| ตัวหาร | จำนวนรายการที่บันทึก (`:221`) |
| แหล่งข้อมูล | `audit_logs.created_at` เทียบกับวันที่ของ entity (เช่น `checkin_logs.check_date`) |
| Missing-data rule | รายการที่นำเข้าแบบ batch ต้องแยกออกจากการบันทึกรายวัน (`:222`) — แยกได้ผ่าน `audit_logs.action = 'IMPORT'` และ `students.import_batch_id` |
| Freshness / snapshot rule | ประกาศ `requires: [system_snapshot]` (`:224`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:224`) |
| Instrument + version | `instrument: null` (`:226`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **หลักฐานที่ตรวจไม่ตรงกับแหล่งข้อมูลที่สูตรใช้** — สูตรอ่าน `audit_logs` แต่ `requires` ตรวจเฉพาะความสดของ `daily_snapshots` ผลคือ metric ได้สถานะ `system_evidence` เพียงเพราะมีคนกดสร้าง snapshot โดยไม่มีการตรวจว่ามีข้อมูล audit ให้คำนวณจริง · registry ฝั่ง UI นิยาม metric ชื่อเดียวกันเป็น "จำนวนวันหลังเปิดภาคเรียนที่ข้อมูล ≥ 90% ครบ" (`frontend/src/config/measurementFramework.js:212`) ซึ่งเป็นคนละปริมาณกับมัธยฐานชั่วโมง |

#### 5.3.3 `school.correction_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราการแก้ไขข้อมูลย้อนหลัง (`researchMetrics.js:232`) |
| หมวด | `operational_kpi` (`:233`) |
| นับอะไร | สัดส่วนการแก้ไขที่เกิดภายใน 7 วันหลังการสร้างข้อมูล |
| สูตร | `count(UPDATE within 7d of CREATE) / count(CREATE)` (`:234`) |
| ตัวตั้ง | `audit_logs` action `UPDATE` ที่เกิดหลัง `CREATE` ภายใน 7 วัน (`:235`) |
| ตัวหาร | `audit_logs` action `CREATE` ของ entity เดียวกัน (`:236`) |
| แหล่งข้อมูล | `audit_logs.action`, `audit_logs.entity_type`, `audit_logs.entity_id`, `audit_logs.created_at` (action ที่ยอมรับอยู่ที่ `backend/src/utils/audit.js:8-12`) |
| Missing-data rule | การแก้ไขที่เกิดจาก import rollback ต้องถูกตัดออกและรายงานแยก (`:237`) |
| Freshness / snapshot rule | ประกาศ `requires: [system_snapshot]` (`:239`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:239`) |
| Instrument + version | `MIE-6` (`:241`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | หลักฐานที่ตรวจ (`system_snapshot`) ไม่ตรงกับแหล่งข้อมูลที่สูตรใช้ (`audit_logs`) เช่นเดียวกับ 5.3.2 · การระบุว่า "รายการใดมาจาก import rollback" ต้องอ่าน `entity_type = 'import_batch'` ประกอบ ซึ่งยังไม่มี query ใดในโค้ดทำ |

#### 5.3.4 `school.work_burden_reduction`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ภาระงานที่ลดลง (`researchMetrics.js:247`) |
| หมวด | `external_evidence` (`:248`) |
| นับอะไร | สัดส่วนเวลาทำงานต่อวันที่ลดลงเทียบกับช่วง baseline |
| สูตร | `(baseline minutes/day - post minutes/day) / baseline minutes/day` (`:249`) |
| ตัวตั้ง | ผลต่างเวลาทำงานต่อวันจาก workload diary (`:250`) |
| ตัวหาร | เวลาทำงานต่อวันช่วง baseline (`:251`) |
| แหล่งข้อมูล | นอกระบบทั้งหมด: แบบสอบถาม (`QN`), สัมภาษณ์ (`IV`), workload diary (`WL`) (`:253`) |
| Missing-data rule | ต้องมี diary ทั้งช่วง pre และ post ของผู้ตอบคนเดียวกัน มิฉะนั้น **ตัดผู้ตอบนั้นออก** (`:252`) |
| Freshness / snapshot rule | ไม่อ่าน snapshot; ผูกกับ `baseline_pair` ซึ่งบังคับหน้าต่าง protocol (`:254`) |
| หลักฐานที่ต้องมี | `external_instrument` + `baseline_pair` (`:254`) |
| Instrument + version | `DME-6` (`:256`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน** |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ตัวชี้วัดนี้ต้องผูกคำตอบรายบุคคลข้ามสองช่วงเวลา (paired design) ซึ่งกระทบการตัดสินใจเรื่อง pseudonymous ID และการนับครูสายชั้นเข้า population — **รอ C0-6** · ระบบไม่มีที่เก็บ workload diary และ registry ฝั่ง UI ระบุว่าต้องเพิ่ม workload entry point เป็นการปรับที่ยังไม่ทำ (`frontend/src/config/measurementFramework.js:253`) |

### 5.4 บทบาท driver

#### 5.4.1 `driver.pre_departure_checkin_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราการตรวจก่อนออกรถ (`researchMetrics.js:264`) |
| หมวด | `operational_kpi` (`:265`) |
| นับอะไร | สัดส่วนรอบเดินรถที่มีการบันทึก pretrip checklist ก่อนออกเดินทาง |
| สูตร | `trips with pretrip checklist / total trips` (`:266`) |
| ตัวตั้ง | `pretrip_checklist` ที่บันทึกก่อนออกเดินทาง (`:267`) |
| ตัวหาร | จำนวนรอบเดินรถทั้งหมด (`:268`) |
| แหล่งข้อมูล | `audit_logs.entity_type = 'pretrip_checklist'` ซึ่งมีผู้เขียนจริงที่ `backend/src/routes/driver.routes.js:1109` (และถูกอ่านที่ `:1064`) · **ตัวหาร "จำนวนรอบเดินรถ" ไม่มีตารางรองรับ** — ระบบไม่มี entity ชื่อ trip |
| Missing-data rule | วันหยุดหรือวันที่ไม่มีรอบต้องถูกตัดออกจากตัวส่วน (`:269`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:271`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:271`) — **ไม่ได้ประกาศ `audit_event` ของ `pretrip_checklist`** ทั้งที่สูตรใช้ค่านั้น |
| Instrument + version | `DME-6` (`:273`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | `daily_snapshots` ไม่มีคอลัมน์เกี่ยวกับ pretrip checklist หรือจำนวนรอบเดินรถ (`013_daily_snapshots.sql:7-20`) — metric ได้สถานะจากความสดของ snapshot ที่ไม่ได้มีข้อมูลของ metric นี้อยู่เลย · นิยาม "รอบเดินรถ" ต้องมาจาก C0-1 (นิยาม check-in/out) ซึ่งยังไม่ตัดสิน |

#### 5.4.2 `driver.completion_consistency`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความสม่ำเสมอของการรับ-ส่งครบ (`researchMetrics.js:279`) |
| หมวด | `operational_kpi` (`:280`) |
| นับอะไร | สัดส่วนการเช็กครบของรอบเช้าและรอบเย็นรวมกัน |
| สูตร | `(morning_done + evening_done) / (morning_total + evening_total)` (`:281`) |
| ตัวตั้ง | `daily_snapshots.morning_done + evening_done` (`:282`) |
| ตัวหาร | `daily_snapshots.morning_total + evening_total` (`:283`) |
| แหล่งข้อมูล | `daily_snapshots.morning_done` / `.morning_total` / `.evening_done` / `.evening_total` (`013_daily_snapshots.sql:14-17`) คำนวณตอนสร้าง snapshot จาก `daily_status` (done) และ `students.morning_enabled` / `.evening_enabled` (total) (`admin.routes.js:852-859`) |
| Missing-data rule | ตัวส่วนเป็น 0 ให้รายงาน `null` (`:284`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:286`) — สอดคล้องกับแหล่งข้อมูลจริง |
| หลักฐานที่ต้องมี | `system_snapshot` (`:286`) |
| Instrument + version | `instrument: null` (`:288`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ค่าที่ได้เป็นค่าทั้งระบบ ไม่ใช่รายคนขับ เพราะ snapshot มีเฉพาะ scope `system` (`admin.routes.js:880`) — ตีความเป็นตัวชี้วัดของบทบาท driver ไม่ได้โดยตรง · ตัวส่วนนับนักเรียนที่เปิดใช้บริการ ไม่ใช่นักเรียนที่มีรอบจริงในวันนั้น จึงรวมวันหยุด/วันลาไว้ด้วยถ้า snapshot ถูกสร้างในวันเหล่านั้น |

#### 5.4.3 `driver.usage_continuity_streak`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความต่อเนื่องของการใช้งาน (`researchMetrics.js:294`) |
| หมวด | `operational_kpi` (`:295`) |
| นับอะไร | มัธยฐานของจำนวนวันทำการต่อเนื่องที่คนขับแต่ละคนมีการเช็กอินอย่างน้อยหนึ่งครั้ง |
| สูตร | `median(consecutive operating days with at least one check-in per driver)` (`:296`) |
| ตัวตั้ง | จำนวนวันทำการต่อเนื่องที่มีการเช็กอิน (`:297`) |
| ตัวหาร | จำนวนวันทำการในช่วง (`:298`) |
| แหล่งข้อมูล | `checkin_logs.check_date`, `checkin_logs.checked_by` หรือ `daily_status.check_date` (schema `CLAUDE.md` §3.2 ตาราง 5-6) |
| Missing-data rule | คนขับที่เริ่มใช้งานกลางช่วงต้องนับจากวันแรกที่ใช้งานจริง (`:299`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:301`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:301`) |
| Instrument + version | `MIE-6` (`:303`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | สูตรต้องการข้อมูลรายคนขับรายวัน แต่หลักฐานที่ตรวจคือ snapshot ระดับระบบซึ่งไม่มีมิติคนขับ · **"วันทำการ" ไม่มีนิยามในระบบ** — ไม่มีปฏิทินวันเปิดเรียน มีเพียง `terms.start_date` / `.end_date` (`CLAUDE.md` §3.2 ตาราง 1) จึงแยกวันหยุดออกจากตัวส่วนไม่ได้ |

#### 5.4.4 `driver.ux_satisfaction_elderly`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความพึงพอใจการใช้งานสำหรับผู้สูงอายุ (`researchMetrics.js:309`) |
| หมวด | `external_evidence` (`:310`) |
| นับอะไร | ค่าเฉลี่ยคะแนน Likert จากแบบสอบถาม UX ของคนขับ |
| สูตร | `mean(Likert score) from driver UX questionnaire` (`:311`) |
| ตัวตั้ง | ผลรวมคะแนนความพึงพอใจ (`:312`) |
| ตัวหาร | จำนวนผู้ตอบที่ตอบครบ (`:313`) |
| แหล่งข้อมูล | นอกระบบ: แบบสอบถาม (`QN`) (`:315`) |
| Missing-data rule | แบบสอบถามที่ตอบไม่ครบข้อบังคับต้องถูกตัดออก **และรายงานอัตราการตอบกลับ** (`:314`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; ความสดคือ `collected_at` ของ record ภายนอก |
| หลักฐานที่ต้องมี | `external_instrument` (`:316`) |
| Instrument + version | `DME-6` (`:318`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน**; registry ฝั่ง UI ระบุว่าอาจใช้ SUS หรือ custom usability survey (`frontend/src/config/measurementFramework.js:312`) ซึ่งเป็นคนละเครื่องมือกัน |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ต้องตัดสินก่อนว่าเครื่องมือคือ SUS หรือแบบสอบถามที่พัฒนาเอง และเวอร์ชันใด (**รอ C0-6**) · สเกล Likert (5 ระดับหรือ 7 ระดับ) ยังไม่ถูกกำหนดที่ใด |

### 5.5 บทบาท transport

#### 5.5.1 `transport.risk_closure_within_sla`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราการปิดความเสี่ยงภายใน SLA (`researchMetrics.js:326`) |
| หมวด | `operational_kpi` (`:327`) |
| นับอะไร | สัดส่วนความเสี่ยงที่ปิดได้ภายใน SLA เทียบกับความเสี่ยงที่เปิดในช่วง |
| สูตร | `(risks closed within SLA) / (risks opened)` (`:328`) |
| ตัวตั้ง | ความเสี่ยงที่ปิดภายใน SLA (`:329`) |
| ตัวหาร | ความเสี่ยงที่เปิดในช่วง (`:330`) |
| แหล่งข้อมูล | `vehicle_inspections.result` / `.inspection_date` และ `vehicles.insurance_expiry` (`CLAUDE.md` §3.2 ตาราง 2, 7) · **ไม่มีตาราง risk case ที่มี opened_at/closed_at** |
| Missing-data rule | รายการที่ยังไม่ถึงกำหนด SLA ต้องแยกเป็น `in_progress` **ไม่นับว่าเกิน SLA** (`:331`) |
| Freshness / snapshot rule | `requires` มี `system_snapshot` (`:333`) |
| หลักฐานที่ต้องมี | `system_snapshot` + `audit_event` ของ `risk_closure` (`:333-334`) |
| Instrument + version | `MIE-6` (`:335`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **ไม่มี `entityType: 'risk_closure'` ที่ใดใน `backend/src`** → คืน `missing_audit_events:risk_closure` เสมอ · **ค่า SLA ไม่มีอยู่ในโค้ด** และ registry ฝั่ง UI ระบุเองว่ายังต้องเพิ่มตาราง `risk_cases` เพื่อทำ lifecycle tracking (`frontend/src/config/measurementFramework.js:357, 409`) |

#### 5.5.2 `transport.non_recurrence_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราที่ปัญหาไม่กลับมาเกิดซ้ำ (`researchMetrics.js:341`) |
| หมวด | `research_outcome` (`:342`) |
| นับอะไร | สัดส่วนความเสี่ยงที่ปิดแล้วไม่ถูกเปิดซ้ำภายใน 90 วัน |
| สูตร | `(closed risks not reopened within 90d) / (closed risks)` (`:343`) |
| ตัวตั้ง | ความเสี่ยงที่ปิดแล้วไม่กลับมาใน 90 วัน (`:344`) |
| ตัวหาร | ความเสี่ยงที่ปิดในช่วง (`:345`) |
| แหล่งข้อมูล | `vehicle_inspections` (ลำดับผล `PASSED` → `FAILED`/`NEEDS_FIX`) · ต้องการ event `risk_closure` ซึ่งยังไม่มีผู้เขียน |
| Missing-data rule | ต้องมีช่วงสังเกต 90 วันเต็มหลังปิด มิฉะนั้นตัดออกจากตัวส่วน (`:346`) |
| Freshness / snapshot rule | ผูกกับ `baseline_pair` (`:348`) จึงต้องมี protocol frozen |
| หลักฐานที่ต้องมี | `baseline_pair` + `audit_event` ของ `risk_closure` (`:348-349`) |
| Instrument + version | `instrument: null` (`:350`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ช่วง 90 วันในสูตรกับ `MIN_BASELINE_POST_GAP_DAYS = 30` เป็นคนละตัวเลข ยังไม่มีเอกสารใดอธิบายความสัมพันธ์ — **รอ C0-11 (minimum observation period)** · registry ฝั่ง UI ใช้ 30 วันสำหรับตัวชี้วัดชื่อเดียวกัน (`frontend/src/config/measurementFramework.js:361`) ขัดกับ 90 วันในฝั่ง backend |

#### 5.5.3 `transport.unresolved_risk_volume`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ปริมาณความเสี่ยงที่ยังไม่ปิด (`researchMetrics.js:356`) |
| หมวด | `operational_kpi` (`:357`) |
| นับอะไร | จำนวนความเสี่ยงที่ยังเปิดอยู่ ณ สิ้นช่วง |
| สูตร | `count(open risks at period end)` (`:358`) |
| ตัวตั้ง | ความเสี่ยงสถานะเปิด ณ สิ้นช่วง (`:359`) |
| ตัวหาร | `-` — เป็นค่านับ ไม่มีตัวหาร (`:360`) |
| แหล่งข้อมูล | ใกล้เคียงที่สุดคือ `daily_snapshots.vehicles_inspected` และ `.vehicles_passed` (`013_daily_snapshots.sql:12-13`) คำนวณจากผลตรวจล่าสุดต่อคัน (`admin.routes.js:843-850`) · **ไม่มีคอลัมน์ "ความเสี่ยงที่ยังเปิด" โดยตรง** |
| Missing-data rule | เป็นค่านับ ไม่มีตัวส่วน **ห้ามแปลงเป็นเปอร์เซ็นต์โดยไม่ระบุฐาน** (`:361`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:363`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:363`) |
| Instrument + version | `DME-6` (`:365`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ต้องนิยามก่อนว่า "ความเสี่ยงที่ยังเปิด" คือ (ก) รถที่ผลตรวจล่าสุดไม่ใช่ `PASSED` (ข) รถที่ประกันหมดอายุ (ค) รถที่ยังไม่เคยตรวจ หรือรวมทั้งสามอย่าง — registry ฝั่ง UI เสนอนิยาม (ก)+(ข) (`frontend/src/config/measurementFramework.js:377`) แต่ยังไม่มีการอนุมัติ · `daily_snapshots` เก็บเฉพาะจำนวนที่ตรวจแล้ว/ผ่าน จึงคำนวณจำนวนที่ยังไม่ตรวจได้เฉพาะเมื่อยอมรับว่า `total_vehicles - vehicles_inspected` คือคำตอบ ซึ่งยังไม่มีใครรับรอง |

#### 5.5.4 `transport.time_to_close_risk`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ระยะเวลาปิดความเสี่ยง (`researchMetrics.js:371`) |
| หมวด | `operational_kpi` (`:372`) |
| นับอะไร | มัธยฐานของเวลาระหว่างการเปิดกับการปิดความเสี่ยง |
| สูตร | `median(close_time - open_time)` (`:373`) |
| ตัวตั้ง | ผลต่างเวลาเปิดและปิดความเสี่ยง (`:374`) |
| ตัวหาร | จำนวนความเสี่ยงที่ปิดแล้ว (`:375`) |
| แหล่งข้อมูล | **ไม่มี** — ต้องการ `opened_at`/`closed_at` ซึ่งไม่มีตารางใดเก็บ |
| Missing-data rule | ความเสี่ยงที่ยังไม่ปิดต้องรายงานแยกเป็น `censored` **ห้ามใส่ค่า 0** (`:376`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot; `requires: [audit_event]` (`:378`) |
| หลักฐานที่ต้องมี | `audit_event` ของ `risk_closure` (`:379`) |
| Instrument + version | `instrument: null` (`:380`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ไม่มีทั้ง event `risk_closure` และตารางที่มี `opened_at` — metric นี้ยังคำนวณไม่ได้เลยในทุกกรณี · การใช้คำว่า `censored` ในกฎ missing-data บ่งชี้ว่าต้องใช้วิธี survival analysis ซึ่งยังไม่มีการระบุใน protocol ใด (**รอ C0-6**) |

### 5.6 บทบาท admin

#### 5.6.1 `admin.active_account_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | สัดส่วนบัญชีที่ใช้งานจริง (`researchMetrics.js:388`) |
| หมวด | `operational_kpi` (`:389`) |
| นับอะไร | สัดส่วนบัญชีที่ active และเคย login แล้ว เทียบกับบัญชีทั้งหมดที่ไม่ถูกลบ |
| สูตร | `active_users / total_users` (`:390`) |
| ตัวตั้ง | `daily_snapshots.active_users` (`:391`) |
| ตัวหาร | `daily_snapshots.total_users` (`:392`) |
| แหล่งข้อมูล | `daily_snapshots.active_users` / `.total_users` (`013_daily_snapshots.sql:19-20`) คำนวณจาก `SELECT COUNT(*) AS total, SUM(is_active AND last_login IS NOT NULL) AS active FROM users WHERE is_deleted = FALSE` (`admin.routes.js:861-864`) |
| Missing-data rule | บัญชีที่ถูกลบต้องไม่อยู่ในตัวส่วน (`:393`) — **ทำจริงแล้ว** ผ่าน `WHERE is_deleted = FALSE` (`admin.routes.js:863`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:395`) — สอดคล้องกับแหล่งข้อมูลจริง |
| หลักฐานที่ต้องมี | `system_snapshot` (`:395`) |
| Instrument + version | `DME-6` (`:397`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | ตัวหารรวมบัญชีทดสอบทุกชนิด — ยังไม่มีคอลัมน์หรือกติกาแยกบัญชีทดสอบออก (registry ฝั่ง UI เตือนเรื่องนี้ไว้เองที่ `frontend/src/config/measurementFramework.js:486`) การนับบัญชีทดสอบเข้า/ออกจากประชากรขึ้นกับ **C0-6** |

#### 5.6.2 `admin.password_reset_frequency`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | ความถี่ในการรีเซ็ตรหัสผ่าน (`researchMetrics.js:403`) |
| หมวด | `operational_kpi` (`:404`) |
| นับอะไร | จำนวนเหตุการณ์รีเซ็ตรหัสผ่านต่อจำนวนบัญชีที่ใช้งานในเดือนนั้น |
| สูตร | `count(password reset events) / count(active users) per month` (`:405`) |
| ตัวตั้ง | `audit_logs` ที่ `entity_type = 'password'` (`:406`) |
| ตัวหาร | จำนวนบัญชีที่ใช้งานในเดือนนั้น (`:407`) |
| แหล่งข้อมูล | `audit_logs.entity_type`, `audit_logs.action` · ตัวหารจาก `users.last_login` |
| Missing-data rule | การรีเซ็ตของบัญชีทดสอบต้องถูกตัดออก (`:408`) |
| Freshness / snapshot rule | `requires: [system_snapshot]` (`:410`) |
| หลักฐานที่ต้องมี | `system_snapshot` (`:410`) |
| Instrument + version | `instrument: null` (`:412`) |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **ตัวตั้งนับได้ 0 เสมอ** — `entity_type = 'password'` ถูก **อ่าน** ที่ `admin.routes.js:696` แต่ **ไม่มีโค้ดใดใน `backend/src` เขียนค่านั้น** การเปลี่ยนรหัสผ่านถูกบันทึกด้วย `entityType: 'user'` (`backend/src/routes/auth.routes.js:304`) และคำขอกู้คืนใช้ `entityType: 'password_reset_request'` (`backend/src/routes/adminPasswordRecovery.routes.js:405`) · ต้องเลือก entity type เดียวเป็นนิยามและแก้ทั้งฝั่งเขียนและฝั่งอ่านให้ตรงกันก่อนใช้ metric นี้ |

#### 5.6.3 `admin.onboarding_issue_rate`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | อัตราปัญหาช่วงเริ่มใช้งาน (`researchMetrics.js:418`) |
| หมวด | `research_outcome` (`:419`) |
| นับอะไร | สัดส่วนผู้ใช้ที่แจ้งปัญหาในช่วงเริ่มใช้งาน เทียบกับผู้ใช้ที่เริ่มใช้งานในช่วงนั้น |
| สูตร | `(users reporting an onboarding issue) / (users onboarded)` (`:420`) |
| ตัวตั้ง | ผู้ใช้ที่แจ้งปัญหาช่วงเริ่มใช้งาน (`:421`) |
| ตัวหาร | ผู้ใช้ที่เริ่มใช้งานในช่วง (`:422`) |
| แหล่งข้อมูล | `audit_logs` (`AL`) + การสัมภาษณ์ (`IV`) (`:424`) · **ไม่มีตาราง support request/ticket ในระบบ** |
| Missing-data rule | ผู้ใช้ที่ไม่ได้ถูกสัมภาษณ์ **ต้องไม่นับว่าไม่มีปัญหา** (`:423`) |
| Freshness / snapshot rule | ไม่ผูกกับ snapshot |
| หลักฐานที่ต้องมี | `external_instrument` (`:425`) |
| Instrument + version | `MIE-6` (`:427`) — **ไม่มีนิยาม ไม่มีเวอร์ชัน** |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | "ช่วงเริ่มใช้งาน" (registry ฝั่ง UI ระบุ 7 วันแรก `frontend/src/config/measurementFramework.js:447`) ไม่มีในฝั่ง backend และไม่มีใครอนุมัติ · การรวบรวมข้อเสนอ/ปัญหาจากผู้ใช้อยู่ในระบบหรือใช้เครื่องมือภายนอกยังเป็นคำถามค้างของ **C0-12** ซึ่งกำหนดว่าตัวชี้วัดนี้จะมีแหล่งข้อมูลชนิดใด |

#### 5.6.4 `admin.data_health_score`

| ช่อง | ค่า |
|---|---|
| ชื่อไทย | คะแนนสุขภาพข้อมูล (`researchMetrics.js:433`) |
| หมวด | `operational_kpi` (`:434`) |
| นับอะไร | ค่าเฉลี่ยถ่วงน้ำหนักของ sub-score ด้านความครบถ้วน ความไม่ซ้ำ ความไม่กำพร้า และความไม่หมดอายุ |
| สูตร | `weighted mean(completeness, duplicate-free, orphan-free, expiry-valid)` (`:435`) |
| ตัวตั้ง | ผลรวมถ่วงน้ำหนักของ sub-score (`:436`) |
| ตัวหาร | ผลรวมน้ำหนัก (`:437`) |
| แหล่งข้อมูล | `daily_snapshots` (completeness, insurance expiry) · sub-score เรื่อง duplicate/orphan ยังไม่มีคอลัมน์รองรับ |
| Missing-data rule | sub-score ที่คำนวณไม่ได้ต้องถูกตัดออก **จากทั้งตัวตั้งและน้ำหนัก** (`:438`) |
| Freshness / snapshot rule | `requires` มี `system_snapshot` (`:440`) |
| หลักฐานที่ต้องมี | `system_snapshot` + `audit_event` ของ `integrity_monitor` (`:440-441`) |
| Instrument + version | `DME-6` (`:442`) — ไม่มีนิยาม ไม่อยู่ใน `requires` |
| ช่วงวิจัย / ประชากร / เกณฑ์ผ่าน | **รอ C0-6** / **รอ C0-6** / **รอ C0-11** |
| ข้อจำกัดที่ตรวจพบ | **ไม่มี `entityType: 'integrity_monitor'` ที่ใดใน `backend/src`** → คืน `missing_audit_events:integrity_monitor` เสมอ · **น้ำหนักของ sub-score แต่ละตัวไม่มีระบุที่ใดในโค้ด** registry ฝั่ง UI เตือนเรื่องนี้เองว่า "ต้องกำหนดสูตรคำนวณและน้ำหนักแต่ละ field ให้ชัดก่อนใช้" (`frontend/src/config/measurementFramework.js:487`) — น้ำหนักเป็นการตัดสินใจเชิงวิจัย **รอ C0-6** ห้ามทีมเทคนิคตั้งเอง · sub-score `duplicate-free` และ `orphan-free` ต้องรอรายงานคุณภาพข้อมูลจากงาน A1-7 |

---

## 6. Registry สองชุดที่ยังไม่ตรงกัน

ระบบมี registry ตัวชี้วัดสองชุดที่ไม่ได้อ้างอิงกัน

| ประเด็น | ฝั่ง backend (`backend/src/config/researchMetrics.js`) | ฝั่ง frontend (`frontend/src/config/measurementFramework.js`) |
|---|---|---|
| จำนวนตัวชี้วัด | 24 (`:72-444`) | 24 (6 บทบาท × 4 `:38-491`) |
| หมวด (`category`) | มี 4 หมวด (`:30-35`) | **ไม่มี** |
| สถานะความพร้อม | คำนวณจากหลักฐานจริงบน server | ค่าคงที่ในไฟล์: `ready` / `partial` / `need_event` / `need_baseline` / `need_external` (`:7-13`) |
| ป้าย "พร้อมวัด" | ไม่มีค่าใดแปลว่าพร้อม | `READINESS.ready.label = 'พร้อมวัด'` (`:8`) และถูก render ที่ `frontend/src/pages/admin/MeasurementFramework.jsx:167` |
| เกณฑ์/target | ไม่มี | มี `target` ต่อ metric และตาราง `thresholds` 4 ระดับต่อบทบาท เช่น `'≥ 95%'` (`:203`), `'≥ 60%'` (`:64`), `'≤ 5 คัน'` (`:372`) แสดงที่ `MeasurementFramework.jsx:192` |
| แหล่งอ้างอิงของตัวเลขเกณฑ์ | — | **ไม่มีเอกสารอ้างอิงใด ๆ** ตัวเลขเป็น literal ในไฟล์ |

**กติกาที่ต้องใช้จนกว่าจะมีคำตอบ:** ตัวเลข `target` และ `thresholds` ทั้งหมดในไฟล์ฝั่ง frontend เป็นข้อเสนอของโค้ด ไม่ใช่เกณฑ์ที่ผ่านการอนุมัติ — **เกณฑ์จริงรอ C0-11** และห้ามอ้างตัวเลขเหล่านี้ในรายงาน สรุปผู้บริหาร หรือ evidence pack ใด

ความไม่ตรงกันเชิงเนื้อหาที่ตรวจพบระหว่างสอง registry (สรุปจาก §5):

| ตัวชี้วัด | ฝั่ง backend | ฝั่ง frontend | ผลถ้าไม่ตัดสิน |
|---|---|---|---|
| Data Completeness Rate | `students_with_vehicle / total_students` (`researchMetrics.js:204`) | ครบทั้ง ชื่อ/ชั้น/รถ/ผู้ปกครอง/เบอร์โทร (`measurementFramework.js:202`) | ตัวเลขเดียวกันสองค่า |
| Timeliness of Data Entry | มัธยฐานชั่วโมงจนบันทึก (`:219`) | จำนวนวันหลังเปิดเทอมจนข้อมูลครบ 90% (`:212`) | คนละปริมาณ คนละหน่วย |
| Non-recurrence Rate | ไม่กลับมาซ้ำภายใน 90 วัน (`:343`) | ภายใน 30 วัน (`:361`) | ค่าต่างกันตามหน้าต่างเวลา |
| Completion Consistency | สัดส่วนเช็กครบรวมเช้า+เย็น (`researchMetrics.js:281`) | คำต่อคำ: `'% ของเดือนที่คนขับเช็กอินครบ 100% ทุกคนในรถ (ไม่นับวันลา)'` (`measurementFramework.js:286`) — ตัวส่วนคือ "เดือน/วันทำการ" ไม่ใช่จำนวนรอบ และมีเงื่อนไข "ไม่นับวันลา" ที่ฝั่ง backend ไม่มี | คนละตัวส่วน และฝั่ง UI มีข้อยกเว้นวันลาที่ยังไม่มีนิยาม (รอ C0-1) |

---

## 7. ตัวเลขใน research export ที่ยังไม่มี dictionary entry

`GET /api/admin/research-export` ส่ง `summary.dme_mie` ที่ประกอบด้วยฟิลด์ต่อไปนี้ (`admin.routes.js:1088-1140`) **ไม่มีฟิลด์ใดในกลุ่มนี้มี `key`, `category`, `formula`, `denominator`, `missing_data_rule` หรือ `instrument` ใน registry** จึงไม่ผ่านมาตรฐาน dictionary ของ Phase 2

| ฟิลด์ | สูตรที่ implement | ที่มา | ช่องว่าง |
|---|---|---|---|
| `data_completeness_pct` | `students_with_vehicle / total_students × 100` | `:1090` | ซ้ำกับ `school.data_completeness_rate` แต่ไม่มี key ผูกกัน |
| `parent_coverage_pct` | `students_with_parent / total_students × 100` | `:1091` | **ไม่มี metric ใดใน registry** |
| `insurance_coverage_pct` | `vehicles_with_insurance / total_vehicles × 100` | `:1092` | **ไม่มี metric ใดใน registry** |
| `inspection_coverage_pct` | `vehicles_inspected / total_vehicles × 100` | `:1093` | **ไม่มี metric ใดใน registry** |
| `inspection_pass_pct` | `vehicles_passed / total_vehicles × 100` | `:1094` | **ไม่มี metric ใดใน registry** และตัวหารเป็นรถทั้งหมด ไม่ใช่รถที่ถูกตรวจ |
| `morning_completion_pct` / `evening_completion_pct` | `*_done / *_total × 100` | `:1095-1096` | ใกล้เคียง `driver.completion_consistency` แต่แยกรอบ |
| `active_user_pct` | `active_users / total_users × 100` | `:1097` | ซ้ำกับ `admin.active_account_rate` |
| `total_audit_actions`, `total_exports` | จำนวนแถว `audit_logs` ในช่วง | `:1098-1099` | เป็นปริมาณการใช้งาน ไม่ใช่ metric — ต้องติดป้ายเดียวกับ `action_total_note` |
| `role_adoption` | จำนวน action แยกตามบทบาท | `:1100` | เป็นปริมาณการใช้งาน ไม่ใช่ metric |
| `stakeholder_satisfaction`, `decision_quality_score`, `response_time_improvement`, `cost_reduction_estimate` | `null` คงที่พร้อมคอมเมนต์ "pending" | `:1103-1106` | ไม่มี metric key, ไม่มีเครื่องมือ, ไม่มีนิยาม — ปัจจุบันปลอดภัยเพราะเป็น `null` แต่ต้องมีนิยามก่อนมีใครเติมค่า |
| `delta.*` (6 ค่า: `data_completeness` `:1117`, `parent_coverage` `:1118`, `insurance_coverage` `:1119`, `inspection_coverage` `:1120`, `morning_completion` `:1121`, `evening_completion` `:1122`) | `calcDelta()` = ผลต่างเป็น percentage point ระหว่าง baseline กับ latest | `:1116-1123`, ฟังก์ชัน `:81-85` | `calcDelta` ใช้ 0 เมื่อตัวส่วนเป็น 0 (`:82-83`) ซึ่ง **ขัดกับ missing-data rule ของ metric ที่เกี่ยวข้อง** ที่กำหนดให้รายงาน `null` (`researchMetrics.js:207, 284`) |

ข้อบรรเทาที่มีอยู่แล้ว: ค่า delta ถูกส่งพร้อม `baseline_pair` และข้อความห้ามตีความเป็นผลวิจัยเมื่อคู่ baseline/post ใช้ไม่ได้ (`admin.routes.js:1136-1138`) และ meta ทั้งชุดมี `readiness_note` (`:1006`)

---

## 8. ตัวชี้วัดที่ยังไม่มีนิยามระดับ dictionary ในโค้ด

หัวข้อนี้คือรายการช่องว่างแบบชัดเจน แยกเป็น 4 กลุ่ม

### 8.1 Metric ที่มีนิยามครบแต่ไม่มีแหล่งข้อมูลให้คำนวณเลย (7 ตัวชี้วัด เรียงเป็น 5 แถวตาม event ที่ขาด)

`required_events` ที่ **ไม่มีผู้เขียนใน `backend/src`** ทำให้ metric ต่อไปนี้คืน `missing_audit_events:*` ตลอด ไม่ว่าผู้ใช้จะทำงานจริงมากแค่ไหน

| Metric | Event ที่ขาด | ผลปัจจุบัน |
|---|---|---|
| `province.dashboard_usage_before_decision` | `dashboard_view` | `evidence_missing` เสมอ (มี `decision_log` แต่ต้องครบทั้งสอง) |
| `province.report_engagement_duration` | `report_view` | `evidence_missing` เสมอ |
| `affiliation.alert_to_view_latency` | `alert_view` | `evidence_missing` เสมอ |
| `transport.risk_closure_within_sla`, `transport.non_recurrence_rate`, `transport.time_to_close_risk` | `risk_closure` | ไม่มีวันครบเงื่อนไข |
| `admin.data_health_score` | `integrity_monitor` | ไม่มีวันครบเงื่อนไข |

หลักฐาน: รายการ `entityType` ทั้งหมดที่มีผู้เขียนใน `backend/src` ไม่ปรากฏค่าเหล่านี้เลย และ `backend/src/utils/audit.js` เป็นทางเดียวที่เขียน `audit_logs` (`:44-48`)

### 8.2 Metric ที่ `requires` ไม่ตรงกับแหล่งข้อมูลของสูตร (5 รายการ)

metric เหล่านี้ประกาศ `system_snapshot` เป็นหลักฐาน แต่สูตรอ่านจากที่อื่น ผลคืออาจได้สถานะ `system_evidence` โดยที่ไม่มีใครตรวจว่าข้อมูลของ metric นั้นมีอยู่จริง

| Metric | `requires` | สูตรอ่านจาก | บรรทัด |
|---|---|---|---|
| `school.timeliness_of_data_entry` | `system_snapshot` | `audit_logs` | `researchMetrics.js:219, 224` |
| `school.correction_rate` | `system_snapshot` | `audit_logs` | `:234, 239` |
| `admin.password_reset_frequency` | `system_snapshot` | `audit_logs` (entity type ที่ไม่มีผู้เขียน) | `:405, 410` |
| `driver.pre_departure_checkin_rate` | `system_snapshot` | `audit_logs` (`pretrip_checklist`) | `:266, 271` |
| `driver.usage_continuity_streak` | `system_snapshot` | `checkin_logs` / `daily_status` รายคนขับ | `:296, 301` |

### 8.3 นิยามที่ยัง "ไม่มีคำ" ในระบบ — ต้องมีคนตัดสินก่อนจึงเขียน dictionary ให้เสร็จได้

| สิ่งที่ยังไม่มีนิยาม | ปรากฏในตัวชี้วัด | ต้องมาจาก |
|---|---|---|
| **SLA** (ค่าและจุดเริ่มนับ) | `affiliation.pending_school_follow_up_rate`, `affiliation.proactive_follow_up_actions`, `transport.risk_closure_within_sla` | Owner/Operator — เกี่ยวโยง C0-2 (ผู้อนุมัติแต่ละ queue) |
| **"ความเสี่ยง" (risk case)** และวงจร OPEN → CLOSED | ตัวชี้วัด transport ทั้ง 4 | Product owner (ยังไม่มีตารางรองรับ) |
| **"รอบเดินรถ" (trip)** | `driver.pre_departure_checkin_rate` | C0-1 (นิยาม check-in/out, absent, leave, override, void) |
| **"วันทำการ"** | `driver.usage_continuity_streak`, `driver.completion_consistency` | C0-1 + ปฏิทินภาคเรียน |
| **"ปัญหา" (issue)** | `affiliation.proactive_detection_rate` | C0-6 (ตัวแปร) |
| **น้ำหนักของ sub-score** | `admin.data_health_score` | **C0-6** |
| **"ช่วงเริ่มใช้งาน"** | `admin.onboarding_issue_rate` | C0-6 + C0-12 (ช่องทางรับ feedback) |
| **นิยามเครื่องมือ DME-6 / MIE-6 และเวอร์ชัน** | 16 ตัวชี้วัดที่อ้างรหัสเครื่องมือ | **C0-6** |
| **สเกลของแบบสอบถาม** | `driver.ux_satisfaction_elderly` | **C0-6** |
| **ช่วงวิจัย, ประชากร, เกณฑ์ผ่าน** | ทั้ง 24 ตัวชี้วัด | **C0-6 / C0-11** |

### 8.4 ตัวเลขที่ระบบส่งออกโดยไม่มี metric รองรับ

ดู §7 — 4 ฟิลด์ที่ไม่มี metric ใดใน registry เลย (`parent_coverage_pct`, `insurance_coverage_pct`, `inspection_coverage_pct`, `inspection_pass_pct`) และ 4 ฟิลด์ MIE ที่เป็น `null` โดยไม่มีนิยาม

### 8.5 สรุปเชิงตัวเลขของช่องว่าง

| หัวข้อ | จำนวน | อ้างอิง |
|---|---|---|
| Metric ใน registry | 24 | `researchMetrics.js:72-444` |
| Metric ที่มี `requires` ตรงกับแหล่งข้อมูลของสูตร | ตรวจแล้วพบว่าตรงชัดเจน 3 รายการ (`school.data_completeness_rate`, `driver.completion_consistency`, `admin.active_account_rate`) | §5.3.1, §5.4.2, §5.6.1 |
| Metric ที่ block ด้วย event ที่ไม่มีผู้เขียน | 7 | §8.1 |
| Metric ที่ `requires` ไม่ตรงกับสูตร | 5 | §8.2 |
| Metric ที่ต้องใช้หลักฐานภายนอกซึ่ง registry ยังว่าง | 5 (`external_instrument` ใน `requires`) | `researchMetrics.js:100, 115, 254, 316, 425` |
| Metric ที่ต้องใช้ `baseline_pair` ซึ่งยังผ่านไม่ได้เพราะ protocol ไม่ freeze | 4 | `researchMetrics.js:100, 147, 254, 348` |
| Metric ที่อ้างรหัสเครื่องมือแต่ไม่ประกาศ `external_instrument` ใน `requires` | `affiliation.proactive_detection_rate`, `affiliation.alert_to_view_latency`, `affiliation.proactive_follow_up_actions`, `school.data_completeness_rate`, `school.correction_rate`, `driver.pre_departure_checkin_rate`, `driver.usage_continuity_streak`, `transport.risk_closure_within_sla`, `transport.unresolved_risk_volume`, `admin.active_account_rate`, `admin.data_health_score` | เทียบ field `instrument` กับ `requires` ในแต่ละรายการ §5 |

---

## 9. สิ่งที่ยืนยันจากเครื่องนี้ไม่ได้

| ข้อ | เหตุผล | ใครยืนยันได้ |
|---|---|---|
| จำนวน snapshot จริง, วันที่ snapshot ล่าสุด และมี baseline หรือยัง | ไม่มีสิทธิ์เข้าถึงฐานข้อมูล production (read-only aggregate เท่านั้น และไม่ได้ทำในงานนี้) | Operator ผ่าน `GET /api/admin/research-export/preview` (`admin.routes.js:1368-1402`) |
| สถานะหลักฐานจริงของแต่ละ metric ณ วันนี้ | ต้องรัน `buildEvidenceReadiness` กับข้อมูลจริง | Operator/Admin ผ่าน `GET /api/admin/evaluation-summary` (`admin.routes.js:918-980`) |
| ค่า feature flag บน production (`FEATURE_PARTICIPATION_CASES`) ซึ่งกำหนดว่า `participation_case` event เกิดขึ้นได้หรือไม่ | อ่านจาก environment ของ server เท่านั้น | Operator ตามงาน A0-11 / B0-1 |
| ว่า audit event ที่ "ไม่มีผู้เขียนใน source" มีอยู่ใน production หรือไม่ (เช่นจากรุ่นเก่า) | ตรวจจาก source ได้เฉพาะรุ่นปัจจุบัน | Operator ผ่าน query aggregate บน `audit_logs.entity_type` |

หมายเหตุการอ้างอิงเวลา: เอกสารนี้ไม่ระบุอายุ snapshot เป็นตัวเลข เพราะค่าที่ปรากฏในคอมเมนต์ของ source (`researchMetrics.js:58-63` กล่าวถึงการที่ snapshot production หยุดเมื่อ 2026-06-20) เป็นข้อความในโค้ด ไม่ใช่การวัดจากฐานข้อมูลในวันนี้

---

## 10. สิ่งที่ต้องทำต่อ (ไม่ใช่การอนุมัติ เป็นรายการงาน)

| ลำดับ | งาน | ต้องมีก่อน | อ้างอิงแผน |
|---|---|---|---|
| 1 | ตอบ C0-6 (นิยาม กรอบทฤษฎี ประชากร ตัวแปร เครื่องมือ ช่วง pre/post) | — | `execution-plan-to-completion-2026-09-04.md:61` |
| 2 | ตอบ C0-11 (metric coverage, ชนิด external evidence, minimum observation period) | — | `:66` |
| 3 | เติมช่อง `research_period` / `population` ในเอกสารนี้และใน export metadata | C0-6 | A1-1 `:123` |
| 4 | แทนค่า `SNAPSHOT_FRESHNESS_MAX_AGE_DAYS` และ `MIN_BASELINE_POST_GAP_DAYS` ด้วยค่าที่อนุมัติ หรือบันทึกว่าตรงกับค่าเดิม | C0-11 | §2.1 |
| 5 | เพิ่ม assertion ลงใน `backend/tests/researchIntegrityGuard.unit.test.js` ที่มีอยู่แล้ว (ไฟล์นี้คือ validator ที่แผนระบุไว้ และวันนี้ผ่านโดยไม่ได้ตรวจเรื่อง dictionary เลย — ดู §1.2) ให้ fail เมื่อ metric ใดใน `METRICS` ไม่มี entry ในเอกสารนี้ | — (ทำได้ทันที) | A0-3 exit evidence `:95`, validator `:291` |
| 6 | แก้ `requires` ของ 5 metric ใน §8.2 ให้ตรงกับแหล่งข้อมูลของสูตร | C0-6 (เพื่อยืนยันสูตรก่อนแก้) | A1-1 |
| 7 | ตัดสินว่าจะเพิ่ม event ที่ขาด (§8.1) หรือถอน metric ที่วัดไม่ได้ออกจาก scope | C0-4 + C0-6 | A1-1 |
| 8 | รวม registry สองชุด (§6) ให้เหลือแหล่งความจริงเดียว | C0-11 (เพราะเกี่ยวกับ target/threshold) | Phase 2 exit gate `master-project-closure-plan.md:163` |

---

เอกสารนี้ยังไม่ถือว่าปิด Phase 2 — Phase 2 exit gate กำหนดว่า "ไม่มีข้อความ PASS/พร้อมวิจัยจาก heuristic ที่ไม่ได้รับรอง และชุดข้อมูลอธิบายแหล่ง/ข้อจำกัดได้ทุก metric" (`master-project-closure-plan.md:163`) ส่วนที่สองยังไม่ครบตราบใดที่ §8 ยังมีรายการค้าง
