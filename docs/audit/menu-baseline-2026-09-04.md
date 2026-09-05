# Menu / API Structural Baseline — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกค่าตั้งต้นเชิงโครงสร้าง (structural baseline) ของเมนูและ API ที่อ่านจาก source ณ commit หนึ่ง เพื่อให้ C3-1 วัด before/after ได้** — งาน A0-10 ตาม `docs/project-closure/execution-plan-to-completion-2026-09-04.md:102`

เอกสารนี้ **ไม่ใช่**:

- ไม่ใช่การอนุมัติโครงสร้างเมนู (target IA รอ C0-3)
- ไม่ใช่หลักฐานการทดสอบ ไม่ใช่ผล UAT และไม่ใช่ sign-off ใด ๆ
- ไม่ใช่ข้อมูลการใช้งานจริงรายเมนู — ระบบไม่มี page-view telemetry (ดู §8)
- ไม่ใช่การยืนยันสถานะ feature flag บน production — เครื่องที่จัดทำเอกสารนี้ไม่มีสิทธิ์เข้า production จึงอ้างค่าที่บันทึกไว้ในเอกสารอื่นเท่านั้น (ดู §5)

---

## 1. จุดที่บันทึก baseline

| รายการ | ค่า |
|---|---|
| Repository | `D:/Projects/lampang-bus-work` (worktree; ไฟล์ที่ tracked ไม่มีการแก้ไข — `git status --short` ขึ้นเฉพาะบรรทัด `??` ของเอกสารใหม่ที่ยังไม่ commit รวมถึงไฟล์นี้เอง) |
| Branch | `feat/tracking-security-hardening` |
| Commit ที่อ่าน source | **`4b80b4b96c206e6bfce0abc3e00db6719b054222`** (`4b80b4b`, 2026-09-04 20:23:54 +0700, "docs(closure): correct dependencies and evidence gates") |
| Release candidate ตามแผน | `cef4bd1` (`execution-plan-to-completion-2026-09-04.md` §1) |
| ความต่างระหว่าง RC กับ commit นี้ | `git diff --name-only cef4bd1..4b80b4b -- frontend/src backend/src` คืน **0 ไฟล์** — ส่วนต่าง 3 commits แตะเฉพาะ `docs/`, `scripts/`, `backend/tests/` และ `.gitattributes` |
| ผลที่ตามมา | ตัวเลขเมนูและ API ในเอกสารนี้ใช้แทน baseline ของ RC `cef4bd1` ได้ เพราะ source ของ `frontend/src` และ `backend/src` เหมือนกันทุกไบต์ |
| Node ที่ใช้รัน generator | v24.15.0 |
| วันที่จัดทำ | 4 กันยายน 2569 |

ถ้ามีการแก้ `frontend/src/components/Sidebar.jsx` หรือ `backend/src/app.js` หลังจากนี้ **ต้องรัน baseline ใหม่** และระบุ commit ใหม่ มิฉะนั้นการเทียบ before/after ของ C3-1 จะไม่ใช่ชุดเดียวกัน

## 2. ขอบเขตและวิธีนับ

นับจาก source จริง ไม่ได้นับจากภาพหน้าจอหรือจากเอกสารสรุปก่อนหน้า:

- **เมนู** = รายการที่มี `to` ใน array ของ `frontend/src/components/Sidebar.jsx:25-141` หัวข้อกลุ่ม (`section`) ไม่นับเป็นเมนู เพราะไม่ใช่ลิงก์ (`Sidebar.jsx:13-14`)
- **เมนูที่เห็นจริง** = ผลของ `navItemsForUser()` (`Sidebar.jsx:163-192`) ซึ่งกรอง 3 ชั้น: feature flag (`FLAG_GATED`, `Sidebar.jsx:167-178`), การซ่อน legacy (`Sidebar.jsx:188`) และ `TEACHER_BLOCKED_PATHS` สำหรับบัญชีครูประจำสายชั้น (`Sidebar.jsx:151-161`)
- **API** = route ที่ Express mount จริง อ่านจาก router graph ด้วย `backend/scripts/generate-rbac-matrix.js` ไม่ใช่การ grep ไฟล์ route (`generate-rbac-matrix.js:6-12`)

ข้อจำกัดที่ต้องอ่านคู่กันเสมอ:

- ไม่มีการเข้าถึง production, ไม่มี deploy, ไม่มี migration, ไม่มีการเขียนฐานข้อมูล — ตัวเลขเมนูและ API inventory ทั้งหมดมาจาก source ในเครื่อง ข้อยกเว้นคือรอบตรวจทานแก้ไข (4 กันยายน 2569) ซึ่ง **อ่านอย่างเดียว** จาก sandbox ที่รันอยู่สองจุด: `curl` ไปยัง backend `localhost:3000` เพื่อดู HTTP status ของ route ที่ไม่ได้ mount (§7) และ `SELECT` จาก `lampang_bus_sandbox` เพื่อสอบทาน ENUM กับแถว `VIEW` ของ `audit_logs` (§8) — ไม่ใช่ production และไม่มีการเขียนใด ๆ
- ไม่ได้เปิด browser จึงไม่ได้ยืนยันด้วยตาว่าเมนูแสดงผลตามที่ code ระบุ ตัวเลขนี้เป็น "โครงสร้างที่ code กำหนด" ไม่ใช่ "สิ่งที่ผู้ใช้เห็นบนหน้าจอจริง"
- **ผลลัพธ์ของ generator รอบนี้ถูกเขียนไว้นอก repository** (ไดเรกทอรีชั่วคราวของ session) จึง **ยังไม่มี run ของ baseline นี้ใน `outputs/rbac-matrix/`** ซึ่งเป็นครึ่งหนึ่งของ exit evidence ของ A0-10 ตาม `execution-plan-to-completion-2026-09-04.md:102` — ต้องให้ผู้มีสิทธิ์รันแล้วเก็บลง path นั้นแยกต่างหาก (ดู §10) ข้อควรระวัง: ใน working tree **มี run เก่าอยู่แล้วหนึ่งชุด** คือ `outputs/rbac-matrix/20260904T044804Z/` (`rbac-matrix.json` 137,981 bytes + `scope-enforcement.json` 34,903 bytes, `generated_at` 2026-09-04T04:48:05Z) แต่ **ไม่ใช่ baseline นี้** เพราะรันภายใต้ flag คนละชุด และให้ `totals` = routes 283 / write 137 / role guard 258 / findings 0 ซึ่งไม่ตรงกับคอลัมน์ใดใน §9.1 — ไดเรกทอรีนี้ไม่ปรากฏใน `git status` เพราะ `/outputs/` ถูก ignore ที่ `.gitignore:33`

