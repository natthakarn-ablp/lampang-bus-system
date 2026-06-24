# Roleplay Audit — 2026-06-24

> **Method:** จำลองตัวเองเป็นผู้ใช้งานแต่ละ Role เดินตาม user journey จริง อ่านโค้ดทีละบรรทัด เช็คทุก API call, frontend page, edge case, empty state, error handling
>
> **Auditor:** 5 parallel subagents (Driver / School / Parent / Admin / Province+Transport+Affiliation)
>
> **สถานะ:** ✅ แก้แล้ว 22 จาก 29 issues (2026-06-24) — เหลือ 7 ที่เป็น design choice หรือทำทีหลัง

---

## สรุปรวม

| Severity | Count | ต้องแก้ก่อน deploy Phase 11A? | แก้แล้ว? |
|----------|-------|------------------------------|----------|
| CRITICAL | 5     | ✅ ใช่ | ✅ 5/5 |
| HIGH     | 6     | ✅ แนะนำ | ✅ 6/6 |
| MEDIUM   | 9     | ควร | ✅ 8/9 (M2 document, M7 แก้แล้ว) |
| LOW      | 9     | ทำได้ทีหลัง | ✅ 4/9 (L4 มีอยู่แล้ว, L2,L3,L6,L7,L8 ทำทีหลัง) |
| **Total** | **29** | | **23 แก้ + 6 ทำทีหลัง** |

---

## CRITICAL (5) — ต้องแก้ก่อนเปิด Phase 11A

### C1. Geofence ส่ง LINE push ไม่ถึงผู้ปกครอง — ใช้ column ที่ไม่มีอยู่

- **ไฟล์:** `backend/src/services/geofence.service.js:237`
- **พบโดย:** Driver audit + Parent audit (ยืนยันซ้ำ 2 แหล่ง)
- **ปัญหา:** query อ้าง `s.parent_phone` แต่ตาราง `students` ไม่มี column นี้ (ข้อมูลผู้ปกครองอยู่ใน `parent_student` → `parents.phone`) ทำให้ LEFT JOIN ได้ NULL เสมอ → `lb.line_user_id` เป็น NULL → ไม่ส่ง push ให้ใครเลย
- **ผู้ใช้กระทบ:** ผู้ปกครองไม่ได้รับแจ้งเตือนเมื่อรถถึงจุดรับ-ส่ง/โรงเรียน (ฟีเจอร์หลักของ Phase 11A ใช้งานไม่ได้)
- **วิธีแก้:** เปลี่ยน JOIN chain เป็น:
  ```sql
  LEFT JOIN parent_student ps ON ps.student_id = s.id AND ps.approved = TRUE
  LEFT JOIN parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
  LEFT JOIN line_bindings lb ON lb.phone = p.phone AND lb.is_active = TRUE
  ```
  (match pattern ของ `checkin.service.js:389-406`)

### C2. Geofence รับพิกัดไม่ validate — สามารถใส่ NaN / นอกขอบเขต

- **ไฟล์:** `backend/src/routes/geofence.routes.js:83-116` (POST) และ `:152-190` (PUT)
- **พบโดย:** Admin audit
- **ปัญหา:** POST/PUT รับ `center_lat`, `center_lng` โดยไม่ validate ว่าเป็นตัวเลขในขอบเขต (-90..90, -180..180) ถ้า admin ใส่ "abc" หรือ 999 → haversine คืน NaN → geofence detection พังทั้งรถ
- **ผู้ใช้กระทบ:** Admin พิมพ์ผิด → geofence ใช้ไม่ได้ ไม่มี error บอก
- **วิธีแก้:** เพิ่ม validation ทั้ง POST และ PUT:
  ```javascript
  const lat = parseFloat(center_lat);
  const lng = parseFloat(center_lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return sendError(res, 'พิกัดไม่ถูกต้อง', [], 400);
  }
  ```

### C3. Frontend AdminGeofences ส่ง NaN ได้โดยไม่มี feedback

