# Load test บน local staging — 2026-09-05 (task A1-8)

> **local, ไม่เทียบเท่า production** — ป้ายนี้เป็นข้อบังคับของ A1-8 ไม่ใช่คำถ่อมตัว
> รันบนเครื่องพัฒนาเครื่องเดียว MySQL อยู่ใน docker เดียวกัน ไม่มี network hop จริง
> ไม่มี resource limit แบบ production ตัวเลขในเอกสารนี้ใช้ **หา bottleneck** ได้
> ใช้ **อ้าง capacity ไม่ได้**
>
> รายงานดิบ: `outputs/load-test/local-20260905-084749/report.json` (อยู่ใต้ `/outputs/` ซึ่ง gitignore)
> คำสั่ง: `node scripts/load-test.js --target http://127.0.0.1:3000 --sandbox --users 50,200,500,1000 --duration 60 --token <school token> --out …`
> ฐาน: `lampang_bus_staging` ตาม `backend/scripts/LOCAL_STAGING.md` (50 โรงเรียน, 1,800 นักเรียน, 64,440 checkin_logs)

`supports_1000_user_claim = false` — ถูกต้อง และเอกสารนี้อธิบายว่าทำไม

---

## 1. สิ่งที่วัดได้จริง — 3 จาก 9 scenario

นี่คือผลของการแก้ที่ commit `cb3f4a2` ก่อนหน้ารอบนี้ ถ้าไม่แก้ 404/403/401 ทั้งหมดจะถูกนับว่า
`ok` แล้วรายงานจะออกมาเป็น "errors=0, p95 สวยงาม" ทั้งที่ 6 ใน 9 scenario ไม่เคยทำงานเลย

| users | school_dashboard | school_students | reports_daily |
|---:|---:|---:|---:|
| 50 | 90 ms | 125 ms | 337 ms |
| 200 | 422 ms | 599 ms | **1,681 ms** |
| 500 | 895 ms | **1,275 ms** | **3,653 ms** |
| 1,000 | **1,725 ms** | **2,382 ms** | **6,021 ms** |

(p95 · เกณฑ์ read คือ 1,000 ms · ตัวหนา = เกิน)

throughput รวม: 2,549 → 4,547 → 4,275 → 3,527 rps
event-loop delay p99: 19.6 → 25.7 → 66.5 → 83.8 ms

**อ่านอย่างไร:** throughput ขึ้นสูงสุดที่ราว 200 users แล้ว *ลดลง* ขณะที่ p95 โตแบบเชิงเส้นกว่า
นั่นคือรูปของคิว ไม่ใช่รูปของ CPU อิ่มตัว — งานเข้ามาเร็วกว่าที่ระบายออกได้ แล้วไปรอที่คอขวดร่วม

---

## 2. คอขวดที่ระบุได้ (สิ่งที่ A1-8 ขอ: รายการ index/pool/cache ที่ต้องปรับ)

### 2.1 pool ขนาด 10 — คอขวดเชิงโครงสร้างที่ชัดที่สุด

`backend/src/config/database.js:27` — `connectionLimit: 10`, `queueLimit: 0` (คิวไม่จำกัด)

1,000 virtual user แบ่งกันใช้ connection 10 เส้น คำขอที่เหลือไปต่อคิวใน mysql2 ไม่ใช่ที่ MySQL
รูปของกราฟข้างบนตรงกับสมมติฐานนี้ และ `queueLimit: 0` แปลว่าคิวยาวได้ไม่จำกัด —
ระบบจะช้าลงเรื่อย ๆ แทนที่จะปฏิเสธคำขอ ซึ่งภายใต้ภาระจริงคือการสะสม latency ไม่ใช่การป้องกันตัว

**ยังไม่ได้ทดลอง** ว่าเพิ่ม pool แล้วดีขึ้นเท่าไร — ต้องดู `max_connections` ของ MySQL ฝั่ง
production ด้วย การเพิ่ม pool โดยไม่ดูฝั่งเซิร์ฟเวอร์คือการย้ายคิวจาก app ไป DB เฉย ๆ

