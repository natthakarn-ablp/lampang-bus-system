# Production Governance Checklist 2026-08 — School Safe Connect ลำปาง

สถานะเอกสาร: checklist ก่อน deploy/เปิดใช้งานเต็ม
วันที่ปรับปรุง: 2026-08-25

หลักใหญ่: ข้อมูล production เป็นข้อมูลจริง ห้ามแก้ข้อมูลจริงระหว่าง audit/UAT/training เว้นแต่มีเจ้าของข้อมูลอนุมัติและมีแผน rollback ชัดเจน

## 1. Release Gate

| Gate | ต้องมี |
|---|---|
| Owner approval | ผู้รับผิดชอบโครงการอนุมัติ deploy เป็นข้อความชัดเจน |
| Technical approval | test/build/audit ผ่านตามรายการในเอกสารนี้ |
| Data approval | เจ้าของข้อมูลยืนยันว่า migration/import ไม่แตะข้อมูลจริงโดยไม่จำเป็น |
| DPO/legal approval | consent/QR/LINE policy ผ่านก่อนเปิดข้อมูลระดับสูงหรือ push policy ใหม่ |
| Rollback plan | commit, backup, PM2 rollback, DB migration rollback ระบุแล้ว |

ห้าม deploy production หรือ flip feature flag สำคัญโดยไม่มี owner approval

## 2. Current Production Baseline

บันทึกตรวจล่าสุดแบบ read-only เมื่อ 2026-08-25:

| รายการ | สถานะ |
|---|---|
| PM2 backend | online, restart count ไม่เพิ่ม |
| Public root | HTTP 200 |
| Fake login | HTTP 401 JSON |
| `/health` | success true, DB connected |
| Git worktree บน server | clean |
| Local backup | PASS: gzip + sha256 + content |
| Off-host backup | sync log มีไฟล์ล่าสุดบน remote |
| Restore drill | ยังไม่ FULL GREEN: test DB `lampang_bus_restore_drill` ยังไม่ได้สร้าง |
| `/health.data.commit` | production เคยไม่ตรง git HEAD; worktree patch แก้ resolver แล้ว ต้อง verify หลัง deploy |
| `scripts/health-check.sh` | worktree patch เพิ่ม WARN เมื่อ health commit ไม่ตรง git HEAD |
| Production gate runner | เพิ่ม `scripts/production-readiness-gate.sh` สำหรับ local/public/production/postdeploy gate; off-host check ใน production mode ใช้ read-only config validation + log evidence |

## 3. Feature Flags

| Feature | ค่าแนะนำก่อน UAT เต็ม |
|---|---|
| Driver registration | เปิดได้ถ้า UAT ผ่าน |
| ETA/geofence/route deviation | ปิดจนกว่าจะมี GPS/route data จริง |
| Vehicle QR | ปิดจนกว่า DPO/legal sign-off |
| Parent consent required | ปิดจนกว่า consent text ผ่าน |
| QR level 3 | ปิดจนกว่า consent/PDPA gate ผ่าน |
| Safety policy enforce | ปิดจนกว่าข้อมูลรับรองรถ/คนขับครบ |

## 4. Data Safety

ก่อนงานที่อ่าน production:

- ใช้ aggregate SELECT เท่านั้นเมื่อไม่จำเป็นต้องเห็นรายบุคคล
- ตั้ง session timezone เป็น `+07:00` สำหรับ query ที่ใช้วันที่
- ไม่ export PII ออกจาก server
- Mask phone/CID/LINE id ใน notes และ evidence

ก่อนงานที่เขียน production:

- ยืนยัน backup ล่าสุดผ่าน `scripts/verify-latest-backup.sh`
- ระบุ SQL/migration ที่จะรันและ rollback
- ยืนยันจำนวนแถวที่จะกระทบด้วย dry-run/transaction preview
- มี owner approval แบบ explicit

## 5. UAT Required Before 100%

ใช้ `docs/UAT_SIGNOFF_2026-08.md` เป็นเอกสารหลัก

| หมวด | เกณฑ์ผ่าน |
|---|---|
| Login/RBAC | ทุกบทบาท login/blocked-route ถูกต้อง |
| Dashboard | province/affiliation/school โหลดและ scope ถูกต้อง |
| Master data | students/vehicles/drivers/parents/users อ่าน/แก้ใน sandbox ถูกต้อง |
| Import | preview/validation ผ่าน, commit ทดสอบเฉพาะ sandbox |
| Daily operation | driver check-in/out/emergency ทดสอบ sandbox |
| Reports/export | daily/monthly/summary/policy export ได้และ audit `EXPORT` |
| Audit log | action สำคัญย้อนหลังได้ตามสิทธิ์ |
| LINE/LIFF | bind/view/unbind guard ถูกต้องด้วย test account |
| Manuals/training | คู่มือและ Training Pack ใช้จริงในการอบรม |
| Ops | health, backup, off-host, restore drill, rollback ผ่าน |