## 3. Baseline จำนวนเมนูรายบทบาท

### 3.1 ตารางหลัก — จำนวนที่ประกาศไว้ เทียบกับจำนวนที่เห็นตามสถานะ flag

`defined` = จำนวนรายการใน array `visible` = ผลของ `navItemsForUser()`

| บทบาท | ที่มาใน source | defined | visible: flag ปิดทั้งหมด | visible: flag แบบ production (`driverRegistration` เปิดอย่างเดียว) | visible: flag เมนูเปิดครบ 4 ตัว |
|---|---|---:|---:|---:|---:|
| Driver | `Sidebar.jsx:25-37` | 8 | 5 | **6** | 7 |
| School (บัญชีเต็ม) | `Sidebar.jsx:39-58` | 13 | 12 | **13** | 13 |
| School (ครูประจำสายชั้น) | `Sidebar.jsx:39-58` + `:151-161` | 13 | 9 | **9** | 9 |
| Affiliation | `Sidebar.jsx:60-78` | 12 | 12 | **12** | 12 |
| Province | `Sidebar.jsx:80-97` | 12 | 11 | **11** | 12 |
| Transport | `Sidebar.jsx:99-107` | 4 | 4 | **4** | 4 |
| Admin | `Sidebar.jsx:109-141` | 25 | 23 | **23** | 25 |
| Parent | ไม่มีใน `NAV_MAP` (`Sidebar.jsx:143`) | 0 | 0 | **0** | 0 |
| **รวม 6 บทบาทที่มี Sidebar** | | **74** | 67 | **69** | 73 |

"flag เมนูเปิดครบ 4 ตัว" หมายถึง `driverRegistration`, `driverShiftSelection`, `geofence`, `routeDeviation` ซึ่งเป็น flag เดียวที่มีผลต่อ Sidebar (`Sidebar.jsx:167-178`) flag อื่นอีก 6 ตัวไม่เปลี่ยนจำนวนเมนู

Parent ไม่มี Sidebar เลย — `NAV_MAP` (`Sidebar.jsx:143`) มีเฉพาะ 6 role และ role `parent` ไม่ได้อยู่ในนั้น หน้า parent เข้าถึงผ่าน route ตรง (§7)

### 3.2 รายการเมนูเต็ม (สถานะ flag แบบ production)

Driver — 6 รายการ (`Sidebar.jsx:27,30,32,33,34,36`)

| # | path | label |
|---:|---|---|
| 1 | `/driver` | `PAGE_TITLES.DRIVER_DASHBOARD` |
| 2 | `/driver/pickup-map` | แผนที่จุดรับส่ง |
| 3 | `/driver/vehicle-registration` | รายชื่อเด็กในรถ |
| 4 | `/driver/applications` | สถานะส่งตรวจรถ |
| 5 | `/driver/emergency` | แจ้งเหตุฉุกเฉิน |
| 6 | `/driver/profile` | ข้อมูลคนขับ |

ซ่อนอยู่: `/driver/shift` (`Sidebar.jsx:29`, รอ `driverShiftSelection`) และ `/driver/requests` (`Sidebar.jsx:31`, ถูกซ่อนโดยตั้งใจเมื่อ `driverRegistration` เปิด ตาม `Sidebar.jsx:185-188`)

School บัญชีเต็ม — 13 รายการ (`Sidebar.jsx:41,43,44,45,47,48,49,50,52,53,54,55,57`)

| # | path | label |
|---:|---|---|
| 1 | `/school` | `PAGE_TITLES.SCHOOL_DASHBOARD` |
| 2 | `/school/approvals` | คำขอรายชื่อ |
| 3 | `/school/registration-review` | ตรวจลงทะเบียนรถ |
| 4 | `/school/vehicle-verification` | ส่งตรวจและรับรองรถ |
| 5 | `/school/students` | ข้อมูลนักเรียน |
| 6 | `/school/vehicles` | รถรับส่ง |
| 7 | `/school/bulk-vehicles` | เพิ่มรถรับส่ง |
| 8 | `/school/teacher-accounts` | บัญชีครูประจำสายชั้น |
| 9 | `/school/pickup-map` | แผนที่จุดรับส่ง |
| 10 | `/school/live-vehicles` | ตำแหน่งปัจจุบัน |
| 11 | `/school/emergencies` | เหตุฉุกเฉิน |
| 12 | `/school/audit-log` | ประวัติการแก้ไข |
| 13 | `/reports/daily` | รายงาน |

School ครูประจำสายชั้น — 9 รายการ: ตัดข้อ 3, 7, 8, 12 ออกตาม `TEACHER_BLOCKED_PATHS` (`Sidebar.jsx:151-161`) เหลือ `/school`, `/school/approvals`, `/school/vehicle-verification`, `/school/students`, `/school/vehicles`, `/school/pickup-map`, `/school/live-vehicles`, `/school/emergencies`, `/reports/daily`

Affiliation — 12 รายการ (`Sidebar.jsx:62,64,65,67,68,69,70,72,73,74,75,77`): `/affiliation`, `/affiliation/transfer-requests`, `/affiliation/vehicle-requests`, `/affiliation/schools`, `/affiliation/students`, `/affiliation/vehicles`, `/affiliation/accounts`, `/affiliation/live-vehicles`, `/affiliation/pickup-map`, `/affiliation/emergencies`, `/affiliation/audit-log`, `/reports/daily`

Province — 11 รายการ (`Sidebar.jsx:82,84,85,86,87,89,90,91,93,94,96`): `/province`, `/province/affiliations`, `/province/schools`, `/province/students`, `/province/vehicles`, `/province/live-vehicles`, `/province/pickup-map`, `/province/readiness`, `/province/emergencies`, `/province/audit-log`, `/reports/daily` — ซ่อนอยู่: `/admin/route-deviations` (`Sidebar.jsx:92`)

Transport — 4 รายการ (`Sidebar.jsx:101,103,104,106`): `/transport`, `/transport/verification`, `/transport/inspections`, `/transport/pickup-map`

Admin — 23 รายการ (`Sidebar.jsx:111,113,114,116,117,118,119,120,121,123,124,125,126,129,130,131,133,134,135,136,137,138,140`) แบ่งตามกลุ่มใน source:

| กลุ่ม (`section`) | จำนวน | path |
|---|---:|---|
| ภาพรวม (`:110`) | 1 | `/admin` |
| งานดำเนินการ (`:112`) | 2 | `/admin/transfer-requests`, `/admin/vehicle-requests` |
| ข้อมูลหลัก (`:115`) | 6 | `/admin/users`, `/school`, `/affiliation/accounts`, `/province`, `/province/students`, `/province/vehicles` |
| ตรวจสอบและสนับสนุน (`:122`) | 7 | `/admin/readiness`, `/admin/pickup-points`, `/admin/live-vehicles`, `/admin/driver-integrity`, `/admin/audit-logs`, `/admin/system-health`, `/transport` |
| รายงานและวิจัย (`:132`) | 6 | `/admin/measurement`, `/admin/research`, `/admin/research-export`, `/admin/evaluation`, `/admin/executive`, `/reports/daily` |
| ตั้งค่าระบบ (`:139`) | 1 | `/admin/term-settings` |

