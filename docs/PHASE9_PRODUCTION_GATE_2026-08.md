# Phase 9 Production Gate 2026-08 — School Safe Connect ลำปาง

เอกสารนี้ใช้ปิด gate สุดท้ายก่อนประกาศระบบพร้อมใช้งานเต็มรูปแบบ

ใช้คู่กับ `docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md` เพื่อเก็บขอบเขตอนุมัติและลายเซ็น owner/operator

หลักสำคัญ:

- ห้ามเขียน production DB ระหว่าง gate check ปกติ
- production/postdeploy gate เป็น read-only ต่อ production DB
- restore drill เป็นคำสั่งแยก ต้องรันโดย operator ที่ได้รับอนุมัติ และต้อง target เฉพาะ `lampang_bus_restore_drill`
- ห้าม flip feature flag สำคัญโดยไม่มี owner approval

## 1. Local Pre-deploy Gate

รันใน worktree ที่จะส่ง deploy:

```bash
cd /home/schoolbus/apps/lampang-bus-system
bash scripts/production-readiness-gate.sh local
```

รายการที่ตรวจ:

- backend unit tests
- backend/frontend `npm audit`
- frontend production build
- UI label guard
- hybrid UI guard
- `git diff --check`
- shell syntax ของ health/off-host/restore/gate scripts

ผลที่ต้องได้ก่อนขอ deploy: `fail=0`

## 2. Production Read-only Gate

## 2A. Public External Gate

รันจากเครื่องนอก server เพื่อดูมุมผู้ใช้จริง:

```bash
BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public
```

ต้องระบุ `BASE_URL` เมื่อตรวจเว็บจริง; ถ้าไม่ระบุ สคริปต์จะใช้ค่า default `http://127.0.0.1:3000` สำหรับ local/server checks

รายการที่ตรวจ:

- public root HTTP 200
- `/api/auth/me` without token HTTP 401
- reports endpoint ต้อง require authentication
- `/parent` และ `/parent/link` โหลดได้

ผลที่ต้องได้ก่อน/หลังเปิดใช้งานจริง: `fail=0`

## 2B. Production Read-only Gate

รันบน server ก่อน deploy หรือก่อนประกาศ controlled rollout:

```bash
cd /home/schoolbus/apps/lampang-bus-system
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh production
```

รายการที่ตรวจ:

- `/health` HTTP 200, `success=true`, DB connected
- public root HTTP 200
- `/api/auth/me` without token HTTP 401
- reports endpoint ต้อง require authentication
- `/parent` และ `/parent/link` โหลดได้
- git worktree deploy สะอาด
- `scripts/health-check.sh`
- latest local backup verification
- off-host backup checker แบบ read-only
- off-host sync log ต้องมีชื่อ backup ล่าสุด
- restore-test readiness แบบ forced read-only

ผลที่ต้องได้ก่อนประกาศพร้อมใช้: `fail=0` และต้อง review warning ทั้งหมด

## 3. Restore Drill Gate

รันหลังมี owner/operator approval และสร้าง test DB แล้วเท่านั้น:

```bash
cd /home/schoolbus/apps/lampang-bus-system
node scripts/create-restore-drill-evidence-pack.js
mysql -e "CREATE DATABASE IF NOT EXISTS lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
set -o pipefail
RESTORE_DB=lampang_bus_restore_drill bash scripts/restore-drill-db.sh 2>&1 | tee outputs/restore-drill/<timestamp>/restore-drill-output.redacted.log
```

หลักฐานที่ต้องเก็บ:

- ชื่อ backup file ที่ restore
- sha256/gzip PASS
- จำนวน table restored เทียบ production
- row counts ของ key tables
- ยืนยันว่า production aggregate counts ไม่เปลี่ยนหลัง drill

หลังกรอก `outputs/restore-drill/<timestamp>/restore-drill-result.md` และแนบ log ที่ redact แล้ว ให้ตรวจด้วย:

```bash
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
```

