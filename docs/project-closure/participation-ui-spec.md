# สเปกหน้าจอ Participation — Inbox / Case Detail / Aggregate Dashboard (A0-4) — 4 กันยายน 2569

ระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

สถานะเอกสาร: **สเปกการออกแบบหน้าจอที่เขียนจาก backend ซึ่งมีอยู่จริงในโค้ด — ไม่ใช่การอนุมัติ feature ไม่ใช่หลักฐานการทดสอบ ไม่ใช่ UAT และไม่ใช่ sign-off**

เอกสารนี้ **ไม่** ยืนยันว่า participation workflow พร้อมใช้งาน **ไม่** ยืนยันว่า `FEATURE_PARTICIPATION_CASES` จะถูกเปิด และ **ไม่มีข้อความใดในเอกสารนี้ที่ถือเป็นคำตอบของ decision C0-* หรือ D0-*** ทุกช่องที่ขึ้นกับการตัดสินใจถูกเว้นว่างไว้พร้อมป้าย `รอ <decision id>` ห้ามผู้อ่านเติมค่าแทนผู้ตัดสิน

- งานอ้างอิง: A0-4 ใน `docs/project-closure/execution-plan-to-completion-2026-09-04.md:96`
- Implementation จริงคือ A1-2 (`execution-plan-to-completion-2026-09-04.md:124`) ซึ่ง **ยังไม่เริ่ม** และตาม slip rule (`:225`) ต้อง **หยุดรอ** จนกว่า C0-2 + C0-3 + C0-4 จะตอบ
- ทุกข้อเท็จจริงในเอกสารนี้อ้างไฟล์:บรรทัดที่อ่านจริงบน branch `feat/tracking-security-hardening` commit `4b80b4b` เมื่อ 4 กันยายน 2569 สิ่งใดที่ตรวจจากเครื่องนี้ไม่ได้ ระบุไว้ว่าตรวจไม่ได้
- **หลักฐาน runtime ที่เอกสารนี้ยืมมาใช้ มาจาก commit อื่น:** `sandbox-verification-2026-09-04.md:17` ระบุว่ารันบน commit `1cccee8` ส่วน worktree นี้อยู่ที่ `4b80b4b` (ห่างกัน 8 commit) เทียบไฟล์ที่เกี่ยวข้องแล้ว `050_participation_cases.sql` และ `participation.routes.js` ไม่เปลี่ยน ส่วน `participation.service.js` เปลี่ยนจุดเดียวคือเปลี่ยนการตรวจ `assigned_to` เป็น null-check (`:213-216`) ซึ่งไม่แตะ state machine และไม่แตะเส้นทางปิดวงจร ผู้อ่านจึงใช้ผล sandbox นั้นกับสเปกนี้ได้ แต่ต้องรู้ว่าเป็นคนละ commit

---

## 1. ขอบเขตของเอกสาร

**อยู่ในขอบเขต:** สเปกของหน้าจอสามหน้าที่ A1-2 ต้องสร้าง — inbox รวม, case detail, aggregate dashboard — โดยอ้างอิงเฉพาะ event type, field, endpoint และกติกา scope ที่ backend รองรับจริงแล้ว

**ไม่อยู่ในขอบเขต:** parent/teacher feedback channel (เป็น A1-2b ผูกกับ C0-12 + D0-3 + D0-4 ตาม `execution-plan-to-completion-2026-09-04.md:125`), การปรับเมนูตาม IA (A2-1), ข้อความ consent ทุกชนิด (D0-5), และการตัดสินว่า feature นี้จะถูก accept / pilot / defer (C0-4)

**หลักการเดียวที่เอกสารนี้ยึด** ตาม master plan Phase 4 (`docs/project-closure/master-project-closure-plan.md:188`) และข้อเสนอของ audit (`docs/role-menu-participatory-research-audit-2026-09-04.md:236`, `:257`): **หนึ่ง inbox รวม ไม่เพิ่มเมนูใหม่ต่อหนึ่ง action** ปุ่ม "รับทราบ / ขอความเห็น / มอบหมาย / บันทึกมติ / แจ้งผลกลับ" ต้องอยู่ในหน้าที่ผู้ใช้เปิดอยู่แล้ว ไม่ใช่เมนูละหนึ่งปุ่ม

---

## 2. ฐานที่ยืนยันได้จากโค้ด

### 2.1 สิ่งที่มีอยู่แล้ว

| ส่วน | ไฟล์ | สถานะที่ตรวจได้ |
|---|---|---|
| Schema | `backend/migrations/050_participation_cases.sql` | 2 ตาราง additive: `participation_cases` (`:25`), `participation_case_events` (`:95`) ไม่มี `ALTER TABLE` ไม่มี `INSERT` (ล็อกไว้ด้วยเทสต์ `backend/tests/participation.unit.test.js:302-309`) |
| Rollback | `backend/migrations/rollback/050_participation_cases_rollback.sql` | drop ตารางลูกก่อน และสั่งให้ operator ตรวจว่าตารางว่างก่อนรัน |
| Logic | `backend/src/services/participation.service.js` | state machine + validation แบบ pure (`:69` `ALLOWED_EVENTS`, `:81` `EVENT_RESULT_STATUS`, `:114` `validateCaseInput`, `:170` `validateEventInput`, `:243` `summariseParticipation`) |
| API | `backend/src/routes/participation.routes.js` | 4 endpoint (ดู §2.5) |
| Feature flag | `backend/src/config/env.js:233-237` | `participationCases: process.env.FEATURE_PARTICIPATION_CASES === 'true'` — dark by default และคอมเมนต์ระบุว่าต้อง apply migration 050 ก่อนเปิด |
| Mount | `backend/src/app.js:196-198` | mount `/api/participation` เฉพาะเมื่อ flag เปิด ถ้าปิดคือ 404 — **สังเกตจริงบน backend :3000 ของเครื่องนี้ 4 ก.ย. 2569** (flag ปิด): `GET /api/participation/cases` และ `/api/participation/summary` คืน 404 `Route not found` ขณะที่ `GET /api/auth/me` ซึ่ง mount อยู่คืน 401 จึงยืนยันได้ว่า 404 มาจาก "ไม่ได้ mount" ไม่ใช่ "ไม่มีสิทธิ์" |
| Rate limit | `backend/src/app.js:35`, `:115-117`, `:127` | `/api/participation` อยู่ใน `GLOBAL_API_LIMITED_PREFIXES` → 120 คำขอ/นาที/IP |
| ส่ง flag ให้ frontend | `backend/src/routes/auth.routes.js:219` → `frontend/src/hooks/useAuth.jsx:28-35` | login คืน `features` ทั้งก้อน เก็บใน localStorage ใช้ซ่อนเมนูได้ |
| RBAC exception ที่บันทึกไว้ | `backend/scripts/generate-rbac-matrix.js:58-65` | เหตุผลว่าทำไมทุกบทบาทเปิดเรื่องได้ (ดูข้อสังเกตใน §9.3) |
| Test | `backend/tests/participation.unit.test.js` | 340 บรรทัด ครอบคลุม validation, state machine, summary, scope clause, append-only guard, migration guard |
| หลักฐาน sandbox | `docs/project-closure/sandbox-verification-2026-09-04.md:47`, `:50` | เส้นทาง SUBMITTED → ACKNOWLEDGED → DECIDED → ASSIGNED → COMPLETED → FEEDBACK_SENT → CLOSED เดินได้บน MySQL 8 จริง (`:47`) และการเพิ่ม event หลังปิดเรื่องถูกปฏิเสธด้วย HTTP 409 (`:50`) — ผลนี้มาจาก commit `1cccee8` ไม่ใช่ commit ของสเปกนี้ (ดูหมายเหตุหัวเอกสาร) |

### 2.2 สิ่งที่ยังไม่มีเลย (ไม่ใช่ "ยังไม่ผ่าน")

