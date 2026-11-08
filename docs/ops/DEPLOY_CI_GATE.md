# Deploy CI gate (OPS-001)

ตั้งแต่ 2026-11-08 `scripts/deploy-backend.sh` นำโค้ดขึ้นได้ **เฉพาะ commit ที่ผู้ deploy ระบุเป็น SHA เต็ม และ workflow `.github/workflows/full-quality.yml` ของ repository นี้ผ่านบน push ของ commit นั้นจริง** ก่อนหน้านี้สคริปต์รันแค่ unit test บนเซิร์ฟเวอร์ — commit ที่ integration test, migration check หรือ frontend build ล้มใน CI ยัง deploy ได้

## 1. ขั้นตอน deploy (หลังติดตั้งตามข้อ 3 แล้ว)

1. หลัง PR merge ดู Full Quality ของ **merge commit** (ไม่ใช่ของ PR):
   ```bash
   gh run list --workflow full-quality.yml --branch feat/tracking-security-hardening --limit 5 \
     --json headSha,event,status,conclusion
   ```
   ใช้แถวที่ `event` = `push`, `status` = `completed`, `conclusion` = `success`
2. deploy โดยส่ง `headSha` เต็ม 40 ตัวอักษร:
   ```bash
   ssh ssh.schoolbus.lp-pao.go.th 'cd /home/schoolbus/apps/lampang-bus-system && \
     EXPECTED_BRANCH=feat/tracking-security-hardening DEPLOY_FRONTEND=1 \
     DEPLOY_TARGET_SHA=<SHA เต็ม 40 ตัว> \
     bash /home/schoolbus/deploy-state/deploy-backend.sh'
   ```
3. ต้องเห็น `[ci-gate] ALLOW: .github/workflows/full-quality.yml (workflow <id>) run <run> for <sha> … success` ก่อน `fast-forwarded`

### สิ่งที่สคริปต์ตรวจ (ตามลำดับ)
| ขั้น | เงื่อนไข | ถ้าไม่ผ่าน |
|---|---|---|
| ก่อน lock | `DEPLOY_TARGET_SHA` เป็น hex ตัวเล็ก 40 ตัว; มี `deploy-ci-gate.js` อยู่ข้างสคริปต์ | หยุด ไม่มีอะไรเปลี่ยน |
| หลัง fetch | target อยู่ใน repository และอยู่บน `origin/<branch>` | หยุด ไม่มีอะไรเปลี่ยน |
| หลัง fetch | branch เดินหน้าเกิน target แล้ว | **deploy เฉพาะ target** แจ้ง "the newer commits are NOT deployed" |
| CI gate | ดูข้อ 1.1 | หยุด ไม่ merge ไม่รันเทสต์ ไม่ reload — บันทึก `refused ci-gate` |
| เดิม | fast-forward, npm ci, syntax, unit test, reload, health ตรง commit, rollback | ตามเดิม |

### 1.1 gate นับ run ไหน
1. หา workflow จาก **ไฟล์** `GET /repos/natthakarn-ablp/lampang-bus-system/actions/workflows/full-quality.yml` → ได้ `id` (ปัจจุบัน 333997252) และ `path`; ถ้าไม่พบหรือ path ไม่ตรง → ตรวจไม่ได้ (ปฏิเสธ) — ไม่เชื่อชื่อที่แสดงอย่างเดียว เพราะ workflow อื่นอาจตั้งชื่อซ้ำได้
2. ดึง run ของ workflow id นั้น `…/workflows/<id>/runs?head_sha=<target>&event=push&branch=<branch>`
3. run ที่นับต้องตรงทุกข้อ: `workflow_id`, `path`, `event=push`, `head_sha`, `head_branch`, `repository` และ `head_repository` = repository นี้ (ไม่นับ run ของ PR ซึ่งทดสอบ merge ref ชั่วคราว และไม่นับ fork)
4. **run ล่าสุดตาม `created_at` เป็นตัวตัดสิน** — การกด re-run ของ run เดิมใช้ id เดิมและ API รายงานสถานะของ attempt ล่าสุด ถ้า attempt ใหม่ยังรันอยู่ → ปฏิเสธ แม้ attempt ก่อนจะผ่าน
5. ต้อง `status=completed` และ `conclusion=success`
6. ข้อมูลไม่ครบหรือแปลผลไม่ได้ (ไม่มี id/สถานะ/เวลา, สถานะแปลก, จำนวน run มากกว่าที่ได้รับ) → ปฏิเสธ ไม่อนุญาตโดยเดา

