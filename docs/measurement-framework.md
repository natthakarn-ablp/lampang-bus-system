# กรอบการวัดประสิทธิภาพและประสิทธิผล
# Lampang Bus System — Measurement Framework

**วันที่:** เมษายน 2569  
**วัตถุประสงค์:** ปรับระบบให้รองรับการวัด Efficiency + Effectiveness เพื่อการวิจัย

---

## 1. สิ่งที่ระบบเก็บได้แล้ว (Evidence Layer ปัจจุบัน)

### ตารางหลักฐาน

| ตาราง | ข้อมูล | ปริมาณ | วัดอะไรได้ |
|-------|--------|--------|-----------|
| `audit_logs` | ทุก action + user + timestamp + IP | 294 records | Login frequency, action timing, role activity |
| `checkin_logs` | เช็กอิน/เช็กเอาท์รายคน + เวลา + ช่องทาง | 66 records | Check-in timeliness, completion rate, driver consistency |
| `daily_status` | สถานะรับ-ส่งรายวัน/รายคน | 66 records | Daily coverage, morning/evening KPI |
| `vehicle_inspections` | ผลตรวจสภาพรถ + วันหมดอายุ | 2 records | Inspection coverage, risk closure |
| `student_leaves` | การลา + เหตุผล + ผู้แจ้ง + ยกเลิก | 8 records | Leave patterns, correction rate |
| `emergency_logs` | เหตุฉุกเฉิน + ผลดำเนินการ | 0 records | Incident response, resolution |
| `line_message_logs` | ข้อความ LINE + ผลลัพธ์ | 43 records | Parent engagement, binding rate |
| `users` | last_login, is_active, password_changed_at | 66 users | Active rate, adoption rate |
| `driver_shifts` *(2026-06-22)* | รอบขับ + รถ + เวลาเริ่ม/สิ้นสุด + สถานะ | 0 records (new) | Shift coverage, round completion rate, driver-vehicle pairing |
| `vehicle_verifications` *(2026-06-22)* | คำขอตรวจรับรองรถ + ผล + ผู้ตรวจ | 0 records (new) | Verification throughput, approval rate, queue backlog |
| `transfer_requests` *(Phase 10.13B)* | คำขอโอนย้ายนักเรียน + ผล + เหตุผล | 0 records (new) | Transfer volume, approval rate, duplicate-code blocks |
| `vehicle_requests` *(Phase 10.13B)* | คำขอเกี่ยวกับรถ (RESTORE/use/add/inspect) | 0 records (new) | Restore frequency, request type distribution |

---

## 2. ตัวชี้วัดที่วัดได้ทันที (ไม่ต้องแก้ระบบ)

### Driver Efficiency
| ตัวชี้วัด | แหล่งข้อมูล | SQL/Logic |
|-----------|------------|-----------|
| อัตราเช็กอินรายวัน | `daily_status` | COUNT(morning_done=TRUE) / COUNT(*) per date |
| เวลาเช็กอินเฉลี่ย | `daily_status.morning_ts` | AVG(TIME(morning_ts)) per vehicle |
| ความสม่ำเสมอ (% วันที่ทำ) | `daily_status` + `checkin_logs` | COUNT DISTINCT check_date per driver / total working days |
| อัตราการลา | `student_leaves` | COUNT per vehicle per month |
| ความครบถ้วนรอบขับ (2026-06-22) | `driver_shifts` | SUM(status='COMPLETED') / COUNT(*) per date |
| เวลาเริ่มรอบเฉลี่ย | `driver_shifts.started_at` | AVG(TIME(started_at)) per session |
| รอบที่เริ่มแล้วไม่จบ | `driver_shifts` WHERE status='ACTIVE' AND started_at < today | COUNT (orphan shifts) |

### School Efficiency
| ตัวชี้วัด | แหล่งข้อมูล | SQL/Logic |
|-----------|------------|-----------|
| ความครบถ้วนข้อมูลนักเรียน | `students` | COUNT(vehicle_id IS NOT NULL) / COUNT(*) |
| ความเร็วในการนำเข้าข้อมูล | `audit_logs` WHERE action='IMPORT' | timestamp analysis |
| จำนวนครั้งที่แก้ไขข้อมูล | `audit_logs` WHERE entity_type='student' AND action='UPDATE' | COUNT per school |

### Transport Effectiveness
| ตัวชี้วัด | แหล่งข้อมูล | SQL/Logic |
|-----------|------------|-----------|
| อัตราการตรวจสภาพรถ | `vehicle_inspections` vs `vehicles` | inspected_count / total_vehicles |
| อัตราผ่านการตรวจ | `vehicle_inspections` | SUM(result='PASSED') / COUNT(*) |
| ความครอบคลุมประกันภัย | `vehicles` | SUM(insurance_expiry > NOW()) / COUNT(*) |
| อัตราตรวจรับรองรถ (2026-06-22) | `vehicle_verifications` vs `vehicles` | verified_count / total_vehicles |
| คิวตรวจรับรองค้าง | `vehicle_verifications` WHERE status='PENDING' | COUNT + AVG wait time |
| อัตราอนุมัติรับรอง | `vehicle_verifications` | SUM(result='APPROVED') / COUNT(*) |

