# auth-session — เข้าสู่ระบบ, JWT, เซสชัน, เปลี่ยน/กู้รหัสผ่าน

## หน้าที่
ออก/ตรวจ JWT (access + refresh), ยกเลิกเซสชันตอน logout และเมื่อพบ refresh token ถูกใช้ซ้ำ, บังคับเปลี่ยนรหัสผ่านครั้งแรก,
และกู้รหัสผ่านบัญชี admin ผ่าน LINE (ปิดไว้ด้วย feature flag). เป็นฐานให้ทุก route ที่ใช้ `authenticate` + `requireRole`.

## จุดเข้า
Mount (`backend/src/app.js` ~L156-158): `/api/auth` (ไม่มี flag), `/api/auth/recovery` (router mount เสมอ แต่ handler ที่ต้องใช้ flag เช็คใน `requireFeature` ด้วย `FEATURE_ADMIN_PASSWORD_RECOVERY`, `adminPasswordRecovery.routes.js:87`).

- POST /api/auth/login — ตรวจรหัสผ่าน bcrypt, lockout ต่อ (username+IP), ออก access+refresh
- GET /api/auth/me — ข้อมูลผู้ใช้ปัจจุบัน
- POST /api/auth/change-password — เปลี่ยนรหัสผ่าน, ออก token ชุดใหม่
- POST /api/auth/refresh-token — หมุน refresh token (ใช้ครั้งเดียว)
- POST /api/auth/logout — เพิกถอน access token (และ refresh ถ้าส่งมา)
- GET /api/auth/recovery/config — ค่า config สำหรับหน้า recovery
- GET /api/auth/recovery/self/status; POST /self/link-line; POST /self/regenerate-codes; DELETE /self/line — ผู้ใช้จัดการช่องทาง LINE/รหัสกู้คืนของตัวเอง
- GET /admin/status; POST /admin/link-line; POST /admin/regenerate-codes; DELETE /admin/line — admin จัดการแทนผู้ใช้อื่น (`adminGate` = requireRole('admin'), L348)
- POST /api/auth/recovery/request — ขอลิงก์ reset (ส่งทาง LINE)
- POST /api/auth/recovery/complete — ตั้งรหัสใหม่ด้วย token (+ recovery code ถ้า `ADMIN_RECOVERY_REQUIRE_CODE` ไม่เป็น false)

## โค้ดหลัก
- `backend/src/routes/auth.routes.js` (551) — `generateAccessToken`/`generateRefreshToken`, handlers ทั้ง 5
- `backend/src/routes/adminPasswordRecovery.routes.js` (580) — `handleStatus/handleLinkLine/handleRegenerateCodes/handleUnlinkLine`, `replaceRecoveryCodes`, `requireRecoveryRole`
- `backend/src/middleware/auth.js` (145) — `authenticate`, `MUST_CHANGE_ALLOWLIST`
- `backend/src/middleware/roleGuard.js` (56) — `requireRole(...roles)`, `isScopeAllowed(req, scopeId)`
- `backend/src/middleware/rateLimiters.js` (142) — `createUserKeyedLimiter`, `GLOBAL_API_BUDGET`, `REPORT_EXPORT_BUDGET`, `IMPORT_EXPORT_BUDGET`
- `backend/src/middleware/optionalAuth.js` (85) — auth แบบไม่บังคับ
- `backend/src/utils/sessionReset.js` (124) — `sessionResetJti`, `recordSessionReset`, `issuedBeforeReset`
- `backend/src/utils/sharedSecurityState.js` (178) — lockout เก็บใน DB; `passwordPolicy.js` (49); `recoveryTokens.js` (54); `audit.js` (73) `logAudit`

