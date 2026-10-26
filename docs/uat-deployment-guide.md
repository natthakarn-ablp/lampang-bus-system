# UAT / Deployment Guide — Lampang Bus System

> **Historical snapshot (ติดป้าย 6 ก.ย. 2569):** คู่มือติดตั้งและทดสอบสำหรับนักพัฒนา ฉบับ 6 เม.ย. 2569 — ไม่ใช่คู่มือผู้ใช้ และไม่ใช่สถานะของระบบปัจจุบัน รายการ migration ในหัวข้อ 2.4 หยุดที่ `010` (ปัจจุบันมีถึง `051`) จำนวนตารางไม่ใช่ 24 แล้ว และการเปิดหน้าผู้ปกครองด้วย `?line_user_id=` (หัวข้อ 5 และ 8.5) ใช้ไม่ได้อีกต่อไป เพราะระบบยืนยันตัวตนผู้ปกครองจาก LIFF id_token ที่ตรวจสอบกับ LINE เท่านั้น
> รหัสผ่านในหัวข้อ 4 เป็น **ค่าเริ่มต้นของชุดข้อมูลที่ seed ไว้บนเครื่องนักพัฒนา** สำหรับทดสอบเท่านั้น ห้ามใช้กับระบบจริง ระบบปัจจุบันบังคับรหัสผ่านอย่างน้อย 8 ตัวอักษร (ตั้ง `1234` ไม่ผ่าน) และบังคับเปลี่ยนรหัสผ่านในการเข้าใช้ครั้งแรก
> สถานะจริงล่าสุด: `docs/project-closure/handoff-2026-09-05.md` · การปฏิบัติงานจริง: `docs/OPERATOR_RUNBOOK.md`

## 1. Prerequisites

- Docker + Docker Compose
- Node.js 20 LTS
- Git
- Legacy Excel file at `input/Lampang_Bus_System_MasterV.1.xlsx` (for seed)

---

## 2. First-Time Setup

### 2.1 Clone & install

```bash
git clone <repo-url> lampang-bus-system
cd lampang-bus-system
cd backend && npm install
cd ../frontend && npm install
```

### 2.2 Environment (two .env files)

This project uses **two** `.env` files:

| File | Used by | Template |
|------|---------|----------|
| `.env` (project root) | docker-compose.yml | `.env.example` |
| `backend/.env` | Node.js backend | `backend/.env.example` |

```bash
# Root env (for Docker / MySQL)
cp .env.example .env

# Backend env (for Node.js app)
cp backend/.env.example backend/.env
```

Edit **both** files — mandatory changes:
- `.env` → `DB_ROOT_PASSWORD`, `DB_PASSWORD` — set MySQL passwords
- `backend/.env` → `DB_PASSWORD` — must match the root `.env` value
- `backend/.env` → `JWT_SECRET` — 32+ random characters (app refuses to start if shorter)

Optional (in `backend/.env`):
- `CRON_API_KEY` — secure the LINE notification endpoint
- `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` — for LINE integration
- `PDF_FONT_PATH` — path to THSarabunNew.ttf for Thai PDF export

### 2.3 Start database

```bash
cd lampang-bus-system
docker-compose up -d
```

Wait for health check to pass (~30 seconds):
```bash
docker-compose ps   # should show "healthy"
```

Adminer available at http://localhost:8080

### 2.4 Run migrations (in order)

Connect to MySQL and execute:
```bash
mysql -h localhost -u root -p lampang_bus < backend/migrations/001_initial_schema.sql
mysql -h localhost -u root -p lampang_bus < backend/migrations/008_phase8_leaves_requests.sql
mysql -h localhost -u root -p lampang_bus < backend/migrations/009_roster_request_new_student.sql
mysql -h localhost -u root -p lampang_bus < backend/migrations/010_must_change_password.sql
```

Or via Adminer: Import each SQL file in order.

**Verify:** 24 tables should exist after all migrations.

### 2.5 Seed data from Excel

```bash
cd backend
npm run migrate
```