ซ่อนอยู่ 2 รายการในกลุ่ม "ตรวจสอบและสนับสนุน": `/admin/geofences` (`:127`) และ `/admin/route-deviations` (`:128`)

หมายเหตุที่มีผลต่อการวัด: **8 ใน 25 เมนู Admin ใช้ path ร่วมกับ sidebar ของบทบาทอื่น** — `/school` (`:117` = `SCHOOL_NAV:41`), `/affiliation/accounts` (`:118` = `AFFILIATION_NAV:70`), `/province` (`:119` = `PROVINCE_NAV:82`), `/province/students` (`:120` = `PROVINCE_NAV:86`), `/province/vehicles` (`:121` = `PROVINCE_NAV:87`), `/admin/route-deviations` (`:128` = `PROVINCE_NAV:92`), `/transport` (`:131` = `TRANSPORT_NAV:101`) และ `/reports/daily` (`:138` = `SCHOOL_NAV:57`, `AFFILIATION_NAV:77`, `PROVINCE_NAV:96`)

รวมทั้ง 6 บทบาทมีรายการ `to:` 74 รายการ แต่เป็น path ที่ไม่ซ้ำกันเพียง **64 path** (ซ้ำกัน 10 ครั้ง) การเอาตัวเลขทุก role มาบวกกันตรง ๆ จึงนับเกิน 10 ไม่ใช่ 5

## 4. ผลเทียบกับตัวเลขใน role-menu audit

`docs/role-menu-participatory-research-audit-2026-09-04.md` ระบุว่า "ตัวเลขเมนูเป็นรายการที่เห็นเมื่อใช้ feature flags ของ production ปัจจุบัน" (`:55`) เมื่อเทียบกับคอลัมน์ `visible: flag แบบ production` ของ §3.1:

| บทบาท | ค่าที่ audit อ้าง | ที่มา | ค่าที่นับได้จาก source | ตรงกันหรือไม่ |
|---|---|---|---:|---|
| Driver | "ประมาณ 6" | `:57` | 6 | ตรง — และไม่ต้องใช้คำว่าประมาณ ค่าคือ 6 พอดี |
| School full | 13 | `:70` | 13 | ตรง |
| School teacher | "ประมาณ 9" | `:265` | 9 | ตรง — ค่าคือ 9 พอดี |
| Affiliation | 12 | `:87` | 12 | ตรง |
| Province | 11 | `:102` | 11 | ตรง (แต่ประกาศไว้ 12 ดู §5) |
| Transport | 4 | `:116` | 4 | ตรง |
| Admin | "ประมาณ 23" | `:127` | 23 | ตรง — ค่าคือ 23 พอดี (แต่ประกาศไว้ 25 ดู §5) |
| Parent | "2 เส้นทางหลัก" | `:148` | 2 route หลัก + 3 route เสริม | ดู §7 |

**ตัวเลขเมนูทั้ง 7 แถวของ audit ตรงกับที่นับได้จาก source** — ตรวจเฉพาะ 7 แถวนี้เท่านั้น ไม่ใช่คำตัดสินว่าทั้งเอกสาร audit ไม่มีตัวเลขผิด (ตัวเลขอื่นในนั้น เช่น "43 suites / 445 tests ผ่าน" `:32`, "ผ่าน 155 files, violation 0" `:34` และ audit aggregates 90 วันที่ `:41-49` ไม่ได้ตรวจในงานนี้ และบางส่วนตรวจซ้ำจากเครื่องนี้ไม่ได้ — ดู §8) สิ่งที่ต่างในตารางข้างบนคือความแม่นของถ้อยคำ ไม่ใช่ค่า:

1. คำว่า "ประมาณ" ใน Driver / Admin / School teacher ไม่จำเป็น — ทั้งสามค่านับได้แน่นอนจาก source
2. Audit รายงานเฉพาะจำนวน `visible` ไม่ได้แยก `defined` ออกมา ทำให้ Province (11 vs 12) และ Admin (23 vs 25) ดูเหมือนเป็นตัวเลขเดียว ทั้งที่จริงมีอีก 3 รายการที่มีอยู่ใน code และจะโผล่ทันทีที่เปิด flag — ถ้า C3-1 วัด after ในสภาพ flag ต่างจาก before ตัวเลขจะขยับโดยไม่มีใครแก้เมนูเลย
3. ค่า `defined` ที่ยังไม่เคยถูกบันทึกไว้ที่ใด: Driver 8, School 13, Affiliation 12, Province 12, Transport 4, Admin 25 รวม 74

ข้อสังเกตเพิ่มเติมในตัว source เอง: คอมเมนต์ที่ `Sidebar.jsx:195` เขียนว่า "Grade teachers see ~8 filtered items" แต่ค่าที่คำนวณจาก logic เดียวกันคือ 9 ทั้งในสถานะ flag ปิดทั้งหมดและ flag แบบ production — เป็นคอมเมนต์คลาดเคลื่อน ไม่ใช่ bug ของ logic แต่ถ้าใครใช้คอมเมนต์นี้เป็น baseline จะเทียบผิด 1 รายการ

## 5. เมนูที่ถูกซ่อนด้วย feature flag (กติกาเทียบ like-for-like)

Sidebar กรองเมนูตาม flag ที่ `Sidebar.jsx:167-178` มีเพียง 6 path ที่ผูกกับ flag และ 1 path ที่ถูกซ่อนด้วยกติกา dedupe:

| path | flag | บทบาทที่มีเมนูนี้ | สถานะบน production ตามที่บันทึกไว้ | ผลต่อจำนวนเมนู |
|---|---|---|---|---|
| `/driver/shift` | `driverShiftSelection` | Driver | ปิด | ซ่อน (−1 Driver) |
| `/driver/vehicle-registration` | `driverRegistration` | Driver | เปิด | แสดง |
| `/driver/applications` | `driverRegistration` | Driver | เปิด | แสดง |
| `/school/registration-review` | `driverRegistration` | School (เฉพาะบัญชีเต็ม) | เปิด | แสดง |
| `/admin/geofences` | `geofence` | Admin | ปิด | ซ่อน (−1 Admin) |
| `/admin/route-deviations` | `routeDeviation` | Admin, Province | ปิด | ซ่อน (−1 Admin, −1 Province) |
| `/driver/requests` | ไม่ใช่ flag — ถูกซ่อนเมื่อ `driverRegistration` เปิด (`Sidebar.jsx:185-188`) | Driver | เปิด → ถูกซ่อน | ซ่อน (−1 Driver) |

