# UAT Sign-off 2026-08 — School Safe Connect ลำปาง

ใช้เอกสารนี้สำหรับทดสอบก่อน deploy/เปิดใช้งานจริงรอบ 2026-08

ข้อกำหนด:

- ห้ามใช้ production สำหรับ test case ที่เขียนข้อมูล
- test case ที่เขียนข้อมูลต้องทำใน sandbox/UAT DB เท่านั้น
- test case ที่อ่าน production ต้องดูเฉพาะข้อมูลที่ผู้ทดสอบมีสิทธิ์ตามบทบาท
- ทุก FAIL ต้องมี evidence และเจ้าของแก้ไข

สร้างชุดหลักฐาน UAT แยกตามบทบาทก่อนเริ่มทดสอบ:

```bash
node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com
```

กรอกผลและลิงก์หลักฐานจาก `outputs/uat-evidence/<timestamp>/` กลับมาที่เอกสารนี้ก่อนรัน validator

ตรวจชุดหลักฐาน UAT ก่อนย้ายผลเข้า sign-off:

```bash
node scripts/scan-uat-evidence-safety.js outputs/uat-evidence/<timestamp>
node scripts/summarize-uat-evidence.js outputs/uat-evidence/<timestamp>
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>
```

ใช้ `outputs/uat-safety/<timestamp>/summary.md` เพื่อตรวจว่าไม่มี secret/CID/phone/LINE user id ในหลักฐานข้อความ และใช้ `outputs/uat-status/<timestamp>/summary.md`, `role-status.csv`, และ `missing-items.csv` เพื่อติดตามว่าบทบาทใดยังกรอกหลักฐานไม่ครบก่อนส่งลงนาม

## 1. Common Checks

| ID | รายการ | วิธีทดสอบ | ผล | Evidence |
|---|---|---|---|---|
| C1 | Login ถูกต้อง | login ด้วยบัญชีบทบาทนั้น | | |
| C2 | Wrong password | ใส่รหัสผิด ต้องไม่เข้าได้ | | |
| C3 | Logout | กดออกจากระบบแล้วกลับ login | | |
| C4 | Dashboard load | หน้าแรกโหลดภายใน 5 วินาที | | |
| C5 | Hidden permission | เปิด URL บทบาทอื่น ต้องโดน 403/redirect | | |
| C6 | PDPA sweep | ไม่เห็น CID เต็ม/secret/token | | |
| C7 | Mobile 390px | ไม่มี layout แตกหรือปุ่มกดยาก | | |

## 2. Role Checks

| Role | Must Pass | ผล | Evidence |
|---|---|---|---|
| Admin | system health, users, audit log, readiness | | |
| Province | dashboard, reports policy, live vehicles/read-only drill-down | | |
| Affiliation | dashboard เฉพาะสังกัด, reports เฉพาะ scope | | |
| School full | dashboard, students, vehicles, import preview, reports, audit | | |
| School teacher | เห็นเฉพาะ grade scope, ไม่มีปุ่ม write action สำคัญ | | |
| Driver | roster, check-in, check-out, emergency ใน sandbox | | |
| Transport | inspection, verification, pickup map ไม่มี PII นักเรียน | | |
| Parent/LINE | bind account, view status, unbind/rebind ด้วย test account | | |

## 3. Report/Export Checks

| ID | รายการ | Expected | ผล | Evidence |
|---|---|---|---|---|
| R1 | Daily report JSON | ตัวเลขตรง `daily_status` ของวันที่ทดสอบ | | |
| R2 | Monthly report JSON | KPI คิดจากวันที่มีข้อมูลในเดือน | | |
| R3 | Summary report | จำกัด scope ตาม role | | |
| R4 | Policy report | province/admin เท่านั้น | | |
| R5 | Daily CSV/Excel/PDF | ดาวน์โหลดได้, audit log `EXPORT` | | |
| R6 | Monthly CSV/Excel/PDF | ดาวน์โหลดได้, เป็น aggregate ไม่ใช่รายชื่อนักเรียน | | |
| R7 | Formula injection | ค่าที่ขึ้นต้น `= + - @ tab CR` ไม่กลายเป็นสูตรใน export | | |