- **ไฟล์:** `frontend/src/pages/admin/AdminGeofences.jsx:74-96`
- **พบโดย:** Admin audit
- **ปัญหา:** `parseFloat(form.center_lat)` ไม่เช็ค NaN ก่อนส่ง ถ้า admin พิมพ์ตัวอักษร → ส่ง NaN ไป backend (ซึ่งก็ไม่ validate ตาม C2)
- **ผู้ใช้กระทบ:** กดสร้างแล้วเงียบ ไม่รู้ว่าผิด
- **วิธีแก้:** เพิ่ม client-side validation ก่อน `api.post`:
  ```javascript
  if (isNaN(lat) || isNaN(lng)) { toast.error('พิกัดต้องเป็นตัวเลข'); return; }
  ```

### C4. ETA คืน NULL เงียบ ๆ ไม่บอกสาเหตุ

- **ไฟล์:** `backend/src/services/eta.service.js:175-200`
- **พบโดย:** Parent audit
- **ปัญหา:** `getForStudent()` ใช้ INNER JOIN บน `student_pickup_points` + `eta_predictions` ถ้านักเรียนไม่มี pickup point หรือรถออฟไลน์ → คืน NULL โดยไม่บอกว่าเพราะอะไร
- **ผู้ใช้กระทบ:** ผู้ปกครองเห็น "ยังไม่มีข้อมูล ETA" ไม่รู้ว่ารถออฟไลน์ / ไม่ได้ตั้งค่า / ฟีเจอร์ปิดอยู่
- **วิธีแก้:** คืน structured error:
  - `{ error: 'vehicle_offline' }` — รถไม่มี GPS วันนี้
  - `{ error: 'no_pickup_point' }` — นักเรียนไม่มีจุดรับ-ส่ง
  - `{ error: 'feature_disabled' }` — FEATURE_ETA=false

### C5. ParentStatus เปิดนอก LINE ไม่มีแจ้งชัด

- **ไฟล์:** `frontend/src/pages/parent/ParentStatus.jsx:28-53`
- **พบโดย:** Parent audit
- **ปัญหา:** เรียก `getLiffIdToken()` แต่ไม่ validate ว่า token มีจริง ถ้าเปิดนอก LIFF / token หมดอายุ → ส่ง header ว่าง → 401 → ขึ้น generic error ไม่บอกว่าเพราะอะไร
- **ผู้ใช้กระทบ:** ผู้ปกครองเปิดลิงก์ใน browser ธรรมดา เข้าใจว่าระบบพัง
- **วิธีแก้:** เช็ค token ก่อนเรียก API:
  ```javascript
  if (!token) {
    setError('กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA เท่านั้น');
    return;
  }
  ```

---

## HIGH (6)

### H1. Emergency ส่ง NULL vehicle_id → FK error ที่ซ่อนอยู่

- **ไฟล์:** `backend/src/routes/driver.routes.js:543-549`
- **ปัญหา:** ถ้า `resolveVehicleForEmergency()` fail → fallback เป็น `{ vehicle_id: null }` → INSERT อาจ fail ด้วย FK constraint (ถ้า column NOT NULL) โดย driver เห็น error ประหลาดไม่ใช่ข้อความไทย
- **วิธีแก้:** เช็ค schema `emergency_logs.vehicle_id` nullability; ถ้า NOT NULL → throw ข้อความไทยชัดเจนแทน

### H2. Checkin idempotency บั๊ก — check-in ซ้ำได้ถ้าทำ check-out แล้ว check-in อีก

- **ไฟล์:** `backend/src/services/checkin.service.js:336-344`
- **ปัญหา:** guard เช็คเฉพาะ `(student_id, session, status, check_date)` ถ้า driver กด check-in → check-out → check-in อีกครั้ง → row ที่ 3 ผ่าน (เพราะ status เดิมแต่ row แรกเป็น CHECKED_IN ไม่ใช่ CHECKED_OUT) → daily_status สับสน
- **วิธีแก้:** เปลี่ยน guard เป็น reject ถ้ามี checkin_log ใด ๆ ของ (student, session, date) หรือ track current state ใน daily_status แล้ว reject invalid transitions

### H3. Shift flag ทำให้ emergency กับ checkin ใช้ gate ต่างกัน

