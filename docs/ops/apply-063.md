# เปิดใช้ระบบรับรองรถโรงเรียน (มพบ. 2564 "ล้อที่ 3") — migration 063

ที่มา: เจ้าของระบบ 2026-11-14 ให้การตรวจสภาพและการรับรองรถเป็นไปตาม **"ล้อที่ 3 ระบบการรับรองรถโรงเรียน"** ในคู่มือ "การจัดระบบรถโรงเรียนให้ปลอดภัยและเป็นธรรม" (มพบ. 2564)

## ลำดับงานตามคู่มือ → ในระบบ
| คู่มือ | ระบบ (flag `FEATURE_SCHOOL_CERTIFICATION`) |
|---|---|
| โรงเรียนกำหนดเกณฑ์และช่วงรับเอกสาร (นอกภาคเรียน) | โรงเรียน (บัญชีหลัก) › ส่งตรวจและรับรองรถ › "ช่วงรับเอกสารและเกณฑ์" ต่อภาคเรียน + เลือกว่าต้องแนบ พ.ร.บ. หรือไม่ |
| คนขับยื่นสำเนาบัตรประชาชน ใบขับขี่ รูปรถ เล่มทะเบียน รายชื่อนักเรียน (+ พ.ร.บ.) | คนขับแนบเอกสาร (เพิ่มประเภท "สำเนาบัตรประชาชน", "รูปถ่ายรถ") · รายชื่อนักเรียนมาจากระบบ · กรอกผู้ดูแลนักเรียนประจำรถ (ชื่อ/เบอร์) ที่หน้า "ขึ้นทะเบียนรถ" |
| โรงเรียนตรวจและออก **หนังสือรับรองการรับส่งนักเรียน** | หน้าคำขอแสดงรายการเอกสารมี/ขาด · กด "ตรวจสอบถูกต้อง" (คำขอจากคนขับ) หรือ "ยืนยันข้อมูลพร้อมพิมพ์" (คำขอที่โรงเรียนสร้าง) = ออกหนังสือรับรอง เลขที่ `<รหัสโรงเรียน>/<ภาคเรียน>/<0001>` มีผลถึงวันสิ้นภาคเรียน · นอกช่วงรับเอกสารยังออกได้แต่มีคำเตือน · เพิกถอนได้ (ต้องมีเหตุผล) · พิมพ์ PDF (ช่องลงนามผู้อำนวยการว่างไว้) |
| คนขับยื่นต่อนายทะเบียนขนส่งพร้อมหนังสือรับรอง | ขนส่งเห็นเลขหนังสือรับรอง/วันหมดอายุในคิว · **เริ่มตรวจไม่ได้ (409 `CERTIFICATE_REQUIRED`) ถ้าไม่มีหนังสือรับรองที่ยังมีผล** (admin ข้ามได้) |
| ผ่าน: อนุญาตไม่เกินหนึ่งภาคเรียน | ผล "ผ่าน" ตั้งวันหมดอายุเป็นวันสิ้นภาคเรียนโดยอัตโนมัติ และห้ามเกิน (400 `EXPIRY_AFTER_TERM_END`) |
| ไม่ผ่าน: แก้ไขและยื่นใหม่ภายใน 15 วัน | ผล "ต้องแก้ไข/ไม่ผ่าน" บันทึก `fix_deadline` = วันนี้ + 15 วัน · เลยกำหนดขึ้น "เลยกำหนดยื่นใหม่" และ cron `pending-queue-alert.js` แจ้งในระบบ **ครั้งเดียว** ถึงโรงเรียนและขนส่ง · ไม่ยกเลิกอัตโนมัติ |
| โรงเรียนนัดขนส่งมาตรวจทุกคันที่โรงเรียนวันเดียว | โรงเรียนเลือกคำขอที่พร้อมตรวจหลายคัน + เสนอวัน → ขนส่งยืนยันวัน → ตรวจเสร็จ |
| มาตรฐานรถ (ป้ายส้มอักษรดำ+ไฟเหลืองอำพัน, ไม่ติดฟิล์ม, ไม่มีที่ยืน, สองแถวมีประตูท้าย, รถตู้ที่นั่งแถวตอน, ค้อนทุบกระจก/ชะแลง) | แบบตรวจ `LAMPANG_SCHOOLBUS` **version 2** = หัวข้อเดิมทั้งหมด + 6 หัวข้อใหม่ (สองแถว/รถตู้ เลือก "ไม่เกี่ยวข้อง" ได้) ใช้เฉพาะเมื่อเปิด flag; การตรวจที่เริ่มไว้แล้วใช้แบบเดิมจนจบ |