**ที่มาของสถานะ flag บน production**: `docs/role-menu-participatory-research-audit-2026-09-04.md:31` บันทึกว่า "Feature ที่เปิด: `FEATURE_DRIVER_REGISTRATION` เท่านั้น" ที่ production commit `0060c3e` (`:30`) เมื่อ 4 กันยายน 2569 — **เอกสารฉบับนี้ยืนยันค่านั้นซ้ำไม่ได้** เพราะไม่มีสิทธิ์เข้า production ต้องรอ `outputs/operator-gates/<run>/feature-flags.redacted.log` จาก B0-1/A0-11 มายืนยัน

ชื่อ flag ทั้ง 10 ตัวและตัวแปร env ที่ผูกอยู่: `backend/src/config/env.js:205-238` — `adminPasswordRecovery`, `vehicleQr`, `driverShiftSelection`, `qrLevel3`, `eta`, `geofence`, `routeDeviation`, `driverRegistration`, `parentConsentRequired`, `participationCases` ทุกตัวเป็น `=== 'true'` คือ **ค่าเริ่มต้นเป็นปิดเมื่อไม่ได้ตั้ง env**

**กติกาสำหรับ C3-1**: การวัด after ต้องบันทึกสถานะ flag ทั้ง 10 ตัว ณ เวลาที่วัด แล้วเทียบกับคอลัมน์เดียวกันใน §3.1 ถ้าสถานะ flag ต่างจากตอนวัด baseline ให้ระบุตัวเลขทั้งสองคอลัมน์ ห้ามเทียบข้ามคอลัมน์ ตัวอย่างของกับดัก: เปิด `geofence` + `routeDeviation` แล้วรวมเมนู Admin ลงจาก 25 เหลือ 20 จะดูเหมือนลด 3 (23→20) ทั้งที่จริงลด 5

**สถานะ flag ที่จะใช้ระหว่าง UAT ของ C3-1: รอ C0-4** — ห้ามกำหนดเองในเอกสารนี้ เพราะเป็นตัวกำหนดว่าคอลัมน์ไหนใน §3.1 คือ baseline ที่ถูกต้อง

## 6. Mobile bottom nav baseline

เป็นเมนูคนละชุดกับ Sidebar และไม่ได้ถูกนับใน §3 — ต้องนับแยกเพราะ C3-1 ทดสอบที่ 390px ด้วย (`execution-plan-to-completion-2026-09-04.md:442`)

| บทบาท | ที่มา | จำนวน tab | รายการ |
|---|---|---:|---|
| Driver | `frontend/src/components/MobileBottomNav.jsx:10-20` | 4 | `/driver`, (`driverRegistration` เปิด → `/driver/vehicle-registration` / ปิด → `/driver/applications`), `/driver/emergency`, `/driver/profile` |
| School | `frontend/src/pages/school/SchoolLayout.jsx:16-21` | 4 | `/school`, `/school/students`, `/school/live-vehicles`, `/reports/daily` |
| Affiliation | `frontend/src/pages/affiliation/AffiliationLayout.jsx:10-15` | 4 | `/affiliation`, `/affiliation/schools`, `/affiliation/live-vehicles`, `/reports/daily` |
| Province | `frontend/src/pages/province/ProvinceLayout.jsx:7-12` | 4 | `/province`, `/province/schools`, `/province/live-vehicles`, `/reports/daily` |
| Transport | `frontend/src/pages/transport/TransportLayout.jsx:6-11` | 4 | `/transport`, `/transport/verification`, `/transport/inspections`, `/transport/pickup-map` |
| Admin | — | 0 | หน้า Admin ใช้ `<Layout>` โดยไม่ส่ง `bottomNav` (`frontend/src/App.jsx:331-340`) จึงไม่มีแถบล่างบนมือถือ |
| Parent | — | 0 | ไม่มี |

จำนวน tab ของ Driver คงที่ 4 ทุกสถานะ flag เปลี่ยนเฉพาะปลายทางของ tab กลาง (`MobileBottomNav.jsx:14-16`)

Sidebar ของ Admin และ School บัญชีเต็มเป็นแบบพับกลุ่มได้ (`isCollapsibleForUser`, `Sidebar.jsx:197-202`) ส่วน role อื่นเป็นหัวข้อคงที่ — มีผลต่อ time-on-task ที่ C3-1 จะวัด จึงบันทึกไว้เป็นส่วนหนึ่งของ baseline

## 7. Route baseline ของ frontend (route ≠ เมนู)

`frontend/src/App.jsx` ประกาศ `path=` ทั้งหมด **92 รายการ** (รวม 5 รายการที่เป็น `<Navigate>` redirect และ 1 รายการ catch-all `*`) แบ่งตาม prefix:

| prefix | จำนวน `path=` |
|---|---:|
| `/admin` | 20 |
| `/school` | 14 |
| `/driver` | 12 |
| `/affiliation` | 12 |
| `/province` | 11 |
| `/reports` | 5 |
| `/transport` | 5 |
| `/parent` | 4 |
| อื่น ๆ (`/login`, `/forgot-password`, `/reset-password`, `/change-password`, `/manual/*`, `/qr/:token`, `/link`, `/`, `*`) | 9 |

**สองข้อที่ต้องรู้ก่อนตีความตัวเลขเมนู**

