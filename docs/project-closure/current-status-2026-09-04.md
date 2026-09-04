# สถานะปัจจุบันฉบับอ้างอิงเดียว (Current Status) — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกสถานะของ source/commit/หลักฐานที่อ่านได้จาก repository บนเครื่องพัฒนา ณ 4 กันยายน 2569 เพื่อใช้แทน snapshot เก่าทุกฉบับที่ขัดกัน** (task `A0-8`, master plan Phase 1 บรรทัดแรก)

เอกสารนี้ **ไม่ใช่** สิ่งต่อไปนี้ และห้ามอ้างแทน:

- **ไม่ใช่** การอนุมัติ deploy, ไม่ใช่ใบรับรองความพร้อม และไม่ใช่ sign-off ใด ๆ
- **ไม่ใช่** หลักฐานการทดสอบ — ไม่มีการรัน test suite, build, gate หรือ validator ใหม่ระหว่างจัดทำเอกสารนี้ ตัวเลขทุกตัวยกมาจากไฟล์/รายงานที่มีอยู่แล้วพร้อมระบุที่มา
- **ไม่ใช่** การยืนยันสถานะ runtime ของ production — ไม่มีการ SSH, ไม่มีการเรียก production, ไม่มีการเขียนฐานข้อมูล และไม่มีการแตะ feature flag ระหว่างจัดทำเอกสารนี้ (การยิง HTTP ครั้งเดียวที่ทำคือ GET ไปที่ sandbox บน `127.0.0.1` ของเครื่องพัฒนา ดู §1 และ §2.5 ข้อ 2)
- **ไม่ใช่** การตัดสินใจแทน owner/DPO — ทุกช่องที่ขึ้นกับ decision ที่ยังไม่มีคำตอบ เขียนว่า `รอ <decision id>` และเว้นว่างไว้ (ดู §7)

---

## 1. ขอบเขตการตรวจของเอกสารนี้

| รายการ | ค่า |
|---|---|
| เครื่องที่ตรวจ | เครื่องพัฒนา Windows, worktree `D:\Projects\lampang-bus-work` (git dir จริงคือ `D:/Projects/lampang-bus-system/.git/worktrees/lampang-bus-work`) |
| Branch | `feat/tracking-security-hardening` |
| HEAD ขณะจัดทำ | `4b80b4b` — `docs(closure): correct dependencies and evidence gates` (4 ก.ย. 2569 20:23 +07:00) |
| Worktree | ไฟล์ที่ถูก track สะอาด (`git status --porcelain -uno` ไม่คืนอะไรเลย) แต่ `git status -sb` **ไม่สะอาด** — ยังมี untracked หลายรายการ รวมถึงไฟล์นี้เอง (`docs/project-closure/current-status-2026-09-04.md`) และไฟล์ของงานเลน A อื่นที่ทำคู่ขนาน; `ahead 4` / `behind 0` เทียบ `origin/feat/tracking-security-hardening` |
| Restore point | annotated tag `restore-point/pre-wave0-20260904-210041` ชี้ที่ `4b80b4b` (ข้อความ: *Restore point before Wave 0 lane A work*) |
| เครื่องมือที่ใช้ | `git` (อ่านอย่างเดียว) และการอ่านไฟล์ใน repository · ในรอบแก้ไขตามผลตรวจทาน (4 ก.ย. 2569 เย็น) เพิ่ม `curl` แบบ GET ไปที่ **sandbox backend บนเครื่องนี้เท่านั้น** (`http://127.0.0.1:3000`) เพื่อแทนที่ข้ออนุมานด้วยสิ่งที่สังเกตได้จริง (§2.5 ข้อ 2) — ไม่มีการเรียก production |
| สิ่งที่ไม่ได้ทำ | ไม่ deploy, ไม่ migrate, ไม่ commit/amend/push, ไม่รัน generator ที่เขียนลง `outputs/` และไม่แก้ไฟล์อื่นนอกจากไฟล์นี้ |

ข้อมูล remote ทั้งหมดในเอกสารนี้อ่านจาก **remote-tracking ref ที่ค้างอยู่บนเครื่องนี้** ไม่ได้ query GitHub สด — `.git/FETCH_HEAD` ถูกเขียนล่าสุด 4 ก.ย. 2569 11:13 และ ref ใต้ `refs/remotes/origin/feat/` ถูกเขียนล่าสุด 4 ก.ย. 2569 13:29 (เวลาเครื่อง) หากมีใคร push หลังจากนั้น เอกสารนี้จะไม่เห็น

---

## 2. สาม commit ที่เกี่ยวข้อง

### 2.1 ตารางสรุป

| บทบาท | Commit | วันที่ (+07:00) | Subject | ที่มาของค่า |
|---|---|---|---|---|
| Production (ตามเอกสาร) | `0060c3e` | 3 ก.ย. 2569 17:31 | `docs: add phased password recovery roadmap` | `docs/project-closure/notes.md:7`, `master-project-closure-plan.md:34`, `execution-plan-to-completion-2026-09-04.md:14`, `sandbox-verification-2026-09-04.md:78` — **ยืนยันจากเครื่องนี้ไม่ได้ ดู §2.5** |
| Release candidate (RC) | `cef4bd1` | 4 ก.ย. 2569 14:40 | `fix(readiness): make evidence tooling report what actually happened` | `execution-plan-to-completion-2026-09-04.md:13` |
| HEAD ปัจจุบัน | `4b80b4b` | 4 ก.ย. 2569 20:23 | `docs(closure): correct dependencies and evidence gates` | `git log -1` บนเครื่องนี้ |

ระยะห่าง: `0060c3e..cef4bd1` = **15 commits**, `cef4bd1..4b80b4b` = **3 commits**, `0060c3e..4b80b4b` = **18 commits**

### 2.2 ช่วง `0060c3e..cef4bd1` — 15 commits (สิ่งที่ RC เพิ่มจาก production)

รวม `git diff --stat 0060c3e cef4bd1` = **74 ไฟล์, +7,194 / −193 บรรทัด** แยกตามโฟลเดอร์บนสุด: `backend` 47 ไฟล์, `frontend` 14, `docs` 9, `scripts` 4