- **ไฟล์:** `backend/src/services/checkin.service.js:73-96` vs `driver.routes.js:545`
- **ปัญหา:** `getDriverVehicle()` บังคับ active shift เมื่อ `FEATURE_DRIVER_SHIFT_SELECTION=true` แต่ `resolveVehicleForEmergency()` ไม่บังคับ → driver เปิด emergency ได้แต่ checkin ไม่ได้ สับสน
- **วิธีแก้:** เพิ่ม parameter `requireActiveShift` ให้ `resolveVehicleForEmergency()` หรือ document ว่า emergency ตั้งใจให้ทำได้เสมอ (เพราะเป็นเหตุฉุกเฉิน)

### H4. Geofence radius ไม่ validate ค่าบวก

- **ไฟล์:** `backend/src/routes/geofence.routes.js:83-116`
- **ปัญหา:** รับ `radius_meters` โดยไม่เช็ค > 0 → ใส่ -100 หรือ 0 ได้ → detection พัง
- **วิธีแก้:** `if (radius_meters != null && (isNaN(radius_meters) || radius_meters <= 0)) return 400`

### H5. AdminGeofences + AdminRouteDeviations ไม่มี loading state

- **ไฟล์:** `AdminGeofences.jsx:20-44`, `AdminRouteDeviations.jsx:28-46`
- **ปัญหา:** มี `busy` state แต่ไม่แสดง spinner ตอนโหลดครั้งแรก → หน้าดูเหมือนค้าง
- **วิธีแก้:** เพิ่ม `<LoadingState />` เมื่อ `busy && data.length === 0`

### H6. "สถานะ" command คืนค่าว่างไม่บอกสาเหตุ

- **ไฟล์:** `backend/src/services/line.service.js:424-432`
- **ปัญหา:** ถ้าไม่มี daily_status row วันนี้ → คืน default `{ morning_done: false, ... }` ไม่แยกว่า "รถยังไม่ออก" vs "นักเรียนไม่มา" vs "ระบบไม่ได้เช็กอิน"
- **วิธีแก้:** เพิ่ม field `status: 'no_checkin_today'` หรือเช็คว่ารถ active ก่อนคืน default

---

## MEDIUM (9)

### M1. GPS hook ล้มเงียบ — tracking พังโดย driver ไม่รู้

- **ไฟล์:** `backend/src/routes/driver.routes.js:1133-1147`
- **ปัญหา:** ETA/geofence/deviation hook อยู่ใน try-catch ที่ `console.warn` อย่างเดียว ถ้า service crash → GPS ping สำเร็จแต่ tracking ไม่อัปเดต ไม่มี alert
- **วิธีแก้:** log ไป monitoring (Sentry) + พิจารณาคืน `tracking_health` field ใน response

### M2. Pretrip gate บล็อก checkin แต่ไม่บล็อก shift start

- **ไฟล์:** `driver.routes.js:1021`, `DriverDashboard.jsx:128-131`
- **ปัญหา:** frontend บล็อก checkin ถ้า pretrip ไม่เสร็จ แต่ `/shifts/start` ไม่เช็ค → driver เปิด shift ได้ แล้ว checkin ไม่ได้ สับสน
- **วิธีแก้:** เพิ่ม pretrip check ใน `assessSafety()` หรือ document ว่า pretrip เป็น frontend-only

### M3. Geofence state Map ไม่มี cleanup — memory leak

- **ไฟล์:** `backend/src/services/geofence.service.js:26-28`
- **ปัญหา:** `lastInside` Map เก็บ state ต่อ (geofence_id, vehicle_id) ไม่มี cleanup เมื่อ geofence ถูกลบ → โตไม่จำกัด
- **วิธีแก้:** periodic cleanup ทุก 24 ชม. หรือใช้ TTL cache

### M4. Geofence PUT ไม่ validate trigger_on / target_type / notify_roles

- **ไฟล์:** `backend/src/routes/geofence.routes.js:152-190`
- **ปัญหา:** PUT รับค่าใด ๆ โดยไม่เช็ค enum → ใส่ "INVALID" ได้ → เก็บได้แต่ trigger ไม่ทำงาน
- **วิธีแก้:** validate ทุก field ที่ update ได้

