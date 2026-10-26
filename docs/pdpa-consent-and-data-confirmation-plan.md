# แผนกล่องยินยอม การรับทราบ และการรับรองข้อมูลตาม PDPA

ชื่อระบบ: อุ่นใจไปโรงเรียน (School Safe Connect)

อัปเดต: 4 กันยายน 2569

สถานะเอกสาร: แผนบังคับใช้และเกณฑ์ตรวจรับ ยังไม่ใช่คำรับรองทางกฎหมายหรือหลักฐานว่าเปิดใช้งานบน production แล้ว

## 1. หลักการสำคัญ

ระบบต้องไม่ใช้คำว่า "ยินยอม" กับทุกกล่องเช็ก เพราะแต่ละการกระทำมีผลทางกฎหมายและผลต่อผู้ใช้ต่างกัน ให้แยกเป็น 3 ประเภทดังนี้

| ประเภท | ใช้เมื่อ | พฤติกรรมที่ต้องมี |
|---|---|---|
| ความยินยอม (Consent) | DPO/legal ยืนยันว่าฐานการประมวลผลคือความยินยอม | ไม่ติ๊กล่วงหน้า, แยกตามวัตถุประสงค์, ถอนได้ง่าย, ถอนแล้วหยุดการประมวลผลที่อาศัยฐานนี้ |
| การรับทราบ (Acknowledgement) | แจ้ง privacy notice, ขอบเขตสิทธิ์ หรือข้อกำหนดการใช้ระบบ | ใช้คำว่า "รับทราบ" ไม่ทำให้เข้าใจว่าเป็นความยินยอม และเก็บเวอร์ชันข้อความที่ผู้ใช้เห็น |
| การรับรองข้อมูล (Certification) | ผู้มีหน้าที่ยืนยันว่าข้อมูลถูกต้อง ครบ และมีอำนาจนำเข้า/แก้ไข | ผูกกับหน่วยงาน ช่วงเวลา ชุดข้อมูลหรือ import batch และเก็บผู้รับรอง/เวลา/audit trail |

กล่องใดเป็น Consent ต้องผ่านการตัดสินฐานกฎหมายและข้อความโดย DPO/legal ก่อน ห้ามใช้กล่องเช็กเพื่อบังคับให้ผู้ใช้สละสิทธิ์ หรือมัดรวมวัตถุประสงค์ที่ไม่จำเป็นต่อบริการ

## 2. สิ่งที่มีอยู่ในระบบแล้ว

- มี `consent_records` แบบ append-only เก็บ grant/withdrawal, ประเภท, เวอร์ชัน, snapshot ข้อความ, เวลา, IP และ user agent
- ผู้ปกครองมี `qr_parent_optin` บนหน้า Vehicle QR และกล่องไม่ถูกติ๊กล่วงหน้า
- คนขับมีความยินยอมแยก 3 วัตถุประสงค์: สาธารณะ, ผู้ปกครอง และข้อมูลอ่อนไหว
- การถอนความยินยอมส่วนบังคับของคนขับทำให้สถานะแสดงผล QR ถูกระงับ และการให้ใหม่ครบทุกส่วนสามารถคืนสถานะที่ถูกระงับด้วยเหตุ consent ได้
- endpoint สถานะ ประวัติ และ ETA ของผู้ปกครองมี gate หลัง `FEATURE_PARENT_CONSENT_REQUIRED`
- feature QR และ parent consent ยังปิดอยู่ จึงยังห้ามนับว่า workflow นี้พร้อม production

## 3. ช่องว่างที่ต้องปิดก่อนเปิดใช้

