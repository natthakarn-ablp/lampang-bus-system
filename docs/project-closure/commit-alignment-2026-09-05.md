# Commit alignment — 5 กันยายน 2569 (หลังงาน handoff §2 ทั้ง 9 ข้อ)

> เขียนต่อจาก `handoff-2026-09-05.md` §3 ซึ่งระบุว่า "ห้าค่าไม่ตรงกัน" เป็นเหตุให้ Phase 1 exit gate ข้อ 1 ตก
> ทุกค่าในเอกสารนี้อ่านจากคำสั่งบนเครื่องนี้ (`git`, `node`, manifest ใต้ `outputs/`) ไม่ได้อ่านจากเอกสารอื่น
> เอกสารนี้ **ไม่ได้อ้างว่าค่าทั้งห้าตรงกันแล้ว** — §2 บอกว่าจุดไหนตรง จุดไหนไม่ตรง และเพราะอะไร

---

## 1. งาน §2 ทั้ง 9 ข้อ — commit ไหนทำอะไร และพิสูจน์อย่างไร

| # | commit | สิ่งที่แก้ | พิสูจน์ด้วย |
|---|---|---|---|
| 1 | `bc0bbd6`, `d25aa4e` | ด่าน boot `assertParticipationCasesMigrationPresent()` ใน `backend/src/index.js` ผูกกับ `FEATURE_PARTICIPATION_CASES` (ตารางถูกอ่านเฉพาะเมื่อ flag เปิด จึงไม่ใช่ด่านแบบไม่มีเงื่อนไขอย่าง 051) + หมายเหตุใน `.env.example` | บูตจริง 3 กรณีกับฐานทิ้งที่ drop 2 ตาราง: flag เปิด+ตารางหาย → FATAL exit 1 ก่อน listen · flag เปิด+ตารางครบ → ผ่าน · flag ปิด+ตารางหาย → ไม่ตรวจ บูตได้ · `tests/participationDeployGuard.unit.test.js` (migration/rollback/schema.sql/guard ต้องตรงกัน) |
| 2 | `c3989d4` | `calcDelta` คืน `null` เมื่อตัวส่วนฝั่งใดเป็น 0 (เดิมคืน 0 → baseline ไม่มีนักเรียนกลายเป็น "+85 pp") ย้ายไป `backend/src/utils/researchSnapshotFields.js` | `tests/researchSnapshotFields.unit.test.js` (26) + `tests/researchExportFormats.test.js` seed baseline `total_students = 0` แล้วยืนยันว่า JSON ได้ `null`, CSV ได้ช่องว่าง, Excel ได้ข้อความ `null` |
| 3 | `c3989d4` | CSV เพิ่ม delta section + data dictionary 2 ตาราง · Excel เพิ่ม sheet `Evidence Readiness`, `Readiness by Metric`, `Data Dictionary` และแถว `delta.*` | integration test แกะ workbook ด้วย ExcelJS: sheet ครบ, dictionary 24 metric + 8 derived rows |
| 4 | `c3989d4` | ฟิลด์ `_pct` ทั้ง 8 มี dictionary entry ใน `data_dictionary.derived_fields`; 4 ตัวที่ไม่มี metric ใน registry ติดป้าย `descriptive_statistic` พร้อม note ห้ามใช้เป็นผลวิจัย — **ไม่ได้เพิ่มเข้า registry 24 ตัว** | เทสต์ยืนยันว่า key ที่ export กับที่ประกาศตรงกันทุกตัว และ `METRICS` ยัง 24 |
| 5 | `b0cd349` | `scripts/build-manual-pdf.sh` หา path จากตำแหน่งสคริปต์ + override `MANUAL_HTML_DIR`/`MANUAL_PDF_DIR`/`CHROME` + `--dry-run` · แก้บั๊กแฝง: `set -e`+`pipefail` ทำให้เครื่องที่ไม่มี Playwright cache ตายเงียบที่บรรทัด `find` | `--dry-run` จาก repo root และจาก cwd อื่นได้ 8 renders ใต้ checkout นี้ · `tests/buildManualPdfScript.unit.test.js` รัน bash จริง 3 กรณี และเช็กว่า HTML/PDF ที่สคริปต์อ้างมีอยู่จริง |
| 6 | `e8e168f`, `8ce633c` | endpoint ใหม่ `GET /api/admin/operations/capacity-sample` (admin-only, ไม่มี PII, ราคาถูก) ให้ค่า pool utilisation/queued, `Slow_queries`, CPU/RSS/swap, คิว LINE · `load-test.js --admin-token` poll ทุก stage แล้วสรุปเป็น max/p95/delta | `tests/capacitySample.unit.test.js` (pool ปลอม), `tests/capacitySample.test.js` (401/403/200 กับ pool จริง, < 2 วิ ต่อ 5 ครั้ง), `tests/loadTestPhase9.unit.test.js` |
| 7 | `8ce633c` | profile `peak` (baseline → burst → recovery + คำตัดสิน "ฟื้นหลัง peak") และ `soak` (ปฏิเสธ < 3600 วิ) + `phase9_evidence.missing_for_phase9` ทุกรายงาน | ซ้อมจริงบน local staging: peak 5→20→5 users จับ pool อิ่มตัวได้ (utilisation 1.0, queued 1) · soak 10 วิ ถูกระบุว่าไม่ใช่ soak · รายงานที่ `outputs/load-test/local-{peak,soak}-rehearsal-20260905-*` — **ไม่ใช่ผล Phase 9** |
| 8 | `6ec88c1` | ติดป้าย historical 12 ฉบับ + แก้บรรทัด 5 ฉบับ + แก้ปลายทาง banner 2 ฉบับ (ครบ 31 รายการของ `current-status-2026-09-04.md` §5) | `tests/historicalDocsBanner.unit.test.js` (22) กันป้ายหาย; ข้อเท็จจริงในป้ายตรวจก่อนเขียน (consent flag ยังไม่อยู่ใน `.env.example`, ภาพ 83 ไฟล์, route policy มีจริง) |
| 9 | commit ที่เพิ่มเอกสารนี้ | สร้าง bundle + closure status ใหม่ที่ `6ec88c1` และบันทึกห้าค่าตามจริง (§2) | manifest ใต้ `outputs/` ที่อ้างใน §2 |

