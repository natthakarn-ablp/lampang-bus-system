# Logic Confirmation Register

ระบบรถรับส่งนักเรียนจังหวัดลำปาง · commit `9a64efc` · 27 ส.ค. 2569

รายการในเอกสารนี้ **ยังไม่ถือว่าเป็นข้อบกพร่อง** จนกว่าเจ้าของระบบจะยืนยันว่ากติกาที่ถูกต้อง
ควรเป็นอย่างไร ผู้ตรวจไม่มีอำนาจตัดสินกฎทางธุรกิจแทนเจ้าของระบบ

ระดับความรุนแรงที่ระบุไว้เป็น **Provisional** — จะยืนยันหรือเปลี่ยนตามคำตอบที่ได้รับ

| รวม | 13 รายการ |
|---|---|
| Logic conflict (สองชั้นขัดแย้งกันเอง) | 7 |
| ต้องการการยืนยันกติกา | 6 |

---

## LOGIC-001: Grade-teacher school sub-accounts are grade-scoped everywhere in /api/school but NOT in /api/reports — the reports export returns every student in the school

- **Finding ID:** AUD-004
- **Process:** scope-bypass
- **Roles affected:** school (grade-teacher sub-account, role='school' + grade_scope set)
- **Entity:** students, daily_status, vehicles, schools
- **Provisional severity:** critical
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `backend/src/services/report.service.js:9-40 (buildScopeFilter), 402-429 (getExportRows)` — buildScopeFilter / getExportRows / getDailyReport

### พฤติกรรมปัจจุบัน

buildScopeFilter destructures only date/month/school_id/affiliation_id/vehicle_id and clamps a role='school' user to s.school_id = user.scopeId. It never reads user.gradeScope. The whole rest of the school module does the opposite: backend/src/routes/school.routes.js:68-73 resolveGradeScope(req) returns req.user.gradeScope for any non-admin, and it is threaded into every school read (school.routes.js:204-208 getStudents({...gradeFilter}), :224 getVehicles({gradeFilter}), :167 getDashboard({gradeFilter})), where services/school.service.js:207 hard-pins `const effectiveGrade = gradeFilter || grade || null` so 'a teacher can't unlock other grades'. The frontend agrees with the grade boundary too (utils/authScope.js:25 isGradeTeacher, Sidebar.jsx:151-155 TEACHER_BLOCKED_PATHS) — but /reports/daily is listed in SCHOOL_NAV at Sidebar.jsx:57 and is NOT in TEACHER_BLOCKED_PATHS, PrivateRoute at App.jsx:298 admits role 'school', and ExportButtons.jsx renders CSV/Excel/PDF buttons with no role or grade check at all.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

A homeroom-teacher sub-account scoped to one grade downloads a CSV/Excel/PDF containing, for EVERY student in the school regardless of grade: student_id, full name (CONCAT prefix+first+last), grade, classroom, school name, affiliation, bus plate number, and today's morning/evening check-in status and timestamps (report.service.js:407-418, headers at report.routes.js:112-116). The same account is deliberately 403'd from the school's read-only audit log, which contains strictly less PII. The daily/monthly/summary JSON endpoints likewise return school-wide per-vehicle and per-school breakdowns.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Should a grade-teacher sub-account (role='school' with grade_scope set, e.g. 'ป.4') be able to open /reports/daily and download the report export containing the names, grades, bus plates and attendance of students in OTHER grades of the same school? If no, must reports be grade-filtered like /api/school/students, or blocked outright like /api/school/audit-logs?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

DESCRIBE ONLY, NOT APPLIED. Either (a) pass req.user.gradeScope into buildScopeFilter and append `AND s.grade IN (?)` using the same gradeEquivalents() helper the school service uses, for every report query including getExportRows; or (b) add a requireFullSchoolScope-equivalent guard on the reports router for role='school' users with gradeScope set, and hide /reports/daily from TEACHER_BLOCKED_PATHS in Sidebar.jsx. Pick one after the Product Owner answers the question above — do not do both silently.

### Product Owner Decision

- [x] **Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ) — กรองตามสายชั้น ไม่ใช่ปิดกั้น**
- [x] ยืนยัน Severity เดิม (critical)

```
Final confirmed logic:
  ครูประจำสายชั้นเห็นข้อมูลเฉพาะสายชั้นของตัวเองเท่านั้น ทั้งในรายงานและทุกหน้าจอ
  ยกเว้นหน้าตรวจคำขอจดทะเบียนรถ ซึ่งข้อมูลเป็นรายชื่อผู้โดยสารทั้งคันของคนขับและ
  แยกตามสายชั้นไม่ได้ จึงปิดไม่ให้บัญชีครูสายชั้นเข้าถึงทั้งโมดูล เช่นเดียวกับที่
  หน้าประวัติการแก้ไขทำอยู่แล้ว

Reason / requirement reference:
  ข้อมูลที่หลุดคือชื่อ-นามสกุล ระดับชั้น ทะเบียนรถ และเวลาขึ้น-ลงรถของเด็กนอกสายชั้น
  ซึ่งบัญชีเดียวกันนี้ถูกกันออกจากหน้าประวัติการแก้ไขที่มีข้อมูลเด็กน้อยกว่าอยู่แล้ว

Confirmed by: เจ้าของระบบ                Confirmation date: 28 ส.ค. 2569
Implemented:  28 ส.ค. 2569 — ดู AUD-004 ใน SYSTEM_AUDIT_REPORT.md
```

---

## LOGIC-002: Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any request that did not pass through Cloudflare

- **Finding ID:** AUD-006
- **Process:** rate-limit-bypass
- **Roles affected:** unauthenticated, admin, province, affiliation, school, transport, driver, parent
- **Entity:** users, parent_student, audit_logs
- **Provisional severity:** major
- **Status:** needs_owner_confirmation
- **Confidence:** medium
- **Evidence:** `backend/src/app.js:37-43` — app.set('trust proxy', 1)

### พฤติกรรมปัจจุบัน

