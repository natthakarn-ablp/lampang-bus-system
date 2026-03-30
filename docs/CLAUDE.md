# ระบบรถรับส่งนักเรียนจังหวัดลำปาง — CLAUDE.md

## Master Specification สำหรับ Claude Code

> **ที่มา:** ระบบเดิมทำด้วย Google Apps Script + Google Sheets  
> **เป้าหมาย:** Migrate เป็น Web Application + MySQL ฐานข้อมูลกลาง + LINE OA  
> **เอกสารนี้ใช้เป็น context หลักเมื่อสั่ง Claude Code ทำงาน**

---

## 1. ภาพรวมระบบเดิม (Google Apps Script V2)

### 1.1 โครงสร้าง Sheets เดิม

| Sheet | หน้าที่ |
|-------|---------|
| `PARAM` | ค่า config ระบบ (key-value): LINE token, timezone, ภาคเรียน |
| `USERS` | บัญชีผู้ใช้ทุกบทบาท (username, password, role, scope_type, scope_id) |
| `DATA` | ข้อมูลหลัก: นักเรียน + รถ + คนขับ + ผู้ปกครอง + ประกัน (27 คอลัมน์) |
| `VIEW_SEARCH` | Denormalized view สำหรับค้นหาเร็ว (สร้างจาก DATA + hash) |
| `Log_YYYY_MM` | เช็กอิน/เช็กเอาท์ รายเดือน |
| `LINE_LOG` | ประวัติข้อความ LINE |
| `EMERGENCY_LOG` | บันทึกเหตุฉุกเฉิน |
| `SYNC_REPORT` | รายงานการ sync ข้อมูล |
| `STATUS_TODAY` | สถานะเช็กอิน/เช็กเอาท์วันนี้ (V2) |
| `VEHICLE_INDEX` | ดัชนีรถเพื่อค้นหาเร็ว (V2) |
| `QUEUE_LOG_YYYY_MM` | คิวสำหรับ batch write (V2) |

### 1.2 GAS Files เดิม (V2)

```
01_Install_V2.gs       — Auto installer, สร้าง sheet + PARAM
02_V2_Core.gs          — Cache, PARAM reader, timezone, helper
03_V2_StatusIndex.gs   — สร้าง STATUS_TODAY + VEHICLE_INDEX ทุกวัน
04_V2_Queue.gs         — Queue system สำหรับเขียน log แบบ batch
05_V2_Archive.gs       — Archive log เก่าไปอีก spreadsheet
06_V2_Override.gs      — Override bottleneck functions จาก Code.gs เดิม
07_V2_DriverRoster.gs  — สร้าง roster คนขับประจำวัน
Code.gs (เดิม)         — Web endpoints: login, getStudents, sendStatusAndLog
index.html             — UI หลัก (HTML+JS ใน GAS)
```

### 1.3 บทบาทผู้ใช้จาก USERS Sheet

| role | scope_type | จำนวนตัวอย่าง | หน้าที่ |
|------|-----------|---------------|---------|
| `driver` | — | 55 คน | เช็กอิน/เช็กเอาท์นักเรียน (login ด้วยทะเบียนรถ) |
| `school` | SCHOOL | 2 โรงเรียน | จัดการข้อมูลนักเรียน, ดูสถานะ |
| `affiliation` | AFFILIATION | 5 เขต | ดู dashboard, export รายงาน |
| `province` | PROVINCE | 1 (สภาองค์กรของผู้บริโภค) | ดูภาพรวมทั้งจังหวัด = ส่วนกลาง |
| `transport` | — | (ยังไม่มีในข้อมูลเดิม) | ตรวจสภาพรถ, บันทึกผล |
| `parent` | — | (ผ่าน LINE OA เท่านั้น) | ดูสถานะบุตรหลาน, รับแจ้งเตือน |

### 1.4 ข้อมูลหลักจาก DATA Sheet (27 คอลัมน์)

```
รหัสโรงเรียน, โรงเรียน, หน่วยงาน(AFF ID), ชื่อหน่วยงาน,
รหัสนักเรียน, เลขบัตรประชาชน(13หลัก), คำนำหน้า, ชื่อ, นามสกุล,
ระดับชั้น, ห้อง,
ใช้บริการรอบเช้า(Y/N), ใช้บริการรอบเย็น(Y/N),
ชื่อผู้ปกครอง, เบอร์โทรผู้ปกครอง, จุดลงรถ/ที่อยู่,
ทะเบียนรถรับส่ง, ประเภทรถ, ชื่อคนขับรถ, เบอร์โทรคนขับ,
ชื่อผู้ดูแลรถ, เบอร์โทรผู้ดูแลรถ,
ชื่อผู้ครอบครองรถ, เบอร์โทรผู้ครอบครอง,
สถานะประกันภัย, ประเภทประกัน, วันหมดอายุประกัน
```

### 1.5 Log Entry (เช็กอิน/เช็กเอาท์)

```
timestamp, term_id, plate_no, vehicle_id, cid_hash,
student_name, student_school_id, session(morning/evening),
status(รับแล้ว/ส่งแล้ว), date
```

---

## 2. สถาปัตยกรรมใหม่ (Web App + MySQL)

### 2.1 Tech Stack

```
Backend:    Node.js 20 LTS + Express 4
Frontend:   React 18 + Vite + Tailwind CSS
Database:   MySQL 8.0 (InnoDB, utf8mb4_unicode_ci)
Auth:       JWT (jsonwebtoken) + bcrypt
ORM/Query:  mysql2 (raw queries with parameterized statements)
Export:     exceljs (Excel), json2csv (CSV), pdfkit (PDF)
LINE:       LINE Messaging API (@line/bot-sdk) + LIFF
Hosting:    VPS / Cloud (Docker Compose)
Testing:    Jest + Supertest (API tests)
```

### 2.2 โครงสร้างโปรเจกต์