1. **Route ของ frontend ไม่ถูกกรองด้วย feature flag เลย** — `grep "features" frontend/src/App.jsx` ไม่พบผลลัพธ์ การกรองด้วย flag เกิดที่ Sidebar เท่านั้น (`Sidebar.jsx:163-192`) ดังนั้นหน้าอย่าง `/admin/geofences` (`App.jsx:367`), `/admin/route-deviations` (`App.jsx:372`), `/admin/vehicle-qr` (`App.jsx:377`) และ `/driver/consent` (`App.jsx:382`) ยังมี route ประกาศอยู่แม้เมนูจะถูกซ่อน ขณะที่ router ฝั่ง backend ไม่ถูก mount (`backend/src/app.js:203-235`) — **ฝั่ง API ทดสอบกับ backend sandbox ที่รันอยู่แล้วจริง** (`localhost:3000`, commit `4b80b4b`, flag ปิดตาม `backend/.env.test`): `GET /api/geofences` และ `GET /api/route-deviations` ตอบ **404** ขณะที่ route ที่ mount อยู่จริงอย่าง `GET /api/terms/current` ตอบ **401** ส่วนฝั่งหน้าจอว่าหน้าเปิดขึ้นจริงหรือไม่ **อ่านจาก source ยังไม่ได้ทดสอบ runtime ด้วย browser** การซ่อนเมนูจึงไม่ใช่การปิดฟีเจอร์ และ C3-1 ที่ทดสอบ old-route redirect (`execution-plan-to-completion-2026-09-04.md:439`) ควรครอบกรณีนี้ด้วย
2. **`path=` 28 รายการไม่มีรายการใน Sidebar** (92 รายการ ลบ 64 path ที่ตรงกับ sidebar) ในจำนวนนี้ 27 รายการเป็นหน้าจริงตามตารางด้านล่าง อีก 1 รายการคือ catch-all `*` (`App.jsx:458`) ซึ่งไม่ใช่หน้า — 27 หน้านั้นเข้าถึงได้จาก dashboard, ปุ่มภายในหน้า หรือ URL ตรง เป็นส่วนที่หายไปถ้าใช้ "จำนวนเมนู" เป็นตัวแทนของ "จำนวนหน้าที่ผู้ใช้ต้องเรียนรู้"

| กลุ่ม | route ที่ไม่มีใน Sidebar (`App.jsx` บรรทัด) |
|---|---|
| สาธารณะ/บัญชี | `/login` (201), `/forgot-password` (202), `/reset-password` (203), `/change-password` (204), `/manual/*` (205), `/` (457) |
| Driver | `/driver/roster` (217), `/driver/leaves` (220 — redirect), `/driver/pretrip` (222), `/driver/consent` (382) |
| School | `/school/status` (242), `/school/missing` (244) |
| Affiliation / Province | `/affiliation/status` (267), `/province/status` (291) |
| Reports | `/reports` (301 — layout), `/reports/monthly` (310), `/reports/summary` (311), `/reports/policy` (312) |
| Transport | `/transport/vehicles` (325) |
| Admin | `/parent/link/admin-recovery` (342 — `allowedRoles={['admin']}`), `/admin/vehicle-qr` (377), `/admin/executive-print` (437) |
| Parent / QR | `/qr/:token` (444), `/parent` (447), `/parent/link` (448), `/parent/link/link` (454 — redirect), `/link` (455 — redirect) |

`/transport/vehicles` ที่ไม่อยู่ใน Sidebar ตรงกับที่ audit ระบุไว้ (`role-menu-participatory-research-audit-2026-09-04.md:122`)

Parent: route หลัก 2 รายการ (`/parent`, `/parent/link`) ตรงกับที่ audit ระบุ (`:148`) และมี redirect อีก 2 (`/parent/link/link`, `/link`) กับหน้า `/parent/link/admin-recovery` ที่ชื่อขึ้นต้นด้วย `/parent` แต่เป็นหน้าของ role `admin`

## 8. ข้อมูลการใช้งานแบบ aggregate — สิ่งที่มีจริงและสิ่งที่ไม่มี

Master plan Phase 1 ขอ "ข้อมูลการใช้งานแบบ aggregate" ผลตรวจ source:

**ไม่มี page-view telemetry รายเมนู** — ตรงกับที่ `role-menu-participatory-research-audit-2026-09-04.md:21` ระบุไว้ และยืนยันซ้ำได้จาก source:

- ตัวนับเดียวที่ frontend ยิงคือ `POST /api/visits/track` หนึ่งครั้งต่อ browser tab (`frontend/src/hooks/useVisitTracker.js:15-36` dedupe ผ่าน `sessionStorage`) payload มีฟิลด์เดียวคือ `{ logged_in }` (`useVisitTracker.js:29`) — **ไม่ส่ง path, ไม่ส่ง role, ไม่ส่ง user id**
- ฝั่ง backend เพิ่มตัวนับ 3 ช่องของวันนั้น (`backend/src/routes/visits.routes.js:23-42`) ตารางปลายทาง `daily_visits` มีเพียง `visit_date`, `total_visits`, `public_visits`, `logged_in_visits`, `updated_at` (`backend/migrations/015_daily_visits.sql:2-8`) — **ไม่มีมิติของหน้า ของเมนู หรือของบทบาท**
- `audit_logs` เก็บ `action` กับ `entity_type`/`entity_id` โดย ENUM ของ `action` **ปัจจุบันมี 12 ค่า ไม่ใช่ 7** — migration 001 ตั้งไว้ 7 ค่า (`backend/migrations/001_initial_schema.sql:400-415`) แล้ว `backend/migrations/017_vehicle_locations.sql:32-34` เพิ่ม `VIEW` และ `backend/migrations/040_intelligent_tracking.sql:208-213` เพิ่ม `GEOFENCE_ENTER`, `GEOFENCE_EXIT`, `ROUTE_DEVIATION`, `ETA_REFRESH` ตรงกับ allow-list ฝั่ง app ที่ `backend/src/utils/audit.js:8-12` (สอบทานกับฐานข้อมูล sandbox ที่ migrate ครบแล้ว ได้ 12 ค่าเช่นกัน)
- ส่วนใหญ่ของ `audit_logs` เป็นบันทึก **การกระทำที่เปลี่ยนข้อมูล** แต่ **ไม่จริงที่ว่า "การอ่านอย่างเดียวไม่ถูกบันทึก"**: `maybeAuditView()` (`backend/src/services/vehicleLocation.service.js:275-298`) และ `maybeAuditPickupMapView()` (`backend/src/services/pickupPoint.service.js:832-848`) เขียนแถว `action=VIEW` พร้อม `user_id` เมื่อผู้ใช้เปิดหน้า โดย dedupe 5 นาที เรียกจาก `admin.routes.js:1410`, `affiliation.routes.js:671,715`, `province.routes.js:257,288`, `transport.routes.js:312` — `entity_type` ที่ใช้มีเพียง `live_vehicles`, `affiliation_pickup_map`, `province_pickup_map`, `transport_pickup_map` (ในฐานข้อมูล sandbox มีแถวจริงแล้ว: `live_vehicles` 9, `affiliation_pickup_map` 4, `transport_pickup_map` 3, `province_pickup_map` 2) **ไม่ครอบคลุมเมนูอื่น และไม่มีมิติของ path** ข้อสรุป "ไม่มี page-view telemetry รายเมนู" จึงยังยืนอยู่ แต่ต้องระบุข้อยกเว้นสองหน้านี้ไว้ด้วย