1. หน้า `ParentStatus` ยังไม่มีหน้าขอ/ถอนความยินยอม มีเฉพาะหน้า Vehicle QR
2. `/api/parent/children` ยังคืนรายการบุตรหลานก่อน consent gate ขณะที่ status/history/ETA มี gate ต้องให้ DPO ตัดสินว่ารายการนี้ใช้ฐานกฎหมายใดและบังคับ gate ให้สอดคล้องกัน
3. `FEATURE_PARENT_CONSENT_REQUIRED` ยังเปิดแยกจาก `FEATURE_VEHICLE_QR` ได้ หากเปิดผิดลำดับ ผู้ปกครองอาจถูกปฏิเสธแต่ไม่มี UI ให้ดำเนินการต่อ
4. gate รองรับ `parent_tracking_optin` และ `qr_parent_optin` แต่ API ปัจจุบันบันทึกเฉพาะ `qr_parent_optin` ต้องกำหนด canonical consent type เพียงแบบเดียวหรือทำ migration/compatibility อย่างชัดเจน
5. การถอน consent ของคนขับต้องพิสูจน์ว่าใช้ผลเดียวกันใน QR, ParentStatus, LINE Flex, LIFF และ export ไม่ใช่เฉพาะ QR
6. ยังไม่มีกล่องรับทราบสำหรับ staff ทุกบทบาท และยังไม่มี evidence record สำหรับการรับรองข้อมูลของโรงเรียน/ต้นสังกัด/จังหวัด
7. การผูก LINE เพื่อกู้บัญชีทุกสิทธิ์ต้องมี notice และ opt-in แยกจากการใช้ระบบทั่วไป พร้อมวิธี unlink/revoke

## 4. Matrix กล่องเช็กตามบทบาท

| บทบาท/จุดใช้งาน | กล่องที่ต้องมี | ประเภท | บังคับเมื่อใด | หลักฐานที่ผูก |
|---|---|---|---|---|
| ผู้ใช้ระบบทุกบทบาท ครั้งแรก/เมื่อ notice เปลี่ยนสาระสำคัญ | "ข้าพเจ้าได้อ่านและรับทราบประกาศความเป็นส่วนตัวและขอบเขตการใช้ข้อมูลตามหน้าที่" | รับทราบ | ก่อนเข้าหน้าข้อมูลส่วนบุคคลครั้งแรก | user, role, scope, notice version/hash, time |
| Admin/Province/Affiliation/Transport | "ข้าพเจ้าจะใช้ข้อมูลตามอำนาจหน้าที่และไม่เปิดเผยเกินวัตถุประสงค์" | รับทราบ | ก่อนเข้ารายงานหรือข้อมูลข้ามหน่วยงานครั้งแรก | user, role, organization scope, policy version |
| School full ก่อน Apply Import | "ข้าพเจ้าตรวจสอบแล้วว่ามีอำนาจนำเข้าข้อมูลชุดนี้ และข้อมูลมาจากแหล่งที่โรงเรียนรับรอง" | รับรองข้อมูล | ทุก import batch ก่อน apply | school, batch id, row counts, file hash, actor, time |
| School full ก่อนยืนยันข้อมูลประจำภาคเรียน | "ข้าพเจ้ารับรองว่าข้อมูลนักเรียน ผู้ปกครอง รถ และคนขับในขอบเขตโรงเรียนถูกต้องและครบถ้วน ณ วันที่ยืนยัน" | รับรองข้อมูล | อย่างน้อยรายภาคเรียนและหลังแก้ข้อมูลสาระสำคัญ | school, term, aggregate/hash, actor, time |
| School teacher | "ข้าพเจ้ารับทราบว่าเข้าถึงได้เฉพาะระดับชั้น/งานที่ได้รับมอบหมาย" | รับทราบ | ครั้งแรกและเมื่อ scope เปลี่ยน | user, grade scope, policy version |
| Affiliation | "ข้าพเจ้าตรวจสอบความครบถ้วนของโรงเรียนในสังกัดแล้ว" | รับรองข้อมูล | ก่อนส่งสถานะ coverage ให้จังหวัด | affiliation, term, school counts, exception list |
| Province | "ข้าพเจ้ารับรองว่าได้ตรวจภาพรวมตามรายงาน โดยข้อยกเว้นยังคงแสดงตามหลักฐาน" | รับรองข้อมูล | ก่อน publish/ส่งออกรายงานรับรอง | reporting period, report version/hash, exceptions |
| Transport | "ข้าพเจ้ารับรองผลตรวจรถ/เอกสารตามหลักฐานที่แนบ" | รับรองข้อมูล | ทุกการ approve/reject/เปลี่ยน verification status | vehicle, inspection, documents, decision, actor |
| Driver | ยินยอมแยกข้อมูลสาธารณะ / ผู้ปกครอง / ข้อมูลอ่อนไหว | ยินยอม | ก่อนแสดงข้อมูลแต่ละระดับ โดยไม่มัดรวม | consent type/version, driver/user, grant/withdrawal |
| Parent/LINE | แจ้งการใช้ LINE identity, ความสัมพันธ์กับนักเรียน และข้อมูลติดตาม | ยินยอมหรือรับทราบตามฐานกฎหมายที่ DPO อนุมัติ | ก่อนแสดงรายละเอียดที่อยู่ใน scope นั้น | LINE subject reference, child-link scope, version, action |
| Parent/LINE | "ข้าพเจ้ารับรองว่าเป็นผู้ปกครอง/ผู้มีอำนาจของนักเรียนที่ขอผูก" | รับรองข้อมูล | ทุก bind/rebind และเมื่อความสัมพันธ์เปลี่ยน | bind request, student, verification method, time |
| ทุก login role ที่ผูก LINE เพื่อกู้รหัส | "ข้าพเจ้ายินยอม/รับทราบการผูกบัญชี LINE เพื่อยืนยันตัวตนและกู้คืนบัญชี" ตามฐานที่อนุมัติ | แยกจากการใช้ระบบทั่วไป | ก่อนสร้าง recovery binding | user, role, LINE subject reference, version, bind/revoke |