With trust proxy = 1 Express takes the SECOND-FROM-RIGHT entry of X-Forwarded-For as req.ip. That is correct for the documented chain client -> Cloudflare -> nginx (docs/deployment-hardening.md:16 confirms nginx proxies /api/ to 127.0.0.1:3000 forwarding X-Forwarded-For), because Cloudflare appends the true client IP and nginx then appends the Cloudflare edge IP. It is NOT correct for a request that reaches nginx directly on the origin IP: then XFF is '<attacker-chosen value>, <attacker IP>' and Express returns the attacker-chosen value as req.ip.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

app.js:37-43 confirmed: `app.set('trust proxy', 1)` with a comment describing the client -> Cloudflare -> nginx chain. The analysis is correct — through Cloudflare the true client stays second-from-right and req.ip is right, but on a connection made straight to the origin's nginx the XFF becomes '<attacker value>, <attacker IP>' and Express hands the attacker's chosen value to every per-IP key: loginLimiter and the per-(username+IP) lockout (auth.routes.js:35-52,132), bindLimiter (parent.routes.js), qrLimiter, globalApiLimiter, plus audit_logs.ip_address. One correction to the auditor's framing: the direct-to-backend variant is already closed — backend/src/index.js:15 binds `process.env.HOST || '127.0.0.1'` (loopback by default), which supersedes the 0.0.0.0 note in docs/deployment-hardening.md:21. So the only live vector is a request to nginx on :443 at the origin IP, bypassing Cloudflare.

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

Every per-IP control becomes bypassable by rotating a header: loginLimiter (20 attempts / 15 min) and the per-(username+IP) lockout in auth.routes.js:35-52 — whose key is built from req.ip at line 132 — stop constraining password guessing; bindLimiter (12 per 10 min), which is the only brake on guessing a (phone, studentId) pair to link to a child, stops constraining account binding; qrLimiter stops constraining public QR scanning. Audit-log ipAddress values also become attacker-authored, so the forensic record of a login or a QR view is unreliable.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Is TCP :443 on the origin server restricted to Cloudflare's published IP ranges (firewall rule or nginx allow/deny), and does nginx set rather than append X-Forwarded-For? If the origin answers requests that did not come through Cloudflare, every per-IP rate limit and the login lockout can be bypassed with a forged X-Forwarded-For header, and audit-log IPs are attacker-authored.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. Either (a) restrict the origin to Cloudflare IP ranges and enable Authenticated Origin Pull, then keep trust proxy = 1; or (b) have nginx overwrite (not append) X-Forwarded-For / X-Real-IP from CF-Connecting-IP only when the connection comes from a Cloudflare range, and key the limiters on that value via an explicit keyGenerator instead of the default req.ip. Also move the failed-login lockout out of the in-process Map (auth.routes.js:35) so it survives a restart.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-003: Refresh-token rotation is broken end to end: the backend revokes the old refresh token, the frontend never stores the new one, so every session is force-logged-out at its second refresh

- **Finding ID:** AUD-009
- **Process:** layer-conflict
- **Roles affected:** admin, province, affiliation, school, transport, driver
- **Entity:** revoked_tokens
- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `frontend/src/api/axios.js:81-89 (backend counterpart: backend/src/routes/auth.routes.js:364-385)` — api.interceptors.response 401 handler

### พฤติกรรมปัจจุบัน

The backend rotates on every refresh: it mints a new refresh token AND inserts the presented jti into revoked_tokens (auth.routes.js:369-374), returning both access_token and refresh_token. The client reads only res.data.data.access_token and writes only 'access_token'; the returned refresh_token is discarded. localStorage 'refresh_token' is written exactly once, at login (frontend/src/hooks/useAuth.jsx:31). So the second refresh presents the same, now-revoked, jti, hits the revocation check at auth.routes.js:334-340, gets 401 'Refresh token has been revoked', and the interceptor's catch runs localStorage.clear() + window.location.href = '/login' (axios.js:90-95).

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

Backend auth.routes.js:364-385 mints a new refresh token AND inserts the presented jti into revoked_tokens, returning both tokens. Frontend axios.js:81-89 reads only `res.data.data.access_token` and writes only 'access_token'; the returned refresh_token is dropped. grep over frontend/src shows localStorage 'refresh_token' is written exactly once, at useAuth.jsx:31 (login); axios.js:82 and ChangePassword.jsx:41 only read it. So refresh #2 replays the revoked jti, hits the revocation check at auth.routes.js:333-340, gets 401, and axios.js:88-95 runs localStorage.clear() + window.location.href='/login'.

### จุดที่ขัดแย้ง

backend/src/routes/auth.routes.js:369-374 revokes the presented refresh jti on every rotation; frontend/src/api/axios.js:84-85 persists only the access token. At runtime the backend wins: the client's stored refresh token is dead after the first refresh, and the user is logged out on the next one.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