### Admin Efficiency
| ตัวชี้วัด | แหล่งข้อมูล | SQL/Logic |
|-----------|------------|-----------|
| Active account rate | `users` | SUM(is_active AND last_login IS NOT NULL) / COUNT(*) |
| Password reset frequency | `audit_logs` WHERE new_value LIKE '%reset_password%' | COUNT per month |
| Login success/failure ratio | `audit_logs` WHERE action='LOGIN' | COUNT by result |
| อัตราอนุมัติโอนย้าย (Phase 10.13B) | `transfer_requests` | SUM(status='APPROVED') / COUNT(*) |
| ระยะเวลาตอบคำขอโอนย้าย | `transfer_requests` | AVG(approved_at - created_at) |
| อัตรากู้คืนรถ (Phase 10.13B) | `vehicle_requests` WHERE type='RESTORE' | SUM(status='APPROVED') / COUNT(*) |
| สุขภาพข้อมูลคนขับ (Phase 10.13B) | `drivers` + `driver_vehicle_assignments` | orphan drivers / duplicate accounts / unassigned |

### Province/Affiliation Effectiveness
| ตัวชี้วัด | แหล่งข้อมูล | SQL/Logic |
|-----------|------------|-----------|
| ภาพรวม KPI เช้า/เย็นรายวัน | `daily_status` | Aggregate per date |
| อัตราเหตุฉุกเฉิน | `emergency_logs` | COUNT per month per school |
| อัตราโรงเรียนที่ครบ 100% | `daily_status` + `students` | Schools where all students checked in |

---

## 3. ตัวชี้วัดที่ยังวัดไม่ได้ (ต้องเพิ่มระบบ)

| ตัวชี้วัด | ขาดอะไร | แนวทาง |
|-----------|---------|--------|
| **Dashboard view before decision** | ไม่มี event log ตอนเปิดดู dashboard | เพิ่ม `dashboard_views` event ใน audit_logs |
| **Policy response latency** (จังหวัด) | ไม่มี record ว่าผู้บริหารสั่งการเมื่อไร | เพิ่ม action button "รับทราบ/สั่งการ" + event |
| **Risk closure SLA** (ขนส่ง) | `vehicle_inspections` ไม่มี "opened_at" vs "resolved_at" | เพิ่ม status workflow: OPEN → IN_PROGRESS → CLOSED |
| **Incident follow-up** | `emergency_logs.result` เป็น free text | เพิ่ม structured status: REPORTED → RESOLVED |
| **Parent notification delivery** | `notifications.sent` อยู่แล้ว แต่ไม่มี read/click tracking | เพิ่ม LINE read receipt หรือ LIFF view event |
| **Data completeness score** | ต้องคำนวณจากหลาย field | สร้าง computed metric |

---

## 4. แผนปรับระบบ 3 ระยะ

### ระยะ 1: Quick Wins (ใช้ของเดิม + log เพิ่มเล็กน้อย)
**เวลา: 1-2 วัน | ไม่ต้องแก้ schema**

1. **เพิ่ม dashboard view event ใน audit_logs**
   - ทุกครั้งที่เปิด dashboard → `logAudit({ action: 'LOGIN', entityType: 'dashboard_view', entityId: role })`
   - แก้ที่: dashboard pages ของทุก role (เพิ่ม useEffect → POST audit)
   - หรือแก้ที่ backend middleware (log every GET to /dashboard)

2. **สร้าง Research Export endpoint**
   - `GET /api/admin/research-export`
   - ส่ง CSV/JSON dump ของ:
     - audit_logs (anonymized)
     - checkin_logs aggregate
     - vehicle_inspections
     - daily_status aggregate
   - Admin-only access

3. **เพิ่ม Data Completeness Score บน dashboard**
   - คำนวณจาก: students มี vehicle_id, มี parent, vehicles มี insurance_expiry
   - แสดงเป็น KPI card เพิ่มเติม

### ระยะ 2: Structured Event Model (เพิ่ม table/field)
**เวลา: 3-5 วัน | ต้องแก้ schema เล็กน้อย**

1. **เพิ่ม `risk_cases` table**
   ```sql
   CREATE TABLE risk_cases (
     id INT AUTO_INCREMENT PRIMARY KEY,
     vehicle_id VARCHAR(20),
     risk_type ENUM('no_inspection','failed_inspection','no_insurance','expired_insurance'),
     status ENUM('OPEN','IN_PROGRESS','RESOLVED','DISMISSED'),
     opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     resolved_at TIMESTAMP NULL,
     resolved_by INT NULL,
     notes TEXT
   );
   ```
   - ใช้วัด: Risk closure SLA, non-recurrence rate