## 4. LINE Checks

| ID | รายการ | Expected | ผล | Evidence |
|---|---|---|---|---|
| L1 | Webhook | LINE Console verify success | | |
| L2 | LIFF parent | `/parent` และ `/parent/link` โหลดได้ | | |
| L3 | Bind success | test parent ผูกกับ test student ได้ | | |
| L4 | Parent access guard | parent เห็นเฉพาะบุตรหลานของตนเอง | | |
| L5 | Notification policy | ตรงกับนโยบายที่จังหวัดเลือก: MVP แนะนำ emergency/exception push | | |

## 5. Ops Checks

| ID | รายการ | Expected | ผล | Evidence |
|---|---|---|---|---|
| O1 | Health | `/health` success true และ DB connected | | |
| O2 | PM2 | backend online, restart count ไม่เพิ่มระหว่าง UAT | | |
| O3 | Local backup | latest backup < 24h, gzip/sha256 OK | | |
| O4 | Off-host backup | checker ผ่าน หรือ log sync ล่าสุดมีไฟล์บน remote | | |
| O5 | Restore drill | restore ล่าสุดลง test DB และ production counts ไม่เปลี่ยน | | |
| O6 | Audit review | export/action สำคัญมี audit row | | |
| O7 | Production gate runner | `public`, `production` และหลัง deploy `postdeploy` ต้อง `fail=0`; off-host log ต้องมีชื่อ backup ล่าสุด | | |
| O8 | Evidence pack | แนบ `summary.md`, `manifest.json`, gate logs และ validator PASS | | |

## 6. Sign-off

| ผู้รับผิดชอบ | บทบาท | ผลรวม | วันที่ | ลายเซ็น |
|---|---|---|---|---|
| | Project owner | PASS / PASS WITH CONDITIONS / FAIL | | |
| | Technical owner | PASS / PASS WITH CONDITIONS / FAIL | | |
| | Operator | PASS / PASS WITH CONDITIONS / FAIL | | |
| | Province representative | PASS / PASS WITH CONDITIONS / FAIL | | |
| | School representative | PASS / PASS WITH CONDITIONS / FAIL | | |
| | Driver representative | PASS / PASS WITH CONDITIONS / FAIL | | |
| | Parent representative | PASS / PASS WITH CONDITIONS / FAIL | | |

## 7. Known Conditions Before Full Green

- Vehicle verification/capacity data ต้องถูกเจ้าของข้อมูลแก้
- LINE adoption ต้องมี campaign ผูกบัญชี
- Restore drill ต้องผ่านอย่างน้อย 1 รอบหลังสร้าง test DB
- DPO/กฎหมายต้อง sign-off ก่อนเปิด consent gate/QR level สูง
- Phase 9 gate runner ต้องผ่านก่อนและหลัง deploy ตาม `docs/PHASE9_PRODUCTION_GATE_2026-08.md`
- Owner/operator approval ต้องครบตาม `docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md`
- ก่อนประกาศ 100% ให้รัน `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>` และต้อง PASS
- ก่อนประกาศ 100% ให้รัน `node scripts/summarize-uat-evidence.js outputs/uat-evidence/<timestamp>` และสถานะต้องเป็น PASS
- ก่อนประกาศ 100% ให้รัน `node scripts/scan-uat-evidence-safety.js outputs/uat-evidence/<timestamp>` และต้องไม่มี FAIL/WARN ที่ยังไม่ถูก redacted หรืออนุมัติโดย UAT lead/DPO
- ก่อนประกาศ 100% ให้รัน `node scripts/validate-go-live-signoff.js` และต้อง PASS
- ก่อนประกาศ 100% ให้รัน `node scripts/verify-100-readiness.js` และต้อง PASS