| สิ่งที่ไม่มี | หลักฐาน |
|---|---|
| Frontend ทั้งหมด | `grep -ril participation frontend/src` ไม่พบไฟล์ใด (ตรวจ 4 ก.ย. 2569) ตรงกับ `execution-plan-to-completion-2026-09-04.md:20` |
| การฝัง event ในงานเดิม | ไม่มีจุดใดใน emergency / vehicle request / transfer / roster / inspection ที่สร้าง case หรือ event ให้ — `linked_entity_type` เขียนได้จาก request body เท่านั้น (`participation.service.js:140-144`, `:289-292`) |
| API รายชื่อผู้รับผิดชอบสำหรับ `assigned_to` | ไม่มี endpoint ใดใน `participation.routes.js` คืนรายชื่อผู้ใช้ที่มอบหมายได้ |
| ชื่อผู้ใช้ในหน้ารายละเอียด | `GET /cases/:id` คืน `c.*` ซึ่งเป็น user id ดิบ (`participation.routes.js:142-145`) ไม่มี JOIN กับ `users` จึงยังแสดงชื่อไม่ได้ |
| ค่า SLA ตั้งต้น | `due_at` ถูกตั้งเฉพาะตอน ASSIGNED และเฉพาะเมื่อผู้ใช้ส่งค่ามา (`participation.service.js:336-339`) ไม่มีค่า default ที่ใดในโค้ด |
| ผลรันบน staging / production | ตรวจจากเครื่องนี้ไม่ได้ — migration 050 ยังไม่ apply บน production (`execution-plan-to-completion-2026-09-04.md:14`) |

### 2.3 Event type ที่ schema รองรับจริง

`participation_case_events.event_type` เป็น ENUM 9 ค่า (`050_participation_cases.sql:101-103`) มากกว่าขั้นต่ำ 8 ค่าที่ master plan กำหนด (`master-project-closure-plan.md:185`) หนึ่งค่าคือ `WITHDRAWN`

| Event | อนุญาตจากสถานะ (`participation.service.js:69-78`) | สถานะผลลัพธ์ (`:81-91`) | เงื่อนไขบังคับ (`:200-218`) | ป้ายปุ่มที่เสนอ |
|---|---|---|---|---|
| `SUBMITTED` | เกิดอัตโนมัติตอนสร้างเรื่อง (`:296-300`) | `SUBMITTED` | — | (ฟอร์มเปิดเรื่อง) |
| `ACKNOWLEDGED` | SUBMITTED | `ACKNOWLEDGED` | — | รับทราบ |
| `COMMENTED` | ทุกสถานะที่ยังไม่ terminal | **`null` — ไม่เลื่อนสถานะ** | — | ให้ความเห็น |
| `CONSULTED` | SUBMITTED, ACKNOWLEDGED, IN_CONSULTATION, DECIDED, ASSIGNED | `IN_CONSULTATION` | — | ขอความเห็น |
| `DECIDED` | SUBMITTED, ACKNOWLEDGED, IN_CONSULTATION | `DECIDED` | ต้องมี `decision` 1 ใน 4 ค่า **และ** `note` (เหตุผล) ไม่ว่าง | บันทึกมติ |
| `ASSIGNED` | ACKNOWLEDGED, DECIDED | `ASSIGNED` | ต้องมี `assigned_to` | มอบหมาย |
| `COMPLETED` | DECIDED, ASSIGNED | `COMPLETED` | — | บันทึกผลการทำงาน |
| `FEEDBACK_SENT` | **COMPLETED เท่านั้น** | `CLOSED` | ต้องมี `note` ไม่ว่าง | แจ้งผลกลับผู้เสนอ |
| `WITHDRAWN` | ทุกสถานะที่ยังไม่ terminal ยกเว้น COMPLETED | `WITHDRAWN` | — | ถอนเรื่อง |

`ACKNOWLEDGED` ไม่อยู่ใน allow-list ของสถานะ `ACKNOWLEDGED` เอง (`:71`) จึงกดซ้ำไม่ได้ — UI ต้องซ่อนปุ่มนี้เมื่อสถานะเป็น ACKNOWLEDGED แล้ว

สถานะ terminal คือ `CLOSED` และ `WITHDRAWN` (`participation.service.js:58`) ทั้งสองรับ event เพิ่มไม่ได้เลย service คืน 409 (`:189-198`)

### 2.4 Field ที่เรื่องหนึ่งเรื่องเก็บ

| Field | ชนิด/ขนาด | บรรทัดใน 050 | ใครเขียน | แสดงที่ไหน |
|---|---|---|---|---|
| `case_no` | VARCHAR(32) unique รูปแบบ `PC-YYYYMMDD-XXXXXX` | `:30` (สร้างที่ `participation.service.js:101-103`) | ระบบ | หัวหน้ารายละเอียด + คอลัมน์แรกของ inbox |
| `case_type` | ENUM 6 ค่า | `:34-35` | ผู้เปิดเรื่อง | ตัวกรอง + คอลัมน์ |
| `subject` | VARCHAR(200) | `:37` | ผู้เปิดเรื่อง | คอลัมน์หลักของ inbox |
| `body` | TEXT (จำกัด 5,000 ที่ `participation.service.js:53`) | `:38` | ผู้เปิดเรื่อง | เฉพาะหน้ารายละเอียด (list ไม่คืนค่านี้) |
| `scope_type` / `scope_id` | ENUM 4 ค่า / VARCHAR(20) | `:42-43` | จาก token สำหรับ 4 บทบาท (ดู §9.2) | คอลัมน์ + ตัวกำหนดสิทธิ์ |
| `initiated_by` / `initiated_role` | INT FK users / ENUM 7 บทบาท | `:47-48` | ระบบจาก token | รายละเอียด (list คืนเฉพาะบทบาท) |
| `linked_entity_type` / `linked_entity_id` | VARCHAR(50) / VARCHAR(64) | `:52-53` | ผู้เปิดเรื่อง ต้องระบุคู่กัน (`participation.service.js:140-144`) | ลิงก์ไปงานต้นทาง |
| `status` | ENUM 8 ค่า default SUBMITTED | `:57-59` | projection จาก event | badge ทุกหน้า |
| `decision` / `decision_rationale` / `decided_by` / `decided_at` | ENUM 4 ค่า / TEXT / INT / TIMESTAMP | `:63-66` | event DECIDED | กล่อง "มติและเหตุผล" |
| `assigned_to` / `due_at` / `completed_at` | INT FK / TIMESTAMP / TIMESTAMP | `:69-71` | event ASSIGNED และ COMPLETED | กล่อง "ผู้รับผิดชอบและกำหนดเวลา" |
| `feedback_sent_at` | TIMESTAMP | `:75` | event FEEDBACK_SENT | badge "แจ้งผลกลับแล้ว" |
| `created_at` / `updated_at` | TIMESTAMP | `:77-78` | ระบบ | คอลัมน์เวลา |

Event หนึ่งแถวเก็บ: `event_type` (`:101-103`), `actor_user_id` (`:105`), `actor_role` (`:106`), `note` TEXT จำกัด 2,000 (`:110` + `participation.service.js:54`), `evidence_ref` VARCHAR(200) (`:114`), `occurred_at` (`:116`)

### 2.5 API ที่มีอยู่จริง

| Method + path | คืนอะไร | ข้อจำกัดที่ UI ต้องออกแบบตาม |
|---|---|---|
| `GET /api/participation/cases` (`participation.routes.js:86`) | 18 คอลัมน์ ไม่มี `body` (`:120-123` — `id`, `case_no`, `case_type`, `subject`, `scope_type`, `scope_id`, `initiated_role`, `status`, `decision`, `decided_at`, `assigned_to`, `due_at`, `completed_at`, `feedback_sent_at`, `linked_entity_type`, `linked_entity_id`, `created_at`, `updated_at`) | ตัวกรองที่รองรับมีแค่ `status`, `case_type`, `open=true`, `page`, `per_page` (`:96-113`) เรียงตาม `created_at DESC` ตายตัว (`:126`) `per_page` สูงสุด 100 (`:33`, `:89`) |
| `GET /api/participation/cases/:id` (`:136`) | `c.*` + `events` เรียงตามเวลา (`:148-155`) | คืน user id ดิบ ไม่มีชื่อ |
| `POST /api/participation/cases` (`:160`) | `{ id, case_no, status }` 201 | scope มาจาก token สำหรับ 4 บทบาท (`:163-170`) |
| `POST /api/participation/cases/:id/events` (`:191`) | `{ id, status, event }` 201 | ตรวจ scope ซ้ำในทรานแซกชัน (`:201-209`) และล็อกแถวด้วย `FOR UPDATE` (`participation.service.js:312-315`) |
| `GET /api/participation/summary` (`:236`) | ผลของ `summariseParticipation` | ดึงทุกแถวใน scope โดยไม่มี LIMIT (`:239-245`) — ต้องอยู่ในรายการทดสอบ load ของ A1-8 |

