# Manual Content Audit เทียบ RC — กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกผลตรวจเนื้อหาคู่มือเทียบกับ RC ตามงาน `A0-7`** (`docs/project-closure/execution-plan-to-completion-2026-09-04.md:99`) — เอกสารนี้ **ไม่ใช่** การอนุมัติ **ไม่ใช่** หลักฐานการทดสอบ **ไม่ใช่** UAT **ไม่ใช่** การรับรองว่าคู่มือหรือระบบพร้อมใช้งาน และ **ไม่ได้** ยืนยันสถานะ feature flag บน production

เอกสารนี้ระบุเฉพาะสิ่งที่ **อ่านพบในไฟล์จริง** ในเวิร์กทรีนี้ ณ commit ที่ระบุใน §1 ทุกข้อความอ้าง `file:line` ข้อใดที่ตรวจไม่ได้จากเครื่องนี้ ระบุไว้ใน §8 และข้อใดที่ค่าขึ้นกับการตัดสินใจที่ยังไม่มี เขียนว่า **"รอ &lt;decision id&gt;"** และเว้นว่างไว้ ห้ามเติมแทน

งานนี้เป็น **audit อย่างเดียว** ไม่มีการ regenerate คู่มือ HTML/PDF ไม่มีการถ่าย screenshot ใหม่ และไม่มีการแก้ไขไฟล์คู่มือใด ๆ

---

## 1. จุดอ้างอิงที่ยืนยันได้

| รายการ | ค่า | หลักฐาน |
|---|---|---|
| Branch / HEAD ที่ตรวจ | `feat/tracking-security-hardening` @ `4b80b4b` (4 ก.ย. 2569) | `git log -1` |
| RC ที่แผนอ้าง | `cef4bd1` | `execution-plan-to-completion-2026-09-04.md:13` |
| ระยะห่าง `cef4bd1..4b80b4b` | 3 commits — แตะเฉพาะ `docs/`, `scripts/`, `backend/tests/` และ `.gitattributes` (26 บรรทัด ที่ราก repo) **ไม่แตะ** `frontend/src` หรือ `backend/src` | `git diff --stat cef4bd1..HEAD` (15 ไฟล์) |
| ผลต่อ audit นี้ | เมนู เส้นทาง และ feature flag ที่ตรวจในเอกสารนี้ **เหมือนกันทั้งที่ `cef4bd1` และ `4b80b4b`** | ผลข้างบน |

> ⚠️ ตัวระบุ RC ยังไม่ตรงกันข้ามเอกสาร: แผนหลักระบุ `cef4bd1` (`execution-plan-to-completion-2026-09-04.md:13`) ขณะที่ `sandbox-verification-2026-09-04.md:17` ระบุว่า sandbox รันบน `1cccee8` — ขัดกับหลักการข้อ 3 "RC เดียวตลอดทาง" (`execution-plan-to-completion-2026-09-04.md:26`) ต้องตรึงตัวเลขเดียวก่อน A2-5 มิฉะนั้นคู่มือรอบใหม่จะอ้าง RC ที่ไม่ตรงกับ evidence pack

---

## 2. ขอบเขต — คู่มือที่ตรวจ

ชุดคู่มือที่ build จริง (สอดคล้องกับ 8 ไฟล์ PDF ใน `docs/manual-pdf/`) มี **8 เล่ม** = สารบัญหลัก 1 + รายบทบาท 7 แต่ละเล่มมี **2 ร่าง** คือ `.md` ใน `docs/` และ `.html` ใน `docs/manual-html/` ซึ่ง **ไม่ตรงกัน** (ดู §5 กลุ่ม P)

| # | เล่ม | Markdown | HTML | PDF (ชื่อแจกจริง) | วันแก้ล่าสุด (md / html) |
|---|---|---|---|---|---|
| 1 | สารบัญหลัก | `docs/user-manual.md` | `docs/manual-html/index.html` | `คู่มือ-สารบัญหลัก.pdf` | 2026-08-26 / 2026-08-28 |
| 2 | คนขับ | `docs/user-guide-driver.md` | `user-guide-driver.html` | `คู่มือ-คนขับ.pdf` | 2026-06-25 / 2026-08-28 |
| 3 | โรงเรียน | `docs/user-guide-school.md` | `user-guide-school.html` | `คู่มือ-โรงเรียน.pdf` | 2026-06-25 / 2026-08-28 |
| 4 | สังกัด/เขต | `docs/user-guide-affiliation.md` | `user-guide-affiliation.html` | `คู่มือ-สังกัดเขต.pdf` | 2026-06-25 / 2026-06-28 |
| 5 | ส่วนกลาง/จังหวัด | `docs/user-guide-province.md` | `user-guide-province.html` | `คู่มือ-จังหวัด.pdf` | 2026-08-18 / 2026-08-18 |
| 6 | ขนส่ง | `docs/user-guide-transport.md` | `user-guide-transport.html` | `คู่มือ-ขนส่ง.pdf` | 2026-06-25 / 2026-08-28 |
| 7 | ผู้ดูแลระบบ | `docs/user-guide-admin.md` | `user-guide-admin.html` | `คู่มือ-ผู้ดูแลระบบ.pdf` | 2026-08-18 / 2026-06-28 |
| 8 | ผู้ปกครอง (LINE) | `docs/user-guide-parent.md` | `user-guide-parent.html` | `คู่มือ-ผู้ปกครอง.pdf` | 2026-06-25 / 2026-06-28 |

(วันแก้ล่าสุด = `git log -1 --date=short` ต่อไฟล์)

**เอกสารเพิ่มเติมในโฟลเดอร์เดียวกันที่ไม่ได้อยู่ในชุด 8 เล่ม:**

- `docs/user-guide-transport-province-affiliation.md` — ติดป้าย `SUPERSEDED` ไว้แล้วที่บรรทัด 3 และ 11 ("เวอร์ชัน Phase 10.11A • อัปเดต 2026-06-02 (เลิกใช้แล้ว)") แต่ไฟล์ยังถูกแก้เมื่อ 2026-08-18 และยังขัดกับคู่มือขนส่งฉบับปัจจุบัน (ดู X5)
- `docs/manual-training-2026-08/` — ชุดคู่มืออบรม 10 โมดูล + PDF อีกชุด อยู่นอกขอบเขต A0-7 แต่ **สารบัญหลักชี้ผู้อบรมไปที่ชุดนี้** (`docs/user-manual.md:14`) จึงเป็น dependency ของ A2-5/A2-6 (ดู P4)

---

## 3. Feature flag ที่มีจริงใน RC (ฐานเปรียบเทียบ)

อ่านจาก `backend/src/config/env.js` โครงสร้าง `features` (บรรทัด 205–238) — มี **10 flag** ตรงกับรายการใน C0-4 (`execution-plan-to-completion-2026-09-04.md:59`)

| flag (env var) | คีย์ในโค้ด | env.js | ค่า default ใน `backend/.env.example` | มีใน `.env.example` หรือไม่ |
|---|---|---|---|---|
| `FEATURE_ADMIN_PASSWORD_RECOVERY` | `adminPasswordRecovery` | `env.js:208` | `false` | มี (`:89`) |
| `FEATURE_VEHICLE_QR` | `vehicleQr` | `env.js:209` | `false` | มี (`:113`) |
| `FEATURE_DRIVER_SHIFT_SELECTION` | `driverShiftSelection` | `env.js:210` | `false` | มี (`:125`) |
| `FEATURE_QR_LEVEL3` | `qrLevel3` | `env.js:211` | `false` | มี (`:117`) |
| `FEATURE_ETA` | `eta` | `env.js:218` | — | **ไม่มี** |
| `FEATURE_GEOFENCE` | `geofence` | `env.js:219` | — | **ไม่มี** |
| `FEATURE_ROUTE_DEVIATION` | `routeDeviation` | `env.js:220` | — | **ไม่มี** |
| `FEATURE_DRIVER_REGISTRATION` | `driverRegistration` | `env.js:224` | `false` | มี (`:136`) |
| `FEATURE_PARENT_CONSENT_REQUIRED` | `parentConsentRequired` | `env.js:232` | — | **ไม่มี** |
| `FEATURE_PARTICIPATION_CASES` | `participationCases` | `env.js:237` | `false` | มี (`:84`) |

