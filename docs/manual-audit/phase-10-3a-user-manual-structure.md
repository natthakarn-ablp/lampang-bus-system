# Phase 10.3A — User Manual Structure

*Audit date: 2026-05-14*
*Source commit: `db9ca0e`*

Recommended structure for the final user manual (Thai). Each chapter has a purpose, target reader, required screenshots (by IDs from `phase-10-3a-screenshot-checklist.md`), content outline, and a manual-priority label (**must-have** / **should-have** / **optional**).

---

## 1. บทนำ (Introduction)

- **Purpose:** Orient any reader to the system, the audience, and how to use this manual.
- **Target reader:** Everyone.
- **Screenshots:** —
- **Content outline:**
  - ชื่อระบบ / ขอบเขตการใช้งาน (จังหวัดลำปาง — 5 หน่วยงานสังกัด)
  - สรุปบทบาทผู้ใช้ทั้ง 7 (admin / province / affiliation / school / driver / transport / parent)
  - วิธีอ่านคู่มือ — แต่ละบทจัดตามบทบาท ผู้อ่านสามารถข้ามไปบทของบทบาทของตนได้
  - คำศัพท์สั้น ๆ (สังกัด / โรงเรียน / รถรับส่ง / เช็กอิน / เช็กเอาท์ / สถานะรายวัน)
- **Priority:** **must-have**

---

## 2. ภาพรวมระบบ (System Overview)

- **Purpose:** Single-page mental model — what the system does, what data it stores, what goes in/out.
- **Target reader:** Everyone.
- **Screenshots:** A-01 (admin dashboard for the "control panel" feel), L-01 (LINE OA).
- **Content outline:**
  - ระบบเดิม → ระบบใหม่: Google Sheets → MySQL + Web App + LINE OA
  - แผนภาพภาพรวม (frontend / backend / DB / LINE / nginx + Cloudflare)
  - 5 หน่วยงานสังกัด (จาก Phase 10.1A/B)
  - การไหลของข้อมูลในหนึ่งวัน: คนขับเช็กอิน → ผู้ปกครองได้รับการแจ้งเตือน → โรงเรียน/สังกัด/จังหวัด เห็นสถานะ
- **Priority:** **must-have**

---

## 3. การเข้าสู่ระบบและการเปลี่ยนรหัสผ่าน (Login & Password)

- **Purpose:** Get any user logged in cleanly the first time.
- **Target reader:** Everyone.
- **Screenshots:** S-01, S-02, S-03, E-02.
- **Content outline:**
  - ไปยัง https://schoolbus.503200.xyz/login
  - ฟอร์มชื่อผู้ใช้ + รหัสผ่าน (รูปแบบของแต่ละบทบาท — OBEC 6 หลัก / ทะเบียนรถ / ฯลฯ)
  - กรอกรหัสผ่านผิด → ข้อความภาษาไทย
  - เมื่อต้องเปลี่ยนรหัสผ่านครั้งแรก (must_change_password) — บัญชีที่สร้างจากการนำเข้า (Phase 10.2A) จะเข้าเส้นทางนี้
  - การลืมรหัสผ่าน → ขอผู้ดูแลรีเซ็ต (admin / affiliation reset-password endpoint)
  - การออกจากระบบ (POST /api/auth/logout — revoke refresh token)
- **Priority:** **must-have**

---

## 4. สิทธิ์ผู้ใช้งานและขอบเขตข้อมูล (Roles & Scope)

- **Purpose:** Make crystal-clear who sees what.
- **Target reader:** Everyone; especially decision-makers and IT.
- **Screenshots:** Side-by-side sidebar shots: A-02 / P-02 / F-02 / H-02 / D-02 / T-02 (so the reader can see "I am Y; here is my menu").
- **Content outline:**
  - ตารางสรุปบทบาท × ขอบเขต (admin = ทุกหน่วยงาน; province = อ่านได้ทุกอย่าง ไม่เขียน; affiliation = สังกัดของตน; school = โรงเรียนของตน; driver = รถของตน; transport = ตรวจสภาพรถ; parent = บุตรหลานที่ผูกไว้)
  - บัญชีย่อย school (grade-teacher) มีข้อจำกัดอย่างไร — รายการ sidebar ที่ถูกซ่อน + endpoint ที่ถูกบล็อก
  - การจัดการสังกัด — รายชื่อ AFF001–AFF005 และผู้ดูแลที่ผูกอยู่ (จาก Phase 10.1A/B)