### 2.6 ช่องว่างระหว่าง master plan กับ schema 050

master plan (`master-project-closure-plan.md:187`) และ audit (`role-menu-participatory-research-audit-2026-09-04.md:246-251`) กำหนดให้เก็บ 9 อย่าง สคีมาเก็บครบ 6 อย่าง อีก 3 อย่างไม่มีคอลัมน์ของตัวเอง

| สิ่งที่ต้องเก็บ | มีคอลัมน์หรือไม่ | ทางที่ทำได้ตอนนี้ |
|---|---|---|
| ผู้ริเริ่ม | มี | `initiated_by` + `initiated_role` |
| **ผู้เข้าร่วม** | **ไม่มี** | ข้อมูลอยู่ในตาราง event (`actor_user_id` `050:105`, `actor_role` `:106`) แต่ **UI วันนี้ derive ได้แค่ระดับบทบาท** เพราะ `GET /cases/:id` เลือกเฉพาะ `id, event_type, actor_role, note, evidence_ref, occurred_at` (`participation.routes.js:149`) ไม่คืน `actor_user_id` ถ้าต้องการรายชื่อรายบุคคล ต้องแก้ backend ใน A1-2 (เพิ่มฟิลด์ + JOIN `users`) และผูกกับ `รอ D0-4` ไม่ใช่สิ่งที่ทำได้ทันทีจากฝั่งหน้าจอ |
| **ทางเลือกที่เสนอ + ผู้ให้ความเห็น** | **ไม่มี** | เป็น free text ใน `note` ของ event `COMMENTED`/`CONSULTED` เท่านั้น รวมเป็นตัวเลขไม่ได้ |
| มติ + เหตุผล + ผู้ตัดสิน + วันที่ | มี | `decision`, `decision_rationale`, `decided_by`, `decided_at` |
| ผู้รับผิดชอบ | มี | `assigned_to` |
| **SLA** | มีคอลัมน์ `due_at` แต่ **ไม่มีค่า default** | ต้องกรอกมือทุกครั้ง |
| สถานะ | มี | `status` |
| **ผลลัพธ์** | **ไม่มีคอลัมน์** | `note` ของ event `COMPLETED` |
| การแจ้งผลกลับ | มี | `feedback_sent_at` + `note` ของ `FEEDBACK_SENT` |

**ข้อควรระวัง:** สามช่องที่ไม่มีคอลัมน์ (ผู้เข้าร่วม, ทางเลือก, ผลลัพธ์) และค่า SLA ตั้งต้น **ไม่อยู่ในรายการ decision 21 ข้อ** ของ §4.1/§4.2 จึงต้องเพิ่มเป็น addendum ในบันทึกการตัดสินใจของ A0-2 (`execution-plan-to-completion-2026-09-04.md:94`) ก่อนตัดสินว่าจะทำ migration 051 หรือยอมรับว่าเก็บเป็น free text **ห้ามทีมเทคนิคเลือกแทน** เพราะถ้าเลือกทางเก็บเป็น free text ตัวชี้วัดที่นับ SLA ใน `backend/src/config/researchMetrics.js:175`, `:187-188` จะคำนวณจากข้อมูลจริงไม่ได้

---

## 3. สรุปจุดที่ถูก block — อ่านตารางนี้ก่อนเขียนโค้ดบรรทัดแรก

| Decision | คำถาม (ตามต้นฉบับ) | สิ่งที่ค้างในสเปกนี้ | ค่าในเอกสาร |
|---|---|---|---|
| **C0-4** (`execution-plan-to-completion-2026-09-04.md:59`) | PARTICIPATION_CASES เป็น accept / pilot / defer | **ทั้งสเปกนี้** ถ้า defer ให้บันทึก defer พร้อมผู้รับผิดชอบและวันที่ และไม่ต้องสร้างหน้าใด | `รอ C0-4` |
| **C0-3** (`:58`) | Target IA ต่อบทบาท | ตำแหน่งเมนู, ชื่อรายการเมนู, section ที่จะไปอยู่, จะเข้าจาก dashboard เดิมด้วยหรือไม่ | `รอ C0-3` |
| **C0-2** (`:57`) | ใครอนุมัติ transfer / vehicle request / roster-registration / inspection ระดับเดียว ไม่ซ้ำ queue | โครงคิว (tab/segment), ใครกด `ASSIGNED`, ใครกด `DECIDED`, ใครกด `FEEDBACK_SENT`, คนขับเห็นเรื่องของโรงเรียนตนหรือไม่, ค่า SLA ตั้งต้นต่อ `case_type` | `รอ C0-2` |
| **D0-2** (`:77`) | Data inventory + purpose ที่ครอบ "participation comments" | วัตถุประสงค์ของ `subject`/`body`/`note`/`evidence_ref` และคำเตือนในฟอร์ม | `รอ D0-2` |
| **D0-4** (`:79`) | จำแนก Consent / Acknowledgement / Certification | สถานะเชิงกฎหมายของ event `ACKNOWLEDGED` และ `FEEDBACK_SENT` และการเก็บ `actor_user_id` ของเจ้าหน้าที่ | `รอ D0-4` |
| **D0-8** (`:83`) | Retention + สิทธิ์เจ้าของข้อมูล | ระยะเก็บของ case/event และวิธีตอบคำขอลบเมื่อ log เป็น append-only | `รอ D0-8` |
| **C0-12** (`:67`) | ผู้ปกครอง/ครูส่ง feedback ในระบบหรือเครื่องมือภายนอก | ช่องทางของบทบาท `parent` (ดู §9.4) เป็นงาน A1-2b ไม่ใช่เอกสารนี้ | `รอ C0-12` |

---

## 4. โครงรวมสามหน้า

```
[ทางเข้าเดียว: รอ C0-3]
        |
        +-- หน้า 1  Inbox "งานที่ต้องมีส่วนร่วม"            GET /cases
        |        \-- คลิกแถว -> หน้า 2
        +-- หน้า 2  รายละเอียดเรื่อง + timeline + ปุ่ม       GET /cases/:id, POST /cases/:id/events
        \-- หน้า 3  ภาพรวมการมีส่วนร่วม (aggregate)          GET /summary
```

กติกาที่ใช้กับทั้งสามหน้า:

1. ทุกหน้าอยู่หลัง `FEATURE_PARTICIPATION_CASES` ทั้ง route guard และรายการเมนู แต่ **กลไกที่มีอยู่แล้วครอบเฉพาะครึ่งเดียว** ต้องแยกให้ชัดก่อนประเมินงาน A1-2:
   - **ซ่อนเมนู — มีกลไกเดิมให้ใช้ซ้ำ:** `frontend/src/components/Sidebar.jsx:163-184` ซ่อนรายการเมนูตามแมป `FLAG_GATED` (`:167-178`) และ `features` ที่ได้จาก login (`frontend/src/hooks/useAuth.jsx:28-35`) — เพิ่มคีย์ `participationCases` เข้าแมปเดียวกันได้เลย
   - **Route guard — ยังไม่มี ต้องสร้างใหม่:** `frontend/src/App.jsx` ไม่มีคำว่า `features` เลยแม้แต่ที่เดียว (ตรวจ 4 ก.ย. 2569) `PrivateRoute` (`App.jsx:129-149`) กันด้วย login + `allowedRoles` เท่านั้น ไม่มีเงื่อนไข feature flag และคอมเมนต์ใน `Sidebar.jsx:164-166` เขียนไว้เองว่าที่ต้องซ่อนเมนูก็เพราะ "users don't click into a 404" — คือยอมรับว่าเส้นทางไม่ได้ถูกกั้น A1-2 จึงต้องสร้าง route-level gating ขึ้นใหม่ ไม่ใช่ใช้ของเดิมซ้ำ
   - **พื้นผิวนำทางอื่นถือ flag แยกกันเอง:** `frontend/src/components/MobileBottomNav.jsx:10-11` (`driverTabs(features)`) และ `frontend/src/components/TopNavbar.jsx:220` (`features?.adminPasswordRecovery`) การเพิ่มคีย์ที่ `Sidebar` อย่างเดียว **ไม่** ทำให้สองที่นี้ซ่อนตาม ถ้าเมนู participation จะไปโผล่ที่ใดที่หนึ่งใน 2 ที่นี้ (ขึ้นกับ `รอ C0-3`) ต้องแก้แยกไฟล์
