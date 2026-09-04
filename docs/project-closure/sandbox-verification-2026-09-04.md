# Sandbox Verification Record — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **บันทึกผลการทดสอบทางเทคนิค ไม่ใช่ UAT และไม่ใช่ sign-off**

---

## 1. ขอบเขตและการอนุญาต

เจ้าของระบบอนุญาตให้รัน integration tests และทดสอบ migration 050 บนฐานข้อมูล `lampang_bus_test` ซึ่งเป็นฐานทดสอบแบบใช้แล้วทิ้งบนเครื่อง production เมื่อ 4 กันยายน 2569

**ห้ามตีความว่าเป็นการทดสอบบนข้อมูลจริง** ทุกคำสั่งเขียนถูกบังคับให้ชี้ไปที่ `lampang_bus_test` ผ่าน `backend/src/utils/testDatabaseGuard.js` ซึ่งตรวจสามเงื่อนไขก่อนอนุญาต: `NODE_ENV=test`, `DB_NAME=lampang_bus_test` และ `ALLOW_TEST_DB_RESET=true`

## 2. วิธีการ

- Clone branch `feat/tracking-security-hardening` commit `1cccee8` ลงไดเรกทอรีแยก `/home/schoolbus/ci-sandbox-<timestamp>/` **ไม่แตะ** `/home/schoolbus/apps/lampang-bus-system`
- สร้าง `.env.test` (chmod 600) จาก template โดยอ่าน DB credential จาก production `.env` และไม่แสดงค่าออกทาง output ใด ๆ
- รัน `npm ci`, `npm run test:prepare` แล้วรัน jest ทั้งชุด
- รัน migration drill แยกต่างหาก
- ลบไดเรกทอรี sandbox ทั้งหมดหลังเสร็จ

## 3. ผลการทดสอบ

### 3.1 Test suite เต็ม (unit + integration) บน MySQL 8.0.46 จริง

| รายการ | ผล |
|---|---|
| Test suites | **109 passed / 109** |
| Tests | **1,237 passed / 1,237** |
| Failures | 0 |
| เวลา | 46.2 วินาที |
| Exit code | 0 |

ครอบคลุม cross-school isolation, grade-scope, import scope, security hardening, upload protection, CORS, RBAC และ verification scope ซึ่งรันบนเครื่องพัฒนาไม่ได้เพราะไม่มี MySQL

เทียบกับ unit-only ที่รันบนเครื่องพัฒนา: 52 suites / 576 tests

### 3.2 Migration 050 apply/rollback drill

| ขั้นตอน | ผล |
|---|---|
| ตารางก่อน apply | 56 |
| หลัง apply | 58 (+2: `participation_cases`, `participation_case_events`) |
| Collation ของทั้งสองตาราง | `utf8mb4_unicode_ci` |
| Re-apply ซ้ำ | no-op (ใช้ `CREATE TABLE IF NOT EXISTS`) |
| เส้นทางครบวงจร | SUBMITTED → ACKNOWLEDGED → DECIDED → ASSIGNED → COMPLETED → FEEDBACK_SENT → **CLOSED** |
| Event ที่บันทึก | 6 รายการ |
| สถานะสุดท้าย | `CLOSED`, decision `APPROVED`, `feedback_sent_at` ไม่ null |
| เพิ่ม event หลังปิดเรื่อง | ถูกปฏิเสธด้วย HTTP 409 |
| Transaction rollback | เหลือ 0 แถว |
| Migration rollback | ลบ 2 ตาราง กลับเป็น 56 ตารางเท่าเดิม |
| ตาราง participation ที่เหลือ | 0 |

### 3.3 ข้อมูล production ไม่เปลี่ยน

นับจำนวนแถวของ `lampang_bus` ก่อนและหลังงาน sandbox ทั้งหมด ได้ค่าตรงกันทุกตาราง:

| ตาราง | ก่อน | หลัง |
|---|---:|---:|
| students | 5,005 | 5,005 |
| vehicles | 640 | 640 |
| users | 852 | 852 |
| schools | 318 | 318 |
| affiliations | 5 | 5 |
| checkin_logs | 1,006 | 1,006 |
| daily_status | 431 | 431 |
| audit_logs | 13,454 | 13,454 |
| daily_snapshots | 7 | 7 |
| emergency_logs | 5 | 5 |
| parents | 4,537 | 4,537 |
| parent_student | 4,695 | 4,695 |

### 3.4 บริการ production ไม่ถูกรบกวน

| รายการ | ผล |
|---|---|
| Worktree commit | `0060c3e` (ไม่เปลี่ยน) |
| `git status` | สะอาด |
| PM2 `schoolbus-backend` | online, restart count คงที่ที่ 17 (ไม่มีการ restart) |
| `/health` | `success: true`, `database.connected: true` |
| RAM หลังเสร็จ | available 1,116 MB |
| Disk | ใช้ 36% |
| Sandbox directory | ลบแล้ว ไม่มีเหลือ |

## 4. สภาพแวดล้อมที่ยืนยันได้

| รายการ | ค่า |
|---|---|
| MySQL | 8.0.46-0ubuntu0.24.04.4 |
| Node | v20.20.2 |
| DB session timezone | `+07:00` |
| DB charset / collation | `utf8mb4` / `utf8mb4_unicode_ci` |
| `NOW()` ในเซสชันแอป | ตรงเวลาไทย |

## 5. สิ่งที่ยังไม่ได้ทดสอบ

- **Load test 50/200/500/1,000 users**: ยังไม่มี staging แยก และห้ามยิง write load ใส่ production
- **LINE OA/LIFF จริง**: ต้องใช้ LINE test account
- **UAT ทุกบทบาทโดยผู้แทนจริง**: เป็น human sign-off ไม่ใช่ automated test
- **Controlled reboot / DR drill**: ต้องมี maintenance window
- **Migration 050 บน production**: ยังไม่ apply ต้องผ่านการอนุมัติ deploy ก่อน

## 6. ข้อสรุป

Integration และ cross-scope tests ทั้งหมดผ่านบนฐานข้อมูลจริงในสภาพแวดล้อมเดียวกับ production และ migration 050 apply/rollback ได้สะอาดโดยข้อมูล production ไม่เปลี่ยนแม้แถวเดียว

ผลนี้เป็นหลักฐานทางเทคนิค **ไม่ใช่** UAT PASS และไม่ใช่การอนุมัติให้ deploy