| Commit | Subject | ผลต่อระบบ (จากรายชื่อไฟล์ใน commit) |
|---|---|---|
| `1a6d142` | `docs: add complete project closure master plan` | เอกสารล้วน (3 ไฟล์) |
| `0950f35` | `docs: expand account recovery plan to all roles` | เอกสารล้วน (4 ไฟล์) |
| `16d4cc4` | `docs: add PDPA consent and data confirmation plan` | เอกสารล้วน (3 ไฟล์) |
| `e6dd6be` | `docs: audit role menus and participatory research coverage` | เอกสารล้วน (1 ไฟล์) |
| `6594ccc` | `docs: expand full project execution plan` | เอกสารล้วน (2 ไฟล์) |
| `713c0af` | `fix(research): derive evidence readiness instead of asserting it` | **code** 15 ไฟล์ — `backend/src/config/researchMetrics.js`, `researchProtocol.js`, `services/researchReadiness.service.js`, `utils/decisionLog.js`, 4 test suites, และ 4 หน้า frontend (`EvaluationDashboard`, `ExecutiveSummary`, `ExecutivePrint`, `ResearchExport`) |
| `b35bbf1` | `feat(security): audit RBAC and server-side scope from the live router graph` | **code** 8 ไฟล์ รวม `backend/tests/rbacMatrix.unit.test.js`, `appRateLimitOrder.unit.test.js` |
| `897ed39` | `fix(time): derive every calendar date in Bangkok time, not UTC` | **code** 21 ไฟล์ — เพิ่ม `backend/src/utils/thaiTime.js` + `frontend/src/utils/thaiTime.js`, `backend/tests/dateHandlingGuard.unit.test.js`, แก้ 5 route/6 service และหน้า transport/admin/qr |
| `93f6289` | `feat(recovery): gate every role behind a recorded decision, not just a flag` | **code** 5 ไฟล์ — `backend/src/config/accountRecoveryPolicy.js`, `routes/adminPasswordRecovery.routes.js`, `backend/.env.example`, unit test, และ decision package |
| `1cccee8` | `feat(participation): add case + append-only event log for closed feedback loops` | **code + schema** 12 ไฟล์ — `backend/migrations/050_participation_cases.sql` + rollback, `routes/participation.routes.js`, `services/participation.service.js`, `src/app.js`, `src/config/env.js`, `backend/.env.example`, `scripts/generate-rbac-matrix.js`, `scripts/audit-scope-enforcement.js`, 3 test suites |
| `2e9362c` | `test(participation): verify migration 050 and the full suite against real MySQL` | 3 ไฟล์ — `services/participation.service.js`, `backend/tests/schema.sql`, `docs/project-closure/sandbox-verification-2026-09-04.md` |
| `dbc19a5` | `fix(privacy): close the parent consent gate on the child list and at boot` | **code** 5 ไฟล์ — `src/config/env.js`, `routes/parent.routes.js`, `services/parentConsentGate.js`, unit test, `frontend/src/pages/parent/ParentStatus.jsx` |
| `7c1eb63` | `feat(capacity): add the load-test suite the 1,000-user claim was missing` | **code** 2 ไฟล์ — `backend/scripts/load-test.js`, `backend/tests/loadTest.unit.test.js` |
| `307c28e` | `fix(deps): clear every npm audit finding, including a mysql2 credential leak` | **dependency + tooling** 4 ไฟล์ (`git show --name-only 307c28e`) — `backend/package-lock.json` (`mysql2` 3.20.0 → 3.24.3), `backend/package.json` (เพิ่ม override `"qs": "^6.16.0"` ที่ `:48`), `frontend/package-lock.json` และ `scripts/collect-automated-readiness-evidence.js` |
| `cef4bd1` | `fix(readiness): make evidence tooling report what actually happened` | **tooling** 3 ไฟล์ (`git show --name-only cef4bd1`) — `scripts/create-go-live-bundle.js`, `scripts/production-readiness-gate.sh`, `scripts/summarize-go-live-closure.js` |

สรุปช่วงนี้: 5 commit แรกเป็นเอกสารล้วน อีก 10 commit เปลี่ยน backend/frontend/schema/tooling จริง — **ข้อความ "ต่างจาก source ปัจจุบันเฉพาะเอกสาร" ที่ `docs/role-menu-participatory-research-audit-2026-09-04.md:30` จึงใช้ไม่ได้แล้ว** (ดู §5 รายการที่ 10)

### 2.3 ช่วง `cef4bd1..4b80b4b` — 3 commits (สิ่งที่ HEAD เพิ่มจาก RC)

รวม `git diff --stat cef4bd1 4b80b4b` = **15 ไฟล์, +2,570 / −207 บรรทัด**

| Commit | Subject | ผลต่อระบบ |
|---|---|---|
| `f20fd35` | `docs: add week-by-week execution plan from RC cef4bd1 to project closure` | เอกสาร 2 ไฟล์ — สร้าง `execution-plan-to-completion-2026-09-04.md` **195 บรรทัด** ที่ commit นี้ (`git show f20fd35 --stat` = +195) และแก้ `master-project-closure-plan.md` 2 บรรทัด · ความยาว 525 บรรทัดที่เห็นตอนนี้เป็นค่าที่ HEAD หลัง `4b80b4b` แก้ไฟล์เดียวกันอีก (+516/−95) |
| `53641e6` | `fix(readiness): prevent audit warnings from reporting pass` | **tooling + tests** — เพิ่ม `scripts/lib/closure-report-schema.js` (386 บรรทัด) และ test 3 ชุด: `closureReportSchema.unit.test.js`, `goLiveEvidenceRows.unit.test.js`, `readinessGateNpmAudit.unit.test.js`; แก้ validator/gate 7 ไฟล์ |
| `4b80b4b` | `docs(closure): correct dependencies and evidence gates` | เอกสาร + `.gitattributes` (26 บรรทัด, บังคับ `eol=lf` ให้ `*.sh`/`*.json`/`*.md` และ script JS) |

ช่วงนี้ **ไม่มีการเปลี่ยน backend/frontend runtime และไม่มี migration ใหม่** — ที่เปลี่ยนคือ evidence tooling, test ของ tooling และเอกสาร

### 2.4 ผลกระทบต่อกติกา "RC เดียวตลอดทาง"

`execution-plan-to-completion-2026-09-04.md:26` (§2 ข้อ 3) กำหนดว่า evidence ทุกชิ้นต้องอ้าง commit เดียวกัน ปัจจุบันหลักฐานที่มีอยู่กระจายอยู่บน **สาม** commit ที่ต่างกัน:

| หลักฐาน | ผูกกับ commit | ระยะห่างจาก RC `cef4bd1` |
|---|---|---|
| การรัน integration suite 109 suites / 1,237 tests และ migration 050 drill (`sandbox-verification-2026-09-04.md:17,29,30`) | `1cccee8` | ก่อน RC 5 commits |
| `outputs/automated-readiness/20260904-202418/` (`summary.md` ระบุ `Git HEAD: 4b80b4b`) | `4b80b4b` | หลัง RC 3 commits |
| `outputs/go-live-closure-status/20260904-202417/summary.md` (`Current git HEAD: 4b80b4b`, `Bundle git HEAD: 4b80b4b`) | `4b80b4b` | หลัง RC 3 commits |

หลักฐานเชิงจำนวนที่ตรวจได้จาก git: จำนวนไฟล์ `backend/tests/*.test.js` ต่อ commit คือ `0060c3e` = 100, `1cccee8` = **109**, `cef4bd1` = 111, `4b80b4b` = **114** — ตัวเลข "109 suites" ในบันทึก sandbox ตรงกับ `1cccee8` พอดี และที่ HEAD มี suite file เพิ่มอีก 5 ไฟล์ที่ยังไม่เคยถูกรันในสภาพแวดล้อมนั้น **ดังนั้นห้ามยกตัวเลข 1,237 มาอ้างเป็นผลของ RC หรือของ HEAD** ต้องรันใหม่บน commit ที่จะใช้จริง (task `A0-13`)

### 2.5 ทำไมยืนยัน production commit จากเครื่องนี้ไม่ได้

`0060c3e` ในเอกสารนี้ถูกอ้างเป็น production **ตามเอกสารเท่านั้น** ไม่ได้ยืนยันจากระบบจริง เหตุผล:

1. **SSH ถูกห้าม** ตามข้อจำกัดของงานนี้ จึงเข้าไปอ่าน worktree/PM2/`/health` บนเครื่อง production ไม่ได้
2. **ไม่มีช่องทางสาธารณะที่ยืนยันได้ว่าจะคืนค่า commit — และเส้นทางจริงบน production ยังไม่ได้ทดสอบ** สิ่งที่ *สังเกตได้จริง* บนเครื่องนี้ (sandbox stack, 4 ก.ย. 2569): `GET http://127.0.0.1:3000/health` → HTTP 200 พร้อม `data.commit` = `4b80b4b`, `data.environment` = `test` (route ประกาศที่ `backend/src/app.js:90`, ส่ง `commit` ที่ `:101`) ส่วน `GET http://127.0.0.1:3000/api/health` → HTTP 404 JSON `Route not found` เพราะ **ไม่มี route `/api/health` ใน Express** สิ่งที่ *อ่านจาก source เท่านั้น ยังไม่ได้ทดสอบ runtime บน production*: บล็อก static + catch-all `app.get('*')` ที่ส่ง `index.html` mount เฉพาะเมื่อ `NODE_ENV=production` (`backend/src/app.js:238-243`) ดังนั้นบน production คำขอ `/api/health` จะได้หน้า SPA แทน 404 · สำหรับ `/health` ผ่าน nginx: `docs/deployment-hardening.md:16` ระบุว่า nginx proxy เฉพาะ `/api/ → 127.0.0.1:3000` และ `:18` ระบุว่า path นอกนั้น nginx SPA-fallback ให้ **แต่ไฟล์ config ของ nginx ไม่มีอยู่ใน repository เลย** (`find . -name "*.conf"` นอก `node_modules` = 0 ไฟล์) และ `docs/audit/AUDIT_COVERAGE.md:536` ระบุชัดว่าการตั้งค่า nginx บน production รวมถึงคำถามว่า `/health` ถูก expose หรือไม่ **อยู่นอกขอบเขตที่เคยตรวจ** ส่วน `:541` สรุปได้เพียงว่า `/health` "probably not publicly proxied" — สรุป: การจะอ่าน commit จากภายนอกได้หรือไม่ **เป็นข้ออนุมานจากเอกสาร + source ไม่ใช่ผลการทดสอบ** และไม่ควรใช้แทนการยิงจริงโดย operator
3. **ตัวตรวจของโครงการเองก็ไม่ได้ตรวจข้อนี้จากภายนอก** — `scripts/production-readiness-gate.sh` เรียก `check_health_body` (นิยามที่ `:147`, ยิง `$BASE_URL/health` ที่ `:153`) และ `check_health_commit_match` (นิยามที่ `:165`, ถูกเรียกผ่าน `check_health_commit_optional`/`check_health_commit_required` ที่ `:190`/`:200`) **เฉพาะใน `run_production_mode` (`:258-283`)** ส่วน `run_public_mode` (`:245-256`) ยิงแค่ 5 endpoint สาธารณะ ล็อกที่รันจริงยืนยันข้อนี้: `outputs/automated-readiness/20260904-202418/logs/public-gate.log` มีเพียง `public root`, `auth/me 401`, `reports 401`, `/parent`, `/parent/link`
4. หลักฐานล่าสุดที่ระบุ `0060c3e` มาจากการตรวจบนเครื่อง production เมื่อ 3–4 ก.ย. 2569 (`notes.md:7`, `sandbox-verification-2026-09-04.md:78`) ซึ่ง **เป็นการอ่านของคนอื่นในอดีต ไม่ใช่การตรวจของเอกสารฉบับนี้**

การยืนยัน commit ที่รันอยู่จริงต้องทำโดย operator ในเลน B (`execution-plan-to-completion-2026-09-04.md:111-112`, `B0-1`/`B0-2`) ด้วย `bash scripts/production-readiness-gate.sh production`

---

## 3. สถานะบน origin

`git log --oneline origin/feat/tracking-security-hardening..HEAD` คืน 4 commit และ `HEAD..origin/feat/tracking-security-hardening` คืนศูนย์ กล่าวคือ local นำหน้า remote 4 commit และไม่มี commit บน remote ที่ local ไม่มี

| Commit | อยู่บน `origin/feat/tracking-security-hardening` | หมายเหตุ |
|---|---|---|
| `0060c3e` (production ตามเอกสาร) | **อยู่** | `git branch -a --contains 0060c3e` คืน `feat/tracking-security-hardening`, `remotes/origin/feat/tracking-security-hardening`, `codex/grade-abbreviations` |
| 14 commit แรกของช่วง RC (ถึง `307c28e`) | **อยู่** | `origin/feat/tracking-security-hardening` = `307c28e`; `git rev-list --count 0060c3e..307c28e` = 14 |
| `cef4bd1` (RC) | **ไม่อยู่** | `git branch -a --contains cef4bd1` คืนเฉพาะ local `feat/tracking-security-hardening` |
| `f20fd35`, `53641e6`, `4b80b4b` | **ไม่อยู่** | — |

จุดที่ต้องแก้ในเอกสารแผน: `execution-plan-to-completion-2026-09-04.md:13` เขียนว่า RC `cef4bd1` "ยังไม่ push" ซึ่งถูกต้องสำหรับตัว `cef4bd1` เอง แต่ **14 จาก 15 commit ของช่วง RC ถูก push ไปแล้ว** งาน `A0-1` (`:93`) จึงเหลือแค่ 4 commit สุดท้าย ไม่ใช่ทั้งชุด

**ความสัมพันธ์กับ `main`:** `origin/main` อยู่ที่ `3cab155` (`Merge pull request #2 …`, 28 ส.ค. 2569) — `0060c3e` **ไม่ใช่** ancestor ของ `origin/main` (`git merge-base --is-ancestor` คืน non-zero) โดย `origin/main..0060c3e` = 16 commits และ `0060c3e..origin/main` = 1 commit นั่นคือ production รัน commit ที่อยู่บน feature branch และยังไม่ถูก merge เข้า `main` ส่วน `main` ก็มี 1 commit ที่ไม่อยู่ใน production การตัดสินใจว่าจะ merge เข้า `main` ตอนไหน/ด้วย policy ใด ขึ้นกับ change governance ที่ยังไม่มีคำตอบ — **รอ C0-13**

---

## 4. อะไร deploy แล้ว vs อะไรอยู่แต่ใน repository

หัวข้อนี้ระบุ *ความต่าง* ระหว่าง `0060c3e` (production ตามเอกสาร) กับ `4b80b4b` (HEAD) เท่านั้น ไม่ได้ยืนยันว่าเครื่อง production อยู่ในสถานะใดจริง (§2.5)

### 4.1 Migration 050 — ยังไม่ apply บน production