**นอกรายการแต่ทำเพิ่ม:** `backend/.env.example` (ข้อ 1), `docs/research/metric-dictionary.md` §7 (ข้อ 2–4), `backend/scripts/LOCAL_STAGING.md` §5.1 และ `docs/performance/load-test-local-2026-09-05.md` §5.1 (ข้อ 6–7)

---

## 2. ห้าค่า — ก่อน / หลัง / ตรงกับ HEAD หรือไม่

HEAD ของโค้ด (ก่อน commit เอกสารนี้) = **`6ec88c1`** · worktree สะอาดตอนสร้าง bundle

| จุด | ก่อน (handoff §3) | หลังงานนี้ | ตรงกับ `6ec88c1`? | ทำไม / ทำอะไรต่อ |
|---|---|---|---|---|
| local HEAD | `71cc3a5` | `6ec88c1` + commit เอกสารนี้ | — | commit ทั้งหมดเป็นก้อน ๆ ตาม §1 |
| origin | `71cc3a5` (ตรงกับ local) | **`0016440`** — local นำหน้า 8+ commits | ❌ | **ยังไม่ push** — การ push เป็นการส่งออกนอกเครื่อง รอคำสั่ง (`git push origin feat/tracking-security-hardening`) |
| production runtime | `208e883` — "ต่างจาก HEAD แค่เอกสาร" | `208e883` (ไม่แตะ) | ❌ | **ข้อความว่าต่างแค่เอกสารไม่จริงอีกต่อไป** — ตั้งแต่ `bc0bbd6` มีโค้ดใหม่ใน `backend/src/index.js`, `admin.routes.js`, `services/capacitySample.service.js`, `utils/researchSnapshotFields.js`, `backend/scripts/load-test.js`, `scripts/build-manual-pdf.sh` การ deploy ต้องมีใบอนุมัติแยกตามกฎโครงการ; `deploy-backend.sh` ไม่รัน migration และ **050 ยังไม่ลง production** (ด่าน boot ใหม่กันไว้ถ้ามีคนเปิด flag ก่อน) |
| go-live bundle | git_head `b0d8d2a` | `outputs/go-live-bundle/20260905-153749` git_head **`6ec88c1`** · validator PASS (pending allowed) pass=2 pending=7 fail=0 | ✅ (ต่างจาก HEAD สุดท้ายแค่ commit เอกสารนี้) | สร้างด้วย `create-go-live-bundle.js --allow-pending` แบบเดียวกับ bundle ก่อน — ไม่มี evidence dir (uat/restore/operator-gates ยังว่างจริง) |
| closure status | `20260905-070630` | `outputs/go-live-closure-status/20260905-153757` จาก bundle ข้างบน · status PENDING actions=20 pass=1 pending=9 fail=0 | ✅ | เหมือน bundle |
| readiness manifest | git_head `5a6a2d1` | **ไม่ได้สร้างใหม่** — ยัง `5a6a2d1` | ❌ | `collect-automated-readiness-evidence.js` รัน `production-readiness-gate.sh public` โดย `BASE_URL` default = `https://schoolbuslampang.com` คือยิง HTTP ไปที่ production ซึ่งอยู่ในกติกา "ห้ามแตะ production โดยไม่ถามก่อน" — เมื่ออนุญาตแล้วรัน: `node scripts/collect-automated-readiness-evidence.js --bundle outputs/go-live-bundle/20260905-153749 --closure outputs/go-live-closure-status/20260905-153757` (จะได้ `local-gate` ซึ่งรัน unit test ด้วย ใช้เวลาหลายนาทีบนเครื่องนี้) |
| menu baseline / residual-risk | pin `4b80b4b` | **ย้ายไม่ได้** — ยัง `4b80b4b` | ❌ | `git diff --stat 4b80b4b..6ec88c1 -- frontend/src backend/src` = 120+ ไฟล์ และ `Sidebar.jsx` / `App.jsx` เปลี่ยน (frontend participation `c077f03`) — `menu-baseline-2026-09-04.md` เขียนไว้เองว่าถ้าสองไฟล์นี้เปลี่ยน "ต้องรัน baseline ใหม่" และ `residual-risk-register.md` อ้างเลขบรรทัดของ `4b80b4b` การเปลี่ยนตัวเลข pin โดยไม่ตรวจใหม่จะเป็น overclaim แบบที่ handoff §4 ข้อ 1 เตือน — ต้อง re-audit (generate-rbac-matrix + อ่าน Sidebar ใหม่) ไม่ใช่แก้ตัวเลข |

