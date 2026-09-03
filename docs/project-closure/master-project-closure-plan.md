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
| Capacity 1,000 users | ยังไม่พิสูจน์ | ไม่มี load-test suite/result ที่ใช้ปิด gate ได้ |
| Human sign-off | ยังไม่ครบ | ห้ามตีความ technical PASS เป็นการอนุมัติแทนคน |

## 4. ขอบเขตผลิตภัณฑ์ที่จะรับรอง

### 4.1 Core scope ที่ต้องผ่านก่อน System Acceptance

- Login, เปลี่ยนรหัสผ่าน, session invalidation และ RBAC ทั้ง 6 บทบาท
- Dashboard จังหวัด ต้นสังกัด โรงเรียน ขนส่ง คนขับ และผู้ดูแลระบบตาม scope
- จัดการ/ตรวจสอบข้อมูลโรงเรียน นักเรียน ผู้ปกครอง รถ และคนขับ
- Import preview, validation, apply/rollback ใน sandbox และประวัติ import
- กระบวนการ Phase 1 ที่โรงเรียนเป็นผู้เช็กนักเรียนก่อน
- รายงานรายวัน รายเดือน สรุป และเชิงนโยบาย พร้อม export/audit
- Audit log และการตรวจสอบย้อนหลังตามสิทธิ์
- การตรวจรถ/เอกสาร/คิวรับรองของขนส่งและโรงเรียน
- Parent LINE binding/status/notification เฉพาะ policy ที่อนุมัติให้เปิด
- การลืมรหัสผ่านด้วยตนเองครบ 6 login roles และการกู้คืนการผูก LINE ของผู้ปกครอง
- Backup, off-host, restore, monitoring, incident response และ rollback

### 4.2 Feature ที่ต้องตัดสินใจว่าจะรับรองหรือ defer

| Feature | สถานะตั้งต้น | Decision ที่ต้องมี |
|---|---|---|
| Driver shift selection | ปิด | เปิด Phase 2 หรือ defer พร้อมเหตุผล |
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

## 6. แผนดำเนินงานเป็นเฟส

### Phase 0 - Project Control And Scope Freeze

ระยะเวลาเป้าหมาย: 2-3 วันทำการ

- [ ] แต่งตั้ง Project owner, Product owner, Technical owner, Operator, Data owner และ DPO/contact
- [ ] ยืนยัน Core scope และรายการ feature ที่ defer
- [ ] ยืนยัน logic Phase 1: โรงเรียนเป็นผู้เช็กเด็กก่อน พร้อมนิยามเวลา/เหตุการณ์เช็กอินและเช็กเอาต์
- [ ] กำหนดช่องทาง issue, severity, change approval และ maintenance window
- [ ] กำหนด release candidate commit และห้ามเพิ่ม feature หลัง scope freeze เว้นแต่เป็น defect fix

Exit gate: มี scope/version/owner/decision register ที่ผู้มีอำนาจยืนยัน

### Phase 1 - Rebaseline And Evidence Reset

ระยะเวลาเป้าหมาย: 2-4 วันทำการ

- [ ] Archive เอกสาร snapshot เก่าที่ขัดกับสถานะปัจจุบันและสร้าง Current Status หน้าเดียว
- [ ] ตรวจ production แบบ read-only: commit, PM2, health, DB timezone, migration, cron, disk/memory
- [ ] ตรวจ feature flags แบบ whitelist โดยไม่แสดง secrets
- [ ] รัน unit tests, integration tests ที่มี, frontend build, label/hybrid guard และ dependency audit
- [ ] สร้าง evidence folders ชุดใหม่สำหรับ release candidate เดียวกัน
- [ ] ตรวจ secret/PII scan ของ source, diff, reports และ evidence

Exit gate: baseline ทุกเอกสารอ้าง commit เดียวกันและไม่มีข้อมูลขัดแย้งที่ยังไม่ติดป้าย historical

### Phase 2 - Core Logic And Product Closure

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์