### 1.2 rollback (ไม่เปลี่ยนนโยบายเดิม)
- rollback **ไม่ผ่าน CI gate** — gate ถูกเรียกครั้งเดียวสำหรับ target ก่อนแตะ checkout การย้อนกลับเป็นการคืนรุ่นที่ "รันอยู่จริงก่อน deploy" ซึ่งไม่ควรถูกขวางด้วย CI ในเหตุฉุกเฉิน
- หลักฐานรุ่นที่จะย้อน: commit ที่ `/health` รายงานก่อนเริ่ม (`running_before`) ต้องเป็น SHA ที่ resolve ได้ใน repository มิฉะนั้นสคริปต์ไม่เริ่ม deploy; บันทึกในบรรทัด `start … running_before=… rollback_ref=…(running)` ของ `deploy-history.log`
- หลัง rollback สคริปต์ตรวจ `/health` ว่ารายงาน commit ที่ย้อนไปจริง (`Rolled back: running <commit>`)
- พิสูจน์ใน sandbox: `deployBackendScript.unit.test.js` › "rollback after a failed health check does NOT re-run the gate…"

## 2. เมื่อ gate ปฏิเสธ
| ข้อความ | ความหมาย | ทำอย่างไร |
|---|---|---|
| `DEPLOY_TARGET_SHA must be the full 40-character commit SHA` | ไม่ได้ส่ง SHA หรือส่ง SHA สั้น | ส่ง SHA เต็มจากข้อ 1 |
| `… is not on origin/<branch>` / `is not in this repository` | SHA ไม่อยู่บน branch ที่ deploy (เช่น SHA ของ PR branch) | ใช้ SHA ของ merge commit บน feat |
| `[ci-gate] REFUSE: … is in_progress / queued / waiting` | CI (หรือ re-run) ยังไม่จบ | รอแล้วรันใหม่ |
| `[ci-gate] REFUSE: … concluded failure / cancelled / timed_out` | CI ไม่ผ่าน | แก้แล้ว merge ใหม่ หรือ re-run ถ้าล้มเพราะสภาพแวดล้อม — **ห้ามข้าม** |
| `[ci-gate] REFUSE: no … push run … for <sha>` | ไม่มี run ของ SHA นั้น | ตรวจ SHA หรือรอ run เริ่ม |
| `[ci-gate] REFUSE: … incomplete data` / `cannot be sure which is newest` | คำตอบ API ไม่ครบ | รันใหม่; ถ้าซ้ำให้ตรวจที่ GitHub ด้วยตา |
| `[ci-gate] CANNOT CHECK: rate limit` | API แบบไม่ใช้ token เกิน 60 ครั้ง/ชม./IP | รอ หรือกำหนด `DEPLOY_CI_TOKEN_FILE` (ข้อ 4) |
| `[ci-gate] CANNOT CHECK: unreachable / did not answer / HTTP 5xx / workflow … not found` | ติดต่อ GitHub ไม่ได้ / ไม่พบ workflow | ตรวจเครือข่าย/ชื่อไฟล์ workflow แล้วรันใหม่ — gate ไม่อนุญาตเมื่อตรวจไม่ได้ |
| `CI gate not found` | ยังไม่ได้ติดตั้ง helper ข้างสคริปต์ | ติดตั้งตามข้อ 3 |

**ไม่มีสวิตช์ข้าม CI** ตัวแปร `DEPLOY_CI_GATE` มีไว้ให้ชุดทดสอบชี้ไปที่ stub (เหมือน `DEPLOY_NPX`) ผู้มีสิทธิ์ shell บนเซิร์ฟเวอร์ยังแก้ตัวแปร/สคริปต์ได้ — gate นี้กัน "deploy ผิด commit โดยไม่ตั้งใจ" ไม่ได้ป้องกันผู้ดูแลเซิร์ฟเวอร์ที่ตั้งใจข้าม หากต้องนำขึ้นฉุกเฉินโดยไม่มี CI ให้เจ้าของระบบตัดสินใจและบันทึกเหตุผล

## 3. ติดตั้งครั้งแรกบนเซิร์ฟเวอร์ (ทำครั้งเดียวหลัง PR นี้ merge)

เซิร์ฟเวอร์รันสำเนาใน `/home/schoolbus/deploy-state/` ไม่ใช่ไฟล์ใน checkout การ merge จึงไม่เปลี่ยนอะไรบนเซิร์ฟเวอร์จนกว่าจะติดตั้ง

**ทำไมไม่ใช้สคริปต์เดิม deploy ก่อนแล้วค่อยติดตั้ง:** สคริปต์เดิม deploy "หัว branch ณ ตอน fetch" ระบุ SHA ไม่ได้ — ถ้ามี PR อื่น merge เข้ามาระหว่างนั้น จะขึ้นโค้ดที่ยังไม่ได้ตรวจโดยไม่รู้ตัว จึง **ติดตั้งสคริปต์ใหม่ก่อน** (ไม่แตะ checkout และบริการ) แล้วใช้สคริปต์ใหม่ deploy โดยตรึง SHA

