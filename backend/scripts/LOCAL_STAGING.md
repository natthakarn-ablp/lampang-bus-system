# Local staging — วิธีตั้งและสิ่งที่มันไม่ใช่ (task A0-6)

> เอกสารนี้คือครึ่งที่หายไปของ A0-6 — deliverable ระบุไว้สองอย่างคือ
> `backend/scripts/seed-synthetic-staging.js` **และ README** สคริปต์มีมาตั้งแต่ 4 ก.ย. 2026
> แต่ส่วนหัวของมันเขียนไว้เองว่า *"ยังไม่เคยรันจริง: เครื่องที่เขียนไฟล์นี้ไม่มี docker ทำงานอยู่"*
>
> **ตอนนี้รันแล้ว** — บันทึกด้านล่างคือผลจากการรันจริงเมื่อ 2026-09-05 ไม่ใช่สิ่งที่คาดว่าจะเกิด

---

## 0. สิ่งที่ staging ชุดนี้ไม่ใช่

อ่านก่อนใช้ตัวเลขใด ๆ จากที่นี่

- **ไม่ใช่หลักฐาน capacity** — รันบนเครื่องพัฒนาเครื่องเดียว MySQL อยู่ใน docker เดียวกัน
  ไม่มี network hop จริง ไม่มี load balancer ไม่มี resource limit แบบ production
  ผลจาก `load-test.js` ที่นี่ใช้ **หา bottleneck** ได้ ใช้ **อ้างว่ารองรับ 1,000 คนไม่ได้**
- **ไม่ใช่ UAT** — ไม่มีคนจริงใช้ ไม่มีข้อมูลจริง
- **ไม่ใช่ข้อมูลที่ mask มาจาก production** — ทุกแถวถูก *สร้าง* จาก list คงที่ในสคริปต์ + PRNG
  ที่ seed ได้ ไม่มี code path ใดเปิด connection ที่สองหรืออ่านจากฐานจริง
- **ห้ามใช้คำนวณ KPI, metric วิจัย หรือ data-quality report** — สัดส่วนต่าง ๆ ตั้งเพื่อให้
  index/query ทำงาน ไม่ใช่แบบจำลองพฤติกรรมผู้ใช้

---

## 1. สิ่งที่ต้องมีก่อน