ข้อบังคับระหว่าง flag ที่บังคับตอน boot:
- `FEATURE_QR_LEVEL3` ต้องมี `FEATURE_VEHICLE_QR=true` มิฉะนั้น backend ไม่ start (`env.js:52-53`)
- `FEATURE_PARENT_CONSENT_REQUIRED` ต้องมี `FEATURE_VEHICLE_QR=true` (`env.js:60-63`)
- `FEATURE_ADMIN_PASSWORD_RECOVERY` ต้องมี `LINE_LIFF_ID` + `LINE_CHANNEL_ACCESS_TOKEN` (`env.js:66-72`)

เมื่อ flag ปิด router จะไม่ถูก mount เลย (`backend/src/app.js:139` driverRegistration, `:196` participationCases, `:203` vehicleQr, `:228` eta, `:231` geofence, `:234` routeDeviation) — เส้นทางเหล่านั้นจึงตอบ 404 ไม่ใช่ 403

**สถานะ accept / pilot / defer ของทั้ง 10 flag: รอ C0-4** (`execution-plan-to-completion-2026-09-04.md:59`)

> ผลต่อคู่มือโดยตรง: คู่มือทุกเล่มในชุดนี้เขียน **สถานะ flag เป็นค่าคงที่** ("ปิด" / "เปิด") ทั้งที่ยังไม่มีคำตอบ C0-4 และค่า default ในโค้ดเป็น `false` ทุกตัว การเขียนสถานะแบบชี้ขาดจึงเป็นการตัดสินใจแทน owner ก่อนถึงเวลา — ดูกลุ่ม F

---

## 4. หมายเหตุเรื่องคอลัมน์ "ระดับผลกระทบ"

โครงการยังไม่มี **severity scheme** ที่อนุมัติแล้ว — เป็นส่วนหนึ่งของ **C0-13** (`execution-plan-to-completion-2026-09-04.md:68`) คอลัมน์ "ระดับผลกระทบ" ในตาราง §5 จึงเป็น **การจัดลำดับของผู้ตรวจเพื่อใช้เรียงคิวงานเท่านั้น ไม่ใช่ severity ของโครงการ** เมื่อ C0-13 ได้ข้อสรุปแล้วต้อง map ใหม่ทั้งตาราง

เกณฑ์ที่ใช้เรียงในเอกสารนี้:
- **สูง** — คู่มือบอกผู้ใช้ให้ทำสิ่งที่ทำไม่ได้ หรือปิดบังงานที่ต้องทำจริง หรือกล่าวอ้างสถานะที่ไม่มีสิทธิ์กล่าว
- **กลาง** — ผู้ใช้หาเมนู/หน้าไม่เจอตามคำอธิบาย หรือคำอธิบายไม่ครบจนต้องเดา
- **ต่ำ** — เนื้อหาถูกแต่ metadata/ภาพประกอบไม่ตรงรุ่น

---

## 5. ผลตรวจ

### กลุ่ม F — ส่วนที่บรรยายฟีเจอร์ซึ่ง flag ปิดอยู่ / สถานะ flag ไม่ตรงกับ RC

| # | คู่มือ | ส่วน | ปัญหา | หลักฐาน | ระดับผลกระทบ | ต้องแก้อะไรก่อน A2-5 |
|---|---|---|---|---|---|---|
| F1 | สารบัญหลัก (`user-manual.md`) | §3 ตาราง Feature Flags | ตารางมีเพียง **5 flag** จาก 10 flag ที่มีจริงใน RC — ขาด `FEATURE_ADMIN_PASSWORD_RECOVERY`, `FEATURE_DRIVER_REGISTRATION`, `FEATURE_QR_LEVEL3`, `FEATURE_PARENT_CONSENT_REQUIRED`, `FEATURE_PARTICIPATION_CASES` | `docs/user-manual.md:90-94` เทียบ `backend/src/config/env.js:205-238` | สูง | เขียนตารางใหม่ให้ครบ 10 flag ตาม `env.js` และใส่คอลัมน์สถานะเป็น **"รอ C0-4"** ทั้งคอลัมน์ ห้ามเติมค่า "ปิด"/"เปิด" เอง |
| F2 | สารบัญหลัก (HTML) | §3 ตาราง Feature Flags | ฉบับ HTML เพิ่ม `FEATURE_DRIVER_REGISTRATION` เป็น **"เปิด"** — เป็นการชี้ขาดสถานะ flag ก่อน C0-4 และเป็นค่าที่สังเกตจาก production เมื่อ 27–28 ส.ค. 2569 ไม่ใช่ค่าของ RC (ค่า default ในโค้ดคือ `false`) | `docs/manual-html/index.html:359-363` (แถวในตาราง flag) · commit `65b5866` (2026-08-28) · `backend/.env.example:136` | สูง | ลบคำตัดสินสถานะออก ใช้ **"รอ C0-4"** และผูกกับหลักฐาน `outputs/operator-gates/<run>/feature-flags.redacted.log` ที่ A0-11/B0-1 จะสร้าง แทนการอ้างการสังเกตด้วยตา |
| F3 | คนขับ (HTML) | งานที่ 15 "รายชื่อเด็กในรถ" | ระบุ "✅ ฟีเจอร์นี้เปิดใช้งานอยู่จริงบนระบบ (production) … ตรวจสอบสถานะเมื่อ 27 ส.ค. 2569" — ขัดกับ `MVP-CUT-2026-08.md` ที่จัด flag นี้อยู่ฝั่ง **CUT (ปิดไว้)** และขัดกับ C0-4 ที่ยังไม่ตัดสิน | `docs/manual-html/user-guide-driver.html:586-589` (งานที่ 15) · `docs/MVP-CUT-2026-08.md:42` · `execution-plan-to-completion-2026-09-04.md:59` | สูง | เขียนเป็นเงื่อนไข 2 ทาง (flag เปิด/ปิดเห็นอะไรต่างกัน) และใส่ **"รอ C0-4"** ตรงช่องสถานะ ห้ามระบุสถานะเดียว |
| F4 | คนขับ (Markdown) | ทั้งเล่ม | ฉบับ `.md` **ไม่มี** งานที่ 14/15 (ขึ้นทะเบียนรถ / รายชื่อเด็กในรถ) และไม่กล่าวถึง `FEATURE_DRIVER_REGISTRATION` เลย — คนขับที่อ่าน `.md` จะข้ามงานลงทะเบียนเด็กทั้งกระบวนการ | สารบัญ `docs/user-guide-driver.md:20-36` (จบที่งานที่ 13) เทียบ `docs/manual-html/user-guide-driver.html:561` (งานที่ 14) และ `:586` (งานที่ 15) · `grep FEATURE_DRIVER_REGISTRATION docs/user-guide-*.md` = ไม่พบ | สูง | รวมสองร่างให้เหลือ source เดียวก่อน (ดู P1) แล้วจึงเพิ่มหัวข้อพร้อมสถานะ **"รอ C0-4"** |
| F5 | โรงเรียน (Markdown) | ทั้งเล่ม | เมนู **"ตรวจลงทะเบียนรถ"** (`/school/registration-review`) มีอยู่จริงใน Sidebar และมี screenshot แล้ว แต่ `.md` ไม่มีหัวข้อนี้ (มีเฉพาะใน `.html`) | `frontend/src/components/Sidebar.jsx:44` · `docs/manual-html/screenshots/school/18-registration-review.png` · สารบัญ `docs/user-guide-school.md:24-48` | สูง | เพิ่มหัวข้อใน source เดียวหลังรวมร่าง พร้อมระบุว่าเมนูจะหายไปเมื่อ flag ปิด (`Sidebar.jsx:177`) |
| F6 | ขนส่ง (Markdown) | "ฟีเจอร์ที่อาจยังไม่เปิดใช้งาน (Feature Flag)" | ระบุเฉพาะ `FEATURE_VEHICLE_QR` — ไม่กล่าวถึง `FEATURE_DRIVER_REGISTRATION` ทั้งที่ฉบับ HTML ระบุว่าเงื่อนไข "รถพร้อมใช้งาน" เปลี่ยนไปเมื่อ flag นั้นเปิด (ต้องได้อนุมัติจากทุกโรงเรียน **และ** ผ่านตรวจสภาพ) | `docs/user-guide-transport.md:279-285` เทียบ `docs/manual-html/user-guide-transport.html:403-408` (ย่อหน้าเดียวกัน; เงื่อนไข "รถพร้อมใช้งาน" อยู่ที่ `:407`) | สูง | เขียนเงื่อนไข "รถพร้อมใช้งาน" ให้ครบทั้งสองกรณีของ flag พร้อม **"รอ C0-4"** |
| F7 | ทุกเล่ม | ทุกส่วน | **ไม่มีคู่มือเล่มใดเลย** (ทั้ง `.md`, `.html` และชุดอบรม) ที่กล่าวถึง `FEATURE_PARENT_CONSENT_REQUIRED`, `FEATURE_PARTICIPATION_CASES` และ `FEATURE_ADMIN_PASSWORD_RECOVERY` ทั้งที่ทั้งสามตัวเปลี่ยนสิ่งที่ผู้ใช้เห็นโดยตรง (การกรองข้อมูลบุตรหลาน / เมนูเคสมีส่วนร่วม / ปุ่มกู้รหัสผ่านหน้า login) | `grep -rl` ทั้ง `docs/user-guide-*.md docs/user-manual.md docs/manual-html/*.html docs/manual-training-2026-08/*.md` = ไม่พบทั้ง 3 ตัว · `env.js:208,232,237` | สูง | ตัดสินก่อนว่าแต่ละตัวอยู่ใน accepted scope หรือไม่ (**รอ C0-4**) ถ้าอยู่ ต้องมีหัวข้อในคู่มือของบทบาทที่เกี่ยวข้อง; เนื้อหา consent **รอ D0-4/D0-5** |
| F8 | ผู้ปกครอง | งานที่ 4 "ดูข้อมูลบุตรหลาน" | คู่มืออธิบายรายการบุตรหลานแบบไม่มี consent gate แต่ RC มีการปิดบัง `plate_no`/`driver_name` และคืน `consent_required` เมื่อ gate เปิด | `docs/user-guide-parent.md:126-140` เทียบ `backend/src/routes/parent.routes.js:99-116` และ `backend/src/services/parentConsentGate.js:103-112` | กลาง | เพิ่มคำอธิบายสองสถานะ; ข้อความที่แสดงจริงและผลของการถอนความยินยอม **รอ D0-3, D0-5, D0-6** |
| F9 | ผู้ปกครอง | งานที่ 7 "QR + ความยินยอม PDPA" | คู่มือระบุผลของการถอนความยินยอมไว้ชี้ขาด ("สิทธิ์การดู QR จะกลับเป็นระดับ 1 ทันที" — `:190`) และบรรยายชั้นข้อมูล **ระดับ 1–2 เท่านั้น** (`:181-182`) โดยไม่กล่าวถึงระดับ 3 เลย (`grep "ระดับ 3" docs/user-guide-parent.md` = ไม่พบ) ทั้งที่ `FEATURE_QR_LEVEL3` มีอยู่จริง (`env.js:211`) — ทั้งหมดเป็นเนื้อหาที่ยังไม่ผ่าน DPO และโค้ดยังรับ consent type สองแบบพร้อมกัน (`parent_tracking_optin`, `qr_parent_optin`) | `docs/user-guide-parent.md:173-194` · `backend/src/services/parentConsentGate.js:26` · `execution-plan-to-completion-2026-09-04.md:80,81,82` (D0-5, D0-6, D0-7) | สูง | เว้นข้อความ consent ทั้งบล็อกไว้ว่าง พร้อมหมายเหตุ **"รอ D0-5 (ข้อความ+เวอร์ชัน), D0-6 (ผลการถอน), D0-7 (consent type)"** ห้าม A2-5 ใส่ข้อความ draft ลงคู่มือ (ข้อห้ามเดียวกับ `execution-plan…:80`) |