- **Priority:** **must-have**

---

## 5. คู่มือผู้ดูแลระบบ (Admin Guide)

- **Purpose:** Operations playbook for admins — user CRUD, audit, system health, research export.
- **Target reader:** ผู้ดูแลระบบกลาง
- **Screenshots:** A-01 → A-11.
- **Content outline:**
  - 5.1 หน้าศูนย์ควบคุม
  - 5.2 จัดการบัญชีผู้ใช้
    - สร้างผู้ใช้ใหม่ (เลือก role + scope_id; affiliation dropdown แสดง 5 หน่วยงาน — verifies Phase 10.1A/B)
    - แก้ไข / รีเซ็ตรหัสผ่าน / ปิดใช้งาน / ลบ (soft-delete)
  - 5.3 จัดการจุดรับส่ง (admin มองข้ามทุกโรงเรียน)
  - 5.4 ตำแหน่งรถ realtime
  - 5.5 ประวัติการใช้งาน + การส่งออก CSV
  - 5.6 สุขภาพระบบ — KPIs ปฏิบัติการ (Phase 9.x มีระบบ smoke + alert ทำงานอยู่ — ดูภาคผนวก 16)
  - 5.7 รายงานวิจัย — research-export (cross-link ถึงบทที่ 12)
- **Priority:** **must-have**

---

## 6. คู่มือมุมมองจังหวัด (Province Guide)

- **Purpose:** Read-only province-wide oversight.
- **Target reader:** ผู้ใช้บทบาท province
- **Screenshots:** P-01 → P-10.
- **Content outline:**
  - 6.1 หน้าภาพรวมจังหวัด
  - 6.2 ดูสังกัด / โรงเรียน / นักเรียน / รถ
  - 6.3 สถานะรายวัน + ค้นหาทะเบียนรถ (Phase 9.11)
  - 6.4 ตำแหน่งรถ + แผนที่จุดรับส่ง (read-only)
  - 6.5 เหตุฉุกเฉิน
  - 6.6 ประวัติการแก้ไข + ส่งออก CSV
- **Priority:** **must-have**

---

## 7. คู่มือสังกัด / เขตพื้นที่ / หน่วยงาน (Affiliation Guide)

- **Purpose:** End-to-end workflow for affiliation admins — including the headline workflow of adding many schools.
- **Target reader:** ผู้ใช้บทบาท affiliation (lpg1 / lpg2 / lpg3 / lpglp / lpgpeo)
- **Screenshots:** F-01 → F-13.
- **Content outline:**
  - 7.1 หน้าภาพรวมสังกัด
  - 7.2 ดูโรงเรียน / นักเรียน / รถในสังกัด
  - 7.3 สถานะรายวัน (plate autocomplete)
  - 7.4 ตำแหน่งรถ realtime + แผนที่จุดรับส่ง (read-only)
  - **7.5 เพิ่มโรงเรียนใหม่** (Phase 10.2A) — ส่วนนี้เน้นพิเศษ
    - 7.5.1 เพิ่มทีละโรงเรียน (Section A) — รหัส 6-10 หลัก + ชื่อ + ผู้ใช้ OBEC 6 หลัก
    - 7.5.2 เพิ่มหลายโรงเรียนจาก Excel (Section B) — template / preview / commit
    - 7.5.3 บัญชีที่สร้างล่าสุด (Section C) — read-only
    - 7.5.4 กฎความปลอดภัย — bcrypt + must_change_password + ไม่ส่งรหัสผ่าน plaintext กลับ
  - 7.6 เหตุฉุกเฉิน + ประวัติการแก้ไข
  - 7.7 รายงาน (cross-link ถึงบทที่ 12)
