# Phase 9 rehearsal บน local synthetic staging — 5 กันยายน 2569 ค่ำ (ramp / peak / soak + restore drill)

> **local, ไม่เทียบเท่า production, ไม่ใช่หลักฐานว่ารองรับ 1,000 คน** — เครื่องพัฒนาเครื่องเดียว (Windows, RAM 14 GB ว่างไม่ถึง 1 GB ขณะรัน),
> MySQL ใน docker บนเครื่องเดียวกัน, generator กับ target แย่ง CPU กัน, backend รันด้วย `NODE_ENV=test` (global limiter ปิด) และ `FEATURE_PARTICIPATION_CASES=true` เฉพาะ staging
> สิ่งที่รอบนี้พิสูจน์คือ **harness ครบตามที่ Phase 9 ขอ** (scenario mix ตามบทบาท, ค่าฝั่ง server, peak/soak, stop conditions) และ **หา bottleneck** ได้ ตัวเลขใช้อ้าง capacity ไม่ได้
> การรันจริงต้องทำบน Linux staging ที่แยกจาก production (B2-2) ด้วย `NODE_ENV=staging`

ฐาน: harness ที่ `19a74c9` · backend `a0e783e`+ (commit เดียวกับ production ณ วันนั้น) · ฐาน `lampang_bus_staging` (สังเคราะห์: 10 โรงเรียน 360 นักเรียน 60 รถ 66 คนขับ) ตาม `backend/scripts/LOCAL_STAGING.md`

## 1. สิ่งที่ harness ทำได้เพิ่มในรอบนี้ (ข้อ F ของคำสั่ง)

| เดิม (`docs/performance/load-test-local-2026-09-05.md`) | ตอนนี้ (`19a74c9`) |
|---|---|
| token เดียว (school) → วัดได้ 3/9 scenario | `--token-file` หนึ่ง JWT ต่อบทบาท; scenario ประกาศ `role` ของตัวเอง; สิ่งที่วัดไม่ได้ถูกประกาศก่อนยิงพร้อมเหตุผล |
| `school_checkin_override` ยิง student 1..100 ข้ามโรงเรียน → 404 | อ่าน roster ของโรงเรียนเจ้าของ token ครั้งเดียว (36 คน) |
| `driver_gps` 400 ทุกครั้ง (ส่ง `lat/lng`) | ส่ง `latitude/longitude` ตาม route → 200 |
| `participation_event` ยิง case 1..10 | อ่าน case ที่เปิดอยู่ของโรงเรียนจาก API (20 case) |
| ไม่มี stop condition | `--abort-error-rate`, `--abort-p95-ms`, `--abort-rss-mb` (จาก capacity-sample), `--abort-consecutive`, `--watch-interval`; stage ที่ถูกหยุดรายงาน `aborted` และตกเกณฑ์ |
| ไม่มี resource limit | `--max-users` ปฏิเสธแผนที่เกินเพดาน |

ตรวจสอบก่อนรันชุดยาว (ramp 10 users × 8 s, flag participation เปิด): วัดได้ **7 จาก 8 scenario ที่ใช้ JWT** — `login` 200 แล้ว 429 ตาม limiter, `school_dashboard`/`school_students`/`reports_daily` 200, `driver_roster` 200, `driver_gps` 200, `participation_event` 201
ที่ยังวัดไม่ได้: `school_checkin_override` (409 ทุกครั้ง เพราะ staging มี `daily_status` ของวันนี้ครบทุกคนแล้ว = idempotency ของ endpoint ไม่ใช่ harness; วัดได้เมื่อ reset สถานะวันของโรงเรียนสังเคราะห์) และ `parent_status` (LIFF id_token ไม่ใช่ JWT — ไม่มีทางวัดด้วย token file)

## 2. ชุดยาว: ramp → peak → soak (รันต่อเนื่องแบบ detached เริ่ม 22:23 น.)

พารามิเตอร์ร่วม: `--sandbox --token-file (school, driver, admin) --sample-interval 5 --abort-error-rate 0.5 --abort-p95-ms 8000 --abort-rss-mb 1200 --abort-consecutive 2 --watch-interval 10 --max-users 1000`