### กลุ่ม M — เมนู เส้นทาง และภาพหน้าจอที่ไม่ตรงกับ `frontend/src`

| # | คู่มือ | ส่วน | ปัญหา | หลักฐาน | ระดับผลกระทบ | ต้องแก้อะไรก่อน A2-5 |
|---|---|---|---|---|---|---|
| M1 | คนขับ | "เมนู / หน้าจอ (อ้างอิงด่วน)" — ตารางแถบล่าง 4 แท็บ | คู่มือระบุแท็บล่างเป็น **หน้าแรก / คำขอ / ฉุกเฉิน / โปรไฟล์** แต่โค้ดไม่มีแท็บ "คำขอ" ในทั้งสองสถานะของ flag: ปุ่มกลางเป็น **"ขึ้นทะเบียน"** (`/driver/applications`) เมื่อ flag ปิด และ **"รายชื่อเด็ก"** (`/driver/vehicle-registration`) เมื่อ flag เปิด | `docs/user-guide-driver.md:124-131` เทียบ `frontend/src/components/MobileBottomNav.jsx:10-20` | สูง — แถบล่างคือพื้นผิวหลักของคนขับ | เขียนตารางแท็บใหม่ให้มีทั้งสองสถานะของ flag พร้อมภาพประกอบทั้งสองแบบ |
| M2 | คนขับ | งานที่ 8 "ส่งคำขอเปลี่ยนรายชื่อ" | คู่มือสอนเมนู "คำขอรายชื่อ" เป็นงานประจำ แต่เมนูนี้ **ถูกซ่อนอัตโนมัติ** เมื่อ `driverRegistration` เปิด | `docs/user-guide-driver.md:236-259` เทียบ `frontend/src/components/Sidebar.jsx:188` | สูง | ระบุเงื่อนไขการหายของเมนูให้ชัดในหัวข้อเดียวกัน |
| M3 | คนขับ | ตารางเมนู Sidebar | ตาราง Sidebar ในคู่มือมี 6 รายการ ไม่มี **"รายชื่อเด็กในรถ"** และ **"สถานะส่งตรวจรถ"** ซึ่งอยู่ใน `DRIVER_NAV` และไม่ได้อธิบายกลุ่มหัวข้อใหม่ (ภาพรวม / งานดำเนินการ / ข้อมูลหลัก) | `docs/user-guide-driver.md:134-142` (หัวข้อ `:134`, แถวตาราง `:137-142`) เทียบ `frontend/src/components/Sidebar.jsx:25-37` | กลาง | ทำ menu inventory จาก `Sidebar.jsx` ใหม่ทั้ง 6 บทบาท (ใช้ baseline จาก A0-10) แล้วสร้างตารางเมนูจาก inventory นั้น |
| M4 | ขนส่ง | "ภาพรวม 30 วินาที" | ระบุ "บทบาทนี้**ไม่มี**แถบเมนูล่างบนมือถือ" — RC มีแถบล่าง 4 แท็บ (หน้าแรก / ตรวจเอกสาร / ตรวจรถ / แผนที่) เพิ่มเมื่อ 2026-09-03 | `docs/user-guide-transport.md:16` เทียบ `frontend/src/pages/transport/TransportLayout.jsx:6-16` (commit `689050a`) | สูง | แก้ข้อความและถ่ายภาพแถบล่างของบทบาทขนส่งเพิ่ม |
| M5 | ทุกเล่มที่มีหัวข้อเข้าสู่ระบบ (**7 เล่ม** — 6 บทบาทที่ล็อกอินด้วย username + สารบัญหลัก; ผู้ปกครองใช้ LINE ไม่มีหัวข้อนี้) | "ลืมรหัสผ่าน" | คู่มือทุกเล่มระบุว่า **"ระบบไม่มีปุ่มลืมรหัสผ่าน"** แต่หน้า login ปัจจุบันมีปุ่มพับ **"ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้"** ที่กางออกเป็นช่องทางขอความช่วยเหลือ และมีปุ่ม "ผู้ดูแลระบบ: รีเซ็ตผ่าน LINE" เมื่อ `adminPasswordRecovery` เปิด | `user-guide-admin.md:72,487` · `user-guide-affiliation.md:64,386` · `user-guide-driver.md:62,406` · `user-guide-province.md:73,443` · `user-guide-school.md:504-506` · `user-guide-transport.md:64,328` · `user-manual.md:70` (ครบทั้ง 7 จาก `grep -rn "ลืมรหัสผ่าน" docs/user-guide-*.md docs/user-manual.md`) เทียบ `frontend/src/pages/Login.jsx:275-303` (ปุ่มพับ `:284`, ลิงก์ "ผู้ดูแลระบบ: รีเซ็ตผ่าน LINE" `:296-300` เพิ่มที่ commit `01da4cb`) และ `frontend/src/pages/ForgotPassword.jsx:17-19` | สูง | แก้ข้อความทุกเล่ม + ถ่ายภาพหน้า login ใหม่; ข้อความช่องทางช่วยเหลือจริงและ SLA **รอ D0-8 + C0-13** (A2-6); ขอบเขตบทบาทที่เปิด recovery ได้ **รอ C0-5** (ทุกบทบาทนอกจาก admin ยัง `decision_gates_unconfirmed` — `backend/src/config/accountRecoveryPolicy.js:158`, `backend/.env.example:97`) |
| M6 | ผู้ดูแลระบบ | หัวข้อ "สารบัญงาน" ท้ายตาราง | ระบุ "ทุกหน้าใต้ส่วน admin บังคับสิทธิ์ผู้ดูแลระบบ — บทบาทอื่นเข้าไม่ได้" ซึ่งไม่จริง: 3 เส้นทางเปิดให้บทบาทอื่นด้วย | `docs/user-guide-admin.md:38` เทียบ `frontend/src/App.jsx:373` (`admin`,`province`), `:378` (`admin`,`transport`), `:433` (`admin`,`province`) | สูง | แก้ข้อความ และให้ตรงกับ RBAC matrix ที่ A0-10 จะ dump ลง `outputs/rbac-matrix/<run>/` |
| M7 | ผู้ดูแลระบบ | ทั้งเล่ม | เมนู **"ภาคเรียนปัจจุบัน"** (`/admin/term-settings`) มีอยู่ใน Sidebar และมี route จริง แต่ไม่มีคู่มือเล่มใดกล่าวถึง และไม่มี screenshot | `frontend/src/components/Sidebar.jsx:140` · `frontend/src/App.jsx:427` · `grep "ภาคเรียนปัจจุบัน\|term-settings" docs/user-guide-*.md docs/user-manual.md docs/manual-training-2026-08/*.md` = ไม่พบ · ไม่มีไฟล์ใน `docs/manual-html/screenshots/admin/` | กลาง | เพิ่มหัวข้อ + ภาพ หรือย้ายเมนูตาม IA ที่อนุมัติ — ตำแหน่งเมนู **รอ C0-3** |
| M8 | สังกัด/เขต (Markdown) | ทั้งเล่ม | เมนู **"คำขอโอนย้ายนักเรียน"** และ **"คำขอเกี่ยวกับรถ"** อยู่ใน `AFFILIATION_NAV` จริง แต่ `.md` ไม่มีหัวข้อ (มีเฉพาะใน `.html` เป็นงานที่ 13B/13C) และ **ไม่มี screenshot ทั้งสองหน้า** | `frontend/src/components/Sidebar.jsx:64-65` · `frontend/src/App.jsx:273-274` · สารบัญ `docs/user-guide-affiliation.md:20-38` · `docs/manual-html/screenshots/affiliation/` มีเพียง 01–10 | สูง | รวมร่าง (P1) + ถ่ายภาพ 2 หน้า; ผู้อนุมัติและจำนวนชั้นอนุมัติ **รอ C0-2** |
| M9 | ขนส่ง | งานที่ 7 "ดูรายการรถทั้งหมด" | ภาพประกอบใช้ `transport/01-dashboard.png` ซึ่งเป็นภาพหน้าภาพรวม ไม่ใช่หน้า `/transport/vehicles` ที่หัวข้อนี้อธิบาย (caption ยอมรับเองว่า "อยู่บนหน้าภาพรวมตรวจสภาพรถ") | `docs/user-guide-transport.md:222,242` · `docs/manual-html/screenshots/transport/` มีเพียง 01–04 | กลาง | ถ่ายภาพ `/transport/vehicles` จริง; ส่วนที่หน้านี้ไม่มีลิงก์ในเมนู ให้ตัดสินพร้อม IA — **รอ C0-3** |
| M10 | คนขับ | ภาพประกอบงานที่ 3, 4, 5, 6, 7 | ใช้ภาพเดียวกัน (`driver/01c-checkin-top.png`) ซ้ำ **5 หัวข้อ** ที่สอนคนละงาน (หน้าแรก / ดูรายชื่อ / เช็กชื่อ / บันทึกลา / ส่งตำแหน่งรถ) | `docs/user-guide-driver.md:114,160,187,208,230` | ต่ำ | ถ่ายภาพแยกต่อหัวข้อในรอบ A2-5 |
| M11 | ทุกเล่ม | ภาพหน้าเข้าสู่ระบบ | `shared/00-login-desktop.png` และ `00-login-mobile.png` ถ่ายเมื่อ 2026-08-27 ก่อนที่หน้า login จะถูกออกแบบใหม่เมื่อ 2026-09-03 (เปลี่ยน brand asset เป็น `.webp`, เปลี่ยนความโค้งกรอบ, เพิ่มบล็อกช่วยเหลือ/ปุ่มแสดงรหัสผ่าน) | `git log -1 -- docs/manual-html/screenshots` = `94fb529` (2026-08-27) · `git show 689050a -- frontend/src/pages/Login.jsx` (132 บรรทัดเปลี่ยน, 2026-09-03) | กลาง | ถ่ายใหม่ทั้งสองภาพ (ใช้กับ 6 เล่ม) |
| M12 | ทั้งชุด | รายงานแท็บ "เชิงนโยบาย" | คู่มือ 2 เล่มอธิบายแท็บ "เชิงนโยบาย" (`/reports/policy`) แต่ไม่มี screenshot ของแท็บนี้เลย | `docs/user-guide-province.md:346,350,433` · `docs/user-guide-admin.md:359,363` · `frontend/src/App.jsx:312` · ไม่มีไฟล์ชื่อ `polic*` ใน `docs/manual-html/screenshots/` | กลาง | ถ่ายภาพแท็บเชิงนโยบายเพิ่ม |

