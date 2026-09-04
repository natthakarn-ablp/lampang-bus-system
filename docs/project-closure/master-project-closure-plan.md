# แผนปิดโครงการระบบรถรับส่งนักเรียนจังหวัดลำปาง ฉบับสมบูรณ์

ชื่อระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

อัปเดต: 4 กันยายน 2569

สถานะเอกสาร: Master plan สำหรับดำเนินงานต่อและปิดโครงการ ไม่ใช่หนังสือรับรองว่าโครงการปิดแล้ว

## 1. เป้าหมายการปิดโครงการ

ทำให้ระบบพร้อมใช้งานจริงระดับจังหวัดอย่างยั่งยืน มีหลักฐานว่าฟังก์ชันหลัก สิทธิ์ ข้อมูล ความปลอดภัย สมรรถนะ การสำรอง/กู้คืน คู่มือ การอบรม และการดูแลหลังส่งมอบผ่านเกณฑ์ที่กำหนด โดยเหลือเฉพาะงานพัฒนารุ่นถัดไปที่ owner อนุมัติให้ defer อย่างชัดเจน

การปิดโครงการแบ่งเป็นสองผลลัพธ์:

1. **System Acceptance**: ระบบรุ่นที่กำหนดผ่าน technical gate, UAT และพร้อม rollout
2. **Project Closure**: ส่งมอบ owner/operator/เอกสาร/ความรู้ครบ ผ่านช่วง hypercare และลงนามปิดโครงการ

ระบบที่เปิด production อยู่แล้วไม่ถือว่าปิดโครงการโดยอัตโนมัติ และคะแนนรวมไม่สามารถทดแทน hard gate ที่ยังไม่ผ่าน

## 2. หลักควบคุม

- ข้อมูล production เป็นข้อมูลจริง ห้ามแก้เพื่อทดสอบ สาธิต หรือทำภาพคู่มือ
- งานเขียนข้อมูลให้ใช้ sandbox/UAT database หรือบัญชี pilot ที่ได้รับอนุมัติและมี rollback
- หลักฐานล่าสุดที่มี commit, เวลา, ผู้ทดสอบ และ validator ชนะเอกสาร snapshot เก่า
- ห้าม claim `100%`, `PASS` หรือ `FULL GREEN` หาก UAT/sign-off/หลักฐานจริงยังไม่เกิด
- Feature ที่ปิดไว้สามารถ defer ได้โดยไม่ขวางการปิดโครงการ หากไม่อยู่ใน accepted scope และมี owner/risk/date บันทึกไว้
- Critical และ Major defect ต้องเป็นศูนย์ก่อน System Acceptance; Minor ต้องมี owner และกำหนดแก้หรือ risk acceptance
- Secret, password, token, CID, เบอร์โทรเต็ม, LINE user ID และ recovery code ห้ามอยู่ใน git หรือ evidence pack

## 3. Baseline ที่ยืนยันได้ ณ วันที่จัดทำ

| ด้าน | สถานะที่ยืนยันได้ | หมายเหตุ |
|---|---|---|
| Production source | commit `0060c3e`, worktree สะอาด | ตรวจหลัง deploy เอกสารล่าสุด |
| Runtime | PM2 backend online, public site/health ใช้งานได้ | ต้องเก็บหลักฐานใหม่ทุก release |
| Database migration | 43 files, 0 untracked, 0 checksum drift | migration 049 ถูก apply แบบ additive |
| Unit tests | 43 suites / 445 tests ผ่าน | ยังไม่แทน role UAT และ load test |
| Build/gates | frontend build ผ่าน; postdeploy 13/13; public 5/5 | ผลจาก release ล่าสุด |
| Backup/restore | local backup, checksum/gzip, scratch restore และ off-host sync ผ่าน | ต้องทำตามรอบและแนบ operator evidence ตอนปิดงาน |
| Driver registration | เปิดใช้งานบน production | `FEATURE_DRIVER_REGISTRATION=true` |
| Advanced flags | ส่วนใหญ่ unset/ปิด | shift, ETA, geofence, deviation, QR, consent และ admin recovery |
| Admin recovery | deploy แบบ dark launch | รอ UAT ด้วย admin และ LINE จริง |
| Manuals | มี HTML/PDF และภาพแยกบทบาท; PDF ล่าสุด 31 ส.ค. 2569 | ต้องตรวจความตรงกับ release ปิดโครงการ |
| Capacity 1,000 users | ยังไม่พิสูจน์ | มี load-test suite (`backend/scripts/load-test.js` + `backend/tests/loadTest.unit.test.js`) แต่ยังไม่มีผลรันจาก environment ที่ใช้ปิด capacity gate |
| Human sign-off | ยังไม่ครบ | ห้ามตีความ technical PASS เป็นการอนุมัติแทนคน |
| Menu/IA | Admin ประมาณ 23, School 13, Affiliation 12, Province 11 เมนู | ต้องลดทางเข้าซ้ำตาม role-menu audit ก่อน final UAT |
| Research metrics | ready 9, partial 4, missing evidence 11 จาก 24 | ห้ามใช้ raw action count หรือ hardcoded readiness เป็นผลวิจัย |
| Participatory evidence | มี request/approval/audit บางส่วน | ยังขาดการร่วมเสนอ/ปรึกษา/มติ/มอบหมาย/แจ้งผลกลับแบบครบวงจร |