### 2.2 `reports_daily` — ตัวที่แย่ที่สุด และ **ไม่ใช่ปัญหา index**

เกินเกณฑ์ตั้งแต่ 200 users และที่ 1,000 users อยู่ที่ 6× ของเพดาน

หลักฐานชี้ชัดว่าไม่ใช่ปัญหา query:

| การวัด | ค่า |
|---|---|
| เวลาต่อคำขอเมื่อ **ไม่มีภาระ** (curl 5 ครั้ง) | 13.5–16.6 ms |
| p95 ที่ 1,000 users | 6,021 ms |
| อัตราส่วน | **~430 เท่า** |

query เร็วอยู่แล้ว สิ่งที่ช้าคือการรอคิว `EXPLAIN` บน staging (36,000 daily_status,
64,440 checkin_logs) ยืนยันว่าทุก join ใช้ index อยู่แล้วสำหรับ scope ระดับโรงเรียน:

- per-vehicle breakdown: `s2` ใช้ `uk_school_student_code` (36 แถว), `ds` เป็น `eq_ref`
  ผ่าน `uk_ds_date_student`, `v` เป็น `eq_ref` PRIMARY — `Using temporary; Using filesort`
  มีจริงจาก `GROUP BY … ORDER BY v.plate_no` แต่บน 36 แถวไม่มีความหมาย
- emergency count: `el` ใช้ `idx_emergency_logs_is_deleted`

สิ่งที่เป็นต้นเหตุจริงคือ **จำนวน round-trip ต่อคำขอ**: `getDailyReport()`
(`report.service.js:73-171`) มี `await pool.query` **8 ตัวเรียงกัน ไม่มี `Promise.all` เลย**
แต่ละตัวหยิบ connection จาก pool ที่มี 10 เส้น ทำ round trip แล้วคืน ภายใต้ผู้ใช้พร้อมกันจำนวนมาก
เวลาที่เพิ่มขึ้นคือ 8 × เวลารอคิว ไม่ใช่ 8 × เวลา query

**ข้อควรระวังเมื่อจะแก้:** เปลี่ยน 8 ตัวนั้นเป็น `Promise.all` เฉย ๆ จะ *แย่ลง* ภายใต้ภาระ
เพราะหนึ่งคำขอจะยึด 8 ใน 10 connection พร้อมกัน ทางที่ควรวัดตามลำดับ
(**ยังไม่ได้ทำ** — เป็นข้อเสนอ ไม่ใช่ผล):
1. ยุบ aggregate ที่เป็นอิสระต่อกันให้เหลือ query น้อยลง (morning/evening count, total vehicles,
   emergency count อ่านจากชุดข้อมูลเดียวกันเป็นส่วนใหญ่)
2. ปรับ `connectionLimit` พร้อมกัน แล้ววัดซ้ำ — สองอย่างนี้ต้องแก้คู่กัน วัดทีละอย่างจะสรุปผิด
3. cache ระดับ (date, scope) อายุสั้น — รายงานของเมื่อวานไม่เปลี่ยนอีกแล้ว

หมายเหตุที่พบระหว่างทางแต่ **ไม่ใช่คอขวดในรอบนี้**: `report.service.js:118` ใช้
`WHERE DATE(el.reported_at) = ?` การครอบคอลัมน์ด้วย `DATE()` ทำให้ index บน `reported_at`
ใช้ไม่ได้ ตอนนี้ไม่เจ็บเพราะ `emergency_logs` เล็กและมี `idx_emergency_logs_is_deleted` ช่วย
แต่จะเจ็บเมื่อตารางโต — เขียนเป็น `reported_at >= ? AND reported_at < ? + INTERVAL 1 DAY` แทนได้

### 2.3 `parentLimiter` — 60 คำขอ/นาที **ต่อ IP** สำหรับผู้ปกครองทุกคนรวมกัน