### กลุ่ม X — ข้อความในคู่มือที่เอกสาร closure ขัดแย้ง

| # | คู่มือ | ส่วน | ปัญหา | หลักฐาน | ระดับผลกระทบ | ต้องแก้อะไรก่อน A2-5 |
|---|---|---|---|---|---|---|
| X1 | สารบัญหลัก (HTML), คนขับ (HTML), โรงเรียน (HTML), ขนส่ง (HTML) | สถานะ `FEATURE_DRIVER_REGISTRATION` | คู่มือ HTML ระบุ "เปิด" ขณะที่ `MVP-CUT-2026-08.md` จัด flag เดียวกันไว้ฝั่ง **CUT (ปิด flag ไว้)** — เอกสารสองฉบับในโครงการเดียวกันขัดกันโดยตรง และทั้งคู่ออกก่อนที่ C0-4 จะตัดสิน | `docs/manual-html/index.html:361-362` · `user-guide-driver.html:588` · `user-guide-school.html:482` · `user-guide-transport.html:407` (ทั้งหมดจาก commit `65b5866`, 2026-08-28) · `docs/MVP-CUT-2026-08.md:42` · `execution-plan-to-completion-2026-09-04.md:59` | สูง | ต้องได้ C0-4 ก่อน แล้วปรับ **ทั้งสองเอกสาร** ให้ตรงกัน; ระหว่างนี้เขียน "รอ C0-4" ในคู่มือ |
| X2 | โรงเรียน (HTML) | "ภาพรวม 30 วินาที" — กล่อง "ข้อยกเว้นที่ต้องทราบ (ตรวจพบ 27 ส.ค. 2569)" | คู่มือ HTML เตือนว่าหน้ารายงาน "แสดงและส่งออกข้อมูลนักเรียน**ทั้งโรงเรียน** ไม่ได้จำกัดเฉพาะระดับชั้น" และแนะให้ระวังการมอบบัญชีครูสายชั้น — แต่ RC แก้แล้ว: `buildScopeFilter` อ่าน `user.gradeScope` และเติม `AND s.grade IN (...)` | `docs/manual-html/user-guide-school.html:119` (กล่องเดียวกัน, จาก `65b5866`) เทียบ `backend/src/services/report.service.js:38-42` (commit `516da32`, 2026-08-28, อยู่หลัง `65b5866` 4 commits — `git rev-list --count 65b5866..516da32` = 4) | สูง — เอกสารที่แจกอยู่ขัดกับโค้ดของ RC โดยตรง (ผลต่อพฤติกรรมผู้ใช้จริงประเมินจากรีโปไม่ได้) | ลบ/แทนกล่องนี้หลังยืนยันผลทดสอบขอบเขต grade บน RC; ฉบับ `.md` (`docs/user-guide-school.md:458`) เขียนถูกอยู่แล้ว |
| X3 | สารบัญหลัก | ท้ายเอกสาร "เอกสารที่เกี่ยวข้อง" | ชี้ผู้ใช้ไป `production-readiness.md` ในฐานะ "สถานะความพร้อม" ขณะที่ชุดเอกสารปิดโครงการระบุว่า evidence pack ทุกชนิด ลายเซ็นทุกใบ UAT staging และ load test **ยังไม่มี** | `docs/user-manual.md:122` เทียบ `execution-plan-to-completion-2026-09-04.md:20` | กลาง | เปลี่ยนลิงก์ให้ชี้เอกสารสถานะฉบับเดียวที่ A0-8 จะสร้าง (`docs/project-closure/current-status-<rc>.md`) |
| X4 | สารบัญหลัก | ท้ายเอกสาร "เอกสารที่เกี่ยวข้อง" | ลิงก์ `ops-backup-restore.md` ชี้ไปไฟล์ขนาด 33 ไบต์ที่มีเพียงชื่อไฟล์อื่น (`PRODUCTION-RECOVERY-2026-06-23.md`) ไม่ใช่ขั้นตอน backup/restore | `docs/user-manual.md:123` · `cat docs/ops-backup-restore.md` | ต่ำ | ชี้ไปเอกสาร DR ฉบับจริง หรือถอดลิงก์ออกจากคู่มือผู้ใช้ |
| X5 | `user-guide-transport-province-affiliation.md` (นอกชุด 8 เล่ม) | §2.1 ตาราง "เห็น / ไม่เห็น" ของขนส่ง | ระบุว่าขนส่ง "❌ จำนวนนักเรียน" (อยู่ฝั่ง "ไม่เห็น") ขณะที่คู่มือขนส่งฉบับปัจจุบันระบุว่าขนส่งเห็น "ตัวเลขจำนวนผู้โดยสารแบบรวม" และเห็นจำนวนผู้โดยสารเช้า/เย็น **แยกโรงเรียน** | `docs/user-guide-transport-province-affiliation.md:45` เทียบ `docs/user-guide-transport.md:17` (แบบรวม) และ `:300`, `:337` (เช้า/เย็นแยกโรงเรียน) | ต่ำ (ติดป้าย SUPERSEDED แล้วที่บรรทัด 3) | ยืนยันสถานะ historical ตามแนวทาง A0-8 หรือย้ายออกจาก `docs/` เพื่อไม่ให้ผู้ใช้เปิดเจอ |