### 2.1 ramp 50 / 200 / 500 / 1,000 × 60 s — `outputs/load-test/local-ramp-rehearsal-20260905-222325/report.json`

| stage | rps | requests (served) | error rate | p50 / p95 / p99 (ms, เฉพาะที่ served) | loop p99 | pool util / queued max | CPU % ของ process | RSS max | ผลเทียบเกณฑ์ |
|---|---:|---:|---:|---|---:|---|---:|---:|---|
| 50 | 1,784 | 107,259 (21,381) | 0 | 85 / **255** / 307 | 16.7 | 1.0 / **33** | 103 | 210 MB | ผ่านเกณฑ์ read/write (เฉพาะที่วัดได้) |
| 200 | 3,177 | 191,695 (14,637) | 0 | 506 / **1,631** / 1,828 | 19.5 | 1.0 / **164** | 99 | 295 MB | read p95 เกิน 1,000 ms |
| 500 | 3,433 | 210,104 (13,822) | 0 | 1,224 / **4,424** / 4,763 | 31.0 | 1.0 / **426** | 99 | 323 MB | เกินทั้ง read และ write |
| 1,000 | 3,026 | 95,572 (7,753) | 0.04 % (40 transport errors) | 2,424 / **8,018** / 8,783 | 64.3 | 1.0 / 270 | 97 | 341 MB | **stage ถูกหยุดโดย stop condition ที่ 30.1 s** (p95 8,447 ms > 8,000 ms สองหน้าต่างติด) |

ต่อ scenario ที่ 50 / 200 / 500 / 1,000 users (p95 ms): `school_dashboard` 82 / 480 / 1,189 / 2,721 · `school_students` 118 / 699 / 1,716 / 3,724 · `reports_daily` 324 / 2,014 / 4,916 / 9,056 · `driver_roster` 118 / 693 / 1,720 / 3,723 · `driver_gps` 309 / 1,779 / 4,363 / 8,052 · `participation_event` 123 / 527 / 1,244 / 2,794
ไม่ได้วัด: `login` (20 ครั้งแรก 200 แล้ว 429 ตาม limiter — "served" นับเฉพาะ 20 ครั้งนั้น) และ `school_checkin_override` (409 ตามข้อ 1) · `slow_queries` เพิ่ม 0 ทุก stage · คิว LINE 0 · `Threads_connected` สูงสุด 10 = ขนาด pool

**อ่านอย่างไร:** คอขวดเดิม (§2.1 ของบันทึก 5 ก.ย. เช้า) ตอนนี้ **วัดตรง ๆ ได้แล้ว** — pool 10 เส้นอิ่มตัว (utilisation 1.0) ตั้งแต่ 50 users และมีคำขอรอคิวใน mysql2 สูงสุด 33 → 164 → 426 ตาม users; MySQL ไม่มี slow query เลย และ CPU ของ backend อยู่ราว 100% ของ core เดียว (single process) ผลลัพธ์คือ latency โตเชิงเส้นกับจำนวน users ไม่ใช่ error (error rate 0 จนถึง 500) · stop condition ทำงานตามที่ออกแบบที่ 1,000 users แทนที่จะปล่อยให้เครื่องพัฒนาวิ่งต่อ · `supports_1000_user_claim = false` ตามข้อเท็จจริง

### 2.2 peak 50 → 1,000 (120 s) → 50 — `outputs/load-test/local-peak-rehearsal-20260905-222904/report.json`

รอบแรก (22:26) ล้มเพราะ backend staging ที่รันใต้เครื่องมือถูกระบบฆ่าเนื่องจาก RAM ต่ำ (error rate 82% ใน baseline) — ไม่นับ; รอบนี้ backend รันแบบ detached

