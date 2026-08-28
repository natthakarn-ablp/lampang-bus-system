# Audit Coverage Manifest

ระบบรถรับส่งนักเรียนจังหวัดลำปาง · commit `9a64efc` · ตรวจ 27 ส.ค. 2569

เอกสารนี้ระบุว่าอะไรถูกตรวจจริง อะไรตรวจบางส่วน และอะไรตรวจไม่ได้
ไม่มีที่ใดในรายงานฉบับนี้ที่อ้างว่า "ตรวจโค้ดทั้งหมดแล้ว" — ขอบเขตที่แท้จริงอยู่ที่นี่

## 1. ปริมาณไฟล์ในที่เก็บ

| กลุ่ม | จำนวนไฟล์ (tracked) |
|---|---:|
| ทั้งหมด | 1,143 |
| Source `.js` / `.jsx` / `.mjs` | 411 |
| `backend/src/` | 91 |
| `frontend/src/` | 172 |
| `backend/tests/` | 98 |
| Migrations `.sql` | 42 |
| Scripts (ops + build) | 70 |
| Documentation `.md` | 165 |
| ภาพประกอบคู่มือ `.png` | 119 |
| Config / workflows | 8 |

## 2. วิธีตรวจ

ตรวจ 15 โดเมนคู่ขนาน แต่ละโดเมนมีผู้ตรวจอิสระที่ต้องอ้างไฟล์และเลขบรรทัดที่อ่านจริง
จากนั้นผลทั้งหมดผ่านรอบ **ตรวจทานแบบตั้งข้อสงสัย** (adversarial verification): ผู้ตรวจทาน
เปิดไฟล์ที่ถูกอ้างอิงอ่านซ้ำเอง แล้วตัดสินว่าหลักฐานยืนยันข้อกล่าวหาหรือไม่

ผลของรอบตรวจทาน:

| | ก่อน | หลัง |
|---|---:|---:|
| Critical | 3 | 4 |
| Major | 92 | 42 |
| Minor | 38 | 80 |
| ตัดออก (ซ้ำ) | — | 6 |
| หลักฐานไม่ผ่านการตรวจทาน | — | 2 |

การลด Major จาก 92 เหลือ 42 คือผลของการบังคับใช้เกณฑ์ตามโจทย์อย่างเคร่งครัด —
ข้อเสนอเชิง hardening ที่ไม่มีเส้นทางความล้มเหลวที่พิสูจน์ได้ถูกลดเป็น Minor

## 3. ครอบคลุมรายโดเมน

### Secret management and exposure

Read in full: .gitignore (all 40 lines), .env.example (root), backend/.env.example, backend/.env.test.example, frontend/.env.example, frontend/.env.production, docker-compose.yml, ecosystem.config.js, backend/src/config/env.js (all 229 lines), backend/src/routes/line.routes.js lines 1-110 and 525-560, backend/src/services/line.service.js lines 1-25, 775-815, 1155-1195, backend/src/routes/driver.routes.js lines 655-700, backend/src/app.js lines 80-115, scripts/backup.sh (all 83 lines), scripts/backup-db.sh (all 104 lines), scripts/offhost-backup-sync.env.example, scripts/offhost-backup-sync.sh (secret-handling lines), scripts/deploy-backend.sh, backend/scripts/seed-demo-users.js, backend/scripts/seed-production-uat-users.js, backend/scripts/seed-uat-override-fixture.js, backend/src/routes/affiliation.routes.js lines 400-470.

Commands actually run (read-only): `git ls-files` filtered for env/key/pem/sql/dump/log/credential patterns; `git log --all --diff-filter=A --name-only --pretty=format: | sort -u` then `comm -23` against `git ls-files` to isolate files added-then-removed; `git check-ignore -v` probes for backend/.env, .env, frontend/.env, .env.production, .env.local, .env.bak, .env.save, dump.sql, *.sql.gz, backend/backup.log, id_rsa, server.pem, scripts/offhost-backup-sync.env; `git status --porcelain --ignored=matching` for stray artefacts; regex sweeps across backend/src, frontend/src, scripts, docs for hardcoded credentials, `console.*` calls carrying secret-named values, `process.env.*(SECRET|TOKEN|PASSWORD|KEY)`, `JWT_SECRET ||` fallbacks, Google/Stripe key prefixes, and >=60-char base64 blobs.

VERIFIED CLEAN (positive results, stated so coverage is honest):