| รายการ | ค่า | ที่มา |
|---|---|---|
| ไฟล์อยู่ใน repository | `backend/migrations/050_participation_cases.sql` และ `backend/migrations/rollback/050_participation_cases_rollback.sql` | `git ls-tree HEAD` |
| อยู่ใน `0060c3e` หรือไม่ | **ไม่อยู่** — `git ls-tree -r 0060c3e backend/migrations` ไม่มี `050` เลย | git |
| จำนวน migration ที่มีเลขนำหน้า | `0060c3e` = **43 ไฟล์** · `cef4bd1` = 44 · `4b80b4b` = 44 | git |
| เข้ามาที่ commit ใด | `1cccee8` (`feat(participation): add case + append-only event log …`) | `git show --name-only 1cccee8` |
| สถานะการ apply บน production | **ยังไม่ apply** | `execution-plan-to-completion-2026-09-04.md:14`; `sandbox-verification-2026-09-04.md:102` ระบุ "Migration 050 บน production: ยังไม่ apply ต้องผ่านการอนุมัติ deploy ก่อน" |
| ผลการซ้อมบน sandbox | บันทึกไว้ว่า apply แล้วตาราง 56 → 58, re-apply เป็น no-op, rollback กลับเป็น 56 (`sandbox-verification-2026-09-04.md:43-53`) — **ทำบน `lampang_bus_test` ที่ commit `1cccee8` ไม่ใช่บน production และไม่ใช่ที่ RC** | เอกสารเดียวกัน `:13` (test DB guard) และ `:17` (commit ที่ clone) |
| ลักษณะของ migration | additive อย่างเดียว: สร้าง 2 ตาราง ไม่แก้ตารางเดิม ไม่มี student_id/CID/เบอร์โทร/LINE user id และไม่มี runtime path อ่านจนกว่าจะเปิด `FEATURE_PARTICIPATION_CASES` | หัวไฟล์ `backend/migrations/050_participation_cases.sql:12-23` |
| เงื่อนไขของ rollback | ปลอดภัยเฉพาะเมื่อทั้งสองตารางว่าง ถ้ามีแถวแล้วให้ปิด flag แทน ห้าม drop | `backend/migrations/rollback/050_participation_cases_rollback.sql:3-13` |

### 4.2 การเปลี่ยนแปลงอื่นที่อยู่แต่ใน repository (ไม่ได้อยู่บน production ตามเอกสาร)

| ด้าน | สิ่งที่มีใน repo แต่ไม่มีใน `0060c3e` | หลักฐาน |
|---|---|---|
| Participation workflow (backend) | router + service + migration 050 + flag `FEATURE_PARTICIPATION_CASES` | `1cccee8`; `backend/src/config/env.js:237`; `backend/.env.example:84` ตั้งค่า `false` |
| Parent consent gate | `/api/parent/children` ผ่าน `applyChildListGate` แล้ว (`backend/src/routes/parent.routes.js:109`, นิยามที่ `backend/src/services/parentConsentGate.js:103-112`) และ boot จะล้มถ้าเปิด `FEATURE_PARENT_CONSENT_REQUIRED` โดยไม่เปิด `FEATURE_VEHICLE_QR` (`backend/src/config/env.js:60-65`) | `dbc19a5` |
| Parent consent UI | `frontend/src/pages/parent/ParentStatus.jsx:7` import `ParentConsentModal` และเรียกใช้ที่ `:464` | `dbc19a5` |
| Bangkok time | `backend/src/utils/thaiTime.js`, `frontend/src/utils/thaiTime.js`, guard test `backend/tests/dateHandlingGuard.unit.test.js` | `897ed39` |
| Account recovery | `backend/src/config/accountRecoveryPolicy.js` ผูกทุกบทบาทกับ decision ที่บันทึกไว้ ไม่ใช่แค่ env flag (`envFlag` ราย role ที่ `:43,56,70,84,98,112`) | `93f6289` |
| Research readiness | `backend/src/config/researchMetrics.js`, `researchProtocol.js`, `src/utils/decisionLog.js` + 4 test suites | `713c0af` |
| Load-test suite | `backend/scripts/load-test.js`, `backend/tests/loadTest.unit.test.js` — suite เข้ามาแล้ว แต่ยังไม่มีผลรันที่ปิด capacity gate ได้ · หลังเอกสารนี้เขียน มี probe บน sandbox local ของงานเลนอื่นที่ `outputs/load-test/local-20260904-214821/probe.json` ซึ่งไฟล์เองระบุ `max_users_reached: 50`, `supports_1000_user_claim: false` (stage 50 users error_rate 0.22 เพราะชน rate limit) — **ไม่ใช่ผลบน staging/production และไม่ปิดข้อ capacity 1,000** | `7c1eb63`; `master-project-closure-plan.md:44`; ไฟล์ probe ข้างต้น |
| Dependencies | lockfile production ยังเป็น `mysql2` **3.20.0** (`git show 0060c3e:backend/package-lock.json` บรรทัด 5298-5299) ส่วน HEAD เป็น **3.24.3** (`backend/package-lock.json:5289-5290`) และ override `qs` ยังไม่มีใน `0060c3e` (`git show 0060c3e:backend/package.json` §overrides มีเฉพาะ `exceljs/uuid`) | `307c28e` |
| Evidence tooling | `scripts/lib/closure-report-schema.js` และการแก้ validator/gate ทั้งชุด | `cef4bd1`, `53641e6` |

### 4.3 สิ่งที่ไม่เปลี่ยนระหว่าง `0060c3e` กับ HEAD

- `backend/src/config/database.js:27-28` ยังเป็น `connectionLimit: 10`, `queueLimit: 0`
- `ecosystem.config.js` ไม่มี key `instances` — ยังเป็น process เดียว
- state ที่อยู่ใน memory ของ process เดียวยังอยู่ครบ: `backend/src/routes/auth.routes.js:35` (`LOGIN_FAILS`), `backend/src/routes/line.routes.js:50` (`SEEN_EVENTS` dedup ของ webhook), `backend/src/services/line.service.js:40` (`linkingState`), `backend/src/services/lineBindGuard.js:31` (`counters`), `backend/src/services/geofence.service.js:31` (`lastInside`) — ข้อนี้คือเหตุผลที่ `A1-9` ต้องทำก่อนคิดเรื่องหลาย instance
- `frontend` ยังไม่มีไฟล์ทดสอบเลย (`find frontend -name "*.test.js*"` นอก `node_modules` = 0 ไฟล์) ตรงกับ `docs/audit/SYSTEM_AUDIT_REPORT.md:3845` (AUD-045) ที่ยังใช้ได้อยู่

### 4.4 หลักฐานอัตโนมัติล่าสุดที่อ่านได้จากเครื่องนี้

ค่าเหล่านี้ยกมาจากไฟล์รายงานที่รันไว้แล้ว ไม่ได้รันใหม่ และเป็นการตรวจ **เชิงโครงสร้างของหลักฐาน** ไม่ใช่การอนุมัติ

| แหล่ง | ค่า |
|---|---|
| `outputs/automated-readiness/20260904-202418/summary.md` | Generated 2026-09-04T13:24:18Z · Git HEAD `4b80b4b` · worktree clean · `PASS: 5`, `PENDING: 9`, `FAIL: 0`, human/external actions 7 |
| `manifest.json` ของ run เดียวกัน | `totals` = `{"pass":5,"pending":9,"fail":0}` |
| `logs/local-gate.log` (สรุปในตาราง summary) | `[gate] summary pass=14 warn=0 fail=0 skip=0` |
| `logs/public-gate.log` | `[gate] summary pass=5 warn=0 fail=0 skip=0` |
| `outputs/go-live-closure-status/20260904-202417/summary.md` | Status `PENDING`, allow pending `true`, action items 20, Owner Board ค้าง: operator 9 action/43 ช่อง, uat-lead 5/60, technical-owner 3/3, report-uat-lead 1/14, line-uat-lead 1/10, project-owner 1/1 |

รายการที่รายงานเป็น `PENDING` ทั้ง 9 ข้อ **ไม่ได้มีสาเหตุเดียวกัน** — แยกได้ 3 กลุ่มตาม detail ในไฟล์ summary เดียวกัน:

| กลุ่ม | รายการ | สาเหตุตามที่รายงานเขียนไว้ |
|---|---|---|
| ก. validator ไม่มี input ให้ตรวจ (6) | `phase9-evidence-public`, `uat-evidence-structure`, `uat-evidence-safety`, `restore-drill-evidence-structure`, `operator-gate-evidence-structure`, `readiness-100-aggregate` | `missing input for scripts/validate-*.js` — ยังไม่มีโฟลเดอร์หลักฐานให้ตรวจ |
| ข. โครงสร้างผ่าน แต่แถว action ยังไม่มีหลักฐาน (2) | `go-live-bundle-structure` (`ok=20 pending=15`), `closure-status-structure` (`ok=39 pending=6`) | แถวใน `ACTION_ITEMS.json` / `owner-actions.json` ยัง `has no evidence under outputs/{phase9-evidence,restore-drill,operator-gates,uat-evidence}` (ฝั่ง bundle ยังนับ check ปลายทางที่ PENDING ด้วย) |
| ค. เอกสาร sign-off ยังไม่ถูกกรอก (1) | `go-live-signoff-structure` | `[go-live-signoff] summary ok=8 pending=119 fail=0 allow_pending=true` — **119 ช่องในเอกสาร sign-off ที่ยังว่าง** (`Common checks C1 result missing` ฯลฯ) ไม่ใช่โฟลเดอร์หาย ตรงกับ §5 #22 |

สิ่งที่ตรวจซ้ำได้จากเครื่องนี้ (4 ก.ย. 2569 หลังเวลาที่ run ถูกสร้าง): โฟลเดอร์ `outputs/phase9-evidence`, `outputs/uat-evidence`, `outputs/restore-drill`, `outputs/operator-gates` **ยังไม่มีอยู่จริง** ตรงกับข้อความในรายงาน (`no Phase 9 evidence pack found`, `no UAT evidence pack found`, `no restore drill evidence pack found`, `no operator production/postdeploy/monitor evidence pack found`) ส่วนรายชื่อโฟลเดอร์ที่ *มี* ใต้ `outputs/` เปลี่ยนได้ตลอดจากงานเลนอื่น — ขณะตรวจซ้ำมี `automated-readiness`, `go-live-bundle`, `go-live-closure-status`, `go-live-readiness`, `load-test`, `rbac-matrix`, `ui-review` (`load-test` และ `ui-review` ถูกสร้างหลัง run `20260904-202418` โดยงานเลนอื่น จึงไม่ได้อยู่ในรายงานนั้น)

---

## 5. เอกสารใน `docs/` ที่มีข้อความขัดกับหลักฐานใหม่

ตารางนี้คือ *รายการที่ควรติดป้าย* พร้อมเหตุผลและสิ่งที่มาแทน — **เอกสารฉบับนี้ไม่ได้ไปแก้ไฟล์เหล่านั้น** (งานนี้เขียนไฟล์เดียว) การเติม banner `historical` ลงในแต่ละไฟล์ยังเป็นงานค้าง ดู §8

คอลัมน์ "ประเภท" แยกสองแบบ: **historical** = เอกสาร snapshot ที่ควรติดป้ายและหยุดใช้เป็นสถานะปัจจุบัน · **ต้องแก้บรรทัด** = เอกสารที่ยังใช้งานอยู่ในเฟสปิดโครงการ แต่มีบรรทัดที่ล้าสมัยแล้ว