**สรุปตรง ๆ:** หลังงานนี้ bundle และ closure status ตรงกับ source แล้ว (จุดที่โค้ดทำเองได้) · origin, production runtime, readiness manifest และ baseline pin **ยังไม่ตรง** และสามในสี่ต้องการการตัดสินใจหรือการอนุญาตจากคน · **Phase 1 exit gate ข้อ 1 ยังไม่ผ่าน**

---

## 3. ผลชุดทดสอบเต็มที่ `6ec88c1`

| | ค่า |
|---|---|
| suite files | **152** (144 เดิม + 8 ใหม่จากงานนี้) |
| `npm run test:ci` แบบรวดเดียว | ถูกฆ่ากลางคัน exit 127 **3 รอบติด** ที่ 6, 22 และ 10 suites (ไม่มี `FAIL`, ไม่มี `Tests:` summary) — RAM ว่างของเครื่องระหว่างนั้น 0.4–0.7 GB จาก 14 GB |
| วิธีที่ได้ผลครบ | `test:prepare` ครั้งเดียว แล้วรัน jest เป็น 4 ก้อน ๆ ละ 38 ไฟล์ **ตามลำดับ** (ไม่ขนาน ฐานเดียวกัน config เดียวกัน) retry เฉพาะก้อนที่ไม่มี `Tests:` — ก้อน 0 และ 1 ถูกฆ่าครั้งแรก ผ่านครั้งที่สอง |
| ผลรวม | **1,828 passed · 2 skipped · 0 failed** ใน 152 suites (440 + 441 + 563 + 386) |
| 2 ที่ skip | เป็น `.skip` เดิมใน `tests/operationsHealth.test.js` ไม่ใช่ของงานนี้ |
| เทสต์ใหม่ (นับจาก jest --json) | `participationDeployGuard` 11 · `researchSnapshotFields` 26 · `researchExportFormats` 10 · `buildManualPdfScript` 12 · `capacitySample.unit` 15 · `capacitySample` 8 · `loadTestPhase9` 25 · `historicalDocsBanner` 22 — รวม 129 |