```
lampang-bus-system/
├── CLAUDE.md                    ← ไฟล์นี้
├── docker-compose.yml           ← MySQL + App
├── .env.example
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js             ← Express entry
│   │   ├── config/
│   │   │   ├── database.js      ← MySQL connection pool
│   │   │   └── env.js           ← Environment variables
│   │   ├── middleware/
│   │   │   ├── auth.js          ← JWT verify + role check
│   │   │   ├── roleGuard.js     ← Per-role permission
│   │   │   └── errorHandler.js  ← Global error handler
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── driver.routes.js
│   │   │   ├── school.routes.js
│   │   │   ├── district.routes.js    ← เขตพื้นที่
│   │   │   ├── central.routes.js     ← ส่วนกลาง
│   │   │   ├── transport.routes.js   ← ขนส่ง
│   │   │   ├── parent.routes.js      ← สำหรับ LINE LIFF
│   │   │   ├── line.routes.js        ← LINE Webhook
│   │   │   └── report.routes.js
│   │   ├── services/
│   │   │   ├── checkin.service.js
│   │   │   ├── line.service.js
│   │   │   ├── notification.service.js
│   │   │   ├── report.service.js
│   │   │   ├── import.service.js
│   │   │   └── export.service.js
│   │   └── utils/
│   │       ├── hash.js           ← CID hashing (SHA256)
│   │       ├── response.js       ← Standard API response helper
│   │       └── audit.js          ← Audit log helper
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   ├── scripts/
│   │   └── migrate-from-excel.js ← อ่าน xlsx → insert MySQL
│   └── tests/
│       ├── auth.test.js
│       ├── driver.test.js
│       └── school.test.js
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── driver/
│   │   │   │   ├── DriverDashboard.jsx
│   │   │   │   ├── StudentList.jsx
│   │   │   │   └── CheckinPanel.jsx
│   │   │   ├── school/
│   │   │   │   ├── SchoolDashboard.jsx
│   │   │   │   ├── StudentManagement.jsx
│   │   │   │   ├── ImportStudents.jsx
│   │   │   │   └── ParentManagement.jsx
│   │   │   ├── district/
│   │   │   │   ├── DistrictDashboard.jsx
│   │   │   │   └── SchoolReport.jsx
│   │   │   ├── central/
│   │   │   │   ├── CentralDashboard.jsx
│   │   │   │   └── PolicyReport.jsx
│   │   │   └── transport/
│   │   │       ├── TransportDashboard.jsx
│   │   │       └── InspectionForm.jsx
│   │   ├── components/
│   │   │   ├── Layout.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── DashboardCard.jsx
│   │   │   └── DataTable.jsx
│   │   └── hooks/
│   │       └── useAuth.js
│   └── vite.config.js
└── line-bot/                    ← helper modules เท่านั้น (ไม่ใช่ HTTP entrypoint)
    ├── rich-menu.js             ← Rich Menu setup script (รันครั้งเดียว)
    └── flex-messages/           ← Flex Message templates
        ├── parent-status.js
        ├── driver-checkin.js
        └── emergency.js
```

> **LINE Webhook Entrypoint:** ใช้ `backend/src/routes/line.routes.js` เป็น HTTP entrypoint หลัก (รับ webhook จาก LINE Platform)  
> `line-bot/` เป็น helper/template modules เท่านั้น — ไม่มี Express server แยก

---

## 3. MySQL Schema

### 3.1 Status Code Convention

**สำคัญ: เก็บ code เป็นภาษาอังกฤษทั้งหมด แล้ว map เป็นไทยที่ frontend**

| Code (เก็บใน DB) | แสดงผลไทย | ใช้ใน |
|-------------------|----------|-------|
| `CHECKED_IN` | รับแล้ว | checkin_logs.status |
| `CHECKED_OUT` | ส่งแล้ว | checkin_logs.status |
| `ABSENT` | ไม่มา | checkin_logs.status |
| `CANCELLED` | ยกเลิก | checkin_logs.status |
| `PASSED` | ผ่าน | vehicle_inspections.result |
| `FAILED` | ไม่ผ่าน | vehicle_inspections.result |
| `NEEDS_FIX` | ต้องแก้ไข | vehicle_inspections.result |
| `PENDING` | รอตรวจ | vehicle_inspections.result |

### 3.2 ตาราง Normalized