## 4. ขอบเขตผลิตภัณฑ์ที่จะรับรอง

### 4.1 Core scope ที่ต้องผ่านก่อน System Acceptance

- Login, เปลี่ยนรหัสผ่าน, session invalidation และ RBAC ทั้ง 6 บทบาท
- Dashboard จังหวัด ต้นสังกัด โรงเรียน ขนส่ง คนขับ และผู้ดูแลระบบตาม scope
- จัดการ/ตรวจสอบข้อมูลโรงเรียน นักเรียน ผู้ปกครอง รถ และคนขับ
- Import preview, validation, apply/rollback ใน sandbox และประวัติ import
- กระบวนการ rollout ระยะแรกที่โรงเรียนเป็นผู้เช็กนักเรียนก่อน
- รายงานรายวัน รายเดือน สรุป และเชิงนโยบาย พร้อม export/audit
- Audit log และการตรวจสอบย้อนหลังตามสิทธิ์
- Participation case/event สำหรับข้อเสนอ การรับทราบ การปรึกษา มติ การมอบหมาย การปิดงาน และการแจ้งผลกลับใน workflow ที่รับรอง
- การตรวจรถ/เอกสาร/คิวรับรองของขนส่งและโรงเรียน
- Parent LINE binding/status/notification เฉพาะ policy ที่อนุมัติให้เปิด
- การลืมรหัสผ่านด้วยตนเองครบ 6 login roles และการกู้คืนการผูก LINE ของผู้ปกครอง
- Backup, off-host, restore, monitoring, incident response และ rollback

### 4.2 Feature ที่ต้องตัดสินใจว่าจะรับรองหรือ defer

| Feature | สถานะตั้งต้น | Decision ที่ต้องมี |
|---|---|---|
| Driver shift selection | ปิด | พิจารณาเปิด Phase 12B หรือ defer พร้อมเหตุผล |
| ETA | ปิด | ต้องมี GPS/data quality และ UAT |
| Geofence | ปิด | ต้องมีจุดรับส่ง/notification policy |
| Route deviation | ปิด | ต้องมี baseline เส้นทางอย่างน้อยตามเงื่อนไขระบบ |
| Vehicle QR | ปิด | ต้องมี DPO/legal sign-off |
| QR level 3 | ปิด | ต้องมี consent และ data-minimization approval |
| Parent consent required | ปิด | ต้องรับรองข้อความ/ฐานกฎหมาย/กระบวนการถอนความยินยอม |
| Admin password recovery | dark launch | ต้องผ่าน admin + LINE UAT ก่อนเปิด |
| Account recovery ทุกสิทธิ์ | เป็น accepted scope บังคับ | ใช้ Admin เป็น pilot แล้วขยายทุก role; ผู้ปกครองใช้การผูก LINE ใหม่แทนรหัสผ่าน |

การ defer ต้องบันทึก `feature`, `เหตุผล`, `ความเสี่ยง`, `workaround`, `owner`, `target release` และยืนยันว่าเมนู/API ถูกซ่อนอย่างปลอดภัย

## 5. ระดับปัญหาและกติกาปิด defect

| ระดับ | ความหมาย | กติกาก่อนรับรอง |
|---|---|---|
| Critical | ข้อมูลเด็ก/สิทธิ์รั่ว, login ไม่ได้ทั้งระบบ, ข้อมูลจริงเสีย, check-in/out ผิดคน, backup กู้ไม่ได้ | ต้องแก้และ regression/UAT ใหม่; ห้าม rollout |
| Major | workflow หลักของบทบาทใช้ไม่ได้, scope/report ผิด, LINE ส่งผิดคน, performance ไม่รองรับโหลดที่รับรอง | ต้องแก้ก่อน System Acceptance |
| Minor | ข้อความ/spacing/ลำดับใช้งานไม่สะดวก แต่มี workaround และไม่กระทบข้อมูล/สิทธิ์ | defer ได้เมื่อมี owner และวันเป้าหมาย |

ทุก defect ต้องมีรหัส, severity, route/role, steps, expected/actual, evidence, owner, fix commit และผล retest

## 6. แผนดำเนินงานฉบับเต็ม

ลำดับนี้แทนลำดับ Phase เดิม โดยอ้างอิงผลตรวจ `docs/role-menu-participatory-research-audit-2026-09-04.md` แผนแต่ละ Phase ต้องผ่าน Exit gate ก่อนนำผลไปอ้างว่าเสร็จ แต่ Phase ที่ระบุว่างานคู่ขนานสามารถเริ่มพร้อมกันได้

### รูปแบบการดำเนินงาน