| stage | users | rps | error rate | p95 / p99 (ms) | pool queued max | RSS max | หมายเหตุ |
|---|---:|---:|---:|---|---:|---:|---|
| baseline | 50 | 1,479 | 0 | 293 / 343 | 33 | 297 MB | |
| peak | 1,000 | 2,392 | 0 | 9,366 / 10,100 | 0* | 352 MB | **หยุดโดย stop condition ที่ 20.1 s** (p95 10,034 ms > 8,000 ms) |
| recovery | 50 | 1,471 | 0 | 297 / 359 | 33 | 360 MB | |

\* ตัวอย่างฝั่ง server ระหว่าง burst 20 วินาทีมีน้อยเกินกว่าจะจับคิว; ค่าจาก ramp-1,000 (§2.1) คือ 270

คำตัดสิน "ฟื้นหลัง peak": p95 หลัง burst = 297 ms เทียบก่อน burst 293 ms (**ratio 1.01** — ระบบฟื้นตัวจริง) แต่รายงานให้ `recovered = false` เพราะกติกาของ harness ต้องให้ stage recovery ผ่านเกณฑ์ทุก scenario ซึ่ง `login` (429 ตาม limiter) และ `school_checkin_override` (409) วัดไม่ได้ — `recovery_threshold_failures` ระบุสองรายการนี้ไว้ชัด ดังนั้น **ระบบฟื้นตัวหลัง peak บนเครื่องนี้ แต่ยังพิสูจน์แบบเป็นทางการไม่ได้จนกว่า scenario ทั้งสองจะวัดได้** (ต้องการ login budget แยกและ reset สถานะวัน)

### 2.3 soak 100 users × 3,600 s — เริ่ม 22:31 น. (ลดจาก 200 users เพราะ RAM ว่างของเครื่องไม่ถึง 500 MB หลัง backend ถูกฆ่าหนึ่งครั้ง)

`outputs/load-test/local-soak-rehearsal-20260905-223127/report.json` — จบครบ 3,600.2 s โดยไม่ถูก stop condition หยุด (`aborted: null`, `phase9_evidence.soak_60min = true`)

| | ค่า |
|---|---|
| requests / served | 7,419,582 / 951,920 (ที่เหลือคือ `login` 429 ตาม limiter และ `school_checkin_override` 400/409) |
| errors | **0** (error rate 0) |
| rps | 2,061 |
| p50 / p95 / p99 / max (ms, เฉพาะ served) | 224 / **707** / 863 / 2,836 |
| event-loop p99 | 22.6 ms |
| pool | utilisation 1.0 ตลอด, queued สูงสุด 77 (saturated) |
| `Slow_queries` เพิ่ม | 0 · `Threads_connected` สูงสุด 10 |
| CPU ของ process | ~97% ของ core เดียว |
| RSS สูงสุด | 359 MB (เท่ากับหลัง peak 360 MB — **ไม่เห็นสัญญาณ memory leak** ใน 60 นาที) · heap สูงสุด 154 MB |
| RAM ว่างของเครื่องต่ำสุด | **74 MB** — เครื่องพัฒนาถึงขีดจำกัด ไม่ใช่ backend |
| คิว LINE | 0 ตลอด (staging ไม่มี line_users) |
| ตัวอย่างฝั่ง server | 680 ตัวอย่าง / 0 ล้มเหลว ตลอดชั่วโมง |

ต่อ scenario (p95 ms): `school_dashboard` 234 · `school_students` 341 · `driver_roster` 341 · `driver_gps` 843 · `participation_event` 285 (เขียน event 204,127 แถวลง staging — ลบออกหลังรัน) · `reports_daily` 922 · ไม่ได้วัด: `login` (80 served / 6.3M × 429), `school_checkin_override` (409 idempotency + 400 บางส่วน)

**อ่านอย่างไร:** ที่ 100 users ระบบเสถียรตลอดชั่วโมง (0 error, p95 คงที่ใต้ 1 s ทั้ง read/write, RSS ไม่โต) โดยมี pool 10 เส้นเป็นตัวจำกัด throughput ตลอด — ยืนยันข้อสรุปของ ramp ว่าคอขวดคือ pool/single process ไม่ใช่ query · ตัวเลขนี้ยังเป็นของเครื่องพัฒนา (`NODE_ENV=test`, MySQL ในเครื่องเดียวกัน, RAM ว่างเหลือ 74 MB) จึงใช้บอกได้แค่ว่า **ไม่มี leak และไม่มี error สะสมภายใต้ภาระคงที่** ใช้อ้าง capacity ไม่ได้