```sql
-- ============================================
-- 1. ตารางอ้างอิง (Reference Tables)
-- ============================================

CREATE TABLE affiliations (
  id VARCHAR(10) PRIMARY KEY,           -- 'AFF001', 'AFF002', ...
  name VARCHAR(200) NOT NULL,           -- 'สพป.ลำปาง เขต 1'
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE schools (
  id VARCHAR(10) PRIMARY KEY,           -- 'SCH0001'
  name VARCHAR(200) NOT NULL,
  affiliation_id VARCHAR(10),
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (affiliation_id) REFERENCES affiliations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE terms (
  id VARCHAR(10) PRIMARY KEY,           -- '2568-2'
  name VARCHAR(50),
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. รถและคนขับ
-- ============================================

CREATE TABLE vehicles (
  id VARCHAR(20) PRIMARY KEY,           -- 'V-c80d811728f3' (เหมือนเดิม)
  plate_no VARCHAR(50) NOT NULL UNIQUE, -- 'นข 2210 ลำปาง'
  vehicle_type VARCHAR(50),
  owner_name VARCHAR(100),
  owner_phone VARCHAR(20),
  insurance_status VARCHAR(50),
  insurance_type VARCHAR(50),
  insurance_expiry DATE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE drivers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  line_user_id VARCHAR(50),            -- สำหรับ LINE OA
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- คนขับ ↔ รถ (many-to-many, รองรับสลับรถ/คนขับสำรอง)
CREATE TABLE driver_vehicle_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  vehicle_id VARCHAR(20) NOT NULL,
  term_id VARCHAR(10),
  start_date DATE NOT NULL,
  end_date DATE NULL,                   -- NULL = ยังใช้อยู่
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_active (is_active, driver_id),
  INDEX idx_vehicle_active (is_active, vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vehicle_attendants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id VARCHAR(20),
  name VARCHAR(100),
  phone VARCHAR(20),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. นักเรียนและผู้ปกครอง
-- ============================================

CREATE TABLE students (
  id INT PRIMARY KEY,                   -- รหัสนักเรียน (เช่น 21199)
  cid_hash VARCHAR(64) NOT NULL,        -- SHA256 hash ของเลข 13 หลัก
  prefix VARCHAR(20),                   -- 'เด็กชาย', 'เด็กหญิง'
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  grade VARCHAR(20),                    -- 'ป.1', 'ม.3'
  classroom VARCHAR(20),                -- '1', '2', 'A', '1/1', 'อนุบาล3/2'
  school_id VARCHAR(10),
  vehicle_id VARCHAR(20),               -- รถประจำปัจจุบัน (shortcut, ดูจาก assignment ได้)
  dropoff_address TEXT,
  morning_enabled BOOLEAN DEFAULT TRUE,
  evening_enabled BOOLEAN DEFAULT TRUE,
  term_id VARCHAR(10),                  -- ภาคเรียน
  import_batch_id INT NULL,             -- ชุดนำเข้า (ถ้านำเข้าเป็นชุด)
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_school (school_id),
  INDEX idx_vehicle (vehicle_id),
  INDEX idx_cid_hash (cid_hash),
  INDEX idx_import_batch (import_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE parents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(20),
  line_user_id VARCHAR(50),            -- ผูกจาก LINE OA
  verified BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE parent_student (
  parent_id INT,
  student_id INT,
  relationship VARCHAR(20) DEFAULT 'parent',
  approved BOOLEAN DEFAULT FALSE,
  approved_by INT NULL,                 -- users.id ที่อนุมัติ
  approved_at TIMESTAMP NULL,
  PRIMARY KEY (parent_id, student_id),
  FOREIGN KEY (parent_id) REFERENCES parents(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. ผู้ใช้งานระบบ (RBAC)
-- ============================================

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,  -- bcrypt hash (ไม่ใช่ plain text)
  role ENUM('driver','school','affiliation','province','transport','admin') NOT NULL,
  scope_type ENUM('SCHOOL','AFFILIATION','PROVINCE') NULL,
  scope_id VARCHAR(20) NULL,            -- SCH0001, AFF001, LPG
  display_name VARCHAR(200),
  driver_id INT NULL,                   -- ถ้า role=driver ผูกกับ drivers.id
  is_active BOOLEAN DEFAULT TRUE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  INDEX idx_role (role),
  INDEX idx_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. เช็กอิน/เช็กเอาท์ (แทน Log sheet)
-- ============================================

CREATE TABLE checkin_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  term_id VARCHAR(10),
  vehicle_id VARCHAR(20),
  plate_no VARCHAR(50),
  student_id INT,
  cid_hash VARCHAR(64),
  student_name VARCHAR(100),
  session ENUM('morning','evening') NOT NULL,
  status ENUM('CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED') NOT NULL,
  check_date DATE NOT NULL,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checked_by INT,                       -- users.id ของคนที่กด
  source ENUM('web','line','auto') DEFAULT 'web',
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  INDEX idx_date_vehicle (check_date, vehicle_id),
  INDEX idx_date_student (check_date, student_id),
  INDEX idx_term_date (term_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. สถานะวันนี้ (แทน STATUS_TODAY)
-- ============================================

CREATE TABLE daily_status (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  check_date DATE NOT NULL,
  vehicle_id VARCHAR(20),
  student_id INT,
  cid_hash VARCHAR(64),
  student_name VARCHAR(100),
  morning_done BOOLEAN DEFAULT FALSE,
  morning_ts TIMESTAMP NULL,
  evening_done BOOLEAN DEFAULT FALSE,
  evening_ts TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_date_student (check_date, student_id),
  INDEX idx_date_vehicle (check_date, vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. ตรวจสภาพรถ (สำหรับบทบาท ขนส่ง)
-- ============================================

CREATE TABLE vehicle_inspections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id VARCHAR(20),
  inspected_by INT,                     -- users.id (role=transport)
  inspection_date DATE NOT NULL,
  expiry_date DATE,
  result ENUM('PASSED','FAILED','NEEDS_FIX','PENDING') NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_vehicle_date (vehicle_id, inspection_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 8. เหตุฉุกเฉิน
-- ============================================

CREATE TABLE emergency_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reported_by INT,                      -- users.id
  channel ENUM('web','line') DEFAULT 'web',
  vehicle_id VARCHAR(20),
  plate_no VARCHAR(50),
  detail TEXT,
  note TEXT,
  result TEXT,
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 9. LINE Integration (ไม่ใช้ polymorphic — แยก FK ชัดเจน)
-- ============================================

CREATE TABLE line_users (
  line_user_id VARCHAR(50) PRIMARY KEY,
  user_type ENUM('parent','driver') NOT NULL,
  parent_id INT NULL,                   -- FK ชัดเจน ถ้า user_type='parent'
  driver_id INT NULL,                   -- FK ชัดเจน ถ้า user_type='driver'
  display_name VARCHAR(100),
  verified BOOLEAN DEFAULT FALSE,
  linked_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES parents(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  -- ตรวจสอบว่าต้องมีอย่างน้อย 1 FK ที่ไม่ NULL ตาม user_type
  CONSTRAINT chk_linked CHECK (
    (user_type = 'parent' AND parent_id IS NOT NULL AND driver_id IS NULL) OR
    (user_type = 'driver' AND driver_id IS NOT NULL AND parent_id IS NULL) OR
    (parent_id IS NULL AND driver_id IS NULL)  -- ยังไม่ได้ผูก
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE line_message_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  line_user_id VARCHAR(50),             -- ไม่ใส่ FK โดยตั้งใจ: webhook อาจมาก่อนการผูกบัญชีใน line_users
  source_type VARCHAR(20),              -- 'user', 'group', 'room'
  source_id VARCHAR(50),
  message_text TEXT,
  result TEXT,
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_line_user (line_user_id)    -- index สำหรับ lookup แต่ไม่บังคับ FK
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  target_line_user_id VARCHAR(50),
  notification_type ENUM('checkin','checkout','emergency','system') NOT NULL,
  student_id INT,
  message_json JSON,                    -- Flex Message JSON (ใช้ JSON type ไม่ใช่ TEXT)
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP NULL,
  error_message TEXT NULL,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 10. Import Batches (ติดตามการนำเข้าข้อมูลเป็นชุด)
-- ============================================

CREATE TABLE import_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id VARCHAR(10),
  imported_by INT,                      -- users.id
  filename VARCHAR(255),
  total_rows INT DEFAULT 0,
  success_rows INT DEFAULT 0,
  error_rows INT DEFAULT 0,
  error_details JSON NULL,              -- [{row: 5, field: 'cid', message: '...'}]
  status ENUM('PROCESSING','COMPLETED','FAILED') DEFAULT 'PROCESSING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 11. Audit Log (ประวัติการแก้ไข)
-- ============================================

CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action ENUM('CREATE','UPDATE','DELETE','EXPORT','LOGIN','IMPORT','APPROVE') NOT NULL,
  entity_type VARCHAR(50),              -- 'student', 'vehicle', 'checkin', ...
  entity_id VARCHAR(50),
  old_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_action (user_id, action),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 12. ค่าพารามิเตอร์ระบบ (แทน PARAM sheet)
-- ============================================

CREATE TABLE system_params (
  param_key VARCHAR(100) PRIMARY KEY,
  param_value TEXT,
  description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_params VALUES
('SYSTEM_NAME', 'ระบบรถรับส่งนักเรียนจังหวัดลำปาง', 'ชื่อระบบ'),
('TIMEZONE', 'Asia/Bangkok', 'Timezone'),
('CURRENT_TERM', '2568-2', 'ภาคเรียนปัจจุบัน'),
('LINE_CHANNEL_ACCESS_TOKEN', '', 'LINE Messaging API Token'),
('LINE_CHANNEL_SECRET', '', 'LINE Channel Secret'),
('EMERGENCY_GROUP_ID', '', 'LINE Group ID สำหรับแจ้งเหตุฉุกเฉิน');

-- ============================================
-- 13. Deferred Foreign Keys (ALTER TABLE)
-- ============================================
-- เนื่องจาก circular dependency (เช่น students อ้าง import_batches
-- ที่สร้างทีหลัง) ต้องใช้ ALTER TABLE เพิ่ม FK หลัง CREATE TABLE ทั้งหมดแล้ว

ALTER TABLE students
  ADD CONSTRAINT fk_students_import_batch
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);

ALTER TABLE parent_student
  ADD CONSTRAINT fk_parent_student_approved_by
  FOREIGN KEY (approved_by) REFERENCES users(id);

ALTER TABLE vehicle_inspections
  ADD CONSTRAINT fk_inspections_inspected_by
  FOREIGN KEY (inspected_by) REFERENCES users(id);

ALTER TABLE emergency_logs
  ADD CONSTRAINT fk_emergency_reported_by
  FOREIGN KEY (reported_by) REFERENCES users(id);

ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_target_line
  FOREIGN KEY (target_line_user_id) REFERENCES line_users(line_user_id);
```