**รถร่วมหลายโรงเรียน** (ทดสอบตามแผนผังด้วยข้อมูลสมมุติ 2026-11-14 — รถสองแถว 1 คันรับนักเรียน 3 โรงเรียน, `backend/tests/certThreeSchoolScenario.test.js`): คนขับเลือก "ยื่นให้โรงเรียน" ได้เมื่อรถมีนักเรียนหลายโรงเรียน (ไม่เลือก = โรงเรียนที่มีนักเรียนมากที่สุด) · โรงเรียนผู้ออกเท่านั้นที่ตรวจ/ออก/เพิกถอน/นัดตรวจ — โรงเรียนอื่นได้ 403 · โรงเรียนอื่นที่มีนักเรียนใช้รถ **เห็นสถานะคำขอ รายการเอกสาร และหนังสือรับรอง (ดาวน์โหลด PDF ได้) แบบอ่านอย่างเดียว** ("รถคันนี้มีหนังสือรับรองจาก<โรงเรียนผู้ออก> เลขที่ … ถึง …") · PDF แสดงจำนวนนักเรียนรวมทุกโรงเรียน · เลยกำหนดยื่นใหม่ แจ้งเฉพาะโรงเรียนผู้ออก + ขนส่ง (โรงเรียนอื่นเห็นในรายการคำขอ) · แก้ไขพร้อมกัน: หน้า "ขึ้นทะเบียนรถ" ของคนขับส่ง `vehicle_id` เป็นตัวเลข (รหัสรถจริงเป็น `V-…`) ทำให้ยื่นคำขอจากหน้าจอไม่ได้เลย — แก้แล้ว

อื่น ๆ: eligibility ของรถเพิ่มเหตุผล `CERTIFICATE_MISSING` / `CERTIFICATE_EXPIRED` / `CERTIFICATE_REVOKED` และ "ใกล้หมดอายุ" เมื่อหนังสือรับรองเหลือ ≤30 วัน · งานรออนุมัติ: ขนส่งเห็น "คำขอนัดตรวจรถที่โรงเรียน", โรงเรียนเห็น "หนังสือรับรองรถใกล้หมดอายุ (30 วัน)" (ไม่แจ้งเตือน) · ไม่มีการส่ง LINE

## migration 063 ทำอะไร (additive)
- ตารางใหม่ `school_transport_certificates`, `school_certification_windows`, `inspection_appointments`, `inspection_appointment_vehicles`
- `vehicles.caretaker_name`, `vehicles.caretaker_phone` · `vehicle_inspection_applications.fix_deadline` (NULL ทุกแถวเดิม)
- `driver_documents.doc_type` เพิ่ม `ID_CARD` · `vehicle_documents.doc_type` เพิ่ม `VEHICLE_PHOTO`
- `vehicle_inspection_applications.status` เพิ่ม `PENDING_SCHOOL_REVIEW`, `REJECTED` **เฉพาะเมื่อยังไม่มี** (ตรวจจาก information_schema — โค้ดคำขอจากคนขับเขียนค่าเหล่านี้อยู่แล้ว แต่ไม่มี migration ใดประกาศไว้)
- แบบตรวจ version 2 (ไม่แตะ version 1)
- rollback: `backend/migrations/rollback/063_school_transport_certification_rollback.sql` (ปิด flag ก่อน; ไม่ถอดค่า status ที่เพิ่ม; ปิด version 2 แทนการลบ)