With JWT_EXPIRES_IN=24h, a session survives the first access-token expiry (refresh #1 succeeds) and is then hard-kicked to the login screen at the next expiry (refresh #2), losing any unsaved work in the tab. The configured 7-day refresh window is unreachable — the effective ceiling is roughly two access-token lifetimes. It also silently defeats the security intent of rotation: the client keeps re-presenting a dead token instead of a fresh one, so rotation buys nothing and only produces spurious logouts. This is the 'layers disagree on a rule' case in the brief.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> ต้องกำหนดคำถามเพิ่มเติม

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

DESCRIBE ONLY — not applied. In axios.js, persist the rotated token: read res.data.data.refresh_token and localStorage.setItem('refresh_token', ...) alongside the access token, inside the same try block, before processQueue. Verify the single-flight queue (isRefreshing/pendingQueue) still holds so two concurrent 401s cannot both spend the token.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-004: Migration 039 dropped uq_dva_active_vehicle but two services still rely on it — the 'one active driver per vehicle' rule is now enforced by nothing, and its error handler is dead code

- **Finding ID:** AUD-018
- **Process:** check-then-act
- **Roles affected:** school, admin, driver
- **Entity:** driver_vehicle_assignments, vehicles, vehicle_latest_locations, drivers, users
- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `backend/src/services/driverProfile.service.js:82-104` — linkOrCreateDriverForVehicle() step (3)

### พฤติกรรมปัจจุบัน

Two consequences. (a) The 409 handler is unreachable for the vehicle case — 'uq_dva_active_driver_vehicle' does not contain the substring 'uq_dva_active_vehicle', so the regex never matches; a genuine same-driver-same-vehicle duplicate now falls through to `throw err` and surfaces as an unhandled ER_DUP_ENTRY (HTTP 500) instead of the intended 409 VEHICLE_ALREADY_HAS_ACTIVE_DRIVER. (b) The check at 83-87 is a plain SELECT with no FOR UPDATE, and the caller's transaction (school.routes.js:1040) never locks the vehicle row — the SELECT at school.routes.js:1043 that resolves the existing vehicle is a plain read. Nothing serializes two concurrent onboardings of the same vehicle by different drivers.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

Confirmed with one correction. driverProfile.service.js:82-104: the check at :83-87 is a plain SELECT with no FOR UPDATE and matches only driver+vehicle, and the catch at :99 tests /uq_dva_active_vehicle/, which cannot match the surviving key name uq_dva_active_driver_vehicle — so the VEHICLE_ALREADY_HAS_ACTIVE_DRIVER 409 is unreachable. driverLifecycle.service.js:99-107 by contrast locks the vehicles row FOR UPDATE and does a real application-level check, returning TARGET_VEHICLE_HAS_ACTIVE_DRIVER — while migration 039:5-9 states the shared-driver design deliberately retired that very rule. Correction to the finding: the fall-through is NOT an HTTP 500. errorHandler.js:30 maps any ER_DUP_ENTRY to status 409 with the generic message 'Duplicate entry — record already exists', so the caller gets an unlocalised 409 rather than the intended Thai message. Separately, and worse than the finding states, the consequence is not conditional on a race at all: under 039's intended shared-fleet model a vehicle legitimately has several active assignments, and vehicleLocation.service.js:29-38 getActiveDriverIdForVehicle resolves the driver with LIMIT 1 and no ORDER BY. driver.routes.js:1175 uses that result rather than the authenticated driver's own driver_id, so every GPS ping and every row in vehicle_location_history can be stamped with the wrong driver.

### จุดที่ขัดแย้ง

backend/migrations/030_vehicle_canonical_identity.sql:27 created `ADD UNIQUE KEY uq_dva_active_vehicle (active_vehicle_id)` — one active assignment per vehicle. backend/migrations/039_driver_pool_and_shifts.sql:8-9 then runs `ALTER TABLE driver_vehicle_assignments DROP INDEX uq_dva_active_vehicle;` and replaces it at :20-25 with `uq_dva_active_driver_vehicle (active_driver_vehicle_key)` where the generated column is CONCAT(driver_id,'|',vehicle_id). The migration comment is explicit: 'The shared-driver design deliberately replaces that rule with one active row per driver+vehicle pair; concurrent use is enforced on operating shifts.' Neither driverProfile.service.js nor driverLifecycle.service.js was updated. At runtime the DB wins: a second ACTIVE assignment for the same vehicle with a DIFFERENT driver now inserts successfully.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

Two school users (the fleet is shared province-wide — see the comment at school.routes.js:1077-1079) can POST /api/school/vehicles for the same existing plate with different driver_name values at the same time; both pass the check at 83-87 and both INSERT an active assignment. The vehicle then has two ACTIVE assignments. backend/src/services/vehicleLocation.service.js:29-38 getActiveDriverIdForVehicle resolves with `LIMIT 1` and no ORDER BY, so every GPS ping for that vehicle is attributed to an arbitrary one of the two drivers (backend/src/routes/driver.routes.js:1175, 1189) — location history and any driver-accountability report are then wrong. driverLifecycle.service.js:150 getDriverIntegrity already exposes a `vehicles_multiple_active_drivers` counter, which is evidence the drift is expected to occur but is only reported, never prevented.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Is 'one active driver per vehicle' still a business rule, or did migration 039 permanently retire it in favour of the shared driver pool? If retired, driverLifecycle's TARGET_VEHICLE_HAS_ACTIVE_DRIVER guard and both dead uq_dva_active_vehicle catches should go, and getActiveDriverIdForVehicle must stop guessing — the GPS route should stamp the authenticated driver's own driver_id. If still a rule, it needs a real constraint or a locked check in driverProfile.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. If one active driver per vehicle is still the rule: restore an equivalent DB unique key (a generated active_vehicle_id column) and fix both regexes to match its name; until then, at minimum take `SELECT ... FROM vehicles WHERE id = ? FOR UPDATE` before the assignment check in linkOrCreateDriverForVehicle so concurrent onboardings of one vehicle serialize (driverLifecycle.reassignDriverVehicle at :99 already does this and is therefore safe). If multiple active drivers per vehicle is the rule: delete the dead ER_DUP_ENTRY branches and fix vehicleLocation.getActiveDriverIdForVehicle, which currently picks one arbitrarily.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-005: A driver's withdrawal of PDPA consent suspends only the QR page; the LINE/LIFF parent channel keeps publishing the driver's name

- **Finding ID:** AUD-035
- **Process:** consent-withdrawal-cascade
- **Roles affected:** driver, parent (LINE/LIFF)
- **Entity:** drivers, driver_display_status, consent_records, students
- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `backend/src/services/line.service.js:243-263 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76, 198-209)` — getChildrenByBoundPhone (driver_name subquery)

### พฤติกรรมปัจจุบัน

withdrawConsent (consent.service.js:137-147) writes driver_display_status = 'suspended', reason = 'consent_withdrawn' when a driver withdraws qr_driver_public or qr_driver_parent. Exactly one reader of that table exists in the codebase — `grep -rn "driver_display_status" backend/src` returns consent.service.js:106,141 (writers) and qrAccess.service.js:74 (the only reader). qrAccess.buildParentView (L198-209) honours it: `const visible = !!ctx.driver && ctx.driverStatus !== 'suspended';` and nulls driver_name and emergency_contact. The parent LIFF/LINE path does not: the subquery above joins driver_vehicle_assignments with no reference to driver_display_status, so driver_name is returned regardless of the suspension.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

consent.service.js:137-147 writes driver_display_status='suspended', reason='consent_withdrawn'. grep -rn driver_display_status backend/src returns exactly three code hits: consent.service.js:106 and :141 (writers) and qrAccess.service.js:74 (the only reader), which buildParentView at 198-209 uses to null driver_name and emergency_contact. line.service.js:243-263 joins driver_vehicle_assignments with no reference to that table, so driver_name is returned to bound parents regardless. The consent text is scoped to verified parents, not to the QR channel: consentText.js qr_driver_parent reads 'ระบบจะแสดงต่อผู้ปกครองของนักเรียนที่ใช้บริการรถของท่าน: ชื่อผู้ขับ...' — so the LINE parent channel is squarely inside what was withdrawn.

### จุดที่ขัดแย้ง

qrAccess.service.js:201 treats driver_display_status='suspended' as a hard gate on disclosing driver_name to parents. line.service.js:247-253 discloses driver_name to the same audience with no such gate. Both are 'the parent view'; they disagree at runtime, and the ungated one is the always-on path (app.js:166) while the gated one is behind FEATURE_VEHICLE_QR.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

A driver who exercises the PDPA ม.19(5) right to withdraw consent for showing their name to parents continues to have their name shown to every bound parent on the vehicle — on the /parent LIFF page (via GET /api/parent/children) and in the LINE Flex cards pushed by the 'ข้อมูลบุตร' and bind-success flows. The system reports the withdrawal as effective (the QR page goes dark) while the higher-traffic channel is unaffected. The same blind spot applies to /api/school/vehicles (school.service.js:290), transport.service.js:167,217, province.service.js:460,627 and affiliation.service.js:302,472, all of which select driver_name without consulting driver_display_status.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> When a driver withdraws qr_driver_parent, should their name also disappear from the LINE/LIFF parent view and the operator screens (school/transport/province/affiliation vehicle lists), or is the withdrawal intended to cover the QR page only? The consent text says 'shown to identity-verified parents', which reads wider than the QR page.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. Make driver_display_status the single source of truth for driver-name disclosure: either LEFT JOIN driver_display_status into getChildrenByBoundPhone and null driver_name when display_status='suspended', or extract qrAccess.deriveDriverDisplayStatus into a shared helper that every driver_name-returning query must call. Then decide (owner question) whether the school/province/transport/affiliation staff views are in or out of scope for the same consent.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-006: A child's data is unlocked by a guardian phone number plus a student code, with no proof of possession, and a correct guess returns the child's full name, grade, classroom and school before any ownership is established

- **Finding ID:** AUD-037
- **Process:** authentication-strength
- **Roles affected:** parent (LINE/LIFF), school
- **Entity:** parents, parent_student, students, line_bindings
- **Provisional severity:** major
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Evidence:** `backend/src/routes/parent.routes.js:202-256 (with backend/src/services/line.service.js:100-131 and backend/src/services/lineBindGuard.js:23-28)` — POST /api/parent/line/bind-preview

### พฤติกรรมปัจจุบัน

bind-preview verifies that the caller holds a genuine LINE id_token (so the LINE account is real) and that the submitted (phone, student_code) pair matches a parents→parent_student(approved)→students row (line.service.js:100-116). It does NOT verify that the caller controls that phone number. On a match, `match.student` — built at line.service.js:122-129 as { prefix, first_name, last_name, grade, classroom, school_name } — is returned. bind-confirm then permanently links that LINE account to the parent record, after which /api/parent/children, /status, /history (up to 90 days) and /eta are all available. The only brake is lineBindGuard's in-memory lockout (POLICY at lineBindGuard.js:23-28: 5 failures per pair, 10 per phone, 10 per student code, 12 per LINE sub, each per 10-minute window, 30-minute lock) plus the per-IP bindLimiter at parent.routes.js:45-52 (12 per 10 min). The code names the residual risk itself at parent.routes.js:41-44: 'NOTE (residual): the strongest fix is proof of phone ownership (SMS OTP) or a school-issued one-time claim code'.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

parent.routes.js:202-256 verifies a genuine LINE id_token, then matches the submitted (phone, student_code) against parents -> parent_student(approved=TRUE) -> students in line.service.js:100-116, and on success returns match.student — prefix, first_name, last_name, grade, classroom, school_name (built at 122-129). Nothing verifies the caller controls the phone. Compensating controls are real but knowledge-only: bindLimiter (12 per 10 min per IP, parent.routes.js:45-52) and lineBindGuard POLICY (pair 5/10 min then a 30 min lock, plus phone/student/sub counters, lineBindGuard.js:23-28), and line.service.js:144-155 blocks taking over an already-bound phone. The code comment at parent.routes.js:39-43 already acknowledges the residual and names SMS OTP as the fix.

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

Both factors are low-entropy and locally known: a Thai mobile number is 10 digits with a small prefix set and is routinely shared, and the student code is printed on school paperwork and visible to classmates, teachers and anyone handling the roster. A person who knows both — a former partner, a relative, a school volunteer, anyone who has seen a class list next to a contact list — can bind their own LINE account and thereafter see the child's name, school, classroom, bus plate, driver name, daily boarding and alighting times, up to 90 days of movement history and the pickup-point label, without the real guardian being notified (bind-confirm pushes the success card to the BINDING account, parent.routes.js:326-331, not to the displaced guardian). The lockout limits guessing but does nothing against someone who already knows both values. Mitigating: bindLineUserToPhone (line.service.js:144-155) refuses a phone already bound to a different LINE account, so this works only before the genuine guardian binds, or after they unbind.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Is possession-proof for the parent bind (SMS OTP on the guardian's phone, or a school-issued one-time claim code handed out with the roster) in scope before go-live? Without it, knowledge of a guardian phone number plus a printed student code is sufficient to obtain a child's location history.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. Options in increasing strength: mask the student fields in the bind-preview response; notify the school on every bind/unbind for that student; issue a per-student one-time claim code distributed by the school on paper; or add SMS OTP proof of phone ownership. Note that lineBindGuard is in-memory and single-instance (lineBindGuard.js:11-12) — if the backend is ever run under PM2 cluster mode or behind more than one node, the lockout weakens proportionally, so any decision to keep the current credential should be paired with moving the guard to a shared store.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-007: Production boots with LINE_CHANNEL_ACCESS_TOKEN unset; every emergency LINE push then silently becomes a no-op that still reports success to the driver