- [ ] ทำ role-to-route/API matrix จากโค้ดปัจจุบันใหม่
- [ ] ทบทวน business logic กับเจ้าของงาน: โรงเรียน, ต้นสังกัด, จังหวัด, ขนส่ง, คนขับ และผู้ปกครอง
- [ ] ทดสอบ school import, transfer, vehicle request, driver assignment, inspection และ report calculation ใน sandbox
- [ ] ยืนยันทุก query ใช้ scope ฝั่ง server ไม่พึ่งการซ่อนเมนูอย่างเดียว
- [ ] ปิด Critical/Major logic conflict และเพิ่ม regression test
- [ ] ตัดสินใจ feature flags ทุกตัวว่า `accept`, `pilot` หรือ `defer`
- [ ] ทำ Admin technical pilot แล้วขยาย account recovery ครบทุกสิทธิ์ตาม `docs/password-recovery-all-roles-roadmap.md`

Exit gate: Core scope ไม่มี Critical/Major defect และ logic decision ลงนามครบ

### Phase 3 - Data Readiness And Ownership

ระยะเวลาเป้าหมาย: 1 สัปดาห์ จากนั้นติดตามต่อเนื่อง

- [ ] สร้าง aggregate data-quality score โดยไม่ export PII
- [ ] ตรวจ school-affiliation mapping, active/inactive status, student/vehicle/driver ownership และ duplicate/orphan
- [ ] ให้แต่ละโรงเรียนยืนยันข้อมูลของตนเอง; ต้นสังกัดยืนยัน coverage; จังหวัดยืนยันภาพรวม
- [ ] แก้ข้อมูลผ่านหน้าระบบและ audit trail เท่านั้น ห้ามแก้ SQL ตรงโดยไม่มี change record
- [ ] Freeze master data ชั่วคราวในช่วง final UAT หรือบันทึก delta ที่เกิดระหว่างทดสอบ
- [ ] ระบุกระบวนการ correction, transfer, retention และสิทธิ์เจ้าของข้อมูล

Exit gate: Critical data integrity = 0, Major = 0 และ Data owner sign-off ครบตามหน่วยงานที่อยู่ใน rollout

### Phase 4 - Security, Privacy And Legal Closure

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์ ทำคู่ขนาน Phase 2-3

- [ ] ทำ threat/RBAC review รอบ release candidate และทดสอบ IDOR/cross-scope ทุกบทบาท
- [ ] แก้หรือรับรองความเสี่ยง refresh-token rotation, localStorage token, export rate limits และ export memory buffering
- [ ] หมุน secrets/credentials ที่ครบกำหนด โดยไม่บันทึกค่าในเอกสาร
- [ ] ตรวจ default/legacy weak passwords และกำหนด force rotation
- [ ] รับรอง data inventory, purpose, minimization, retention, access request และ breach response
- [ ] DPO/legal ตัดสินใจ LINE, consent, QR และข้อมูลระดับสูง
- [ ] ดำเนินการตาม `docs/pdpa-consent-and-data-confirmation-plan.md` โดยแยก Consent, Acknowledgement และ Data Certification ห้ามใช้กล่องยินยอมรวมทุกวัตถุประสงค์
- [ ] เพิ่มกล่องรับทราบทุกบทบาทและการรับรองข้อมูลก่อน import/รับรองสถานะ พร้อมหลักฐานแบบ append-only
- [ ] ปิดช่องว่าง parent consent UI/API และพิสูจน์ withdrawal cascade ครบ QR, ParentStatus, LIFF, LINE, report และ export ก่อนเปิด feature flag
- [ ] ทดสอบ incident playbook กรณีข้อมูลข้ามสิทธิ์, LINE ผิดคน และไฟล์ export หลุด

Exit gate: ไม่มี Critical/Major security finding, DPO decision ครบ และ residual risk มีผู้มีอำนาจลงนาม

### Phase 5 - Full Role UAT And Accessibility

