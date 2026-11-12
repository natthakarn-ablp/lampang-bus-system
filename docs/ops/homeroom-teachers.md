# ครูประจำชั้นรายห้อง (homeroom teachers)

ที่มา: เจ้าของระบบขอเมื่อ 2026-11-12 "เพิ่มข้อมูลครูประจำชั้น โดยให้สิทธิ์โรงเรียนระบุรายชื่อครูประจำชั้น" และตัดสินว่า
- เก็บ **รายห้อง** (ชั้น + ห้อง) ห้องละหลายคนได้ — **ชื่อ + เบอร์โทร (ไม่บังคับ)**
- แสดงที่ **หน้าเช็กชื่อรายห้อง · รายชื่อนักเรียน / Excel · รายชื่อเด็กของคนขับ · ข้อความ "สถานะ" ใน LINE ของผู้ปกครอง**
- แก้ไขได้ **เฉพาะบัญชีหลักของโรงเรียน** (ครูประจำสายชั้นดูได้เฉพาะชั้นตน)

## โค้ด
- ตาราง `homeroom_teachers` — `backend/migrations/061_homeroom_teachers.sql` (rollback `rollback/061_homeroom_teachers_rollback.sql`)
- `backend/src/services/homeroom.service.js` — จัดการรายชื่อ + `attachHomeroomTeachers()` (ไม่ทำอะไรเมื่อ flag ปิด)
- API (`school.routes.js`): `GET /api/school/homeroom-teachers` (ทุกบัญชีโรงเรียน, ครูสายชั้นเห็นชั้นตน), `POST` / `PUT /:id` / `DELETE /:id` (`requireFullSchoolScope`) — โรงเรียนมาจาก token, แถวของโรงเรียนอื่นตอบ 404, เขียน audit (ไม่เก็บเบอร์ใน audit)
- จุดแสดงผล: `GET /api/school/teacher-check` (`data.homerooms`), `getStudents` / Excel รายชื่อนักเรียน (คอลัมน์ "ครูประจำชั้น"), `GET /api/driver/roster` (ชื่อ+เบอร์ กดโทรได้), `line.service` สถานะ (ข้อความและ Flex)
- หน้าจอ: `frontend/src/pages/school/SchoolHomeroomTeachers.jsx` (`/school/homeroom-teachers`, เมนู เพิ่มเติม › ครูประจำชั้น — ซ่อนจนเปิด flag)
- ตัวจับคู่: `(school_id, grade, classroom)` ตรงกับ `students.grade` / `students.classroom` ตามที่เก็บ (ตัดช่องว่าง) ห้องว่าง = `''`

## เปิดใช้บน production (ตามลำดับ)
1. deploy โค้ด (flag ยังปิด — ไม่มีอะไรเปลี่ยน)
2. **เจ้าของ apply migration 061** (deploy ไม่รัน migration) — ใช้สคริปต์ที่ทีมส่งให้ รันบรรทัดเดียว: สำรอง DB → apply → บันทึก `schema_migrations` → ตรวจตาราง
3. เปิด flag: `bash scripts/enable-feature-flag.sh FEATURE_HOMEROOM_TEACHERS true` (ถ้าตารางยังไม่มี แอปจะไม่ยอมบูตและสคริปต์ย้อน flag ให้เอง) แล้วอัปเดต `scripts/production-feature-flags.json`
4. อัปเดตคู่มือ (โรงเรียน ครู คนขับ ผู้ปกครอง) และสร้าง PDF ใหม่ — ทำหลังเปิด flag เพื่อไม่ให้คู่มืออธิบายเมนูที่ผู้ใช้ยังไม่เห็น

ปิด: `bash scripts/enable-feature-flag.sh FEATURE_HOMEROOM_TEACHERS false` (ข้อมูลยังอยู่) · ถอนตาราง: rollback 061 หลังปิด flag

## ข้อมูลส่วนบุคคล
เบอร์ครูแสดงให้คนขับรถคันที่เด็กในห้องนั่ง และผู้ปกครองที่ผูก LINE กับเด็กในห้องนั้น — ช่องกรอกในหน้าจอบอกไว้ชัด ไม่บังคับกรอก
