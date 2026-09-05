# ข้อเสนอ DDL — ย้าย in-memory state ที่กันการโจมตีและกันงานซ้ำไปเก็บใน DB (A1-9)

สถานะเอกสาร (แก้ 2026-09-05): **ตารางที่ 1, 2, 4 apply แล้ว** ผ่าน
`backend/migrations/051_shared_security_state.sql` (มี rollback) เจ้าของโครงการอนุมัติเมื่อ
2026-09-05 · **ตารางที่ 3 (`line_link_sessions`) ยังไม่ apply** เพราะเก็บเบอร์โทรแบบอ่านได้
ซึ่งเอกสารฉบับนี้เองระบุว่าต้องรอ DPO ตัดสินใน D0-8 ก่อน — คำตอบนั้นยังไม่มี
จึงปล่อย `linkingState` ไว้ในหน่วยความจำตามเดิม

apply แล้วเฉพาะฐานที่ทิ้งได้: `lampang_bus_test`, `lampang_bus_sandbox`,
`lampang_bus_staging` — **ไม่ได้แตะ `lampang_bus`** (ยืนยันด้วยการนับตารางใน
information_schema = 0) และไม่ได้แตะ production

ผู้อนุมัติที่ยังต้องการสำหรับการ apply บน production: Operator (หน้าต่างเวลา migration, C0-8)
อ้างอิง: `execution-plan-to-completion-2026-09-04.md` §13 แถว A1-9 · `docs/security/residual-risk-register.md` RR-08 · `docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md` หัวข้อ "Single-instance caveat"

---

## 1. ทำไมถึงเป็นข้อเสนอก่อน แล้วจึงทำ

A1-9 ระบุผลลัพธ์ว่า "ย้าย in-memory state ไป DB หรือ Redis" ซึ่งต้องสร้างตารางใหม่ กติกาของงานตอนที่เขียนเอกสารนี้คือ **ห้ามเพิ่ม migration หรือแก้ schema เอง ให้เขียนเป็นข้อเสนอพร้อม DDL แทน** เอกสารนี้จึงเป็นส่วนที่ทำได้ในตอนนั้น

RR-08 บันทึกความเสี่ยงไว้แล้ว แต่ยังไม่มีรูปตารางที่ตัดสินใจได้ เอกสารนี้เติมส่วนนั้น

**สิ่งที่ทำไปแล้วหลังได้รับอนุมัติ (2026-09-05):**

| ตาราง | สถานะ | โค้ดที่เปลี่ยน |
|---|---|---|
| `login_lockouts` | apply แล้ว (051) | `src/utils/sharedSecurityState.js` · `auth.routes.js` ไม่มี `LOGIN_FAILS` แล้ว |
| `line_webhook_events_seen` | apply แล้ว (051) | `src/utils/sharedSecurityState.js` · `line.routes.js` ไม่มี `SEEN_EVENTS` แล้ว |
| `line_link_sessions` | **ไม่ apply** | ไม่เปลี่ยน — รอ D0-8 |
| `line_bind_lockouts` | apply แล้ว (051) | `src/services/lineBindGuard.js` เขียนใหม่ทั้งไฟล์ |

ทุกหน้าต่างเวลาตัดสินด้วย `NOW()` ของฐานข้อมูล ไม่ใช่นาฬิกาของเครื่อง app — ถ้าแต่ละ instance
ใช้นาฬิกาตัวเอง สอง instance ที่เวลาต่างกันหนึ่งนาทีจะเห็นแถวเดียวกันคนละสถานะ ซึ่งทำลาย
เหตุผลทั้งหมดของการย้ายมาไว้ที่นี่ ผลข้างเคียงคือ seam `__setClock` เดิมของ `lineBindGuard`
ใช้ไม่ได้อีก (นาฬิกาปลอมในโปรเซสนี้ขยับการเปรียบเทียบที่เกิดใน MySQL ไม่ได้) จึงเปลี่ยนเป็น
`__advance()` ที่ทำสิ่งเดียวกันอย่างตรงไปตรงมาคือเลื่อนอายุของแถว

**สิ่งที่แก้เพิ่มระหว่างทาง:** คีย์ของ lockout เดิมคือ `` `${username}|${ip}` `` ซึ่งทำให้
`('a|b', 'c')` กับ `('a', 'b|c')` เป็นคีย์เดียวกัน ตอนนี้เข้ารหัสสองส่วนด้วย JSON ก่อน hash
เข้าถึงไม่ได้จริงเพราะ `req.ip` มี `|` ไม่ได้ จึงไม่ใช่ regression ที่แก้ แต่ไม่ควรพาความกำกวมนี้
เข้าไปอยู่ในตารางที่ของอื่นจะมา key ต่อ

