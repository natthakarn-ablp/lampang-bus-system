# Incident + PDPA SOP 2026-08 — School Safe Connect ลำปาง

สถานะเอกสาร: operational SOP สำหรับทีมโครงการ/ผู้ดูแลระบบ
วันที่ปรับปรุง: 2026-08-25

เอกสารนี้ไม่ใช่คำวินิจฉัยทางกฎหมาย กรณีเกี่ยวกับข้อมูลส่วนบุคคลต้องให้ DPO/ฝ่ายกฎหมายของหน่วยงานเป็นผู้ตัดสินขั้นสุดท้าย

## 1. หลักปฏิบัติ

- หยุดผลกระทบก่อน แล้วค่อยเก็บรายละเอียดเพิ่ม
- เก็บหลักฐานเท่าที่จำเป็น ห้ามแนบข้อมูลเด็ก/ผู้ปกครองแบบเต็มใน ticket
- ทุก command ที่อ่าน production ต้องเป็น read-only เว้นแต่ incident commander อนุมัติเป็นลายลักษณ์อักษร
- ทุกการแก้ production data ต้องมี backup ล่าสุดที่ verify ผ่าน
- ห้ามส่ง secret, token, LINE user id, raw SQL dump หรือไฟล์ export ผ่านแชตกลุ่ม

## 2. Severity

| ระดับ | ตัวอย่าง | เป้าหมายตอบสนอง |
|---|---|---|
| SEV1 | ระบบล่ม, DB disconnected, login ไม่ได้ทั้งระบบ, ข้อมูลส่วนบุคคลรั่ววงกว้าง | เริ่มภายใน 15 นาที |
| SEV2 | สิทธิ์ผิดทำให้เห็นข้อมูลข้ามโรงเรียน, LINE parent เห็นเด็กผิดคน, backup เสีย | เริ่มภายใน 30 นาที |
| SEV3 | รายงานตัวเลขผิด, export ผิดรูปแบบ, คนขับบางคันเช็กอินไม่ได้ | เริ่มภายใน 4 ชั่วโมง |
| SEV4 | คำสะกด, UX, คู่มือ, request เพิ่มเติม | รอบ backlog |

ถ้าไม่แน่ใจ ให้ยกระดับขึ้นหนึ่งระดับก่อน

## 3. Roles

| บทบาท | หน้าที่ |
|---|---|
| Incident commander | เปิด incident, ตัดสินใจ containment, สื่อสารสถานะ |
| Technical owner | ตรวจ health, logs, RBAC, deploy/rollback |
| Data owner/โรงเรียน | ยืนยันข้อมูลจริงและผลกระทบต่อผู้เรียน |
| DPO/กฎหมาย | ประเมิน PDPA risk, ตัดสินใจแจ้ง PDPC/เจ้าของข้อมูล |
| Operator | backup, PM2, cron, restore drill, evidence bundle |

## 4. First Response Timeline

| เวลา | งาน |
|---|---|
| 0-15 นาที | เปิด incident, ระบุ SEV, freeze การ deploy, เก็บเวลาไทยของเหตุ |
| 15-60 นาที | ตรวจ `/health`, PM2, error logs, audit log, affected role/scope |
| 1-4 ชั่วโมง | containment, ประเมินว่ามี personal data breach หรือไม่, สร้าง evidence bundle แบบไม่เปิด PII |
| ภายใน 24 ชั่วโมง | ให้ DPO/กฎหมายตัดสิน risk และแผนแจ้งหน่วยงาน/เจ้าของข้อมูล |
| ภายในกรอบกฎหมาย | ถ้าเป็นเหตุที่ต้องแจ้ง ให้ DPO/กฎหมายดำเนินการผ่านช่องทางทางการ |
| หลังแก้ | post-incident review, root cause, regression test, update runbook |

แนวทาง PDPA ที่ต้องยึด: เหตุละเมิดที่มีความเสี่ยงต่อสิทธิและเสรีภาพของเจ้าของข้อมูลควรแจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลโดยไม่ชักช้าและเมื่อทำได้ภายใน 72 ชั่วโมง; ถ้ามีความเสี่ยงสูง ต้องพิจารณาแจ้งเจ้าของข้อมูลโดยไม่ชักช้า ทั้งนี้ให้ DPO/กฎหมายเป็นผู้ตัดสิน

## 5. Containment Playbooks

### 5.1 ระบบล่มหรือ DB disconnected

1. `curl -s http://127.0.0.1:3000/health`
2. `pm2 status`
3. `pm2 logs schoolbus-backend --lines 200 --nostream`
4. ตรวจ MySQL service และ disk
5. Restart PM2 เฉพาะเมื่อ technical owner เห็นว่า process ค้างหรือ env ผิด
6. หลังระบบกลับมา รัน smoke: root 200, no-token `/api/auth/me` 401, dashboard ของ test role

### 5.2 เห็นข้อมูลข้ามสิทธิ์

