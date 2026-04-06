# Production Launch Checklist — Lampang Bus System

**วันที่ UAT ผ่าน:** 2026-04-05 (56/56 checks passed)
**สถานะ:** Go-Live Ready

---

## ขั้นตอนก่อนเปิดใช้งาน (เรียงตามลำดับ)

### Phase A: เตรียมเซิร์ฟเวอร์

- [ ] **A1** เซิร์ฟเวอร์มี Docker + Docker Compose, Node.js 20 LTS, Git
- [ ] **A2** Clone repository
  ```bash
  git clone <repo-url> /opt/lampang-bus-system
  cd /opt/lampang-bus-system
  ```

### Phase B: ตั้งค่า Environment

- [ ] **B1** สร้างไฟล์ env (ทั้ง 2 ไฟล์)
  ```bash
  cp .env.example .env
  cp backend/.env.example backend/.env
  ```
- [ ] **B2** แก้ `.env` (root) — ตั้ง password ฐานข้อมูล
  ```
  DB_PASSWORD=<รหัสผ่านจริง>
  DB_ROOT_PASSWORD=<รหัส root จริง>
  ```
- [ ] **B3** แก้ `backend/.env` — ค่าบังคับ
  ```
  DB_PASSWORD=<ต้องตรงกับ root .env>
  JWT_SECRET=<สุ่มอย่างน้อย 32 ตัวอักษร>
  NODE_ENV=production
  CRON_API_KEY=<สุ่ม API key สำหรับ cron>
  ```
  สร้างค่าสุ่ม:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- [ ] **B4** (ถ้าจะใช้ LINE) ตั้งค่า LINE credentials ใน `backend/.env`
  ```
  LINE_CHANNEL_ACCESS_TOKEN=<จาก LINE Developers Console>
  LINE_CHANNEL_SECRET=<จาก LINE Developers Console>
  ```

### Phase C: ติดตั้งระบบ

- [ ] **C1** ติดตั้ง dependencies
  ```bash
  cd backend && npm install --production
  cd ../frontend && npm install
  ```
- [ ] **C2** Build frontend
  ```bash
  cd frontend && npm run build
  ```
  ตรวจ: ต้องมี `frontend/dist/index.html` หลัง build
- [ ] **C3** เริ่ม database
  ```bash
  cd /opt/lampang-bus-system
  docker-compose up -d
  docker-compose ps  # ต้องแสดง "healthy"
  ```
- [ ] **C4** รัน migrations (ตามลำดับ ห้ามข้าม)
  ```bash
  mysql -h localhost -u root -p lampang_bus < backend/migrations/001_initial_schema.sql
  mysql -h localhost -u root -p lampang_bus < backend/migrations/008_phase8_leaves_requests.sql
  mysql -h localhost -u root -p lampang_bus < backend/migrations/009_roster_request_new_student.sql
  mysql -h localhost -u root -p lampang_bus < backend/migrations/010_must_change_password.sql
  ```
  ตรวจ: `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'lampang_bus';` → ต้องได้ 24
- [ ] **C5** Seed ข้อมูลจาก Excel
  ```bash
  cd backend && npm run migrate
  ```
- [ ] **C6** สร้างบัญชี admin
  ```bash
  cd backend
  ADMIN_USERNAME=admin ADMIN_PASSWORD=<รหัสผ่านจริง> npm run create:admin
  ```
- [ ] **C7** (ถ้าต้องการ PDF ภาษาไทย) คัดลอก font
  ```bash
  mkdir -p backend/fonts
  cp /path/to/THSarabunNew.ttf backend/fonts/THSarabunNew.ttf
  ```

### Phase D: เปลี่ยนรหัสผ่าน default

- [ ] **D1** บังคับให้ทุกบัญชีเปลี่ยนรหัสผ่านตอน login ครั้งแรก
  ```sql
  UPDATE users SET must_change_password = TRUE WHERE role != 'admin';
  ```
  (admin ใช้รหัสที่ตั้งตอน create:admin แล้ว ไม่ต้องบังคับเปลี่ยน)

### Phase E: เปิดระบบ

- [ ] **E1** เริ่ม backend ด้วย pm2
  ```bash
  npm install -g pm2
  cd /opt/lampang-bus-system/backend
  NODE_ENV=production pm2 start src/index.js --name lampang-bus
  pm2 save
  pm2 startup
  ```
- [ ] **E2** ตั้ง cron สำหรับ LINE notifications (ถ้าใช้ LINE)
  ```bash
  crontab -e
  # เพิ่มบรรทัด:
  */5 * * * * curl -s -X POST -H "x-api-key: YOUR_CRON_API_KEY" http://localhost:3000/api/line/process-notifications > /dev/null 2>&1
  ```

---

## Smoke Test หลังเปิดระบบ

ให้ทดสอบจากเครื่องที่เข้าถึงเซิร์ฟเวอร์ได้:

| # | ทดสอบ | คำสั่ง / ขั้นตอน | ผลที่ต้องได้ |
|---|-------|----------------|------------|
| 1 | Health | `curl http://<server>:3000/health` | `{"success":true}` |
| 2 | หน้า login | เปิดเบราว์เซอร์ http://<server>:3000/ | เห็นหน้า login |
| 3 | Login admin | ใช้ admin / รหัสที่ตั้ง | เข้า dashboard ได้ |
| 4 | Login school | ใช้ ablp / 1234 | เข้า dashboard → ถูกบังคับเปลี่ยนรหัสผ่าน |
| 5 | Login driver | ใช้ทะเบียนรถ / 1234 | เห็น roster |
| 6 | CSV export | ที่หน้า reports → export CSV | ได้ไฟล์ .csv เปิดใน Excel เห็นภาษาไทย |
| 7 | API 403 | Login เป็น driver แล้วเข้า /school → | ถูก redirect ไม่เข้าถึง |

---

## Rollback (ถ้ามีปัญหาหลังเปิด)

### หยุดระบบ
```bash
pm2 stop lampang-bus
```

### ย้อนกลับโค้ด
```bash
cd /opt/lampang-bus-system
git log --oneline -5               # ดู commit ก่อนหน้า
git checkout <commit-hash-before>   # ย้อนกลับ
cd frontend && npm run build
pm2 restart lampang-bus
```

### ย้อนกลับ database (ถ้ามี backup)
```bash
mysql -u root -p lampang_bus < /path/to/backup.sql
```

---

## ข้อจำกัดที่ทราบ (ไม่กระทบ go-live)

| รายการ | สถานะ | ผลกระทบ |
|--------|--------|---------|
| Transport module (ตรวจสภาพรถ) | ยังไม่สร้าง | ไม่มี UI ตรวจรถ — วางแผนทำในเฟสถัดไป |
| Parent LIFF app | ยังไม่สร้าง | ผู้ปกครองใช้ LINE chat commands ได้ |
| PDF ภาษาไทย | ต้องมี font file | ถ้าไม่มี font จะ fallback เป็น Helvetica |
| import_batches | table มีแต่ยังไม่ใช้ | ระบบ track import ผ่าน audit_logs แทน |