### 3.3 Table Creation Order

เนื่องจากมี FK ข้ามตาราง ต้องสร้างตามลำดับนี้:

```
1. affiliations, terms
2. schools (→ affiliations)
3. vehicles
4. drivers
5. driver_vehicle_assignments (→ drivers, vehicles)
6. vehicle_attendants (→ vehicles)
7. students (→ schools, vehicles) — ยังไม่ใส่ FK import_batch_id
8. parents
9. parent_student (→ parents, students) — ยังไม่ใส่ FK approved_by
10. users (→ drivers)
11. checkin_logs (→ vehicles, students)
12. daily_status
13. vehicle_inspections (→ vehicles) — ยังไม่ใส่ FK inspected_by
14. emergency_logs (→ vehicles) — ยังไม่ใส่ FK reported_by
15. line_users (→ parents, drivers)
16. line_message_logs
17. notifications — ยังไม่ใส่ FK target_line_user_id
18. import_batches (→ schools)
19. audit_logs
20. system_params
21. ALTER TABLE x5 (เพิ่ม deferred FK ทั้ง 5 ตัว)
```

### 3.4 LINE user_id Source of Truth

`parents.line_user_id` และ `drivers.line_user_id` เป็น **shortcut field** เท่านั้น

**Source of truth คือตาราง `line_users`**

- เมื่อผูกบัญชี LINE → INSERT/UPDATE ที่ `line_users` ก่อน แล้วค่อย copy ค่า `line_user_id` ไปที่ `parents` หรือ `drivers`
- เมื่อ query → ใช้ `line_users` เป็นหลัก, shortcut ใช้เฉพาะ JOIN ที่ต้องการความเร็ว
- เมื่อยกเลิกผูก LINE → ลบจาก `line_users` + set NULL ที่ parents/drivers

---

## 4. API Conventions

### 4.1 Standard Response Format

**ทุก API ต้องคืน JSON ในรูปแบบเดียวกัน:**

```json
// Success
{
  "success": true,
  "message": "OK",
  "data": {},
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 150
  }
}

// Error
{
  "success": false,
  "message": "รหัสนักเรียนซ้ำ",
  "errors": [
    { "field": "id", "message": "รหัสนักเรียน 21199 มีอยู่ในระบบแล้ว" }
  ],
  "data": null
}
```

### 4.2 HTTP Status Codes

| Code | ใช้เมื่อ |
|------|---------|
| `200` | สำเร็จ (GET, PUT, DELETE) |
| `201` | สร้างข้อมูลใหม่สำเร็จ (POST) |
| `400` | ข้อมูลไม่ถูกต้อง (validation error) |
| `401` | ไม่ได้ login / token หมดอายุ |
| `403` | ไม่มีสิทธิ์เข้าถึง (role/scope ไม่ตรง) |
| `404` | ไม่พบข้อมูล |
| `409` | ข้อมูลซ้ำ (duplicate) |
| `422` | ข้อมูลไม่สามารถประมวลผลได้ (เช่น import มี error) |
| `500` | Internal server error |

### 4.3 Pagination

```
GET /api/school/students?page=1&per_page=20&sort=first_name&order=asc
```

### 4.4 Filter & Search

```
GET /api/school/students?search=ธนันธร&grade=ป.1&morning_enabled=true
GET /api/district/reports/daily?date=2026-02-06&school_id=SCH0001
```

---

## 5. API Endpoints (แยกตามบทบาท)

### 5.1 Auth

```
POST /api/auth/login          — ทุกบทบาท (web)
POST /api/auth/line-verify    — ผู้ปกครอง/คนขับ ผ่าน LINE
GET  /api/auth/me             — ดูข้อมูลตัวเอง
POST /api/auth/change-password
POST /api/auth/refresh-token
POST /api/auth/logout            — revoke refresh token ลง revoked_tokens
```

**Refresh Token Strategy: Stateless with DB revocation list**

- Login ส่งคืน `access_token` (หมดอายุ 24h) + `refresh_token` (หมดอายุ 7d)
- ทั้งคู่เป็น JWT ไม่เก็บใน DB ปกติ (stateless)
- เมื่อ access_token หมดอายุ → client เรียก `/api/auth/refresh-token` ด้วย refresh_token → ได้ access_token ใหม่
- เมื่อ logout หรือเปลี่ยนรหัสผ่าน → เก็บ refresh_token jti ลงตาราง `revoked_tokens` (blacklist)
- ตาราง `revoked_tokens` มี TTL auto-cleanup ลบ record ที่เลยวัน expiry แล้ว
- **Logout ต้องบันทึก refresh token ลง `revoked_tokens`** เพื่อป้องกันการนำ token กลับมาใช้ซ้ำ