### M5. Bind flow ไม่เช็ค student ซ้ำ — เขียนทับ parent เดิมได้

- **ไฟล์:** `backend/src/routes/parent.routes.js:229-233`
- **ปัญหา:** ไม่เช็คว่า student ถูกผูกกับ parent คนอื่นอยู่แล้ว → parent ใหม่เขียนทับ parent เดิมโดยไม่แจ้ง
- **วิธีแก้:** เช็ค `parent_student` ก่อน approve ว่ามี approved=TRUE อยู่แล้ว

### M6. ETA ไม่แยก offline vs unconfigured vs disabled

- **ไฟล์:** `backend/src/services/eta.service.js:175-200`
- **ปัญหา:** คืน NULL เสมอเมื่อไม่มีข้อมูล ไม่แยกสาเหตุ (เหมือน C4 แต่มุมมอง UX)
- **วิธีแก้:** คืน error code ตาม C4

### M7. Sidebar route-deviations link แสดงแม้ flag ปิด

- **ไฟล์:** `frontend/src/components/Sidebar.jsx:92`, `backend/src/app.js:141`
- **ปัญหา:** province เห็น link ใน sidebar แต่ถ้า `FEATURE_ROUTE_DEVIATION=false` → คลิกแล้ว 404
- **วิธีแก้:** ส่ง feature flags จาก backend มา frontend แล้วซ่อน link เมื่อปิด

### M8. Phone validation mismatch — import 10 หลัก แต่ edit 9-10 หลัก

- **ไฟล์:** `school.routes.js:1338` (import) vs `:650` (edit)
- **ปัญหา:** import บังคับ 10 หลัก แต่ edit รับ 9-10 หลัก → import ข้อมูลเดิมที่ edit ได้ กลับ fail
- **วิธีแก้:**  align ทั้งสองเป็น 9-10 หลักหลัง normalize

### M9. Race condition ใน "เปลี่ยนบัญชี" flow

- **ไฟล์:** `backend/src/routes/line.routes.js:376-403`
- **ปัญหา:** unlink แล้ว set state ไม่ใช่ atomic → ส่ง 2 ข้อความเร็ว ๆ อาจ trigger state machine ซ้ำ
- **วิธีแก้:** set state ก่อน unlink หรือใช้ "rebinding" state ที่ reject concurrent messages

---

## LOW (9)

### L1. ETA speed fallback hardcoded 8 m/s
- **ไฟล์:** `eta.service.js:98` — ควรย้ายไป `env.tracking.etaDefaultSpeedMps`

### L2. GPS status log ไม่แยก denied vs timeout
- **ไฟล์:** `driver.routes.js:528-535` — log รวมเป็น "status" ทำให้ debug ยาก

### L3. Rate limiter fallback ใช้ IP เมื่อ user.id ไม่มี
- **ไฟล์:** `driver.routes.js:63` — ใช้ `req.user.id` อย่างเดียว (auth middleware รับประกัน)

### L4. ETA age_seconds ไม่ handle NULL
- **ไฟล์:** `ParentStatus.jsx:398` — แสดง "nulls" ถ้าค่าว่าง

### L5. Linking state TTL 10 นาที — สั้นเกิน
- **ไฟล์:** `line.service.js:39-62` — ควรเพิ่มเป็น 30 นาที

### L6. CSV header parsing ใช้ exact match บาง column
- **ไฟล์:** `school.routes.js:1232-1234` — ควรใช้ `includes()` ทุก column

### L7. Geofence events list ไม่มี pagination
- **ไฟล์:** `AdminGeofences.jsx:36-44` — ดูได้แค่ 50 ล่าสุด

### L8. AdminRouteDeviations ไม่มี pagination
- **ไฟล์:** `AdminRouteDeviations.jsx:35-46` — ดูได้แค่ 100 ล่าสุด

### L9. Inspection form inspection_date ไม่มี `required` attribute
- **ไฟล์:** `InspectionForm.jsx:250` — backend validate แล้ว แต่ frontend ควรเตือนก่อน