2. ไม่เพิ่มรายการเมนูมากกว่า **หนึ่ง** รายการต่อบทบาท (`master-project-closure-plan.md:188`) หน้า 3 เป็น tab ในหน้าเดียวกัน ไม่ใช่เมนูที่สอง
3. เมื่อ flag ปิด เมนูต้องหาย และเส้นทางต้อง redirect ไป dashboard ของบทบาท ไม่ใช่หน้า 404 — เพราะ backend จะ 404 อยู่แล้ว (`backend/src/app.js:196-198`) และผู้ใช้จะติดหน้าเปล่าโดยไม่รู้สาเหตุ
4. ข้อความไทยทุกคำต้องผ่าน `npm run check:labels:strict` (`docs/ui-label-enforcement.md:3-13`, รายการคำต้องห้าม `:80-90`) โดยเฉพาะ "เขตพื้นที่" ต้องใช้ "สังกัด" และ "ดำเนินการแล้ว" ต้องใช้ "สำเร็จแล้ว"
5. ต้องผ่านการตรวจ keyboard / focus / contrast / target size และ responsive 390-768-1440 ตาม A2-3 (`execution-plan-to-completion-2026-09-04.md:156`)

---

## 5. หน้า 1 — Inbox รวม "งานที่ต้องมีส่วนร่วม"

### 5.1 ทางเข้าและตำแหน่งเมนู — `รอ C0-3`

ยังไม่กำหนดในสเปกนี้: ชื่อรายการเมนู, section ที่จะไปอยู่ (จาก 6 section ที่ประกาศไว้ที่ `frontend/src/components/Sidebar.jsx:16-22`), path และการมีทางเข้าจาก card ใน dashboard เดิมด้วยหรือไม่

**สิ่งที่มาจาก master plan และ audit (ยังไม่ใช่การตัดสินของเจ้าของระบบ):** ต้องเป็นรายการเดียว ไม่แยกรายการต่อ `case_type` และไม่แยกต่อ action — ที่มาคือ `master-project-closure-plan.md:188` และ `role-menu-participatory-research-audit-2026-09-04.md:236`, `:257` ทั้งคู่เป็นแผนและผลตรวจภายใน **ไม่ใช่คำอนุมัติ** ตัวที่อนุมัติ IA ต่อบทบาทคือ C0-3 (`execution-plan-to-completion-2026-09-04.md:58`) ถ้า C0-3 ตอบต่างจากนี้ ให้ยึดคำตอบของ C0-3

### 5.2 โครงคิว / tab — `รอ C0-2`

โครงที่เป็นไปได้มีอย่างน้อยสามแบบ (คิวตามผู้รับผิดชอบ / คิวตามสถานะ / คิวตามระดับอนุมัติ) และการเลือกแบบใดขึ้นกับคำตอบของ C0-2 ว่า **ระดับใดเป็นผู้อนุมัติ** เพราะปัจจุบันมีเส้นทางอนุมัติซ้ำสองระดับอยู่จริงในโค้ด:

- `POST /api/admin/student-transfer-requests/:id/approve` (`backend/src/routes/admin.routes.js:1451-1456`)
- `POST /api/affiliation/transfer-requests/:id/approve` (`backend/src/routes/affiliation.routes.js:751-760`)

ทั้งสองเรียก `transfer.approveAndApply` ตัวเดียวกัน และรูปแบบเดียวกันเกิดกับ `vehicle_request` (`admin.routes.js:1491`, `affiliation.routes.js:810`) นี่คือ "queue ซ้ำสองระดับ" ที่ C0-2 ต้องตัด **สเปกนี้จะไม่เลือกแทน** เพราะโครง tab จะสอนผู้ใช้ว่าใครเป็นเจ้าของงาน และความเข้าใจนั้นจะไหลเข้า UAT script (`execution-plan-to-completion-2026-09-04.md:157`) ก่อนที่เจ้าของระบบจะทันตรวจ

**หมายเหตุที่ต้องส่งต่อ A1-3:** `CLAUDE.md` §8 เชิงอรรถ 5 ระบุว่าการให้สังกัดอนุมัติเอง "ยังไม่ implement" ซึ่ง **ไม่ตรงกับโค้ดปัจจุบัน** ที่ `affiliation.routes.js:751` มีอยู่จริง ต้องแก้เอกสารในงาน matrix ของ A1-3 ไม่ใช่ในเอกสารนี้

### 5.3 ตัวกรองที่ทำได้ทันที เทียบกับที่ยังทำไม่ได้

| ตัวกรอง | backend รองรับ | หมายเหตุ |
|---|---|---|
| สถานะ (`status`) | ได้ (`participation.routes.js:96-102`) | ค่าต้องอยู่ใน 8 สถานะ มิฉะนั้น 400 |
| ประเภทเรื่อง (`case_type`) | ได้ (`:103-109`) | 6 ค่า |
| เฉพาะที่ยังไม่ปิด (`open=true`) | ได้ (`:110-113`) | `status NOT IN ('CLOSED','WITHDRAWN')` — ค่าเริ่มต้นของ inbox ควรเป็นค่านี้ |
| หน้า / จำนวนต่อหน้า | ได้ (`:88-90`) | สูงสุด 100 ต่อหน้า |
| **"งานของฉัน" (`assigned_to` = ผู้ใช้ปัจจุบัน)** | **ยังไม่มี** | ต้องเพิ่ม query param ใน A1-2 — **ห้ามดึงทุกหน้ามากรองที่ client** เพราะเพดาน `per_page` คือ 100 (`:33`) |
| **เกินกำหนด (overdue)** | **ยังไม่มี** | สูตรมีอยู่ใน `summariseParticipation` (`participation.service.js:260`) แต่ list endpoint ยังไม่มีตัวกรอง |
| **ค้นหาข้อความ** | **ยังไม่มี** | ถ้าเพิ่ม ต้องตัดสินว่าให้ค้นใน `body` หรือไม่ ซึ่งผูกกับ D0-2 |
| **เรียงลำดับ** | **ยังไม่มี** | ตายตัวที่ `created_at DESC` (`:126`) |

### 5.4 คอลัมน์ของตาราง

ใช้เฉพาะฟิลด์ที่ list endpoint คืนจริง (`participation.routes.js:120-123`): `case_no` · `subject` · `case_type` · หน่วยงาน (`scope_type` + `scope_id`) · บทบาทผู้เสนอ (`initiated_role`) · สถานะ · กำหนดเวลา (`due_at`) · แจ้งผลกลับแล้วหรือยัง (`feedback_sent_at`) · วันที่เปิดเรื่อง (`created_at`)

ที่ **แสดงไม่ได้** ในรุ่นแรกเพราะ endpoint ไม่คืน: ชื่อผู้เสนอ และชื่อผู้รับผิดชอบ (คืนมาเป็น `assigned_to` ที่เป็น id) ถ้าเจ้าของระบบต้องการชื่อ ต้องเพิ่ม JOIN ใน A1-2 และต้องผ่าน D0-2 ก่อน เพราะเป็นการเพิ่มข้อมูลบุคคลลงหน้ารายการ

### 5.5 สถานะของหน้า