```sql
CREATE TABLE revoked_tokens (
  jti VARCHAR(64) PRIMARY KEY,         -- JWT ID ของ refresh_token
  user_id INT NOT NULL,
  revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,        -- ใช้สำหรับ cleanup
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **หมายเหตุ:** ตาราง `revoked_tokens` เป็นตารางที่ 22 — แต่เป็น supporting table ไม่ใช่ core business table

**Cleanup Strategy สำหรับ revoked_tokens:**
- ใช้ MySQL Event Scheduler (แนะนำ) หรือ cron job ภายนอก
- ลบ record ที่ `expires_at < NOW()` ทุกวัน เวลา 03:00
- SQL: `DELETE FROM revoked_tokens WHERE expires_at < NOW();`
- ถ้าใช้ MySQL Event:
```sql
CREATE EVENT IF NOT EXISTS cleanup_revoked_tokens
ON SCHEDULE EVERY 1 DAY STARTS CURRENT_DATE + INTERVAL 3 HOUR
DO DELETE FROM revoked_tokens WHERE expires_at < NOW();
```
- ถ้าใช้ cron: เพิ่ม script `backend/scripts/cleanup-revoked-tokens.js` แล้วตั้ง cron `0 3 * * *`

### 5.2 คนขับรถ (role: driver)

```
GET  /api/driver/roster                    — รายชื่อนักเรียนในรถวันนี้
GET  /api/driver/roster?session=morning    — เฉพาะรอบเช้า
POST /api/driver/checkin                   — เช็กอิน 1 คน
POST /api/driver/checkout                  — เช็กเอาท์ 1 คน
POST /api/driver/checkin-all               — เช็กอินทั้งคัน
POST /api/driver/emergency                 — แจ้งเหตุฉุกเฉิน
GET  /api/driver/status-today              — สถานะรวมวันนี้
```

### 5.3 โรงเรียน (role: school, scope: SCH0001)

```
GET    /api/school/students                — รายชื่อนักเรียนในโรงเรียน
POST   /api/school/students                — เพิ่มนักเรียน
PUT    /api/school/students/:id            — แก้ไข
DELETE /api/school/students/:id            — soft delete
POST   /api/school/students/import         — นำเข้า CSV/Excel → สร้าง import_batch
GET    /api/school/students/template       — ดาวน์โหลด template
GET    /api/school/import-batches          — ดูประวัติการนำเข้า
GET    /api/school/daily-status            — สถานะขึ้นลงรถวันนี้
GET    /api/school/parents                 — รายชื่อผู้ปกครอง
POST   /api/school/parents/:id/approve     — อนุมัติผูกผู้ปกครอง
GET    /api/school/vehicles                — รถที่ให้บริการโรงเรียนนี้
POST   /api/school/vehicles                — เพิ่ม/แก้ไขข้อมูลรถ
GET    /api/school/reports/daily            — รายงานรายวัน
GET    /api/school/reports/monthly          — รายงานรายเดือน
GET    /api/school/export/:type            — export (type = excel | csv | pdf)
```

### 5.4 เขตพื้นที่ (role: affiliation, scope: AFF001)

```
GET  /api/district/dashboard               — dashboard ภาพรวม
GET  /api/district/schools                 — โรงเรียนในสังกัด
GET  /api/district/schools/:id/status      — สถานะรายโรงเรียน
GET  /api/district/reports/daily
GET  /api/district/reports/monthly
GET  /api/district/reports/yearly
GET  /api/district/export/:type
GET  /api/district/compare                 — เปรียบเทียบระหว่างโรงเรียน
```

### 5.5 ส่วนกลาง (role: province, scope: LPG)

```
GET  /api/central/dashboard                — ภาพรวมทั้งจังหวัด
GET  /api/central/districts                — ทุกเขตพื้นที่
GET  /api/central/districts/:id/dashboard
GET  /api/central/schools                  — ทุกโรงเรียน
GET  /api/central/reports/policy           — รายงานเชิงนโยบาย
GET  /api/central/export/:type
GET  /api/central/audit-logs               — ประวัติการแก้ไข
GET  /api/central/system-params            — ตั้งค่าระบบ
PUT  /api/central/system-params/:key
```

### 5.6 ขนส่ง (role: transport)

```
GET  /api/transport/vehicles               — รถทั้งหมดในโครงการ
GET  /api/transport/vehicles/:id           — รายละเอียดรถ
GET  /api/transport/inspections            — รายการตรวจสภาพ
POST /api/transport/inspections            — บันทึกผลตรวจ
PUT  /api/transport/inspections/:id        — แก้ไขผลตรวจ
GET  /api/transport/vehicles/pending       — รถที่ยังไม่ตรวจ
GET  /api/transport/vehicles/expiring      — รถที่ใกล้หมดอายุ
GET  /api/transport/export/:type
```

### 5.7 LINE Webhook & Parent API

```
POST /api/line/webhook                     — LINE Messaging API webhook
GET  /api/parent/children                  — ดูบุตรหลานทั้งหมด
GET  /api/parent/children/:id/status       — สถานะรายคน
GET  /api/parent/children/:id/history      — ประวัติย้อนหลัง
POST /api/parent/register                  — ลงทะเบียนผู้ปกครอง
POST /api/parent/link-child                — ผูกบุตรหลาน
```

---

## 6. Export Libraries

| Format | Library | หมายเหตุ |
|--------|---------|---------|
| Excel (.xlsx) | `exceljs` | รองรับ styling, multiple sheets, auto-width |
| CSV | `json2csv` หรือ native stream | ใช้ BOM prefix สำหรับ Excel เปิดภาษาไทย |
| PDF | `pdfkit` | embed THSarabunNew font สำหรับภาษาไทย |

**CSV ต้องใส่ BOM:**
```javascript
const BOM = '\uFEFF';
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.write(BOM + csvString);
```

---

## 7. Data Migration จาก Google Sheets → MySQL

### 7.1 Migration Script (backend/scripts/migrate-from-excel.js)

```
1. อ่าน DATA sheet → แยก normalize เป็น:
   - affiliations (unique จาก column C,D)
   - schools (unique จาก column A,B + affiliation_id)
   - vehicles (unique จาก column Q; + R,S,T,U,V,W,X,Y,Z,AA)
   - drivers (unique จาก column S,T → สร้าง driver_vehicle_assignments)
   - students (ทุกแถว, classroom เก็บเป็น VARCHAR)
   - parents (จาก column N,O — ถ้ามี → parent_student)