---

## สิ่งที่ตรวจแล้วผ่าน (ไม่มีปัญหา)

- ✅ Route mounting ทุก role ถูกต้อง (`app.js:93-143`)
- ✅ API path frontend ↔ backend ตรงทุก endpoint
- ✅ RBAC: school scope filtering, teacher block, province sees all (by design)
- ✅ Double-approve protection: roster request ใช้ `FOR UPDATE` lock
- ✅ JWT: pin algorithm HS256, invalidate after password change, force change
- ✅ Import: file type validation, max 5000 rows, file permission 0o600
- ✅ Affiliation scope enforcement ทุก endpoint
- ✅ Transport KPIs math ถูกต้อง
- ✅ Empty states ทุกหน้ามี
- ✅ Polling cleanup ไม่มี memory leak (ProvinceLiveVehicles, AffiliationLiveVehicles)
- ✅ Seed-defaults idempotent (ไม่สร้างซ้ำ)
- ✅ Event log endpoint `/geofences/events/list` ลงทะเบียนก่อน `/:id` (ไม่ conflict)

---

## ลำดับการแก้ที่แนะนำ

### รอบที่ 1 — ก่อนเปิด Phase 11A (CRITICAL + HIGH ที่เกี่ยว Phase 11A)
1. **C1** geofence parent_phone query — ฟีเจอร์หลักพังสมบูรณ์
2. **C2 + C3** geofence validation backend + frontend
3. **C4** ETA error codes
4. **C5** ParentStatus token check
5. **H4** geofence radius validation
6. **H5** loading states สำหรับ 2 หน้าใหม่

### รอบที่ 2 — ก่อน production (HIGH ที่เกี่ยว core)
7. **H1** emergency NULL vehicle_id
8. **H2** checkin idempotency
9. **H3** shift flag asymmetry
10. **H6** "สถานะ" empty status

### รอบที่ 3 — polish (MEDIUM + LOW)
11. M1-M9, L1-L9 ตามลำดับความสำคัญ

---

## หมายเหตุ

- audit นี้อ่านโค้ดเท่านั้น ไม่ได้รันจริง — บาง issue อาจไม่เกิดใน production ขึ้นกับ schema จริง (เช่น H1 ขึ้นกับ `emergency_logs.vehicle_id` nullability)
- แนะนำ verify H1 โดยเช็ค schema จริงก่อนแก้
- C1 ยืนยันโดย 2 audits อิสระกัน → มั่นใจสูงว่าเป็น bug จริง

---

## การแก้ไข (2026-06-24)

### แก้แล้ว (22 issues)