- ว่าง: ใช้ `EmptyState` เดิม และต้องแยกข้อความสองกรณี — "ยังไม่มีเรื่องในความรับผิดชอบ" กับ "ไม่พบเรื่องตามตัวกรอง" (ถ้าปะปนกัน ผู้ใช้จะเข้าใจว่าระบบเสีย)
- กำลังโหลด / ผิดพลาด: ใช้ `LoadingState` / `ErrorState` เดิม
- นอกขอบเขตสิทธิ์: backend คืน 404 ไม่ใช่ 403 โดยตั้งใจ (`participation.routes.js:14-18`, `:146`) UI ต้องพูดว่า "ไม่พบเรื่องนี้" **ห้าม** พูดว่า "ไม่มีสิทธิ์" เพราะจะเปิดเผยว่าเรื่องนั้นมีอยู่จริง

---

## 6. หน้า 2 — รายละเอียดเรื่อง + timeline + แถบปุ่ม

### 6.1 ส่วนประกอบ

1. **หัวเรื่อง:** `case_no`, `subject`, badge สถานะ และ badge "แจ้งผลกลับแล้ว" เมื่อ `feedback_sent_at` ไม่ว่าง
2. **รายละเอียด:** `body`, `case_type`, หน่วยงาน, บทบาทผู้เสนอ, ลิงก์ไปงานต้นทางเมื่อมี `linked_entity_type` + `linked_entity_id`
3. **กล่องมติ:** `decision`, `decision_rationale`, `decided_at` แสดงเฉพาะเมื่อมีค่า และ **แสดงเหตุผลเสมอเมื่อแสดงมติ** เพราะ backend บังคับให้มาคู่กัน (`participation.service.js:202-209`)
4. **กล่องผู้รับผิดชอบ:** `assigned_to`, `due_at`, `completed_at` พร้อมป้าย "เกินกำหนด" เมื่อ `due_at` ผ่านแล้วและยังไม่มี `completed_at` (สูตรเดียวกับ `participation.service.js:260`)
5. **Timeline:** ทุก event เรียงเก่าไปใหม่ (`participation.routes.js:148-154`) แสดง `event_type`, `actor_role`, `occurred_at`, `note`, `evidence_ref`
6. **แถบปุ่ม:** ปุ่มที่แสดงต้องคำนวณจาก `ALLOWED_EVENTS[status]` เท่านั้น

### 6.2 กติกาปุ่ม

- **UI ต้องไม่คิดกติกาเอง** ต้องใช้ตารางเดียวกับ backend (`participation.service.js:69-91` export ที่ `:352-362`) หรือให้ backend คืน `allowed_events` มาในหน้ารายละเอียด — เลือกทางใดทางหนึ่งใน A1-2 แต่ห้าม hardcode ซ้ำ เพราะกติกาสองชุดจะเพี้ยนกันทันทีที่มีคนแก้ที่เดียว
- ฟอร์มต่อปุ่มตามเงื่อนไขบังคับใน §2.3: บันทึกมติต้องเลือก `decision` 1 ใน 4 และกรอกเหตุผล, มอบหมายต้องเลือกผู้รับผิดชอบ, แจ้งผลกลับต้องกรอกสิ่งที่แจ้ง
- ปุ่ม "แจ้งผลกลับผู้เสนอ" ต้อง **ไม่ปรากฏเลย** จนกว่าสถานะจะเป็น `COMPLETED` (`participation.service.js:75`) ห้ามแสดงแบบ disabled พร้อมคำอธิบาย เพราะปุ่มที่เห็นแล้วกดไม่ได้จะกลายเป็นแรงจูงใจให้กด "บันทึกผลการทำงาน" ทั้งที่ยังไม่ได้ทำ เพื่อให้ปุ่มปิดเรื่องเปิดใช้ได้
- เมื่อสถานะเป็น terminal: ไม่มีปุ่มใดเลย และแสดงข้อความว่าเรื่องปิดแล้ว (backend คืน 409 ที่ `participation.service.js:189-198`)

### 6.3 ใครกดปุ่มไหนได้ — `รอ C0-2`

**สถานะปัจจุบันของโค้ด (ข้อเท็จจริง ไม่ใช่ข้อเสนอ):** ไม่มีการตรวจว่าบทบาทใดกด event ใดได้ `participation.routes.js:211-215` ใส่ `actor_role` จาก token แล้วส่งต่อ และ `validateEventInput` ตรวจเพียงว่า `actor_role` อยู่ใน 7 บทบาท (`participation.service.js:180-182`) **ทุกบทบาทที่มองเห็นเรื่องหนึ่ง จึงกด `DECIDED` และ `ASSIGNED` กับเรื่องนั้นได้** รวมถึงคนขับที่เปิดเรื่องเอง ซึ่งมองเห็นเฉพาะเรื่องของตน (`participation.routes.js:62-64`) จึงบันทึกมติให้เรื่องของตัวเองได้

สิ่งที่ **ยังไม่กำหนด** และห้ามเดา:

| ช่อง | ค่า |
|---|---|
| ผู้มีสิทธิ์กด `DECIDED` แยกตาม `case_type` / `scope_type` | `รอ C0-2` |
| ผู้มีสิทธิ์กด `ASSIGNED` และรายชื่อผู้ที่ถูกมอบหมายได้ | `รอ C0-2` |
| ผู้มีสิทธิ์กด `FEEDBACK_SENT` (ผู้ตัดสิน หรือผู้รับผิดชอบ) | `รอ C0-2` |
| ค่า SLA ตั้งต้นต่อ `case_type` | `รอ C0-2` และต้องเพิ่มเป็นคำถามในบันทึกการตัดสินใจตาม §2.6 |

จนกว่าจะได้คำตอบ **ห้าม** implement ทั้งฝั่ง UI และ server-side check ของข้อเหล่านี้ การเดาแล้วแก้ทีหลังคือสิ่งที่ `execution-plan-to-completion-2026-09-04.md:89` ห้ามไว้โดยตรง

---

## 7. หน้า 3 — Aggregate participation dashboard

ต้องแยกจาก operational dashboard อย่างชัดเจนตาม master plan (`master-project-closure-plan.md:190`) และตามเหตุผลที่เขียนไว้ในโค้ด (`participation.routes.js:233-235`)

### 7.1 ตัวเลขที่แสดงได้ (จาก `summariseParticipation`, `participation.service.js:243-276`)

| ตัวเลข | ที่มา | กติกาการแสดง |
|---|---|---|
| `total` | จำนวนเรื่องใน scope | — |
| `by_status` (8 ค่า) | นับตามสถานะ | ใช้เป็นแท่ง/โดนัทได้ |
| `by_type` (6 ค่า) | นับตามประเภท | — |
| `by_initiator_role` (7 บทบาท) | นับตามบทบาทผู้เสนอ | **ต้องแสดงแยกบทบาท ห้ามรวมเป็นตัวเลขเดียว** (ล็อกด้วยเทสต์ `backend/tests/participation.unit.test.js:206-211`) |
| `closed_feedback_loop` | นับเรื่องที่ `feedback_sent_at` ไม่ว่าง | ตัวเลขนี้คือหัวใจของ Phase 4 |
| `closed_feedback_loop_pct` | เปอร์เซ็นต์ หรือ **`null` เมื่อ total = 0** (`participation.service.js:271`) | **ห้ามแสดง `null` เป็น 0%** ต้องแสดงว่ายังไม่มีเรื่อง เหตุผลอยู่ในเทสต์ `:199-204` |
| `decided_with_rationale` | นับเรื่องที่มีทั้งมติและเหตุผล (`participation.service.js:259`) | **ห้ามอ่านเป็น "สัดส่วนเรื่องที่ตัดสินอย่างมีเหตุผล"** เพราะเรื่องที่เดินเส้น ACKNOWLEDGED → ASSIGNED (§8) ปิดได้โดยไม่มี `DECIDED` เลย ตัวหารจึงไม่ใช่ "เรื่องที่ปิดแล้ว" ต้องแสดงเป็นจำนวนนับคู่กับ `total` ไม่ใช่เปอร์เซ็นต์ |
| `overdue` | `due_at` ผ่านแล้วและยังไม่ `completed_at` | เมื่อ SLA ยังไม่ถูกกำหนด (§2.6) ตัวเลขนี้จะนับเฉพาะเรื่องที่มีคนกรอก `due_at` เอง ต้องเขียนกำกับไว้บนหน้าจอ |
| `note` | ข้อความคงที่ "ตัวชี้วัดการมีส่วนร่วม แยกจาก operational KPI และไม่ใช่ผลการวิจัย" (`participation.service.js:274`) | **ต้องแสดงบนหน้าจอ ไม่ใช่ซ่อนใน tooltip** |