| ประเภท | ทำได้โดย | ตัวอย่าง | กติกา |
|---|---|---|---|
| A - Automated | Codex/Technical team | audit source, code/test, schema ใน sandbox, reports, validators, docs | ทำต่อเนื่องได้เมื่อ Logic ถูกยืนยัน และต้องเก็บ evidence |
| B - Sandbox/External | Technical team + Operator/provider | LINE test, load test, uptime alert, restore/reboot, staging | ห้ามใช้ production data เขียนทดสอบ และต้องมี rollback |
| C - Human decision | Owner/Research lead/DPO/UAT representatives | Logic, lawful basis, research protocol, UAT/sign-off, risk acceptance | ห้ามปลอม approval หรือใช้ automated PASS แทนลายเซ็น |

Critical path โดยประมาณ: 8-12 สัปดาห์สำหรับ system acceptance บวก hypercare 30 วัน โดยไม่รวมระยะเก็บข้อมูลวิจัยที่ต้องเป็นไปตาม protocol จริง ระยะเวลาอาจเพิ่มเมื่อรอ DPO, sandbox, LINE provider, load environment หรือผู้แทน UAT

Dependency หลัก:

1. Phase 0 ต้องผ่านก่อนแก้ Logic, เมนู หรือเครื่องมือวิจัย
2. Phase 2 ต้องผ่านก่อนสร้าง baseline/post dataset รอบใหม่
3. Phase 3-5 ทำคู่ขนานได้หลัง design review แต่รวม release เดียวกันก่อน Phase 8
4. Phase 6-7 ต้องผ่านก่อนเปิด parent/LINE/consent หรือส่งออกข้อมูลวิจัย
5. Phase 8 ต้องผ่านก่อน capacity/production rollout
6. Phase 9-10 ต้องผ่านก่อนกล่าวอ้าง capacity และ operational readiness
7. Phase 13 เริ่มเก็บผลได้เมื่อ intervention/version และ baseline ถูก freeze แล้วเท่านั้น

### Phase 0 - Governance, Logic And Research Protocol Freeze

ระยะเวลาเป้าหมาย: 3-5 วันทำการ

- [ ] แต่งตั้ง Project owner, Product owner, Technical owner, Operator, Data owner, UAT lead, Research lead และ DPO/contact
- [ ] ยืนยัน Core scope, pilot scope และ feature ที่ `accept`, `pilot` หรือ `defer`
- [ ] ยืนยัน Logic ของ rollout ระยะแรกว่าบัญชีโรงเรียนเต็มหรือครู grade scope เป็นผู้เช็กเด็ก พร้อมนิยาม check-in/out, absent, leave, override และ void
- [ ] ยืนยันเจ้าของการอนุมัติ transfer, vehicle request, roster/registration และ vehicle inspection ไม่ให้ queue ซ้ำหลายระดับ
- [ ] ยืนยันนิยาม "การบริหารแบบมีส่วนร่วม", กรอบทฤษฎี, คำถามวิจัย, ประชากร/กลุ่มตัวอย่าง, ตัวแปร, เครื่องมือ และช่วง pre/post กับอาจารย์ที่ปรึกษา/Research lead
- [ ] ตัดสินว่าผู้ปกครอง นักเรียน ครูบัญชีย่อย และผู้เข้าประชุมอยู่ใน research population หรือเป็น external evidence
- [ ] อนุมัติ target information architecture ต่อบทบาทตาม audit ล่าสุด โดยยังไม่ลบ route/API เดิม
- [ ] กำหนด issue workflow, severity, change approval, maintenance window และ release freeze

งานที่ Codex ทำได้: สร้าง decision register/template, route/menu matrix และ impact analysis

Human gate: เจ้าของ Logic, Research lead, DPO และผู้มีอำนาจต้องยืนยันจริง ห้าม Codex ลงชื่อแทน

Exit gate: decision register ครบ ไม่มี Logic/นิยามวิจัยที่ยังคลุมเครือก่อนเริ่มแก้ระบบ

### Phase 1 - Technical Rebaseline And Evidence Reset

ระยะเวลาเป้าหมาย: 2-4 วันทำการ

- [ ] สร้าง Current Status จาก production commit เดียว และติดป้ายเอกสารเก่าที่เป็น historical
- [ ] ตรวจ production แบบ read-only: commit, PM2, health, DB timezone, migration, cron, disk, RAM, swap และ certificate
- [ ] ตรวจ feature flags แบบ whitelist โดยไม่แสดง secrets
- [ ] รัน unit/integration tests, frontend build, UI label/hybrid guard, migration baseline และ dependency/security audit
- [ ] สร้าง evidence folders ใหม่สำหรับ release candidate พร้อม timestamp/checksum
- [ ] ตรวจ secret/PII scan ของ source, diff, reports และ evidence
- [ ] บันทึก baseline menu counts, API inventory และข้อมูลการใช้งานแบบ aggregate

Exit gate: source/runtime/report อ้าง commit เดียวกัน และไม่มี baseline ที่ขัดกันโดยไม่ติดป้าย

### Phase 2 - Research Integrity Remediation

ระยะเวลาเป้าหมาย: 3-5 วันทำการ