## 3. Restore drill แบบแยก (ข้อ G) — ซ้อมกลไก ไม่ใช่ drill จริง

`scripts/restore-drill-db.sh` เดิมฮาร์ดโค้ด path ของ server จึงซ้อมนอก server ไม่ได้ ตอนนี้ `APP_DIR` / `BACKUP_DIR` / `ENV_FILE` override ได้ (ค่าตั้งต้นเดิม) และไฟล์เป็น LF
(CR หลัง `set -euo pipefail` ทำให้ bash ในคอนเทนเนอร์ปฏิเสธ `pipefail\r` — เจอตอนซ้อมครั้งแรก)

ซ้อมในคอนเทนเนอร์ `lampang_mysql` ด้วย **dump สังเคราะห์** ของ `lampang_bus_staging` (ไม่มีข้อมูลเด็กจริง) → `lampang_bus_restore_drill`:

| ขั้น | ผล |
|---|---|
| dump + sha256 sidecar | `lampang_bus_20260905_222156.sql.gz` 455,624 bytes |
| ตรวจก่อน restore | sha256 OK · gzip OK |
| restore | 7 s · 61 ตาราง (เท่าต้นทาง) |
| นับแถวตารางหลัก | users 289/289 · schools 10/10 · students 360/360 · vehicles 60/60 · parents 360/360 · checkin_logs 6,500/6,500 · daily_status 3,600/3,600 ตรงทุกตาราง |
| เก็บกวาด | `CLEAN_RESTORE_DRILL=1` drop ฐาน drill; ฐานที่เหลือในคอนเทนเนอร์ยังเป็น 4 ฐานเดิม |

สิ่งที่รอบนี้**ไม่**พิสูจน์: การ restore backup จริงของ production (ข้อมูลจริง ขนาดจริง เวลาจริง) ซึ่งเป็น operator action ที่ต้องมี approval ตาม `PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md` ขั้น 3 — `outputs/restore-drill` ยังว่างและต้องว่างต่อไปจนกว่าจะทำจริง

## 4. Automated UAT บน staging (ข้อ G)

`backend/scripts/seed-production-uat-users.js` ชี้ `SCHOOLBUS_UAT_DB_NAME=lampang_bus_staging` (ไม่แตะ production) แล้ว `run-uat-live-check.js` ต่อ backend staging:
`outputs/uat-live-check/20260905-215608` — **pass=28 fail=0** (7 บัญชี Test* × login + 3 route อ่านต่อบทบาท) · เป็น smoke อัตโนมัติ ไม่ใช่ UAT โดยผู้ใช้จริง — `outputs/uat-evidence` ยังว่างตามจริง

## 5. สิ่งที่ยังอ้างไม่ได้ และต้องทำต่อ

- **ห้ามอ้างว่ารองรับ 1,000 คน** — ทุกตัวเลขในเอกสารนี้มาจากเครื่องพัฒนา; `supports_1000_user_claim` ในรายงานเป็น false ตามข้อเท็จจริง (scenario ที่วัดไม่ได้ + ข้อจำกัดข้างต้น)
- **ห้ามเพิ่ม `connectionLimit` จากผลนี้อย่างเดียว** — pool 10 เส้นอิ่มตัว (queued > 0) ตั้งแต่ 20–50 users บนเครื่องนี้ แต่ค่าที่ควรใช้ต้องดู `max_connections`/RAM ของ server production (151 / 2 GB ตาม capacity-sample) ร่วมกับ B2-2
- รันจริงบน Linux staging (B2-2) ด้วย `NODE_ENV=staging`, token ครบบทบาท (transport/affiliation/province เพิ่มได้จาก seed เดิม), และ reset สถานะวันก่อนวัด `school_checkin_override`
- `parent_status` ต้องมี LINE id_token ปลอมสำหรับ LIFF หรือ test channel (B2-1)