2. **เพิ่ม `emergency_logs.status`**
   ```sql
   ALTER TABLE emergency_logs ADD COLUMN status ENUM('REPORTED','INVESTIGATING','RESOLVED') DEFAULT 'REPORTED';
   ALTER TABLE emergency_logs ADD COLUMN resolved_at TIMESTAMP NULL;
   ALTER TABLE emergency_logs ADD COLUMN resolved_by INT NULL;
   ```
   - ใช้วัด: Incident response time, resolution rate

3. **เพิ่ม dashboard action buttons**
   - จังหวัด: ปุ่ม "รับทราบ" / "สั่งการ" ที่รายการแจ้งเตือน
   - สังกัด: ปุ่ม "ติดตามโรงเรียน" ที่รายการค้าง
   - ทุกปุ่มบันทึก event ลง audit_logs

### ระยะ 3: Evaluation Dashboards + Research Export
**เวลา: 5-7 วัน**

1. **หน้า Evaluation Dashboard (admin-only)**
   - แสดง KPI ทุก role ในหน้าเดียว
   - Trend: สัปดาห์/เดือน
   - Comparison: before vs after intervention

2. **Research Data Export**
   - ส่งออก anonymized dataset สำหรับวิจัย
   - Format: CSV with codebook
   - ครอบคลุม: usage logs, outcome data, safety metrics

3. **Baseline Snapshot**
   - สร้าง snapshot ข้อมูล ณ จุดเริ่มต้นวิจัย
   - เก็บเป็น JSON/CSV archive

---

## 5. Mapping ตัวชี้วัด → Evidence → Source

| Role | Efficiency Metric | Evidence | Source |
|------|------------------|----------|--------|
| Driver | อัตราเช็กอินรายวัน | daily_status.morning_done | ✅ มีแล้ว |
| Driver | ความสม่ำเสมอ | COUNT DISTINCT dates in daily_status | ✅ มีแล้ว |
| Driver | ความครบถ้วนรอบขับ (2026-06-22) | driver_shifts.status='COMPLETED' | ✅ มีแล้ว (ใหม่) |
| School | ความครบถ้วนข้อมูล | students.vehicle_id IS NOT NULL | ✅ มีแล้ว |
| School | ภาระงานลดลง | audit_logs IMPORT/UPDATE count per month | ✅ มีแล้ว |
| Transport | อัตราตรวจสภาพ | vehicle_inspections vs vehicles | ✅ มีแล้ว |
| Transport | อัตราตรวจรับรองรถ (2026-06-22) | vehicle_verifications vs vehicles | ✅ มีแล้ว (ใหม่) |
| Transport | Risk closure time | risk_cases.opened_at → resolved_at | ❌ ต้องเพิ่ม table |
| Province | Dashboard ใช้ก่อนประชุม | audit_logs dashboard_view | ❌ ต้องเพิ่ม event |
| Province | Policy response time | audit_logs action='ACKNOWLEDGE' | ❌ ต้องเพิ่ม action button |
| Affiliation | Proactive detection | audit_logs dashboard_view before emergency | ❌ ต้องเพิ่ม event |
| Admin | Active account rate | users.last_login IS NOT NULL | ✅ มีแล้ว |
| Admin | Data health score | computed from multiple tables | ❌ ต้องคำนวณ |
| Admin | อัตราอนุมัติโอนย้าย (Phase 10.13B) | transfer_requests | ✅ มีแล้ว (ใหม่) |
| Admin | สุขภาพข้อมูลคนขับ (Phase 10.13B) | drivers + driver_vehicle_assignments | ✅ มีแล้ว (ใหม่) |

---

## 6. สรุป

| ชั้น | สถานะ | สิ่งที่ต้องทำ |
|------|-------|-------------|
| **Operational** | ✅ ครบ | ทุก role ใช้งานได้จริง + ฟีเจอร์ใหม่ 2026-06-22 (verification, shift, transfer, driver-integrity) |
| **Evidence** | ⚠️ บางส่วน | มี audit_logs + checkin_logs + driver_shifts + vehicle_verifications + transfer_requests + vehicle_requests (ใหม่) แต่ยังไม่มี dashboard_view event, risk_cases, incident status |
| **Evaluation** | ❌ ยังไม่มี | ต้องสร้าง evaluation dashboard + research export |
| **Research** | ❌ ยังไม่มี | ต้องสร้าง anonymized export + baseline snapshot |

---

*เอกสารนี้จัดทำเพื่อรองรับการวิจัยเชิงประเมินผลระบบ — เมษายน 2569*
*อัปเดตล่าสุด: 2026-06-23 — เพิ่ม evidence layer สำหรับฟีเจอร์ใหม่ (driver shifts, vehicle verification, transfer/vehicle requests, driver integrity)*