ตัวติดตั้ง `scripts/install-deploy-scripts.sh` ทำทุกขั้นในคำสั่งเดียว:
1. fetch branch (อัปเดต refs เท่านั้น ไม่แตะ checkout) และตรวจว่า SHA อยู่บน branch
2. ดึง `deploy-backend.sh` และ `deploy-ci-gate.js` จาก **git object ของ SHA นั้น** (`git show`) ไม่ใช่จาก working tree และตรวจ syntax
3. ใช้ **gate จาก commit เดียวกัน** ตรวจแบบอ่านอย่างเดียวว่า Full Quality ผ่านบน push ของ SHA นั้น — ไม่ผ่านไม่ติดตั้ง
4. ถือ **lock เดียวกับ deploy** (`deploy-state/deploy-backend.lock`) ระหว่างสลับไฟล์ — deploy ที่เริ่มระหว่างนี้จะถูกปฏิเสธ และถ้ามี deploy ถืออยู่ ตัวติดตั้งจะไม่ทำ
5. สำรองไฟล์เดิมเป็น `*.pre-install-<stamp>` แล้ว **ติดตั้ง helper ก่อน main** (ไม่มีช่วงที่ main ใหม่มีอยู่โดยไม่มี helper) แต่ละไฟล์ผ่านไฟล์ชั่วคราวแล้ว rename; สิทธิ์ main `755`, helper `644`
6. เทียบ sha256 ไฟล์ที่ติดตั้งกับ git object ของ SHA และสั่ง main ใหม่ให้เริ่ม: ต้องผ่านการตรวจค่าตั้งและพบ helper แล้วหยุดที่ lock ที่ตัวติดตั้งถืออยู่ (ยืนยันตำแหน่งอ้างอิง helper) — ไม่ fetch ไม่ deploy
7. ปล่อย lock และบันทึก `deploy-scripts installed from <sha> backup=<stamp>` ใน `deploy-history.log`

### ขั้นตอนพร้อมใช้
```bash
# 0) บนเครื่องผู้ดูแล: merge PR แล้วรอ Full Quality แบบ push ของ merge SHA
gh run list --workflow full-quality.yml --branch feat/tracking-security-hardening --limit 5 \
  --json headSha,event,status,conclusion
#    เลือก headSha ของแถว event=push, completed, success  → เรียกว่า M

# 1) บนเซิร์ฟเวอร์: ใช้ตัวติดตั้งจาก commit M เอง (ไม่ใช่จาก working tree)
ssh ssh.schoolbus.lp-pao.go.th
cd /home/schoolbus/apps/lampang-bus-system
git fetch -q origin feat/tracking-security-hardening
git show M:scripts/install-deploy-scripts.sh > /tmp/install-deploy-scripts-M.sh
bash /tmp/install-deploy-scripts-M.sh M
#    ต้องเห็น: [ci-gate] ALLOW …, sha256 … (matches M) สองไฟล์,
#              "resolves deploy-ci-gate.js and stops at the lock as expected",
#              "Backup stamp: <STAMP>"  ← จดไว้

# 2) deploy M ด้วยสคริปต์ใหม่ (gate ตรวจ M อีกครั้ง)
EXPECTED_BRANCH=feat/tracking-security-hardening DEPLOY_FRONTEND=1 DEPLOY_TARGET_SHA=M \
  bash /home/schoolbus/deploy-state/deploy-backend.sh
```

### 3.1 ย้อนการติดตั้ง (แยกจากการ revert โค้ด)
การ revert PR ใน repository **ไม่เปลี่ยนไฟล์ใน deploy-state** ต้องย้อนบนเซิร์ฟเวอร์เอง:
```bash
bash /tmp/install-deploy-scripts-M.sh --restore <STAMP>
```
คืน `deploy-backend.sh` จาก `deploy-backend.sh.pre-install-<STAMP>` (และ helper ถ้ามีมาก่อน; ถ้าไม่มีมาก่อนจะลบ helper ที่ติดตั้ง) ภายใต้ lock เดียวกัน แล้วบันทึกใน deploy-history.log ไฟล์สำรองยังอยู่ ย้อนซ้ำได้ หลังย้อนแล้วคำสั่ง deploy กลับเป็นแบบเดิม (ไม่มี `DEPLOY_TARGET_SHA`)