- **Priority:** **must-have**

---

## 8. คู่มือโรงเรียน (School Guide)

- **Purpose:** Two audiences in one chapter: full school account (principal/director) and grade-teacher sub-account.
- **Target reader:** ผู้ใช้บทบาท school
- **Screenshots:** H-01 → H-12.
- **Content outline:**
  - 8.1 หน้าภาพรวมโรงเรียน
  - 8.2 จัดการนักเรียน (CRUD + Excel import + CSV export)
  - 8.3 จัดการรถรับส่ง (bulk vehicle import for full account only)
  - 8.4 แผนที่จุดรับส่ง — สร้างจุดและจัดกลุ่มนักเรียน
  - 8.5 ตำแหน่งรถ realtime
  - 8.6 อนุมัติคำขอรายชื่อ (approve / reject)
  - 8.7 บัญชีครูประจำสายชั้น (full account only) — สร้าง / แก้ไข / ลบ + grade_scope
  - 8.8 เหตุฉุกเฉิน + ประวัติการแก้ไข
  - 8.9 ข้อจำกัดของบัญชีครูประจำสายชั้น — รายการ sidebar ที่ถูกซ่อน + endpoint ที่ถูกบล็อก (`requireFullSchoolScope`)
  - 8.10 รายงาน (cross-link)
- **Priority:** **must-have**

---

## 9. คู่มือคนขับรถ (Driver Guide)

- **Purpose:** Mobile-first daily workflow for drivers; emphasize one-handed flows.
- **Target reader:** ผู้ใช้บทบาท driver
- **Screenshots:** D-01 → D-09 — **all mobile (390 × 844)**.
- **Content outline:**
  - 9.1 เข้าสู่ระบบด้วยทะเบียนรถ (เช่น `นข 1571 ลำปาง`) + รหัสผ่าน
  - 9.2 หน้าภาพรวมสถานะรับส่ง — ดูรายชื่อนักเรียน
  - 9.3 เช็กอิน/เช็กเอาท์ (รายคน + เช็กอินทั้งคัน)
  - 9.4 แผนที่จุดรับส่ง — สร้าง / แก้ไขจุด + จัดกลุ่มนักเรียน
  - 9.5 แจ้งเหตุฉุกเฉิน
  - 9.6 ข้อมูลคนขับ — รูป / เบอร์โทร / ลางาน
  - 9.7 คำขอรายชื่อ — ผู้ปกครองขอเปลี่ยน roster
  - 9.8 การส่งตำแหน่งอัตโนมัติ (จำกัด 6 ครั้ง/นาที) — อธิบายแค่ "แอปทำให้อัตโนมัติ"
- **Priority:** **must-have**

---

## 10. คู่มือเจ้าหน้าที่ตรวจสอบรถรับส่ง (Transport Guide)

- **Purpose:** Inspection lifecycle.
- **Target reader:** ผู้ใช้บทบาท transport
- **Screenshots:** T-01 → T-07.
- **Content outline:**
  - 10.1 หน้าภาพรวมตรวจสภาพรถ
  - 10.2 รายการรถ + filter status (PASSED / FAILED / NEEDS_FIX / PENDING)
  - 10.3 เพิ่มรถใหม่เพื่อตรวจสภาพ
  - 10.4 บันทึกผลตรวจ
  - 10.5 แก้ไขผลตรวจ
  - 10.6 ดูแผนที่จุดรับส่ง (read-only overlay)
- **Priority:** **must-have**

---

## 11. คู่มือผู้ปกครองผ่าน LINE OA (Parent via LINE OA)