- NO secret file is tracked right now. The only tracked env files are *.example templates plus frontend/.env.production, which contains one value: VITE_LIFF_ID (a public LINE client identifier that is baked into the JS bundle by design and is documented as such in that file's own header).

- Git HISTORY is clean. The only files ever added and later removed are docs/CLAUDE.md, docs/CLAUDE.pdf, docs/student_import_template_th.csv and four frontend .jsx/.js files. No .env, .pem, .key, dump, or backup artefact has ever been committed, so NO history-only secret exists and NO rotation is required on that account.

- No hardcoded credential, connection string, API key, or high-entropy token in backend/src or frontend/src. `JWT_SECRET ||` fallback: zero hits. The `TempPass1` string at backend/src/routes/affiliation.routes.js:441 is a sample row in a generated .xlsx import template, not a credential.

- No secret is written to logs. LINE group id is truncated before logging (line.service.js:785 `groupId.slice(0, 8) + '...'`); seed-production-uat-users.js explicitly does not print passwords and writes its credentials file with `{ mode: 0o600 }` into ../../outputs/ which is gitignored (.gitignore:33 `/outputs/`).

- LINE inbound secret handling is correct: backend/src/routes/line.routes.js:20-33 fails closed in production and uses `crypto.timingSafeEqual`; CRON_API_KEY guard at line.routes.js:533-546 returns 503 in production when unset and uses constant-time compare.

- env.js fail-closed behaviour for DB_*/JWT_SECRET is real, not just declared: env.js:89-92 collects missing vars and env.js:81-87 does `console.error` + `process.exit(1)`, invoked at load time by env.js:118-119 for every non-test NODE_ENV. There is no insecure default for JWT_SECRET or DB_PASSWORD.

- scripts/backup-db.sh (the script the operator runbook schedules at 02:30, docs/OPERATOR_RUNBOOK.md:13), scripts/restore.sh, scripts/restore-drill-db.sh and scripts/reset-operational-data.sh all stage the MySQL password in a mode-600 `--defaults-extra-file`, never on the command line. scripts/offhost-backup-sync.sh:123 has `--exclude=".env*"` so nothing secret crosses the wire.

COULD NOT EXAMINE: the production host (no SSH from this audit), so no live file mode, no live crontab, no live backend/.env, no git remote visibility setting.

**ตรวจไม่ได้ในโดเมนนี้: 8 รายการ** (ดูหมวด 4)

### SQL safety and query correctness

READ-ONLY. No files were written to the repo. Working root: D:/Projects/lampang-bus-system-uiredesign/backend.

SQL-injection sweep (the primary task) — I enumerated EVERY dynamic SQL construction site, not a sample:

- Grepped all of src/routes/*.js (21 files), src/services/*.js (39 files), src/utils/, src/middleware/, src/config/ and scripts/ for `${` appearing inside SELECT/INSERT/UPDATE/DELETE/WHERE/FROM/ORDER BY/LIMIT/JOIN text, and separately for string `+` concatenation into query text (zero hits for `+`).

- Then opened and read every hit in context and traced the interpolated value back to its origin. Files read in full or in the relevant region: routes/admin.routes.js, routes/school.routes.js, routes/affiliation.routes.js, routes/province.routes.js, routes/transport.routes.js, routes/driver.routes.js, routes/auth.routes.js, routes/report.routes.js, routes/geofence.routes.js, routes/routeDeviation.routes.js; services/school.service.js, affiliation.service.js, province.service.js, report.service.js, transport.service.js, pickupPoint.service.js, checkin.service.js, leave.service.js, eta.service.js, geofence.service.js, routeDeviation.service.js, vehicleLocation.service.js, vehicleAdmin.service.js, vehicleVerification.service.js, vehicleRegistration.service.js, vehicleRequest.service.js, studentTransfer.service.js, studentImportPreview.service.js, affiliationAdmin.service.js, driverDocuments.service.js, driverShift.service.js, line.service.js (query regions), rosterRequest.service.js; utils/gradeScope.js; config/database.js; scripts/cleanup-old-logs.js, scripts/dispatch-notifications.js.

RESULT — no SQL injection found. Every interpolation falls into one of these provably-safe classes, each of which I verified by reading the assignment:

1. ORDER BY column: only 3 sites (school.service.js:248, affiliation.service.js:283, province.service.js:441) and all 3 are guarded by an explicit allow-list immediately above, e.g. school.service.js:184-186 `const allowedSorts = ['id','first_name','last_name','grade','classroom','vehicle_id']; const sortCol = allowedSorts.includes(sort) ? sort : 'first_name'; const sortDir = order === 'desc' ? 'DESC' : 'ASC';`.

2. Table/column identifiers: always a two-branch ternary over hard-coded literals (driverDocuments.service.js:206-212 `kind === 'driver' ? 'driver_documents' : 'vehicle_documents'`) or iteration over module-level constant arrays (vehicleAdmin.service.js REPOINT_SIMPLE / TRANSIENT_DELETE, cleanup-old-logs.js table config).

3. SET clauses: built by pushing hard-coded `'col = ?'` strings from server-side allow-lists (admin.routes.js:177-195, school.routes.js:1160-1173, geofence.routes.js:174-179, pickupPoint.service.js:235-247, vehicleAdmin.service.js:188-200). Values always bound.

4. WHERE fragments: constant strings chosen by an `if`, with every value pushed as a `?` param (report.service.js buildScopeFilter:9-40, transport.service.js:110-145, all `statusSql`/`gradeAnd`/`sessionFilter` helpers).

5. `${DB_TIMEZONE}` in config/database.js:39 is a module-level constant `'+07:00'` — hard-coded, not reportable.

6. SAVEPOINT names in checkin.service.js:566/625 interpolate `studentId`, but that value comes from a prior `SELECT s.id FROM students` result (an INT column), never from the request.

Also confirmed: no `.execute()` anywhere (so mysql2 array expansion for `IN (?)` works), `multipleStatements` is not enabled in config/database.js, and every `IN (?)` site has an empty-array guard before it.

Pagination: LIMIT/OFFSET are bound parameters everywhere, and per_page is clamped (`Math.min(100, Math.max(1, parseInt(...)))`) in admin/affiliation/province/school/transport routes and inside pickupPoint.service.js:145-147 and studentImportPreview.service.js:628. One unclamped exception found (reported below).

Sensitive-column check: no `SELECT *` over `users`; `password_hash` is selected only in auth.routes.js:138/264 and driver.routes.js:889 for bcrypt.compare and is never placed in a response body (login response at auth.routes.js:199-215 enumerates fields explicitly).

**ตรวจไม่ได้ในโดเมนนี้: 6 รายการ** (ดูหมวด 4)

### Authentication

READ ONLY — no file was modified, nothing was run against a DB or server.

Read in full: backend/src/middleware/auth.js (118 L), backend/src/middleware/optionalAuth.js, backend/src/middleware/roleGuard.js, backend/src/middleware/rateLimiters.js, backend/src/middleware/errorHandler.js, backend/src/routes/auth.routes.js (422 L), backend/src/config/env.js (229 L), backend/src/config/database.js, backend/src/app.js (218 L), backend/src/utils/passwordPolicy.js, backend/src/utils/audit.js, backend/src/services/lineIdToken.service.js, ecosystem.config.js.

There is NO backend/src/services/auth*.js in this repo — all authentication logic lives in the route file and the two middlewares. Also read the password-touching code they lead to: backend/src/routes/admin.routes.js (lines 1-260, user create / update / reset-password), backend/src/routes/school.routes.js (1060-1110 vehicle+driver onboarding, 1860-1975 teacher accounts), backend/src/routes/driver.routes.js (880-920 change-password), backend/src/services/driverProfile.service.js, backend/src/services/affiliationAdmin.service.js (30-230), backend/src/routes/parent.routes.js (LINE LIFF auth path), backend/src/routes/visits.routes.js, backend/src/index.js (1-60). Schema: backend/migrations/001_initial_schema.sql (users, revoked_tokens), 011_password_changed_at.sql, 043_password_changed_at_backfill.sql. Frontend client side of the token lifecycle: frontend/src/api/axios.js, frontend/src/hooks/useAuth.jsx, frontend/src/pages/ChangePassword.jsx.

Verified WORKING (no finding raised, checked by reading the code, not by executing it):

- JWT secret: no default/fallback anywhere. env.js:89-96 hard-fails on a missing JWT_SECRET and on length < 32, and process.exit(1) runs at module load for non-test (env.js:118-120). index.js requires env at boot, so a missing secret cannot boot the app.

- Algorithm pinned to HS256 on all three verify sites (middleware/auth.js:45, middleware/optionalAuth.js:28, routes/auth.routes.js:109) — alg:none / alg-confusion is closed.

- Refresh tokens presented as access tokens are rejected (middleware/auth.js:48-50).

- Disabled/deleted account: middleware/auth.js:70-81 re-queries `is_active`/`is_deleted` on EVERY authenticated request, so an existing token dies immediately. This is genuinely present — the usual "token outlives the disable" gap does NOT exist here.

- must_change_password: enforced server-side against the FRESH DB value (middleware/auth.js:95-110) with a 3-path allowlist. Going straight to the API does NOT bypass it; I could not construct a path that normalizes into the allowlist while routing elsewhere. Not executed, so read-level confidence only.

- bcrypt cost is 12 on every hash site (auth.routes.js:18, admin.routes.js:25, school.routes.js:1862, driver.routes.js:901, affiliationAdmin.service.js, driverProfile.service.js:20). No path anywhere compares a plaintext password — every comparison is bcrypt.compare.

- Login error messages are identical for user-not-found, disabled, and wrong-password (auth.routes.js:155/169/178), with a dummy bcrypt compare on both short-circuit branches to equalise timing.

- Role/scope change invalidates existing tokens by bumping password_changed_at (admin.routes.js:186-190).

- Timezone skew on the password_changed_at guard: NOT a bug — database.js pins both the mysql2 `timezone` and the session `time_zone` to +07:00, so the Date returned is the correct absolute instant.

- LINE LIFF parent identity is verified server-side against api.line.me with an aud check; `line_user_id` from the body is never trusted (parent.routes.js:70-95, lineIdToken.service.js).

**ตรวจไม่ได้ในโดเมนนี้: 8 รายการ** (ดูหมวด 4)

### Authorization and multi-tenant scope isolation

READ (full or in the cited ranges), all paths relative to repo root:

Middleware: backend/src/middleware/auth.js (all 118 lines), roleGuard.js (all 46), optionalAuth.js (all 67); backend/src/app.js (all 218) for mount order + feature flags.

Route files — endpoints whose handler body I actually read (66 endpoints, every role covered):

- backend/src/routes/school.routes.js (role school+admin, guard at line 157): /dashboard(163), /no-show(182), /students(193), /vehicles(220), /status-today(236), /pickup-points GET(257), /pickup-vehicles(279), /pickup-students(297), /pickup-points POST(329)/DELETE(389), /pickup-points/:id/assignable-students(420), /pickup-points/:id/students PUT(448), /emergencies(497), /missing(515), /leaves(553), /leave POST(566), /leaves/:id DELETE(589), /checkin-override(605), /roster-requests(659), /roster-requests/:id PUT(674), /students/:id PUT(691), /students/move(864), /students/:id DELETE(898), /students/:id/restore(937), /vehicles/:id PUT(1142), /audit-logs(1196), /students/import/batches(1639), /students/import/:batchId(1649), /students/import/preview(1664), /students/import/:batchId/apply(1688)+/report(1722)+/rollback(1734), /students/transfer-requests(1762), /students/transfer-requests/:id/cancel(1770), /students/:studentId/transfer-request(1778), /vehicles/requests x4(1792-1810), /live-vehicles(1825), /teacher-accounts GET(1865)/POST(1886)/:id/reset-password(1933)/:id DELETE(1983), /checkin/:logId/void(2022). Scope resolvers resolveSchoolId(44-47), resolveGradeScope(68-74), requireFullSchoolScope(87-97).

- backend/src/routes/affiliation.routes.js (guard 161, resolveAffiliationId 163-166): /dashboard, /schools, /students, /vehicles, /status-today, /emergencies, /vehicles-at-risk, /missing, /school-accounts x4, /notify-school(628), /live-vehicles(661), /pickup-map(682), /transfer-requests x4(730-779), /vehicle-requests x4(782-826).

- backend/src/routes/transport.routes.js (all 324 lines, guard 14): all 14 endpoints.

- backend/src/routes/province.routes.js (guard 35; read 180-299 + endpoint list).

- backend/src/routes/report.routes.js lines 1-230 (guard 14, extractFilters 43-57).

- backend/src/routes/driver.routes.js (guard 87): /authorized-vehicles, /active-shift, /shifts/start, /shifts/:id/end, /roster, /pickup-points GET/POST/DELETE, /pickup-points/:id/assignable-students, /pickup-points/:id/students, /pickup-students, /profile GET/PUT, /profile/photo, /change-password, /leave POST, /leave/:id, /leaves, /search-students, /schools, /roster-request, /roster-requests, /vehicle-location DELETE, /applications POST/GET/:id, /checkin/:logId/void.

- backend/src/routes/verification.routes.js (all 319 lines), registration.routes.js (all 293), documents.routes.js (all 88), qr.routes.js (all 76), visits.routes.js (all 44), eta.routes.js (all 131), geofence.routes.js lines 30-100, parent.routes.js lines 1-175, line.routes.js lines 520-559, auth.routes.js token builder 70-100 + 136-150 + 340-389, admin.routes.js lines 1-40 (file-level requireRole('admin') at line 32 verified; individual admin handlers only spot-checked).

Services read for the SQL scope predicate: report.service.js (buildScopeFilter 9-41, getDailyReport, getExportRows 402-430, getPolicyReport 436-442), affiliation.service.js getStudents/getVehicles (235-320), school.service.js getStudents (184-228), leave.service.js (all 166), checkin.service.js (getDriverVehicle 65-135, _buildCheckinTransaction 309-462, getNoShowStudents 879-899, voidCheckin header 901-924), pickupPoint.service.js (getStudentsForSchoolAndVehicle 371-391, validators), driverDocuments.service.js (schoolOwnsVehicle 76-92, schoolOwnsDriver 95-107, softDeleteDocument 276-300, loadVehicleDoc 311-339, loadDriverDoc 341-374, resolveDocumentForViewer 380-393), vehicleVerification.service.js (createApplication 235-335, getApplication 423-455, createDriverApplication 994-1060, audit payloads), qrAccess.service.js (STAFF_ROLES 12, resolveAccessLevel 162-168, buildStaffView 212-256), vehicleLocation.service.js listForSchool (195-215), rosterRequest.service.js (185-205), utils/gradeScope.js (40-67).

Frontend (only to establish reachability): frontend/src/components/Sidebar.jsx lines 40-58 and 145-186.

COULD NOT COVER: admin.routes.js (1604 lines) beyond the file-level guard and a grep of its role checks; line.routes.js webhook signature path; the ~40 service files not listed; all migrations; every admin.service/province.service query body.

**ตรวจไม่ได้ในโดเมนนี้: 9 รายการ** (ดูหมวด 4)

### Database schema and migrations

READ ONLY — no file was written or modified.

Read in full: backend/migrations/001_initial_schema.sql (493 lines, all 23 sections incl. the 5 deferred ALTER TABLE FKs and the MySQL EVENT), 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048. Read headers/comments only for 019 and 020 (pure idempotent INSERT ... ON DUPLICATE KEY UPDATE data seeds for affiliations AFF001-AFF005; no schema change, no DELETE). Read backend/migrations/legacy-drift-baseline.json (contents: `{}`).

NOTE ON ORDERING: the directory contains 42 .sql files but numbering is 001, then 008-048. Files 002-007 do not exist in the repo. So the migration set cannot rebuild the database from zero by replaying files in order.

Read in full: backend/scripts/validate-migration-baseline.js, backend/scripts/migration-status.js, backend/scripts/prepare-test-db.js, backend/scripts/cleanup-old-logs.js (lines 20-80), backend/scripts/dispatch-notifications.js (lines 30-60), backend/scripts/migrate-from-excel.js (lines 255-285).

Read backend/tests/schema.sql (1200+ lines, the mysqldump that is the ONLY source used to build the test database) — enumerated all 47 dumped tables plus 6 hand-appended CREATE TABLE IF NOT EXISTS blocks from migration 040/041, and inspected the full DDL of checkin_logs, daily_status, students, parents, parent_student, notifications, driver_vehicle_assignments, vehicles, roster_change_requests, student_transfer_requests, vehicle_requests, users.

Read backend/src/config/database.js in full, docker-compose.yml, ecosystem.config.js, backend/package.json.

Cross-checked schema claims against caller code: backend/src/services/checkin.service.js (lines 300-475, 875-900), studentImportPreview.service.js (280-320, 470-500), geofence.service.js (355-450), driverProfile.service.js (75-110), driverLifecycle.service.js (95-130), eta.service.js (185-235), affiliation.service.js (45-70), backend/src/routes/geofence.routes.js (35-60), backend/src/middleware/auth.js + routes/auth.routes.js (password_changed_at guard lines only).

CHECKED AND FOUND CLEAN (reporting as negative results, not findings):

- ON DELETE CASCADE: grepped every migration file AND the full dump. Exactly ONE cascade exists in the entire schema — geofence_events.geofence_id -> geofences(id) ON DELETE CASCADE (040_intelligent_tracking.sql:119), on config data, not student or attendance data. NO cascade touches students, checkin_logs, daily_status, parent_student, student_leaves, or any attendance history. Migration 040:45-51 documents an explicit RESTRICT policy. Attendance history cannot be cascade-wiped.

- Destructive DDL: I found no DROP TABLE, no DROP COLUMN, and no narrowing type change across all 42 files. The only two DROP statements are DROP INDEX (024:44 replacing a non-unique index with a UNIQUE one, and 039:9 — see finding 6). Widening changes only (027:21 ENUM->VARCHAR(30) on an empty table; 009:7 NOT NULL->NULL; 017:32 and 040:208 append ENUM values at the end). No data-losing migration found.

- Timezone: the pool pins `SET time_zone = '+07:00'` per connection (config/database.js:16, 38-40) and docker-compose passes `--default-time-zone=+07:00`, so CURDATE()/NOW() in checkin.service.js agree with the JS-computed Bangkok date. The historical bug described in the comment is genuinely fixed. Charset/collation is consistently utf8mb4/utf8mb4_unicode_ci on every CREATE TABLE in every migration and in the dump.

- parent_student: I suspected a missing index on student_id (the per-check-in notification resolver filters `ps.student_id = ?` and the PK is (parent_id, student_id)). The dump shows `KEY fk_ps_student (student_id)` exists. Not a finding.

- Soft-delete read paths: sampled the check-in, ETA, no-show, and affiliation dashboard queries. All correctly filter s.is_deleted = FALSE. The only unfiltered students join I located is geofence.service.js:411/416, used solely to pick a center coordinate for a default geofence — cosmetic, not reported.

COULD NOT EXAMINE: no MySQL server was reachable from this environment, so every claim below is derived from the migration DDL, the committed mysqldump, and the caller code — not from a live SHOW CREATE TABLE.

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### API input validation, error handling, and response hygiene

READ ONLY — no file was modified, no command with side effects was run, nothing was written anywhere.

Read in full: backend/src/app.js, backend/src/middleware/errorHandler.js, backend/src/middleware/auth.js, backend/src/middleware/roleGuard.js, backend/src/middleware/rateLimiters.js, backend/src/config/database.js, backend/src/utils/response.js, backend/src/utils/exportSecurity.js, backend/src/utils/csv.js, backend/src/utils/fileType.js, backend/src/utils/audit.js, backend/src/routes/documents.routes.js, backend/src/routes/consent.routes.js, backend/src/routes/qr.routes.js, backend/src/routes/visits.routes.js, backend/src/routes/readiness.routes.js, backend/src/routes/geofence.routes.js, backend/package.json.

Read in relevant part: backend/src/routes/admin.routes.js (1-60, 60-300, 330-520, 520-600, 930-1215), backend/src/routes/school.routes.js (95-160, 605-880, 1347-1420), backend/src/routes/driver.routes.js (60-120, 431-600, 754-960, 1146-1252), backend/src/routes/affiliation.routes.js (20-70, 478-545), backend/src/routes/transport.routes.js (1-140, 205-324), backend/src/routes/verification.routes.js (25-320), backend/src/routes/registration.routes.js (10-180), backend/src/routes/report.routes.js (1-60, 200-340, 440-560, 640-668), backend/src/routes/parent.routes.js (1-140), backend/src/routes/line.routes.js (55-140, 520-559), backend/src/services/{checkin,driverDocuments,pickupPoint,transport,vehicleVerification,studentImportPreview,admin,province}.service.js (targeted functions), backend/migrations/001_initial_schema.sql and 040_intelligent_tracking.sql (column types).

Write endpoints sampled (>20, ~55 total): admin POST/PUT/DELETE /users, /users/:id/reset-password, /users/:id/restore, /pickup-points (+/:id, /:id/students x3); affiliation POST /school-accounts/import/preview and /commit; auth POST /login, /change-password, /refresh-token, /logout; consent POST /parent, /parent/withdraw, /, /withdraw; driver POST /checkin, /checkout, /checkin-all, /checkout-all, /emergency, /change-password, /leave, /vehicle-location, /profile/photo, PUT /profile, DELETE /leave/:id, DELETE /vehicle-location; geofence POST /, PUT /:id, DELETE /:id, POST /seed-defaults; line POST /webhook, /process-notifications; qr POST /vehicle/:id/token, /revoke; registration POST /students, /documents/vehicle, /documents/driver, DELETE /documents/:kind/:id, school-side review/match/approve/reject; report POST /decision-log; school POST /checkin-override, /students/import, /vehicles, /students/move, PUT /students/:id, PUT /roster-requests/:id, DELETE /students/:id; transport POST /vehicles, /inspections, PUT /inspections/:id, DELETE /inspections/:id; verification POST /school/applications, /applications/:id/ready, /cancel, /review, /transport/applications/:id/start, /transport/attempts/:id/finalize, /transport/documents/:kind/:id/review; visits POST /track.

VERIFIED-GOOD (checked, found no defect — reporting so coverage is honest, not claiming a pass I could not execute):

- CSV/Excel formula injection: backend/src/utils/exportSecurity.js:17 `DANGEROUS_PREFIX = /^[=+\-@\t\r]/` and `csvCell`/`neutralizeSpreadsheetCell` ARE applied on every CSV export path I read — report.routes.js:222-234 and :479, school.routes.js:135-152 (auditRowsToCsv), admin.routes.js:568-576 and :1049-1055, affiliation.routes.js:589, province.routes.js:213. The only raw sink is admin.routes.js:1160/1174 (`for (const r of result.audit_logs) ws.addRow(r);`) in the XLSX branch, but ExcelJS writes those as string cells (type 's'), not formula cells, so Excel does not evaluate them — I could not construct a working exploit and am NOT reporting it as a vulnerability.

- Pagination caps: every list endpoint I checked clamps — `Math.min(100, Math.max(1, parseInt(req.query.per_page,10)||N))` at admin.routes.js:39,545,1519; school.routes.js:200,503,1202; affiliation.routes.js:209,260,551; province.routes.js:65,80,178,190; transport.routes.js:146,163,180,203; geofence.routes.js:41 and routeDeviation.routes.js:31 cap at 500. Raw `req.query.limit` passed to services is re-clamped inside them (admin.service.js:23,59; province.service.js:611; studentImportPreview.service.js:628). No uncapped list endpoint found.

- SQL injection: mysql2 placeholders everywhere I read; no string-concatenated user values into SQL. Dynamic `SET`/`WHERE` fragments (admin.routes.js:201, geofence.routes.js:228, driver.routes.js:783, school.routes.js:747) are built from hard-coded allow-lists of column names, not from request keys. `multipleStatements` is not enabled (config/database.js:18-33).

- Path traversal on uploads: on-disk names are server-generated; only `path.extname()` of the client name is reused (school.routes.js:105, driver.routes.js:75, affiliation.routes.js:33, registration.routes.js:27). Serving is gated by `safeResolveStorageKey` (driverDocuments.service.js:59-70) plus the /uploads 404 wall (app.js:78-80). No traversal found.

- Upload type gating: extension allow-list + magic-byte sniff with unlink-on-reject (fileType.js; driver.routes.js:849-859; registration.routes.js:59-68; school.routes.js:1357-1365; affiliation.routes.js:56-68). Size caps 2MB/5MB present.

- Stack traces: errorHandler.js:41 returns 'Internal server error' in production and never serializes `err.stack`. No stack leak found.

- 404-vs-403 existence leaks: cross-tenant misses return 404 with a neutral message (e.g. school.routes.js:708 'ไม่พบนักเรียนในโรงเรียนนี้'), which is the safe direction. No leak found.

COULD NOT VERIFY: nothing was executed — no server was started, no request was sent, no DB was queried. All findings below are from source reading only.

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### Frontend routing, role gating, and UI-vs-API rule agreement

READ ONLY — no files written or modified.

Frontend (D:/Projects/lampang-bus-system-uiredesign/frontend/src): App.jsx (full route table + PrivateRoute + RootRedirect, 431 lines), components/Sidebar.jsx (full, incl. NAV_MAP, FLAG_GATED, TEACHER_BLOCKED_PATHS), components/MobileBottomNav.jsx (full), components/Layout.jsx (grepped for guards — none), components/ExportButtons.jsx (full), hooks/useAuth.jsx (full), api/axios.js (full, both interceptors), utils/authScope.js (full), utils/session.js (full), pages/Login.jsx (auth logic), pages/ChangePassword.jsx (submit path), pages/reports/ReportsLayout.jsx (full), pages/reports/DailyReport.jsx (export wiring), pages/admin/AdminGeofences.jsx (load path), pages/driver/DriverShift.jsx (head + grep for feature checks), and API-call greps across pages/admin/*, pages/driver/*, pages/school/*, pages/province/*.

Backend (backend/src): app.js (router mounts + production SPA fallback), middleware/auth.js (full), middleware/roleGuard.js (full), config/env.js (features block), routes/auth.routes.js (login response + /me), routes/school.routes.js (head + full requireRole/requireFullSchoolScope route map), routes/report.routes.js (route map + policy), routes/driver.routes.js (shift section + applications), routes/verification.routes.js (scope helpers + doc feature gate), routes/parent.routes.js (auth mechanism, grepped), routes/visits.routes.js, routes/terms.routes.js, services/report.service.js (buildScopeFilter, getDailyReport, getExportRows, getPolicyReport), services/school.service.js (gradeFilter, grepped). requireRole(...) enumerated across all 21 route files.

Could NOT examine / verify by execution: no running server, no DB, no browser — every conclusion is by code reading, not by issuing a request. No nginx/reverse-proxy config exists in the repo (only ops/systemd and ecosystem.config.js), so I could not rule out an external proxy altering /api 404 behavior in the real deployment.

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### Data integrity — transactions, races, and multi-step writes

Read in full or in the relevant ranges: backend/src/config/database.js (pool config; connectionLimit 10, session TZ +07:00); backend/src/utils/audit.js (whole file); backend/src/services/rosterRequest.service.js (1-400), studentTransfer.service.js (1-200), studentImportPreview.service.js (structural outline of every write + 291-330, 374-400, 396-560, 570-603, 696-745), checkin.service.js (65-120, 309-470, structural outline of 470-1065), leave.service.js (whole file), line.service.js (write outline + 446-460, 1271-1330), geofence.service.js (20-60, 96-200), vehicleLocation.service.js (1-130), vehicleRegistration.service.js (46-250, 300-400), vehicleRequest.service.js (21-176), driverProfile.service.js (whole file), driverLifecycle.service.js (80-160), driverShift.service.js (write/lock outline); backend/src/routes/school.routes.js (691-935, 1036-1130, write/route outline of the whole file), driver.routes.js (55-72, 1146-1240), auth.routes.js (write outline). Migrations read: 001_initial_schema.sql (students, parent_student, checkin_logs, audit_logs, driver_vehicle_assignments DDL), 008_phase8_leaves_requests.sql (full), 030_vehicle_canonical_identity.sql (unique key), 038_shared_vehicle_verification.sql (active_request_key), 039_driver_pool_and_shifts.sql (1-100), 040_intelligent_tracking.sql (200-215). I ran a static scan over all of backend/src for functions containing writes to >=2 distinct tables with no beginTransaction in the same function body, and a per-file tally of write statements vs beginTransaction calls, to make sure I did not miss a non-transactional multi-table write. NOT examined: frontend/, backend/tests/ (if any), the remaining ~34 migrations, admin.routes.js/affiliation.routes.js/province.routes.js beyond their write outlines, pickupPoint.service.js and vehicleVerification.service.js beyond their outlines (both are transaction-heavy and I did not read their bodies line by line). I did not execute anything — no DB, no server, no tests were run; every finding is static code + DDL reading.

**ตรวจไม่ได้ในโดเมนนี้: 9 รายการ** (ดูหมวด 4)

### Application-edge security controls

READ-ONLY. No file written or edited; nothing executed against a live system.

Read in full: backend/src/app.js (219 lines), backend/src/index.js, backend/src/config/env.js, backend/src/config/database.js, backend/src/middleware/{auth,optionalAuth,errorHandler,rateLimiters}.js, backend/src/utils/{response,health}.js, backend/src/services/{lineIdToken,operationsAlert}.service.js, backend/src/routes/visits.routes.js, backend/src/routes/qr.routes.js, backend/src/routes/consent.routes.js (1-70), backend/src/routes/line.routes.js (1-150 + the /process-notifications guard 528-547), backend/src/routes/auth.routes.js (1-180 + full route inventory), backend/src/routes/parent.routes.js (1-90), backend/src/routes/driver.routes.js (55-90, 1144-1150), frontend/index.html, frontend/vite.config.js, frontend/src/components/LiveVehicleMap.jsx (1-120), ecosystem.config.js, ops/systemd/*.service, scripts/health-smoke.sh (config head), docs/deployment-hardening.md.

Inspected installed deps: helmet 7.2.0, express 4.22.2, express-rate-limit 8.5.2, and helmet's DEFAULT_DIRECTIVES table in backend/node_modules/helmet/index.cjs.

Grepped all of backend/src for res.redirect (ZERO hits — no open-redirect surface), cookie/Cookie (ZERO hits except one comment — there is NO cookie auth path, so no CSRF token is required by this design), fetch/axios (only 2 call sites, both constant or env-supplied URLs — no user-controlled URL fetched, so NO SSRF located), and rateLimit across every route file.

CONTROLS I READ AND FOUND CORRECT (stated for honest coverage, not as findings):

- LINE webhook signature IS verified: line.routes.js:20-34 computes crypto.createHmac('sha256', secret).update(body).digest(), length-checks, then crypto.timingSafeEqual; line.routes.js:66 uses express.raw so the exact bytes are hashed, and app.js:63-67 skips express.json for that path. Failure returns 403 at line 78-81 BEFORE any event is processed.

- /api/line/process-notifications is guarded by a constant-time x-api-key compare (line.routes.js:40-45, 532-546) and fails closed with 503 in production.

- helmet() (app.js:46) is mounted before everything; helmet 7.2.0 defaults set CSP (default-src/script-src 'self'), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, X-DNS-Prefetch-Control. No header is explicitly disabled.

- Backend binds 127.0.0.1 by default (index.js:15) — the "0.0.0.0" row in docs/deployment-hardening.md:20 is stale.

- JWT alg is pinned to HS256 in auth.js:45 and optionalAuth.js:28; refresh tokens are rejected as access tokens.

- Multer has fileSize limits and extension filters at all four upload sites.

- CORS credentials are FALSE (app.js:61), so the dangerous "reflected origin + credentials" combination does NOT exist here.

COULD NOT EXECUTE: I did not run the server, send requests, or read the production nginx/Cloudflare config (no nginx conf exists in the repo) or backend/.env (absent locally — only .env.example). Findings that depend on those are marked configuration_risk / needs_owner_confirmation, never "confirmed".

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### Frontend correctness and UX quality — forms, state, and data fetching

Read in full: frontend/src/pages/school/ImportPreviewModal.jsx, ImportHistoryModal.jsx, StudentSearch.jsx, SchoolBulkVehicles.jsx (partial, lines 30-300 + 405-429); frontend/src/pages/driver/DriverDashboard.jsx (lines 1-520), StudentList.jsx, CheckinPanel.jsx; frontend/src/pages/transport/InspectionForm.jsx (full), VerificationQueue.jsx (lines 559-700 + form state); frontend/src/pages/admin/AdminDashboard.jsx (lines 1-175); frontend/src/components/ui/ConfirmDialog.jsx, DataTable.jsx, FormField.jsx; frontend/src/components/VehicleSelect.jsx, KpiCard.jsx, ErrorBoundary.jsx; frontend/src/utils/datetime.js; frontend/src/App.jsx (route table), components/Sidebar.jsx + MobileBottomNav.jsx (nav reachability). Cross-checked against backend: backend/src/routes/transport.routes.js (lines 196-270), backend/src/services/transport.service.js (createInspection/updateInspection), backend/src/utils/inspectionDates.js (full), backend/src/services/checkin.service.js (_buildCheckinTransaction, processCheckin), backend/src/services/studentImportPreview.service.js (listBatches/getBatchDetail/rollback), backend/src/services/vehicleRequest.service.js (dedupe), backend/src/services/vehicleVerification.service.js (startInspection), backend/src/routes/verification.routes.js, backend/src/routes/admin.routes.js (audit-log date filter), backend/src/config/database.js (session timezone). Ran a repo-wide regex scan of every .jsx for handler props referencing undeclared identifiers, and for index-as-key / date-formatting / toFixed patterns. NOT examined: pages/parent/*, pages/province/* (beyond AdminDashboard-equivalent patterns), pages/affiliation/*, pages/reports/* internals, map components, LIFF flows.

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### Server, hosting, deployment, and rollback

READ IN FULL: scripts/deploy-backend.sh (40 lines), scripts/backup-db.sh (104), scripts/backup.sh (83), scripts/restore.sh (99), scripts/restore-drill-db.sh (lines 1-90), scripts/offhost-backup-sync.sh (152), scripts/check-offhost-backup-config.sh (83), scripts/health-check.sh (155), ecosystem.config.js (35), docker-compose.yml (52), all 6 files in ops/systemd/ (schoolbus-health-{smoke,alert,heartbeat}.{service,timer}), .github/workflows/check-labels.yml and full-quality.yml, backend/jest.unit.config.js, backend/package.json scripts block, backend/src/index.js (HOST/listen/shutdown, lines 13-15 and 110-150), docs/OPERATOR_RUNBOOK.md (191 lines, full), docs/deployment-hardening.md (92, full), docs/production-launch-checklist.md (lines 55-200), docs/go-live-handoff.md (lines 40-50, 160-200, 255-275), docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md (lines 140-175), docs/READINESS_SCORECARD_2026-08.md (grep of restore/drill rows), docs/phase-9-ops-notes.md (lines 80-100, 435-470). DIRECTORY LISTINGS: scripts/ (47 files), ops/ (6 files), backend/migrations/ (48 .sql + legacy-drift-baseline.json), backend/scripts/ (19 files), outputs/ and output/ trees to depth 2. REPO-WIDE GREPS: RPO/RTO, rollback, cron/crontab, pm2 process names, /opt/lampang, .last_offhost_sync, offhost in monitors. NOT PRESENT IN REPO (verified by find over *.conf/nginx*/Dockerfile*/*.service/*.yml at depth 3): any nginx site config, any Dockerfile, any CD/deploy workflow, any schema down-migration, any executed restore-drill evidence pack under outputs/. NOT READ (time-boxed, low relevance to this domain): scripts/health-smoke.sh full body (only grepped for offhost), the ~20 evidence-pack generator/validator .js scripts, scripts/reset-operational-data.sh, scripts/prune-location-history.sh. NOTE: docs/ops-backup-restore.md is a git symlink (mode 120000 -> PRODUCTION-RECOVERY-2026-06-23.md) that this Windows checkout materialised as a 33-byte text file; several docs cite "ops-backup-restore.md §4/§7.3" section numbers that do not exist in the symlink target — I did not treat this as a defect since it is a checkout artefact, but the dangling section references are real.

**ตรวจไม่ได้ในโดเมนนี้: 16 รายการ** (ดูหมวด 4)

### GitHub repository hygiene and CI/CD

Read line by line: .github/workflows/check-labels.yml (all 32 lines), .github/workflows/full-quality.yml (all 73 lines), .gitignore (all 35 lines), .env.example (all 37 lines), backend/.env.example (all 110 lines), frontend/.env.example, frontend/.env.production, scripts/deploy-backend.sh (all 40 lines), scripts/restore.sh (head), backend/jest.unit.config.js, backend/package.json (scripts + jest keys), frontend/package.json (scripts), backend/scripts/validate-migration-baseline.js (lines 1-140 + tail), backend/scripts/prepare-test-db.js (lines 1-40), backend/migrations/legacy-drift-baseline.json (whole file, 4 bytes), .claude/settings.local.json (whole file). Enumerated tracked files with `git ls-files` (root-level files, symlink-mode 120000 entries, .github tree, .claude tree, lockfiles, env/secret/LICENSE/README/SECURITY/CONTRIBUTING/CODEOWNERS/dependabot name patterns), counted backend test files (93 total, 35 matching *.unit.test.js) and frontend test files (0), listed docs/ (60+ files), ops/systemd/, scripts/ (46 files). Grepped both workflows for `github.event`, `github.head_ref`, `pull_request_target`, and `secrets.` — zero matches, so there is no script-injection sink and no pull_request_target workflow in this repo; I state that as a verified negative, not a finding. There is NO README.md, LICENSE, SECURITY.md, CONTRIBUTING.md, CODEOWNERS, dependabot.yml, or issue/PR template tracked anywhere in the repo — .github contains exactly two files. I did NOT run npm audit, did not execute either workflow, did not contact GitHub's API, and did not inspect any server. Everything about GitHub-side settings (branch protection, required checks, GITHUB_TOKEN org/repo default permission setting, collaborators, 2FA, deploy keys, Actions secrets) is invisible from the filesystem and is listed under unable_to_verify.

**ตรวจไม่ได้ในโดเมนนี้: 13 รายการ** (ดูหมวด 4)

### Logging, audit trail, monitoring, and alerting

READ-ONLY. No file was modified, no command mutated state. Files read in full or in the cited ranges:

- backend/src/utils/audit.js (whole file), backend/src/utils/exportSecurity.js:40-140, backend/src/utils/health.js (whole file)

- backend/migrations/001_initial_schema.sql:395-415 (audit_logs DDL), 017_vehicle_locations.sql:28-35, 040_intelligent_tracking.sql:203-210, 047_log_archive_tables.sql (whole file)

- backend/src/app.js:40-140 (helmet/cors/uploads block//health), backend/src/index.js (whole file)

- backend/src/middleware/errorHandler.js (whole file); listed backend/src/middleware/ (auth.js, optionalAuth.js, rateLimiters.js, roleGuard.js — no request-logging middleware exists)

- backend/src/routes/admin.routes.js:35-310, 540-760, 897-1075, 1160-1220, 1428-1620 (+ a scripted pass over every route in the file to find handlers with no logAudit call)

- backend/src/routes/auth.routes.js:100-320; backend/src/routes/school.routes.js:1193-1264, 1268-1760 (route list); backend/src/routes/affiliation.routes.js:143-158, 360-395, 560-625; backend/src/routes/province.routes.js:17-30, 195-245; backend/src/routes/report.routes.js (logAudit call sites + route list)

- backend/src/services/affiliationAdmin.service.js:95-140, studentTransfer.service.js:35-80, studentImportPreview.service.js (logAudit call sites incl. rollback at 717), checkin.service.js:430-460

- backend/scripts/cleanup-old-logs.js (whole file), backend/scripts/seed-uat-override-fixture.js:28-38

- scripts/health-smoke.sh (whole file), scripts/health-smoke-alert.sh (whole file), scripts/health-check.sh:135-150, scripts/deploy-backend.sh, ecosystem.config.js (whole file)

- ops/systemd/ (all 6 unit files listed; schoolbus-health-alert.{service,timer} and schoolbus-health-smoke.timer read in full)

- backend/package.json:1-56 (dependency list — confirms no morgan, no Sentry/OpenTelemetry/any aggregation client)

- frontend/src/pages/admin/SystemHealth.jsx:45-47

- A scripted brace-matched parse of all 147 logAudit({...}) call sites under backend/src to measure ipAddress/userAgent coverage.

**ตรวจไม่ได้ในโดเมนนี้: 9 รายการ** (ดูหมวด 4)

### Personal data handling, PDPA exposure, and the LINE/LIFF parent channel

Read in full: backend/src/routes/parent.routes.js (340 L), backend/src/routes/line.routes.js (559 L), backend/src/routes/qr.routes.js (76 L), backend/src/routes/consent.routes.js (79 L), backend/src/middleware/optionalAuth.js (67 L), backend/src/services/lineIdToken.service.js (81 L), backend/src/services/qrAccess.service.js (270 L), backend/src/services/parentConsentGate.js (69 L), backend/src/services/consent.service.js (161 L), backend/src/config/consentText.js (122 L), backend/src/config/env.js (220 L), backend/src/app.js (218 L), backend/src/utils/exportSecurity.js (120 L), frontend/src/utils/liff.js (93 L), backend/migrations/035_consent_records.sql, backend/migrations/044_driver_registration_roster.sql, scripts/prune-location-history.sh, backend/scripts/cleanup-old-logs.js (head), ecosystem.config.js. Read in part: backend/src/services/line.service.js (bind/lookup/children/log/audit sections: L100-131, L237-264, L272-422, L1213-1256), backend/src/routes/school.routes.js (L134-157, L185-230, L691-830, L864-955, L1196-1300), backend/src/services/school.service.js (L180-265), backend/src/services/checkin.service.js (getRoster L218-275), backend/src/routes/report.routes.js (L1-80, L190-320), backend/src/routes/admin.routes.js (L556-615, L843-855), backend/src/routes/province.routes.js (L228-250), backend/src/routes/affiliation.routes.js (audit CSV/JSON refs), backend/src/services/eta.service.js (getForStudent L187-240), frontend/src/pages/parent/ParentStatus.jsx (L1-115 + grep of all API calls), frontend/src/App.jsx (route table), frontend/src/components/consent/*.jsx (grep of usage).

PROVEN NEGATIVE — identity fallback: I could NOT find any backend path that accepts a parent identity from a query parameter, header, or body. `grep -rn "line_user_id" backend/src/routes backend/src/middleware` returns only comments. Both parent guards (backend/src/routes/parent.routes.js:70-95 and backend/src/routes/consent.routes.js:16-29) and backend/src/middleware/optionalAuth.js:53-62 accept a token only from `Authorization: Bearer`, `?id_token=` or `body.id_token`, and every one of them routes it through lineIdToken.service.verifyIdToken, which POSTs to https://api.line.me/oauth2/v2.1/verify and uses LINE's returned `sub` (with an `aud` cross-check at qrAccess/lineIdToken L70-73). The `?line_user_id=` fallback in frontend/src/utils/liff.js:56-59 is FRONTEND-ONLY and is dead for the parent pages: ParentStatus.jsx:29-37 uses getLiffIdToken() and sends only the id_token. There is no stranger-reads-a-child bypass in this code.

PROVEN NEGATIVE — public QR fields: backend/src/services/qrAccess.service.js buildPublicView (L180-196) returns exactly: level, plate_no, vehicle_type, inspection_status, inspection_expired, last_inspection_date, inspection_expiry, eligibility_status, document_status{insurance,registration,compulsory_insurance,tax}, insurance_status, driver_status. No child name, no driver name, no phone, no pickup point, no coordinates. Driver name + emergency contact appear only at L2 (L198-209), which requires BOTH a verified LINE parent linked to a student on that vehicle AND a granted qr_parent_optin consent (resolveAccessLevel L162-168). Driver phone + risk history are L3-only, feature-flagged, and audited (L221-248).

COULD NOT EXECUTE: no DB, no running server — everything below is read from source, not exercised.

**ตรวจไม่ได้ในโดเมนนี้: 7 รายการ** (ดูหมวด 4)

### Test suite adequacy and code quality signals

READ-ONLY. I ran no tests, no DB commands, and wrote no files.

Harness/config read in full: backend/package.json (jest block + scripts), backend/jest.unit.config.js, backend/tests/loadTestEnv.js, backend/tests/setup.js, backend/tests/teardown.js, backend/tests/dbHelper.js, backend/src/utils/testDatabaseGuard.js, backend/scripts/prepare-test-db.js, backend/.env.test.example, .gitignore, .github/workflows/full-quality.yml, .github/workflows/check-labels.yml.

Test bodies read in full or substantially: crossSchoolIsolation.test.js, importRollback.test.js, securityHardening.test.js, corsSecurity.test.js, operationsHealth.test.js, studentImportScope.test.js, exportSecurity.test.js, schoolScope.unit.test.js, verificationRoutes.test.js, reportMonthlyExport.unit.test.js, adminEndpoints.unit.test.js, vehicleVerification.test.js, driverShift.test.js, driver.test.js, auth.test.js (lines 180-230).

Source cross-checked for claims: backend/src/utils/studentImport.js, backend/src/routes/school.routes.js:1498, backend/src/services/studentImportPreview.service.js:403, and requireRole placement in school/province/admin/transport/verification routes.

Mechanical survey across all 93 backend/tests/*.test.js: per-file test()/expect() counts, .skip/xit/todo, supertest/mysql2/dbHelper requires, readFileSync usage, toBe(403) assertions, commit/rollback assertions, logAudit references, admin/transport role usage.

Frontend: frontend/package.json plus recursive search of frontend/src for *.test.*, *.spec.*, __tests__ (zero hits). 169 .js/.jsx source files, 0 .ts/.tsx.

Dependency versions read from backend/package-lock.json (resolved) and frontend/package.json.

SCALE: 93 test files, 858 test/it blocks, 1959 expect() calls. 35 files match *.unit.test.js (DB-free unit suite), 58 require live MySQL, 27 use supertest.

HEADLINE ANSWER (school A vs school B): YES, such a test exists. backend/tests/crossSchoolIsolation.test.js seeds a real second school __TSCH2 with its own exclusive student (99798) and vehicle (V-testB0000001), logs in as school A (__test_school, scope __TSCH), and asserts across five endpoints that school B data never appears, including two explicit ?school_id=__TSCH2 spoof attempts. It is backed by the DB-free unit test schoolScope.unit.test.js proving resolveSchoolId ignores spoofed query/body school_id. Import-batch tenancy is separately covered by securityHardening.test.js (getReport/applyBatch 403) and importRollback.test.js (rollbackBatch 403, getBatchDetail 403). This is genuine, not theatre. It also runs in CI: .github/workflows/full-quality.yml runs npm run test:ci against a mysql:8.0 service container.

WHAT ELSE HAS REAL COVERAGE: login/JWT/refresh-revocation (auth.test.js, authSessionHardening.test.js, authInactiveUser.test.js); role enforcement at router level, and because school/province/affiliation/transport/admin routers all use a single router.use(authenticate, requireRole(...)), the /dashboard 403 tests do transitively cover every route on those routers; check-in/check-out (driver.test.js ~23 tests hitting real /api/driver/checkin, /checkout, /checkin-all, /emergency, plus lineNotificationResolver.test.js driving 9 real check-ins); student import + rollback (importRollback.test.js, importApplyModes.test.js, studentImportApplySafety.unit.test.js, plus 6 magic-byte/row-cap/zip-preflight unit files); vehicle verification eligibility (vehicleVerification.test.js pure computeEligibility + PII-stripping snapshot tests); password change (phase8b.test.js exercises the real bcrypt round-trip: wrong current password rejected, correct one changes it, then changes it back). Transaction integrity is genuinely asserted in 8 files via conn.rollback/conn.commit spies. No .skip/xit/test.todo anywhere except the two environment-gated ones in operationsHealth.test.js. Every one of the 93 files contains at least one expect().

DB SAFETY: the destructive-access guard (backend/src/utils/testDatabaseGuard.js:3-13) demands NODE_ENV=test AND DB_NAME exactly 'lampang_bus_test' AND ALLOW_TEST_DB_RESET=true, and is called in globalSetup, globalTeardown, every dbHelper connection/pool, and prepare-test-db.js. prepare-test-db.js:66 hardcodes the literal DROP DATABASE IF EXISTS `lampang_bus_test` rather than interpolating env. The integration path fails closed and cannot be aimed at production. The unit path is the exception (see finding 3).

**ตรวจไม่ได้ในโดเมนนี้: 8 รายการ** (ดูหมวด 4)

## 4. สิ่งที่ตรวจไม่ได้ และสิ่งที่ผู้ตรวจนำ (Lead) ปิดช่องได้เอง

ผู้ตรวจรายโดเมนอ่านได้เฉพาะไฟล์ในที่เก็บ จึงระบุว่าตรวจไม่ได้รวม **128 รายการ**
ผู้ตรวจนำมีสิทธิ์อ่านเซิร์ฟเวอร์จริงแบบ read-only จึงปิดช่องสำคัญได้บางส่วน:

### ปิดช่องได้แล้ว — ตรวจบนระบบจริง (อ่านอย่างเดียว)

| ประเด็นที่เคยระบุว่า Not Verified | ผลการตรวจจริง |
|---|---|
| JWT_SECRET เป็นค่า placeholder หรือไม่ | **ไม่ใช่** — 64 อักขระ 38 ชนิด เป็นค่าสุ่มจริง |
| migration 011/043 ลงจริงหรือไม่ | **ลงแล้ว** — คอลัมน์ `password_changed_at` มี และไม่มีแถวใดเป็น NULL |
| MySQL event scheduler เปิดหรือไม่ | **ON** — การตัด `revoked_tokens` ทำงาน (ปัจจุบัน 33 แถว) |
| ฐานข้อมูลเปิดสู่อินเทอร์เน็ตหรือไม่ | **ไม่** — MySQL ผูก `127.0.0.1` เท่านั้น |
| backend ผูกที่อยู่ใด | **127.0.0.1:3000** — เปิดสาธารณะเฉพาะพอร์ต 22/80/443 |
| แอปใช้บัญชี root หรือไม่ | **ไม่** — `schoolbus_db@localhost` มีสิทธิ์เฉพาะ 3 ฐานของแอป อ่าน `mysql.user` ไม่ได้ |
| backup ทำงานจริงหรือไม่ | **จริง** — cron 02:30 ทุกวัน มี `.sha256` ครบ retention 7 วัน |
| เคยซ้อมกู้คืนหรือไม่ | **เคย** — 26 ส.ค. 2569 กู้ได้ 58/58 ตาราง ใช้เวลา 4 วินาที |
| สำเนานอกเครื่องมีหรือไม่ | **มี** — rclone `copy` (ไม่ใช่ `sync`) ทุกวัน 02:50 ทำงานล่าสุด 27 ส.ค. |
| สิทธิ์ไฟล์ `.env` | **600** ทั้ง `backend/.env` และ `offhost-backup-sync.env` |
| จำนวนบัญชีที่ยังใช้รหัสเริ่มต้น | **423 จาก 797 (53.1%)** — เป็นหลักฐานของ AUD-001/002 |

### ยังตรวจไม่ได้ — ต้องมีสิทธิ์ที่ผู้ตรวจไม่มี

| ประเด็น | สิทธิ์ที่ต้องใช้ |
|---|---|
| Branch protection, required review, force-push protection | GitHub repository settings |
| ผู้มีสิทธิ์ในที่เก็บ, 2FA, deploy keys, PAT | GitHub organization settings |
| GitHub Actions secrets และ environment approval | GitHub settings |
| nginx config ฉบับเต็มและห่วงโซ่ `X-Forwarded-For` | ไฟล์ config ไม่อยู่ในที่เก็บ (อ่านได้บางส่วนเท่านั้น) |
| กฎ firewall (`iptables`/`ufw`) | ต้องใช้ sudo |
| อายุใบรับรอง SSL และการต่ออายุอัตโนมัติ | ต้องตรวจนอกที่เก็บ |
| Cloudflare: โหมด SSL, WAF, การตั้งค่า cache | Cloudflare dashboard |
| สิทธิ์ของ rclone remote (ลบไฟล์ปลายทางได้หรือไม่) | ผู้ให้บริการปลายทาง |
| การทำงานจริงของ LINE Official Account | LINE Developers console |
| ประสิทธิภาพภายใต้ภาระจริง | ต้องทดสอบโหลด ซึ่งเขียนข้อมูล |

รายการตรวจไม่ได้ทั้งหมด 128 ข้อ แยกตามโดเมน:

**Server, hosting, deployment, and rollback** (16)

- Host firewall / ufw state — whether inbound :3000 and :3306 are actually denied. docs/deployment-hardening.md line 21 itself marks this 🟡 UNKNOWN and its verification checklist items at lines 87 and 90 are unticked. Note: the code is SAFER than that doc claims — backend/src/index.js line 15 is `con
- Open ports and listening sockets (`ss -lntp`) — cannot confirm :3000/:3306 bindings or the absence of an :8080 Adminer listener. The ✅ marks at docs/deployment-hardening.md lines 88-89 are a point-in-time claim from a past audit, not evidence I gathered.
- TLS/SSL certificate validity and expiry, and certbot auto-renewal state for schoolbuslampang.com.
- DNS records for schoolbuslampang.com / www / schoolbus.lp-pao.go.th.
- Actual cron state — `crontab -l` on the production host. docs/OPERATOR_RUNBOOK.md line 8 dates its table to a 2026-08-25 snapshot and line 20 warns entries may be missing. I cannot confirm any of the seven scheduled jobs is currently installed, including the 02:30 backup and the 02:50 off-host sync,
- Whether the three systemd timers in ops/systemd/ are actually installed and enabled on the host — each unit file's header describes the install as a manual `sudo install` + `systemctl enable --now` step that may never have been performed.
- Whether `pm2 save` / `pm2 startup` has been run so PM2 resurrects the app after reboot — ecosystem.config.js lines 7-9 document it as a manual step; docs/go-live-handoff.md line 164 lists `systemctl is-active pm2-schoolbus` as an unticked go-live checkbox.
- Whether the pm2-logrotate module is installed. health-check.sh lines 143-149 treat a missing pm2-logrotate as emit_warn only, never emit_fail, and ecosystem.config.js lines 26-27 write to /home/schoolbus/logs/*.log with no rotation directive of its own — so unbounded PM2 log growth would not trip th
- Disk and inode headroom on / and on the backup volume.
- Whether any backup actually restores — no restore drill evidence exists in the repository (see the logic_conflict finding); scripts/restore-drill-db.sh has never demonstrably been run to completion.
- Whether the off-host backup destination is configured at all, and what retention it applies. scripts/offhost-backup-sync.env is gitignored and absent from the checkout, so OFFHOST_BACKUP_METHOD, the remote target and any remote retention policy are unknown. Note from the code: `rclone copy` (offhost
- Whether other local user accounts exist on the production host — this determines whether the backup.sh permission finding is major (as filed) or critical.
- File permissions actually in force on /home/schoolbus/backups/** and on backend/.env — I reasoned from what the scripts create, not from a live `stat`.
- Whether docs/OPERATOR_RUNBOOK.md line 79's statement still holds — i.e. whether lampang_bus_restore_drill has since been created on production.
- Whether the live nginx site file is still named schoolbus-503200 (the pre-domain-migration name that scripts/backup.sh line 72 targets) after the schoolbus.503200.xyz → schoolbuslampang.com move.
- Backend dependency vulnerability status — I did not run `npm audit` and make no claim about reachable dependency CVEs. Noted only as unexamined: backend/package.json line 34 pins multer ^1.4.5-lts.1, a 1.x line, and line 32 json2csv ^6.0.0-alpha.2, an alpha release.

**GitHub repository hygiene and CI/CD** (13)

- Branch protection rules on the default branch — whether any status check is required, whether 'Full Quality' and 'UI Label Standards Check' are required checks, whether force-push and direct push are blocked, whether reviews are required. Not visible from the filesystem. NOT VERIFIED. Note a related
- The repository/organisation default GITHUB_TOKEN permission setting ('Read and write' vs 'Read repository contents'). This determines the actual blast radius of finding #6 (check-labels.yml having no permissions block). NOT VERIFIED.
- Whether GitHub Actions is enabled at all for this repository, and whether fork-PR workflows require approval. NOT VERIFIED — I only read the workflow files; I have no evidence any run has ever executed.
- Collaborator and outside-collaborator lists, team permissions, and admin membership. NOT VERIFIED.
- Whether 2FA is enforced for the organisation or for accounts with push access. NOT VERIFIED.
- Deploy keys, machine accounts, and SSH keys authorised on the production host (/home/schoolbus) that scripts/deploy-backend.sh:14 relies on for `git pull`. NOT VERIFIED.
- Actions secrets and repository/environment variables — I confirmed neither workflow references `secrets.` (grep, zero matches), but I cannot see what secrets exist in repo settings or whether any environment has protection rules. NOT VERIFIED.
- GitHub-side Dependabot alerts / secret scanning / push protection / CodeQL default setup — these can be enabled in repo settings without any file in .github/, so the absence of config files does not prove they are off. NOT VERIFIED.
- Whether the 42 files in backend/migrations/ actually apply cleanly to an empty MySQL 8 database, and whether the resulting schema matches backend/tests/schema.sql. I did not execute any SQL (read-only audit, no DB access). This is the specific gap findings #1 and #2 describe, and confirming it needs
- Actual dependency vulnerability status — I did not run `npm audit` on either lockfile, so I make no claim about any specific CVE being present or reachable. NOT VERIFIED.
- Whether the workflows currently pass. I did not execute `npm ci`, the jest suites, `vite build`, or the two bespoke UI checkers. NOT VERIFIED — I am not asserting any of these steps is green.
- Whether scripts/deploy-backend.sh is the live production deploy path. It is invoked by no workflow, and grepping docs/uat-deployment-guide.md and docs/OPERATOR_RUNBOOK.md for `git pull` returned nothing, so the documented procedure may differ from this script. NOT VERIFIED — flagged as the owner_que
- Git history for leaked secrets — I checked only the tracked tree at commit 9a64efc. I did NOT scan historical commits or deleted blobs. Note the one tracked env file with a real value, frontend/.env.production, contains only VITE_LIFF_ID=[REDACTED], which the file's own header correctly doc

**Authorization and multi-tenant scope isolation** (9)

- Nothing was executed. No request was issued, no server started, no database queried, no test run. Every finding is from static reading of the cited lines; the reproduction steps are derived, not performed.
- backend/src/routes/admin.routes.js (1604 lines, 53 route registrations): I verified only that router.use(authenticate, requireRole('admin')) sits at line 32 before every route registration, and grepped its role checks. I did not read the individual admin handlers, so I cannot state whether admin-onl
- backend/src/routes/line.routes.js LINE webhook signature verification (verifySignature, lines 20-64) and the handleEvent/handlePostback command surface — read only the /process-notifications guard.
- Whether users.grade_scope is actually populated in production (the whole grade-scope finding class only bites for accounts created via POST /api/school/teacher-accounts or admin user management). Cannot inspect the live users table.
- Whether students.grade in production contains long-form variants ('ประถมศึกษาปีที่ 4'). The exact-match finding's real-world impact depends on that; the code comments and tests/gradeScopeCounts.test.js assert the variants exist, but I could not query the data.
- Feature-flag state in production for FEATURE_ETA, FEATURE_VEHICLE_QR, FEATURE_DRIVER_REGISTRATION, FEATURE_GEOFENCE, FEATURE_ROUTE_DEVIATION, FEATURE_DRIVER_SHIFT_SELECTION. Several audited routers (eta, qr, consent, documents, registration, geofence, route-deviations) 404 unless the corresponding f
- nginx / Cloudflare configuration in front of the backend — the /uploads 404 wall at app.js:78-80 and the 'trust proxy = 1' assumption at app.js:43 could not be checked against the real reverse-proxy config.
- The remaining ~40 service files, all 42 migrations in backend/migrations/, and the frontend route guards beyond Sidebar.jsx were not reviewed.
- POST /api/school/students/move (school.routes.js:864-894) lets a school attach its own student to ANY non-deleted vehicle in the province (line 879 checks existence only, no scope). Whether that is intended (vehicles appear to be province-shared per admin.routes.js:1427) is a business rule I cannot 

**Data integrity — transactions, races, and multi-step writes** (9)

- Everything below is static-only: I did not run the server, connect to any MySQL instance, execute any migration, or run any test suite. No race described was executed — each is derived from the code plus the DDL (absence of a unique key, absence of FOR UPDATE, an await between a read and a dependent
- Whether all 42 migrations have actually been applied to the production database. The whole 'uq_dva_active_vehicle was dropped' finding assumes migration 039 ran in prod. If 039 has NOT been applied there, that finding inverts: the constraint still exists and the code is correct, but migrations/039 i
- Whether the backend runs as more than one process/instance (PM2 cluster, multiple containers, a replica set behind a load balancer). I found no ecosystem.config.js and no cluster usage in src/index.js, so I framed the geofence finding on the same-process await-interleaving race, which holds regardle
- Actual production data shape: whether any student currently has more than one parent_student row, and whether any parent_student row currently has approved = FALSE. Both determine how often findings 1 and 2 fire, and finding 1's escalation to critical depends on the second.
- The MySQL server's actual transaction isolation level. I assumed InnoDB's default REPEATABLE READ. Under a stricter SERIALIZABLE setting some of the check-then-act races (checkin, roster request) would be blocked by the engine instead of by the missing constraint.
- Whether backend/src/routes/line.routes.js:549 (the notification dispatcher) is driven by a cron with overlapping schedules, and how long a 50-message LINE batch takes in practice — that determines the size of the duplicate-resend window in the processUnsentNotifications finding.
- backend/src/services/vehicleVerification.service.js (55KB, 21 writes / 7 transactions) and backend/src/services/pickupPoint.service.js were only read as structural outlines, not line by line. Both are transaction-heavy and I found no obvious unguarded multi-table write in the outline, but I cannot c
- backend/src/routes/admin.routes.js, affiliation.routes.js and province.routes.js were examined only through the write/transaction tally and targeted greps (e.g. INSERT INTO users). Their non-user-creation write paths are not_verified.
- Whether any of the described races is currently occurring in production — no logs, no metrics, and no DB access were available. Frequencies quoted (e.g. duplicate check-ins) are potential, not observed.

**Logging, audit trail, monitoring, and alerting** (9)

- Whether the production crontab contains the 03:45 cleanup-old-logs.js --apply entry documented in docs/OPERATOR_RUNBOOK.md:18, and with what retention window — no crontab artifact is committed to the repo.
- Whether /etc/schoolbus/health-alert.env exists on the server with a valid LINE_CHANNEL_ACCESS_TOKEN and a TECH_LINE_TARGET_ID distinct from the school emergency LINE_GROUP_ID. ops/systemd/schoolbus-health-alert.service uses EnvironmentFile=- (optional), so a missing file means every FAIL prints 'ALE
- Whether the three systemd timers (schoolbus-health-alert.timer, schoolbus-health-smoke.timer, schoolbus-health-heartbeat.timer) are actually installed and enabled on the host — the repo holds only the unit files plus install instructions in their headers.
- Whether the pm2-logrotate module is installed and configured (docs/phase-9-ops-notes.md:347-353). scripts/health-check.sh:139-148 checks it, but only as a WARN, and health-check.sh is not the script the alert timer runs; no rotation config is committed.
- Whether PM2 is currently running the backend from ecosystem.config.js (which redirects logs to /home/schoolbus/logs/) or from an older invocation using the ~/.pm2/logs defaults. This determines the exact blast radius of the health-smoke PM2_LOG_DIR mismatch; `pm2 jlist` on the host would settle it.
- Whether the MySQL grants for the application DB user permit DELETE/UPDATE on audit_logs. No application code path issues either statement, but grant-level immutability could not be checked without DB access.
- Whether migration 040's ALTER TABLE audit_logs (the GEOFENCE_*/ROUTE_DEVIATION/ETA_REFRESH enum values) has been applied to the production database — this decides whether the silent audit-write failure described in the logAudit finding is currently active.
- Whether any external uptime monitor, load balancer, or Cloudflare health check is pointed at /health and judges it by HTTP status code alone.
- Actual audit_logs table size and growth rate in production, which would show whether retention is running.