This reads the legacy Excel workbook and populates:
- 5 affiliations, 2 schools, ~50 vehicles, ~55 drivers, ~268 students
- User accounts for all roles (default password: `1234`)

### 2.6 Create admin account

```bash
cd backend
ADMIN_USERNAME=admin ADMIN_PASSWORD=YourSecurePassword123 npm run create:admin
```

### 2.7 (Optional) Thai font for PDF

```bash
mkdir -p backend/fonts
# Copy THSarabunNew.ttf to backend/fonts/
```

If not provided, PDF export will use Helvetica (Latin only — Thai text will not render).

### 2.8 Install pre-commit hook

```bash
cd frontend
npm run hooks:install     # advisory mode
```

---

## 3. Running the System

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Adminer: http://localhost:8080

---

## 4. Test Accounts

| Role | Username | Default Password | Notes |
|------|----------|-----------------|-------|
| admin | admin | (set during create:admin) | Full access |
| school | ablp | 1234 | SCH0001 — อนุบาลลำปางฯ |
| school | test | 1234 | SCH0002 — ทดสอบ |
| affiliation | lpg1 | 1234 | AFF001 scope |
| province | tcc | 1234 | Province-wide |
| transport | transport1 | transport1234 | Vehicle inspections |
| driver | นข 1571 ลำปาง | 1234 | Vehicle-scoped (example) |

**All seeded accounts** use password `1234` except transport1 and admin. Change before production.

> **Driver login tip:** ใช้ทะเบียนรถเป็น username เช่น `นข 1571 ลำปาง` (มีเว้นวรรค)

---

## 5. UAT Checklist

### Auth
- [ ] Login with each role → lands on correct dashboard
- [ ] Wrong password → 401
- [ ] Expired token → auto-refresh works
- [ ] Logout → token revoked
- [ ] must_change_password flow (create new school account via affiliation)

### Driver
- [ ] See roster for assigned vehicle
- [ ] Checkin individual student
- [ ] Checkin all (bulk)
- [ ] Checkout student
- [ ] Report emergency
- [ ] Record student leave
- [ ] Cancel leave
- [ ] Submit roster change request (add/remove)
- [ ] Update profile + photo

### School
- [ ] Dashboard shows correct KPIs + charts
- [ ] Search students with filters
- [ ] Edit student info
- [ ] Move student to different vehicle
- [ ] Delete (soft) student
- [ ] Import students via CSV
- [ ] Download import template
- [ ] Add new vehicle + driver account
- [ ] Approve/reject roster request
- [ ] View audit logs

### Affiliation
- [ ] Dashboard shows schools summary
- [ ] Schools not complete list
- [ ] Create school admin account
- [ ] Reset school password
- [ ] View audit logs

### Province
- [ ] Dashboard with KPI cards + charts
- [ ] Exception panel shows warnings
- [ ] Trend chart (7 days)
- [ ] Drill-down to affiliations/schools
- [ ] View audit logs

### Reports
- [ ] Daily report by date
- [ ] Monthly report
- [ ] Summary report
- [ ] Export CSV (opens in Excel with Thai)
- [ ] Export Excel
- [ ] Export PDF (verify Thai rendering if font installed)

### Transport
- [ ] Login as transport1 → lands on transport dashboard
- [ ] Dashboard shows vehicle counts + inspection stats
- [ ] Vehicle list shows all vehicles with inspection badges
- [ ] Filter vehicles by insurance status (expiring/expired)
- [ ] Create new inspection record
- [ ] View inspection history with filters
- [ ] Non-transport users blocked (403)

### Parent (LIFF / direct URL)
- [ ] Open /parent without params → shows "ยังไม่ได้ผูกบัญชี"
- [ ] Open /parent?line_user_id=invalid → shows "ไม่พบข้อมูลบุตรหลาน"
- [ ] (If linked parent exists) Shows children list
- [ ] View today's status (morning/evening cards)
- [ ] View 7-day history table
- [ ] Mobile layout renders correctly

### LINE (if credentials configured)
- [ ] Webhook receives events
- [ ] Parent linking via phone + student ID
- [ ] Status query command
- [ ] Notification sent on checkin