## 5. การออกแบบข้อมูลหลักฐาน

ไม่ควรนำการรับทราบและการรับรองข้อมูลไปเก็บเป็น `consent_records` เพราะจะทำให้ความหมายของการถอนและฐานกฎหมายปะปนกัน ให้คงตารางนี้ไว้สำหรับ Consent จริง และเพิ่มโครงสร้างแบบ append-only แยกกัน

### 5.1 Privacy acknowledgement

ควรเก็บอย่างน้อย: `user_id`, `role`, `organization_scope`, `notice_type`, `notice_version`, `notice_hash`, `text_snapshot`, `acknowledged_at`, `source_screen`, `ip_address`, `user_agent` และ `created_at`

### 5.2 Data certification

ควรเก็บอย่างน้อย: `actor_user_id`, `actor_role`, `organization_type/id`, `certification_type`, `school_year`, `term`, `subject_type/id`, `import_batch_id`, `record_count`, `data_hash`, `text_version`, `text_snapshot`, `certified_at`, `exception_summary` และ audit reference

ข้อกำหนดร่วม:

- เก็บแบบ append-only ห้ามแก้ทับหลักฐานเดิม
- เวลาในฐานข้อมูลเก็บให้ตีความได้แน่นอน และแสดงผลเป็นเวลาไทย
- ไม่ใส่ secret, token, รหัสผ่าน, CID เต็ม หรือ LINE user ID แบบอ่านได้ใน evidence export
- server ต้องตรวจ checkbox/version/scope ซ้ำ ห้ามเชื่อค่าจาก frontend เพียงอย่างเดียว
- เมื่อข้อความเปลี่ยน ต้องมี version/hash ใหม่ และมีกติกาว่าเปลี่ยนระดับใดจึงต้องรับทราบหรือขอ consent ใหม่

## 6. มาตรฐาน UX ของกล่องเช็ก