### กลุ่ม R — ข้อความรับรองความพร้อมที่คู่มือไม่มีสิทธิ์กล่าว

| # | คู่มือ | ส่วน | ปัญหา | หลักฐาน | ระดับผลกระทบ | ต้องแก้อะไรก่อน A2-5 |
|---|---|---|---|---|---|---|
| R1 | สารบัญหลัก | ท้าย §3 | ข้อความ "ฟีเจอร์ที่ **พร้อมใช้งานจริง** ได้แก่ การเช็กชื่อขึ้น-ลงรถ, ตรวจสภาพรถ/ใบรับรอง, จัดการนักเรียน/รถ, รายงานและการส่งออก, แดชบอร์ดทุกระดับ, การผูกบัญชี/แจ้งเตือนผู้ปกครองผ่าน LINE, แผนที่จุดรับ-ส่ง และตำแหน่งรถแบบ live" เป็นการรับรองความพร้อมของ 8 โมดูล ทั้งที่ยังไม่มี UAT ของบทบาทใดเลย | `docs/user-manual.md:96` (และข้อความเดียวกันใน `index.html`) เทียบ `execution-plan-to-completion-2026-09-04.md:20` (ยังไม่มีบัญชี UAT/evidence pack/ลายเซ็น) และ `:234` (บทบาทที่ยังไม่ผ่าน UAT ไม่อยู่ใน accepted scope) | สูง | ตัดคำรับรองออก แทนด้วยรายการ **accepted scope** ที่ผ่าน UAT จริง — ซึ่ง **รอ C0-4** (ขอบเขต) และรอผล Phase 8 |
| R2 | ขนส่ง | "ฟีเจอร์ที่อาจยังไม่เปิดใช้งาน" | "ฟีเจอร์หลักของบทบาทขนส่ง … **เปิดใช้งานจริงทั้งหมด**" — คำรับรองความพร้อมระดับบทบาท | `docs/user-guide-transport.md:281` | สูง | เปลี่ยนเป็นคำบรรยายว่าเมนูใดมีอยู่ ไม่ใช่คำรับรองว่าพร้อม |
| R3 | ทุกเล่ม | บรรทัดหัวเอกสาร | **7 เล่ม** ติดป้าย "เวอร์ชัน Phase 10.13C • อัปเดต 2026-06-24" และเล่มที่ 8 (`user-guide-province.md:3`) ติดป้าย "Phase 10.13C • อัปเดต 2026-08-14" — ทั้ง 8 เล่มจึงอ้างรุ่นที่ไม่ตรงกับ RC ปัจจุบัน และ **ไม่มีเล่มใดอ้าง commit ของ RC** | `user-guide-admin.md:3` · `user-guide-affiliation.md:3` · `user-guide-driver.md:3` · `user-guide-parent.md:3` · `user-guide-school.md:4` · `user-guide-transport.md:4` · `user-manual.md:4,128` (7 เล่มแรก) + `user-guide-province.md:3` (วันต่าง) — จาก `grep -rn "เวอร์ชัน Phase" docs/user-guide-*.md docs/user-manual.md` | กลาง | ทุกเล่มต้องมี header ที่ระบุ **commit ของ RC + วันสร้าง** ให้ตรงกับ evidence bundle (หลักการ RC เดียว, `execution-plan…:26`) |
| R4 | สารบัญหลัก | ท้ายเอกสาร | "คู่มือชุดนี้จัดทำโดยอ้างอิงจากโค้ดจริงของระบบ (source of truth) — อัปเดต 2026-06-24" — ข้อความรับรองความถูกต้องที่ผลตรวจนี้แสดงว่าไม่เป็นจริงแล้วหลายจุด | `docs/user-manual.md:128` | กลาง | ถอดคำรับรอง หรือแทนด้วยวิธีตรวจสอบซ้ำได้ (commit + วันที่ + คำสั่งที่ใช้ generate) |
| R5 | ผู้ดูแลระบบ | งานที่ 9 | ระบุ "โหมดนโยบาย (policy_mode) ปัจจุบันเป็น **OBSERVE**" — ค่านี้ตรงกับ default ในโค้ด แต่คู่มือกล่าวเป็นข้อเท็จจริงของ production ซึ่งตรวจจากเครื่องนี้ไม่ได้ | `docs/user-guide-admin.md:268` เทียบ `backend/src/config/env.js:33` (default `observe`) และ `backend/.env.example:49` | ต่ำ | เขียนเป็น "ค่าเริ่มต้นของระบบคือ OBSERVE — ค่าที่ใช้จริงดูได้จากหลักฐาน operator gate" และผูกกับ `outputs/operator-gates/<run>/` (B0-1) |