- **Purpose:** Parents have no website username; they use LINE.
- **Target reader:** ผู้ปกครอง
- **Screenshots:** L-01 → L-09.
- **Content outline:**
  - 11.1 เพิ่มเพื่อน LINE OA (link / QR code)
  - 11.2 ผูกบัญชีบุตรหลาน
    - ขั้นที่ 1: พิมพ์ "ผูกบัญชี"
    - ขั้นที่ 2: กรอกเบอร์โทรที่ลงทะเบียนไว้กับโรงเรียน
    - ขั้นที่ 3: กรอกรหัสนักเรียน
    - ขั้นที่ 4: ระบบยืนยัน
  - 11.3 ดูสถานะวันนี้ — "สถานะ"
  - 11.4 ดูข้อมูลบุตร — "ข้อมูลบุตร"
  - 11.5 ยกเลิกผูกบัญชี — "ยกเลิกผูกบัญชี" + "ยืนยันยกเลิก"
  - 11.6 เปลี่ยนบัญชี — "เปลี่ยนบัญชี" + "ยืนยันเปลี่ยนบัญชี"
  - 11.7 การแจ้งเตือนอัตโนมัติเมื่อรับ / ส่ง
  - 11.8 LIFF — ดูผ่านหน้า web ของ LINE
- **Priority:** **must-have**

---

## 12. รายงานและการส่งออกข้อมูล (Reports & Exports)

- **Purpose:** Unify the export story across roles.
- **Target reader:** school / affiliation / province / admin
- **Screenshots:** subset from A-06, A-11, F-13, H-12, P-10 (existing export views).
- **Content outline:**
  - 12.1 รายงานประจำวัน (`/reports/daily`)
  - 12.2 รายงานประจำเดือน (`/reports/monthly`)
  - 12.3 รายงานสรุป (`/reports/summary`)
  - 12.4 ส่งออก Excel / CSV / PDF — เลือก format
  - 12.5 ส่งออกข้อมูลวิจัย (admin only — research export)
  - 12.6 ส่งออกประวัติการใช้งาน (audit log CSV, per role)
  - 12.7 ข้อแนะนำการเปิด CSV ภาษาไทยใน Excel (BOM auto-handled)
- **Priority:** **must-have**

---

## 13. การนำเข้าข้อมูล (Bulk Imports)

- **Purpose:** All bulk-import flows in one place.
- **Target reader:** school (full) / affiliation
- **Screenshots:** F-04 → F-09 (school accounts — Phase 10.2A), H-05, H-06, H-08, E-04, E-05.
- **Content outline:**
  - 13.1 หลักการนำเข้าข้อมูล (preview → commit)
  - 13.2 นำเข้าโรงเรียนจาก Excel (affiliation — Phase 10.2A)
    - ดาวน์โหลด template
    - แก้ไข Excel — คอลัมน์ school_code / school_name / username / initial_password
    - กฎ validation (รหัส 6-10 หลัก / username 6 หลัก / รหัสซ้ำ / ชื่อผู้ใช้ซ้ำ)
    - ตรวจสอบ — preview table
    - ยืนยันนำเข้า
    - กฎความปลอดภัยรหัสผ่าน (bcrypt + must_change_password)
  - 13.3 นำเข้านักเรียนจาก Excel (school)
  - 13.4 นำเข้ารถจาก Excel (school, full account only)
  - 13.5 การแก้ไขความผิดพลาด — ดูข้อความ Thai ในตาราง preview
- **Priority:** **must-have**

---

## 14. การแก้ไขปัญหาเบื้องต้น (Troubleshooting)

- **Purpose:** Self-help for common user-side problems.
- **Target reader:** Everyone.
- **Screenshots:** E-01 → E-07.
- **Content outline:**
  - 14.1 ลืมรหัสผ่าน → ขอผู้ดูแล
  - 14.2 ล็อกอินไม่ได้ — ตรวจสอบบทบาท + ขอบเขต
  - 14.3 ไม่เห็นโรงเรียน/นักเรียน → ตรวจสอบสังกัด/scope
  - 14.4 ดาวน์โหลด Excel แล้วเปิดไม่ได้ — refresh browser cache (Ctrl+Shift+R) — เป็นจุดที่เคยพบใน Phase 10.2A
  - 14.5 ผู้ปกครองไม่ได้รับการแจ้งเตือน LINE → ตรวจ "สถานะ" จากบอท / re-bind
  - 14.6 GPS ไม่อัปเดต → ดูสีของ chip "ไม่อัปเดตเกิน 5 นาที" / "ความแม่นยำต่ำ"
  - 14.7 Import row ไม่ผ่าน — ดูข้อความใน preview table + วิธีแก้