### 7.2 สิ่งที่หน้านี้ห้ามทำ

- ห้ามแสดงคำว่า "พร้อมประเมิน" หรือสรุปว่าการมีส่วนร่วมผ่านเกณฑ์ใด ๆ เกณฑ์นั้นคือ C0-11 (`execution-plan-to-completion-2026-09-04.md:66`) และ audit ระบุว่าการตีความจำนวน action ว่าเป็นความพร้อมคือข้อผิดพลาดเดิมของระบบ (`role-menu-participatory-research-audit-2026-09-04.md:216`)
- ห้ามนำตัวเลขจากหน้านี้ไปวางบน dashboard ปฏิบัติการเดียวกับจำนวนเช็กอิน
- ห้ามอ้างเป็นผลการวิจัย ตัวชี้วัดที่ผูกกับ case คือ `affiliation.proactive_follow_up_actions` และ `affiliation.pending_school_follow_up_rate` (`backend/src/config/researchMetrics.js:171-195`) ซึ่งทั้งคู่ต้องการนิยาม SLA และช่วงเวลาวิจัยที่ยัง `รอ C0-6` และ `รอ C0-11`

---

## 8. วงจรปิด SUBMITTED → FEEDBACK_SENT

เส้นทางหลัก (เดินผ่านจริงบน MySQL 8 ตาม `docs/project-closure/sandbox-verification-2026-09-04.md:47` — เป็นผลจาก commit `1cccee8` ดูหมายเหตุหัวเอกสาร):

```
SUBMITTED --ACKNOWLEDGED--> ACKNOWLEDGED --DECIDED--> DECIDED --ASSIGNED--> ASSIGNED
                                                        |                      |
                                                        +----COMPLETED---------+
                                                                  |
                                                COMPLETED --FEEDBACK_SENT--> CLOSED
```

**เส้นทางที่ backend อนุญาตแต่ไม่อยู่ในภาพข้างบน** (อ่านจาก `ALLOWED_EVENTS` `participation.service.js:69-78` ยังไม่ได้ทดสอบ runtime ทั้งสองเส้น):

| ทางลัด | ผลที่ตามมา |
|---|---|
| `SUBMITTED --DECIDED--> DECIDED` (`:70`) | ตัดสินโดยไม่ต้องรับทราบก่อน |
| `ACKNOWLEDGED --ASSIGNED--> ASSIGNED` (`:71`) | **ปิดวงจรได้โดยไม่มีมติเลย** คือ SUBMITTED → ACKNOWLEDGED → ASSIGNED → COMPLETED → FEEDBACK_SENT → CLOSED ทั้งเส้นไม่มี event `DECIDED` ดังนั้น `decision` และ `decision_rationale` เป็น NULL และ `decided_with_rationale` (`:259`) จะไม่นับเรื่องนี้ ทั้งที่เรื่องปิดแล้ว |

- `COMMENTED` และ `CONSULTED` แทรกได้เกือบทุกจุดโดยไม่เลื่อนสถานะ (`COMMENTED` คืน `null` ที่ `participation.service.js:84`) UI ต้องไม่แสดงความเห็นเป็น "ความคืบหน้า"
- ทางลัดมีสองเส้นตามตารางข้างบน ไม่ใช่เส้นเดียว UI เตือนได้แต่ห้ามบล็อก เพราะ backend อนุญาตทั้งคู่ (`participation.service.js:70`, `:71`) และ **หน้า aggregate ต้องไม่แสดง `decided_with_rationale` เป็นตัววัดคุณภาพของเรื่องที่ปิดแล้ว** จนกว่า C0-2 จะตอบว่าเส้น ACKNOWLEDGED → ASSIGNED เป็นเรื่องปกติหรือเป็นช่องที่ต้องปิด — `รอ C0-2`
- **ไม่มีทางไปถึง CLOSED นอกจากผ่าน COMPLETED แล้ว FEEDBACK_SENT** ล็อกไว้ด้วยเทสต์ `backend/tests/participation.unit.test.js:76-89`
- `WITHDRAWN` เป็นทางออกที่ไม่ใช่การปิดวงจร dashboard ต้องนับแยก ไม่รวมกับ `CLOSED`

**สิ่งที่ UI ต้องทำเพื่อไม่ให้วงจรปิดแบบหลอก:** ฟอร์ม "แจ้งผลกลับ" ต้องบังคับกรอกสิ่งที่แจ้ง (backend บังคับอยู่แล้วที่ `participation.service.js:210-212`) และควรแสดงข้อความของผู้เสนอ (event `SUBMITTED`) ไว้ข้างฟอร์ม เพื่อให้ผู้เขียนคำตอบเห็นคำถามเดิม

**ช่องว่างที่แก้ด้วย UI ไม่ได้:** ระบบไม่ได้ส่งข้อความออกไปหาผู้เสนอจริง `FEEDBACK_SENT` เป็นเพียงการบันทึกว่าแจ้งแล้ว ช่องทางแจ้งจริง (ในระบบ / โทรศัพท์ / LINE) `รอ C0-12` และถ้าเลือกช่องทาง LINE ต้องผ่าน D0-3 และ D0-6 ก่อน

---

## 9. กติกาข้ามขอบเขต (cross-scope)

### 9.1 สิ่งที่เห็นได้ต่อบทบาท (`participation.routes.js:42-70`)

| บทบาท | เงื่อนไขที่ใช้ใน SQL | ผลต่อ UI |
|---|---|---|
| `admin`, `province` | `1=1` (`:45-46`) | เห็นทุกเรื่องทั้งจังหวัด |
| `affiliation` | เรื่องของสังกัดตน **หรือ** เรื่องของโรงเรียนที่ `affiliation_id` ตรงและยังไม่ถูกลบ (`:49-57`) | ควรมีตัวกรองรายโรงเรียนในอนาคต ซึ่ง backend ยังไม่มี |
| `school` | `scope_type='SCHOOL' AND scope_id` = ของตน (`:59`) | เห็นเฉพาะเรื่องของโรงเรียนตน |
| `transport` | `scope_type='TRANSPORT'` **ไม่มีการแบ่งตาม `scope_id`** (`:61`) | บัญชีขนส่งทุกบัญชีเห็นชุดเดียวกัน ถ้าต้องการแบ่งตามพื้นที่ ต้องแก้ backend |
| `driver` | `initiated_by` = ตนเอง (`:64`) | เห็นเฉพาะเรื่องที่ตนเปิด **มองไม่เห็นเรื่องที่โรงเรียนเปิดเกี่ยวกับรถของตน** |
| บทบาทใหม่ที่ยังไม่ประกาศ | `1=0` (`:66-68`) | เห็นศูนย์รายการ เป็น deny-by-default โดยตั้งใจ |

ทั้ง list, detail และการเพิ่ม event ใช้เงื่อนไขเดียวกัน และการเพิ่ม event ตรวจซ้ำภายในทรานแซกชัน (`:201-209`) จึงยิง id ข้ามขอบเขตไม่ได้ (ได้ 404)

**จุดที่ต้องให้ C0-2 ตัดสิน:** คนขับควรเห็นเรื่องที่โรงเรียนเปิดเกี่ยวกับรถของตนหรือไม่ ถ้าควร ต้องแก้ `scopeClause` ปัจจุบันคนขับ "มีส่วนร่วม" ได้เฉพาะเรื่องที่ตัวเองเปิดเท่านั้น ซึ่งอาจไม่ตรงกับความหมายของการมีส่วนร่วมที่งานวิจัยต้องการ (`รอ C0-2` และนิยามการมีส่วนร่วม `รอ C0-6`)

### 9.2 ขอบเขตตอนเปิดเรื่อง (`participation.routes.js:73-83`)

- `school`, `affiliation`, `province`, `transport` — scope มาจาก token และเขียนทับค่าใน body เสมอ (`:163-170`)
- `admin` และ `driver` — `callerScope` คืน `null` (`:79-80`) จึง **ใช้ `scope_type` และ `scope_id` จาก request body** และ `validateCaseInput` ตรวจเพียงว่าอยู่ใน ENUM และไม่ว่าง (`participation.service.js:128-135`)