2. อ่าน USERS sheet → สร้าง users table (hash password ด้วย bcrypt)

3. อ่าน Log_YYYY_MM → สร้าง checkin_logs
   - map status: 'รับแล้ว' → 'CHECKED_IN', 'ส่งแล้ว' → 'CHECKED_OUT'

4. อ่าน EMERGENCY_LOG → สร้าง emergency_logs

5. อ่าน PARAM → สร้าง system_params
```

### 7.2 Mapping เดิม → ใหม่

| เดิม (Sheet Column) | ใหม่ (MySQL) |
|---------------------|-------------|
| DATA.รหัสโรงเรียน | schools.id |
| DATA.หน่วยงาน | affiliations.id |
| DATA.รหัสนักเรียน | students.id |
| DATA.เลขบัตรประชาชน | students.cid_hash (SHA256) |
| DATA.ห้อง | students.classroom (VARCHAR) |
| DATA.ทะเบียนรถรับส่ง | vehicles.plate_no |
| DATA.ชื่อคนขับรถ | drivers.name → driver_vehicle_assignments |
| USERS.username | users.username |
| USERS.password (plain 1234) | users.password_hash (bcrypt) |
| USERS.role | users.role |
| USERS.scope_type/scope_id | users.scope_type/scope_id |
| Log.session | checkin_logs.session |
| Log.status 'รับแล้ว' | checkin_logs.status 'CHECKED_IN' |
| Log.status 'ส่งแล้ว' | checkin_logs.status 'CHECKED_OUT' |

---

## 8. RBAC Matrix

| Endpoint Group | driver | school | affiliation | province | transport | admin |
|---------------|--------|--------|-------------|----------|-----------|-------|
| เช็กอิน/เช็กเอาท์ | ✅ own vehicle | ❌ | ❌ | ❌ | ❌ | ✅ |
| จัดการนักเรียน | ❌ | ✅ own school | ❌ | ❌ | ❌ | ✅ |
| นำเข้าข้อมูล | ❌ | ✅ own school | ❌ | ❌ | ❌ | ✅ |
| Dashboard เขต | ❌ | ❌ | ✅ own district | ✅ all | ❌ | ✅ |
| Dashboard ส่วนกลาง | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| ตรวจสภาพรถ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| จัดการผู้ใช้ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| ดูรายงาน | ✅ own | ✅ own school | ✅ own district | ✅ all | ✅ vehicles | ✅ |
| Export | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit log | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

**Scope Enforcement:**
- `driver` → เห็นเฉพาะนักเรียนในรถที่ตัวเอง active assignment
- `school` → เห็นเฉพาะข้อมูลที่ school_id ตรงกับ scope_id
- `affiliation` → เห็นเฉพาะ schools ที่ affiliation_id ตรงกับ scope_id
- `province` → เห็นทุกอย่าง
- `transport` → เห็นเฉพาะข้อมูลรถ + ตรวจสภาพ

---

## 9. ข้อมูลตัวอย่างสำหรับ Seed

จากไฟล์ Excel เดิม:
- **โรงเรียน:** 2 แห่ง (SCH0001 = อนุบาลลำปางเขลางค์รัตน์อนุสรณ์, SCH0002 = ทดสอบ)
- **เขตพื้นที่:** 5 เขต (AFF001-AFF005)
- **ส่วนกลาง:** 1 (LPG = สภาองค์กรของผู้บริโภค)
- **คนขับ:** 55 คน (login ด้วยทะเบียนรถ เช่น 'นข 2210 ลำปาง')
- **นักเรียน:** 268 คน
- **รถ:** 50 คัน
- **ภาคเรียน:** 2568-2

### ข้อมูล Affiliations (เขตพื้นที่)
```
AFF001 = สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 1
AFF002 = สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 2
AFF003 = สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 3
AFF004 = สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาลำปาง ลำพูน
AFF005 = สำนักงานศึกษาธิการจังหวัดลำปาง
```

---

## 10. แผนการทำงาน (สำหรับสั่ง Claude Code ทีละเฟส)

### Phase 1: Foundation

**สร้าง:**
- docker-compose.yml (MySQL 8.0 + Adminer)
- backend/ พร้อม Express, mysql2 connection pool, JWT auth
- migrations/001_initial_schema.sql (ตาม Section 3 + revoked_tokens จาก Section 5.1 — รวมทุกตารางไว้ใน migration เดียว)
- middleware: auth.js + roleGuard.js + errorHandler.js
- utils: response.js (standard response) + audit.js
- routes/auth.routes.js (login, me, change-password, refresh-token, logout)
- scripts/migrate-from-excel.js (อ่าน xlsx → insert MySQL)

**Definition of Done:**
- [ ] `docker-compose up` แล้ว MySQL พร้อมใช้
- [ ] Run migration SQL แล้วได้ตารางครบ 21 ตารางหลัก + 1 supporting table (revoked_tokens)
- [ ] Run migrate-from-excel.js แล้วได้ข้อมูล seed ครบ
- [ ] POST /api/auth/login ด้วย username ทุก role ได้ JWT กลับมา
- [ ] GET /api/auth/me ด้วย JWT แล้วได้ user info + role + scope
- [ ] Login ด้วย password ผิดได้ 401
- [ ] เข้า route ที่ไม่มีสิทธิ์ได้ 403
- [ ] ทุก response ตรงตาม format ใน Section 4.1
- [ ] ตาราง revoked_tokens สร้างสำเร็จ (supporting table สำหรับ refresh token revocation)
- [ ] POST /api/auth/refresh-token ทำงานได้ และ revoke token เมื่อ logout ได้ถูกต้อง

**Prompt:**
```
อ่าน CLAUDE.md ทั้งหมดและทำ Phase 1: Foundation เท่านั้น
ห้ามข้ามไป Phase อื่น