**Secret management and exposure** (8)

- Live production host filesystem: actual permission modes on /home/schoolbus/backups/**, on backend/.env, and on any existing backup-*/backend.env or database.sql. Finding 2's severity depends on the operator's umask, which I could not observe — I could only prove that scripts/backup.sh performs none
- Whether scripts/backup.sh has ever actually been run on the production host, and therefore whether plaintext copies of backend/.env exist there right now. The script is manual and the scheduled cron job (docs/OPERATOR_RUNBOOK.md:13) uses the hardened backup-db.sh instead.
- Whether backend/scripts/seed-uat-override-fixture.js has ever been run against the production database, and whether its stdout (which prints plaintext passwords) was captured in any deploy transcript, tmux log, CI log, or UAT evidence bundle. docs/production-readiness.md:142 implies it is run agains
- The live production backend/.env: which variables are actually set there, in particular whether LINE_CHANNEL_ACCESS_TOKEN and LINE_GROUP_ID are populated. Finding 1 describes a reachable configuration, not an observed one — I could not confirm the running system is currently in it.
- Git remote visibility (public vs private) and the hosting provider's settings. This does not change any finding — no secret is tracked and none is in history — but it would change the urgency of the .gitignore gap in Finding 4.
- Whether docker-compose.yml governs the production MySQL instance or is development-only (see the owner question on Finding 6). The production deploy path I can read (scripts/deploy-backend.sh, scripts/backup-db.sh, docs/OPERATOR_RUNBOOK.md) contains no compose step, but I could not confirm this on t
- The production crontab, PM2 log retention, and whether PM2 out-logs (/home/schoolbus/logs/schoolbus-backend.out.log per ecosystem.config.js:27) are rotated or off-host shipped. This matters for Finding 1, where the only trace of an undelivered emergency is a console.log line.
- Whether any off-host backup destination (rclone remote or rsync target per scripts/offhost-backup-sync.env) ever received a backup.sh-style directory. The sync script excludes .env (scripts/offhost-backup-sync.sh:123) and reads only BACKUP_DIR=/home/schoolbus/backups/lampang-bus, so by code it shoul