**ผลที่ตามมาสำหรับ C3-1**: baseline นี้เป็น **structural baseline เท่านั้น** ไม่มีตัวเลข "หน้าที่ถูกเปิดบ่อยที่สุดต่อบทบาท" ครบทุกเมนูให้เทียบ before/after ได้จากระบบ ตัวชี้วัดที่ C3-1 ระบุไว้ (task completion, time-on-task, error, help request — `execution-plan-to-completion-2026-09-04.md:440`) **ไม่มีตัวใดที่ระบบบันทึกไว้เอง** จึงต้องเก็บจากการสังเกตระหว่าง UAT สิ่งเดียวที่ระบบให้ได้คือจำนวนครั้งที่เปิดหน้า live-vehicles และ pickup-map ต่อผู้ใช้ (แถว `action=VIEW` dedupe 5 นาที ตามข้อก่อนหน้า) ซึ่งใช้เทียบ before/after ได้เฉพาะสองหน้านั้น ไม่ใช่ทั้งเมนู

ข้อมูล aggregate ที่มีอยู่และใช้อ้างอิงบริบทได้ (ไม่ใช่ข้อมูลเมนู) คือ audit aggregates 90 วันที่บันทึกไว้แล้วใน `role-menu-participatory-research-audit-2026-09-04.md:41-49` (School 8,814 actions / 161 ผู้ใช้, Affiliation 509 / 7, Admin 325 / 2, Province 101 / 3, Driver 67 / 9, Transport 28 / 3) — ตัวเลขชุดนั้นอ่านจาก production เมื่อ 4 กันยายน 2569 และ **เอกสารฉบับนี้ยืนยันซ้ำไม่ได้จากเครื่องนี้**

## 9. API inventory

รันจาก source ที่ commit `4b80b4b` ด้วย `backend/scripts/generate-rbac-matrix.js` ซึ่งเดิน router graph ของ Express จริงหลัง stub ฐานข้อมูล ไม่มีการต่อ DB (`generate-rbac-matrix.js:6-20`)

### 9.1 จำนวน route รวม ตามสถานะ flag

| สถานะ flag | route ทั้งหมด | write route | route ที่มี role guard | findings |
|---|---:|---:|---:|---:|
| `.env.test.example` ตามที่เป็น (flag ทุกตัวปิด) | 249 | 120 | 226 | 0 |
| + `FEATURE_DRIVER_REGISTRATION=true` (เทียบเท่า production) | **266** | 130 | 243 | 0 |
| flag ทั้ง 10 ตัวเปิด | 292 | 142 | 263 | 0 |

`.env.test.example` ตั้งค่าไว้เพียง 3 ตัว (`FEATURE_DRIVER_SHIFT_SELECTION`, `FEATURE_VEHICLE_QR`, `FEATURE_QR_LEVEL3` ทั้งหมด `=false` — `backend/.env.test.example:12-14`) ตัวที่เหลือไม่ได้ตั้ง จึงเป็น false ตามค่าเริ่มต้นของ `env.js:205-238` ผลคือ generator บันทึกเฉพาะ 3 ตัวนี้ในฟิลด์ `feature_flags` (มันเก็บเฉพาะ env ที่ขึ้นต้นด้วย `FEATURE_` และถูกตั้งค่า — `generate-rbac-matrix.js:235-240`) **ฟิลด์ `feature_flags` ในไฟล์ผลลัพธ์จึงไม่ใช่รายการ flag ครบทั้ง 10 ตัว** ต้องอ่านคู่กับ §5 เสมอ

### 9.2 จำนวน route ที่แต่ละบทบาทเรียกได้

| บทบาท | flag ปิดทั้งหมด (total / write / read) | เทียบเท่า production (total / write / read) | flag เปิดครบ (total / write / read) |
|---|---|---|---|
| driver | 37 / 21 / 16 | **45 / 26 / 19** | 53 / 30 / 23 |
| school | 69 / 31 / 38 | **79 / 36 / 43** | 86 / 38 / 48 |
| affiliation | 39 / 12 / 27 | **39 / 12 / 27** | 46 / 14 / 32 |
| province | 27 / 1 / 26 | **27 / 1 / 26** | 36 / 3 / 33 |
| transport | 26 / 10 / 16 | **27 / 10 / 17** | 35 / 14 / 21 |
| admin | 190 / 85 / 105 | **200 / 90 / 110** | 218 / 98 / 120 |

ตัวเลขต่อบทบาทบวกกันแล้วมากกว่าจำนวน route ทั้งหมด เพราะ route หนึ่งเปิดให้หลายบทบาทได้ ตัวเลขนี้คือ "route ที่บทบาทนั้นเรียกได้" ไม่ใช่ "route ที่เป็นของบทบาทนั้น"

### 9.3 route ที่เปิดเพิ่มเมื่อเปิด flag (สำหรับเทียบ like-for-like)

`FEATURE_DRIVER_REGISTRATION` เปิด → เพิ่ม **17 route**:

| กลุ่ม | จำนวน | ตัวอย่าง |
|---|---:|---|
| `/api/driver/registrations/*` | 7 | `GET /api/driver/registrations`, `POST /api/driver/registrations/students` |
| `/api/school/registrations/*` | 9 | `POST /api/school/registrations/:applicationId/approve` |
| `/api/documents/*` | 1 | `GET /api/documents/:docType/:id/file` (role: admin, driver, school, transport) |

flag ที่เหลือเปิด → เพิ่มอีก **26 route**: `/api/consent` 7, `/api/geofences` 7, `/api/participation` 5, `/api/qr` 4, `/api/eta` 2, `/api/route-deviations` 1 ทั้งหมด mount แบบมีเงื่อนไขที่ `backend/src/app.js:139-145, 196-197, 203-235`

### 9.4 route ที่ไม่มี role guard

23 route จาก 249 (สถานะ flag ปิดทั้งหมด) ไม่มี `requireRole` ซึ่ง generator จำแนกเป็นกลไก auth แบบอื่น ไม่ใช่ช่องว่าง โดยใช้รายการคนละชุดสองรายการ: `NON_ROLE_AUTH` (`generate-rbac-matrix.js:34-41` — ครอบ `/api/auth`, `/api/parent`, `/api/line`) และ `ACCEPTED_OPEN_ROUTES` (`generate-rbac-matrix.js:49-70` — ครอบ `/api/terms/current`, `/api/visits/track`, `/health`):

| prefix | จำนวน | กลไกที่ใช้แทน |
|---|---:|---|
| `/api/auth` | 12 | public / self-service (login, refresh, change-password) |
| `/api/parent` | 6 | LINE id_token ผ่าน `requireParentLineAuth` |
| `/api/line` | 2 | LINE webhook signature |
| `/api/terms` | 1 | authenticated ทุกบทบาท (`/api/terms/current`) |
| `/api/visits` | 1 | public counter (§8) |
| `/health` | 1 | public liveness probe |