- **Finding ID:** AUD-038
- **Process:** Secret management and exposure
- **Roles affected:** driver, school, admin, parent
- **Entity:** emergency_logs, line_notifications
- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `backend/src/config/env.js:23, 148; backend/src/services/line.service.js:9-15, 800-812; backend/src/routes/driver.routes.js:668-681` — PRODUCTION_REQUIRED (env.js) / getClient() + pushEmergencyFlexMessage() (line.service.js) / POST /api/driver/emergency (driver.routes.js)

### พฤติกรรมปัจจุบัน

env.js requires only LINE_CHANNEL_SECRET and CRON_API_KEY when NODE_ENV=production (line 23). LINE_CHANNEL_ACCESS_TOKEN falls back to '' (line 148) and is never validated. getClient() returns null on an empty token (line 12), so pushEmergencyFlexMessage returns { dryRun: true } after only a console.log. driver.routes.js:668 does not read that return value and driver.routes.js:685-696 still responds 201 'Emergency reported'. Result: inbound LINE (webhook signature) is fail-CLOSED, outbound LINE is fail-SILENT.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

env.js:23 PRODUCTION_REQUIRED = ['LINE_CHANNEL_SECRET','CRON_API_KEY'] — the access token is not in the list; env.js:148 falls back to ''. line.service.js:12 getClient() returns null on an empty token, and pushEmergencyFlexMessage (line.service.js:~808-812) then console.logs 'dry-run' and returns { dryRun: true }. driver.routes.js:668-680 awaits that call inside a try/catch that discards the return value, and driver.routes.js:685-696 unconditionally responds 201 'Emergency reported'. I also confirmed the wider gap the auditor did not state: even with a token present, a failed pushMessage returns { sent:false } (line.service.js:795-798, 826-829) and is likewise discarded — nothing in the API response, the audit row (driver.routes.js:637-655) or any table records delivery status. Mitigating fact the auditor omitted: the emergency itself IS durably persisted (emergencySvc.createEmergencyReport + logAudit), so only the LINE alert is lost, not the report.

