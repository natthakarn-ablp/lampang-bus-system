# ผลรัน load test บน local staging — 5 กันยายน 2569 (A1-8)

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **ผลรันบน local เพื่อหา bottleneck ก่อนมี staging จริง — ไม่ใช่หลักฐานปิด Phase 9 capacity gate และใช้อ้าง "รองรับ 1,000 concurrent users" ไม่ได้**

อ้างอิง: `execution-plan-to-completion-2026-09-04.md` §13 แถว A1-8 และ **§13.1 ข้อจำกัดของการวัด** ซึ่งต้องอ่านก่อนตีความตัวเลขในเอกสารนี้

---

## 1. สิ่งที่รัน

| รายการ | ค่า |
|---|---|
| คำสั่ง | `node backend/scripts/load-test.js --target http://127.0.0.1:3000 --sandbox --users 50,200,500,1000 --duration 60` |
| Commit ที่วัด | `6aabf2d` (หลังปิด CS5-01/CS5-02/CS5-04 แล้ว — ยืนยันจาก `/health.data.commit`) |
| ฐานข้อมูล | `lampang_bus_sandbox` — synthetic 10 โรงเรียน / 360 นักเรียน / 281 users |
| Environment | โน้ตบุ๊ก Windows เครื่องเดียว: backend, MySQL 8 (docker) และ load generator อยู่บนเครื่องเดียวกัน |
| ผลดิบ | `outputs/load-test/local-20260905-010309/report.json` (ignored ไม่อยู่ใน git) |
| `supports_1000_user_claim` | **`false`** — script ตัดสินเองและถูกต้อง |

## 2. ผลต่อ stage

7 scenario ที่วัดได้ (`school_dashboard`, `school_students`, `school_checkin_override`, `reports_daily`, `driver_roster`, `driver_gps`, `participation_event`) มี **error = 0 ทุก stage**

| users | throughput (rps) | p95 | p99 | event-loop lag p99 | error ของ 7 scenario |
|---:|---:|---:|---:|---:|---:|
| 50 | 5,829 | 17 ms | 20 ms | 26.95 ms | 0 |
| 200 | 5,615 | 48 ms | 68 ms | 42.86 ms | 0 |
| 500 | 5,172 | 120 ms | 156 ms | 45.88 ms | 0 |
| 1,000 | 4,941 | 248 ms | 312 ms | 47.58 ms | 0 |

เกณฑ์เริ่มต้นของ master plan Phase 9 คือ read p95 ≤ 1 วินาที และ write p95 ≤ 2 วินาที ตัวเลขข้างบนอยู่ใต้เกณฑ์ทั้งหมด **บน environment นี้** ซึ่งไม่ใช่เกณฑ์ที่ใช้ปิด gate ได้ (ดู §4)

## 3. 2 scenario ที่ไม่ได้วัด

| scenario | error rate | สาเหตุ | ตีความอย่างไร |
|---|---:|---|---|
| `login` | 100.0% ทุก stage | `loginLimiter` (`backend/src/routes/auth.routes.js:55-57`) = 20 ครั้ง/15 นาที/IP และไม่มี test skip · generator ยิงจาก IP เดียว | **ไม่ได้วัด** — ไม่ใช่ capacity ไม่ผ่าน |
| `parent_status` | 99.8% ทุก stage | consent gate ปฏิเสธเพราะ sandbox ไม่มี `consent_records` ซึ่งรอ D0-5/D0-7 | **ไม่ได้วัด** — ไม่ใช่ capacity ไม่ผ่าน |

**ห้ามนำ error rate รวม (ประมาณ 22% ทุก stage) ไปใช้** ตัวเลขนั้นเป็นผลของสองข้อข้างบนล้วน ๆ ตามกติกาใน §13.1 ของ execution plan

## 4. ทำไมผลนี้ปิด Phase 9 ไม่ได้

1. **Environment ไม่เทียบเท่า production** — backend, ฐานข้อมูลและ generator อยู่บนเครื่องเดียวกัน ไม่มี network hop จริง ไม่มี latency ของ VPS และ CPU/RAM/disk คนละชั้นกับเซิร์ฟเวอร์จริง โปรไฟล์คอขวดจึงคนละแบบโดยสิ้นเชิง
2. **ข้อมูลเป็น synthetic ขนาดเล็ก** — 360 นักเรียน ไม่ใช่ปริมาณระดับจังหวัด ผลของ index และ query plan ที่ scale จริงยังไม่ถูกทดสอบ
3. **ไม่มี soak** — รัน stage ละ 60 วินาที ไม่ใช่ 60 นาทีตามที่ master plan Phase 9 กำหนด จึงไม่เห็น memory leak, connection leak หรือการเสื่อมของ pool
4. **ไม่ได้วัด LINE queue** — scenario ที่ยิง LINE ไม่ได้อยู่ในชุดนี้
5. **2 ใน 9 scenario ไม่ได้วัดเลย** ตาม §3

## 5. สิ่งที่ผลนี้ใช้ได้จริง

- เป็น **baseline สำหรับหา regression** — ถ้ารันซ้ำบน commit ถัดไปแล้ว p95 ที่ 1,000 users กระโดดจาก 248 ms อย่างมีนัยสำคัญ แปลว่ามีอะไรถอยหลัง
- ยืนยันว่า **ไม่มี error ใน 7 scenario ที่วัดได้** แม้ที่ 1,000 users บน environment นี้ จึงยังไม่พบคอขวดที่ระดับ application logic
- event-loop lag p99 ขยับจาก 26.95 เป็น 47.58 ms เมื่อ users เพิ่ม 20 เท่า — ยังไม่ใช่สัญญาณอิ่มตัว
- **การแก้ CS5-04 (READ COMMITTED) ไม่ทำให้ throughput ตกอย่างมีนัยสำคัญ** ที่ระดับนี้ — แต่ยังไม่ได้เทียบกับ commit ก่อนแก้อย่างเป็นระบบ จึงพูดได้แค่ว่าไม่เห็นการถดถอยชัดเจน

## 6. สิ่งที่ต้องทำก่อนอ้าง capacity

ตาม master plan Phase 9 และ execution plan B3-1:

- [ ] staging ใกล้ production (VPS ขนาดเดียวกัน) — รอ B2-2 และงบประมาณ
- [ ] ข้อมูล masked/synthetic ระดับที่ใช้จริง
- [ ] ramp + peak + **soak อย่างน้อย 60 นาที**
- [ ] แก้ปัญหาการวัด `login` — กระจาย generator หลาย IP หรือประกาศว่าไม่ได้วัด login throughput (ห้ามปิด limiter เพื่อให้ตัวเลขสวย เพราะจะเป็นการวัดระบบที่ไม่ใช่ระบบที่ deploy)
- [ ] seed `consent_records` หลัง D0-5/D0-7 ตอบ จึงจะวัด `parent_status` ได้
- [ ] เก็บ DB pool / slow query / CPU / RAM / swap / LINE queue ซึ่งชุดนี้ยังไม่ได้เก็บ
- [ ] Technical owner + Operator ลงนามรายงาน capacity

จนกว่าจะครบรายการข้างบน สถานะของ Phase 9 คือ **ยังพิสูจน์ไม่ได้** และคำกล่าว "รองรับ 1,000 concurrent users" ยังใช้ไม่ได้