ระยะเวลาเป้าหมาย: 1-2 สัปดาห์

- [ ] สร้าง sandbox/test accounts แยก admin, province, affiliation, school full, school teacher, driver และ transport
- [ ] ใช้ LINE test account สำหรับ parent และ admin recovery โดยไม่ใช้ข้อมูลเด็กจริง
- [ ] ทดสอบ login/logout/wrong password/blocked route/mobile ทุกบทบาท
- [ ] ทดสอบ workflow หลักและ negative path ตาม `docs/UAT_SIGNOFF_2026-08.md`
- [ ] ทดสอบ export, audit, Thai date/time, grade labels และ error/empty/loading states
- [ ] ตรวจ WCAG ระดับใช้งานจริง: keyboard, focus, contrast, target size, screen reader labels และ responsive 390/768/1440 px
- [ ] เก็บภาพ redacted และ audit IDs แล้วรัน UAT evidence validator แบบ strict

Exit gate: ทุก role ใน accepted scope PASS, validator ผ่านโดยไม่ใช้ `--allow-pending`, Critical/Major = 0 และตัวแทนผู้ใช้ลงนาม

### Phase 6 - Capacity 1,000 Users And Infrastructure

ระยะเวลาเป้าหมาย: 1 สัปดาห์เตรียม + 1 สัปดาห์ปรับแก้

หลักสำคัญ: ห้ามทดสอบ write load 1,000 คนกับ production และห้ามอ้างว่ารองรับจนมีผลทดสอบจริง

- [ ] สร้าง staging ที่ขนาดใกล้ production ใช้ข้อมูลสังเคราะห์หรือ masked dataset
- [ ] สร้าง load-test suite สำหรับ login, dashboards, school check-in/out, reports, GPS และ parent status
- [ ] ยืนยัน workload model กับหน่วยงาน; ค่าเริ่มต้นสำหรับออกแบบคือเพิ่มระดับ 50, 200, 500, 1,000 concurrent users
- [ ] รัน ramp test, peak test และ soak test อย่างน้อย 60 นาที
- [ ] เก็บ p50/p95/p99, throughput, error rate, DB connections/slow queries, CPU, RAM, swap, event-loop lag และ LINE queue
- [ ] เกณฑ์เริ่มต้น: error <1%, ไม่มีข้อมูลซ้ำ/หาย, read API p95 <=1 วินาที, write API p95 <=2 วินาที และระบบฟื้นหลัง peak โดยไม่ restart ผิดปกติ
- [ ] หากต้อง scale หลาย instance ให้ย้าย lockout/dedup/link state จาก memory ไป Redis/DB ก่อน
- [ ] ปรับ indexes, connection pool, caching, report streaming/queue และ VPS size ตามผลจริง
- [ ] รันทดสอบซ้ำจนผ่าน แล้วกำหนด capacity limit และ degradation policy ที่ประกาศได้

Exit gate: มีรายงาน load test ที่ทำซ้ำได้และลงนามโดย Technical owner/Operator; ถ้าไม่ผ่าน 1,000 ต้องประกาศ limit จริงและมีแผน scale ห้ามกล่าวเกินผลทดสอบ

### Phase 7 - Resilience, DR And Operations

ระยะเวลาเป้าหมาย: 3-5 วันทำการ + maintenance window

- [ ] กำหนด RPO/RTO, backup retention, off-host owner และ restore frequency
- [ ] ทำ restore drill จาก backup ล่าสุดใน scratch DB และพิสูจน์ production aggregate ไม่เปลี่ยน
- [ ] ทำ controlled reboot แล้วตรวจ PM2/systemd/nginx/MySQL/cron กลับมาภายใน RTO
- [ ] เปิด external uptime alert และทดสอบ notification ไปยัง on-call
- [ ] ทดสอบ rollback code, frontend, feature flag และ migration ที่รองรับ rollback
- [ ] ตรวจ log rotation, disk threshold, clock/timezone และ certificate/domain expiry monitoring
- [ ] ทำ operator gate และ monitor 30-60 นาทีโดยเก็บ redacted logs