### จุดที่ขัดแย้ง

backend/.env.example:25-31 documents LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_LIFF_ID / LINE_GROUP_ID as 'REQUIRED in production'. backend/src/config/env.js:23 enforces exactly one of them (LINE_CHANNEL_SECRET). At runtime env.js wins: the app boots.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

A driver presses the emergency button, sees a success screen, and the school LINE group is never notified. Nothing in the API response, the audit trail, or any alert distinguishes 'delivered' from 'dry-run'. The only trace is a console.log line in the PM2 out-log. This is a child-safety notification path failing invisibly on a single missing environment variable.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Should the backend REFUSE TO BOOT in production when LINE_CHANNEL_ACCESS_TOKEN (and LINE_GROUP_ID) are blank, or is running with LINE outbound disabled a legitimate production configuration? If it is legitimate, must an emergency report that could not be pushed to LINE be flagged back to the driver's screen and to the operator dashboard, rather than reported as a plain success?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

DESCRIBE ONLY — not applied. Two independent changes: (a) add LINE_CHANNEL_ACCESS_TOKEN (and, if the emergency group is mandatory, LINE_GROUP_ID) to PRODUCTION_REQUIRED in backend/src/config/env.js:23 so production refuses to boot without them; and (b) make driver.routes.js:668 read the returned object and record `{ dryRun: true }` / `{ sent: false }` on the emergency record or in an audit row so an undelivered emergency is visible to an operator rather than only to the PM2 log.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-008: Repository documents disagree on whether a restore drill has ever been executed, and no drill evidence exists

- **Finding ID:** AUD-042
- **Process:** disaster-recovery
- **Roles affected:** admin
- **Entity:** backup/restore capability
- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `docs/go-live-handoff.md:46 (vs docs/READINESS_SCORECARD_2026-08.md:95 and docs/OPERATOR_RUNBOOK.md:74-98)` — Section 2 completed-work table, row 10.10D

### พฤติกรรมปัจจุบัน

scripts/restore-drill-db.sh exists and is well-guarded (lines 30-43 refuse to target lampang_bus/mysql/sys/production; lines 64-67 refuse when RESTORE_DB equals the .env DB_NAME; lines 87-90 verify the sha256 sidecar before restoring), but there is no evidence it has ever completed against a real backup. The evidence-pack machinery built for exactly this — scripts/create-restore-drill-evidence-pack.js and scripts/validate-restore-drill-evidence.js — has produced nothing: `find outputs output -path '*restore-drill*' -type f` returns zero files, and outputs/ contains only ui-redesign screenshot folders.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

The conflict is exactly as described and is sharper than the summary suggests. docs/go-live-handoff.md:46 records '10.10D | Restore drill script + manual run verified | OK'. docs/READINESS_SCORECARD_2026-08.md:95 says 'Restore readiness | not ready because drill DB does not yet exist'. docs/OPERATOR_RUNBOOK.md:74-98 states that as of 2026-08-25 the drill DB has not been created, lists the remaining privileged CREATE DATABASE step, and ends with 'Do not mark backup governance FULL GREEN until at least one restore drill has completed'. I confirmed the evidence-pack machinery has produced nothing: `find outputs output -iname '*restore-drill*'` returns zero files and outputs/ holds only ui-redesign screenshots.

### จุดที่ขัดแย้ง