- **Priority:** **must-have**

---

## 15. คำถามที่พบบ่อย (FAQ)

- **Purpose:** Short Q&A for the support inbox.
- **Target reader:** Everyone.
- **Screenshots:** —
- **Content outline:** ~15 questions max. Examples:
  - Q: บัญชีย่อยครูประจำสายชั้นทำอะไรได้บ้าง?
  - Q: ทำไมเพิ่มหน่วยงานในระบบไม่ได้? (A: admin migration only)
  - Q: ทำไม `/health` รายงาน WARN commit drift?
  - Q: ทำไมการ import ข้าม 2 รายการ?
  - Q: ผู้ปกครองคนเดียวมีลูกหลายคนได้ไหม?
- **Priority:** **should-have**

---

## 16. ภาคผนวก: ตารางสิทธิ์และคำอธิบายสถานะต่าง ๆ (Appendix)

- **Purpose:** One-page reference for support and audits.
- **Target reader:** Support + ผู้ดูแลระบบ
- **Screenshots:** E-07 optional (smoke output for ops).
- **Content outline:**
  - 16.1 ตารางสิทธิ์ครบทุก endpoint (จาก `phase-10-3a-api-permission-matrix.md`)
  - 16.2 ตารางสถานะ checkin_logs.status (CHECKED_IN / CHECKED_OUT / ABSENT / CANCELLED)
  - 16.3 ตารางสถานะ vehicle_inspections.result (PASSED / FAILED / NEEDS_FIX / PENDING)
  - 16.4 ตารางสถานะ LINE (linked / unlinked / pending verify)
  - 16.5 รหัส error การ import (SCHOOL_CODE_EXISTS / USERNAME_EXISTS / DUPLICATE_IN_FILE / DUPLICATE_USERNAME_IN_FILE / INVALID_SCHOOL_CODE / MISSING_SCHOOL_NAME / USERNAME_REQUIRED / INVALID_USERNAME / WEAK_PASSWORD)
  - 16.6 5 หน่วยงานสังกัด — AFF001–AFF005 (Phase 10.1A/B)
  - 16.7 4 systemd timers ของระบบ monitoring (Phase 9.17–9.19) — สำหรับ ops/IT
  - 16.8 พจนานุกรมสั้น — Thai term → English term ↔ DB column
- **Priority:** **should-have**

---

## Priority summary

| Chapter | Priority |
|---|---|
| 1 บทนำ | must-have |
| 2 ภาพรวมระบบ | must-have |
| 3 การเข้าสู่ระบบ / รหัสผ่าน | must-have |
| 4 สิทธิ์และขอบเขต | must-have |
| 5 Admin | must-have |
| 6 Province | must-have |
| 7 Affiliation | must-have |
| 8 School | must-have |
| 9 Driver | must-have |
| 10 Transport | must-have |
| 11 Parent (LINE OA) | must-have |
| 12 Reports / Exports | must-have |
| 13 Bulk Imports | must-have |
| 14 Troubleshooting | must-have |
| 15 FAQ | should-have |
| 16 Appendix | should-have |

**No "optional" chapters identified.** All 14 must-have + 2 should-have are within scope for the first published version.

## Writing-time ordering recommendation

To minimize churn, write in this order:
1. **Chapter 4** (roles/scope) first — sets vocabulary for all others.
2. **Chapter 3** (login) — second-most cited.
3. **Chapters 5–11** (role-specific) — six can be written in parallel by different writers if needed; chapter 7 (affiliation) gets the most net-new content because of Phase 10.2A.
4. **Chapter 12 + 13** (cross-cutting export + import).
5. **Chapter 14** (troubleshooting) — best written after 5–13 because the FAQ items emerge naturally.
6. **Chapters 1, 2, 15, 16** (front + back matter) last.