งานที่ต้องทำ:
1. สร้าง docker-compose.yml สำหรับ MySQL 8.0 + Adminer
2. สร้าง backend Express + mysql2 + JWT + bcrypt
3. สร้าง migrations/001_initial_schema.sql ตาม CLAUDE.md (Section 3 + revoked_tokens จาก Section 5.1 รวมไว้ไฟล์เดียว)
4. สร้าง auth middleware, roleGuard, errorHandler
5. สร้าง utils/response.js และ utils/audit.js
6. สร้าง auth routes: login, me, change-password, refresh-token, logout
7. สร้าง revoked_tokens table และ refresh token revocation flow
8. สร้าง scripts/migrate-from-excel.js

ข้อบังคับ:
- ใช้ standard response format ตาม CLAUDE.md
- ใช้ parameterized queries เท่านั้น
- ใช้ bcrypt cost 12
- enforce RBAC ที่ backend
- ห้ามแก้ schema เองนอกเหนือจาก CLAUDE.md
- ถ้าจำเป็นต้องเพิ่มอะไร ให้สรุปเหตุผลก่อนลงมือ

ผลลัพธ์ที่ต้องส่ง:
- โครงสร้างไฟล์ครบ
- SQL migration ครบ
- คำสั่งรันระบบ
- สรุปสิ่งที่ทำเสร็จตาม Definition of Done
```

---

### Phase 2: Driver Module

**สร้าง:**
- routes/driver.routes.js + services/checkin.service.js
- frontend/pages/driver/* (Dashboard, StudentList, CheckinPanel)
- เช็กอิน/เช็กเอาท์ + daily_status update (ใน transaction)
- LINE notification เมื่อเช็กอิน (สร้าง record ใน notifications)

**Definition of Done:**
- [ ] คนขับ login → เห็น roster จาก driver_vehicle_assignments ที่ is_active
- [ ] Roster แสดง: ชื่อนักเรียน, ชั้น, ห้อง, สถานะขึ้นรถ/ลงรถ
- [ ] POST checkin → checkin_logs + daily_status update ใน transaction
- [ ] POST checkout → checkin_logs + daily_status update ใน transaction
- [ ] POST checkin-all → batch update ทุกคนในรถ
- [ ] สถานะเปลี่ยนแบบ realtime บนหน้าจอ
- [ ] notifications record ถูกสร้างเมื่อ checkin/checkout
- [ ] audit_logs บันทึกทุก checkin/checkout
- [ ] POST emergency → emergency_logs
- [ ] คนขับเห็นเฉพาะรถตัวเอง ดูรถคนอื่นไม่ได้ (403)

**Prompt:**
```
อ่าน CLAUDE.md Section 5.2 แล้วสร้าง Phase 2: Driver Module
- ใช้ driver_vehicle_assignments หารถปัจจุบัน
- checkin/checkout ต้องใช้ MySQL transaction
- สร้าง notification record สำหรับ LINE push
- audit_logs ทุก action
```

---

### Phase 3: School Module

**สร้าง:**
- routes/school.routes.js + services/import.service.js
- frontend/pages/school/* (Dashboard, StudentManagement, Import, Parent)
- CRUD นักเรียน + soft delete
- Import CSV/Excel → import_batches tracking
- ผูก/อนุมัติผู้ปกครอง
- รายงานรายวัน/รายเดือน

**Definition of Done:**
- [ ] โรงเรียน login → เห็นเฉพาะนักเรียน school_id ตรง scope_id
- [ ] CRUD นักเรียน: เพิ่ม/แก้ไข/soft delete ทำงานถูกต้อง
- [ ] Import Excel/CSV → สร้าง import_batch, แสดง error แถวที่ผิด
- [ ] Download template สำหรับกรอกข้อมูลได้
- [ ] ดูประวัติ import_batches ได้
- [ ] ดู daily_status ของนักเรียนในโรงเรียนได้
- [ ] อนุมัติ/ปฏิเสธ parent_student ได้
- [ ] Export: Excel (exceljs), CSV (json2csv + BOM), PDF (pdfkit)
- [ ] audit_logs ทุก CREATE/UPDATE/DELETE/IMPORT/EXPORT/APPROVE
- [ ] โรงเรียนดูข้อมูลโรงเรียนอื่นไม่ได้ (403)

**Prompt:**
```
อ่าน CLAUDE.md Section 5.3 แล้วสร้าง Phase 3: School Module
- CRUD + soft delete + import with batch tracking
- Export ใช้ exceljs, json2csv, pdfkit ตาม Section 6
- audit_logs ทุก action
```

---

### Phase 4: District + Central Module

**สร้าง:**
- routes/district.routes.js + central.routes.js
- frontend/pages/district/* + central/*
- Dashboard (Recharts): summary cards + charts
- รายงานเปรียบเทียบ
- Export

**Definition of Done:**
- [ ] เขต login → เห็นเฉพาะโรงเรียนที่ affiliation_id ตรง scope_id
- [ ] Dashboard เขต: จำนวนโรงเรียน, นักเรียน, รถ, เช็กอิน, เหตุผิดปกติ
- [ ] รายงาน daily/monthly/yearly ใช้งานได้
- [ ] เปรียบเทียบระหว่างโรงเรียนได้ (ตาราง + กราฟ)
- [ ] ส่วนกลาง login → เห็นทุกเขตทุกโรงเรียน
- [ ] Dashboard ส่วนกลาง: ภาพรวมจังหวัด + drill down ถึงเขต + โรงเรียน
- [ ] ดู audit_logs ได้ (เฉพาะ province + admin)
- [ ] จัดการ system_params ได้ (เฉพาะ province + admin)
- [ ] Export ทุกระดับ
- [ ] เขตดูข้อมูลเขตอื่นไม่ได้ (403)

**Prompt:**
```
อ่าน CLAUDE.md Section 5.4+5.5 แล้วสร้าง Phase 4: District + Central
- Dashboard ใช้ Recharts
- Drill down: จังหวัด → เขต → โรงเรียน
- Scope enforcement ต้องเข้มงวด
```

---

### Phase 5: Transport Module

**สร้าง:**
- routes/transport.routes.js
- frontend/pages/transport/*
- บันทึกตรวจสภาพรถ
- Filter ตามสถานะ

**Definition of Done:**
- [ ] ขนส่ง login → เห็นรถทั้งหมด + สถานะตรวจ
- [ ] บันทึกผลตรวจ: PASSED/FAILED/NEEDS_FIX + วันหมดอายุ
- [ ] Filter: PENDING (ยังไม่ตรวจ), expiring (ใกล้หมดอายุ 30 วัน), expired, FAILED
- [ ] แก้ไขผลตรวจได้ (มี audit_log)
- [ ] Export รายงานตรวจสภาพ
- [ ] ขนส่งเห็นเฉพาะข้อมูลรถ ไม่เห็นข้อมูลนักเรียน

**Prompt:**
```
อ่าน CLAUDE.md Section 5.6 แล้วสร้าง Phase 5: Transport Module
- ใช้ status code PASSED/FAILED/NEEDS_FIX/PENDING
- Filter + Export
```

---

### Phase 6: LINE OA Integration

**สร้าง:**
- line-bot/ webhook + flex messages
- Rich Menu สำหรับผู้ปกครอง + คนขับ
- ลงทะเบียน + ผูกบุตรหลาน
- Push notification จาก notifications table
- LIFF app สำหรับดูสถานะ

**Definition of Done:**
- [ ] LINE webhook รับ message ได้ + บันทึก line_message_logs
- [ ] ผู้ปกครอง add friend → ลงทะเบียน → ผูกบุตรหลาน → รออนุมัติ
- [ ] หลังอนุมัติ → ดูสถานะบุตรหลานผ่าน Rich Menu / LIFF
- [ ] Push notification ส่งเมื่อ checkin/checkout (อ่านจาก notifications table)
- [ ] ผู้ปกครอง 1 คนดูลูกหลายคน คนละโรงเรียน คนละรถ ได้
- [ ] คนขับใช้ LINE กด checkin/checkout ได้
- [ ] แจ้งเหตุฉุกเฉินผ่าน LINE ได้
- [ ] line_users table ใช้ parent_id / driver_id FK ชัดเจน (ไม่ใช่ polymorphic)

**Prompt:**
```
อ่าน CLAUDE.md Section 5.7 แล้วสร้าง Phase 6: LINE OA
- ใช้ @line/bot-sdk
- line_users ผูก parent_id หรือ driver_id แยก FK ชัดเจน
- Push notification จาก notifications table
- LIFF สำหรับ parent status view
```

---

## 11. Environment Variables (.env)

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=lampang_bus
DB_USER=root
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_jwt_secret_key_at_least_32_chars
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# LINE
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
LINE_LIFF_ID=

# App
PORT=3000
NODE_ENV=development
TZ=Asia/Bangkok
CURRENT_TERM=2568-2

# Export
PDF_FONT_PATH=./fonts/THSarabunNew.ttf
```