## ข้อมูลที่รับผิดชอบ
- `users` — 001_initial_schema.sql (คอลัมน์ `must_change_password` เพิ่มใน 010, `password_changed_at` ใน 011, backfill 043, `grade_scope` ใน 018)
- `revoked_tokens` (เก็บ jti ที่ถูกเพิกถอน และ jti พิเศษ session-reset) — 001
- `audit_logs` — 001 (archive: `audit_logs_archive` 047)
- `login_lockouts` — 051_shared_security_state.sql
- `user_recovery_channels`, `user_recovery_codes`, `password_reset_requests` — 049_admin_password_recovery.sql

## จุดเชื่อม
- ถูกเรียกโดยทุก router ที่ต้องล็อกอิน (`authenticate`, `requireRole`)
- `line.service` / `lineIdToken.service` ใช้ยืนยัน LINE Login ในขั้น link-line (ยังไม่ได้ตรวจรายละเอียดเส้นทางเรียก)
- สร้าง/ปิดบัญชีผู้ใช้อยู่ที่ [admin-ops.md](admin-ops.md)

## กติกาสำคัญ
- JWT verify ต้องใช้ HS256 เท่านั้น — `middleware/auth.js:46`
- ทุก request ไปอ่าน `users` ใหม่: บัญชี `is_active=false` ถูกปฏิเสธ 401 `ACCOUNT_DISABLED` — `auth.js:89-93`
- token ที่ออกก่อน `password_changed_at` ใช้ไม่ได้ (`PASSWORD_CHANGED`) — `auth.js:101-104`
- access token ที่ logout แล้ว ใช้ไม่ได้ (`SESSION_REVOKED`) ยกเว้นเส้น logout เอง — `auth.js:114-119`
- `must_change_password` → 403 `MUST_CHANGE_PASSWORD` ทุกเส้นที่ไม่อยู่ใน allowlist — `auth.js:12,130`
- Login กันเดา username ด้วย dummy bcrypt compare เพื่อเวลาเท่ากัน — `auth.routes.js:31,170,181`; ทุกผลลัพธ์ login ถูก audit — `auth.routes.js:172-209`
- Lockout 10 ครั้ง เก็บใน DB (หลาย instance ใช้ร่วมกัน) — `auth.routes.js:33-39`; รหัสปัจจุบันผิดตอน change-password ใช้งบ lockout เดียวกัน — `auth.routes.js:283-302`
- Refresh token ใช้ซ้ำ = ถือว่า replay, audit `refresh_token_replay` และยกเลิกเซสชันทั้งบัญชี — `auth.routes.js:411-442`; refresh เดิมถูกใส่ `revoked_tokens` ทันทีที่หมุน — `auth.routes.js:486`
- เปลี่ยนรหัสผ่านต้อง revoke refresh token เดิมและ audit — `auth.routes.js:317-338`
- Recovery: ตัวนับพยายามผิด 5 ครั้งแล้ว request ใช้ไม่ได้ — `adminPasswordRecovery.routes.js:486,520`

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(adminPasswordRecovery|adminRecoverySingleFactor|accountRecoveryPolicy|recoverySelfServiceSurface|recoveryBindingRelease|logoutRevokesAccessToken|changePasswordFreshTokens|changePasswordThrottle|optionalAuth|refreshTokenClientContract|authThaiMessages|rbacMatrix|forcedPasswordClientContract|frontendPasswordPolicyContract|trainingRateLimits)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `auth.test.js`, `authInactiveUser.test.js`, `authSessionHardening.test.js`, `refreshTokenReplay.test.js`, `sharedSecurityState.test.js`.

## ความเสี่ยงที่ทราบ
- `auth.js` อ่าน `users` + `revoked_tokens` (2 LEFT JOIN) ทุก request ที่ผ่าน `authenticate` — `auth.js:77-82` (ภาระ DB ต่อ request; ยังไม่ได้วัด)
- การเพิกถอน session ทั้งบัญชีทำผ่านแถว `revoked_tokens` พิเศษ ไม่ใช่คอลัมน์ token_version — `utils/sessionReset.js:58`
