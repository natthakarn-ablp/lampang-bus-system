# LINE OA MVP — ระบบรถรับส่งนักเรียนจังหวัดลำปาง

## ภาพรวม

ผู้ปกครองใช้ LINE OA เป็นช่องทางหลัก ไม่ต้องสร้างบัญชีเว็บ

## การผูกบัญชี (Linking Flow)

1. ผู้ปกครองเพิ่มเพื่อน LINE OA
2. พิมพ์ "ผูกบัญชี"
3. ระบบถามเบอร์โทร → ระบุเบอร์ที่ลงทะเบียนไว้กับโรงเรียน
4. ระบบถามรหัสนักเรียน → ระบุรหัสนักเรียน
5. ระบบตรวจสอบ parents.phone + parent_student.student_id
6. ถ้าตรง → ผูกสำเร็จ → รับแจ้งเตือนอัตโนมัติ

## คำสั่งที่ใช้ได้

| คำสั่ง | ผลลัพธ์ |
|--------|---------|
| ผูกบัญชี | เริ่มขั้นตอนผูกข้อมูลบุตรหลาน |
| สถานะ | ดูสถานะรับ-ส่งวันนี้ |
| ข้อมูลบุตร | ดูข้อมูลนักเรียนที่ผูกไว้ |
| ช่วยเหลือ | แสดงเมนูคำสั่ง |

## การแจ้งเตือนอัตโนมัติ

- เมื่อคนขับเช็กอินนักเรียน → ผู้ปกครองได้รับข้อความ
- เมื่อคนขับเช็กเอาต์นักเรียน → ผู้ปกครองได้รับข้อความ
- เมื่อมีเหตุฉุกเฉิน → ผู้ปกครองได้รับข้อความ (ถ้าเกี่ยวข้อง)

## การตั้งค่า LINE OA

1. สร้าง LINE Official Account ที่ https://manager.line.biz
2. เปิด Messaging API ที่ LINE Developers Console
3. ตั้ง Webhook URL: `https://your-domain/api/line/webhook`
4. คัดลอก Channel Access Token + Channel Secret
5. ใส่ใน .env:
   ```
   LINE_CHANNEL_ACCESS_TOKEN=your_token
   LINE_CHANNEL_SECRET=your_secret
   ```

## ไฟล์ที่เกี่ยวข้อง

- `backend/src/routes/line.routes.js` — webhook + notification processor
- `backend/src/services/line.service.js` — linking, queries, messaging
- `backend/src/app.js` — route registration + raw body for webhook

## ข้อจำกัดปัจจุบัน (อัปเดต 2026-06-23)

- ยังไม่มี Rich Menu
- ยังไม่มี Flex Message (ใช้ text ธรรมดา) — *หมายเหตุ: Flex card สถานะผู้ปกครองมีใช้งานแล้วตั้งแต่ Phase 10.9 ผ่าน `line.service.js` ดูรายละเอียดใน `docs/user-manual.md` §9*
- ~~ยังไม่มี LIFF app~~ → **มีแล้ว** ตั้งแต่ Phase 10.9D:
  - `frontend/src/pages/parent/ParentStatus.jsx` — หน้าสถานะบุตรหลาน (LIFF webview)
  - `frontend/src/pages/parent/ParentLink.jsx` — หน้าผูกบัญชี LINE
  - route: `/parent` และ `/parent/link` ใน `frontend/src/App.jsx`
  - LIFF Endpoint URL ตั้งที่ `https://schoolbuslampang.com/parent/link` ใน LINE Console
- Notification processing ต้องเรียก POST /api/line/process-notifications เป็น cron (ตั้งไว้ทุก 5 นาทีใน crontab)