Exit gate: production/postdeploy/restore/operator validators ผ่าน, RPO/RTO พิสูจน์แล้ว และ operator ลงนาม

### Phase 8 - Manuals, Training And Communication

ระยะเวลาเป้าหมาย: 1 สัปดาห์

- [ ] Reconcile screenshot inventory กับภาพจริงและลบสถานะ tracker ที่ล้าสมัย
- [ ] ตรวจคู่มือทุกบทบาทกับ release candidate และ feature flags ที่จะเปิดจริง
- [ ] Regenerate HTML/PDF/เว็บไซต์และตรวจ rendering ภาษาไทยทุกไฟล์
- [ ] เพิ่ม quick guide, troubleshooting, support contact และขั้นตอนข้อมูลผิด/บัญชีถูกล็อก
- [ ] อบรม admin, จังหวัด, ต้นสังกัด, โรงเรียน, ขนส่ง, คนขับ และผู้ปกครองตามหน้าที่
- [ ] เก็บ attendance, แบบประเมิน, คำถามค้าง และผลแบบฝึกปฏิบัติ
- [ ] จัดทำประกาศใช้งาน ข้อจำกัด capacity/privacy และช่องทางแจ้งเหตุ

Exit gate: คู่มือตรงกับ production, ผู้รับผิดชอบแต่ละกลุ่มผ่านแบบฝึก และมี Training sign-off

### Phase 9 - Rollout ตามปีการศึกษา

#### Phase 9A: เทอม 2 ปีการศึกษา 2569

- โรงเรียนเป็นผู้เช็กนักเรียนก่อนตาม policy ที่ยืนยันใน Phase 0
- โรงเรียนนำเข้า/ตรวจข้อมูลนักเรียน รถ คนขับ และผู้ปกครอง
- ต้นสังกัดติดตามความครบถ้วนและโรงเรียนที่ยังไม่ดำเนินการ
- จังหวัดดูภาพรวม รายงาน และประเด็นเชิงนโยบาย
- ขนส่งตรวจรถ/เอกสารและสถานะรับรอง
- เปิด LINE เฉพาะ workflow ที่ผ่าน UAT/DPO; feature ขั้นสูงที่ยังไม่ผ่านให้คงปิด
- เริ่ม pilot กลุ่มเล็ก แล้วขยายเป็นลำดับโรงเรียนหลังแต่ละ wave ผ่าน gate

#### Phase 9B: เทอม 1 ปีการศึกษา 2570

- ขยายบทบาทคนขับให้ทำ check-in/out/shift ตาม logic ที่ยืนยัน
- ขยาย Parent LINE adoption และ notification policy
- พิจารณา ETA/geofence/route deviation/QR ทีละ feature flag หลังข้อมูลและ UAT พร้อม
- เปรียบเทียบ KPI, incident, response time และภาระงานกับ Phase 9A

Exit gate ของแต่ละ wave: ไม่มี Critical, Major ที่กระทบ wave ถูกแก้, monitoring ปกติ และ owner อนุมัติขยาย wave ถัดไป

### Phase 10 - Hypercare, Handover And Formal Closure

ระยะเวลาเป้าหมาย: 30 วันหลัง rollout wave สุดท้าย

- [ ] เฝ้าระวังรายวันสัปดาห์แรกและรายสัปดาห์จนจบ hypercare
- [ ] สรุป incident, support tickets, adoption, data completeness, uptime และ capacity
- [ ] ปิด Critical/Major ทั้งหมด; Minor ย้ายเข้า maintenance backlog พร้อม owner/date
- [ ] ส่งมอบ repository, deployment access, secret ownership, DB/backup, LINE Console, domain/DNS และ monitoring โดยไม่ส่ง secret ผ่าน git
- [ ] ส่งมอบ architecture, schema, API/RBAC matrix, runbook, DR, manuals และ training records
- [ ] Tag final release และสร้าง immutable closure bundle/checksums
- [ ] ยืนยันงบ/ผู้ดูแล/รอบบำรุงรักษาหลังโครงการ รวมถึง renewal ของ domain/server/LINE-related services
- [ ] ลงนาม System Acceptance และ Project Closure