- [ ] เปลี่ยนคำว่า "พร้อมประเมิน" ที่อิง raw action count เป็น "มีหลักฐานระบบเบื้องต้น" จนกว่า metric coverage จะครบ
- [ ] ยกเลิก `dme_mie_ready: true` แบบ hardcode และส่งออก readiness แยก metric พร้อมเหตุผล/วันที่หลักฐาน
- [ ] เพิ่ม validation/allowlist/length limit ให้ decision-log และกำหนดว่าบังคับในเหตุการณ์ใด
- [ ] แยก operational KPI, participation KPI, research outcome และ external evidence ไม่ให้ปะปน
- [ ] สร้าง data dictionary, metric formula, denominator, missing-data rule, research period และ version ของเครื่องมือ
- [ ] เพิ่ม freshness rule ให้ snapshot และห้ามเปรียบเทียบ baseline/post ที่อยู่นอก protocol
- [ ] เพิ่ม test ป้องกัน readiness เกินหลักฐานและ export metadata ผิด

Exit gate: ไม่มีข้อความ PASS/พร้อมวิจัยจาก heuristic ที่ไม่ได้รับรอง และชุดข้อมูลอธิบายแหล่ง/ข้อจำกัดได้ทุก metric

### Phase 3 - Menu And Information Architecture Simplification

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์

- [ ] เพิ่ม page/action telemetry แบบ data-minimized และกำหนด retention เพื่อใช้ตัดสินเมนูจากหลักฐาน ไม่เก็บ PII
- [ ] Driver รวม registration/application และคงงานวันนี้/แผนที่/ฉุกเฉิน/โปรไฟล์ให้เข้าถึงเร็ว
- [ ] School รวมรถ+เพิ่มรถ, legacy roster+registration, vehicle workflow และ map/live โดยใช้ tabs/action ในหน้าเดิม
- [ ] Affiliation รวมโรงเรียน+บัญชี, request queues และ map/risk
- [ ] Province รวมเครือข่ายข้อมูลและแผนที่ ย้าย readiness ไป secondary governance
- [ ] Transport รวม verification/inspection เป็น end-to-end queue
- [ ] Admin ลดทางเข้าหลักจากประมาณ 23 เป็น 8 กลุ่ม และรวมหน้าวิจัยเป็น module เดียว
- [ ] เก็บ old routes เป็น redirect/compatibility อย่างน้อยหนึ่ง release และซ่อนด้วย feature flag ก่อนลบ
- [ ] ทดสอบ keyboard, focus, mobile navigation, deep link, browser back และ permission-denied state

Exit gate: ผู้แทนแต่ละบทบาททำ top tasks ได้โดยไม่หลง context, ไม่มี dead link และ old bookmark ยังไปจุดที่ถูกต้อง

### Phase 4 - Participatory Administration Workflow MVP

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์

- [ ] ออกแบบ `participation_cases` และ append-only `participation_case_events` แบบ additive migration พร้อม rollback
- [ ] รองรับ event ขั้นต่ำ: `SUBMITTED`, `ACKNOWLEDGED`, `COMMENTED`, `CONSULTED`, `DECIDED`, `ASSIGNED`, `COMPLETED`, `FEEDBACK_SENT`
- [ ] ฝัง event ใน emergency, vehicle request, transfer, roster/registration, inspection และ policy decision เดิม
- [ ] เก็บผู้ริเริ่ม ผู้เข้าร่วม ทางเลือก มติ เหตุผล ผู้รับผิดชอบ SLA ผลลัพธ์ และการแจ้งผลกลับ โดยไม่เก็บข้อมูลเกินจำเป็น
- [ ] เพิ่ม inbox "งานที่ต้องมีส่วนร่วม" แบบรวม ไม่สร้างเมนูใหม่ต่อ action
- [ ] เพิ่ม parent/teacher feedback channel ตาม scope ที่ owner/DPO อนุมัติ
- [ ] เพิ่ม aggregate participation dashboard แยกจาก operational dashboard
- [ ] ทดสอบ cross-scope, append-only audit, duplicate submission, reassignment และ closed feedback loop

Exit gate: มีอย่างน้อยหนึ่ง workflow ต่อ role ที่พิสูจน์เส้นทางเสนอ-พิจารณา-ตัดสินใจ-ดำเนินการ-แจ้งผลกลับได้ใน sandbox

### Phase 5 - Core Logic And Product Closure

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์ ทำคู่ขนาน Phase 3-4 หลัง Phase 0 ผ่าน

- [ ] สร้าง role-to-route/API/write-action matrix ฉบับ release candidate
- [ ] ปิด logic conflict ของ school first check-in, teacher grade scope, transfer, vehicle request, registration, assignment และ inspection
- [ ] ทดสอบ import preview/apply/rollback, reports, Thai date/time และ audit ใน sandbox
- [ ] ยืนยัน server-side scope ทุก query/write action ไม่พึ่งการซ่อนเมนู
- [ ] ปิด Critical/Major defect และเพิ่ม regression/negative tests
- [ ] ทำ Admin recovery pilot แล้วขยายครบทุกสิทธิ์ตาม `docs/password-recovery-all-roles-roadmap.md`
- [ ] Feature ขั้นสูงที่ไม่อยู่ accepted scope ต้องซ่อนทั้ง menu/API อย่างปลอดภัย

Exit gate: Core scope ไม่มี Critical/Major และ Logic decision ทุกข้อมี test/evidence เชื่อมกลับได้

