# คู่มือเปิดใช้การกู้คืนรหัสผ่านผู้ดูแลระบบผ่าน LINE

แผนขยายงานและ decision gate ของแต่ละบทบาทอยู่ที่ `docs/admin-password-recovery-roadmap.md`

สถานะเริ่มต้น: **ปิด (dark launch)** รองรับเฉพาะบัญชี `role=admin`

ระบบใช้หลักฐาน 2 ส่วนร่วมกัน:

1. ลิงก์อายุ 15 นาทีที่ส่งไปยัง LINE ซึ่งยืนยันตัวตนผ่าน LIFF ID Token ฝั่ง server
2. recovery code แบบใช้ครั้งเดียว ซึ่งแสดงเฉพาะตอนผูก LINE หรือสร้างรหัสชุดใหม่

ระบบไม่เก็บ token หรือ recovery code แบบ plaintext ในฐานข้อมูล และการเปลี่ยนรหัสผ่านจะอัปเดต `password_changed_at` เพื่อยกเลิก access/refresh token เดิม

## สิ่งที่ต้องพร้อมก่อนเปิด

- Production source อยู่บน commit ที่มี migration `049_admin_password_recovery.sql`
- `LINE_LIFF_ID` และ `LINE_CHANNEL_ACCESS_TOKEN` ใช้งานได้จริง
- Frontend build มี `VITE_LIFF_ID` ตรงกับ LIFF app เดียวกับ backend
- LIFF Endpoint URL เป็น `https://schoolbuslampang.com/parent/link` เพื่อให้เส้นทางย่อย `/parent/link/admin-recovery` ทำงานได้
- ผู้ดูแลระบบที่จะผูกบัญชีเพิ่ม LINE OA เป็นเพื่อนและรับ push message ได้
- มี backup ฐานข้อมูลที่ตรวจ checksum แล้วก่อน apply migration

## การติดตั้งแบบ dark launch

1. คง `FEATURE_ADMIN_PASSWORD_RECOVERY=false`
2. ตรวจว่า 3 ตารางยังไม่มี หรือเป็นตารางจาก migration 049 ที่ถูกต้อง
3. Apply `backend/migrations/049_admin_password_recovery.sql` เพียงครั้งเดียว
4. บันทึก filename และ SHA-256 checksum ใน `schema_migrations` ตาม workflow ปัจจุบัน
5. รัน `node backend/scripts/validate-migration-baseline.js --db`
6. Deploy backend/frontend โดยยังไม่เปิด flag แล้วตรวจ `/health`

Migration เป็น additive และไม่แก้ข้อมูลใน `users` หรือ `line_users` เดิม การ apply migration ขณะ flag ปิดไม่เปลี่ยนพฤติกรรมผู้ใช้

## UAT ที่ต้องทำด้วย admin จริง

ห้ามบันทึกรหัสผ่าน, ID Token, recovery code หรือ LINE user ID ลงภาพ/รายงาน UAT

- [ ] ตั้ง `FEATURE_ADMIN_PASSWORD_RECOVERY=true` และ restart backend สำเร็จ
- [ ] Login ด้วย admin แล้วเมนู “ความปลอดภัยบัญชี” ปรากฏ
- [ ] เปิด `/parent/link/admin-recovery` และกด “ยืนยัน LINE” สำเร็จ
- [ ] กรอกรหัสผ่านปัจจุบันผิด ระบบไม่ผูกบัญชี
- [ ] กรอกรหัสผ่านถูกต้องและได้รับข้อความทดสอบใน LINE
- [ ] ระบบแสดง recovery code 8 รหัสเพียงครั้งเดียว ดาวน์โหลดเก็บในที่ปลอดภัย
- [ ] ออกจากระบบ กด “ลืมรหัสผ่าน” และกรอกชื่อผู้ใช้ admin
- [ ] หน้าเว็บตอบข้อความกลาง โดยไม่ยืนยันว่าพบชื่อผู้ใช้หรือไม่
- [ ] LINE ได้รับลิงก์ และ URL หลังเปิดไม่แสดง token ใน address bar
- [ ] recovery code ผิดถูกปฏิเสธ และลิงก์ถูกล็อกเมื่อผิดครบ 5 ครั้ง
- [ ] recovery code ถูกต้อง + รหัสผ่านใหม่ตาม policy เปลี่ยนสำเร็จ
- [ ] รหัสเดิม login ไม่ได้ รหัสใหม่ login ได้
- [ ] ลิงก์และ recovery code เดิมใช้ซ้ำไม่ได้
- [ ] ตรวจ audit log พบ `admin_line_recovery_linked`, `admin_password_reset_requested`, `admin_password_recovered`
- [ ] ทดสอบ “สร้างรหัสชุดใหม่” แล้วชุดเดิมและลิงก์เดิมใช้ไม่ได้
- [ ] ทดสอบ “ยกเลิกการผูก” แล้วหน้า forgot-password ไม่ส่งลิงก์

หลักฐานขั้นต่ำ: วันเวลาไทย, commit, ผู้ทดสอบ, browser/device, ผลแต่ละข้อ, ภาพที่ปิดข้อมูลลับ และ audit log ID ที่เกี่ยวข้อง

## การเปิดใช้งานจริง

เปิดใช้หลัง UAT ผ่านและผู้ดูแลระบบเจ้าของบัญชียืนยันว่าจัดเก็บ recovery code แล้วเท่านั้น จากนั้นเฝ้าดู:

- HTTP 4xx/5xx ของ `/api/auth/recovery/*`
- LINE push failure
- audit action ที่มี `admin_password_reset_requested`
- จำนวน recovery code คงเหลือของ admin

## ปิดฉุกเฉินและช่องทางสำรอง

1. ตั้ง `FEATURE_ADMIN_PASSWORD_RECOVERY=false`
2. Restart backend และตรวจว่า `/api/auth/recovery/admin/status` ตอบ 404
3. ใช้กระบวนการ reset โดย admin/operator เดิมเป็นช่องทางสำรอง

ไม่ต้อง DROP ตารางระหว่าง rollback เพราะการปิด flag จะซ่อน endpoint และรักษาหลักฐาน audit ไว้ ห้ามลบตารางจนกว่าจะพ้นระยะตรวจสอบเหตุการณ์และได้รับอนุมัติจากเจ้าของระบบ