generator รายงาน `findings: 0` ในทั้งสามสถานะ flag หมายความว่าไม่มี route ที่หลุดจากทั้ง role guard และรายการ accepted-open — **ไม่ได้แปลว่าสิทธิ์ถูกต้องตามเจตนา** เพราะ generator ตรวจว่ามี guard ทำงานอยู่ ไม่ได้ตรวจว่า role ที่ระบุคือ role ที่ควรเข้าถึงจริง การตัดสินข้อหลังต้องใช้ RBAC matrix ที่เจ้าของงานอนุมัติ

### 9.5 Scope enforcement (`audit-scope-enforcement.js`)

เป็น static check ว่า write handler ที่อ้าง resource ด้วย id มีการดึงและใช้ค่า scope หรือไม่ — พิสูจน์ว่ามีการหา scope ไม่ได้พิสูจน์ว่า SQL predicate ถูกต้อง (`audit-scope-enforcement.js:27-30`)

| ตัวชี้วัด | flag ปิดทั้งหมด | เทียบเท่า production |
|---|---:|---:|
| id-addressed writes | 75 | 75 |
| reachable โดย scoped role (school/affiliation/driver) | 30 | 37 |
| organisation-scoped | 25 | 30 |
| self-scoped | 5 | 6 |
| actor-scoped only | 0 | 1 |
| gaps | 0 | 0 |
| ไม่ได้ mount ภายใต้ flag ปัจจุบัน | 12 | 5 |

รายการ actor-scoped only ที่ปรากฏเมื่อเปิด `FEATURE_DRIVER_REGISTRATION`: `DELETE /api/driver/registrations/documents/:kind/:id` (`backend/src/routes/registration.routes.js`) — script แจ้งให้ยืนยันว่าแถวถูก key ด้วย actor จริง ยังไม่มีใครยืนยันข้อนี้ในเอกสารใด

## 10. สิ่งที่ยังไม่มีในงาน A0-10 นี้

| รายการ | สถานะ |
|---|---|
| `docs/audit/menu-baseline-<rc>.md` | เอกสารฉบับนี้ — แต่ **ตั้งชื่อด้วยวันที่ ไม่ใช่ `<rc>`** (`menu-baseline-2026-09-04.md` ไม่ใช่ `menu-baseline-cef4bd1.md`) commit ที่อ่านและความเท่ากันกับ RC `cef4bd1` ระบุไว้ใน §1 |
| `outputs/rbac-matrix/<run>/` ของ baseline นี้ | **ยังไม่มี** — ผลลัพธ์ JSON ของรอบนี้ถูกเขียนนอก repository ตามข้อจำกัดของงานรอบนี้ ต้องรันใหม่แล้วเก็บลง path จริงจึงจะครบ exit evidence ตาม `execution-plan-to-completion-2026-09-04.md:102` · **มี run เก่าอยู่แล้วที่ `outputs/rbac-matrix/20260904T044804Z/`** (routes 283 / write 137 / role guard 258 / findings 0, flag คนละชุด) **ห้ามใช้แทน baseline นี้** และ flag ที่ run นั้นบันทึกไว้มี `FEATURE_DRIVER_SHIFT` ซึ่งไม่ใช่ชื่อ env ที่ app อ่าน (app อ่าน `FEATURE_DRIVER_SHIFT_SELECTION` — `backend/src/config/env.js:210`) |
| ยืนยันสถานะ feature flag บน production | **ยังไม่มี** — รอ `outputs/operator-gates/<run>/feature-flags.redacted.log` (A0-11 / B0-1) |
| ยืนยันด้วยการเปิดหน้าจอจริงว่าเมนูแสดงตามจำนวนใน §3 | **ยังไม่มี** — ไม่ได้เปิด browser ในรอบนี้ |
| Usage baseline รายเมนู | **เป็นไปไม่ได้จากระบบปัจจุบันสำหรับเมนูส่วนใหญ่** (§8) ไม่ใช่แค่ยังไม่ได้ทำ · ข้อยกเว้นคือหน้า live-vehicles และ pickup-map ที่มีแถว `action=VIEW` ต่อผู้ใช้ (dedupe 5 นาที) ใช้เป็น usage baseline บางส่วนได้เฉพาะสองหน้านั้น |

คำสั่งที่ใช้ (เขียนผลลัพธ์ไปนอก repository):

```
cd backend && set -a && . ./.env.test.example && set +a \
  && node scripts/generate-rbac-matrix.js --json --out <OUT_DIR>/rbac-matrix.json
cd backend && set -a && . ./.env.test.example && set +a \
  && node scripts/audit-scope-enforcement.js --out <OUT_DIR>/scope-enforcement.json
```

สำหรับชุด "เทียบเท่า production" เติม `FEATURE_DRIVER_REGISTRATION=true` หน้า `node` และสำหรับชุด flag ครบให้ตั้งทั้ง 10 ตัวตาม `backend/src/config/env.js:205-238`

หมายเหตุ: ไฟล์ผลลัพธ์มีฟิลด์ `generated_at` เป็น timestamp จึงเทียบด้วย checksum ตรง ๆ ไม่ได้ ให้เทียบที่ `totals` และ `by_role` แทน

## 11. ค่าที่ต้องรอการตัดสินใจ ห้ามเติมเอง

ตาราง before/after ของ C3-1 มีช่องที่ยังเติมไม่ได้ เพราะขึ้นกับการตัดสินใจที่ยังไม่มีคำตอบ (`execution-plan-to-completion-2026-09-04.md` §4.1)

| ช่อง | ค่า |
|---|---|
| จำนวนเมนูเป้าหมายต่อบทบาท (คอลัมน์ "after" ที่จะถือว่าสำเร็จ) | **รอ C0-3** — ข้อเสนอใน `role-menu-participatory-research-audit-2026-09-04.md:261-270` (Driver 5, School 8, Teacher 5-6, Affiliation 7, Province 6, Transport 3-4, Admin 8, Parent 3) เป็น **ข้อเสนอ ยังไม่ได้อนุมัติ** และเอกสารฉบับนี้ไม่ถือว่าเป็นเป้าหมาย |
| สถานะ feature flag ที่จะใช้ตอนวัด after | **รอ C0-4** |
| จะซ่อน `/school/approvals` (legacy) และรวมกับ Driver Registration หรือไม่ | **รอ C0-9** — กระทบจำนวนเมนู School โดยตรง |
| `/province/readiness` จะย้ายออกจากเมนูประจำของจังหวัดหรือไม่ | **รอ C0-10** — กระทบจำนวนเมนู Province |
| ครูประจำสายชั้นจะเช็กเด็กได้หรือไม่ (กระทบชุด `TEACHER_BLOCKED_PATHS`) | **รอ C0-1** |
| เมนูของ Parent ที่จะเพิ่ม (ช่องทาง feedback) | **รอ C0-12** |
| เมนู/หน้าจัดการความเป็นส่วนตัวของ Parent (ถอน consent, สิทธิเจ้าของข้อมูล) | **รอ D0-6, D0-8** |