### Phase 6 - Data Readiness, Ownership And Certification

ระยะเวลาเป้าหมาย: 1 สัปดาห์ จากนั้นติดตามต่อเนื่อง

- [ ] สร้าง aggregate data-quality score โดยไม่ export PII
- [ ] ตรวจ school-affiliation mapping, active/inactive, ownership, duplicate/orphan และข้อมูลที่จำเป็นต่อ LINE/check-in
- [ ] โรงเรียนรับรองข้อมูลตนเอง ต้นสังกัดรับรอง coverage จังหวัดรับรองภาพรวม และขนส่งรับรองผลตรวจ
- [ ] ผูก certification กับ term/batch/report/hash/exception ตาม `docs/pdpa-consent-and-data-confirmation-plan.md`
- [ ] แก้ข้อมูลผ่าน UI/audit trail เท่านั้น และบันทึก delta ระหว่าง UAT
- [ ] กำหนด correction, transfer, retention, archival และ data-subject request workflow

Exit gate: Critical/Major data defect = 0 และ Data owner certification ครบ rollout scope

### Phase 7 - Security, PDPA, Consent And Legal Closure

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์ ทำคู่ขนาน Phase 5-6

- [ ] ทำ threat/RBAC/IDOR/cross-scope review ทุกบทบาทรวม research export และ participation workflow
- [ ] ปิดหรือรับรอง refresh-token rotation, localStorage token, export rate limit/streaming และ legacy password risks
- [ ] หมุน secrets ที่ครบกำหนดโดยไม่บันทึกค่าใน git/evidence
- [ ] DPO/legal รับรอง data inventory, purpose, lawful basis, minimization, retention, LINE, QR และข้อมูลอ่อนไหว
- [ ] แยก Consent, Acknowledgement และ Data Certification พร้อม version/snapshot/withdrawal
- [ ] ปิดช่องว่าง ParentStatus consent, parent endpoint gate, feature dependency และ withdrawal cascade ทุกช่องทาง
- [ ] ทำ DPIA/incident playbook สำหรับข้อมูลเด็ก, LINE ผิดคน, export หลุด และ participation comments

Exit gate: ไม่มี Critical/Major security/privacy finding, DPO decision ครบ และ residual risk ลงนามจริง

### Phase 8 - Full Role UAT, Usability And Accessibility

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์

- [ ] สร้าง sandbox/test accounts: admin, province, affiliation, school full, school teacher, driver, transport และ LINE parent
- [ ] ใช้ synthetic data และ LINE test account ห้ามเขียนทดสอบกับข้อมูลเด็กจริง
- [ ] ทดสอบ top tasks, negative paths, refusal/consent, cross-scope, recovery และ old-route redirects
- [ ] วัด task completion, time-on-task, error, help request และความสับสนของเมนูก่อน/หลังปรับ
- [ ] ทดสอบ participation case ตั้งแต่เสนอจน feedback sent
- [ ] ตรวจ responsive 390/768/1440, keyboard, focus, contrast, target size และ screen reader labels
- [ ] เก็บภาพ redacted/audit IDs และรัน evidence validator แบบ strict

Exit gate: accepted role/workflow PASS, Critical/Major = 0, usability target ผ่าน และผู้แทนจริงลงนาม

### Phase 9 - Capacity 1,000 Users And Infrastructure

ระยะเวลาเป้าหมาย: 1 สัปดาห์เตรียม + 1 สัปดาห์ปรับแก้

ห้ามทดสอบ write load บน production และห้ามกล่าวว่ารองรับ 1,000 concurrent users จนมีหลักฐานจริง

- [ ] สร้าง staging ใกล้ production ด้วย synthetic/masked data
- [ ] สร้าง workload สำหรับ login, dashboards, school check-in, reports, participation events, GPS และ parent status
- [ ] รัน ramp 50/200/500/1,000, peak และ soak อย่างน้อย 60 นาที
- [ ] เก็บ p50/p95/p99, throughput, error, DB pool/slow query, CPU/RAM/swap, event-loop lag และ LINE queue
- [ ] เกณฑ์เริ่มต้น: error <1%, ไม่มีข้อมูลซ้ำ/หาย, read p95 <=1 วินาที, write p95 <=2 วินาที และฟื้นหลัง peak ได้
- [ ] ย้าย shared state ไป Redis/DB ก่อน scale หลาย instance และปรับ index/pool/cache/report streaming ตามผล
- [ ] ประกาศ capacity limit/degradation policy ตามผลจริง

Exit gate: รายงานทำซ้ำได้และ Technical owner/Operator ลงนาม ถ้าไม่ผ่านต้องประกาศ limit จริง

### Phase 10 - Resilience, DR And Production Operations

ระยะเวลาเป้าหมาย: 3-5 วันทำการ + maintenance window