- ทุกกล่องเริ่มต้นเป็น unchecked และห้ามใช้ checkbox ที่ถูกซ่อนหรือ click-through
- แยกแต่ละวัตถุประสงค์เป็นคนละกล่อง โดยเฉพาะข้อมูลอ่อนไหวและการใช้ LINE เพื่อ recovery
- แสดงข้อความสรุปที่เข้าใจง่าย พร้อมลิงก์ไปประกาศฉบับเต็มและช่องทางติดต่อ DPO/ผู้ดูแล
- ปุ่มยืนยัน disabled จนผ่านเงื่อนไข แต่ต้องมี error ใกล้กล่องเมื่อส่งไม่สำเร็จ
- label ต้องกดได้ทั้งแถว, รองรับ keyboard/focus/screen reader และพื้นที่แตะไม่น้อยกว่า 44px
- Consent ต้องมีหน้าดูสถานะ ถอน และให้ใหม่ได้ โดยบอกผลกระทบก่อนถอนอย่างไม่ข่มขู่
- Certification ต้องแสดงขอบเขตข้อมูล จำนวนรายการ ข้อยกเว้น และวันที่รับรองก่อนกด
- ห้ามบังคับ re-consent ทุกครั้งที่ login หากข้อความและวัตถุประสงค์ไม่เปลี่ยน

## 7. แผนดำเนินงาน

### Phase C0 - Legal And Data Decision

- DPO/legal ระบุ controller/processor, data inventory, purpose, lawful basis, retention และสิทธิ์เจ้าของข้อมูล
- อนุมัติว่าแต่ละรายการใน Matrix เป็น Consent, Acknowledgement หรือ Certification
- อนุมัติข้อความไทย ฉบับย่อ/เต็ม เวอร์ชัน และผลเมื่อถอน

Exit gate: มี decision register ที่ลงชื่อจริง ห้ามเปิด feature จากข้อความ draft

### Phase C1 - Schema And Server Contract

- กำหนด canonical parent tracking type และ migration compatibility
- เพิ่มตาราง acknowledgement/certification แบบ append-only พร้อม indexes และ rollback
- เพิ่ม API อ่านข้อความ, บันทึก action, ดูประวัติ และถอน consent ตามสิทธิ์
- เพิ่ม server-side scope/version validation และ audit log
- เพิ่ม feature dependency validation ไม่ให้เปิด parent consent โดยไม่มี consent UI ที่เข้าถึงได้

Exit gate: migration, unit test, negative authorization test และ rollback test ผ่าน

### Phase C2 - Role Workflows

- เพิ่ม shared checkbox/notice/certification components ตามมาตรฐาน accessibility
- เพิ่ม ParentStatus consent/notice flow และหน้าถอน consent
- เพิ่ม staff first-use acknowledgement
- เพิ่ม certification ก่อน import apply, ยืนยันข้อมูลรายภาคเรียน, affiliation coverage, province publish และ transport decision
- เพิ่ม recovery LINE notice/opt-in/unlink ครบทุก login role

Exit gate: ทุกบทบาทผ่าน happy path, refusal/unchecked, expired version และ cross-scope tests

### Phase C3 - Enforcement And Withdrawal

- บังคับ gate ที่ API ทุกเส้นทาง ไม่ใช่เฉพาะ UI
- ทำ withdrawal cascade ให้ข้อมูลที่อาศัย consent หยุดแสดงใน QR, LIFF, LINE message, report และ export
- การถอนต้องไม่ลบ audit/consent หลักฐานเดิม และต้องไม่กระทบข้อมูลที่ยังประมวลผลด้วยฐานกฎหมายอื่นโดยไม่มีคำตัดสิน DPO
- เพิ่ม alert เมื่อ feature flags อยู่ในสถานะขัดแย้ง

Exit gate: privacy/security regression และ withdrawal propagation test ผ่าน

### Phase C4 - UAT And Rollout

