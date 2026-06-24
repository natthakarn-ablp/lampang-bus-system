# Progressive Production Deployment Design

> ระบบบริหารจัดการรถรับส่งนักเรียนจังหวัดลำปาง  
> วันที่: 22 มิถุนายน 2569  
> สถานะ: รอผู้ใช้ตรวจ written spec ก่อนจัดทำ implementation plan

## 1. เป้าหมาย

Deploy ซอฟต์แวร์ทุกส่วนที่พัฒนาเสร็จแล้วขึ้นระบบจริง โดยไม่รอให้ข้อมูลรถและ
คนขับครบทั้งจังหวัด แต่ต้องไม่แสดงข้อมูลที่ยังไม่มีหลักฐานว่าเป็นข้อมูลที่
ผ่านการรับรอง

นิยามคำว่า deploy 100% ในสเปกนี้คือ:

- โค้ดและ schema ที่ผ่านการทดสอบถูก deploy ครบ
- ผู้มีหน้าที่สามารถเริ่มกรอก ตรวจ และรับรองข้อมูลจริงได้ทันที
- ฟังก์ชันที่มีข้อกำหนดด้านข้อมูลหรือกฎหมายเปิดบังคับใช้ตาม readiness gate
- ไม่มีข้อมูลตัวอย่างหรือค่าคาดเดาปะปนกับข้อมูลจริง
- Production มี backup, rollback และ monitoring ที่ใช้งานได้จริง

## 2. ข้อเท็จจริงตั้งต้น

สำเนาข้อมูล Production ล่าสุดที่ตรวจสอบได้มีข้อมูลหลักดังนี้:

- โรงเรียน active 121 แห่ง
- นักเรียน active 1,471 คน โดย 386 คนยังไม่มีรถ
- รถ active 182 คัน
- รถที่มีสถานะ `UNVERIFIED` 182 คัน
- รถที่ยังไม่มี certified capacity 182 คัน
- คนขับ active 194 คน
- บัญชีคนขับ active 158 บัญชี โดย 17 บัญชียังไม่ผูก `driver_id`
- การมอบหมายรถ active 147 รายการ
- การมอบหมายคนขับสำรอง 0 รายการ
- ใบอนุญาตคนขับที่รับรองแล้ว 0 รายการ
- คำขอตรวจรถแบบใหม่ 0 รายการ
- consent records 0 รายการ

ระหว่างตรวจระบบพบว่า MySQL Production ไม่มีฐาน `lampang_bus` และ backend
Production บันทึก `Unknown database 'lampang_bus'` ต่อเนื่อง จึงถือว่าการกู้
Production เป็น gate แรกก่อน deploy ทุกอย่าง

## 3. หลักการออกแบบ

1. **Deploy code complete, activate by readiness** — แยกการ deploy โค้ดออกจาก
   การเปิดบังคับใช้กฎความปลอดภัย
2. **Unknown is not safe** — ข้อมูลที่ยังไม่กรอกต้องแสดง `ยังไม่ได้รับรอง`
   ห้ามแสดง `ผ่าน` หรือสีเขียว
3. **Explicit failure always blocks** — สถานะ `FAILED`, `SUSPENDED`, `REVOKED`
   หรือเอกสารหมดอายุที่ยืนยันแล้วต้อง block แม้อยู่ในช่วงเปลี่ยนผ่าน
4. **No production writes from development** — Local, Test, Staging และ
   Production ใช้ฐานข้อมูลและ secrets แยกกัน
5. **Audit every safety decision** — การอนุญาต การปฏิเสธ การ override และการ
   เปลี่ยน policy ต้องตรวจสอบย้อนหลังได้
6. **Fail safely** — ถ้าคำนวณ eligibility ไม่ได้ ระบบแสดง `UNKNOWN`; โหมด
   บังคับใช้ต้อง block การเปิดรอบ

## 4. แนวทางที่เลือก

ใช้ progressive activation สองโหมด:

### 4.1 `OBSERVE`

ใช้หลัง deploy และระหว่างเก็บข้อมูลจริง

- รถหรือคนขับที่ข้อมูลยังไม่ครบใช้งาน legacy flow เดิมได้
- ทุกครั้งที่อนุญาตเพราะข้อมูลยังไม่ครบ ต้องส่ง warning และเขียน audit log
- สถานะที่ล้มเหลวหรือถูกระงับอย่างชัดเจนยังคงถูก block
- หน้าโรงเรียน ขนส่ง คนขับ และจังหวัดแสดง readiness ที่ตรงกัน
- ใช้โหมดนี้เพื่อเก็บข้อมูล ไม่ใช้เพื่อรับรองความปลอดภัย

### 4.2 `ENFORCE`

เปิดหลังข้อมูลในขอบเขตที่กำหนดผ่าน readiness gate และผู้รับผิดชอบอนุมัติ