## 6. Backup + Restore Governance

Daily:

- `scripts/verify-latest-backup.sh`
- `scripts/check-offhost-backup-config.sh`
- ตรวจ `/home/schoolbus/logs/offhost-sync.log`

Weekly until stable:

- Restore drill ลง `lampang_bus_restore_drill`
- ตรวจ table counts เทียบ production aggregate
- ล้าง test DB หลัง drill ถ้าไม่ต้องเก็บไว้ตรวจ

Full green condition:

- local backup PASS
- off-host sync PASS
- restore drill PASS อย่างน้อย 1 รอบ
- production aggregate counts ไม่เปลี่ยนหลัง drill

## 7. Deployment Checklist

Pre-deploy:

- `git status --short` ใน worktree deploy สะอาด
- backend unit tests ผ่าน
- frontend build ผ่าน
- frontend label/hybrid checks ผ่าน
- `npm audit` backend/frontend ไม่มี vulnerability ระดับ actionable
- `git diff --check` ผ่าน
- migration status ไม่มี drift ใหม่
- `bash scripts/production-readiness-gate.sh local` ผ่านใน worktree ที่จะ deploy
- `BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public` ผ่านจากภายนอก
- `BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public` สร้าง evidence pack สำหรับ sign-off
- `node scripts/validate-phase9-evidence.js outputs/phase9-evidence/<timestamp> --require-mode public` ผ่านก่อนแนบ sign-off
- `node scripts/create-uat-evidence-pack.js --mode sandbox --base-url https://schoolbuslampang.com` สร้าง UAT evidence pack ให้ผู้ทดสอบแต่ละบทบาท
- `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>` ต้องผ่านหลังผู้ทดสอบกรอก role evidence files ครบ
- แนบ `docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md` พร้อมลายเซ็น owner/operator ก่อน deploy หรือ restore drill
- `node scripts/validate-go-live-signoff.js` ต้อง PASS หลังกรอก UAT/approval/evidence ครบ
- `node scripts/verify-100-readiness.js` ต้อง PASS และแนบ report จาก `outputs/go-live-readiness/<timestamp>/summary.md`
- `BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh production` ผ่านบน server แบบ read-only

Deploy:

1. Pull exact approved commit
2. Install dependencies with lockfile
3. Build frontend
4. Restart PM2 with `--update-env`
5. Run health smoke
6. Verify `/health.data.commit` equals git HEAD
7. Verify `scripts/health-check.sh` exits 0 and does not warn about commit mismatch
8. Confirm public root 200 and no-token `/api/auth/me` 401 JSON
9. Run `BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh postdeploy`

Post-deploy:

- Role smoke test อย่างน้อย admin/province/school/driver/parent
- Audit export smoke
- LINE webhook/LIFF smoke
- Monitor PM2/error logs 30-60 นาที

## 8. Rollback Checklist

- ระบุ commit ก่อน deploy
- หาก frontend เท่านั้นผิด ให้ revert bundle/commit และ rebuild
- หาก backend runtime ผิด ให้ rollback commit และ restart PM2
- หาก migration แตะ schema ให้ใช้ rollback migration ที่เตรียมไว้เท่านั้น
- ห้าม restore production DB เป็นทางเลือกแรก เว้นแต่ incident commander + owner อนุมัติ
- ก่อน restore production ต้องทำ restore drill กับ backup เดียวกันก่อน

## 9. Evidence For 100% Readiness

ต้องแนบหรือบันทึก:

- Test/build/audit command output summary
- UAT sign-off ของทุกบทบาท
- Training attendance/sign-off
- Backup/off-host/restore drill evidence
- DPO/legal decision สำหรับ consent/QR/LINE policy
- Deployment approval และ rollback plan
- Post-deploy smoke result
- Output summary จาก `scripts/production-readiness-gate.sh`
- `outputs/phase9-evidence/<timestamp>/summary.md`
- `outputs/phase9-evidence/<timestamp>/manifest.json` ที่ผ่าน validator
- `outputs/uat-evidence/<timestamp>/README.md` และ role evidence files หลัง UAT
- Output จาก `node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>` ที่ PASS
- Output จาก `node scripts/validate-go-live-signoff.js` ที่ PASS
- `outputs/go-live-readiness/<timestamp>/summary.md` จาก `node scripts/verify-100-readiness.js`