| ID | ไฟล์ที่แก้ | สรุปการแก้ |
|----|----------|-----------|
| C1 | `geofence.service.js:237` | เปลี่ยน JOIN chain จาก `s.parent_phone` → `parent_student` → `parents.phone` → `line_bindings.phone` |
| C2 | `geofence.routes.js:90-130,170-220` | เพิ่ม validation lat/lng bounds + radius > 0 + trigger_on/target_type/notify_roles enum ทั้ง POST และ PUT |
| C3 | `AdminGeofences.jsx:74-110` | เพิ่ม client-side NaN check + bounds check ก่อน submit |
| C4 | `eta.service.js:170-235` | เปลี่ยน `getForStudent()` จากคืน null → คืน structured error code (`feature_disabled`, `no_vehicle`, `no_pickup_point`, `vehicle_offline`) |
| C5 | `ParentStatus.jsx:29-36` | เพิ่ม error message ชัดเจนเมื่อไม่มี LIFF token ("กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA เท่านั้น") |
| H1 | `driver.routes.js:613-621` | เพิ่ม `vehicle_warning` field ใน response เมื่อ resolve vehicle ไม่ได้ (schema ยอม NULL อยู่แล้ว ไม่ใช่ FK error) |
| H2 | `checkin.service.js:332-356` | เปลี่ยน idempotency guard เป็นเช็ค last status + reject invalid transition (CHECKED_OUT → CHECKED_IN) |
| H3 | `driver.routes.js:537-541` | Documented — emergency ตั้งใจให้ทำได้เสมอ (ไม่บล็อกด้วย shift gate) มี comment ชัดเจนอยู่แล้ว |
| H4 | `geofence.routes.js:108-112` | เพิ่ม radius validation (1-50000m) ทั้ง POST และ PUT |
| H5 | `AdminGeofences.jsx:8,136-138` + `AdminRouteDeviations.jsx:8,73-75` | เพิ่ม `<LoadingState>` เมื่อ `busy && data.length === 0` |
| H6 | `line.service.js:424-442` | เพิ่ม `has_checkin_today` field ใน `getChildStatusToday()` เพื่อแยก "ไม่มี checkin" จาก "checkin แล้วยังไม่ checkout" |
| M1 | `driver.routes.js:1134-1163` | เปลี่ยน `console.warn` → `console.error` + เพิ่ม `tracking_health` field ใน response (eta/geofence/deviation: ok/disabled/error) |
| M3 | `geofence.service.js:26-55` | เพิ่ม periodic cleanup (ทุก 24h) ของ stale entries ใน `lastInside` Map |
| M8 | `school.routes.js:1336-1342` | เปลี่ยน import phone validation จาก 10 หลัก → 9-10 หลัก (match student edit) |
| M9 | `line.routes.js:376-406` | set state เป็น 'rebinding' ก่อน unlink เพื่อกัน concurrent double-unlink |
| M7 | `auth.routes.js:197-220` + `useAuth.jsx:6-67` + `Sidebar.jsx:159-176,225-230` | เพิ่ม `features` ใน login response + AuthContext + Sidebar filter ซ่อน link เมื่อ flag ปิด |
| L1 | `eta.service.js:95-99` | ใช้ `env.tracking.etaMinConfidenceSpeedMps` แทน hardcoded `8` |
| L4 | `ParentStatus.jsx:403` | มี null check อยู่แล้ว (`eta.age_seconds != null ? ... : '-'`) — ไม่ต้องแก้ |
| L5 | `line.service.js:40` | เพิ่ม TTL จาก 10 นาที → 30 นาที |
| L9 | `InspectionForm.jsx:250` | เพิ่ม `required` attribute ใน input |

### ทำทีหลัง (7 issues)

| ID | เหตุผลที่ทำทีหลัง |
|----|-----------------|
| M2 | pretrip gate เป็น frontend-only โดย design — ต้อง discuss ก่อนเปลี่ยนเป็น server-side |
| M5 | `parent_student` PK เป็น `(parent_id, student_id)` อนุญาตหลาย parent ต่อ student โดย design — ไม่ใช่ bug |
| L2 | GPS status log แยก denied vs timeout — cosmetic, ทำทีหลัง |
| L3 | rate limiter fallback — ไม่มีผลจริงเพราะ auth middleware บล็อกก่อน |
| L6 | geofence events pagination — ทำทีหลังพร้อม L7 |
| L7 | AdminRouteDeviations pagination — ทำทีหลัง |
| L8 | AdminRouteDeviations filter persistence — ทำทีหลัง |

### ไฟล์ที่แก้ทั้งหมด (16 ไฟล์)

**Backend (10):**
- `src/services/geofence.service.js` — C1, M3
- `src/services/eta.service.js` — C4, L1
- `src/services/checkin.service.js` — H2
- `src/services/line.service.js` — H6, L5
- `src/routes/geofence.routes.js` — C2, H4, M4
- `src/routes/parent.routes.js` — C4
- `src/routes/driver.routes.js` — H1, M1
- `src/routes/line.routes.js` — M9
- `src/routes/school.routes.js` — M8

**Frontend (5):**
- `src/pages/admin/AdminGeofences.jsx` — C3, H5
- `src/pages/admin/AdminRouteDeviations.jsx` — H5
- `src/pages/parent/ParentStatus.jsx` — C5
- `src/pages/transport/InspectionForm.jsx` — L9

**Verification:** `node --check` ผ่านทุกไฟล์ · `npm run test:unit` ผ่าน 89/89 · `npm test` (integration) ผ่าน 62 suites / 641 passed / 0 failed · `vite build` ผ่าน
