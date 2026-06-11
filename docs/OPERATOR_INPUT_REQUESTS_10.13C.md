# Operator Input Requests — 10.13C

Ready-to-send messages to unblock the field rollout. **Do not** attach real
student files or plate photos to this doc; **do not** ask for passwords/keys in
public chat. Files go through the system upload; secrets go on the server only.

---

## ข้อความที่ 1 — โรงเรียนบ้านบอม (ขอไฟล์รายชื่อนักเรียน)

> เรียน เจ้าหน้าที่โรงเรียนบ้านบอม
>
> ระบบรถรับส่งนักเรียนพร้อมรับข้อมูลนักเรียนของโรงเรียนเพิ่มเติมแล้วครับ/ค่ะ รบกวนดำเนินการดังนี้
>
> 1. เข้าสู่ระบบด้วยบัญชีของโรงเรียน
> 2. ไปที่เมนู **จัดการนักเรียน → นำเข้า** แล้วอัปโหลดไฟล์รายชื่อนักเรียนฉบับจริง (Excel หรือ CSV) ประมาณ **43 รายการ** หรืออย่างน้อยให้มีรหัสนักเรียน **3307, 3314, 3316, 3317, 3319**
> 3. ระบบจะ **แสดงตัวอย่างก่อนบันทึก** ตรวจดูความถูกต้องแล้วกด **นำเข้า**
> 4. ไฟล์มีข้อมูลส่วนบุคคลของนักเรียน **กรุณาอัปโหลดผ่านระบบโดยตรงเท่านั้น ไม่ส่งไฟล์ในกลุ่มไลน์สาธารณะ**
> 5. เมื่ออัปโหลดเสร็จ รบกวนแจ้งกลับเพื่อให้ทีมตรวจสอบความถูกต้องครับ/ค่ะ
>
> ขอบคุณครับ/ค่ะ

*(ปัจจุบันระบบมีนักเรียนบ้านบอม 38 คน คาดว่าจะเป็น 43 คนเมื่อเพิ่มครบ ส่วนโรงเรียนแม่ถอดไม่ได้รับผลกระทบ)*

---

## ข้อความที่ 2 — โรงเรียนไหล่หินราษฎร์บำรุง (ขอข้อมูลรถคันที่ 4)

> เรียน เจ้าหน้าที่โรงเรียนไหล่หินราษฎร์บำรุง
>
> ขณะนี้ระบบมีรถของโรงเรียน 3 คัน (นข 3204, นข 800, นข 6150) เพื่อเพิ่ม **รถคันที่ 4** รบกวนแจ้งข้อมูลทะเบียนรถดังนี้
>
> - หมวดอักษร (เช่น นข)
> - หมายเลขทะเบียน
> - จังหวัด (เช่น ลำปาง)
> - ประเภทรถ (เช่น รถตู้ / รถสองแถว)
>
> หากแบบฟอร์มต้องการ อาจขอชื่อ–เบอร์คนขับ/เจ้าของรถเพิ่มเติม
> ถ้าสะดวกส่งรูปป้ายทะเบียนที่ชัดเจน **กรุณาส่งเป็นข้อความส่วนตัวเท่านั้น ไม่ส่งในกลุ่มสาธารณะ**
>
> ขอบคุณครับ/ค่ะ

---

## ข้อความที่ 3 — โรงเรียนไหล่หิน (ขอไฟล์นักเรียน หลังเพิ่มรถแล้ว)

> เรียน เจ้าหน้าที่โรงเรียนไหล่หินราษฎร์บำรุง
>
> หลังจากเพิ่ม **รถคันที่ 4** ในระบบเรียบร้อยแล้ว รบกวนอัปโหลดไฟล์รายชื่อนักเรียน (**76 รายการ**) ที่เมนู **จัดการนักเรียน → นำเข้า**
>
> ⚠️ ข้อควรทราบ: ถ้ายังไม่ได้เพิ่มรถคันที่ 4 ก่อน รายชื่อนักเรียนที่ใช้รถคันนั้นจะถูกระบบกันไว้ (ขึ้นว่า **“ไม่พบรถ”**) จึงควรเพิ่มรถให้เรียบร้อยก่อนนำเข้า
>
> กรุณาอัปโหลดผ่านระบบโดยตรง ไม่ส่งไฟล์ในกลุ่มสาธารณะ และแจ้งกลับเมื่อเสร็จครับ/ค่ะ

---

## Message 4 — Server / Database Administrator (infrastructure)

> Two optional infrastructure steps to finish backup/restore hardening. **Neither changes production data.**
>
> **1) Restore-test DB** (enables safe backup-restore drills; never touches production):
> ```
> CREATE DATABASE lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
> ```
> The app DB user already has scoped privileges on this DB; backup dumps contain **no `USE`/`CREATE DATABASE`** line, so a restore drill cannot reach `lampang_bus`.
>
> **2) Off-host backup** — choose ONE and place the values on the server only (`scripts/offhost-backup-sync.env`, `chmod 600`). **Do not paste keys/passwords in chat.**
> - rclone: a configured remote + path → `OFFHOST_BACKUP_METHOD=rclone`, `OFFHOST_RCLONE_REMOTE=remote:path`
> - rsync: `OFFHOST_BACKUP_METHOD=rsync`, `OFFHOST_RSYNC_TARGET=user@host:/path`, `OFFHOST_SSH_KEY=/home/schoolbus/.ssh/…` (readable by the `schoolbus` user)
>
> Please confirm restore drills run **only** against `lampang_bus_restore_drill` (never production).

---

**Security reminders for whoever sends these:** files via system upload only · plate photos privately · DB/SSH credentials on the server, never in chat · no passwords requested in group channels.