| อย่าง | ตรวจด้วย |
|---|---|
| docker container `lampang_mysql` (MySQL 8.0) รันอยู่ | `docker ps --format '{{.Names}}'` |
| `backend/.env.test` (มี `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `JWT_SECRET`) | `ls backend/.env.test` |
| Node 24.x | `node -v` |

> `backend/.env` **ไม่มี** ในเครื่องนี้ ทุกคำสั่งด้านล่างจึงชี้ `DOTENV_CONFIG_PATH=.env.test` ให้ชัด
> ถ้าไม่ชี้ สคริปต์จะหยุดด้วย `db_user_missing` ซึ่งถูกต้องแล้ว — มันปฏิเสธที่จะเดา credential

---

## 2. สร้างฐาน staging (ครั้งเดียว)

`lampang_bus_staging` เป็นฐาน**ใหม่แยกต่างหาก** ไม่ใช่สำเนาของอะไร
ไม่แตะ `lampang_bus` (ฐานของนักพัฒนา) และไม่แตะ `lampang_bus_sandbox` (ฐานที่ jest ใช้)
เอาเฉพาะ **โครงสร้าง** มาจาก sandbox เพื่อให้ schema ตรงกับที่ suite ทดสอบอยู่จริง โดยไม่ต้องไล่ migration 46 ไฟล์

```bash
docker exec lampang_mysql sh -c '
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e \
    "CREATE DATABASE IF NOT EXISTS lampang_bus_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --no-data --routines --events \
    --skip-add-drop-table --set-gtid-purged=OFF lampang_bus_sandbox > /tmp/schema.sql
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" lampang_bus_staging < /tmp/schema.sql
'
```

ผลที่ได้จริง: **58 ตาราง** เท่ากับ `lampang_bus_sandbox`

---

## 3. ใส่ข้อมูลสังเคราะห์

```bash
cd backend
# ดูก่อนว่าจะสร้างอะไร ไม่แตะฐานข้อมูล
node scripts/seed-synthetic-staging.js --dry-run --scale 1000

# ลงจริง
DB_NAME=lampang_bus_staging CURRENT_TERM=2568-2 DOTENV_CONFIG_PATH=.env.test \
  node -r dotenv/config scripts/seed-synthetic-staging.js --sandbox --scale 1000
```

`--sandbox` ไม่ใช่คำประดับ — สคริปต์จะปฏิเสธถ้าไม่มีธงนี้หรือ `NODE_ENV=test`
และจะปฏิเสธชื่อฐานที่เป็น `lampang_bus` / `lampang_bus_dev` / `lampang_bus_restore_drill`
ทั้งยังบังคับว่าชื่อฐานต้องมีคำว่า staging/synthetic/sandbox/local/test อยู่ด้วย — ตรวจสองทาง

**ผลจริงจากการรัน 2026-09-05 (scale 1000, 20 วัน, seed 20260904):**

| ตาราง | จำนวนแถว |
|---|---|
| schools | 50 |
| vehicles | 300 |
| students | 1,800 |
| users | 1,387 (ในนี้ 1,000 คือ `loadtest_user_0..999`) |
| daily_status | 36,000 |
| checkin_logs | 64,440 |

`students.id` = 1..1800 ครอบคลุมช่วง 1..100 ที่ `load-test.js` อ้าง จึงไม่เกิด 404 จากช่วง id

### รันซ้ำได้

สคริปต์ **ลบเฉพาะแถวที่พิสูจน์ได้ว่าตัวเองสร้าง** (`SYNAFF%` / `SYNSCH%` / `V-SYN%` / `syn_*`)
แล้วจึง insert ใหม่ ไม่ใช้ `TRUNCATE` และถ้าเจอแถวที่ไม่ใช่ของตัวเองใน students/parents/
vehicles/checkin_logs จะหยุด เว้นแต่สั่ง `--allow-foreign-rows`

---

## 4. ยก backend ขึ้นชี้ที่ staging

```bash
cd backend
DB_NAME=lampang_bus_staging CURRENT_TERM=2568-2 PORT=3000 DOTENV_CONFIG_PATH=.env.test \
  node -r dotenv/config src/index.js
```

ยืนยันว่าชี้ถูกฐานจากบรรทัดแรกของ log:

```
[db] Connected to MySQL at 127.0.0.1:3306/lampang_bus_staging
```

---

## 5. token สำหรับยิง API

**อย่า login** — `loginLimiter` คือ 20 ครั้ง / 15 นาที / IP และ **ไม่มี test skip**
(`auth.routes.js:55-57`) การ login เพื่อเอา token จะกินโควตาของ scenario `login` ใน load test เอง

mint เองแทน โดยชื่อ claim ต้องตรงกับที่ `generateAccessToken()` ใช้ — `sub` `scopeType` `scopeId`
`gradeScope` ไม่ใช่ `id` `scope_type` `scope_id` (ใช้ชื่อผิดแล้วจะได้ 401 `ACCOUNT_DISABLED`
เพราะ middleware หา user จาก `sub` ไม่เจอ)

```bash
cd backend
TOKEN=$(DOTENV_CONFIG_PATH=.env.test node -r dotenv/config -e "
const jwt=require('jsonwebtoken');
process.stdout.write(jwt.sign({
  sub:845, username:'syn_school_001', role:'school',
  scopeType:'SCHOOL', scopeId:'SYNSCH001', gradeScope:null, displayName:'syn school 1'
}, process.env.JWT_SECRET, {expiresIn:'2h', algorithm:'HS256'}));
")
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/school/status-today
```

`845` / `SYNSCH001` มาจากแถวแรกของบัญชีโรงเรียนที่ seed ไว้ — ตรวจด้วย
`SELECT id,username,scope_id FROM lampang_bus_staging.users WHERE role='school' LIMIT 3;`

---

## 6. ลบทิ้ง

```bash
cd backend
DB_NAME=lampang_bus_staging DOTENV_CONFIG_PATH=.env.test \
  node -r dotenv/config scripts/seed-synthetic-staging.js --sandbox --truncate-only
```

หรือทิ้งทั้งฐาน:

```bash
docker exec lampang_mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE lampang_bus_staging;"'
```

---

## 7. สิ่งที่ staging ชุดนี้ยัง seed ไม่ได้

สคริปต์บอกเองตอนจบ ไม่ได้ซ่อนไว้:

- **participation** — ต้องสั่ง `--with-participation` และขอบเขต workflow ยังรอ decision C0-4
  ถ้าไม่ seed scenario `participation_event` ใน load test จะได้ 404 ซึ่งตอนนี้ถูกนับเป็น
  **NOT MEASURED** ไม่ใช่ผ่าน (ดู `tests/loadTestMeasurement.unit.test.js`)
- **consent_records** — รอ D0-5/D0-7 ดังนั้น scenario `parent_status` อาจถูก consent gate ปฏิเสธ

ทั้งสองอย่างนี้คือเหตุผลว่าทำไมรายงาน load test ถึงต้องอ่านคู่กับรายการ
`scenarios_not_measured` เสมอ — จำนวน scenario ที่ "ตอบ" ไม่เท่ากับจำนวนที่ "วัดได้"
