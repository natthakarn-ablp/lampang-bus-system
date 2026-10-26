# แบบฟอร์มบันทึกการเผยแพร่ระบบ

> แบบฟอร์มนี้เป็นหลักฐานสำหรับผู้ดำเนินการจริง ไม่ใช่การอนุมัติล่วงหน้า และห้ามกรอกผลที่ไม่ได้มาจากคำสั่งหรือ CI run ของ release นั้น

## รุ่นและผู้รับผิดชอบ

| รายการ | ค่า |
|---|---|
| Commit / tag | |
| วันที่และเวลา | |
| ผู้ดำเนินการ | |
| ผู้อนุมัติ | |

## ผล UI gate

| Gate | คำสั่ง / CI run | Exit code | ผล |
|---|---|---:|---|
| Page-status Partial ratchet | `node scripts/ui-redesign/page-status.mjs --gate` | | |
| Route reconciliation + Partial ratchet | `node scripts/ui-redesign/route-matrix.mjs --gate` | | |
| Navigation baseline | `node scripts/ui-redesign/nav-snapshot.mjs --compare scripts/ui-redesign/baselines/nav-baseline.json` | | |
| Runtime browser capture | ลิงก์ job/artifact `ui-runtime` | | |

ถ้าเผยแพร่ทั้งที่ UI gate ใดมี exit code ไม่เป็น `0` ต้องบันทึกทั้งสองรายการนี้ ห้ามเว้นว่าง:

- เหตุผลที่ยอมรับความเสี่ยง:
- ชื่อผู้อนุมัติให้เผยแพร่ทั้งที่ gate ล้ม:

## ผลตรวจอื่นและทางถอยกลับ

| รายการ | หลักฐาน |
|---|---|
| Backend / frontend checks | |
| สำรองข้อมูลก่อนเผยแพร่ | |
| Health หลังเผยแพร่ | |
| ตำแหน่งหรือ commit สำหรับ rollback | |