docs/go-live-handoff.md line 46 marks the restore drill ✅ verified. docs/READINESS_SCORECARD_2026-08.md line 95 states 'Restore readiness | not ready because drill DB does not yet exist'. docs/OPERATOR_RUNBOOK.md lines 79-80 state 'As of 2026-08-25 the config is staged on production, but the drill database does not exist yet', and line 98 states 'Do not mark backup governance FULL GREEN until at least one restore drill has completed'. The scorecard is the later document (2026-08 vs the handoff's 10.10-series phase numbering), so at runtime the scorecard/runbook position is the one that reflects the current server: the drill DB is absent, therefore no drill has been run.

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

Backups are produced, checksummed and verified as FILES (backup-db.sh lines 86-91 gzip -t + sha256sum; health-check.sh lines 93-103 re-verifies every 5 minutes), but nothing in the repository shows the dumps have ever been proven to LOAD and yield correct row counts. Every recovery path in docs/go-live-handoff.md section 9 terminates in 'restore from the .sql.gz', and docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md line 151 additionally requires a drill against the same backup BEFORE any production restore — so if the dumps are unrestorable, that is discovered for the first time during a real incident.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Has a restore drill ever been completed against a real production dump — i.e. does lampang_bus_restore_drill exist and has a dump been loaded into it with row counts checked? If yes, produce the evidence pack; if no, docs/go-live-handoff.md line 46 is a false sign-off and should be reverted to amber before go-live.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only, not applied: reconcile the three documents to a single stated status; if the drill has genuinely not run, execute the operator sequence already written in docs/OPERATOR_RUNBOOK.md lines 87-96 and validate it with the existing scripts/validate-restore-drill-evidence.js.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (major)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-009: Sidebar and MobileBottomNav apply the driverRegistration flag in opposite directions for /driver/applications

- **Finding ID:** AUD-082
- **Process:** feature-flag-gating
- **Roles affected:** driver
- **Entity:** verification applications
- **Provisional severity:** minor
- **Status:** logic_conflict
- **Confidence:** high
- **Evidence:** `frontend/src/components/MobileBottomNav.jsx:10-20; conflicting rule at frontend/src/components/Sidebar.jsx:169-172` — driverTabs(features) vs. FLAG_GATED['/driver/applications']

### พฤติกรรมปัจจุบัน

Sidebar.jsx:170 maps '/driver/applications' → 'driverRegistration' in FLAG_GATED, and the filter at :173-178 keeps an item only when the flag is TRUE. MobileBottomNav.jsx:14-16 shows '/driver/applications' only when the flag is FALSE. The two surfaces are exactly inverted for the same path. The backing API is unconditional: GET/POST /api/driver/applications live on the always-mounted /api/driver router (backend/src/routes/driver.routes.js:1254 and :1266, mounted at app.js:146) with no feature check — unlike /driver/registrations, which really is flag-mounted at app.js:137-140.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

Literally true: Sidebar.jsx:170 puts '/driver/applications' in FLAG_GATED → shown only when driverRegistration is TRUE; MobileBottomNav.jsx:14-16 shows '/driver/applications' only when it is FALSE (and '/driver/vehicle-registration' when TRUE). But the intent is documented and coherent, not accidental: MobileBottomNav.jsx:6-9 says the middle tab leads to the consolidated page when the flag is on, 'instead of the inspection-status page (which moves to the sidebar)'. The two surfaces are complementary — the page is always on exactly one of them. The real residue is a desktop-only gap: the bottom bar is `md:hidden` (MobileBottomNav.jsx:48), so with the flag OFF a driver on a desktop browser has no link to สถานะส่งตรวจรถ at all, even though driver.routes.js mounts GET/POST /api/driver/applications unconditionally under the always-mounted /api/driver (app.js:146).

### Runtime ใช้กติกาใด

ดูหัวข้อจุดที่ขัดแย้ง — ฝั่งที่บังคับใช้จริงคือฝั่ง backend เสมอ เพราะ frontend เป็นเพียงการซ่อนปุ่ม

### ผลกระทบทางธุรกิจที่เป็นไปได้

With FEATURE_DRIVER_REGISTRATION off — the dark-by-default state described at backend/src/config/env.js:190-192 — a driver on desktop loses 'สถานะส่งตรวจรถ' from the sidebar entirely even though the page and its API work perfectly, while the same driver on mobile still sees it as a primary bottom-bar tab. Drivers are the least likely users to work around a missing menu item, and the bottom bar is described in MobileBottomNav.jsx:6-9 as 'the PRIMARY surface for elderly / low-tech drivers'.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> When FEATURE_DRIVER_REGISTRATION is off, is the desktop sidebar deliberately hiding 'สถานะส่งตรวจรถ' (/driver/applications) because drivers are expected to be on mobile, or should Sidebar.jsx:170 drop that path from FLAG_GATED so the working page stays linked on desktop too?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

DESCRIBE ONLY, NOT APPLIED. Remove '/driver/applications' from FLAG_GATED in Sidebar.jsx (its API is unconditional), keeping only '/driver/vehicle-registration' and '/school/registration-review' gated on driverRegistration, and leave the bottom-bar swap at MobileBottomNav.jsx:14-16 as-is. Confirm with the Product Owner which page the mobile middle tab should point at in each flag state before changing it.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (minor)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-010: In the shipped configuration no parent consent record can exist, and the consent ledger has no link to the child whose data is being disclosed

- **Finding ID:** AUD-102
- **Process:** pdpa-lawful-basis
- **Roles affected:** parent (LINE/LIFF), admin
- **Entity:** consent_records, students, parents
- **Provisional severity:** minor
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Evidence:** `backend/.env.example:87 (with backend/src/app.js:176-179, backend/src/config/env.js:200, backend/migrations/035_consent_records.sql:9-27)` — FEATURE_VEHICLE_QR / consent_records table

### พฤติกรรมปัจจุบัน

The shipped default disables FEATURE_VEHICLE_QR, so /api/consent is never mounted (app.js:176-179) and no parent can create a consent_records row. FEATURE_PARENT_CONSENT_REQUIRED is not even listed in backend/.env.example (the file lists only FEATURE_VEHICLE_QR:87, FEATURE_QR_LEVEL3:91, FEATURE_DRIVER_SHIFT_SELECTION:99, FEATURE_DRIVER_REGISTRATION:110), so it defaults to false at env.js:200 and guardParentView short-circuits with no DB hit (parentConsentGate.js:64). Meanwhile /api/parent is mounted unconditionally (app.js:166) and discloses children's names, grades, classrooms, school, bus plate, driver name, daily boarding times, up to 90 days of boarding history and the pickup-point label. Separately, consent_records (migration 035, L9-27) keys a consent row on user_id OR line_user_id plus consent_type — there is no student_id / child column, so a recorded guardian consent cannot be attributed to a particular child even in principle.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

backend/.env.example:87 ships FEATURE_VEHICLE_QR=false, so app.js:176-179 never mounts /api/consent and no consent_records row can be created; FEATURE_PARENT_CONSENT_REQUIRED is absent from .env.example and defaults false at env.js:200, so parentConsentGate.js:64 short-circuits with no DB hit. /api/parent is mounted unconditionally at app.js:166. consent_records (migration 035) keys on line_user_id/user_id and consent_type with no student reference.

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

Today the parent channel processes children's personal data (names, classrooms, movement times, pickup location labels) with zero consent artefact in the system, and the consent schema that does exist cannot express 'guardian X consents on behalf of child Y'. If the Province's lawful basis is consent, there is no evidence of it; if it is a public task, the consent machinery built here is not the control that matters and the DPIA/ROPA is what needs to exist.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> What is the Province's declared lawful basis under PDPA for processing pupils' names, classrooms, movement times and pickup locations in the parent LINE channel — consent, or public task? If consent, the consent_records schema needs a student reference (guardian X consents on behalf of child Y) and the /api/consent router must be mounted independently of FEATURE_VEHICLE_QR; if public task, is a DPIA/ROPA on file instead?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. If the answer is 'consent': the ledger needs a student reference and a parent-tracking consent text reviewed by the DPO (backend/src/config/consentText.js:9 still carries an unresolved TODO to that effect), plus a consent screen in the parent LIFF page. If the answer is 'public task': record that decision, remove or clearly re-scope parentConsentGate so operators do not believe a consent control is in force, and publish the ม.23 notice instead.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (minor)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-011: There is no erasure mechanism for a child who leaves: withdrawal is a soft delete that retains name, classroom and guardian link indefinitely, and the act of withdrawing copies the child's full name into audit_logs, which is archived rather than deleted

- **Finding ID:** AUD-104
- **Process:** retention-erasure
- **Roles affected:** school, admin, parent (LINE/LIFF)
- **Entity:** students, parents, parent_student, audit_logs, audit_logs_archive
- **Provisional severity:** minor
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Evidence:** `backend/src/routes/school.routes.js:913-929 (with backend/scripts/cleanup-old-logs.js:28-37)` — DELETE /api/school/students/:id

### พฤติกรรมปัจจุบัน

The only student-removal path in the codebase is this soft delete (mirrored by studentTransfer.service.js:126 and studentImportPreview.service.js:716). The row keeps prefix, first_name, last_name, grade, classroom, student_code, dropoff_address, school_id; parent_student and parents rows are untouched (the only DELETE FROM parent_student in the tree is school.routes.js:797, part of a guardian-reassignment edit, not withdrawal); and school.routes.js:937-951 exposes a restore endpoint that depends on the data still being there. The retention tooling covers other tables only: backend/scripts/cleanup-old-logs.js:28-37 lists audit_logs (archived to audit_logs_archive), checkin_logs (archived), daily_status and vehicle_location_history — no students, no parents, no line_message_logs. On top of that, the withdrawal itself writes the child's assembled full name into audit_logs.old_value at school.routes.js:920-926 (`student_name: `${st.prefix || ''}${st.first_name} ${st.last_name}``), and cleanup-old-logs.js:29 archives audit_logs into audit_logs_archive rather than deleting them — so the withdrawal event makes an additional, longer-lived copy of the child's name.

### ผู้ตรวจทานอ่านโค้ดซ้ำแล้วพบว่า

school.routes.js:913-917 is a soft delete only (is_deleted=TRUE, deleted_at=NOW(), vehicle_id=NULL); 919-928 then writes the child's full name, grade and classroom into audit_logs.old_value. The restore endpoint at 936-951 depends on that data still being present. grep confirms the only DELETE FROM parent_student in the tree is school.routes.js:797, part of guardian reassignment, not withdrawal — there is no hard-delete path for students, parents or parent_student anywhere in backend/src. cleanup-old-logs.js:28-37 covers audit_logs (archived, not deleted), checkin_logs, daily_status and vehicle_location_history only.

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

A guardian exercising the right to erasure, or a school honouring the retention period stated to parents in backend/src/config/consentText.js:41 ('ระยะเวลาเก็บข้อมูล: ตลอดปีการศึกษาที่บุตรหลานใช้บริการ'), cannot be satisfied by any function in this system. Children's names, classrooms, home drop-off addresses and their guardians' names and phone numbers persist indefinitely after the child leaves, and every withdrawal adds a second copy of the child's name into an archive table with its own indefinite life. The consent text's stated retention period is therefore not implementable today.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> What is the required retention for a withdrawn pupil's record — must names, classrooms, drop-off addresses and the guardian link be erasable on request (and audit_logs_archive copies with them), or are these retained as education records for a defined period? The answer determines whether a hard-delete/anonymise job is needed before go-live.

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. Once the periods above are fixed: add students and parents entries to the backend/scripts/cleanup-old-logs.js TABLES list with an anonymise-in-place strategy (the table has no archive counterpart and FKs from checkin_logs/parent_student mean a hard DELETE is not safe), keeping the row id and school_id so historical aggregate reports stay valid; note that a purge window shorter than the restore workflow (school.routes.js:937-951) will silently make restores impossible, so the two must be reconciled. Do NOT run cleanup-old-logs.js with --apply against production before the windows are signed off — its own header at L17-18 says the same.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (minor)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-012: Withdrawing the QR consent publicly re-labels the driver as 'ระงับ' (suspended) — exercising a PDPA right produces a public negative status indistinguishable from a disciplinary suspension

- **Finding ID:** AUD-105
- **Process:** pdpa-design
- **Roles affected:** driver
- **Entity:** driver_display_status, consent_records, drivers
- **Provisional severity:** minor
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Evidence:** `backend/src/services/qrAccess.service.js:193 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76)` — buildPublicView → driver_status

### พฤติกรรมปัจจุบัน

withdrawConsent (consent.service.js:140-145) inserts driver_display_status = 'suspended' with reason = 'consent_withdrawn'. deriveDriverDisplayStatus (qrAccess.service.js:72-76) reads display_status and returns it. buildPublicView (L180-196) puts that value in the LEVEL 1 payload — the anonymous, no-login response served to anyone who scans the vehicle's QR sticker. The `reason` column, which is the only thing distinguishing 'withdrew consent' from an operator/disciplinary suspension, is not selected and not returned, so both cases render identically as 'ระงับ'.

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

A driver who exercises the ม.19(5) right to withdraw consent is publicly labelled 'ระงับ' to every member of the public who scans the bus, with no way for a viewer to tell that the label reflects a data-protection choice rather than a safety or conduct problem. That is a reputational consequence attached to exercising a statutory right, and it may make the consent non-free (ม.19 vrachta: consent must be freely given) — the driver's practical choice is 'consent, or be publicly marked as suspended'.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> Data controller / DPO must decide before FEATURE_VEHICLE_QR is turned on: (1) Is it lawful and proportionate under PDPA ม.19 for withdrawal of consent to produce a public 'ระงับ' label, given the driver's alternative is to keep consenting — i.e. is the consent freely given? (2) If the operator wants withdrawal to be possible without public stigma, should the level-1 view return a neutral value (e.g. omit driver_status entirely, or return 'not_disclosed') when reason='consent_withdrawn', reserving 'ระงับ' for operator/safety suspensions? (3) Should the driver be shown, in the withdrawal UI, exactly what the public will see afterwards?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only — do not apply. If the owner chooses to separate the two cases, select `reason` alongside `display_status` in qrAccess.deriveDriverDisplayStatus and map reason='consent_withdrawn' to a distinct, non-pejorative public value; keep 'suspended' for operator- and safety-driven suspensions. Note this must not weaken the existing suppression at qrAccess.js:201 — the driver's name and emergency contact must stay hidden in either case.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (minor)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

## LOGIC-013: No RPO or RTO is stated anywhere in the repository

- **Finding ID:** AUD-114
- **Process:** disaster-recovery-governance
- **Roles affected:** admin
- **Entity:** backup schedule, disaster recovery policy
- **Provisional severity:** minor
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Evidence:** `docs/OPERATOR_RUNBOOK.md:6-20 (schedule table; the absence is repo-wide)` — Scheduled jobs (cron) table

### พฤติกรรมปัจจุบัน

A repo-wide grep for RPO/RTO/recovery point objective/recovery time objective across all .md/.sh/.js/.json files returns only three incidental hits — docs/PRODUCTION-RECOVERY-2026-06-23.md line 222 ('RPO โดยประมาณ', an item in a post-incident report template), and two planning documents under docs/superpowers/ that ask a future incident report to record an RPO. No target is stated anywhere. What the artefacts imply: RPO is approximately 24 hours (one dump at 02:30, backup-db.sh line 26 keeps RETENTION_DAYS=7, health-check.sh line 29 tolerates BACKUP_MAX_AGE_HOURS=36 before failing). RTO is unknown, and cannot be estimated because no restore has been timed (see the restore-drill finding).

### Runtime ใช้กติกาใด

พฤติกรรมปัจจุบันตามที่ระบุข้างต้นคือสิ่งที่ระบบทำจริง

### ผลกระทบทางธุรกิจที่เป็นไปได้

Without a stated RPO there is no way to judge whether losing up to a day of attendance, pickup, GPS and import activity is acceptable, and no basis for deciding whether the 36-hour staleness tolerance in health-check.sh is right or dangerously loose. Without a stated RTO there is no yardstick for the missing automatic rollback in deploy-backend.sh or for how long an unrehearsed restore may take.

### คำถามที่ต้องให้เจ้าของระบบตอบ

> What is the maximum acceptable data loss (RPO) and maximum acceptable downtime (RTO) for this system? Specifically: is losing up to 24 hours of attendance, pickup, GPS and import activity acceptable, given the single daily 02:30 dump and the 7-day local retention? And what is the maximum tolerable outage before recovery must be complete?

### แนวทางที่ผู้ตรวจเสนอ (ยังไม่ดำเนินการ)

Describe only, not applied: have the owner state RPO and RTO in docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md, then reconcile backup-db.sh RETENTION_DAYS and health-check.sh BACKUP_MAX_AGE_HOURS against the agreed RPO, and time a restore drill to establish whether the RTO is achievable.

### Product Owner Decision

- [ ] Logic A ถูกต้อง (พฤติกรรมปัจจุบัน)
- [ ] Logic B ถูกต้อง (ตามที่ผู้ตรวจเสนอ)
- [ ] ต้องใช้ Logic ใหม่ (ระบุด้านล่าง)
- [ ] เป็นพฤติกรรมที่ตั้งใจไว้ ไม่ใช่ Defect
- [ ] ยืนยัน Severity เดิม (minor)
- [ ] เปลี่ยน Severity เป็น Critical
- [ ] เปลี่ยน Severity เป็น Major
- [ ] เปลี่ยน Severity เป็น Minor
- [ ] ยังไม่ตัดสินใจ

```
Final confirmed logic:

Reason / requirement reference:

Confirmed by:                         Confirmation date:
```

---