- รถต้องผ่านการตรวจและเอกสารสำคัญยังไม่หมดอายุ
- คนขับต้องผูกบัญชี มีใบอนุญาตที่รับรองแล้ว และได้รับมอบหมายรถ
- การเปิดรอบ เช็กอิน ส่งตำแหน่ง และแจ้งเหตุใช้ active shift
- ค่า `UNKNOWN`, `UNVERIFIED`, เอกสารหมดอายุ และ qualification ไม่พร้อมถูก block
- เหตุผลที่ block ต้องแสดงเป็นภาษาไทยและถูกบันทึกใน audit log

## 5. Configuration contract

เพิ่มค่า configuration ที่ตรวจสอบตอน startup:

```env
SAFETY_POLICY_MODE=observe
SAFETY_ENFORCEMENT_AT=
FEATURE_DRIVER_SHIFT_SELECTION=false
FEATURE_VEHICLE_QR=false
FEATURE_QR_LEVEL3=false
```

ข้อกำหนด:

- `SAFETY_POLICY_MODE` รับเฉพาะ `observe` หรือ `enforce`
- Production ที่ใส่ค่าอื่นต้องไม่ start
- `SAFETY_ENFORCEMENT_AT` เป็นเวลาตาม ISO-8601; ว่างได้ใน `observe`
- การเปลี่ยนเป็น `enforce` ต้องมี readiness report ล่าสุดและบันทึกผู้อนุมัติ
- `FEATURE_QR_LEVEL3` เปิดไม่ได้ถ้า `FEATURE_VEHICLE_QR=false`
- Driver shift code deploy ได้ครบ แต่ flag ยังเป็น `false` จนข้อมูลคนขับพร้อม

## 6. Component design

### 6.1 Safety Policy Service

หน่วยกลางสำหรับตัดสินว่า operation ใด `ALLOW`, `ALLOW_WITH_WARNING` หรือ
`BLOCK` โดยรับข้อมูล eligibility, qualification, assignment, feature flags และ
policy mode เป็น input

ทุก caller ใช้ผลลัพธ์รูปแบบเดียวกัน:

```json
{
  "decision": "ALLOW_WITH_WARNING",
  "policy_mode": "OBSERVE",
  "reasons": ["VEHICLE_UNVERIFIED"],
  "audit_required": true
}
```

บริการนี้ไม่มีหน้าที่ query หน้า UI โดยตรง และต้องทดสอบได้ด้วย pure inputs

### 6.2 Readiness Service

คำนวณ aggregate โดยไม่ส่งข้อมูลส่วนบุคคล:

- รถมี certified capacity
- รถผ่านตรวจและเอกสารยังใช้ได้
- บัญชีคนขับผูกโปรไฟล์
- ใบอนุญาตคนขับผ่านรับรอง
- รถมีคนขับที่ได้รับอนุญาตอย่างน้อยหนึ่งคน
- ความครอบคลุมคนขับสำรอง แสดงเป็นคำเตือน ไม่ใช่ hard gate
- consent ที่จำเป็นสำหรับ QR level ที่ต้องการเปิด
- migration, backup, monitoring และ environment readiness

ต้อง drill down ได้ตามโรงเรียน แต่ผู้ใช้เห็นเฉพาะขอบเขตตาม RBAC

### 6.3 Readiness UI

เพิ่มหน้า/ส่วนสรุปสำหรับจังหวัดและ admin:

- `พร้อมใช้งาน`
- `ต้องเติมข้อมูล`
- `มีข้อมูลเสี่ยง`
- `ถูกระงับ`

แต่ละรายการมี owner และ action ต่อไป เช่น `โรงเรียนเพิ่มความจุรถ`,
`ขนส่งรับรองผลตรวจ`, `จังหวัดผูกบัญชีคนขับ`

### 6.4 Existing verification and shift modules

- ใช้ `vehicleVerification.service.js` เป็นแหล่ง eligibility ของรถ
- ใช้ `driverShift.service.js` เมื่อ driver shift flag เปิด
- Legacy vehicle resolution ยังอยู่ใน `OBSERVE` เพื่อไม่หยุดบริการทั้งจังหวัด
- ห้ามสร้าง safety logic ซ้ำใน route หรือ frontend

## 7. Readiness gates

### 7.1 Gate สำหรับ deploy code

- Production DB ถูกกู้และ root cause incident ถูกบันทึก
- สร้าง Staging จาก backup ที่ตรวจ checksum แล้ว
- migration 038 และ 039 ผ่านกับสำเนาข้อมูลจริง
- migration checksum drift เดิมถูกจำแนกและไม่ re-run migration เก่าโดยอัตโนมัติ
- Backend tests, frontend build, label checks และ migration tests ผ่าน
- มี backup ก่อน deploy และ rollback rehearsal ผ่าน

### 7.2 Gate สำหรับ Pilot `ENFORCE`

ในโรงเรียนนำร่องทุกแห่ง:

- รถที่ให้บริการ 100% มี capacity และผลตรวจที่ยังไม่หมดอายุ
- คนขับที่ใช้จริง 100% ผูกบัญชีและมี qualification ที่รับรองแล้ว
- รถทุกคันมี authorized driver อย่างน้อยหนึ่งคน
- เจ้าหน้าที่โรงเรียน ขนส่ง จังหวัด และคนขับผ่าน UAT
- รถหรือคนขับที่มีสถานะ fail/suspended ถูก block จริง

### 7.3 Gate สำหรับ Province-wide `ENFORCE`

- เงื่อนไข Pilot ผ่านครบในรถและคนขับ active ทั้งจังหวัด
- โรงเรียนทุกแห่งทราบวันบังคับใช้และช่องทางแก้ข้อมูล
- รายการ `UNKNOWN` ถูกปิดหรือมี exception ที่ผู้มีอำนาจอนุมัติและมีวันหมดอายุ
- monitoring และ off-host backup ทำงานจริง

## 8. Production recovery gate

ก่อน restore Production:

1. หยุด deploy และเก็บ evidence: MySQL logs, PM2 logs, system journal,
   cron, shell history ที่เกี่ยวข้อง และ snapshot `/var/lib/mysql`
2. Restore backup ลงฐานชื่อใหม่ ห้ามเขียนทับทันที
3. ตรวจ checksum, table count, row counts, foreign keys และ login แบบ read-only
4. ทดสอบ API smoke ด้วยฐานกู้คืน
5. เปลี่ยนค่า DB หลังได้รับอนุมัติและมี rollback path
6. ตรวจ public health และ business flow หลัง cutover
7. ทำ incident report ระบุสาเหตุ, RPO, ข้อมูลที่อาจสูญหาย และมาตรการป้องกันซ้ำ

## 9. Error handling

- Readiness query ล้มเหลวใน `OBSERVE`: แสดง `UNKNOWN`, อนุญาตเฉพาะ legacy
  operation พร้อม audit warning
- Readiness query ล้มเหลวใน `ENFORCE`: block safety-critical operation
- Audit write ล้มเหลว: safety-critical mutation ต้อง rollback
- Migration ล้มเหลว: หยุด deploy และ restore จาก pre-deploy backup
- Feature configuration ไม่ถูกต้อง: Production process ต้องไม่ start
- LINE หรือ external notification ล้มเหลว: operation หลักไม่ rollback แต่ต้องเข้า
  retry queue และสร้าง operations alert

## 10. Testing strategy

- Unit tests: policy matrix ครบทุก mode/status/reason
- Service tests: vehicle eligibility, driver qualification, assignment และ shift
- Route tests: RBAC, warning response, blocking response และ audit requirement
- Migration tests: restore production dump เข้า disposable DB แล้วใช้ 038–039
- Frontend tests: status ไม่ใช้สีอย่างเดียวและไม่มี false-green
- Browser UAT: school, transport, driver, province, admin
- Operational tests: backup, restore, rollback, reboot และ alert delivery
- ห้ามใช้ฐาน `lampang_bus_dev` ที่มีข้อมูลจริงเป็นฐาน Jest แบบ destructive;
  ต้องสร้าง `lampang_bus_test` แยกและทิ้งได้

## 11. Deployment sequence

1. ปิด Production incident และกู้ระบบ
2. สร้าง disposable Test DB และ Staging
3. เพิ่ม policy/readiness layer พร้อม tests
4. Deploy code ครบใน Staging และใช้ `OBSERVE`
5. UAT กับสำเนาข้อมูลจริง
6. Deploy Production ใน `OBSERVE`
7. เก็บและรับรองข้อมูลจริงผ่านระบบ
8. เปิด `ENFORCE` เฉพาะโรงเรียนนำร่อง
9. แก้ผลจาก Pilot และขยายขอบเขต
10. เปิด Province-wide `ENFORCE`

## 12. สิ่งที่ไม่รวมในรอบนี้

- การเชื่อม ThaiD หรือ DLT Central API เพราะยังไม่มี API key
- การสร้างข้อมูลรถ คนขับ หรือผลตรวจปลอม
- QR Level 3 ก่อน DPO/ฝ่ายกฎหมายอนุมัติ
- การบังคับว่ารถทุกคันต้องมีคนขับสำรอง เพราะเป็น resilience target ไม่ใช่
  safety gate ขั้นต่ำ
- การ redesign ทุกหน้าที่ไม่เกี่ยวกับ readiness และ operation flow

## 13. เกณฑ์ถือว่างานเสร็จ

- โค้ด production อยู่ใน commit ที่ตรวจสอบย้อนกลับได้
- CI ครอบคลุม backend, frontend และ migrations
- Production recovery, backup, restore และ rollback ผ่าน
- ระบบทำงานใน `OBSERVE` โดยไม่มี false-green
- Pilot `ENFORCE` ผ่านครบทุก role
- Province-wide readiness report ไม่มีรายการ hard-gate ที่ค้าง
- ผู้รับผิดชอบจังหวัดและขนส่งลงนามอนุมัติวันบังคับใช้
- มี runbook และ incident response ที่ operator ทำตามได้
