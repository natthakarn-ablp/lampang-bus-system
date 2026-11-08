# Deploy CI gate (OPS-001)

ตั้งแต่ 2026-11-08 `scripts/deploy-backend.sh` นำโค้ดขึ้นได้ **เฉพาะ commit ที่ผู้ deploy ระบุเป็น SHA เต็ม และ workflow "Full Quality" ผ่านบน push ของ commit นั้นจริง** ก่อนหน้านี้สคริปต์รันแค่ unit test บนเซิร์ฟเวอร์ — commit ที่ integration test, migration check หรือ frontend build ล้มใน CI ยัง deploy ได้

## 1. ขั้นตอน deploy

1. รอให้ PR merge เข้า `feat/tracking-security-hardening` แล้วดู Full Quality ของ **merge commit** (ไม่ใช่ของ PR):
   ```bash
   gh run list --workflow "Full Quality" --branch feat/tracking-security-hardening --limit 5 \
     --json headSha,event,status,conclusion
   ```
   ใช้แถวที่ `event` = `push`, `status` = `completed`, `conclusion` = `success`
2. คัด `headSha` เต็ม 40 ตัวอักษรของแถวนั้น
3. deploy โดยส่ง SHA นั้น:
   ```bash
   ssh ssh.schoolbus.lp-pao.go.th 'cd /home/schoolbus/apps/lampang-bus-system && \
     EXPECTED_BRANCH=feat/tracking-security-hardening DEPLOY_FRONTEND=1 \
     DEPLOY_TARGET_SHA=<SHA เต็ม 40 ตัว> \
     bash /home/schoolbus/deploy-state/deploy-backend.sh'
   ```
4. บรรทัด `[ci-gate] ALLOW: "Full Quality" run <id> for <sha> … success` ต้องขึ้นก่อน `fast-forwarded`

### สิ่งที่สคริปต์ตรวจ (ตามลำดับ)
| ขั้น | เงื่อนไข | ถ้าไม่ผ่าน |
|---|---|---|
| ก่อน lock | `DEPLOY_TARGET_SHA` เป็น hex ตัวเล็ก 40 ตัว; มีไฟล์ gate อยู่ข้างสคริปต์ | หยุด ไม่มีอะไรเปลี่ยน |
| หลัง fetch | target อยู่ใน repository และอยู่บน `origin/<branch>` | หยุด ไม่มีอะไรเปลี่ยน |
| หลัง fetch | branch เดินหน้าเกิน target แล้ว | **deploy เฉพาะ target** แจ้ง "the newer commits are NOT deployed" |
| CI gate | มี run ชื่อ Full Quality, event `push`, `head_sha` = target, `head_branch` = branch, repo ถูกต้อง; run ล่าสุดของ SHA นั้น `completed/success` | หยุด ไม่ merge ไม่รันเทสต์ ไม่ reload — บันทึก `refused ci-gate` ใน deploy-history.log |
| เดิม | fast-forward, npm ci, syntax, unit test, reload, health ตรง commit, rollback | ตามเดิม |

**ทำไมใช้เฉพาะ run แบบ push:** run ของ `pull_request` ทดสอบ merge ref ชั่วคราวของ GitHub ไม่ใช่ commit ที่อยู่บน branch จึงไม่ใช่หลักฐานของโค้ดที่จะขึ้นจริง ส่วน run แบบ push ของ merge commit ทดสอบ tree เดียวกับที่ fast-forward ขึ้นเซิร์ฟเวอร์ทุกไบต์

## 2. เมื่อ gate ปฏิเสธ
| ข้อความ | ความหมาย | ทำอย่างไร |
|---|---|---|
| `DEPLOY_TARGET_SHA must be the full 40-character commit SHA` | ไม่ได้ส่ง SHA หรือส่ง SHA สั้น | ส่ง SHA เต็มจากขั้นที่ 1 |
| `… is not on origin/<branch>` / `is not in this repository` | SHA ไม่ได้อยู่บน branch ที่ deploy (เช่น SHA ของ PR branch) | ใช้ SHA ของ merge commit บน feat |
| `[ci-gate] REFUSE: … is in_progress / queued` | CI ยังไม่จบ | รอแล้วรันใหม่ |
| `[ci-gate] REFUSE: … concluded failure / cancelled / timed_out` | CI ไม่ผ่าน | แก้แล้ว merge ใหม่ หรือ re-run CI ถ้าล้มเพราะสภาพแวดล้อม — **ห้ามข้าม** |
| `[ci-gate] REFUSE: no "Full Quality" push run found` | ไม่มี run ของ SHA นั้น (ยังไม่ push / SHA ผิด) | ตรวจ SHA หรือรอ run เริ่ม |
| `[ci-gate] CANNOT CHECK: rate limit` | ใช้ API แบบไม่ยืนยันตัวตนเกิน 60 ครั้ง/ชม. | รอ หรือกำหนด `DEPLOY_CI_TOKEN_FILE` (ข้อ 4) |
| `[ci-gate] CANNOT CHECK: unreachable / did not answer / HTTP 5xx` | เซิร์ฟเวอร์ติดต่อ GitHub ไม่ได้ | ตรวจเครือข่ายแล้วรันใหม่ — gate ไม่ยอมให้ผ่านเมื่อตรวจไม่ได้ |
| `CI gate not found` | ยังไม่ได้ติดตั้ง `deploy-ci-gate.js` ข้างสคริปต์ | ทำตามข้อ 3 |