ห้ามเติมค่าใดในตารางนี้ก่อนได้คำตอบ ตัวเลขที่เดาไว้จะไหลเข้า UAT script, evidence pack และรายงานผลก่อนที่ใครจะทันตรวจ (`execution-plan-to-completion-2026-09-04.md:89`)

---

ตัวเลขเมนูและ API inventory จัดทำจาก source ที่ commit `4b80b4b` รอบตรวจทานแก้ไขเพิ่มการอ่านอย่างเดียวจาก sandbox ในเครื่อง (HTTP status จาก backend `localhost:3000` และ `SELECT` จาก `lampang_bus_sandbox`) ตามที่ระบุไว้ใน §2 · ไม่มีการเข้าถึง production, ไม่มีการ deploy, ไม่มี migration และไม่มีการเขียนฐานข้อมูลใด ๆ ในการจัดทำเอกสารนี้

## 12. Re-audit ที่ `a0e783e` (5 กันยายน 2569 ค่ำ) — ตัวเลขข้างบนยังใช้ได้หรือไม่

§1 บอกไว้ว่าถ้า `Sidebar.jsx` หรือ `backend/src/app.js` เปลี่ยน ต้องรัน baseline ใหม่ ทั้งสองไฟล์เปลี่ยนแล้วตั้งแต่ `4b80b4b`
(`git diff --stat 4b80b4b..a0e783e -- frontend/src backend/src` = 120+ ไฟล์: participation frontend `c077f03`, shared security state 051 `26dbde4`/`1366af8`,
research export `c3989d4`, capacity-sample `e8e168f`, boot guard 050 `bc0bbd6`, frontend delta `d1449dc`) จึงรันเครื่องมือชุดเดิมซ้ำที่ `a0e783e`
ซึ่งเป็น commit ที่ production รันอยู่ ณ เวลาที่รัน (`docs/ops/deploy-2026-09-05-a0e783e.md`) ผลดิบอยู่ที่ `outputs/rbac-matrix/20260905-215630/`

### 12.1 เมนู (นับจาก `Sidebar.jsx` ด้วยกติกาเดียวกับ `navItemsForUser()`: FLAG_GATED, dedupe `/driver/requests` เมื่อ `driverRegistration` เปิด, TEACHER_BLOCKED_PATHS)

| บทบาท | defined (เดิม → ใหม่) | visible: flag ปิดทั้งหมด | visible: production (`driverRegistration` เท่านั้น) | visible: flag เมนูเปิดครบ (**5 ตัว** ตอนนี้) |
|---|---:|---:|---:|---:|
| Driver | 8 → **9** | 5 | **6** | 8 |
| School (บัญชีเต็ม) | 13 → **14** | 12 | **13** | 14 |
| School (ครูประจำสายชั้น) | 13 → 14 | 9 | **9** | 10 |
| Affiliation | 12 → **13** | 12 | **12** | 13 |
| Province | 12 → **13** | 11 | **11** | 13 |
| Transport | 4 → **5** | 4 | **4** | 5 |
| Admin | 25 → **26** | 23 | **23** | 26 |
| **รวม 6 บทบาท** | 74 → **80** | 67 | **69** | 79 |

สิ่งเดียวที่เปลี่ยน: ทุกบทบาทได้รายการ `/participation` ("เรื่องที่ต้องมีส่วนร่วม") เพิ่ม 1 รายการ ซึ่งถูกซ่อนด้วย `participationCases` (`Sidebar.jsx` FLAG_GATED)
ดังนั้น **จำนวนเมนูที่ผู้ใช้เห็นจริงในสถานะ flag แบบ production ยังเท่าเดิมทุกบทบาท (รวม 69)** และตัวเลข "flag เมนูเปิดครบ" ตอนนี้หมายถึง 5 flag (เพิ่ม `participationCases`)
ตารางใน §3.1 จึงยังใช้เทียบ like-for-like ได้ในสองคอลัมน์แรก ส่วนคอลัมน์สุดท้ายให้ใช้ค่าใหม่ข้างบน

### 12.2 Route ของ frontend (`App.jsx`)

`path=` = **95** รายการ (เดิม 92) — เพิ่ม 3 รายการจาก participation frontend (`c077f03`) ข้อสังเกตใน §7 ข้อ 1 (route ไม่ถูกกรองด้วย flag) ยังเป็นจริง

### 12.3 API inventory (`generate-rbac-matrix.js` ที่ `a0e783e`)

| สถานะ flag | route ทั้งหมด (เดิม → ใหม่) | write | มี role guard | findings |
|---|---:|---:|---:|---:|
| flag ทุกตัวปิด | 249 → **250** | 120 | 226 → 227 | 0 |
| เทียบเท่า production (`FEATURE_DRIVER_REGISTRATION=true`) | 266 → **267** | 130 | 243 → 244 | 0 |
| flag ทั้ง 10 ตัวเปิด | 292 → **293** | 142 | 263 → 264 | 0 |

route ที่เพิ่ม 1 รายการในทุกสถานะคือ `GET /api/admin/operations/capacity-sample` (`e8e168f`, admin-only read; ดู RR-10 ใน residual-risk register)
รายบทบาท (production): driver 45/26/19 · school 79/36/43 · affiliation 39/12/27 · province 27/1/26 · transport 27/10/17 · **admin 201/90/111** (เดิม 200/90/110) — ตัวอื่นเท่าเดิมทุกตัว
route ที่ไม่มี role guard ยัง 23 รายการ prefix เดิม (`/api/auth` 12, `/api/parent` 6, `/api/line` 2, `/api/terms` 1, `/api/visits` 1, `/health` 1)

### 12.4 Scope enforcement (`audit-scope-enforcement.js`, production flags)

`id-addressed writes=75 scoped-role-reachable=37 org=30 self=6 actor-only=1 gaps=0 unmounted=5` — **เท่ากับ §9.5 ทุกค่า** actor-scoped only ยังเป็น `DELETE /api/driver/registrations/documents/:kind/:id` รายการเดิม

### 12.5 สรุป

baseline นี้ **re-pin ได้ที่ `a0e783e`** สำหรับ §3 (เมนูที่มองเห็นในสถานะ production), §9 และ §9.5 โดยมีส่วนต่างที่บันทึกไว้ข้างบนครบ · สิ่งที่ยังไม่ได้ทำซ้ำ: การเปิดหน้าใน browser จริงตาม §10 และการนับ mobile bottom nav (§6) ด้วยตา