### กลุ่ม P — โครงสร้างการผลิตคู่มือ (ต้องแก้ก่อน A2-5 จึงจะ regenerate ได้อย่างมีความหมาย)

| # | รายการ | ปัญหา | หลักฐาน | ระดับผลกระทบ | ต้องแก้อะไรก่อน A2-5 |
|---|---|---|---|---|---|
| P1 | ไม่มี source of truth เดียว | `.md` และ `.html` ของเล่มเดียวกันมีเนื้อหาต่างกัน และไม่มีสคริปต์แปลง md → html ในรีโป มีเพียง `scripts/build-manual-pdf.sh` ที่แปลง html → pdf การแก้เมื่อ 2026-08-28 จึงลงเฉพาะ `.html` และ `.md` ตกค้าง | `ls scripts/` (ไม่มีตัวแปลง md→html) · `scripts/build-manual-pdf.sh:56-61` · ต่างของหัวข้อ: driver `.html` มีงานที่ 14–15 / school `.html` มี "ตรวจลงทะเบียนรถ" / affiliation `.html` มีงานที่ 13B–13C ซึ่ง `.md` ทั้งสามเล่มไม่มี | สูง — regenerate โดยไม่แก้ข้อนี้จะทำให้ความต่างค้างต่อไปอีกรอบ | เลือก source เดียว (แนะนำ `.md`) แล้วเพิ่มตัวแปลงเข้า pipeline; หรือประกาศ `.html` เป็น source แล้วลบ/ติดป้าย `.md` |
| P2 | `build-manual-pdf.sh` ผูกกับ path บนเซิร์ฟเวอร์ | สคริปต์ hardcode `MANUAL="/home/schoolbus/apps/lampang-bus-system/docs/manual-html"` และหา chromium จาก `~/.cache/ms-playwright` — รันบน sandbox/เครื่องอื่นไม่ได้โดยไม่แก้ ขัดกับ exit evidence ของ A2-5 ที่ระบุว่าต้อง "regenerate … จาก RC2 **บน sandbox**" | `scripts/build-manual-pdf.sh:23,25` · `execution-plan-to-completion-2026-09-04.md:158` | สูง | ทำ path เป็น parameter/relative และตรวจ prerequisite ก่อน A2-5 |
| P3 | สคริปต์ไม่ครอบคลุมสองเล่ม | `build-manual-pdf.sh` render เฉพาะ 7 role + index ไม่มีขั้นตอนสำหรับชุดอบรม และไม่ตรวจว่า `.md` ตรงกับ `.html` ก่อน render | `scripts/build-manual-pdf.sh:56-61` · `scripts/build-training-manual-pdfs.py` เป็นสคริปต์แยก | กลาง | รวมเป็น pipeline เดียวที่ล้มเหลวเมื่อ source ไม่ตรง |
| P4 | ชุดอบรมแยกวงจร | `docs/user-manual.md:14` ชี้ผู้อบรมไปที่ `manual-training-2026-08/` (อัปเดต 26 ส.ค. 2569) ซึ่ง regenerate ด้วยสคริปต์คนละตัวและไม่ได้อยู่ในเกณฑ์ "manual audit ไม่มีป้ายล้าสมัย" ของ A2-5 | `docs/manual-training-2026-08/README.md:5` · `execution-plan-to-completion-2026-09-04.md:158` | กลาง | ตัดสินว่าชุดอบรมอยู่ในขอบเขต A2-5/A2-6 หรือไม่ แล้วผูกเข้ากับ RC เดียวกัน |

---

## 6. วันที่สร้างล่าสุดของ PDF

อ่านจาก `/CreationDate` และ `/ModDate` ในตัวไฟล์ PDF เอง (ไม่ใช่ mtime ของระบบไฟล์):

| ไฟล์ | CreationDate = ModDate | ขนาด |
|---|---|---|
| `คู่มือ-คนขับ.pdf` | `D:20260818090632+00'00'` | 1,846,673 B |
| `คู่มือ-โรงเรียน.pdf` | `D:20260818090634+00'00'` | 8,041,636 B |
| `คู่มือ-ขนส่ง.pdf` | `D:20260818090641+00'00'` | 1,963,444 B |
| `คู่มือ-สังกัดเขต.pdf` | `D:20260818090643+00'00'` | 4,354,612 B |
| `คู่มือ-จังหวัด.pdf` | `D:20260818090647+00'00'` | 5,119,624 B |
| `คู่มือ-ผู้ดูแลระบบ.pdf` | `D:20260818090652+00'00'` | 6,438,250 B |
| `คู่มือ-ผู้ปกครอง.pdf` | `D:20260818090657+00'00'` | 647,127 B |
| `คู่มือ-สารบัญหลัก.pdf` | `D:20260818090659+00'00'` | 247,935 B |

**สรุป: PDF ทั้ง 8 ไฟล์สร้างในรอบเดียวกันเมื่อ 18 สิงหาคม 2569 เวลา 09:06 UTC** — ตรงกับ commit `097b0ea` (18 ส.ค. 2569 09:08 UTC) ซึ่ง **re-render ทั้ง 8 ไฟล์** ไม่ใช่ commit ที่เพิ่มเข้ารีโป (`git show --stat 097b0ea` แสดงทั้ง 8 ไฟล์เป็น modify: `Bin 1848534 -> 1846673` ฯลฯ) ไฟล์ชุดนี้ถูกเพิ่มเข้ารีโปครั้งแรกที่ `f38f4cd` (25 มิ.ย. 2569 — `git log --diff-filter=A`)

ผลที่ตามมา:

1. **PDF เก่ากว่า HTML ที่เป็นต้นทางของตัวเอง** — `index.html`, `user-guide-driver.html`, `user-guide-school.html`, `user-guide-transport.html` ถูกแก้เมื่อ 2026-08-28 (commit `65b5866`) หลังจาก PDF ถูก render ไปแล้ว 10 วัน ดังนั้น PDF ทั้ง 4 เล่มนั้น **ไม่มีเนื้อหาที่แก้ในรอบนั้นเลย** (ตาราง flag, งานที่ 14–15 ของคนขับ, "ตรวจลงทะเบียนรถ" ของโรงเรียน)
2. **PDF เก่ากว่าชุด screenshot** — screenshot ทั้งชุดถ่ายใหม่เมื่อ 2026-08-27 (commit `94fb529`) หลัง PDF ถูก render ไปแล้ว
3. ไฟล์ `admin.pdf`, `driver.pdf`, `school.pdf`, `transport.pdf`, `province.pdf`, `affiliation.pdf`, `parent.pdf` เป็น **symlink** ขนาด 38–56 ไบต์ ที่ชี้ไปไฟล์ชื่อไทย (เช่น `admin.pdf` → `คู่มือ-ผู้ดูแลระบบ.pdf`) ตามที่ `scripts/build-manual-pdf.sh:53-55` อธิบายไว้ — ไม่ใช่ PDF แยก
4. `docs/manual-html/pdf` เป็น symlink ไป `../manual-pdf`

---

## 7. `docs/manual-html/screenshots` ตรงกับเมนูปัจจุบันหรือไม่

**คำตอบ: ไม่ตรง** — พบช่องว่างที่ระบุได้ชัด 4 กลุ่ม (§7.1–§7.4)

> ขอบเขตของคำตอบนี้: สิ่งที่ตรวจได้จริงคือ **การนับชื่อไฟล์/การอ้างอิงภาพ** และ **การเทียบวันที่ไฟล์กับวันที่โค้ด** เท่านั้น เอกสารนี้ **ไม่ได้** เปิดแอปเทียบภาพต่อภาพ จึงบอกไม่ได้ว่าภาพที่เหลือ "ยังตรงกับ UI อยู่กี่ภาพ" — ระบุได้เฉพาะภาพที่ **ขาด** และภาพที่ **ถ่ายก่อน** การเปลี่ยนโค้ด (ดู §8)

### 7.1 ตัวเลขที่นับได้