- [ ] กำหนด RPO/RTO, retention, off-host backup owner, on-call และ restore frequency
- [ ] ทำ scratch restore และพิสูจน์ production aggregate ไม่เปลี่ยน
- [ ] ทำ controlled reboot แล้วตรวจ PM2/nginx/MySQL/cron กลับมาภายใน RTO
- [ ] เปิดและทดสอบ external uptime/disk/certificate/backup alerts
- [ ] ทดสอบ rollback code, frontend, feature flags และ migration
- [ ] ตรวจ log rotation, timezone, disk threshold และ incident escalation
- [ ] ทำ operator gate และ monitor 30-60 นาทีด้วย redacted evidence

Exit gate: production/postdeploy/restore/operator validators ผ่าน และ Operator ลงนาม

### Phase 11 - Manuals, Training And Change Management

ระยะเวลาเป้าหมาย: 1 สัปดาห์

- [ ] Regenerate คู่มือ/ภาพ/PDF/เว็บไซต์ตามเมนูและ feature flags รุ่นจริง
- [ ] ทำ quick guide แยก role โดยสอน top tasks ไม่สอนทุกหน้าที่ซ่อนอยู่
- [ ] เพิ่ม troubleshooting, support, recovery, privacy, feedback และ incident channels
- [ ] อบรม admin, จังหวัด, สังกัด, โรงเรียน, ครู, ขนส่ง, คนขับ และผู้ปกครอง
- [ ] เก็บ attendance, competency exercise, feedback และคำถามค้าง
- [ ] จัดทำประกาศ scope, capacity, privacy และ change freeze

Exit gate: คู่มือตรง production, ผู้แทนผ่านแบบฝึก และ Training sign-off ครบ

### Phase 12 - Controlled Rollout ตามปีการศึกษา

#### Phase 12A: เทอม 2 ปีการศึกษา 2569

- โรงเรียนเป็นผู้เช็กเด็กตาม Logic ที่รับรองใน Phase 0
- เปิด data/import/check-in/report/requests/inspection และ participatory workflow เฉพาะส่วนที่ผ่าน UAT
- สังกัดติดตามความครบถ้วน รับทราบ มอบหมาย และปิด feedback loop กับโรงเรียน
- จังหวัดใช้ aggregate dashboard/report และบันทึกมติที่มีหลักฐาน
- ขนส่งตรวจ/รับรองรถโดยไม่เห็น PII เกินจำเป็น
- เปิด LINE เฉพาะ workflow ที่ผ่าน DPO/UAT และคง advanced flags ที่ยังไม่ผ่านไว้เป็น off
- pilot กลุ่มเล็กก่อน แล้วขยายทีละ wave หลัง monitor/gate ผ่าน

#### Phase 12B: เทอม 1 ปีการศึกษา 2570

- ขยายคนขับให้ check-in/out/shift ตาม Logic และผล Phase 12A
- ขยาย Parent LINE adoption/feedback/notification ตาม policy
- พิจารณา ETA/geofence/deviation/QR ทีละ feature ไม่เปิดรวมกัน
- เปรียบเทียบ KPI, incident, response, workload และ participation closure กับ Phase 12A

Exit gate ต่อ wave: Critical = 0, Major ที่กระทบ wave = 0, monitoring ปกติ และ owner อนุมัติขยาย

### Phase 13 - Research Data Collection And Evaluation

ระยะเวลาเป้าหมาย: ตาม protocol ที่ Research lead อนุมัติ ไม่ผูกกับการ deploy เพียงวันเดียว

- [ ] Freeze baseline ก่อน intervention ตามวัน/กลุ่มที่กำหนด และบันทึก contamination/confounders
- [ ] รัน snapshot ตาม schedule พร้อม freshness/completeness checks
- [ ] เก็บ external evidence: แบบสอบถาม สัมภาษณ์ บันทึกประชุม และ workload diary ตาม consent/ethics approval
- [ ] เชื่อมหลักฐานระบบกับ participation case โดยใช้ pseudonymous IDs
- [ ] วิเคราะห์แยก operational outcome, participation process, perceived benefit และ equity
- [ ] ทำ missing-data/sensitivity/triangulation review และไม่อ้าง causal effect เกิน design
- [ ] สร้าง reproducible export พร้อม data dictionary, version, query/checksum และ disclosure review

Exit gate: Research lead รับรอง protocol adherence, dataset freeze และข้อจำกัดก่อนนำเสนอผล

### Phase 14 - Hypercare, Handover And Formal Closure

ระยะเวลาเป้าหมาย: 30 วันหลัง rollout wave สุดท้าย

- [ ] เฝ้าระวังรายวันสัปดาห์แรกและรายสัปดาห์จนจบ hypercare
- [ ] สรุป incident, support, adoption, data quality, participation closure, uptime และ capacity
- [ ] ปิด Critical/Major; Minor เข้า maintenance backlog พร้อม owner/date
- [ ] ส่งมอบ repository, deployment, secret ownership, DB/backup, LINE Console, domain/DNS และ monitoring โดยไม่ส่ง secret ผ่าน git
- [ ] ส่งมอบ architecture, schema, API/RBAC, research dictionary, runbook, DR, manuals และ training records
- [ ] Tag final release และสร้าง immutable closure/research evidence bundle พร้อม checksums
- [ ] ยืนยัน operator, SLA, งบ/renewal และผู้ดูแลหลังส่งมอบ
- [ ] ลงนาม System Acceptance, Dataset Freeze และ Project Closure ตามขอบเขตจริง