log ของแต่ละก้อนอยู่ใน scratchpad ของเซสชัน ไม่ได้เก็บใน repo — ตัวเลขข้างบนคัดจากบรรทัด `Tests:` ของแต่ละก้อน

---

## 4. สิ่งที่ยังไม่ได้ทำ และต้องมีคนตัดสินหรืออนุญาต

| # | เรื่อง | ติดอะไร |
|---|---|---|
| 1 | `git push` ไป origin | เป็นการส่งออกนอกเครื่อง — รอคำสั่ง |
| 2 | deploy `6ec88c1`+ ไป production | ต้องมีใบอนุมัติแยก (`PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md` "ไม่อยู่ในขอบเขตอนุมัตินี้") และ C0-8 maintenance window ยังไม่ตอบ · ไม่มี migration ใหม่ในงานนี้ แต่ 050 ยังค้าง |
| 3 | สร้าง readiness manifest ใหม่ | ต้องยิง HTTP ไป production (§2) — รออนุญาต |
| 4 | re-audit menu baseline และ residual-risk register ที่ HEAD ใหม่ | งานตรวจ ไม่ใช่งานแก้ตัวเลข |
| 5 | frontend คำนวณ delta เองด้วยกฎ "0 เมื่อตัวส่วนเป็น 0" แบบเดียวกับที่แก้ใน backend (`ExecutiveSummary.jsx`, `ExecutivePrint.jsx`, `ResearchMetrics.jsx`) | นอกขอบเขตข้อ 2 ตามที่ระบุ และการแก้ frontend ต้องเปิดเบราว์เซอร์ตรวจ (handoff §4 ข้อ 5) — พบระหว่างทำ ยังไม่แก้ |
| 6 | รัน Phase 9 จริง: ramp 1,000 / peak / soak ≥ 60 นาที บน Linux staging พร้อม `--admin-token` | ติด B2-2 (staging จริง) · บน Windows ค่า swap/load เป็น `null` · scenario 6 ใน 9 ยังวัดไม่ได้ด้วย token เดียว (`load-test-local-2026-09-05.md` §3) |
| 7 | บันทึก `parentLimiter` 60/นาที/IP ลง residual-risk register | ยังค้างจาก `load-test-local-2026-09-05.md` §2.3 |
| 8 | render คู่มือ PDF จริงด้วยสคริปต์ที่แก้แล้ว | เครื่องนี้ไม่มี chromium ใต้ `~/.cache/ms-playwright` — ตรวจได้แค่ `--dry-run` |
| 10 | ~~`deploy-backend.sh` ใช้ `git pull \|\| true`~~ | **แก้แล้ว** หลัง `d889530` — ดู `docs/ops/deploy-2026-09-05-c0b0d49.md` §6 และ `backend/tests/deployBackendScript.unit.test.js` |
| 9 | CS5-03, CS5-05 (Phase 5) | ต้องเป็นข้อเสนอพร้อม DDL ไม่ใช่แก้เอง — ไม่ได้อยู่ใน 9 ข้อนี้ |

---

## 5. สิ่งที่แตะและไม่แตะระหว่างทำ

- **ไม่แตะ production** ทุกช่องทาง (ไม่มี ssh, migration, deploy, flag, และไม่มี HTTP ไปที่เว็บ production)
- **ไม่แตะ `lampang_bus`** — ใช้ `lampang_bus_test` (เทสต์), `lampang_bus_staging` (ซ้อม load test; สร้าง admin ชั่วคราว `__loadtest_admin` แล้วลบ), และฐานทิ้ง `lampang_bus_guardcheck` (สำเนา schema ของ test ที่ drop 2 ตาราง เพื่อพิสูจน์ด่าน boot แล้ว drop ทิ้ง)
- **ไม่เพิ่ม migration / ไม่แก้ schema**
- เขียนใต้ `outputs/` เฉพาะ `go-live-bundle`, `go-live-closure-status`, `load-test` — ไม่แตะ `uat-evidence`, `restore-drill`, `operator-gates`, `phase9-evidence`
- ไม่แตะ `UAT_SIGNOFF_2026-08.md` และ `PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md`
- ไม่ amend/rebase commit เดิม