| รายการ | จำนวน | หลักฐาน |
|---|---|---|
| ไฟล์ `.png` ทั้งหมด | 83 | นับจาก `docs/manual-html/screenshots/` |
| รายการที่บันทึกไว้ใน `_captured.txt` | 64 | `wc -l docs/manual-html/screenshots/_captured.txt` |
| ภาพที่ `.html` อ้างถึง | 83 (ครบทุกไฟล์ ไม่มี broken link) | ตรวจ regex `screenshots/…\.png` ทุกไฟล์ HTML |
| ภาพที่ `.md` อ้างถึง | 80 | เช่นเดียวกันกับไฟล์ `.md` |
| ภาพที่ `.html` อ้างแต่ `.md` ไม่อ้าง | 3 — `driver/15-roster.png`, `driver/15b-roster-form.png`, `school/18-registration-review.png` | ทั้งสามเป็นภาพของฟีเจอร์ driver-registration ที่เพิ่มเฉพาะฝั่ง HTML เมื่อ 2026-08-28 |

`_captured.txt` จึง **ตามหลังไดเรกทอรีจริงอยู่ 19 ไฟล์** — ใช้เป็นรายการอ้างอิงความครบถ้วนไม่ได้ ต้อง regenerate พร้อมภาพในรอบ A2-5

### 7.2 วันเวลาของชุดภาพเทียบกับโค้ดเมนู

| รายการ | วันที่ | หลักฐาน |
|---|---|---|
| ถ่าย screenshot ทั้งชุดครั้งล่าสุด | 2026-08-27 | `git log -1 -- docs/manual-html/screenshots` = `94fb529` "docs(manual): re-shoot every screenshot against the current UI" |
| `MobileBottomNav.jsx` แก้ล่าสุด | 2026-08-26 | `git log -1` |
| `Sidebar.jsx` แก้ล่าสุด | 2026-09-03 | `git log -1` = `689050a` |
| `Login.jsx` แก้ล่าสุด | 2026-09-03 | `01da4cb` "feat: add admin password recovery via LINE" (`git log -1 -- frontend/src/pages/Login.jsx`) — ตามหลัง `689050a` 3 commits และเป็น commit ที่เพิ่มลิงก์ "ผู้ดูแลระบบ: รีเซ็ตผ่าน LINE" (`Login.jsx:296-300`) ที่ M5 อ้าง; `689050a` เป็นรอบออกแบบหน้า login ใหม่ (132 บรรทัด) |
| `TransportLayout.jsx` เพิ่มแถบล่าง | 2026-09-03 | `689050a` |

ดังนั้นชุดภาพ **ถ่ายก่อน** การเปลี่ยน UI รอบ 2026-09-03 ซึ่งกระทบหน้า login (ทุกเล่ม) และแถบล่างของบทบาทขนส่ง

### 7.3 ปลายทางเมนูปัจจุบันที่ไม่มีภาพ

เทียบรายการ `to:` ทุกตัวใน `frontend/src/components/Sidebar.jsx:25-141` กับไฟล์ภาพที่มีอยู่ และเพิ่ม 3 ปลายทางที่ **ไม่ใช่** `to:` ในช่วงนั้นแต่คู่มืออ้างถึง (`/transport/vehicles`, `/reports/policy`, `/admin/vehicle-qr` — ระบุที่มาไว้ในคอลัมน์หลักฐาน):

| ปลายทาง | ป้ายเมนู | หลักฐานเมนู | สถานะภาพ |
|---|---|---|---|
| `/admin/term-settings` | ภาคเรียนปัจจุบัน | `Sidebar.jsx:140` | **ไม่มีภาพ และไม่มีหัวข้อในคู่มือ** |
| `/affiliation/transfer-requests` | คำขอโอนย้ายนักเรียน | `Sidebar.jsx:64` | **ไม่มีภาพ** |
| `/affiliation/vehicle-requests` | คำขอเกี่ยวกับรถ | `Sidebar.jsx:65` | **ไม่มีภาพ** |
| `/driver/applications` | สถานะส่งตรวจรถ | `Sidebar.jsx:33` + แท็บล่างเมื่อ flag ปิด (`MobileBottomNav.jsx:16`) | **ไม่มีภาพ** |
| `/transport/vehicles` | (ไม่อยู่ในเมนู แต่คู่มือสอนเป็นงานที่ 7) | `App.jsx:325` | ใช้ภาพหน้าอื่นแทน (M9) |
| `/reports/policy` | แท็บ "เชิงนโยบาย" | `App.jsx:312` | **ไม่มีภาพ** |
| `/admin/geofences`, `/admin/route-deviations`, `/driver/shift` | จุดเตือนภัย, การเบี่ยงเส้นทาง, เลือกรถและเริ่มรอบ | อยู่ในเมนู (`Sidebar.jsx:127`, `:128`, `:29`) แต่ถูกกรองออกเมื่อ flag ปิด — map `FLAG_GATED` (`Sidebar.jsx:167-178`) + ตัวกรอง (`:179-184`) | ไม่มีภาพ — คู่มือระบุเหตุผลไว้แล้ว ถือว่าสอดคล้อง |
| `/admin/vehicle-qr` | — (**ไม่มีรายการเมนูเลย**) | ไม่ปรากฏใน `Sidebar.jsx` ทั้งไฟล์ (`grep -n "vehicle-qr" frontend/src/components/Sidebar.jsx` = ไม่พบ) และไม่อยู่ใน `FLAG_GATED` ด้วย — มีเฉพาะ route ที่ `frontend/src/App.jsx:377-381` (`allowedRoles={['admin','transport']}`, **ไม่มี** flag guard ฝั่ง frontend) ส่วน router ฝั่ง backend mount ตาม flag (`app.js:203`) | ไม่มีภาพ — แต่เหตุผลไม่ใช่ "เมนูถูกซ่อน": ไม่เคยมีเมนูให้ซ่อน ผู้ที่เข้าด้วยลิงก์ตรงจะเปิดหน้าได้ แล้วหน้าจะเรียก `/qr/vehicle/...` (`AdminVehicleQr.jsx:37,49,60`) ซึ่งตอบ 404 ตอน flag ปิด — **ยืนยันด้วยการรันจริงบน sandbox 4 ก.ย. 2569**: `curl http://localhost:3000/api/qr/vehicles` → HTTP 404 `{"success":false,"message":"Route not found"}` · คู่มือขนส่ง HTML อ้างถึงหน้านี้ที่ `user-guide-transport.html:406` |

### 7.4 โครงกลุ่มเมนูที่ภาพและคู่มือยังไม่สะท้อน

Sidebar ปัจจุบันจัดเมนูเป็นกลุ่มพับได้ 6 กลุ่ม — `ภาพรวม` / `งานดำเนินการ` / `ข้อมูลหลัก` / `ตรวจสอบและสนับสนุน` / `รายงานและวิจัย` / `ตั้งค่าระบบ` (`Sidebar.jsx:20-23, 25-141`) และเปิดโหมดพับเฉพาะ admin กับบัญชีหลักโรงเรียน (`Sidebar.jsx:197-202`) ไม่มีคู่มือเล่มใดอธิบายโครงกลุ่มนี้หรือพฤติกรรมการพับ — ผู้ใช้ที่อ่านตารางเมนูแบบเรียงเดี่ยวในคู่มือจะหาเมนูไม่เจอบนจอจริง

---

## 8. สิ่งที่ตรวจไม่ได้จากเครื่องนี้