1. บันทึก URL, role, user id, เวลาไทย, screenshot ที่ mask PII
2. หยุดเผยแพร่ URL/ขั้นตอนซ้ำในช่องสาธารณะ
3. ตรวจ route middleware, audit log, request params, scope resolver
4. ถ้ามี risk สูง ให้ปิด route หรือ feature flag ที่เกี่ยวข้องหลังได้รับ approval
5. แจ้ง DPO/กฎหมายเพื่อประเมิน personal data breach

### 5.3 LINE parent เห็นข้อมูลผิดคน

1. เก็บ line binding id แบบ masked เท่านั้น
2. ตรวจ `line_users`, parent mapping, approved parent, phone matching
3. ปิด/ถอน binding เฉพาะรายการที่ผิดหลัง data owner ยืนยัน
4. แจ้งโรงเรียนเจ้าของข้อมูลและ DPO
5. เพิ่ม regression test สำหรับ parent access guard

### 5.4 Export หรือไฟล์รายงานหลุด

1. หยุดแชร์ไฟล์และรวบรวมผู้รับไฟล์
2. ตรวจ audit log `EXPORT`
3. ประเมิน field ที่อยู่ในไฟล์: aggregate, student-level, parent phone, CID, LINE id
4. ถ้าเป็น PII ของเด็ก/ผู้ปกครอง ให้ DPO/กฎหมายประเมินการแจ้งเหตุ
5. ตรวจ formula injection และ scope ของ endpoint ก่อนเปิด export อีกครั้ง

### 5.5 Backup/restore ผิดปกติ

1. รัน `scripts/verify-latest-backup.sh`
2. รัน `scripts/check-offhost-backup-config.sh`
3. ห้าม restore production จนกว่า owner อนุมัติและมี backup ที่ verify ผ่าน
4. Restore drill ต้องลง test DB เท่านั้น เช่น `lampang_bus_restore_drill`
5. หลัง drill ตรวจ aggregate counts และยืนยัน production counts ไม่เปลี่ยน

## 6. Evidence Bundle

เก็บใน folder จำกัดสิทธิ์ เช่น `/home/schoolbus/logs/incidents/INC-YYYYMMDD-NN/`

| ไฟล์ | เนื้อหา |
|---|---|
| `timeline.md` | เวลาไทย, ใครทำอะไร, decision log |
| `health.json` | output `/health` |
| `pm2.txt` | `pm2 status` และ logs เฉพาะบรรทัดจำเป็น |
| `audit-summary.csv` | aggregate หรือ masked audit rows |
| `impact.md` | จำนวนโรงเรียน/ผู้ใช้/รายการที่ได้รับผลกระทบแบบ aggregate |
| `actions.md` | containment, fix, verification, follow-up |

ห้ามเก็บ raw password, JWT, LINE secret, full CID, full phone, หรือ SQL dump ใน evidence bundle

## 7. Communication Templates

Internal status:

```text
สถานะ incident: INC-YYYYMMDD-NN / SEV?
เวลาเริ่มพบเหตุ: YYYY-MM-DD HH:mm เวลาไทย
ผลกระทบปัจจุบัน: ...
การหยุดผลกระทบที่ทำแล้ว: ...
งานถัดไป: ...
ผู้รับผิดชอบ: ...
```

School/field update:

```text
ขณะนี้ระบบ School Safe Connect พบปัญหาในส่วน ...
ทีมกำลังแก้ไขและจะอัปเดตอีกครั้งเวลา ...
กรุณางดส่งต่อข้อมูลส่วนบุคคลหรือ screenshot ที่มีข้อมูลนักเรียนในช่องทางสาธารณะ
```

Parent-facing holding message:

```text
ระบบกำลังตรวจสอบสถานะการแสดงข้อมูลบางส่วน เพื่อความปลอดภัยของข้อมูลนักเรียน
โรงเรียน/จังหวัดจะแจ้งความคืบหน้าเมื่อยืนยันข้อมูลแล้ว
```

## 8. Closeout

ก่อนปิด incident ต้องมี:

- Root cause ชัดเจน
- Fix หรือ rollback เสร็จ
- Regression test ผ่าน
- Audit/evidence bundle ครบและไม่มี secret/PII เกินจำเป็น
- DPO/กฎหมายบันทึก decision ว่าแจ้ง/ไม่แจ้ง PDPC และแจ้ง/ไม่แจ้งเจ้าของข้อมูล เพราะอะไร
- Runbook หรือ checklist ที่เกี่ยวข้องถูกอัปเดต

## 9. References

- PDPC/GPPC: Government Platform for PDPA Compliance — https://gppc.pdpc.or.th/
- GPPC Plus public material: ระบบจัดการแจ้งเหตุละเมิดข้อมูลส่วนบุคคล และมาตรา 37 ภายใน 72 ชั่วโมง — https://register-gppc-plus.pdpc.or.th/
- IAPP summary checked 2026-08-25: Thailand PDPC clarification on breach notification — https://iapp.org/news/a/thailand-s-pdpc-clarifies-data-breach-notification-requirements
- DLA Piper Data Protection Laws of the World, Thailand breach notification section checked 2026-08-25 — https://www.dlapiperdataprotection.com/index.html?c=TH&t=law