| # | เอกสาร (บรรทัด) | ข้อความที่ขัดกับหลักฐานใหม่ | หลักฐานที่ใหม่กว่า | ประเภท |
|---:|---|---|---|---|
| 1 | `docs/READINESS_SCORECARD_2026-08.md:18` | แถว `Overall` ระบุ `80%` | เป็นค่าของ 2026-08-25 ก่อนมี evidence tooling ชุดปัจจุบัน ตัวเลขความพร้อมต้องอ่านจาก validator ที่รันจริง (`execution-plan-to-completion-2026-09-04.md:15`) — run ล่าสุดรายงานเป็นจำนวน `PASS/PENDING/FAIL` ไม่ใช่เปอร์เซ็นต์ | historical |
| 2 | `docs/READINESS_SCORECARD_2026-08.md:52` | แถว `Backend unit tests` ระบุ `PASS: 36 suites, 374 tests` | จำนวนไฟล์ suite ที่ `0060c3e` = 100 และที่ HEAD = 114 (นับจาก `git ls-tree`) | historical |
| 3 | `docs/READINESS_SCORECARD_2026-08.md:53-54` | backend/frontend `npm audit` = `0 vulnerabilities` | `307c28e` ระบุว่า `production-readiness-gate.sh local` กำลัง fail จาก dependency audit สองชุด และเพิ่งแก้ที่ commit นั้น — ค่า 0 จึงไม่จริงสำหรับ `0060c3e` | historical |
| 4 | `docs/audit/SYSTEM_AUDIT_REPORT.md:9` (แถว "Commit ที่ตรวจ" = `9a64efc`; `:8` คือแถว Branch), `:20`, `:84`, `:126`, `:4387` | "374 tests / 36 suites" และสถานะ ณ commit `9a64efc` | `9a64efc` อยู่ก่อน `0060c3e` 16 commits และก่อน HEAD 34 commits | historical (ทั้งฉบับ) |
| 5 | `docs/audit/SYSTEM_AUDIT_REPORT.md:2898` (AUD-033) | `GET /api/parent/children` ไม่มี consent check | `dbc19a5` เพิ่ม `applyChildListGate` — `backend/src/routes/parent.routes.js:109`, `backend/src/services/parentConsentGate.js:103` | historical (เฉพาะ finding นี้) |
| 6 | `docs/audit/SYSTEM_AUDIT_REPORT.md:2981,2995,3013` (AUD-034) | `validateFeatureDependencies` บังคับแค่ `FEATURE_QR_LEVEL3` และ ParentStatus ไม่มี consent UI | `backend/src/config/env.js:60-65` บังคับ `FEATURE_PARENT_CONSENT_REQUIRED requires FEATURE_VEHICLE_QR=true` แล้ว และ `frontend/src/pages/parent/ParentStatus.jsx:7,464` มี `ParentConsentModal` แล้ว | historical (เฉพาะ finding นี้) |
| 7 | `docs/audit/SYSTEM_AUDIT_REPORT.md:2295` (AUD-025 วันที่เป็น UTC) | วันที่ปฏิทินคำนวณจาก UTC | `897ed39` เพิ่ม `backend/src/utils/thaiTime.js` + `backend/tests/dateHandlingGuard.unit.test.js` และแก้ `frontend/src/pages/transport/InspectionForm.jsx` | historical (เฉพาะ finding นี้) |
| 8 | `docs/audit/AUDIT_COVERAGE.md:3` และ `docs/audit/LOGIC_CONFIRMATION_REGISTER.md:3` | ระบุขอบเขตการตรวจที่ commit `9a64efc` (27 ส.ค. 2569) | เช่นเดียวกับ #4 | historical |
| 9 | `docs/audit/LOGIC_CONFIRMATION_REGISTER.md:559,563` | ".env.example ระบุเพียง 4 flags" และ dependency ไม่ถูกบังคับ | `backend/.env.example` ปัจจุบันมี `FEATURE_PARTICIPATION_CASES:84`, `FEATURE_ADMIN_PASSWORD_RECOVERY:89`, `FEATURE_VEHICLE_QR:113`, `FEATURE_QR_LEVEL3:117`, `FEATURE_DRIVER_SHIFT_SELECTION:125`, `FEATURE_DRIVER_REGISTRATION:136`; dependency บังคับที่ `env.js:60-65` — *หมายเหตุ: ข้อสังเกตย่อยที่ว่า `FEATURE_PARENT_CONSENT_REQUIRED` ไม่ถูกลิสต์ใน `.env.example` ยังเป็นจริง* | historical (บางส่วน) |
| 10 | `docs/role-menu-participatory-research-audit-2026-09-04.md:30` | "Production commit `0060c3e`; ต่างจาก source ปัจจุบันเฉพาะเอกสาร" | ณ HEAD ต่างกัน 18 commits ซึ่ง 10 commit ในนั้นแก้ backend/frontend/schema (§2.2, §2.3) | ต้องแก้บรรทัด |
| 11 | `docs/role-menu-participatory-research-audit-2026-09-04.md:32` | แถว `Backend unit tests` ระบุ "43 suites / 445 tests ผ่าน" | เช่นเดียวกับ #2 และ §2.4 | ต้องแก้บรรทัด |
| 12 | `docs/project-closure/notes.md:25` | "ParentStatus ยังไม่มี consent UI, `/api/parent/children` ยังไม่ใช้ consent gate และ feature dependency ยังไม่ป้องกัน…" | `dbc19a5` ปิดทั้งสามข้อใน repo แล้ว (#5, #6) — ที่ยังค้างคือข้อความ consent ที่ต้องผ่าน **รอ D0-5** และ canonical consent type **รอ D0-7** | ต้องแก้บรรทัด |
| 13 | `docs/project-closure/notes.md:10` | "Backend unit tests ล่าสุดผ่าน 43 suites / 445 tests" | §2.4 | ต้องแก้บรรทัด |
| 14 | `docs/project-closure/master-project-closure-plan.md:36,37,48` (`:35` คือแถว Runtime ไม่ใช่ตัวเลข test) | "Database migration 43 files", "Unit tests 43 suites / 445 tests", "Participatory evidence … ยังขาดการร่วมเสนอ/ปรึกษา/มติ/มอบหมาย/แจ้งผลกลับ" | migration ที่ HEAD = 44 ไฟล์; test suite = 114 ไฟล์; โครง participation case + append-only event log เข้ามาแล้วที่ `1cccee8` (ยังปิดด้วย flag และยังไม่มี frontend) | ต้องแก้บรรทัด |
| 15 | `docs/password-recovery-all-roles-roadmap.md:7` | "สถานะ production: deploy แบบ dark launch ที่ commit `01da4cb`" | `01da4cb` เป็น ancestor ของ `0060c3e` และห่าง 1 commit — production ตามเอกสารคือ `0060c3e` | ต้องแก้บรรทัด |
| 16 | `docs/password-recovery-all-roles-roadmap.md:21` | "Unit tests ผ่าน 445 รายการ, postdeploy gate 13/13 และ public gate 5/5" | §2.4; และ public gate ที่รันล่าสุดสรุป `pass=5 warn=0 fail=0` ที่ HEAD `4b80b4b` ไม่ใช่ที่ commit ของ roadmap นี้ | ต้องแก้บรรทัด |
| 17 | `docs/production-readiness.md:5` | "HEAD: `6a5fd7d`" (snapshot 2026-06-02) | `6a5fd7d` ห่างจาก `0060c3e` 240 commits | historical |
| 18 | `docs/production-readiness.md:56` | "`cdc0ec0` deployed" | `cdc0ec0` ห่างจาก `0060c3e` 250 commits | historical |
| 19 | `docs/production-readiness.md:60` | "restore-drill closed GREEN (Phase 10.10D)" | ไม่มีโฟลเดอร์ `outputs/restore-drill` บนเครื่องนี้ และรายงานล่าสุดระบุ `no restore drill evidence pack found` (`outputs/go-live-closure-status/20260904-202417/summary.md`) สอดคล้องกับ `docs/audit/SYSTEM_AUDIT_REPORT.md:3615` (AUD-042) | historical |
| 20 | `docs/go-live-handoff.md:23` | "Latest application commit serving production `cdc0ec0`" | เช่นเดียวกับ #18 (`cdc0ec0` ห่างจาก `0060c3e` 250 commits) — เอกสารนี้มี banner historical อยู่แล้วที่ `:6-9` (`:5` เป็นบรรทัดว่าง) โดยชี้ไปที่ `PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md`, `UAT_SIGNOFF_2026-08.md`, `TRAINING_PACK_2026-08.md`, `OPERATOR_RUNBOOK.md` — **ทั้งสี่ปลายทางนี้ไม่ได้ถูกจัดเป็น historical ในตารางนี้** จึงไม่มีเหตุผลจากตารางนี้ให้เปลี่ยนปลายทาง ที่ค้างจริงคือบรรทัด `:23` เอง และการที่ banner ยังไม่ชี้มาที่เอกสาร current status ฉบับนี้ | historical (เฉพาะบรรทัด `:23` + เพิ่มลิงก์ current status ใน banner) |
| 21 | `docs/phase-9-closeout.md:4` | "Final production HEAD: `b520d58`" | `b520d58` ห่างจาก `0060c3e` 289 commits | historical |
| 22 | `docs/production-launch-checklist.md:3-4` | "วันที่ UAT ผ่าน: 2026-04-05 (56/56 checks passed)" (`:3`) · "สถานะ: Go-Live Ready" (`:4`) | `docs/UAT_SIGNOFF_2026-08.md` ยังเป็นแบบฟอร์มที่ยังไม่มีผลกรอก และ validator รายงาน `pending=119` (`outputs/automated-readiness/20260904-202418/summary.md` แถว `go-live-signoff-structure`) | historical |
| 23 | `docs/production-launch-checklist.md:171` | "รายงานเชิงนโยบาย `/api/province/reports/policy` ⬜ ยังไม่ implement" | ฟังก์ชันมี handler จริงแต่อยู่คนละ mount คือ `backend/src/routes/report.routes.js:104,107` (`GET /api/reports/policy`) — ข้อความที่ว่า *path นั้น* ไม่มี ยังจริง แต่ข้อสรุปว่า *ฟังก์ชัน* ยังไม่มี ไม่จริงแล้ว ตรงกับ `notes.md:14` | historical |
| 24 | `docs/STATUS-2026-06-23.md:83` | "`GET /api/province/reports/policy` (รายงานเชิงนโยบาย) — ยังไม่ implement" | เช่นเดียวกับ #23 | historical |
| 25 | `docs/UPDATE-2026-06-22.md:443` | "`GET .../reports/policy` ยังไม่ implement (404 ทุก path)" | เช่นเดียวกับ #23 | historical |
| 26 | `docs/MVP-CUT-2026-08.md:7` | "ระบบ build ไปแล้ว ~95%" | เป็นการประเมินแบบไม่มีตัวตั้ง; เกณฑ์ความพร้อมที่ใช้ได้ต้องมาจาก validator (§4.4) ส่วนเกณฑ์เชิงวิจัย **รอ C0-11** | historical |
| 27 | `docs/MVP-CUT-2026-08.md:42` | จัด `FEATURE_DRIVER_REGISTRATION` ไว้ในกลุ่ม CUT (ปิด flag ไว้) | `notes.md:16` และ `master-project-closure-plan.md:40` บันทึกว่า production เปิด `FEATURE_DRIVER_REGISTRATION=true` — *สถานะ flag จริงบนเครื่อง production ยังยืนยันจากเครื่องนี้ไม่ได้ ต้องรอ `A0-11`/`B0-1`* | historical |
| 28 | `docs/MVP-CUT-2026-08.md:34-44` (ตาราง CUT) | ลิสต์ flag ไม่ครบชุดที่ต้องตัดสินใจ | ชุดที่ต้องตัดสินตาม `execution-plan-to-completion-2026-09-04.md:59` (C0-4) มี 10 flags รวม `PARTICIPATION_CASES` ซึ่งเพิ่งเข้ามาที่ `1cccee8` (`backend/src/config/env.js:237`) และ `ADMIN_PASSWORD_RECOVERY` (`env.js:208`) | historical |
| 29 | `docs/manual-audit/phase-10-3c-screenshot-capture-status.md:3,114` | "Status date: 2026-05-14 … Captured = 0 … `docs/manual/screenshots/` was not created" | มีไฟล์ภาพจริง 83 ไฟล์ใต้ `docs/manual-html/screenshots/` (แยกโฟลเดอร์ admin/affiliation/driver/parent/province/school/shared/transport + `_captured.txt`) ตรงกับ `notes.md:30` | historical |
| 30 | `docs/UPDATE-2026-06-24-fulltest.md:30-46` | "Capacity Analysis (500-1000 users/day) — สรุป: รับได้ แต่ต้องปรับ 3 จุด" และเสนอ PM2 cluster mode `instances: 'max'` | `master-project-closure-plan.md:44` ระบุว่า capacity 1,000 users "ยังไม่พิสูจน์" (มี suite แต่ไม่มีผลรัน); และ cluster mode จะทำให้ state ที่อยู่ใน memory ของ process เดียวแตก — ดูรายการใน §4.3 | historical |
| 31 | `docs/deploy-readiness-report.md:3-6` | banner ชี้ให้ไปดู `docs/production-readiness.md` และ `docs/STATUS-2026-06-23.md` เป็น "สถานะจริงปัจจุบัน" | ทั้งสองปลายทางเป็น historical แล้วตาม #17-#19 และ #24 | historical (banner ต้องแก้ปลายทาง) |

**ที่ตรวจแล้วและ *ไม่* จัดเป็น historical:**

- `docs/audit/SYSTEM_AUDIT_REPORT.md:3845` (AUD-045 — frontend ไม่มี test เลย) ยังเป็นจริง: ค้นหาไฟล์ `*.test.js*` ใต้ `frontend` นอก `node_modules` ได้ 0 ไฟล์
- `docs/project-closure/notes.md:22` (single instance + in-memory state) ยังเป็นจริงตาม §4.3
- `docs/project-closure/sandbox-verification-2026-09-04.md` ยังใช้ได้ **ในฐานะบันทึกของ `1cccee8`** ตามที่ตัวเอกสารระบุไว้ที่ `:17` ไม่ใช่ในฐานะผลของ RC หรือ HEAD

**นอกโฟลเดอร์ `docs/` (บันทึกไว้เพื่อไม่ให้ตกหล่น ไม่ได้อยู่ในขอบเขต A0-8):** `CLAUDE.md` §5.5 ระบุว่ารายงานเชิงนโยบาย "ยังไม่มีในระบบ (404 ทุก path)" ซึ่งเป็นข้อความชนิดเดียวกับ #23-#25 และ `CLAUDE.md` §8 (RBAC matrix) ยังไม่ครอบคลุมบทบาท/สิทธิ์ที่เพิ่มมาหลัง `0060c3e` เช่น participation case — ทั้งสองจุดควรถูก reconcile พร้อมกับ `A1-3`

---

## 6. สิ่งที่ยืนยันจากเครื่องนี้ไม่ได้ และเพราะอะไร

| # | สิ่งที่ยืนยันไม่ได้ | เหตุผล | ใครยืนยันได้ / ด้วยอะไร |
|---:|---|---|---|
| 1 | commit ที่รันอยู่จริงบน production | SSH ถูกห้าม และ `/health`, `/api/health` จากภายนอกคืนหน้า SPA (§2.5) | operator, `B0-1`/`B0-2` ด้วย `bash scripts/production-readiness-gate.sh production` แล้วเทียบ `health.data.commit` |
| 2 | สถานะ feature flag จริงบน production ทั้ง 10 ตัว | `.env` ของ production ไม่อยู่ใน repository (ยืนยันได้จาก `docs/audit/AUDIT_COVERAGE.md:538`) เอกสารที่อ้างสถานะ flag (`notes.md:16`) เป็นการอ่านของผู้อื่นเมื่อ 3 ก.ย. | operator, `A0-11` → `outputs/operator-gates/<run>/feature-flags.redacted.log` |
| 3 | migration 050 ถูก apply บน production แล้วหรือยัง | ไม่มีสิทธิ์อ่านฐานข้อมูล; ที่ตรวจได้คือ "ไฟล์ไม่อยู่ใน tree ของ `0060c3e`" ซึ่งบ่งชี้ว่ายังไม่มีทางถูก apply จาก checkout นั้น แต่ไม่เท่ากับการตรวจ schema จริง | operator, `B0-2` |
| 4 | ผล test/build/gate ที่ RC `cef4bd1` หรือที่ HEAD `4b80b4b` | ไม่ได้รันใหม่ในงานนี้; ผลที่มีผูกกับ `1cccee8` (§2.4) และเครื่องพัฒนาไม่มี MySQL ตามที่ระบุใน `sandbox-verification-2026-09-04.md:35` | `A0-13` — `bash scripts/production-readiness-gate.sh local` บน commit ที่จะใช้จริง |
| 5 | ผล load test ที่ยืนยันระดับ 200/500/1,000 users | ยังไม่มี staging และห้ามยิง write load ใส่ production (`sandbox-verification-2026-09-04.md:98`) · มี probe บน sandbox local แล้วที่ `outputs/load-test/local-20260904-214821/probe.json` แต่ไฟล์นั้นระบุเองว่า `max_users_reached: 50` และ `supports_1000_user_claim: false` | `A0-6` → `A1-8` |
| 6 | สถานะ remote ปัจจุบันบน GitHub | อ่านจาก remote-tracking ref ที่ค้างบนเครื่อง ไม่ได้ fetch สด (§1) | `git fetch` แล้วอ่านซ้ำ |
| 7 | คู่มือ PDF ฉบับที่จะใช้ปิดโครงการตรงกับ release หรือไม่ | **แก้ข้อความเดิมที่กว้างเกินจริง:** ใน `docs/manual-pdf/` มี 15 ไฟล์ `.pdf` แยกเป็นสองชนิด — 7 ไฟล์ชื่ออังกฤษ (`admin/affiliation/driver/parent/province/school/transport.pdf`) เป็น symlink (git mode `120000`) ที่ checkout Windows นี้กลายเป็นไฟล์ข้อความ 38-56 ไบต์ เปิดเป็น PDF ไม่ได้ · แต่ **8 ไฟล์ชื่อภาษาไทยเป็น blob จริง (mode `100644`) และอ่านได้จากเครื่องนี้**: `คู่มือ-โรงเรียน` 8,041,636 B, `คู่มือ-ผู้ดูแลระบบ` 6,438,250, `คู่มือ-จังหวัด` 5,119,624, `คู่มือ-สังกัดเขต` 4,354,612, `คู่มือ-ขนส่ง` 1,963,444, `คู่มือ-คนขับ` 1,846,673, `คู่มือ-ผู้ปกครอง` 647,127, `คู่มือ-สารบัญหลัก` 247,935 ทุกไฟล์ขึ้นต้นด้วย `%PDF-1.4` และมี `/CreationDate D:20260818 09:06 UTC` ทั้งชุด (commit ล่าสุดที่แตะโฟลเดอร์นี้คือ `9a64efc`, 27 ส.ค. 2569) · สิ่งที่ยัง**ยืนยันไม่ได้**จึงไม่ใช่ "อ่านไฟล์ไม่ได้" แต่คือเนื้อหาตรงกับ release ที่จะใช้ปิดโครงการหรือไม่ (ยังไม่ได้เทียบทีละหน้า) | `A0-7` — เทียบเนื้อหากับ release; และเครื่องที่ resolve symlink ได้สำหรับ 7 ไฟล์ชื่ออังกฤษ |
| 8 | ตัวเลขความพร้อมเชิงวิจัย/เชิงเปอร์เซ็นต์ใด ๆ | เกณฑ์ยังไม่ถูกกำหนด — **รอ C0-11**; และ `execution-plan-to-completion-2026-09-04.md:15` ห้าม hardcode ตัวเลขในเอกสาร | Research lead + Product owner |
| 9 | สถานะ UAT ทุกบทบาท | ไม่มีโฟลเดอร์ `outputs/uat-evidence` และ `docs/UAT_SIGNOFF_2026-08.md` ยังเป็นแบบฟอร์ม | UAT lead; ห้ามใช้ validator แทนคน (`execution-plan-to-completion-2026-09-04.md:28`) |

---

## 7. ค่าที่เอกสารนี้เว้นว่างไว้เพราะขึ้นกับ decision ที่ยังไม่มีคำตอบ

decision ทั้ง 21 ข้อ (C0-1…C0-13, D0-1…D0-8) อยู่ที่ `docs/project-closure/execution-plan-to-completion-2026-09-04.md` §4.1 และ §4.2 ห้ามเดาค่าแทน

| ค่าที่ควรอยู่ใน current status แต่ยังเติมไม่ได้ | สถานะ |
|---|---|
| ชุด feature ที่ `accept` / `pilot` / `defer` และ Core scope ที่จะรับรอง | รอ C0-4 |
| ชื่อผู้รับผิดชอบจริงของแต่ละบทบาท (Project/Product/Technical owner, Operator, Data owner, UAT lead, Research lead, DPO) | รอ C0-7 |
| วันและหน้าต่างเวลาที่จะ deploy RC และซ้อม DR | รอ C0-8 |
| นโยบาย change/freeze และผู้อนุมัติการแก้หลัง freeze (รวมถึงกติกาการ merge เข้า `main` ตาม §3) | รอ C0-13 |
| `research_period` และ `population` ที่จะใส่ใน export metadata | รอ C0-6 |
| เกณฑ์ "พร้อมประเมิน" (metric coverage, ชนิดหลักฐานภายนอก, ระยะสังเกตขั้นต่ำ) | รอ C0-11 |
| ฐานทางกฎหมายของ `/api/parent/children` และรูปแบบ gate ที่ถูกต้อง | รอ D0-3 |
| ข้อความ consent ฉบับที่อนุมัติ + เวอร์ชัน + กติกา hash ที่จะผูกกับ UI ที่มีอยู่แล้ว | รอ D0-5 |
| canonical parent consent type (`parent_tracking_optin` vs `qr_parent_optin`) — ปัจจุบันโค้ดรับทั้งสองค่าที่ `backend/src/services/parentConsentGate.js:26` ซึ่งเป็นสถานะชั่วคราว ไม่ใช่คำตอบ | รอ D0-7 |
| ระยะเก็บรักษาข้อมูลและ SLA ของสิทธิเจ้าของข้อมูล | รอ D0-8 |

---

## 8. งานที่ยังค้างของ task A0-8 เอง

`execution-plan-to-completion-2026-09-04.md:100` กำหนด exit evidence ของ `A0-8` เป็นสองส่วน: เอกสาร current status **และ** "รายการเอกสารที่ติดป้าย"

| ส่วน | สถานะ |
|---|---|
| เอกสาร current status ฉบับเดียวจาก production commit | ไฟล์นี้ |
| รายการเอกสารที่ต้องติดป้าย | §5 (31 รายการ) |
| การเติม banner `historical` ลงในไฟล์ปลายทางแต่ละไฟล์ | **ยังไม่ทำ** — งานนี้ถูกจำกัดให้เขียนไฟล์เดียว จึงยังไม่มีไฟล์ใดใน §5 ถูกแก้ |
| การ reconcile `docs/audit/SYSTEM_AUDIT_REPORT.md` ราย finding (ไม่ใช่แค่ทั้งฉบับ) | **ยังไม่ทำ** — เป็นขอบเขตของ `A1-11` (`execution-plan-to-completion-2026-09-04.md:134`) เอกสารนี้แตะเพียง 5 finding (AUD-025 `:2295`, AUD-033 `:2898`, AUD-034 `:2981`, AUD-042 `:3615`, AUD-045 `:3845`) จากทั้งฉบับ |
| Exit gate ของ Phase 1 ("source/runtime/report อ้าง commit เดียวกัน") | **ยังไม่ผ่าน** — ปัจจุบัน source อยู่ที่ `4b80b4b`, runtime ตามเอกสารอยู่ที่ `0060c3e`, และ RC ที่แผนอ้างคือ `cef4bd1` (§2.4) การทำให้ตรงกันต้องผ่าน `A0-1` + `B0-2` ซึ่งขึ้นกับ **รอ C0-8** |

---

## 9. กติกาการใช้เอกสารนี้

1. เมื่อเอกสารเก่ากับเอกสารนี้ขัดกันในเรื่อง commit, จำนวน test, สถานะ migration หรือสถานะ flag ให้ยึดเอกสารนี้ และตรวจว่าเอกสารเก่านั้นอยู่ใน §5 หรือยัง ถ้ายังไม่อยู่ให้เพิ่มพร้อมหลักฐาน
2. ทุกครั้งที่ commit ที่ deploy เปลี่ยน หรือมี evidence pack ใหม่ ต้องปรับ §2, §3, §4 และวันที่ในชื่อเอกสาร — ห้ามแก้เฉพาะบางส่วนแล้วปล่อยตารางอื่นค้าง
3. ห้ามเติมตัวเลขความพร้อมหรือสถานะการอนุมัติลงในเอกสารนี้ ค่าจากรายงานอัตโนมัติให้อ้างเป็นค่าที่ยกมาจากไฟล์พร้อม path ของ run เสมอ (§4.4)
4. ห้ามใช้เอกสารนี้เป็นเงื่อนไขผ่านของ gate ใด ๆ — gate ทุกตัวมีหลักฐานของตัวเองตาม master plan §12