| รายการ | เหตุผล | ใครตรวจได้ |
|---|---|---|
| ค่า flag ที่ตั้งจริงบน production | ไม่มีสิทธิ์เข้า production ตามข้อจำกัดของงานนี้ — เอกสารนี้อ่านได้เฉพาะ `env.js` (ค่า default) และ `.env.example` | Operator ผ่าน B0-1 → `outputs/operator-gates/<run>/feature-flags.redacted.log` (A0-11) |
| คำกล่าวอ้างในคู่มือ HTML ว่า `FEATURE_DRIVER_REGISTRATION` เปิดบน production | เป็นการสังเกตเมื่อ 27–28 ส.ค. 2569 ที่บันทึกไว้ใน commit message ไม่มีหลักฐานในรีโปให้ตรวจซ้ำ | เช่นเดียวกับข้างบน |
| ภาพหน้าจอตรงกับ UI ที่ render จริงหรือไม่ | ตรวจได้เฉพาะวันที่ไฟล์เทียบวันที่โค้ด ไม่ได้เปิดแอปเทียบภาพต่อภาพ | A2-5 บน sandbox (`scripts/ui-redesign/manual-screenshots.mjs`) |
| เนื้อหาภายใน PDF ตรงกับ HTML ต้นทางหรือไม่ | อ่านได้เฉพาะ metadata วันที่สร้าง ไม่ได้ extract ข้อความจากทั้ง 8 ไฟล์มาเทียบ | A2-5 หลัง regenerate |
| ผลกระทบจริงของ grade-scope ต่อรายงาน (X2) แบบ end-to-end | อ่านโค้ดพบว่าแก้แล้ว (`report.service.js:38-42`) และ **รัน unit test แล้วผ่าน 14/14** (`backend/tests/reportGradeScope.unit.test.js` — รันบน sandbox 4 ก.ย. 2569) แต่ test ชุดนี้ยิงกับ pool จำลองและตรวจ SQL ที่ service ปล่อยออกมา **ไม่ใช่** การเรียก API จริงบน DB จริง จึงยังไม่ยืนยันผลลัพธ์ที่ผู้ใช้เห็น | Suite เต็มบน MySQL จริง + UAT บทบาทโรงเรียน (`sandbox-verification-2026-09-04.md:§3.1`) |
| ภาพหน้าจอที่เหลือ "ยังตรงกับ UI อยู่กี่ภาพ" | นับได้เฉพาะภาพที่ขาดและภาพที่ถ่ายก่อนโค้ดเปลี่ยน — ไม่ได้เปิดแอปเทียบภาพต่อภาพ จึงไม่มีตัวเลขสัดส่วนความตรง | A2-5 บน sandbox |

---

## 9. รายการที่ค่าขึ้นกับ decision ที่ยังไม่มี

ทุกช่องด้านล่างต้องเว้นว่างในคู่มือรอบ A2-5 จนกว่าจะมีคำตอบ **ห้ามเติมค่าแทน**

| ช่องในคู่มือ | รอ decision | อ้างถึง |
|---|---|---|
| สถานะ accept / pilot / defer ของทั้ง 10 flag (ตาราง §3 ของสารบัญหลัก และกล่องสถานะทุกเล่ม) | **รอ C0-4** | F1, F2, F3, F4, F5, F6, F7 |
| ใครเป็นผู้เช็กเด็ก / นิยาม check-in, absent, leave, override, void ในคู่มือคนขับและโรงเรียน | **รอ C0-1** | คู่มือคนขับงานที่ 5–6, คู่มือโรงเรียนงานที่ 13 |
| ผู้อนุมัติ transfer / vehicle request / roster-registration / inspection (ระดับเดียว ไม่ซ้ำ queue) | **รอ C0-2** | M8, คู่มือ admin งานที่ 4–5, คู่มือสังกัด 13B/13C |
| ตำแหน่งเมนูและโครงกลุ่มที่จะเขียนลงตาราง "เมนู/หน้าจอ" ทุกเล่ม | **รอ C0-3** | M3, M7, M9, §7.4 |
| บทบาทที่เปิด self-service recovery ได้ + ข้อความหน้า login | **รอ C0-5** | M5 |
| ข้อความ privacy notice ในคู่มือ (ผู้ควบคุม/ผู้ประมวลผล) | **รอ D0-1** | A2-6 |
| ฐานทางกฎหมายของการแสดงรายชื่อบุตรหลานก่อน consent gate | **รอ D0-3** | F8 |
| การจำแนก Consent / Acknowledgement / Certification ในคู่มือผู้ปกครองและโรงเรียน | **รอ D0-4** | F9 |
| ข้อความความยินยอมฉบับย่อ/เต็ม + เวอร์ชัน | **รอ D0-5** | F9 |
| ผลเมื่อถอนความยินยอม (คู่มือผู้ปกครองงานที่ 7) | **รอ D0-6** | F9 |
| ชนิด consent ที่ถูกต้อง (`parent_tracking_optin` vs `qr_parent_optin`) | **รอ D0-7** | F9 |
| ช่องทางและ SLA ของ data-subject request / support / incident | **รอ D0-8** | M5, A2-6 |
| severity scheme ที่ใช้จัดลำดับผลตรวจนี้ และช่องทางแจ้งปัญหาในคู่มือ | **รอ C0-13** | §4, M5 |

---

## 10. เงื่อนไขที่ต้องปิดก่อน A2-5 จะ regenerate ได้อย่างมีความหมาย

exit evidence ของ A2-5 คือ "`scripts/build-manual-pdf.sh` ผ่าน; manual audit ไม่มีป้ายล้าสมัย" (`execution-plan-to-completion-2026-09-04.md:158`) เงื่อนไขที่ตรวจพบว่ายังไม่ปิด:

> ⚠️ ลำดับของรายการด้านล่างมาจากคอลัมน์ "ระดับผลกระทบ" ใน §5 ซึ่งเป็น **การจัดลำดับของผู้ตรวจเพื่อเรียงคิวงานเท่านั้น ไม่ใช่ severity ที่โครงการอนุมัติ** (ดู §4) — **รอ C0-13** แล้วจึงจัดลำดับใหม่ ห้ามใช้ลำดับนี้เป็นเกณฑ์ตัดสินว่าอะไรบล็อก release

- [ ] **P1** — เลือกและบังคับใช้ source of truth เดียวระหว่าง `.md` กับ `.html` (ถ้าไม่ทำ ความต่างจะค้างอีกรอบ)
- [ ] **P2** — `build-manual-pdf.sh` รันบน sandbox ได้ (ตอนนี้ hardcode path ของ production host)
- [ ] **C0-4** — มีคำตอบ accept/pilot/defer ของทั้ง 10 flag แล้วจึงเขียนตารางสถานะได้
- [ ] **C0-3** (+ A2-1) — เมนูตาม IA ที่อนุมัติเสร็จก่อน จึงจะถ่ายภาพและเขียนตารางเมนูที่ไม่ต้องแก้ซ้ำ
- [ ] **A0-10** — มี menu baseline/inventory เพื่อใช้เป็นรายการตั้งต้นของตารางเมนูทุกเล่ม
- [ ] **A0-11 / B0-1** — มีหลักฐาน flag whitelist จาก operator เพื่อแทนการอ้าง "สังเกตเมื่อ 27 ส.ค."
- [ ] ถ่าย screenshot ใหม่อย่างน้อย: หน้า login (desktop + mobile), แถบล่างคนขับทั้งสองสถานะ flag, แถบล่างขนส่ง, `/affiliation/transfer-requests`, `/affiliation/vehicle-requests`, `/driver/applications`, `/transport/vehicles`, `/admin/term-settings`, แท็บรายงาน "เชิงนโยบาย"
- [ ] regenerate `_captured.txt` ให้ตรงกับไฟล์จริง (ตอนนี้ตามหลัง 19 ไฟล์)
- [ ] ถอดคำรับรองความพร้อมทั้งหมดในกลุ่ม R ออกก่อน render
- [ ] ปิดข้อขัดแย้ง X1 (คู่มือ vs `MVP-CUT-2026-08.md`) และ X2 (คำเตือนที่โค้ดแก้แล้ว)
- [ ] ตรึงตัวระบุ RC เดียว (ดู §1) แล้วใส่ commit นั้นในหัวคู่มือทุกเล่ม

หัวข้อ 6 อย่างของ A2-6 (troubleshooting, support channel, account recovery, privacy/data-subject request, feedback, incident channel — `execution-plan-to-completion-2026-09-04.md:159`) ยังไม่มีในคู่มือเล่มใดครบชุด และผูกกับ **D0-1 + D0-8 + C0-13** จึงยังเริ่มเขียนเนื้อหาไม่ได้

---

*จัดทำเป็นงาน A0-7 เมื่อ 4 กันยายน 2569 บน `feat/tracking-security-hardening` @ `4b80b4b` — audit อย่างเดียว ไม่มีการแก้ไขคู่มือหรือสร้างไฟล์ใดนอกจากเอกสารฉบับนี้*