Exit gate: Definition of Done ผ่านทุกข้อและผู้มีอำนาจลงนามจริง

## 7. Role Acceptance Matrix

| กลุ่ม | งานขั้นต่ำที่ต้องพิสูจน์ | ผู้รับรอง |
|---|---|---|
| Admin | users, recovery, audit, operations, research evidence, term/settings และ unified scope | System owner |
| Province | dashboard, network/risk, reports/policy, decision evidence, audit และ participation follow-up | ตัวแทนจังหวัด |
| Affiliation | scope โรงเรียน/accounts, request inbox, follow-up/feedback closure และ reports | ตัวแทนต้นสังกัด |
| School full | import/certification, students, vehicles, check-in/out ระยะแรก, requests, participation feedback, reports และ audit | ผู้บริหาร/ผู้รับผิดชอบโรงเรียน |
| School teacher | เห็นเฉพาะ grade scope และทำได้เฉพาะ write action ที่ Phase 0 อนุมัติ | โรงเรียน |
| Driver | roster, pretrip, emergency และ workflow ที่อนุมัติให้เปิดใน Phase 12B | คนขับ/โรงเรียน |
| Transport | inspection, verification, documents, pickup map โดยไม่เห็น PII เกินจำเป็น | ตัวแทนขนส่ง |
| Parent/LINE | bind/status/notification/unbind/rebind/privacy/feedback เฉพาะบุตรหลาน | ตัวแทนผู้ปกครอง + DPO |
| Operator | deploy, monitor, backup, restore, rollback, incident | Technical owner |

## 8. RACI หลัก

| งาน | Accountable | Responsible | Consulted |
|---|---|---|---|
| Scope/Go-Live | Project owner | Product owner | ทุกหน่วยงาน |
| Business logic | Product owner | เจ้าของ workflow | School/Affiliation/Province/Transport |
| Research protocol/metrics | Research lead | Research team/Developer | อาจารย์ที่ปรึกษา/Product owner/DPO |
| Information architecture | Product owner | UX/Developer | ตัวแทนทุกบทบาท |
| Participation workflow | Product owner | Developer/Workflow owners | Province/Affiliation/School/Transport/Driver/Parent |
| Source/Test/Deploy | Technical owner | Developer/Operator | Project owner |
| ข้อมูลจริง | Data owner | โรงเรียน/ต้นสังกัด | DPO/Technical owner |
| PDPA/Consent/LINE | Project owner/DPO | DPO contact | Legal/School/Parent |
| Capacity/DR | Technical owner | Operator | Hosting provider |
| UAT | UAT lead | ตัวแทนแต่ละบทบาท | Technical owner |
| Training/Manual | Product owner | Trainer | ตัวแทนผู้ใช้ |
| Project closure | Project owner | PM/Secretary | Technical owner/Operator/DPO |

ชื่อบุคคลจริง ช่องทางติดต่อ และผู้แทนสำรองต้องกรอกใน closure bundle นอก source หากมีข้อมูลส่วนบุคคล

## 9. Readiness Score ที่ใช้ติดตาม

| หมวด | น้ำหนัก |
|---|---:|
| Core functionality และ RBAC | 15% |
| UAT/usability ทุกบทบาท | 15% |
| Data readiness | 10% |
| Research integrity และ participatory evidence | 15% |
| Security/PDPA | 15% |
| Capacity/performance | 10% |
| Operations/DR | 10% |
| Manuals/training | 5% |
| Governance/sign-off | 5% |
| รวม | 100% |

คิดคะแนนจาก evidence ที่ validator/ผู้รับผิดชอบรับรองเท่านั้น หมวดที่ไม่มีหลักฐานได้ 0 ในส่วนนั้น และต่อให้คะแนนรวมสูงก็ห้ามปิดงานเมื่อ hard gate ใดเป็น FAIL

## 10. Hard Gates ก่อนประกาศ 100%

- [ ] Release candidate commit ตรงกับ `/health.data.commit` และ server worktree สะอาด
- [ ] Tests/build/dependency/security/migration validators ผ่าน
- [ ] Research protocol/metric dictionary ถูก freeze และไม่มี hardcoded readiness หรือคำว่า "พร้อมประเมิน" จาก raw action count
- [ ] Menu/IA ผ่าน role usability UAT และ old routes มี redirect/rollback ที่ตรวจได้
- [ ] Participation workflow พิสูจน์ closed feedback loop ตาม accepted scope
- [ ] UAT evidence pack ทุกบทบาทผ่าน strict validator
- [ ] Account recovery ทุก login role และ parent LINE re-link ผ่าน UAT ตาม policy ของบทบาท
- [ ] Critical = 0, Major = 0
- [ ] Data owner รับรองข้อมูลใน rollout scope
- [ ] DPO/legal decision ครบตาม feature ที่เปิด
- [ ] Consent/Acknowledgement/Data Certification ผ่าน Matrix และ UAT ใน `docs/pdpa-consent-and-data-confirmation-plan.md`
- [ ] Capacity test ผ่านค่าที่ประกาศ โดยเฉพาะคำกล่าวรองรับ 1,000 concurrent users
- [ ] Backup/off-host/restore/reboot/rollback/monitor ผ่านพร้อมหลักฐาน
- [ ] คู่มือและเว็บไซต์ตรงกับ release ปัจจุบัน
- [ ] Training attendance และ role competency ครบ
- [ ] Owner, Technical owner, Operator, UAT lead, DPO และตัวแทนหน่วยงานลงนามตามขอบเขตจริง
- [ ] Final readiness, bundle และ closure validators ผ่านโดยไม่มี `--allow-pending`