## เปิดใช้บน production (เหมือน 061/062)
1. deploy โค้ด (flag ยังปิด — ไม่มีอะไรเปลี่ยน แม้ migration ยังไม่ได้ apply)
2. **เจ้าของ apply migration 063** ด้วย `sudo mysql` (deploy ไม่รัน migration) — บรรทัดเดียว: สำรอง DB → ตรวจก่อน → apply → บันทึก ledger → ตรวจหลัง
   ```bash
   cd /home/schoolbus/apps/lampang-bus-system && bash scripts/backup-db.sh \
   && sudo mysql lampang_bus -e "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema='lampang_bus' AND table_name='vehicle_inspection_applications' AND column_name='status'" \
   && sudo mysql lampang_bus < backend/migrations/063_school_transport_certification.sql \
   && sudo mysql lampang_bus -e "INSERT INTO schema_migrations (filename, checksum, applied_by, status) VALUES ('063_school_transport_certification.sql', '$(sha256sum backend/migrations/063_school_transport_certification.sql | cut -d' ' -f1)', 'owner', 'applied')" \
   && sudo mysql lampang_bus -e "SHOW TABLES LIKE 'school_%'; SHOW TABLES LIKE 'inspection_appoint%'; SHOW COLUMNS FROM vehicles LIKE 'caretaker%'; SHOW COLUMNS FROM vehicle_inspection_applications LIKE 'fix_deadline'; SELECT version_no, COUNT(*) FROM inspection_checklist_items i JOIN inspection_checklist_templates t ON t.id=i.template_id WHERE t.template_code='LAMPANG_SCHOOLBUS' GROUP BY version_no"
   ```
   ผลที่คาด: 4 ตารางใหม่, คอลัมน์ครบ, แบบตรวจ version 2 มีหัวข้อมากกว่า version 1 อยู่ 6 ข้อ. ถ้า COLUMN_TYPE ของ status ในขั้นตรวจก่อนมีค่าอื่นนอกจาก 12 ค่าใน migration ให้หยุดและแจ้งทีม (คำสั่ง MODIFY จะไม่ทำงานเมื่อมี PENDING_SCHOOL_REVIEW และ REJECTED อยู่แล้ว)
3. ทดสอบกับโรงเรียน QA ก่อน แล้ว `bash scripts/enable-feature-flag.sh FEATURE_SCHOOL_CERTIFICATION true` (ถ้า 063 ยังไม่มี แอปจะไม่บูตและสคริปต์ย้อน flag ให้เอง) แล้วอัปเดต `scripts/production-feature-flags.json`
4. แจ้งโรงเรียน: หลังเปิด flag รถที่ยังไม่มีหนังสือรับรองจะขึ้นเหตุผล `CERTIFICATE_MISSING` เมื่อคำนวณ eligibility ครั้งถัดไป และขนส่งจะเริ่มตรวจไม่ได้จนกว่าโรงเรียนออกหนังสือรับรอง — สำหรับคำขอที่ "พร้อมตรวจ" อยู่แล้ว โรงเรียนกด "ออกหนังสือรับรอง" ในหน้าคำขอ
5. อัปเดตคู่มือ (โรงเรียน คนขับ ขนส่ง) หลังเปิด flag

ปิด: `bash scripts/enable-feature-flag.sh FEATURE_SCHOOL_CERTIFICATION false` (ข้อมูลยังอยู่; ขนส่งกลับไปพิมพ์วันหมดอายุเองและเริ่มตรวจได้โดยไม่ต้องมีหนังสือรับรอง)

## โค้ด
- `backend/src/services/schoolCertification.service.js` (กติกาทั้งหมด), `backend/src/routes/certification.routes.js` (`/api/certification/*`, 404 ทุกเส้นเมื่อปิด flag)
- จุดเชื่อม: `vehicleVerification.service.js` (`computeEligibility`, `startInspection`, `finalizeInspection`, `reviewApplication`, `transitionSchoolApplication`), `pendingQueue.service.js` (คิว AP/CE/FX), `driverDocuments.service.js` (ประเภทเอกสาร)
- หน้าจอ: `frontend/src/components/certification/*` บนหน้า ส่งตรวจและรับรองรถ (โรงเรียน), ตรวจรับรองรถ (ขนส่ง), ขึ้นทะเบียนรถ + แนบเอกสาร (คนขับ)
- ทดสอบ: `backend/tests/schoolCertification.unit.test.js`, `schoolCertificationRoutes.unit.test.js` (ไม่ใช้ DB), `schoolCertification.test.js`, `certThreeSchoolScenario.test.js` (MySQL ใน CI)

## ยังไม่ทำในรอบนี้
- ไม่มีการลงนามดิจิทัล — PDF มีช่องลงนามผู้อำนวยการว่างไว้ให้ลงมือชื่อ
- เส้นลงทะเบียนรถแบบรายชื่อเด็ก (`/api/school/registrations/:id/approve`) ไม่ออกหนังสือรับรองเอง — โรงเรียนออกได้จากหน้าส่งตรวจและรับรองรถ
- ไม่ได้บันทึกผล "ประวัติผู้ขับ" จากขนส่ง (ขนส่งตรวจนอกระบบ)