## 4. token (ไม่บังคับ)
repository เป็น public จึงตรวจได้โดยไม่ใช้ token (60 คำขอ/ชม./IP; การตรวจหนึ่งครั้งใช้ 2 คำขอ) ถ้าต้องการ:
- fine-grained token เฉพาะ repository นี้ สิทธิ์ **Actions: Read-only** เท่านั้น
- เก็บที่ `/home/schoolbus/deploy-state/github-ci-token` สิทธิ์ `600` แล้วส่ง `DEPLOY_CI_TOKEN_FILE=/home/schoolbus/deploy-state/github-ci-token`
- gate ใส่ token ใน header เท่านั้น ไม่พิมพ์ลง log; ระบุไฟล์แต่อ่านไม่ได้หรือว่าง → ปฏิเสธ (exit 3)

## 5. ชุดทดสอบไม่ขึ้นกับ feature flag ของ production
- `backend/tests/loadTestEnv.js` (setupFiles ของทั้ง unit และ integration) ตั้ง `FEATURE_*` ทุกตัวที่ `src/config/env.js` อ่านเป็น `'false'` ก่อนที่ `.env` จริงจะถูกโหลด (ยกเว้นค่าที่ `.env.test` กำหนด) — `.env` ของเซิร์ฟเวอร์หรือค่าที่ shell export เปิด flag ให้ชุดทดสอบไม่ได้
- test ที่ต้องการ flag เปิด ตั้งเองได้ทั้ง `env.features.x = true` หรือ `process.env.FEATURE_X='true'` แล้ว `jest.isolateModules(() => require(...))` และต้องคืนค่า
- Jest ให้แต่ละไฟล์ test มี module registry และสำเนา `process.env` ของตัวเอง (ทดลองยืนยันแล้วว่าค่าที่ไฟล์หนึ่งตั้งไม่รั่วไปไฟล์ถัดไปแม้ `--runInBand`) การ reset ภายในไฟล์ใช้ `beforeEach`/`afterAll`

## 6. ทดสอบ
| ไฟล์ | พฤติกรรมที่ยืนยัน |
|---|---|
| `deployCiGate.unit.test.js` | ระบุ workflow จากไฟล์ → id; run ต้องตรง workflow_id/path/push/SHA/branch/repo/head repo; ชื่อซ้ำแต่ workflow อื่น, PR, branch อื่น, fork ไม่นับ; SHA อื่นผ่านแต่เป้าหมายไม่มี → ปฏิเสธ; queued/in_progress/waiting/failure/cancelled/timed_out/ไม่มีผล → ปฏิเสธ; re-run attempt 2 กำลังรัน → ปฏิเสธ, ผ่าน → อนุญาต; run ล่าสุดตัดสิน; ข้อมูลไม่ครบ/ไม่ครบหน้า → ปฏิเสธ; HTTP 401/403/rate-limit/404/5xx, เน็ตล่ม, timeout, JSON เสีย → ตรวจไม่ได้; token อยู่ใน header เท่านั้นและไม่ถูกพิมพ์; exit 0/2/3 |
| `deployBackendScript.unit.test.js` › CI gate (OPS-001) | ผ่าน → deploy ตรง target และส่ง SHA เต็ม+branch+ไฟล์ workflow ให้ gate; ปฏิเสธ/ตรวจไม่ได้ → ไม่ merge ไม่รันเทสต์ ไม่ reload ไม่มีบรรทัด start; branch เดินหน้า → deploy เฉพาะ target; target ไม่อยู่บน branch → หยุดก่อน gate; SHA ผิดรูป → ไม่มีคำสั่งใดถูกเรียก; health ล้มหลัง reload → rollback ไปรุ่นที่ `/health` รายงานก่อนเริ่ม โดยไม่เรียก gate ซ้ำ |
| `installDeployScripts.unit.test.js` | CI ผ่าน → สำรอง, ติดตั้งจาก commit, sha256 ตรง, main พบ helper และหยุดที่ lock, ปล่อย lock, บันทึก log; CI ปฏิเสธ/ตรวจไม่ได้ → ไม่เปลี่ยนไฟล์; มี lock อยู่ → ไม่ทำและไม่ลบ lock ของผู้อื่น; SHA สั้น/ไม่อยู่บน branch/commit ก่อนมี gate → ไม่ทำ; `--restore` คืนไฟล์เดิมและลบ helper ที่ไม่เคยมี; ลำดับ lock → helper → main |
| `testEnvFeatureFlags.unit.test.js` | `.env` แบบ production และค่าจาก shell เปิด flag ไม่ได้; test เปิด flag เองก่อน require ได้และคืนค่า |
| `schoolParentLineStatus` / `schoolParentLineUnlink` | ผู้ปกครองร่วม **ปิด**: SQL ใช้ `line_bindings` อย่างเดียว ไม่แตะตาราง co-guardian; **เปิด**: badge รวม co-guardian, ตัดการผูกแล้วผู้ปกครองร่วมหลุดพร้อม audit และแจ้ง LINE; ค่าที่ตั้งไม่รั่วไป test ถัดไป |