validator นี้ไม่รัน restore drill เองและไม่เชื่อมต่อฐานข้อมูล ใช้ตรวจเฉพาะหลักฐานที่ operator แนบไว้เท่านั้น

## 4. Post-deploy Gate

รันหลัง pull approved commit, install/build, restart PM2 แล้ว:

```bash
cd /home/schoolbus/apps/lampang-bus-system
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh postdeploy
```

postdeploy mode ต้องพิสูจน์เพิ่มว่า:

- `/health.data.commit` ตรงกับ `git rev-parse --short HEAD`
- health monitor ไม่ fail
- backup/off-host/restore-readiness ยังผ่านหลัง deploy

หลัง gate ผ่าน ให้ monitor:

```bash
pm2 logs schoolbus-backend --lines 100
tail -n 100 /home/schoolbus/backups/lampang-bus/health-check.log
tail -n 100 /home/schoolbus/logs/offhost-sync.log
```

## 4A. Evidence Pack

สร้างชุดหลักฐานสำหรับแนบ sign-off:

```bash
BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public
```

ถ้าต้องการแนบหลักฐาน pre-deploy local ด้วย:

```bash
bash scripts/collect-phase9-evidence.sh public local
```

ผลลัพธ์จะอยู่ที่ `outputs/phase9-evidence/<timestamp>/summary.md` พร้อม log ราย gate

collector นี้ไม่รัน restore drill, deploy, migration, import, feature flag หรือ production DB write

ตรวจ evidence pack ก่อนแนบ sign-off:

```bash
node scripts/validate-phase9-evidence.js outputs/phase9-evidence/<timestamp> --require-mode public
```

ตรวจ UAT และ owner/operator sign-off ก่อนประกาศ 100%:

```bash
node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
node scripts/validate-go-live-signoff.js
node scripts/verify-100-readiness.js
```

สร้างชุดส่งมอบ go-live สำหรับแนบให้ owner/operator review:

```bash
node scripts/create-go-live-bundle.js --allow-pending --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp>
node scripts/validate-go-live-bundle.js outputs/go-live-bundle/<timestamp> --allow-pending
```

ใช้ `--allow-pending` เฉพาะช่วงเตรียมเอกสารก่อน UAT/sign-off ครบเท่านั้น รอบสุดท้ายก่อนเรียก 100% ต้องรันโดยไม่ใส่ `--allow-pending`

ให้เปิด `outputs/go-live-bundle/<timestamp>/SOURCE_STATE.md` ก่อนอนุมัติ commit/deploy และเปิด `outputs/go-live-bundle/<timestamp>/ACTION_PLAN.md` เพื่อดูจำนวนงานค้างแยกตาม role, sign-off section, approval scope, และ readiness pending ก่อนมอบหมายทีมปิดงาน ถ้าต้องแจกงานใน spreadsheet ให้ใช้ `outputs/go-live-bundle/<timestamp>/ACTION_ITEMS.csv`

## 5. Final Sign-off Rule

เรียก 100% ได้เฉพาะเมื่อครบทุกข้อ:

- local gate PASS
- production read-only gate PASS, รวม off-host config และ log evidence ของ backup ล่าสุด
- public external gate PASS จาก URL จริง
- evidence pack ถูกสร้างและแนบกับ sign-off
- evidence pack validator PASS
- UAT evidence pack ถูกสร้างและกรอกผลครบ
- UAT evidence pack validator PASS
- go-live bundle ถูกสร้างจาก evidence ล่าสุดและไม่มี failed check
- go-live bundle validator PASS
- owner/operator approval packet PASS
- restore drill PASS
- restore drill evidence validator PASS
- UAT sign-off ครบทุกบทบาท
- `node scripts/validate-go-live-signoff.js` PASS
- `node scripts/verify-100-readiness.js` PASS
- DPO/legal sign-off สำหรับ consent/QR/LINE policy
- owner approval + rollback plan
- postdeploy gate PASS
- monitor 30-60 นาทีแล้วไม่มี error pattern ใหม่