Exit gate: ผ่าน Definition of Done ทั้งหมดและผู้มีอำนาจลงนามจริง

## 7. Role Acceptance Matrix

| กลุ่ม | งานขั้นต่ำที่ต้องพิสูจน์ | ผู้รับรอง |
|---|---|---|
| Admin | users, recovery, audit, system health, readiness, term/settings | System owner |
| Province | dashboard, affiliations/schools, reports/policy, audit, readiness | ตัวแทนจังหวัด |
| Affiliation | scope โรงเรียน, accounts, status, requests, reports | ตัวแทนต้นสังกัด |
| School full | import, students, vehicles, check-in/out Phase 1, approvals, reports, audit | ผู้บริหาร/ผู้รับผิดชอบโรงเรียน |
| School teacher | เห็นเฉพาะ grade scope และไม่มี write action เกินสิทธิ์ | โรงเรียน |
| Driver | roster, pretrip, emergency และ workflow ที่เปิดใน Phase 2 | คนขับ/โรงเรียน |
| Transport | inspection, verification, documents, pickup map โดยไม่เห็น PII เกินจำเป็น | ตัวแทนขนส่ง |
| Parent/LINE | bind/status/notification/unbind/rebind เฉพาะบุตรหลาน | ตัวแทนผู้ปกครอง + DPO |
| Operator | deploy, monitor, backup, restore, rollback, incident | Technical owner |

## 8. RACI หลัก

| งาน | Accountable | Responsible | Consulted |
|---|---|---|---|
| Scope/Go-Live | Project owner | Product owner | ทุกหน่วยงาน |
| Business logic | Product owner | เจ้าของ workflow | School/Affiliation/Province/Transport |
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
| Core functionality และ RBAC | 20% |
| UAT ทุกบทบาท | 20% |
| Data readiness | 15% |
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

1. Owner ยืนยัน Phase 0: scope, Phase 1 school-check logic และรายชื่อผู้รับผิดชอบ
2. Technical team ทำ Phase 1 rebaseline และสร้าง evidence pack ชุดใหม่จาก commit เดียว
3. Product/Data owners ปิด logic และ data gap ใน Phase 2-3
4. Security/DPO ทำ Phase 4 คู่ขนาน
5. ทำ Full UAT ใน sandbox ตาม Phase 5
6. ทำ load test 1,000 คนและ infrastructure remediation ใน Phase 6
7. ปิด DR/operations แล้ว regenerate คู่มือและอบรม
8. Rollout เทอม 2/2569 และขยายเทอม 1/2570 ตาม gate
9. Hypercare 30 วัน ส่งมอบ และลงนามปิดโครงการ

## 14. Definition Of Done ระดับโครงการ

โครงการถือว่าปิดสมบูรณ์เมื่อ:

1. Accepted scope ทำงานบน production และมีหลักฐานตาม release เดียวกัน
2. ผู้ใช้ทุกบทบาทใน scope ผ่าน UAT และอบรม
3. ข้อมูลจริงมี owner และผ่านเกณฑ์คุณภาพ
4. ระบบผ่าน security/privacy/capacity/DR gates
5. ไม่มี Critical/Major defect ค้าง
6. มี operator, backup owner, support, SLA และงบดูแลต่อ
7. เอกสาร/คู่มือ/access/assets ส่งมอบครบ
8. Final validators ผ่านแบบ strict
9. ผู้มีอำนาจทุกฝ่ายลงนามจริง
10. สิ่งที่ defer ถูกย้ายไป maintenance roadmap พร้อม owner/date และไม่แอบรวมเป็นงานที่เสร็จแล้ว