## 11. Final Evidence Package

ต้องมีอย่างน้อย:

- Approved scope, decision register และ accepted/deferred feature list
- Release commit/tag, change log, migration status และ dependency lockfiles
- Test/build/security/accessibility/load-test reports
- Approved research protocol, metric/data dictionary, instrument versions และ evidence-readiness matrix
- Menu inventory ก่อน/หลัง, redirect map, usability results และ feature-flag rollback evidence
- Participation case/event aggregate และ closed-feedback-loop evidence แบบ redacted
- UAT evidence/sign-off แยกบทบาท
- Data-quality report และ Data owner certification
- DPO/privacy/legal decisions
- Consent, privacy acknowledgement และ data-certification evidence ตามเวอร์ชัน/ขอบเขต โดย redact ข้อมูลระบุตัวบุคคล
- Backup/off-host/restore/reboot/rollback/monitor logs แบบ redacted
- คู่มือ HTML/PDF, training deck, attendance และ FAQ
- Incident/support/hypercare summary
- Asset/access handover checklist และ maintenance/SLA plan
- Final readiness scorecard, go-live bundle และ closure board ที่ validator ผ่าน

## 12. คำสั่งตรวจรับทางเทคนิคชุดสุดท้าย

ใช้ path/evidence timestamp ของ release candidate จริง:

```bash
cd /home/schoolbus/apps/lampang-bus-system
git status --short
git rev-parse --short HEAD
cd backend && npm run test:unit && node scripts/validate-migration-baseline.js --db
cd ../frontend && npm run build && npm run check:labels:strict && npm run check:hybrid-ui
cd ..
bash scripts/production-readiness-gate.sh postdeploy
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
node scripts/validate-go-live-signoff.js
node scripts/verify-100-readiness.js --evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp>
node scripts/validate-go-live-closure-status.js outputs/go-live-closure-status/<timestamp>
```

ห้ามแทน `<timestamp>` ด้วยการเดา และห้ามใช้ `--allow-pending` ในชุดปิดโครงการ

## 13. ลำดับเริ่มงานทันที

> แผนปฏิบัติรายสัปดาห์ (Wave 0–4, rollout, closure) พร้อม owner/dependency/evidence ต่อข้อ อยู่ที่ `execution-plan-to-completion-2026-09-04.md` — เอกสารนี้คงเป็นกรอบ Phase/Exit gate

1. Owner/Research lead/DPO ยืนยัน Phase 0: Logic, research protocol, population, menu target และผู้รับผิดชอบ
2. Technical team ทำ Phase 1 rebaseline จาก release candidate เดียว
3. แก้ research integrity ใน Phase 2 ก่อนเก็บ baseline/post รอบใหม่
4. ทำ Phase 3 menu simplification และ Phase 4 participation workflow โดยรักษา compatibility
5. ปิด Core/Data/Security ใน Phase 5-7 และทำงานอัตโนมัติที่ทำได้ต่อเนื่อง
6. ทำ Full Role UAT/usability/accessibility ใน sandbox ตาม Phase 8
7. พิสูจน์ capacity และ operations/DR ใน Phase 9-10
8. Regenerate คู่มือ อบรม และ rollout ทีละ wave ใน Phase 11-12
9. เก็บ/ตรวจ dataset ตาม protocol ใน Phase 13
10. Hypercare ส่งมอบ และลงนามปิดโครงการใน Phase 14

## 14. Definition Of Done ระดับโครงการ

โครงการถือว่าปิดสมบูรณ์เมื่อ:

1. Accepted scope ทำงานบน production และมีหลักฐานตาม release เดียวกัน
2. ผู้ใช้ทุกบทบาทใน scope ผ่าน UAT และอบรม
3. ข้อมูลจริงมี owner และผ่านเกณฑ์คุณภาพ
4. ระบบผ่าน security/privacy/capacity/DR gates
5. Research readiness อิง metric evidence จริง และ participation closed loop ผ่าน accepted scope
6. เมนูผ่าน role usability UAT โดยไม่มี workflow ซ้ำที่ทำให้ผู้ใช้ตัดสินใจผิด
7. ไม่มี Critical/Major defect ค้าง
8. มี operator, backup owner, support, SLA และงบดูแลต่อ
9. เอกสาร/คู่มือ/access/assets ส่งมอบครบ
10. Final validators ผ่านแบบ strict
11. ผู้มีอำนาจทุกฝ่ายลงนามจริง
12. สิ่งที่ defer ถูกย้ายไป maintenance roadmap พร้อม owner/date และไม่แอบรวมเป็นงานที่เสร็จแล้ว