## 2. สถานะที่อยู่ในหน่วยความจำจริง ๆ (ตรวจจากโค้ด ไม่ใช่จากรายการเดิม)

| # | ตัวแปร | ตำแหน่ง | เก็บอะไร | ถ้ามีหลาย instance จะเป็นอย่างไร |
|---|---|---|---|---|
| 1 | `LOGIN_FAILS` | `backend/src/routes/auth.routes.js:36` | นับ login ล้มเหลวต่อ (username+IP) เกณฑ์ 10 ครั้ง/15 นาที | **เพดานคูณจำนวน instance** — ผู้โจมตีที่กระจาย request ได้ 10×N ครั้งก่อนถูกล็อก |
| 2 | `SEEN_EVENTS` | `backend/src/routes/line.routes.js:50` | `webhookEventId` ที่ประมวลผลแล้ว ring 5,000 รายการ | **งานซ้ำ** — LINE ส่งซ้ำเมื่อ timeout ถ้าคนละ instance รับ จะประมวลผลสองครั้ง = แจ้งเตือนซ้ำ/บันทึกซ้ำ · อีกกรณีที่เกิดได้แม้ instance เดียวคือ event เก่ากว่า 5,000 รายการล่าสุดถูกดันออกจาก ring แล้ว LINE ส่งซ้ำทีหลัง |
| 3 | `linkingState` | `backend/src/services/line.service.js:40` | ขั้นตอนการผูกบัญชี LINE ต่อ `line_user_id` TTL 30 นาที | **ผู้ใช้ทำไม่จบ** — ข้อความถัดไปไปลงคนละ instance แล้วหา state ไม่เจอ ต้องเริ่มใหม่ |
| 4 | `counters` | `backend/src/services/lineBindGuard.js:31` | ล็อกการเดาผูกบัญชีตาม phone/student/pair/sub (คีย์ hash แล้ว) สูงสุด 50,000 รายการ | **เพดานคูณจำนวน instance** เช่นเดียวกับข้อ 1 |

**ข้อ 5 ที่เคยถูกนับรวมแต่ไม่ใช่ช่องโหว่:** `lastInside` (`backend/src/services/geofence.service.js:31`) เป็น **cache ที่มีต้นทางถาวรอยู่แล้ว** — เมื่อ miss จะอ่านจาก `geofence_events` ผ่าน `getLastKnownInside()` คอมเมนต์ในโค้ดระบุไว้เองว่าแก้ไปแล้วใน H1 fix ("on a miss we fall back to the DB so restarts and multi-instance deploys stay correct") รายการใน backlog เขียนรวมทั้งสี่/ห้าตัวโดยไม่แยกข้อนี้ออก จึงทำให้ขอบเขตงานดูใหญ่กว่าจริง

**ลำดับความสำคัญ** ข้อ 1 และ 4 เป็นมาตรการความปลอดภัย (เพดานที่ควบคุมไม่ได้) · ข้อ 2 เป็นความถูกต้องของข้อมูล (บันทึกซ้ำ) · ข้อ 3 เป็นประสบการณ์ผู้ใช้

## 3. DDL ที่เสนอ

ทุกตารางเป็น `InnoDB` / `utf8mb4_unicode_ci` ตาม CLAUDE.md §3 และไม่มีตารางใดเก็บข้อมูลระบุตัวตนแบบอ่านได้ ยกเว้นข้อ 3 ที่อธิบายไว้ในหมายเหตุ