`backend/src/routes/parent.routes.js:31-38` — `windowMs: 60_000, max: 60` และ
**ไม่มี `skip` สำหรับ test** ต่างจาก limiter อื่นเกือบทุกตัวในระบบ

ในรอบนี้ scenario `parent_status` ได้ 401 ไป 60 ครั้ง แล้วเป็น 429 ล้วน 36,545 ครั้ง —
คือ budget หมดภายในนาทีแรก

**ประเด็นที่ใหญ่กว่าการทดสอบ:** ผู้ปกครองเข้าใช้ผ่าน LIFF บนมือถือ ผู้ใช้เครือข่ายมือถือ
เดียวกันหรือ wifi โรงเรียนเดียวกันจะออกอินเทอร์เน็ตด้วย IP เดียวกัน (CGNAT) เพดาน 60/นาที
จึงเป็นเพดานของ **ทั้งเครือข่าย** ไม่ใช่ของคนเดียว ตอนเช้าเวลา 07:00 ที่ผู้ปกครองหลายร้อยคน
เปิดดูพร้อมกันจะชนเพดานนี้และเห็น "Too many requests"

`docs/project-closure/execution-plan-to-completion-2026-09-04.md:319,326` บันทึกเรื่อง
`loginLimiter` ต่อ IP ไว้แล้ว แต่ **ยังไม่มีที่ใดบันทึก `parentLimiter`** — ข้อนี้ควรเข้า
residual-risk register การแก้ (คีย์ตาม LINE user id แทน IP หรือยกเพดาน) เป็นการตัดสินใจ
เชิงเทคนิคที่ต้องคู่กับข้อมูลจำนวนผู้ปกครองจริงต่อโรงเรียน จึงยังไม่แก้ในรอบนี้

---

## 3. 6 scenario ที่วัดไม่ได้ — แยกว่าเป็นบั๊กระบบ / บั๊ก harness / ผลของ NODE_ENV

| scenario | ผลจริง | เป็นอะไร |
|---|---|---|
| `login` | 20× 200 แล้ว 429 ล้วน (42,818 ครั้งที่ stage แรก) | **ตามการออกแบบ** `loginLimiter` 20 ครั้ง/15 นาที/IP ไม่มี test skip แผน §13.1 บอกไว้ล่วงหน้าแล้วว่าจะเป็นแบบนี้ ห้ามปิด limiter เพื่อให้ตัวเลขสวย |
| `school_checkin_override` | 404 (5,123) + 409 (50) | **บั๊ก harness** ไม่ใช่บั๊กระบบ — `load-test.js:247` ใช้ `studentId = 1 + (i % 100)` แต่ seeder กระจายนักเรียนไปทั่ว 50 โรงเรียน token ของโรงเรียนเดียวจึงแตะได้เฉพาะของตัวเอง พิสูจน์แล้วทีละคน: student 1 และ 51 (SYNSCH001) → 409, student 2 และ 3 (SYNSCH002/003) → 404 |
| `driver_roster` | 403 ล้วน | **ตามการออกแบบ** ใช้ token บทบาท school |
| `driver_gps` | 403 ล้วน | **ตามการออกแบบ** เหตุผลเดียวกัน |
| `participation_event` | 404 ล้วน | **ตามการออกแบบ** `app.js:196-197` mount `/api/participation` เฉพาะเมื่อ `FEATURE_PARTICIPATION_CASES` เปิด ซึ่งปิดอยู่และรอ decision C0-4 |
| `parent_status` | 60× 401 แล้ว 429 ล้วน | **ตามการออกแบบ + ข้อ 2.3** LIFF ยืนยันด้วย LINE id_token ไม่ใช่ JWT จึง 401 แล้วชน `parentLimiter` |

**ไม่มีข้อใดในหกข้อนี้เป็นบั๊กของระบบ** — และการที่ 404 กับ 403 เหล่านี้ปรากฏเป็น
`NOT MEASURED` แทนที่จะเป็น `ok` คือความต่างทั้งหมดระหว่างรายงานฉบับนี้กับรายงานที่จะบอกว่า
"errors=0, ผ่านทุกเกณฑ์"