### 9.3 ข้อสังเกตที่ต้องส่งต่อ A1-2 / A1-11

เหตุผลที่บันทึกไว้ใน RBAC matrix (`backend/scripts/generate-rbac-matrix.js:60`) เขียนว่า "the case is filed against the caller own scope taken from the token, never from the body" ซึ่ง **ตรงกับโค้ดเฉพาะ 4 บทบาท** แต่ไม่ตรงสำหรับ `driver` และ `admin` ผลคือคนขับยื่นเรื่องเข้าไปใน `scope_id` ของโรงเรียนใดก็ได้ โดยไม่มีการตรวจว่าตนขับรถให้โรงเรียนนั้น

นี่เป็นเรื่องฝั่ง server **แก้ด้วย UI ไม่ได้** ต้องเข้ารายการของ A1-11 (`execution-plan-to-completion-2026-09-04.md:134`) และแก้พร้อม A1-2 ห้ามออกแบบหน้าจอโดยสมมติว่ามีการตรวจนี้อยู่แล้ว

### 9.4 บทบาท `parent`

`parent` อยู่ใน ENUM ของทั้งสองตาราง (`050_participation_cases.sql:48`, `:106`) แต่ **ไม่อยู่ใน `requireRole`** ของ router (`participation.routes.js:31`) และผู้ปกครองยืนยันตัวตนด้วย LINE id_token ไม่ใช่ JWT role (`CLAUDE.md` §8) ดังนั้นวันนี้ผู้ปกครองเปิดเรื่องเองไม่ได้ ค่านี้ใช้ได้เฉพาะกรณีเจ้าหน้าที่บันทึกแทน

ช่องทางของผู้ปกครองเป็นงาน A1-2b และ `รอ C0-12` + `รอ D0-3` + `รอ D0-4` — **ห้ามออกแบบหน้าจอผู้ปกครองในเอกสารนี้**

---

## 10. ข้อจำกัด append-only

`participation_case_events` ไม่ถูกแก้หรือลบจากที่ใดในซอร์ส และมีเทสต์ที่สแกนทุกไฟล์ใน `backend/src` เพื่อยืนยัน (`backend/tests/participation.unit.test.js:278-292`) แถวของ case ก็ลบไม่ได้เช่นกัน

กติกาที่ผูกกับ UI:

1. Timeline **ไม่มี** ปุ่มแก้ ไม่มีปุ่มลบ ไม่มี soft delete และไม่มีการซ่อนรายการ ต่างจากหน้าอื่นในระบบที่ใช้ soft delete (`CLAUDE.md` §12 ข้อ 10)
2. การ "แก้ไข" ทำได้ทางเดียวคือเพิ่ม event `COMMENTED` ใหม่ที่อธิบายว่าข้อความก่อนหน้าคลาดเคลื่อน UI ควรมีปุ่มนี้พร้อมคำอธิบายชัดเจน
3. `body` ของเรื่องถูกคัดลอกลง `note` ของ event `SUBMITTED` ตั้งแต่ตอนสร้าง (`participation.service.js:296-301`) และ **วันนี้ไม่มีทางแก้ `body` ได้เลย** เพราะ `participation.routes.js` มีเพียง 4 endpoint คือ `GET /cases` (`:86`), `GET /cases/:id` (`:136`), `POST /cases` (`:160`), `POST /cases/:id/events` (`:191`) ไม่มี PUT / PATCH / DELETE ใด ๆ ผลต่อ UI คือ **ข้อความที่พิมพ์ครั้งแรกเป็นข้อความถาวร** UI จึงต้องเตือนก่อนกดบันทึกครั้งแรก และถ้า A1-2 หรืองานหลังจากนั้นจะเพิ่มการแก้ไข `body` ต้องรู้ล่วงหน้าว่าสำเนาใน event log ลบตามไม่ได้
4. หน้าจอและคู่มือ (A2-5 / A2-6) ห้ามสัญญากับผู้ใช้ว่าลบข้อความได้
5. ผลต่อคำขอสิทธิ์เจ้าของข้อมูล (แก้ไข/ลบ) เมื่อ log แก้ไม่ได้: `รอ D0-8`

---

## 11. ข้อมูลส่วนบุคคลและการลดข้อมูลเท่าที่จำเป็น

### 11.1 สิ่งที่ schema ตั้งใจไม่เก็บ

ไม่มีคอลัมน์ `student_id`, `cid_hash`, `phone`, `line_user_id`, `parent_id` และมีเทสต์บังคับไว้ (`backend/tests/participation.unit.test.js:320-329`) เหตุผลเขียนไว้ที่ `050_participation_cases.sql:17-23`: การผูกเรื่องกับเด็กจะเปลี่ยนบันทึกการบริหารให้กลายเป็นข้อมูลเด็ก ซึ่งเปลี่ยนทั้งฐานทางกฎหมายและกติกาการเก็บรักษา

**สเปกนี้จึงกำหนด:** ฟอร์มเปิดเรื่องและฟอร์มทุก event **ห้ามมีช่องกรอกชื่อนักเรียน เลขบัตรประชาชน เบอร์โทรศัพท์ หรือ LINE id** และการอ้างถึงงานต้นทางต้องใช้ `linked_entity_type` + `linked_entity_id` เท่านั้น

### 11.2 ช่องที่ยังเป็นข้อมูลส่วนบุคคลได้ และต้องมีคำวินิจฉัย

| ช่อง | ความเสี่ยง | ตัวตัดสิน |
|---|---|---|
| `subject` (`050:37`), `body` (`:38`), `note` (`:110`), `decision_rationale` (`:64`) | free text ที่เจ้าหน้าที่พิมพ์เอง ไม่มีการกรองฝั่ง server ผู้ใช้พิมพ์ชื่อเด็กลงไปได้ | `รอ D0-2` (วัตถุประสงค์ของ participation comments), `รอ D0-4` |
| `evidence_ref` (`:114`) | ตั้งใจให้เป็นตัวชี้ตามคำอธิบายใน migration แต่ไม่มีการบังคับรูปแบบในโค้ด | `รอ D0-2` |
| `initiated_by`, `decided_by`, `assigned_to`, `actor_user_id` | ข้อมูลส่วนบุคคลของเจ้าหน้าที่ ผูกกับการตัดสินใจรายบุคคล | `รอ D0-4` |
| ระยะเวลาเก็บของ case และ event | ไม่มีกติกาลบ และ log แก้ไม่ได้ | `รอ D0-8` |

ข้อความเตือนในฟอร์ม (ร่าง ยังไม่อนุมัติ): "กรุณาอธิบายประเด็นโดยไม่ระบุชื่อนักเรียน เลขบัตรประชาชน หรือเบอร์โทรศัพท์" ถ้อยคำสุดท้ายต้องผ่าน DPO พร้อมกับ D0-2 และ D0-4 **ห้าม implement ด้วยร่างนี้แล้วถือว่าจบ**

participation comments เป็นหนึ่งในสี่สถานการณ์ที่ DPIA และ incident playbook ต้องครอบคลุม (`execution-plan-to-completion-2026-09-04.md:136`) จึงเปิดใช้จริงไม่ได้ก่อน A1-13 และ C2-2

---

## 12. การฝัง event ในงานเดิม (Phase 4 ข้อ 3)

master plan สั่งให้ฝัง event ใน emergency, vehicle request, transfer, roster/registration, inspection และ policy decision (`master-project-closure-plan.md:186`) ปัจจุบัน `linked_entity_type` เป็น VARCHAR(50) ที่ไม่มี allowlist ใด ๆ ในโค้ด (`participation.service.js:140`)

ค่าที่ **มีอยู่จริง** ในระบบ (เก็บจาก `entityType` ของ `logAudit` ทั่วทั้ง `backend/src`) และตรงกับหกงานที่ master plan ระบุ:

| งานตาม master plan | `entity_type` ที่ระบบใช้อยู่จริง | ตัวอย่างจุดอ้างอิง |
|---|---|---|
| Emergency | `emergency` | `backend/src/routes/driver.routes.js:643`, `backend/src/services/emergencyAdmin.service.js:35` |
| Vehicle request | `vehicle_request` | `backend/src/routes/admin.routes.js:1491`, `backend/src/routes/affiliation.routes.js:810` |
| Transfer | `student_transfer_request` | `backend/src/routes/admin.routes.js:1455`, `backend/src/routes/affiliation.routes.js:759` |
| Roster / registration | `roster_request`, `registration_roster_student`, `vehicle_school_registration` | มาจากชุด `entityType` ที่ใช้อยู่ใน `backend/src` |
| Inspection | `vehicle_inspection`, `vehicle_inspection_application`, `inspection_attempt` | `backend/src/routes/transport.routes.js:280` |
| Policy decision | `safety_policy_decision`, `decision_log` | `backend/src/routes/driver.routes.js:125` |

**สิ่งที่ยังไม่ตัดสิน:** จะฝังปุ่ม "เปิดเรื่องมีส่วนร่วม" ในงานใดบ้าง และงานใดที่ควรสร้าง event อัตโนมัติแทนการให้คนกด ขึ้นกับ C0-2 (ระดับผู้อนุมัติ) และ C0-4 (feature อยู่ใน scope หรือไม่) → `รอ C0-2` + `รอ C0-4`

**สิ่งที่ควรทำทันทีเมื่อได้ไฟเขียว:** เปลี่ยน `linked_entity_type` ให้ตรวจกับ allowlist ฝั่ง server ซึ่งยังไม่มี เพื่อไม่ให้เกิด taxonomy อิสระที่รวมเป็นตัวเลขไม่ได้ — เป็นเหตุผลเดียวกับที่ migration เขียนไว้ว่าทำไม `case_type` จึงเป็น ENUM (`050_participation_cases.sql:32-33`)

---

## 13. เงื่อนไขก่อนเริ่ม A1-2 และหลักฐานที่ต้องได้

### 13.1 ต้องมีครบก่อนเขียนโค้ดบรรทัดแรก

- [ ] C0-4 ยืนยันว่า PARTICIPATION_CASES ไม่ถูก defer
- [ ] C0-3 อนุมัติ IA และตำแหน่งเมนู
- [ ] C0-2 ตอบครบ: ระดับผู้อนุมัติ, ผู้กด DECIDED / ASSIGNED / FEEDBACK_SENT, โครงคิว, ค่า SLA
- [ ] D0-2 และ D0-4 ให้คำวินิจฉัยเรื่อง free text และการเก็บ actor id
- [ ] D0-8 กำหนดระยะเก็บและวิธีตอบคำขอสิทธิ์เจ้าของข้อมูลบน log ที่แก้ไม่ได้
- [ ] เพิ่ม addendum ในบันทึกการตัดสินใจสำหรับสามช่องที่ schema ไม่มี และค่า SLA ตั้งต้น (§2.6)
- [ ] migration 050 ถูก apply ในสภาพแวดล้อมเป้าหมายแล้ว (`backend/src/config/env.js:233-236`)

### 13.2 หลักฐานที่ A1-2 ต้องส่ง (ตาม `execution-plan-to-completion-2026-09-04.md:124`)

- sandbox: อย่างน้อยหนึ่ง workflow ต่อบทบาท เดินครบ SUBMITTED → FEEDBACK_SENT → CLOSED
- cross-scope tests
- append-only test

เทสต์ที่มีอยู่แล้วครอบคลุม logic ฝั่ง service และเงื่อนไข scope (`backend/tests/participation.unit.test.js`) **แต่ยังไม่มีเทสต์ใดที่แตะ UI** เทสต์ที่ต้องเพิ่มเมื่อ A1-2 เริ่ม:

| สิ่งที่ต้องทดสอบ | เหตุผล |
|---|---|
| ปุ่มที่แสดงตรงกับ `ALLOWED_EVENTS` ทุกสถานะ | กันกติกาสองชุดเพี้ยนกัน (§6.2) |
| ปุ่ม "แจ้งผลกลับ" ไม่ปรากฏก่อนสถานะ COMPLETED | กันการปิดวงจรแบบหลอก |
| Timeline ไม่มีปุ่มแก้หรือลบ | ข้อจำกัด append-only (§10) |
| `closed_feedback_loop_pct = null` แสดงว่ายังไม่มีเรื่อง ไม่ใช่ 0% | `participation.service.js:271` และเทสต์ `:199-204` |
| เมนูหายเมื่อ flag ปิด และเส้นทาง redirect ไม่ใช่ 404 | §4 ข้อ 3 |
| หน้าจอไม่พูดว่าไม่มีสิทธิ์เมื่อ backend คืน 404 | §5.5 |
| duplicate submission และ reassignment | master plan ข้อ 8 (`master-project-closure-plan.md:191`) ซึ่งยังไม่มีเทสต์ในชุดปัจจุบัน |
| เส้น ACKNOWLEDGED → ASSIGNED → COMPLETED → FEEDBACK_SENT → CLOSED ที่ไม่มี `DECIDED` | §8 — ปิดวงจรได้โดยไม่มีมติ ต้องมีเทสต์ที่ยืนยันว่าหน้าจอและ dashboard ไม่แสดงเรื่องแบบนี้ว่า "ตัดสินแล้ว" |

### 13.3 สิ่งที่ตรวจจากเครื่องนี้ไม่ได้

พฤติกรรมบน production, ผลกระทบด้าน performance ของ `GET /summary` ที่ไม่มี LIMIT, พฤติกรรมจริงของ rate limit (ถูก skip เมื่อ `NODE_ENV=test` ที่ `backend/src/app.js:120`) และการใช้งานจริงของผู้ใช้ ทั้งหมดต้องรอ staging (B2-2) และ UAT (C3-1)

---

## 14. อ้างอิงไฟล์ที่อ่านจริง

| ไฟล์ | ใช้อ้างอะไร |
|---|---|
| `backend/migrations/050_participation_cases.sql` | schema, ENUM, field, เหตุผลการลดข้อมูล |
| `backend/migrations/rollback/050_participation_cases_rollback.sql` | เงื่อนไข rollback |
| `backend/src/services/participation.service.js` | state machine, validation, summary, persistence |
| `backend/src/routes/participation.routes.js` | endpoint, เงื่อนไข scope, ตัวกรองที่รองรับ |
| `backend/tests/participation.unit.test.js` | คุณสมบัติที่ถูกล็อกด้วยเทสต์ |
| `backend/src/app.js` | mount ตาม flag, rate limit |
| `backend/src/config/env.js` | นิยาม feature flag |
| `backend/src/config/researchMetrics.js` | ตัวชี้วัดที่ผูกกับ participation case |
| `backend/src/routes/auth.routes.js`, `frontend/src/hooks/useAuth.jsx`, `frontend/src/components/Sidebar.jsx` | กลไกส่ง flag ให้ frontend และการซ่อนเมนู |
| `backend/src/routes/admin.routes.js`, `backend/src/routes/affiliation.routes.js`, `backend/src/routes/driver.routes.js`, `backend/src/routes/transport.routes.js`, `backend/src/services/emergencyAdmin.service.js` | เส้นทางอนุมัติซ้ำสองระดับ และ `entity_type` ที่ระบบใช้จริง |
| `backend/scripts/generate-rbac-matrix.js` | เหตุผล RBAC ที่บันทึกไว้ และจุดที่ไม่ตรงกับโค้ด |
| `docs/project-closure/master-project-closure-plan.md` | ข้อกำหนด Phase 4 |
| `docs/project-closure/execution-plan-to-completion-2026-09-04.md` | นิยาม A0-4 / A1-2 และรายการ decision |
| `docs/project-closure/sandbox-verification-2026-09-04.md` | ผลเดินเส้นทางบน MySQL จริง |
| `docs/role-menu-participatory-research-audit-2026-09-04.md` | ข้อเสนอ inbox เดียว และรายการข้อมูลขั้นต่ำ |
| `docs/ui-label-enforcement.md` | กติกาคำบน UI |
| `CLAUDE.md` | §8 RBAC, §12 กติกาการพัฒนา |