```sql
-- 1) ล็อกการ login ต่อ (username + IP)
--    key_hash = SHA2(CONCAT(LOWER(TRIM(username)), '|', ip), 256)
--    เก็บเป็น hash เพราะคีย์ประกอบด้วย username และ IP ซึ่งเป็นข้อมูลส่วนบุคคล
--    และการตรวจสอบต้องการแค่ความเท่ากัน ไม่ต้องอ่านย้อน
CREATE TABLE login_lockouts (
  key_hash      CHAR(64) NOT NULL,
  fail_count    INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  INDEX idx_ll_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) กันการประมวลผล webhook ซ้ำ
--    ใช้ INSERT IGNORE แล้วดู affectedRows: 1 = ยังไม่เคยเห็น, 0 = เคยแล้ว
--    วิธีนี้ atomic ข้าม instance ส่วนเวอร์ชันในหน่วยความจำ atomic อยู่แล้ว
--    ภายใน process เดียว เพราะ has/set อยู่ในฟังก์ชัน synchronous ไม่มี await คั่น
CREATE TABLE line_webhook_events_seen (
  event_id   VARCHAR(64) NOT NULL,
  seen_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  INDEX idx_lwes_seen (seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) สถานะการผูกบัญชี LINE ระหว่างทาง
--    phone เก็บแบบอ่านได้เพราะขั้นตอนถัดไปต้องใช้ค่าเดิมไปจับคู่ ซึ่งเป็น
--    ข้อมูลชั่วคราวอายุ 30 นาที และเป็นค่าที่ผู้ใช้เพิ่งพิมพ์เข้ามาเอง
--    ถ้า DPO เห็นว่าต้องเข้ารหัส ให้ตัดสินใน D0-8 ก่อน apply
CREATE TABLE line_link_sessions (
  line_user_id  VARCHAR(50) NOT NULL,
  step          VARCHAR(32) NOT NULL,
  phone         VARCHAR(20) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id),
  INDEX idx_lls_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) ล็อกการเดาผูกบัญชี — คีย์ hash อยู่แล้วในโค้ดปัจจุบัน
CREATE TABLE line_bind_lockouts (
  lock_type     ENUM('phone','student','pair','sub') NOT NULL,
  key_hash      CHAR(64) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (lock_type, key_hash),
  INDEX idx_lbl_window (window_start),
  INDEX idx_lbl_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4. การล้างข้อมูลเก่า

ทั้งสี่ตารางโตได้ไม่จำกัดถ้าไม่ล้าง ใช้รูปแบบเดียวกับ `revoked_tokens` ที่ CLAUDE.md §5.1 กำหนดไว้แล้ว คือ MySQL Event หรือ cron ภายนอก

```sql
DELETE FROM login_lockouts           WHERE window_start < NOW() - INTERVAL 1 HOUR;
DELETE FROM line_webhook_events_seen WHERE seen_at      < NOW() - INTERVAL 7 DAY;
DELETE FROM line_link_sessions       WHERE created_at   < NOW() - INTERVAL 1 HOUR;
DELETE FROM line_bind_lockouts       WHERE window_start < NOW() - INTERVAL 1 DAY
                                       AND (locked_until IS NULL OR locked_until < NOW());
```

ช่วงเวลาที่เลือกกว้างกว่า TTL ในโค้ด (15 นาที / 30 นาที) เพื่อไม่ให้การล้างไปลบแถวที่ยังมีผลอยู่เมื่อเวลาของเครื่องกับ DB ไม่ตรงกันเป๊ะ

## 5. สิ่งที่ต้องยอมรับถ้า apply

| ประเด็น | รายละเอียด |
|---|---|
| ต้นทุนต่อ request | ทุกครั้งที่ login ล้มเหลวจะเพิ่ม 1 write และทุกครั้งที่ login จะเพิ่ม 1 read จากที่ตอนนี้อยู่ในหน่วยความจำล้วน · webhook ทุกใบเพิ่ม 1 `INSERT IGNORE` |
| ผลต่อ capacity | ยังประเมินเป็นตัวเลขไม่ได้จนกว่า B3-1 จะรันบน staging จริง — §13.1 ระบุว่า scenario `login` **วัดไม่ได้** บน local เพราะ `loginLimiter` นับต่อ IP ดังนั้นตัวเลขจาก A1-8 ใช้ประเมินข้อนี้ไม่ได้ |
| ความถูกต้องที่ได้เพิ่ม | ข้อ 2 จะ atomic ข้าม instance · **ไม่ใช่** การแก้ race ภายใน process เดียว — `alreadyProcessed()` เป็นฟังก์ชัน synchronous ไม่มี `await` คั่นระหว่าง `has` กับ `set` จึงไม่มีช่องว่างอยู่แล้วเมื่อมี instance เดียว |
| ทางเลือก Redis | ให้ผลเดียวกันและเร็วกว่า แต่เพิ่ม dependency ที่ยังไม่มีในระบบ ถ้าเลือกทางนี้ DDL ชุดนี้ไม่ต้องใช้ — เป็นการตัดสินใจของ Technical owner |
| ลำดับการ deploy | ถ้ามีหลาย instance ต้องสร้างตารางก่อนแล้วจึง deploy โค้ดใหม่ · โค้ดต้องอ่าน/เขียนได้ทั้งตอนที่ยังมีแถวเก่าและไม่มี |

## 6. เกณฑ์ที่จะถือว่า A1-9 ปิด

1. ทั้งสี่ตารางถูกสร้างผ่าน migration ที่มี rollback
2. โค้ดทั้งสี่จุดอ่าน/เขียนจาก DB และไม่มี `Map` ที่เป็นต้นทางความจริงเหลืออยู่
3. มีเทสต์ที่พิสูจน์ว่าการนับข้ามการ restart process ได้ — เทสต์เดิมทั้งหมดผ่านโดยไม่ต้องแก้ semantics
4. คำว่า "Single-instance caveat" ถูกลบออกจาก `docs/SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md` และ RR-08 ถูกปิด
5. ยังไม่นับว่าปิดจนกว่าจะมีผลรัน capacity จาก environment ที่ใช้ปิด Phase 9 gate ตามข้อ 5 ข้างบน