**Authentication** (8)

- Nothing was executed against a running instance — no login attempt, no token replay, no rate-limit probe. Every finding is read from source. The one thing I did run was a local, offline simulation of express's proxy-addr resolution using the repo's own node_modules, to check the trust-proxy hop arit
- The nginx configuration is not in this repository. The exact X-Forwarded-For chain (and therefore the precise consequence of trust proxy = 1) rests on the premise stated in the comment at backend/src/app.js:38-42 and on docs/deployment-hardening.md line 16. Confirming it requires reading the live ng
- Whether Cloudflare is actually in front of the origin in production, and whether the origin IP is reachable directly (which would let an attacker present a forged X-Forwarded-For). backend/src/index.js:15 binds to 127.0.0.1 by default, and docs/deployment-hardening.md line 20 flags the live backend 
- The live population of accounts still sitting on their initial plate-number / school-code password. That is the exposure multiplier for the two critical findings, and it needs a production query (SELECT count(*) FROM users WHERE must_change_password = TRUE AND last_login IS NULL, plus a bcrypt check
- Whether migrations 011 and 043 have actually been applied to the production database. If 043 has not run, password_changed_at can still be NULL for migrated users, and the token-invalidation guards at middleware/auth.js:88 and auth.routes.js:357 silently skip for those accounts — the migration file'
- Whether the MySQL event scheduler is ON in production. revoked_tokens is pruned by a MySQL EVENT (migrations/001_initial_schema.sql:485-491) that only runs when the scheduler is enabled; if it is off, the table grows without bound. Requires SELECT @@event_scheduler on the live DB.
- Whether the deployed JWT_SECRET is a real random value rather than the placeholder in backend/.env.example line 21 ('CHANGE_ME_TO_A_RANDOM_STRING_AT_LEAST_32_CHARS' — which is 46 characters and therefore passes the length check at config/env.js:94). I did not look for and did not read any .env file.
- Behaviour of the must_change_password path normalization (middleware/auth.js:17-21) against exotic URL encodings. I reasoned through the allowlist and found no bypass, but I could not execute requests to prove it. Treat 'no bypass' as read-level analysis, not a tested result.

**Test suite adequacy and code quality signals** (8)

- Whether the suite currently passes. I did not execute jest — the instruction forbade running anything touching a database, and 58 of the 93 test files require a live MySQL. Every judgement here is from reading code, not from observed test results.
- Actual line/branch coverage numbers. No coverage configuration exists in backend/package.json or jest.unit.config.js (no collectCoverage, no coverageThreshold), and I did not run jest --coverage. My coverage statements are derived from reading test bodies and matching them to the routes/services the
- Whether .github/workflows/full-quality.yml actually runs and passes on the branches that get deployed. I have no access to GitHub Actions run history, branch protection settings, or whether the workflow is required for merge. The workflow file exists and is correctly written; that is all I can confi
- The contents of backend/.env.test on any real machine. It is gitignored (.gitignore lines 6-9) and absent from this checkout, so I verified the loading logic and the guard's behavior by reading code, not by observing a real environment.
- Any specific CVE affecting multer 1.4.5-lts.2, json2csv 6.0.0-alpha.2, or any other locked dependency. I did not run npm audit and deliberately cite no CVE numbers. The dependency finding rests only on version strings read from backend/package-lock.json plus usage analysis of the source tree.
- Whether the backup and restore-readiness shell scripts (scripts/verify-latest-backup.sh, scripts/restore-test-readiness.sh, scripts/check-offhost-backup-config.sh) work correctly, and whether production backups actually exist and restore. I identified that the test guarding this can pass vacuously; 
- Whether the unique indexes asserted as text in vehicleVerification.test.js and driverShift.test.js are actually present in the live schema. Confirming that needs a query against information_schema on a real database.
- Whether scripts/browser-review.mjs runs successfully. It requires a manually started vite server, a --no-save playwright install, and system libraries per its own header; I read it but did not execute it.

**Database schema and migrations** (7)

- Whether the production database at schoolbuslampang.com actually matches backend/tests/schema.sql or the migration files. No DB connection was available. The dump proves what SOME real database looked like when it was taken (AUTO_INCREMENT counters are present: parents=1339, checkin_logs=625, daily_
- The live contents of the schema_migrations table — which migration filenames are recorded as applied in production, and with what checksums. validate-migration-baseline.js --db and migration-status.js both require a DB connection.
- Whether migrations 042-048 have actually been applied to production. I can only prove they are absent from the committed test schema.
- Whether MySQL is running in strict SQL mode in production (default is ON in MySQL 8). This determines whether the geofences.target_id type mismatch (finding 3) throws ER_TRUNCATED_WRONG_VALUE_FOR_FIELD or silently coerces 'SCH0001' to 0.
- Whether any duplicate parent rows, duplicate checkin_logs rows, or duplicate active driver assignments already exist in production data. Confirming these needs SELECT ... GROUP BY ... HAVING COUNT(*) > 1 against the live DB.
- Whether database backups exist, are scheduled, or have ever been restore-tested. Nothing in backend/migrations or backend/scripts covers backup or restore.
- Whether the MySQL Event Scheduler is actually ON in production, which the cleanup_revoked_tokens EVENT in 001_initial_schema.sql:486-491 depends on.

**API input validation, error handling, and response hygiene** (7)

- Runtime behaviour of every finding — no server was started, no HTTP request was issued, and no database was queried. All conclusions are from reading source at the stated line numbers.
- The live MySQL sql_mode. I inferred STRICT_TRANS_TABLES from MySQL 8 defaults because backend/src/config/database.js:18-33 sets no sql_mode; if the production server runs non-strict, the over-length cases silently TRUNCATE instead of returning 500 — which is worse (silent data corruption), not bette
- Whether nginx or Cloudflare strip query strings, and the retention and access policy for their logs — required to settle the severity of the id_token-in-URL finding.
- Which feature flags are actually on in production (FEATURE_VEHICLE_QR, FEATURE_DRIVER_REGISTRATION, FEATURE_ETA/GEOFENCE/ROUTE_DEVIATION, FEATURE_DRIVER_SHIFT_SELECTION). This changes whether /api/consent, /api/documents, /api/geofences and the shift-based driver vehicle resolution are reachable at 
- Whether CRON_API_KEY is set in the running production process (backend/src/config/env.js asserts it at boot, but I did not observe the running process), which gates reachability of the /api/line/process-notifications message leak.
- Dependency vulnerability status — I did not run `npm audit` (it would require network access and is outside a read-only source review). multer is pinned at ^1.4.5-lts.1, a line that has had advisories; this needs a real audit run before any claim is made.
- Whether the exceljs XLSX writer could be coerced into emitting a formula cell from a plain string at admin.routes.js:1160/1174. My reading says no (string cells are type 's'), but I could not execute it to prove it, so I did not report it as a vulnerability.

**Frontend routing, role gating, and UI-vs-API rule agreement** (7)

- Runtime confirmation of any finding — no server, database, or browser was available. Every conclusion is from reading source at commit 9a64efc; I issued zero HTTP requests. In particular I did not observe an actual 200-index.html response for an unmounted /api path, an actual grade-teacher report ex
- Whether a reverse proxy in the real deployment intercepts /api/* before Express and returns 404 for unmounted paths. No nginx/Caddy/Traefik config exists in the repo (only ops/systemd, ecosystem.config.js, docker-compose.yml), so the app.js:202 catch-all appears to be the last word — but the product
- The actual values of FEATURE_GEOFENCE, FEATURE_ROUTE_DEVIATION, FEATURE_DRIVER_SHIFT_SELECTION, FEATURE_DRIVER_REGISTRATION and FEATURE_VEHICLE_QR in the running environment. Findings about flag-off behavior are conditional on those flags being off; .env.example and env.js show all of them default t
- Whether users.grade_scope is populated for any real account in production — the grade-teacher findings assume at least one teacher sub-account exists (creatable via POST /api/school/teacher-accounts, school.routes.js:1886).
- What each page actually renders when its API returns 403 — I read the load path for AdminGeofences and SchoolAuditLog but did not audit the 403 rendering of all ~60 pages.
- Whether helmet's CSP as configured meaningfully constrains XSS, which affects how exploitable the localStorage refresh-token storage is. I read app.js only for route mounting and the SPA fallback, not the helmet configuration.
- Whether nginx or the SPA build serves /manual/* (App.jsx:201 ManualRedirect → /manual/index.html) without authentication, and what that documentation contains. It is served by express.static (app.js:201) with no auth middleware, but I did not inspect the manual's contents to judge whether that matte

**Application-edge security controls** (7)

- The production nginx configuration — no .conf file exists anywhere in the repo. Whether nginx serves the SPA from disk or proxies '/' to Express, whether it sets any add_header, whether it caps client_max_body_size (which would blunt the 10 MB JSON finding at the edge), and whether /health is expose
- Whether the origin's :443 is restricted to Cloudflare IP ranges, and whether Authenticated Origin Pull is enabled. This decides whether the X-Forwarded-For rate-limit bypass is reachable.
- The contents of backend/.env (absent from this checkout — only .env.example and .env.test.example exist). I cannot confirm LINE_CHANNEL_SECRET, CRON_API_KEY, CORS_ORIGINS or JWT_SECRET are actually populated in production, nor which FEATURE_* flags are on, which gates whether the /api/qr and /api/co
- Whether NODE_ENV=production is present on every real start path. ecosystem.config.js:29-32 sets it, but I cannot observe how the live process was started or whether pm2 restart carried the env forward.
- I did not execute any request against a running instance. No rate limiter, CORS decision, CSP header, or signature check was observed responding — every conclusion is from reading source and installed dependency code.
- Reachability of /health from the public internet. scripts/health-smoke.sh:31 probes it at http://127.0.0.1:3000/health only, and docs/deployment-hardening.md:16 says nginx proxies '/api/' — so /health is probably not publicly proxied. Because I could not confirm that, I did NOT report the unauthenti
- npm audit / dependency CVE status — I did not run npm audit, so I make no claim about reachable dependency vulnerabilities. Note multer is pinned at ^1.4.5-lts.1 (backend/package.json:34), a line that has since been superseded by 2.x; that is worth a separate check but I did not verify any specific 

**Frontend correctness and UX quality — forms, state, and data fetching** (7)

- Nothing was executed. No dev server was started, no browser session was driven, and no build was run, so every finding is from source reading plus cross-referencing the backend rule it depends on. The two ReferenceError findings in particular are proven by static evidence (grep shows the identifier 
- Real network latency in the deployed environment: the two race-condition findings (DriverDashboard poll, StudentSearch debounce) are structurally certain but I could not measure how often the overlap actually occurs for real users on real Thai mobile networks.
- The live database's effective session timezone. backend/src/config/database.js pins +07:00 and the file's own comment asks OPS to verify with `SELECT CURDATE(), NOW(), @@session.time_zone;` on the deployed DB — I could not run that, so the timezone findings assume the pinning is in effect in product
- Whether the API responses for the reports pages ever actually omit morning_kpi / evening_kpi. The KpiCard finding proves the component cannot distinguish missing from zero; it does not prove a live endpoint produces the missing case.
- Actual traffic to /driver/roster. The route is registered (App.jsx:212) but absent from Sidebar.jsx and MobileBottomNav.jsx, so I could not determine how many drivers reach it by bookmark or direct URL — this bounds the severity of the two crash findings and I could not resolve it from the code.
- No ESLint config and no test suite exist in frontend/ (package.json has neither), so I could not run a static-analysis or regression pass to look for further undeclared identifiers beyond my own regex scan of handler props. Identifiers used in non-handler JSX expressions were not exhaustively checke
- Whether the legacy import path (POST /school/students/import, reached via the 'แบบเดิม' button at StudentSearch.jsx:238) is still intended to be user-reachable — it writes student data with no preview and no confirmation step, unlike the primary preview/apply flow. That is a product decision, not a 

**Personal data handling, PDPA exposure, and the LINE/LIFF parent channel** (7)

- Whether consent_records contains any rows in production (no DB access) — inferred to be empty for parents because /api/consent is only mounted when FEATURE_VEHICLE_QR=true and backend/.env.example:87 ships it false
- The live values of FEATURE_VEHICLE_QR / FEATURE_PARENT_CONSENT_REQUIRED / FEATURE_QR_LEVEL3 on the production host (backend/.env is not in the repo)
- Whether the crontab entries documented in scripts/prune-location-history.sh:19-21 and backend/scripts/cleanup-old-logs.js:17-20 are actually installed on the production server, and whether cleanup-old-logs.js runs with --apply (it is dry-run by default)
- How many rows line_message_logs currently holds, i.e. how many guardian phone numbers are sitting in plaintext there
- Whether a Data Protection Officer / legal review of backend/src/config/consentText.js was ever completed (the file carries an unresolved 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย/DPO ก่อนเปิดใช้งานจริง' at L9)
- Whether a PDPA record-of-processing (ROPA), privacy notice, or data-subject-request procedure exists outside the repository
- Whether database backups containing student/guardian PII are encrypted and access-controlled (scripts/backup-db.sh not audited in this domain pass)

**SQL safety and query correctness** (6)

- Live MySQL access — I could not run any query, EXPLAIN, or index check. All statements about row counts, plan quality, index coverage and actual latency are inferences from the SQL text alone. This is why the unbounded-query finding is marked suspected_defect / medium confidence rather than confirme
- Actual production data volume: number of active students, schools, vehicles, pickup points per vehicle, and seeded geofences. These determine whether the unbounded and N+1 findings are already causing incidents or are only latent.
- Runtime confirmation that the ORDER BY allow-lists hold: I read the allow-list guards at school.service.js:184-186, affiliation.service.js:236-238 and province.service.js:422-424 but could not execute a request with `?sort=id;DROP` to observe the fallback. The guards are unambiguous on read, but I d
- Whether MySQL is running with a mode/version where `LIMIT -1` errors exactly as described (I reason from standard MySQL 8 grammar, not from an executed query).
- Deployment topology: whether the backend runs as a single Node process or multiple instances. The geofence in-process `lastInside` Map (geofence.service.js:143-151) behaves differently under multi-instance deploys, and I could not inspect the process manager or infrastructure config.
- Frontend polling intervals — I confirmed which pages call /province/status-today (frontend/src/pages/province/ProvDailyStatus.jsx:21) but not whether any of them refresh on a timer, which would multiply the unbounded-query load.

## 5. ไม่ได้อ่านทีละไฟล์

- `node_modules/` — ตรวจผ่าน `npm audit` แทน (backend และ frontend: 0 ช่องโหว่)
- `frontend/dist/` — build artifact, ไม่ได้ commit
- `outputs/` — ผลลัพธ์เครื่องมือ, gitignored
- ภาพ `.png` 119 ไฟล์ — ตรวจว่ามีอยู่และถูกอ้างอิงถูกต้อง ไม่ได้ตรวจเนื้อหาภาพทีละใบ
- PDF ในคู่มือ — เป็น symlink ไปยังไฟล์จริง ตรวจโครงสร้าง symlink ไม่ใช่เนื้อหา

**ตรวจแล้วว่าไม่มี build artifact หรือ generated file ถูก commit โดยไม่จำเป็น**
(`frontend/dist`, `node_modules`, `outputs` อยู่ใน `.gitignore` ครบ)