**ไม่มีสวิตช์ข้าม CI** ตัวแปร `DEPLOY_CI_GATE` มีไว้ให้ชุดทดสอบชี้ไปที่ stub (แบบเดียวกับ `DEPLOY_NPX`) ผู้มีสิทธิ์ shell บนเซิร์ฟเวอร์สามารถเปลี่ยนตัวแปร/สคริปต์ได้อยู่แล้ว — gate นี้กัน "deploy ผิด commit โดยไม่ตั้งใจ" ไม่ได้ป้องกันผู้ดูแลเซิร์ฟเวอร์ที่ตั้งใจข้าม หากจำเป็นต้องนำขึ้นฉุกเฉินโดยไม่มี CI ให้ตัดสินใจโดยเจ้าของระบบและบันทึกเหตุผลไว้

## 3. ติดตั้ง/ย้อนกลับบนเซิร์ฟเวอร์ (ทำครั้งเดียวหลัง PR นี้ merge)
เซิร์ฟเวอร์รันสำเนาสคริปต์ใน `/home/schoolbus/deploy-state/` (ไม่ใช่ไฟล์ใน checkout)
1. deploy merge commit ของ PR นี้ด้วยสคริปต์ **เดิม** (ยังไม่มี gate) — ตรวจ Full Quality ของ SHA นั้นด้วยมือก่อน
2. สำรองและติดตั้ง:
   ```bash
   cd /home/schoolbus/deploy-state
   cp -p deploy-backend.sh deploy-backend.sh.pre-ops001
   cp /home/schoolbus/apps/lampang-bus-system/scripts/deploy-backend.sh .
   cp /home/schoolbus/apps/lampang-bus-system/scripts/deploy-ci-gate.js .
   sha256sum deploy-backend.sh deploy-ci-gate.js \
     /home/schoolbus/apps/lampang-bus-system/scripts/deploy-backend.sh \
     /home/schoolbus/apps/lampang-bus-system/scripts/deploy-ci-gate.js
   ```
   ค่า sha256 คู่ละไฟล์ต้องตรงกัน
3. ทดสอบ gate แบบอ่านอย่างเดียว (ไม่ deploy): `node /home/schoolbus/deploy-state/deploy-ci-gate.js --sha <SHA> --branch feat/tracking-security-hardening; echo $?` → ต้องได้ `ALLOW` และ `0`
4. **ย้อนกลับ**: `cp -p deploy-backend.sh.pre-ops001 deploy-backend.sh` (ไฟล์ gate ที่เหลือไม่มีผลเมื่อสคริปต์เดิมไม่เรียกใช้)

## 4. token (ไม่บังคับ)
repository เป็น public จึงตรวจ CI ได้โดยไม่ใช้ token (จำกัด 60 คำขอ/ชม./IP ซึ่งพอสำหรับการ deploy) ถ้าต้องการ:
- สร้าง fine-grained token เฉพาะ repository นี้ สิทธิ์ **Actions: Read-only** เท่านั้น
- เก็บที่ `/home/schoolbus/deploy-state/github-ci-token` สิทธิ์ไฟล์ `600` แล้วส่ง `DEPLOY_CI_TOKEN_FILE=/home/schoolbus/deploy-state/github-ci-token`
- gate ใส่ token ใน header เท่านั้น ไม่พิมพ์ลง log; ถ้าระบุไฟล์แต่อ่านไม่ได้หรือว่าง → ปฏิเสธ (exit 3)

## 5. ชุดทดสอบไม่ขึ้นกับ feature flag ของ production
`backend/tests/loadTestEnv.js` (setupFiles ของทั้ง unit และ integration) ตั้งค่า `FEATURE_*` ทุกตัวที่ `src/config/env.js` อ่านเป็น `'false'` ก่อนที่ `.env` จริงจะถูกโหลด (ยกเว้นค่าที่ `.env.test` กำหนดเอง) — `.env` ของเซิร์ฟเวอร์หรือค่าที่ shell export จึงเปิด flag ให้ชุดทดสอบไม่ได้ test ที่ต้องการ flag เปิดต้องตั้งเองในไฟล์ test และทดสอบทั้งเปิดและปิด

## 6. ทดสอบ
- `backend/tests/deployCiGate.unit.test.js` — ตรรกะ gate กับ GitHub API จำลอง (ผ่าน/ไม่ผ่าน/กำลังรัน/ยกเลิก/ไม่พบ/SHA อื่นผ่าน/run ล่าสุดตัดสิน/PR run ไม่นับ/HTTP 401-403-404-5xx/timeout/token)
- `backend/tests/deployBackendScript.unit.test.js` › "CI gate (OPS-001)" — สคริปต์ deploy จริงบน repository จำลองกับ gate stub: ผ่าน → deploy target; ปฏิเสธ/ตรวจไม่ได้ → ไม่ merge ไม่รันเทสต์ ไม่ reload; branch เดินหน้า → deploy เฉพาะ target; target ไม่อยู่บน branch / SHA ผิดรูป → หยุดก่อนแตะอะไร
- `backend/tests/testEnvFeatureFlags.unit.test.js` — `.env` แบบ production และค่าจาก shell เปิด flag ให้ชุดทดสอบไม่ได้
