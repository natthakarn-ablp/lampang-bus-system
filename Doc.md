# บันทึกการเปลี่ยนแปลงระบบ — 25 มิถุนายน 2569

**Branch:** `security/audit-fixes-2026-06-18`
**เซิร์ฟเวอร์:** `ssh.schoolbus.lp-pao.go.th` → `/home/schoolbus/apps/lampang-bus-system/`
**Production:** ทำงานปกติ, PM2 online, build ผ่าน, ฐานข้อมูล 245 คัน

---

## สารบัญ

1. [Role Inversion — กลับทิศบทบาทการขึ้นทะเบียนรถ](#1-role-inversion)
2. [Tier 3 — กระจายงานแอดมินไปสังกัด](#2-tier-3)
3. [อัปเดตคู่มือและเอกสาร](#3-อัปเดตคู่มือ)
4. [รายการไฟล์ที่เปลี่ยนแปลงทั้งหมด](#4-ไฟล์ที่เปลี่ยนแปลง)
5. [สถาปัตยกรรมและ State Machine](#5-สถาปัตยกรรม)
6. [API Endpoints ใหม่ทั้งหมด](#6-api-endpoints)
7. [งานที่เหลือ](#7-งานที่เหลือ)

---

## 1. Role Inversion

**Commit:** `cc1cf93` — 7 files changed, +1178 -540

### วัตถุประสงค์

เปลี่ยน workflow การขึ้นทะเบียนรถรับส่งนักเรียน จากเดิมที่โรงเรียนเป็นคนเริ่มต้น เป็น **คนขับเป็นคนยื่นคำขอเอง** แล้วโรงเรียนตรวจสอบ ขนส่งตรวจสภาพ

### โฟลว์เดิม (Before)

```
โรงเรียน → สร้างใบส่งตรวจ → พิมพ์ → ขนส่งตรวจ → ผ่าน/ไม่ผ่าน
```

### โฟลว์ใหม่ (After)

```
คนขับ → ยื่นคำขอขึ้นทะเบียน → โรงเรียนตรวจสอบ → ขนส่งตรวจสภาพ → ผ่าน/ไม่ผ่าน
```

### Backend

#### Service functions ใหม่ใน `vehicleVerification.service.js`

| Function | คำอธิบาย |
|----------|----------|
| `createDriverApplication` | คนขับยื่นคำขอ สถานะเริ่มต้น `PENDING_SCHOOL_REVIEW` |
| `listDriverApplications` | คนขับดูคำขอของตัวเองทั้งหมด |
| `reviewApplication` | โรงเรียนอนุมัติ/ปฏิเสธคำขอที่คนขับยื่น |

#### API Endpoints ใหม่

| Method | Path | Role | คำอธิบาย |
|--------|------|------|----------|
| POST | `/api/driver/applications` | driver | คนขับยื่นคำขอขึ้นทะเบียน |
| GET | `/api/driver/applications` | driver | ดูคำขอทั้งหมดของคนขับ |
| GET | `/api/driver/applications/:id` | driver | ดูรายละเอียดคำขอ |
| POST | `/verification/applications/:id/review` | school | โรงเรียนตรวจสอบ (approve/reject) |
| GET | `/verification/applications/:id/timeline` | all | ดู timeline การเปลี่ยนสถานะ |

### Frontend

#### ไฟล์ใหม่: `DriverApplications.jsx`

- หน้าสำหรับคนขับยื่นคำขอขึ้นทะเบียนรถ
- เลือกรถที่ตนขับ → ยื่นคำขอ
- แสดงคำขอที่กำลังดำเนินการ และคำขอที่เสร็จสิ้น
- มี step rail แสดงสถานะปัจจุบัน
- มี timeline การเปลี่ยนสถานะ (ขยายดูได้)

#### ไฟล์ที่แก้: `VehicleVerification.jsx`

- เพิ่ม `PENDING_SCHOOL_REVIEW` และ `REJECTED` ใน STATUS map
- เพิ่มปุ่ม "ตรวจสอบถูกต้อง" (สีเขียว) และ "ปฏิเสธคำขอ" (สีแดง) เมื่อสถานะ = `PENDING_SCHOOL_REVIEW`
- เพิ่ม `review()` function ใน main component
- อัปเดต description ใน CommandHero ให้สะท้อน role inversion

#### ไฟล์ที่แก้: `MobileBottomNav.jsx`

- เปลี่ยน tab "คำขอ" (roster requests) เป็น tab "ขึ้นทะเบียน" (FileCheck2 icon)
- ลบ `ClipboardList` import ที่ไม่ใช้

#### ไฟล์ที่แก้: `App.jsx`

- เพิ่ม lazy import: `DriverApplications`
- เพิ่ม route: `/driver/applications`

---

## 2. Tier 3

**Commit:** `0f00fbe` — 7 files changed, +1050 -391

### วัตถุประสงค์

กระจายงานอนุมัติคำขอจาก **admin เท่านั้น** ไปยัง **สังกัด/เขต (affiliation)** โดยกรองเฉพาะคำขอของโรงเรียนในสังกัดตนเอง

### โฟลว์เดิม (Before)

```
โรงเรียน → ส่งคำขอ → admin อนุมัติ/ปฏิเสธ
```

### โฟลว์ใหม่ (After)

```
โรงเรียน → ส่งคำขอ → สังกัด อนุมัติ/ปฏิเสธ (admin ยังอนุมัติได้)
```

### Backend

#### Service functions ใหม่

**`studentTransfer.service.js`:**

| Function | คำอธิบาย |
|----------|----------|
| `listForAffiliation` | ดูคำขอโอนย้ายนักเรียน กรองตาม `affiliation_id` |
| `getDetailForAffiliation` | ดูรายละเอียดคำขอ ตรวจสอบว่าอยู่ในสังกัด |

**`vehicleRequest.service.js`:**

| Function | คำอธิบาย |
|----------|----------|
| `listForAffiliation` | ดูคำขอเกี่ยวกับรถ กรองตาม `affiliation_id` |
| `getDetailForAffiliation` | ดูรายละเอียดคำขอ ตรวจสอบว่าอยู่ในสังกัด |

#### API Endpoints ใหม่ใน `affiliation.routes.js`

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/api/affiliation/transfer-requests` | รายการคำขอโอนย้ายนักเรียน |
| GET | `/api/affiliation/transfer-requests/:id` | รายละเอียดคำขอ |
| POST | `/api/affiliation/transfer-requests/:id/approve` | อนุมัติคำขอโอนย้าย |
| POST | `/api/affiliation/transfer-requests/:id/reject` | ปฏิเสธคำขอโอนย้าย |
| GET | `/api/affiliation/vehicle-requests` | รายการคำขอเกี่ยวกับรถ |
| GET | `/api/affiliation/vehicle-requests/:id` | รายละเอียดคำขอ |
| POST | `/api/affiliation/vehicle-requests/:id/approve` | อนุมัติคำขอเกี่ยวกับรถ |
| POST | `/api/affiliation/vehicle-requests/:id/reject` | ปฏิเสธคำขอเกี่ยวกับรถ |

> ทุก endpoint ตรวจสอบ scope: คำขอต้องอยู่ในสังกัดของผู้ใช้ ไม่งั้น 404

### Frontend

#### ไฟล์ใหม่: `AffTransferRequests.jsx`

- หน้าสังกัดดูและอนุมัติคำขอโอนย้ายนักเรียน
- ตัวกรอง: รออนุมัติ / โอนย้ายแล้ว / ไม่อนุมัติ / ทั้งหมด
- ตารางแสดง: วันที่, นักเรียน, จาก→ไป, สถานะ
- Modal รายละเอียดพร้อมช่องหมายเหตุและปุ่มอนุมัติ/ปฏิเสธ

#### ไฟล์ใหม่: `AffVehicleRequests.jsx`

- หน้าสังกัดดูและอนุมัติคำขอเกี่ยวกับรถ
- ตัวกรอง: รออนุมัติ / อนุมัติแล้ว / ไม่อนุมัติ / ทั้งหมด
- ตารางแสดง: วันที่, ประเภท, โรงเรียน, ทะเบียน, สถานะ
- Modal รายละเอียดพร้อมข้อมูลรถปัจจุบันและปุ่มอนุมัติ/ปฏิเสธ

#### ไฟล์ที่แก้: `App.jsx`

- เพิ่ม lazy imports: `AffTransferRequests`, `AffVehicleRequests`
- เพิ่ม routes: `/affiliation/transfer-requests`, `/affiliation/vehicle-requests`

#### ไฟล์ที่แก้: `Sidebar.jsx`

- เพิ่ม section "คำขอและอนุมัติ" ใน AFFILIATION_NAV
- เพิ่ม 2 เมนู: "คำขอโอนย้ายนักเรียน" (Users icon) และ "คำขอเกี่ยวกับรถ" (Wrench icon)

---

## 3. อัปเดตคู่มือ

**Commit:** `a1ba2e6` — 4 files changed, +100 -1

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `docs/ADMIN_WORKFLOWS.md` | อัปเดต RBAC: สังกัดอนุมัติได้, เพิ่มหมายเหตุ 2026-06-25 |
| `docs/manual-html/user-guide-driver.html` | เพิ่มงานที่ 14 "ขึ้นทะเบียนรถ" |
| `docs/manual-html/user-guide-affiliation.html` | เพิ่มงานที่ 13B/13C อนุมัติคำขอ |
| `docs/STATUS-2026-06-25.md` | สร้างเอกสารสถานะใหม่ |

---

## 4. ไฟล์ที่เปลี่ยนแปลง

### Backend

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `backend/src/services/vehicleVerification.service.js` | เพิ่ม `createDriverApplication`, `listDriverApplications`, `reviewApplication` |
| `backend/src/routes/verification.routes.js` | เพิ่ม POST `/applications/:id/review`, GET `/applications/:id/timeline` |
| `backend/src/routes/driver.routes.js` | เพิ่ม POST `/applications`, GET `/applications`, GET `/applications/:id` |
| `backend/src/services/studentTransfer.service.js` | เพิ่ม `listForAffiliation`, `getDetailForAffiliation` |
| `backend/src/services/vehicleRequest.service.js` | เพิ่ม `listForAffiliation`, `getDetailForAffiliation` |
| `backend/src/routes/affiliation.routes.js` | เพิ่ม 8 endpoints (transfer-requests + vehicle-requests) |

### Frontend

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `frontend/src/pages/driver/DriverApplications.jsx` | **ไฟล์ใหม่** — หน้าคนขับยื่นคำขอขึ้นทะเบียน |
| `frontend/src/pages/school/VehicleVerification.jsx` | เพิ่ม PENDING_SCHOOL_REVIEW, ปุ่มอนุมัติ/ปฏิเสธ, review() |
| `frontend/src/components/MobileBottomNav.jsx` | เปลี่ยน tab "คำขอ" → "ขึ้นทะเบียน" |
| `frontend/src/App.jsx` | เพิ่ม route `/driver/applications`, `/affiliation/transfer-requests`, `/affiliation/vehicle-requests` |
| `frontend/src/pages/affiliation/AffTransferRequests.jsx` | **ไฟล์ใหม่** — หน้าสังกัดอนุมัติคำขอโอนย้าย |
| `frontend/src/pages/affiliation/AffVehicleRequests.jsx` | **ไฟล์ใหม่** — หน้าสังกัดอนุมัติคำขอรถ |
| `frontend/src/components/Sidebar.jsx` | เพิ่ม section "คำขอและอนุมัติ" ในเมนูสังกัด |

### เอกสาร

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `docs/ADMIN_WORKFLOWS.md` | อัปเดต RBAC section |
| `docs/manual-html/user-guide-driver.html` | เพิ่มงานที่ 14 |
| `docs/manual-html/user-guide-affiliation.html` | เพิ่มงานที่ 13B/13C |
| `docs/STATUS-2026-06-25.md` | **ไฟล์ใหม่** — สถานะงาน |

---

## 5. สถาปัตยกรรม

### State Machine: การขึ้นทะเบียนรถ (Role Inversion)

```
PENDING_SCHOOL_REVIEW    (คนขับยื่นคำขอ)
         │
         ├── โรงเรียนอนุมัติ ──→ READY_TO_PRINT
         │                         │
         │                         ├── โรงเรียนยืนยันพร้อมพิมพ์ ──→ SUBMITTED
         │                                                      │
         │                                                      ├── ขนส่งรับเข้าตรวจ ──→ INSPECTION_PENDING
         │                                                                                │
         │                                                                                ├── ผ่าน ──→ PASSED
         │                                                                                ├── ไม่ผ่าน ──→ FAILED
         │                                                                                └── ต้องแก้ ──→ NEEDS_FIX
         │
         └── โรงเรียนปฏิเสธ ──→ REJECTED
```

### RBAC Matrix (อัปเดตแล้ว)

| งาน | Driver | School | Affiliation | Transport | Admin |
|-----|--------|--------|-------------|-----------|-------|
| ยื่นคำขอขึ้นทะเบียนรถ | ✅ | — | — | — | — |
| ตรวจสอบคำขอขึ้นทะเบียน | — | ✅ | — | — | — |
| ตรวจสภาพรถ | — | — | — | ✅ | — |
| อนุมัติคำขอโอนย้ายนักเรียน | — | — | ✅ | — | ✅ |
| อนุมัติคำขอเกี่ยวกับรถ | — | — | ✅ | — | ✅ |
| วงจรชีวิตคนขับ | — | — | — | — | ✅ |
| สุขภาพระบบ | — | — | — | — | ✅ |

---

## 6. API Endpoints

### ใหม่ทั้งหมด (13 endpoints)

#### Driver — ขึ้นทะเบียนรถ

```http
POST   /api/driver/applications          # ยื่นคำขอ { vehicle_id }
GET    /api/driver/applications           # ดูคำขอทั้งหมด
GET    /api/driver/applications/:id       # ดูรายละเอียด
```

#### School — ตรวจสอบคำขอ

```http
POST   /api/verification/applications/:id/review     # { approved: true/false }
GET    /api/verification/applications/:id/timeline    # ดู timeline
```

#### Affiliation — อนุมัติคำขอ

```http
GET    /api/affiliation/transfer-requests
GET    /api/affiliation/transfer-requests/:id
POST   /api/affiliation/transfer-requests/:id/approve    # { admin_note }
POST   /api/affiliation/transfer-requests/:id/reject     # { admin_note }
GET    /api/affiliation/vehicle-requests
GET    /api/affiliation/vehicle-requests/:id
POST   /api/affiliation/vehicle-requests/:id/approve     # { admin_note }
POST   /api/affiliation/vehicle-requests/:id/reject      # { admin_note }
```

---

## 7. งานที่เหลือ

- [ ] ถ่ายภาพหน้าจอใหม่สำหรับคู่มือ (driver applications, affiliation approvals)
- [ ] UAT เชิงผู้ใช้กับ workflow ใหม่
- [ ] อัปเดต `docs/manual-html/screenshots/` เมื่อถ่ายภาพเสร็จ

---

## Git Log

```
a1ba2e6 docs: update manuals and status for role inversion + Tier 3
0f00fbe feat: Tier 3 — distribute admin approval queues to affiliation
cc1cf93 feat: role inversion — driver-initiated vehicle registration
59590c9 feat: school dashboard leave list with cancel button
f38f4cd feat: self-service CRUD + verification UX redesign
```