---

## 6. Known Limitations

| Item | Status | Impact |
|------|--------|--------|
| import_batches table | Unused | Import tracking via audit_logs instead |
| PDF Thai font | Optional | Falls back to Helvetica without font |
| Dockerfile | Not created | Single-server deploy via pm2 |
| Nginx config | Not created | Backend serves frontend dist in production |
| Rich Menu | Not configured | Parents use LINE chat commands or LIFF URL |
| Flex Messages | Not implemented | Notifications use plain text |

---

## 7. Production Deployment (single server)

After UAT, deploy the system on a single server:

### 7.1 Build frontend
```bash
cd frontend
npm run build        # creates frontend/dist/
```

### 7.2 Start backend in production mode
```bash
cd backend
NODE_ENV=production node src/index.js
```

In production mode, the backend serves:
- `/api/*` — API endpoints
- `/uploads/*` — uploaded files (driver photos, etc.)
- `/*` — frontend static files from `frontend/dist/`

No separate nginx or frontend server needed for basic deployment.
For high traffic, add nginx as a reverse proxy in front.

### 7.3 Process manager (recommended)
```bash
npm install -g pm2
cd backend
NODE_ENV=production pm2 start src/index.js --name lampang-bus
pm2 save
pm2 startup    # auto-restart on reboot
```

### 7.4 LINE notification cron (if LINE is configured)
```bash
# Run every 5 minutes
crontab -e
*/5 * * * * curl -s -X POST -H "x-api-key: YOUR_CRON_API_KEY" http://localhost:3000/api/line/process-notifications > /dev/null
```

---

## 8. LIFF Configuration (for parent web access)

Parents can view their children's status via LIFF inside the LINE app.

### 8.1 Create LIFF app in LINE Developers Console

1. Go to [LINE Developers Console](https://developers.line.biz/)
2. Select your LINE Login channel (or create one under same provider as Messaging API)
3. Go to **LIFF** tab → **Add**
4. Configure:
   - **Size**: `Full`
   - **Endpoint URL**: `https://your-domain.com/parent`
   - **Scope**: `profile` (check the box)
   - **Bot link feature**: `On (Aggressive)` (recommended)
5. Copy the **LIFF ID** (format: `1234567890-AbCdEfGh`)

### 8.2 Set frontend env var

Add to the frontend build environment (before `npm run build`):

```bash
VITE_LIFF_ID=1234567890-AbCdEfGh
```

Or create `frontend/.env`:
```
VITE_LIFF_ID=1234567890-AbCdEfGh
```

### 8.3 Rebuild frontend

```bash
cd frontend
npm run build
```

### 8.4 Verify LIFF

- Open `https://liff.line.me/YOUR_LIFF_ID` in LINE app
- Should show parent status page
- If LINE user has linked children → shows children list
- If not linked → shows "ยังไม่ได้ผูกบัญชี" message

### 8.5 Without LIFF (dev/testing)

Access directly via URL query param:
```
https://your-domain.com/parent?line_user_id=Uxxxxxx
```

---

## 9. Production Checklist (post-UAT)

- [ ] Change all default passwords (`1234`) for seeded accounts
- [ ] Set strong `JWT_SECRET` (32+ random chars) in `backend/.env`
- [ ] Set `CRON_API_KEY` in `backend/.env` and use it in cron header
- [ ] Set `NODE_ENV=production` in `backend/.env`
- [ ] Configure LINE credentials (or accept dry-run mode)
- [ ] Set `VITE_LIFF_ID` and rebuild frontend (see section 8)
- [ ] Create transport user account (see section 4)
- [ ] Copy `THSarabunNew.ttf` to `backend/fonts/` for Thai PDF export
- [ ] Verify MySQL `event_scheduler=ON` (`SHOW VARIABLES LIKE 'event_scheduler'`)
- [ ] Set up MySQL backup strategy
- [ ] Set up cron for notification processing (see section 7.4)
- [ ] Run `cd frontend && npm run build` for production frontend