- ใช้ sandbox และ LINE test accounts เท่านั้นสำหรับ write UAT
- เก็บภาพ redacted, request/audit IDs, consent versions และผลก่อน/หลังถอน
- เปิด feature แบบ pilot ทีละบทบาท/หน่วยงาน พร้อม rollback flag
- monitor 30-60 นาทีและตรวจว่าไม่มี parent/driver ถูกล็อกผิดหรือข้อมูลรั่วข้าม scope

Exit gate: DPO, Data owner, UAT lead และ Technical owner ลงนามจากหลักฐานจริง

## 8. UAT ที่ต้องผ่าน

1. ไม่มี checkbox ใดถูกติ๊กล่วงหน้า และ submit ไม่ผ่านเมื่อกล่องที่จำเป็นยังว่าง
2. Consent แต่ละวัตถุประสงค์ให้/ถอน/ให้ใหม่ได้อิสระ และ latest action มีผลถูกต้อง
3. เปลี่ยน version แล้วระบบขอ action ใหม่เฉพาะตาม policy ที่อนุมัติ
4. Parent เห็นเฉพาะบุตรหลานที่ผูกและเฉพาะระดับข้อมูลที่ lawful basis/consent อนุญาต
5. ถอน driver/parent consent แล้วผลเปลี่ยนทันทีใน API, QR, ParentStatus, LIFF, LINE และ export ที่เกี่ยวข้อง
6. School import apply ไม่ได้หากยังไม่รับรอง และหลักฐานผูกกับ batch ที่ apply จริง
7. Affiliation/Province certification แสดงจำนวนโรงเรียนและ exception จริง ห้ามเปลี่ยนสถานะให้ดูครบโดยซ่อนรายการค้าง
8. Transport decision มีหลักฐานรถ/เอกสาร/ผลตรวจและ actor ครบ
9. Recovery binding ถูกถอนแล้วใช้กู้บัญชีไม่ได้ และไม่กระทบ LINE parent binding คนละวัตถุประสงค์
10. Evidence export ถูก redact, append-only, ตรวจ version/hash ได้ และผู้ไม่มีสิทธิ์เปิดไม่ได้

## 9. Hard Gate ก่อนประกาศพร้อมใช้

- [ ] DPO/legal decision register ครบทุก purpose และข้อความ
- [ ] Schema/API/UI/enforcement ครบตาม Matrix และ migration ผ่าน
- [ ] ช่องว่างข้อ 1-7 ในหัวข้อ 3 ปิดครบหรือ defer โดยผู้มีอำนาจพร้อม risk acceptance
- [ ] Consent withdrawal propagation ผ่านทุกช่องทางที่ได้รับผล
- [ ] Data certification ผ่าน sandbox UAT ของ School/Affiliation/Province/Transport
- [ ] Accessibility, RBAC/IDOR, audit, retention และ evidence redaction ผ่าน
- [ ] Production feature flags เปิดตามลำดับที่อนุมัติและ postdeploy monitor ผ่าน
- [ ] Human sign-off ครบ ห้ามให้ระบบหรือ Codex ลงชื่อแทน

จนกว่าจะผ่านรายการข้างต้น ให้รายงานสถานะว่า "มีโครงสร้าง consent บางส่วนและอยู่ระหว่างปิดช่องว่าง" ห้ามรายงานว่า PDPA พร้อม 100%

## 10. แหล่งอ้างอิงสำหรับ DPO/legal review

- พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 โดยเฉพาะมาตรา 19, 24, 26 และสิทธิของเจ้าของข้อมูล: https://ratchakitcha.soc.go.th/documents/17082307.pdf
- Government Platform for PDPA Compliance ของสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล: https://gppc.pdpc.or.th/

เอกสารนี้แปลงข้อกำหนดเป็นแผนระบบเบื้องต้น การตัดสินฐานกฎหมายและข้อความสุดท้ายต้องทำโดย DPO/legal ของหน่วยงาน