---

## 12. Development Rules

**Claude Code ต้องปฏิบัติตามกฎเหล่านี้ทุกครั้ง:**

1. **MySQL 8.0 only** — charset utf8mb4_unicode_ci ทุกตาราง; ห้ามใช้ MariaDB หรือ MySQL < 8.0 เพราะ schema ใช้ CHECK constraint (เช่น line_users) ซึ่งรุ่นเก่า/MariaDB จะ parse แต่ไม่ enforce
2. **bcrypt** สำหรับ hash password — cost factor 12
3. **JWT** สำหรับ auth — ห้ามใช้ session/cookie
4. **Timezone = Asia/Bangkok** — ทุก timestamp ต้อง consistent
5. **ห้ามเก็บเลขบัตรประชาชนจริง** — เก็บเฉพาะ cid_hash (SHA256)
6. **ทุก API ต้องคืน JSON ตาม Section 4.1** — ห้ามเปลี่ยน format
7. **ใช้ MySQL transaction** สำหรับ operations ต่อไปนี้ (ทุกตัวต้อง atomic):
   - checkin/checkout → เขียน `checkin_logs` + update `daily_status` + สร้าง `notifications` + เขียน `audit_logs`
   - import นักเรียน → สร้าง `import_batch` + INSERT/UPDATE `students` ทุกแถว + เขียน `audit_logs`
   - batch checkin-all → เหมือน checkin แต่ loop ทุกคนในรถ
   - approve parent-child link → update `parent_student.approved` + เขียน `audit_logs`
   - บันทึก vehicle inspection → INSERT `vehicle_inspections` + เขียน `audit_logs`
   - ผูก/ยกเลิก LINE account → INSERT/UPDATE `line_users` + update `parents.line_user_id` หรือ `drivers.line_user_id` + เขียน `audit_logs`
8. **ทุก CREATE/UPDATE/DELETE/EXPORT/IMPORT ต้องเขียน audit_logs**
9. **RBAC ต้อง enforce ที่ backend** — ห้ามพึ่ง frontend เพียงอย่างเดียว
10. **Soft delete** สำหรับ students, vehicles, parents, users, schools, affiliations
11. **ห้ามสร้าง schema ที่ขัดกับ Section 3** — ถ้าต้องเพิ่ม/แก้ให้ถามก่อน
12. **Build Phase by Phase** — ห้ามข้าม migration, ห้ามทำหลาย phase พร้อมกัน
13. **Status code เก็บเป็นภาษาอังกฤษ** — map เป็นไทยที่ frontend เท่านั้น
14. **Parameterized queries เสมอ** — ห้ามต่อ string เป็น SQL
15. **Export ใช้ library ตาม Section 6** — exceljs, json2csv, pdfkit
16. **ทุก import ต้องสร้าง import_batch** เพื่อ tracking

---

## 13. หมายเหตุสำคัญ

1. **Vehicle ID** — ใช้รูปแบบ 'V-' + 12 char hex เหมือนเดิม
2. **ภาคเรียน (term_id)** — รูปแบบ 'พ.ศ.-เทอม' เช่น '2568-2'
3. **LINE OA** — ต้องสมัคร LINE Official Account + LINE Developers Console แยก
4. **ข้อมูลอ่อนไหว** — เลขบัตรประชาชน, เบอร์โทร ต้องจำกัดสิทธิ์การเข้าถึง
5. **Driver ↔ Vehicle** — ใช้ driver_vehicle_assignments (many-to-many) ไม่ผูกตาย
6. **classroom** — เก็บเป็น VARCHAR เพราะอาจเป็น '1', 'A', '1/1', 'อนุบาล3/2'
7. **line_users** — ใช้ parent_id + driver_id แยก FK (ไม่ใช่ polymorphic linked_id) — ดู Section 3.4 สำหรับ source of truth rule
8. **revoked_tokens** — ใช้สำหรับ refresh token blacklist — ดู Section 5.1 สำหรับ strategy