### ผลข้างเคียงที่ยืนยัน scope โดยบังเอิญ

`school_checkin_override` ยิงข้ามโรงเรียนไปราว 5,100 ครั้งใน stage สุดท้าย และได้ **404 ทุกครั้ง**
ไม่ใช่ 403 — คือระบบไม่ยอมแม้แต่จะบอกว่านักเรียนคนนั้นมีอยู่ ตรงกับที่ A1-11 §4 ต้องการ
และเป็นการยืนยันภายใต้ concurrency ที่ integration test เดี่ยว ๆ ให้ไม่ได้

---

## 4. สิ่งที่ทำให้ตัวเลขชุดนี้ไม่ใช่ production

### 4.1 `NODE_ENV=test` ปิด global API limiter

`backend/src/app.js:116-127` — `globalApiLimiter` คือ 120 คำขอ/นาที/IP บน prefix
`/api/school`, `/api/driver`, `/api/affiliation`, `/api/province`, … และมี
`skip: () => process.env.NODE_ENV === 'test'` (`:120`)

backend ที่ใช้รันรอบนี้ขึ้นด้วย `.env.test` จึงเป็น `Environment: test` แปลว่า
**สาม scenario ที่วัดได้ วิ่งโดยไม่มี rate limit ของ production เลย**

ผลสองทาง ต้องเข้าใจทั้งคู่:
- ตัวเลข p95 ที่ได้เป็นสัญญาณ capacity ของ server/DB ล้วน ไม่ถูก limiter บัง — ซึ่งเป็นสิ่งที่
  ต้องการสำหรับการหาคอขวด
- แต่มัน **ไม่ใช่** การจำลองภาระจริง เพราะใน production คำขอส่วนใหญ่จะถูก 429 ที่ 120/นาที/IP
  ก่อนจะไปถึงจุดที่ p95 พุ่งแบบนี้ ตัวเลขจึงตอบว่า "ถ้าไม่มี limiter ระบบพังตรงไหน"
  ไม่ได้ตอบว่า "ผู้ใช้จริงจะเจออะไร"

การรันซ้ำด้วย `NODE_ENV=staging` จะได้ตัวเลขอีกชุดที่ตอบคำถามที่สอง — **ยังไม่ได้ทำ**

### 4.2 ข้อจำกัดอื่นที่ยังอยู่

- generator กับ target อยู่บนเครื่องเดียวกัน แย่ง CPU กัน
- MySQL อยู่ใน docker บนเครื่องเดียวกัน ไม่มี network latency จริง
- token เดียว บทบาทเดียว จึงวัดได้เฉพาะ 60% ของ mix ตามน้ำหนักที่ประกาศไว้
- ข้อมูลเป็น synthetic การกระจายตัวตั้งเพื่อให้ index ทำงาน ไม่ใช่แบบจำลองพฤติกรรมจริง

---

## 5. สิ่งที่ต้องทำต่อ

| # | งาน | ติดอะไร |
|---|---|---|
| 1 | ~~`EXPLAIN` query ของ `/api/reports/daily`~~ **ทำแล้ว** — ทุก join ใช้ index อยู่แล้ว ไม่มี index ที่ขาด ดูข้อ 2.2 | เสร็จ |
| 2 | ทดลองเพิ่ม `connectionLimit` แล้ววัดซ้ำ พร้อมดู `max_connections` ฝั่ง MySQL | ไม่ติด แต่ค่าที่จะใช้จริงต้องรู้สเปกเซิร์ฟเวอร์ production (B2-2) |
| 3 | รันซ้ำด้วย `NODE_ENV=staging` เพื่อวัดภายใต้ global limiter | ไม่ติด |
| 4 | ทำให้ `school_checkin_override` วัดได้ — ต้องจับคู่ token กับโรงเรียนของนักเรียน | ไม่ติด (เป็นงาน harness) |
| 5 | บันทึก `parentLimiter` ต่อ IP ลง residual-risk register | ไม่ติด |
| 6 | วัด `participation_event` | **ติด C0-4** (flag ปิด และ decision อาจยกเลิก feature ทั้งก้อน) |
| 7 | วัด `driver_*` และ `parent_status` | ต้องรองรับหลาย token ต่อรอบ + LINE id_token ปลอมสำหรับ LIFF |
| 8 | load test บน staging จริง | **ติด B2-2** |

### 5.1 สิ่งที่ harness ทำได้เพิ่มตั้งแต่ 5 ก.ย. 2569 (handoff §2 ข้อ 6, 7)

ตอนที่เขียนเอกสารนี้ `load-test.js` มีแต่ ramp 4×60 วิ และเก็บได้แต่ค่าฝั่ง client ตอนนี้:

- **profile `peak`** (baseline → burst → recovery) พร้อมคำตัดสิน `recovery.recovered` ตามกฎ
  "recovery stage อยู่ในเกณฑ์ และ p95 ≤ 1.5 × baseline" และ **profile `soak`** ที่ปฏิเสธ `--duration < 3600`
  (`--allow-short-soak` = ซ้อม รายงานจะระบุ `short_soak: true` และไม่นับเป็น soak)
- **ค่าฝั่ง server ทั้ง 4 กลุ่มที่ Phase 9 ขอ** ผ่าน `--admin-token` ซึ่งทำให้ทุก stage poll
  `GET /api/admin/operations/capacity-sample` (ใหม่, admin-only, ไม่มี PII): DB pool utilisation/queued,
  `Slow_queries` delta, CPU/RSS ของ process + load/swap ของ host (Linux), และคิว LINE จาก `notifications`
- `phase9_evidence.missing_for_phase9` ในทุกรายงาน บอกว่ายังขาด run แบบไหนก่อนจะอ้าง Phase 9 ได้

วิธีใช้อยู่ใน `backend/scripts/LOCAL_STAGING.md` §5.1

**ซ้อมบนเครื่องนี้ (ไม่ใช่ผล Phase 9 — 5 และ 20 users, stage ละ 6–10 วินาที):**
`outputs/load-test/local-peak-rehearsal-20260905-152242/report.json` และ `local-soak-rehearsal-20260905-152417/report.json`

| stage | users | p95 | pool utilisation max | pool queued max | CPU % ของ process (1 core) | slow_queries Δ | คิว LINE |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 5 | 30 ms | 0.4 | 0 | 179 | 0 | 0 |
| peak | 20 | 87 ms | **1.0** | **1** | 125 | 0 | 0 |
| recovery | 5 | 26 ms | 0.4 | 0 | 94 | 0 | 0 |

สองข้อสังเกตที่การวัดฝั่ง server ให้เพิ่มจากที่ §2.1 เคย *อนุมาน* จากรูปกราฟ:

1. pool 10 เส้น **อิ่มตัวจริงตั้งแต่ 20 users** (utilisation 1.0 และมีคำขอรอคิวใน mysql2) — เป็นการยืนยันสมมติฐาน §2.1 ด้วยตัวเลขตรง ๆ ไม่ใช่จากรูปของ p95
2. ratio ฟื้นตัว = 0.87 (p95 หลัง peak ต่ำกว่าก่อน peak) แต่รายงานตัดสิน **NOT RECOVERED** เพราะ stage recovery มี scenario
   ที่ "วัดไม่ได้" (`login` 429, `school_checkin_override` 404 — ข้อ 3 ของเอกสารนี้) จึงตกเกณฑ์ตามกติกาเดิมของ harness
   `recovery_threshold_failures` ในรายงานแยกกรณีนี้ออกจาก "ช้าหลัง peak" ให้แล้ว การจะได้คำตัดสิน recovered ต้องแก้ข้อ 4 และ 7 ของตารางข้างบนก่อน

ค่า swap และ load average เป็น `null` เพราะ backend รันบน Windows (`swap_note` บอกไว้ในรายงาน) — สองค่านี้จะได้เมื่อรันบน Linux staging (ข้อ 8)
