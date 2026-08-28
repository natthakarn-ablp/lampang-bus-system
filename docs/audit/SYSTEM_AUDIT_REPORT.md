# รายงานการตรวจสอบระบบระดับ Production Readiness

**ระบบรถรับส่งนักเรียนจังหวัดลำปาง** (Lampang School Bus System)

| | |
|---|---|
| Repository | `natthakarn-ablp/lampang-bus-system` |
| Branch | `codex/full-ui-redesign` |
| Commit ที่ตรวจ | `9a64efce622f02d2a82238c041fc4164a0af65b1` |
| วันที่ตรวจ | 27 สิงหาคม 2569 |
| Working tree | สะอาด ยกเว้น `output/` ที่ไม่ได้ติดตาม (ไม่ใช่ของผู้ตรวจ ไม่ถูกแตะต้อง) |
| ขอบเขตการเขียน | เขียนเฉพาะใน `docs/audit/` — ไม่มีการแก้โค้ด schema env หรือ deploy ใด ๆ |

---

## 1. Executive Summary

ระบบนี้สร้างมาอย่างมีวินัยทางวิศวกรรมสูงกว่าที่พบทั่วไปในงานลักษณะเดียวกัน — มีการสำรอง
ข้อมูลอัตโนมัติที่**ผ่านการซ้อมกู้คืนจริง** มีสำเนานอกเครื่อง มี audit log มีการปิดกั้น
ขอบเขตข้อมูลที่เขียนถูกรูปแบบ และมีชุดทดสอบ 374 รายการที่ผ่านทั้งหมด

แต่มีข้อบกพร่องระดับ **Critical 4 รายการ** ที่ต้องแก้ก่อนประกาศใช้ และหนึ่งในนั้น
เมื่อผู้ตรวจวัดขนาดบนระบบจริงแล้วพบว่ากว้างกว่าที่ประเมินจากโค้ดมาก

> **ข้อค้นพบสำคัญที่สุด**
>
> บัญชีคนขับถูกสร้างโดยใช้**ทะเบียนรถเป็นทั้งชื่อผู้ใช้และรหัสผ่าน**
> ผู้ตรวจทดสอบด้วย `bcrypt.compare` บนฐานข้อมูลจริงแบบอ่านอย่างเดียว พบว่า
> **404 จาก 451 บัญชีคนขับ (89.6%) ยังอยู่ในสภาพนั้น และเปิดใช้งานอยู่ทั้งหมด**
>
> รวมทุกบทบาท: **423 จาก 797 บัญชี (53.1%) เข้าสู่ระบบได้ด้วยข้อมูลสาธารณะ**
>
> ทะเบียนรถติดอยู่ข้างรถทุกคัน ผู้โจมตีไม่ต้องมีทักษะใดนอกจากอ่านป้ายทะเบียน
> เมื่อเข้าได้แล้วจะเปลี่ยนรหัสผ่านเป็นของตนเองได้ทันที เพราะ**รู้รหัสผ่านปัจจุบันอยู่แล้ว**

### ตารางสรุปความเสี่ยง

| Severity | Confirmed | Suspected | Needs owner confirmation | Not verified | Config risk | Total |
| -------- | --------: | --------: | -----------------------: | -----------: | ----------: | ----: |
| Critical | 3 | 0 | 1 | 0 | 0 | **4** |
| Major | 32 | 0 | 7 | 0 | 3 | **42** |
| Minor | 51 | 6 | 5 | 1 | 17 | **80** |
| **รวม** | **86** | **6** | **13** | **1** | **20** | **126** |

### Top Findings

| ID | Finding | Severity | Status | Affected area | Owner confirmation |
| -- | ------- | -------- | ------ | ------------- | ------------------ |
| AUD-001 | Auto-provisioned driver logins use the vehicle licence plate as BOTH username and pass | critical | confirmed_defect | service | ไม่ต้อง |
| AUD-002 | Auto-provisioned school accounts use the school code as the initial password, with the | critical | confirmed_defect | service | ไม่ต้อง |
| AUD-003 | Student transfer copies only ONE guardian link and ignores parent_student.approved — c | critical | confirmed_defect | service | ไม่ต้อง |
| AUD-004 | Grade-teacher school sub-accounts are grade-scoped everywhere in /api/school but NOT i | critical | logic_conflict | service (backend) vs. ro | ต้องการ |
| AUD-005 | POST /api/visits/track is unauthenticated and has no rate limit at all — the public vi | major | confirmed_defect | route (mounted at app.js | ไม่ต้อง |
| AUD-006 | Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts an | major | needs_owner_confirmation | express trust-proxy + ng | ต้องการ |
| AUD-007 | The SPA document is served by nginx, so helmet's headers never reach it — no frame-anc | major | configuration_risk | conflict between the Exp | ไม่ต้อง |
| AUD-008 | Logout cannot invalidate the access token — it stays valid for the full 24h after the  | major | confirmed_defect | route + middleware | ไม่ต้อง |
| AUD-009 | Refresh-token rotation is broken end to end: the backend revokes the old refresh token | major | logic_conflict | frontend/backend contrac | ต้องการ |
| AUD-010 | trust proxy = 1 is off by one for the documented Cloudflare→nginx chain: req.ip resolv | major | configuration_risk | config | ไม่ต้อง |

### สิ่งที่ตรวจแล้วพบว่าทำถูก — บันทึกไว้เพื่อความเป็นธรรม

รายงานลักษณะนี้มักกล่าวถึงเฉพาะสิ่งที่ผิด รายการต่อไปนี้ตรวจแล้วและทำงานถูกต้องจริง
หลายข้อเป็นจุดที่ระบบขนาดนี้มักพลาด:

| ประเด็น | ผลการตรวจ | หลักฐาน |
|---|---|---|
| JWT secret มีค่า default สำรองหรือไม่ | **ไม่มี** — บังคับยาว ≥32 และ `process.exit(1)` ถ้าขาด | `backend/src/config/env.js:89-96,118-120` |
| ค่า JWT_SECRET บน production | **เป็นค่าสุ่มจริง** 64 อักขระ 38 ชนิด ไม่ใช่ placeholder | ตรวจบนเซิร์ฟเวอร์ |
| อัลกอริทึม JWT | **ตรึง HS256** ทั้งสามจุดตรวจ ปิดช่อง alg:none | `middleware/auth.js:45` และอีก 2 จุด |
| ปิดบัญชีแล้ว token เดิมยังใช้ได้ไหม | **ใช้ไม่ได้** ตรวจ `is_active`/`is_deleted` ใหม่ทุกคำขอ | `middleware/auth.js:70-81` |
| SQL injection | **ไม่พบ** ทุก query ใช้ placeholder — ไล่ทุกจุดที่สร้าง SQL ไม่ใช่สุ่มตัวอย่าง | services 50 ไฟล์ |
| bcrypt cost | **12** ทุกจุด ไม่มีที่ใดเทียบรหัสผ่านแบบ plaintext | 6 จุดที่ hash |
| ข้อความ error ตอน login | **เหมือนกันทุกกรณี** + dummy compare กันการวัดเวลา | `auth.routes.js:155,169,178` |
| LINE webhook ตรวจลายเซ็น | **ตรวจ** คืน 403 เมื่อไม่ผ่าน | `line.routes.js:77-80` |
| cron endpoint | **มี API key** เทียบแบบ timing-safe และ fail closed ใน production | `line.routes.js:532-546` |
| error handler รั่ว stack หรือไม่ | **ไม่รั่ว** production คืนข้อความกลาง | `middleware/errorHandler.js:41` |
| ฐานข้อมูลเปิดสู่อินเทอร์เน็ต | **ไม่** ผูก `127.0.0.1` เท่านั้น | `ss -lntp` |
| แอปใช้บัญชี root | **ไม่ใช่** `schoolbus_db@localhost` มีสิทธิ์เฉพาะ 3 ฐานของแอป | `SHOW GRANTS` |
| Backup ทำงานจริง | **จริง** cron 02:30 ทุกวัน มี checksum ครบ | crontab + ไฟล์จริง |
| เคยซ้อมกู้คืนหรือไม่ | **เคย** 26 ส.ค. กู้ได้ 58/58 ตาราง ใน 4 วินาที | `uat-evidence/.../restore-drill/` |
| สำเนานอกเครื่อง | **มี** rclone `copy` (ไม่ลบปลายทาง) ทุกวัน 02:50 | `offhost-backup-sync.log` |
| Secret หลุดใน git history | **ไม่พบ** สแกน 429 commits ทั้งชื่อไฟล์และเนื้อหา | `git log --all` |
| Dependency vulnerability | **0** ทั้ง backend และ frontend | `npm audit` |
| ชุดทดสอบ | **374 ผ่าน / 374** (36 suites) | `npm run test:unit` |

---

## 2. Audit Objective

ตรวจสอบความพร้อมใช้งานจริงของระบบทั้งหมด จำแนกปัญหาเป็น Critical / Major / Minor
พร้อมหลักฐานระดับไฟล์และเลขบรรทัด โดยประเด็นที่เป็นกฎทางธุรกิจถือเป็น Provisional
จนกว่าเจ้าของระบบจะยืนยัน — ผู้ตรวจไม่ตัดสินกฎทางธุรกิจแทนเจ้าของระบบ

## 3. Scope

Frontend · Backend · API · Authentication/Authorization · Business Logic · Database
และการเข้าถึงฐานข้อมูล · Data integrity · Security · Server/Hosting · Environment และ
Secrets · Backup/DR · GitHub และ CI/CD · Logging/Monitoring/Alerting · Tests ·
Deployment/Rollback · Documentation

## 4. Out of Scope

- การแก้ไขใด ๆ ต่อระบบ (ไม่มีการแก้เกิดขึ้นตลอดการตรวจ)
- การทดสอบเจาะระบบที่ต้องเขียนข้อมูล และการทดสอบโหลด
- การตั้งค่าใน GitHub / Cloudflare / LINE console (ไม่มีสิทธิ์ — ดู AUDIT_COVERAGE.md)

## 5. Repository Snapshot

```
branch : codex/full-ui-redesign
commit : 9a64efce622f02d2a82238c041fc4164a0af65b1
subject: fix(docs): stop the PDF build from clobbering symlinks on Windows
tracked: 1,143 files
dirty  : 1 (output/ — untracked, ไม่ใช่ของผู้ตรวจ)
```

| | |
|---|---:|
| Source .js/.jsx/.mjs | 411 |
| API endpoints | 247 |
| Route files | 21 |
| Service modules | 41 |
| Frontend pages | 88 |
| Frontend components | 62 |
| Migrations | 42 |
| Test files | 98 (374 unit tests ผ่านทั้งหมด) |
| GitHub workflows | 2 |

## 6. Technology Stack — ต่างจากที่โจทย์ระบุทั้งหมด

> โจทย์ระบุว่าคาดว่าใช้ Next.js App Router, TypeScript, Prisma 7, NextAuth
> **ผลตรวจ: ไม่มีสิ่งเหล่านี้อยู่ในระบบเลยแม้แต่อย่างเดียว**

| ที่โจทย์คาด | ที่พบจริง | หลักฐาน |
|---|---|---|
| Next.js App Router | **React 18 + Vite + react-router-dom** | `frontend/package.json` |
| TypeScript | **ไม่มี** — `.ts`/`.tsx` = 0 ไฟล์ ส่วน `.js`/`.jsx` = 402 | `git ls-files` |
| Prisma 7 + schema.prisma | **ไม่มี ORM** — `mysql2` เขียน SQL ดิบ schema จาก .sql 42 ไฟล์ | `backend/package.json` |
| NextAuth Credentials | **JWT เอง** (`jsonwebtoken`) + `bcrypt` | `backend/src/middleware/auth.js` |
| Plesk | **VPS + nginx + pm2** บน Ubuntu 24.04 | `ecosystem.config.js` |
| MySQL/MariaDB | **MySQL 8.0.46** | `SELECT VERSION()` |

บทบาทที่พบตรงกับโจทย์ทั้ง 6 และมีเพิ่ม **`parent` ผ่าน LINE LIFF** ซึ่งโจทย์ไม่ได้ระบุ

## 7. Architecture Summary

```
เบราว์เซอร์ / LINE LIFF
   |  axios + Bearer JWT (เก็บใน localStorage)
   v
nginx :443 --- static: frontend/dist --- /manual/ -> docs/manual-html (symlink)
   |
   |  proxy_pass /api/ -> 127.0.0.1:3000   (ไม่มี trailing slash — ถูกต้อง)
   v
Express 4  (pm2: schoolbus-backend, ผูก 127.0.0.1 เท่านั้น)
   helmet -> cors(allow-list) -> json(10mb) -> globalApiLimiter -> routers
   |
   |  router.use(authenticate, requireRole(...))  <- ป้องกันที่ระดับ router ใน 17 ไฟล์
   v
services (41) -- mysql2 pool (limit 10, tz +07:00) --> MySQL 8 (127.0.0.1)
   |
   +--> LINE Messaging API (push), LIFF id_token verify (api.line.me)
```

### การควบคุมสิทธิ์แบบหลายผู้เช่า

ผู้ใช้ผูกกับขอบเขตผ่าน `users.scope_type` / `scope_id` / `grade_scope`
(ไม่ใช่ `school_id` ตามที่อาจเข้าใจจากชื่อ) ทุก route ที่รับ `school_id` จาก request
ใช้ helper รูปแบบเดียวกัน:

```js
function resolveSchoolId(req) {
  if (req.user.role === 'admin') return req.query.school_id || req.body?.school_id || null;
  return req.user.scopeId;          // บทบาทอื่นถูกบังคับใช้ค่าจาก JWT เสมอ
}                                    // backend/src/routes/school.routes.js:44-47
```

ผู้ตรวจไล่ทุกจุดที่อ่าน `school_id` จาก request พบเพียง 4 จุด และ 3 จุดเป็น helper
ข้างต้น ไม่พบรูปแบบ fail-open แบบ `(? IS NULL OR col = ?)` ในการกรอง scope เลย
และไม่มี route ใดประกาศก่อนบรรทัด `router.use(authenticate)` (ตรวจครบทุกไฟล์)

### สถิติการป้องกัน endpoint

| การป้องกัน | จำนวน |
|---|---:|
| ป้องกันที่ระดับ router (`router.use(authenticate, ...)`) | 222 |
| ป้องกันรายเส้นทาง | 9 |
| ตรวจตัวตนผู้ปกครองผ่าน LINE id_token | 7 |
| `optionalAuth` (หน้า QR สาธารณะ) | 1 |
| ไม่มี auth โดยตั้งใจ (login, refresh, webhook, cron, bind, consent notice, visit) | 8 |
| มีการจำกัดบทบาท (`requireRole`) | 226 |

## 8. Audit Methodology

1. บันทึก snapshot และยืนยันเทคโนโลยีจริง (พบว่าโจทย์ระบุผิดทั้งหมด)
2. สร้าง inventory: 247 endpoints, route/role matrix, migrations, tests
3. ตรวจ 15 โดเมนคู่ขนาน ผู้ตรวจแต่ละโดเมนต้องอ้างไฟล์และบรรทัดที่อ่านจริง
4. **รอบตรวจทานแบบตั้งข้อสงสัย** — ผู้ตรวจทานเปิดไฟล์ที่ถูกอ้างอ่านซ้ำเอง
   แล้วตัดสินว่าหลักฐานยืนยันข้อกล่าวหาหรือไม่ และปรับระดับตามเกณฑ์อย่างเคร่งครัด
5. ผู้ตรวจนำยืนยันด้วยตนเองบนระบบจริงแบบอ่านอย่างเดียวในประเด็นที่เข้าถึงได้
6. รันเครื่องมือที่ปลอดภัย: unit tests, npm audit, build, ด่านตรวจในโปรเจกต์ 7 ตัว

**ผลของรอบตรวจทาน: Major ลดจาก 92 เหลือ 42**
ข้อเสนอเชิง hardening ที่ไม่มีเส้นทางความล้มเหลวที่พิสูจน์ได้ถูกลดเป็น Minor ตามเกณฑ์
ตัดรายการซ้ำ 6 รายการ และมี 2 รายการที่หลักฐานไม่ผ่านการตรวจทานจึงถูกปรับสถานะ

## 9. Audit Coverage

ดู `docs/audit/AUDIT_COVERAGE.md` ซึ่งระบุรายโดเมนว่าอ่านไฟล์ใดบ้าง และมี 128 รายการ
ที่ผู้ตรวจรายโดเมนระบุว่าตรวจไม่ได้ ผู้ตรวจนำปิดช่องได้ 11 ข้อด้วยการตรวจบนเซิร์ฟเวอร์จริง

## 10. Limitations and Unverified Areas

ยังตรวจไม่ได้เพราะไม่มีสิทธิ์: GitHub repository/organization settings (branch protection,
2FA, deploy keys, Actions secrets) · กฎ firewall (ต้อง sudo) · Cloudflare dashboard ·
อายุใบรับรอง SSL · สิทธิ์ของ rclone remote ปลายทาง · LINE Official Account console ·
ประสิทธิภาพภายใต้ภาระผู้ใช้จริง

**ไม่มีข้อใดในรายงานนี้เขียนว่าผ่านเพียงเพราะพบไฟล์ config**

---

## 11. Overall Risk Summary

ความเสี่ยงของระบบนี้**ไม่ได้อยู่ที่คุณภาพโค้ด** ซึ่งอยู่ในเกณฑ์ดี แต่อยู่ที่
**วิธีแจกจ่ายบัญชีผู้ใช้** ระบบเลือกใช้ข้อมูลสาธารณะ (ทะเบียนรถ, รหัส OBEC)
เป็นรหัสผ่านตั้งต้นเพื่อความสะดวกในการนำผู้ใช้ราว 800 บัญชีเข้าระบบ
แล้วพึ่งพากลไก `must_change_password` เป็นด่านกัน

ด่านนั้นกันไม่ได้ เพราะผู้โจมตี**รู้รหัสผ่านปัจจุบันอยู่แล้ว** จึงเรียก
`/api/auth/change-password` ซึ่งอยู่ใน allowlist ของด่านนั้นได้ทันที
และตัวเลขจริงยืนยันว่าประชากรที่ยังเปราะบางคือ 53% ของทั้งระบบ

รองลงมาคือ **ความไม่สอดคล้องกันระหว่างชั้น** — กติกาเดียวกันถูกบังคับใช้ในที่หนึ่ง
แต่ลืมในอีกที่หนึ่ง (เช่น กรองตามระดับชั้นครบใน `/api/school` แต่ลืมใน `/api/reports`,
กรอง `approved = TRUE` ในตอน import แต่ลืมตอนย้ายโรงเรียน) ซึ่งเป็นรูปแบบที่
ตรวจจับได้ยากด้วยการทดสอบทีละหน้า และเป็นที่มาของ Critical 2 ใน 4 รายการ

## 12. Findings by Severity

| Severity | จำนวน |
|---|---:|
| Critical | 4 |
| Major | 42 |
| Minor | 80 |
| **รวม** | **126** |

---

## 13. Critical Findings

ทั้ง 4 รายการมีเส้นทางการโจมตีหรือเส้นทางความล้มเหลวที่อธิบายได้ชัดเจน
ไม่มีรายการใดถูกจัดเป็น Critical เพียงเพราะอาจมีความเสี่ยง

## AUD-001: Auto-provisioned driver logins use the vehicle licence plate as BOTH username and password

- **Provisional severity:** critical
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** predictable-credential
- **Layer:** service
- **Affected roles:** driver, school, admin
- **Affected entities:** users, drivers, driver_vehicle_assignments, students
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ไม่ได้อยู่ในรอบตรวจทาน (เป็น critical/minor ตั้งแต่ต้น)

### Summary

When a school registers a vehicle and supplies a driver name, the system creates a login user whose username is the plate string (plateNo) and whose password is bcrypt(plateNo) — the same value. users.is_active defaults TRUE (migrations/001_initial_schema.sql:222), so the account is live the moment it is created. must_change_password is TRUE, but middleware/auth.js:11-15 allowlists /api/auth/change-password precisely so a quarantined user can change it, and the attacker already knows the current password.

### Evidence

- **File:** `backend/src/services/driverProfile.service.js`
- **Lines:** 73-79
- **Symbol:** linkOrCreateDriverForVehicle()
- **Caller:** backend/src/routes/school.routes.js:1090-1099 — POST /api/school/vehicles (school or admin adds a vehicle with a driver_name)

```js
const hash = await bcrypt.hash(plateNo, BCRYPT_COST);
await conn.query(
  `INSERT INTO users (username, password_hash, role, display_name, driver_id, must_change_password)
   VALUES (?, ?, 'driver', ?, ?, TRUE)`,
  [plateNo, hash, name, driverId]
);
```

### Expected logic

An initial credential must not be derivable from a public identifier. The provisioning path should generate a random secret delivered out-of-band, or the account should be created inactive until claimed.

### Trigger / reproduction steps

1. Note a plate string registered in the system, e.g. as displayed on the vehicle
2. POST /api/auth/login with {"username":"<plate>","password":"<plate>"} → 200, user.must_change_password = true
3. POST /api/auth/change-password with Bearer <token> and {"current_password":"<plate>","new_password":"<attacker value>"} → 200
4. POST /api/auth/login with the new password → full driver session

### Impact

Full takeover of a driver account by anyone who can read the side of a bus. Step by step: (1) read the plate off the vehicle, or read it from any school-facing vehicle list; (2) POST /api/auth/login {username: '<plate>', password: '<plate>'} → 200 with an access token and must_change_password=1; (3) POST /api/auth/change-password {current_password: '<plate>', new_password: '<attacker choice>'} — allowlisted at middleware/auth.js:13, and the attacker knows current_password; (4) log in again with the new password, now with must_change_password cleared and unrestricted driver-role access. Driver role reaches the student manifest for that vehicle (names, pickup points, check-in state) — i.e. student data in the wrong hands, and the ability to falsify check-in/check-out records. The real driver is silently locked out.

### Root cause

Provisioning reuses the only identifier the caller has (the plate) as the temp secret, and the forced-change quarantine cannot protect a secret the attacker already knows.

### Severity justification

Critical per the brief: auth bypass leading to one person performing another role's actions and to student data being shown to the wrong person. The credential is not merely weak, it is published on the physical vehicle. Precondition: the account has not yet been through its forced password change — every newly onboarded vehicle is in that state, and any account whose driver never logged in stays there indefinitely.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. Generate a cryptographically random initial password in linkOrCreateDriverForVehicle, return it once to the provisioning school user for out-of-band handover (it is already never echoed today), or create the row with is_active = FALSE plus a one-time claim token. Additionally, require re-authentication or a claim token — not just the known temp password — on the first change-password for a must_change_password account.

### Required regression tests

- linkOrCreateDriverForVehicle must never set password_hash to bcrypt(plateNo) — assert bcrypt.compare(plateNo, row.password_hash) === false for a freshly created driver user
- POST /api/auth/login with username === password === plate must fail for a newly provisioned driver account

### Owner decision

- [x] **ยอมรับความเสี่ยงไว้ก่อน (Risk accepted)** — ตัดสินใจ 28 ส.ค. 2569
- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

**เหตุผลของเจ้าของระบบ:** รูปแบบ username/password ชุดนี้ได้แจ้งและตกลงกับโรงเรียนและ
คนขับไปแล้ว การเปลี่ยนตอนนี้จะทำให้ผู้ใช้สับสนในช่วงที่ยังเริ่มใช้งานไม่ทั่วถึง

**สิ่งที่ผู้ตรวจบันทึกไว้ประกอบการตัดสินใจ:** ข้อค้นพบนี้ยังคงสถานะ `confirmed_defect`
ตามหลักฐาน การยอมรับความเสี่ยงไม่ได้เปลี่ยนข้อเท็จจริงทางเทคนิค — เปลี่ยนเฉพาะลำดับ
การแก้ไข ความเสี่ยงที่แท้จริงไม่ใช่ "รหัสผ่านคาดเดาง่าย" เฉย ๆ แต่คือบัญชีที่
**ยังไม่มีใครเข้าใช้ครั้งแรก** — คนนอกที่รู้ทะเบียนรถหรือรหัส OBEC (ข้อมูลสาธารณะทั้งคู่)
เข้าสู่ระบบก่อนเจ้าของบัญชีตัวจริงได้ แล้วเปลี่ยนรหัสผ่านผ่าน `/api/auth/change-password`
ซึ่ง `middleware/auth.js:11-15` อนุญาตไว้ให้บัญชีที่ยัง `must_change_password = TRUE`
ใช้ได้ ผลคือเจ้าของตัวจริงถูกล็อกออกจากบัญชีของตัวเอง ปัจจุบันมีคนขับเพียง 7 รายจาก 318 ราย
ที่เคยเข้าสู่ระบบ จึงมีบัญชีที่ยังไม่ถูกอ้างสิทธิ์อยู่จำนวนมาก

**มาตรการชดเชยที่เสนอ (ไม่กระทบข้อตกลงเดิม):** เฝ้าดูการเข้าสู่ระบบครั้งแรกของแต่ละบัญชี
และแจ้งเตือนเมื่อมีการเปลี่ยนรหัสผ่านจากบัญชีที่โรงเรียนยังไม่ได้แจกให้ใคร — ยังไม่ได้
ดำเนินการ รอการตัดสินใจแยกต่างหาก

---

## AUD-002: Auto-provisioned school accounts use the school code as the initial password, with the username fixed to the public 6-digit OBEC code

- **Provisional severity:** critical
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** predictable-credential
- **Layer:** service
- **Affected roles:** school, affiliation
- **Affected entities:** users, schools, students, parent_student
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ไม่ได้อยู่ในรอบตรวจทาน (เป็น critical/minor ตั้งแต่ต้น)

### Summary

The username is constrained to the school's public 6-digit OBEC code, and the initial password is set to school.id (the school code) — both are public reference data published in ministry school directories. The second site (line 188, createSchoolWithAccount) does the same: `const hash = await bcrypt.hash(schoolCode, 12);`. must_change_password = TRUE, and validatePassword is explicitly NOT applied to this value (comment at lines 84-87: 'the create path and the school_code-default import rows use the numeric school code as a temp credential and stay policy-exempt').

### Evidence

- **File:** `backend/src/services/affiliationAdmin.service.js`
- **Lines:** 39-58 (and the same pattern at 187-193)
- **Symbol:** createSchoolAccount() / createSchoolWithAccount()
- **Caller:** backend/src/routes/affiliation.routes.js — affiliation-role account creation and the bulk school-account import

```js
if (!/^\d{6}$/.test(username)) { ... 'ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก' }
// Auto-generate initial password from school.id (school code)
const password = school.id;
...
const hash = await bcrypt.hash(password, 12);
```

### Expected logic

The initial secret must not be a public identifier, and must not be the same class of value as the username.

### Trigger / reproduction steps

1. Take a school's public 6-digit OBEC code and its school code from a public directory
2. POST /api/auth/login {"username":"<obec>","password":"<school code>"} → 200 for any school still on its initial credential
3. POST /api/auth/change-password {"current_password":"<school code>","new_password":"..."} → permanent takeover
4. GET /api/school/students → that school's roster

### Impact

Anyone holding a public school directory can attempt username = OBEC code, password = school code against /api/auth/login and, on any school that has not yet completed its forced password change, obtain a school-role session. From there: POST /api/auth/change-password with the known current password gives permanent control of the account. School role reads and writes that school's full student roster (names, grades, pickup points, parent links) — the exact 'student data shown to the wrong person' case in the brief. The rightful school user is locked out.

### Root cause

The bulk-provisioning UX needs a credential the affiliation operator can read off a spreadsheet, so it reuses the school code; the forced-change flag is treated as sufficient compensating control, but it cannot protect a secret the attacker already knows.

### Severity justification

Critical: cross-tenant access to student PII by an outsider, reached with two public data points and no exploitation skill. Precondition, stated honestly: only accounts still on their initial password are affected. Bulk-imported schools that have not logged in yet are exactly that population, and there is no expiry on the temp credential.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. Replace the school-code default with a per-account random string surfaced once to the provisioning operator, and stop exempting it from validatePassword. If a human-transcribable value is required, make it high-entropy and single-use with an expiry, and mark the account inactive until first claim.

### Required regression tests

- createSchoolAccount must not produce a hash that verifies against school.id
- createSchoolWithAccount must not produce a hash that verifies against schoolCode
- validatePassword must be applied to every generated initial password

### Owner decision

- [x] **ยอมรับความเสี่ยงไว้ก่อน (Risk accepted)** — ตัดสินใจ 28 ส.ค. 2569
- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

**เหตุผลของเจ้าของระบบ:** รูปแบบ username/password ชุดนี้ได้แจ้งและตกลงกับโรงเรียนและ
คนขับไปแล้ว การเปลี่ยนตอนนี้จะทำให้ผู้ใช้สับสนในช่วงที่ยังเริ่มใช้งานไม่ทั่วถึง

**สิ่งที่ผู้ตรวจบันทึกไว้ประกอบการตัดสินใจ:** ข้อค้นพบนี้ยังคงสถานะ `confirmed_defect`
ตามหลักฐาน การยอมรับความเสี่ยงไม่ได้เปลี่ยนข้อเท็จจริงทางเทคนิค — เปลี่ยนเฉพาะลำดับ
การแก้ไข ความเสี่ยงที่แท้จริงไม่ใช่ "รหัสผ่านคาดเดาง่าย" เฉย ๆ แต่คือบัญชีที่
**ยังไม่มีใครเข้าใช้ครั้งแรก** — คนนอกที่รู้ทะเบียนรถหรือรหัส OBEC (ข้อมูลสาธารณะทั้งคู่)
เข้าสู่ระบบก่อนเจ้าของบัญชีตัวจริงได้ แล้วเปลี่ยนรหัสผ่านผ่าน `/api/auth/change-password`
ซึ่ง `middleware/auth.js:11-15` อนุญาตไว้ให้บัญชีที่ยัง `must_change_password = TRUE`
ใช้ได้ ผลคือเจ้าของตัวจริงถูกล็อกออกจากบัญชีของตัวเอง ปัจจุบันมีคนขับเพียง 7 รายจาก 318 ราย
ที่เคยเข้าสู่ระบบ จึงมีบัญชีที่ยังไม่ถูกอ้างสิทธิ์อยู่จำนวนมาก

**มาตรการชดเชยที่เสนอ (ไม่กระทบข้อตกลงเดิม):** เฝ้าดูการเข้าสู่ระบบครั้งแรกของแต่ละบัญชี
และแจ้งเตือนเมื่อมีการเปลี่ยนรหัสผ่านจากบัญชีที่โรงเรียนยังไม่ได้แจกให้ใคร — ยังไม่ได้
ดำเนินการ รอการตัดสินใจแยกต่างหาก

---

## AUD-003: Student transfer copies only ONE guardian link and ignores parent_student.approved — co-guardians are silently dropped and a revoked guardian can be re-approved onto the new student record

- **Provisional severity:** critical
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** multi-step-write
- **Layer:** service
- **Affected roles:** admin, school, parent
- **Affected entities:** students, parent_student, parents
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

parent_student has PRIMARY KEY (parent_id, student_id) (migrations/001_initial_schema.sql:197-207), so a student may legitimately have several guardian rows. The SELECT takes LIMIT 1 with no ORDER BY and no `approved = TRUE` filter. Exactly one arbitrary parent_id is carried to the new student id, and it is written with approved = TRUE, approved_by = adminUserId regardless of what its previous approved value was. The whole thing is inside the transaction, so it commits atomically — the transaction is not the problem; the query is.

### Evidence

- **File:** `backend/src/services/studentTransfer.service.js`
- **Lines:** 134-136
- **Symbol:** approveAndApply()
- **Caller:** backend/src/routes/admin.routes.js → studentTransfer approve endpoint (admin role); the source student row is soft-deleted at line 126 and a brand-new students row is created at 129-133, so parent_student rows must be re

```js
// Copy the parent link (if any) to the destination student.
const [[ps]] = await conn.query('SELECT parent_id FROM parent_student WHERE student_id = ? LIMIT 1', [st.id]);
if (ps) await conn.query('INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE', [ps.parent_id, newId, adminUserId]);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

studentTransfer.service.js:134-136, inside approveAndApply's transaction: `SELECT parent_id FROM parent_student WHERE student_id = ? LIMIT 1` with no ORDER BY and no approved filter, then `INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE`. The evidence is stronger than the auditor allowed on both preconditions they hedged on. (1) Revoked rows are routinely produced, not rare: studentImportPreview.service.js:484-495 sets `UPDATE parent_student SET approved = FALSE` for the previous guardian on every guardian-phone change during a student import, leaving the old guardian as a surviving approved=FALSE row. (2) The pick is not arbitrary but effectively deterministic: parent_student has PRIMARY KEY (parent_id, student_id) plus KEY fk_ps_student (student_id) (tests/schema.sql:573-586), so WHERE student_id = ? scans that index in (student_id, parent_id) order and returns the lowest parent_id first — the older, i.e. usually the revoked, guardian. Downstream, every parent-facing gate keys on ps.approved = TRUE: checkin.service.js:414-421 (LINE check-in/check-out pushes), line.service.

### Expected logic

Copy every parent_student row for the source student to the new student id, preserving each row's original `approved` value (and relationship), rather than collapsing them to one arbitrarily-chosen row forced to approved = TRUE.

### Trigger / reproduction steps

1. Pick a student S at school A that has two approved parent_student rows (P1, P2) — e.g. created by the legacy CSV import at backend/src/routes/school.routes.js:1593-1600, which links by phone and therefore adds a second parents row when the CSV guardian phone differs from the alre
2. As a school A user, POST the transfer request for S to school B (backend/src/routes/school.routes.js:1778, POST /students/:studentId/transfer-request).
3. As admin, approve it (approveAndApply).
4. Read parent_student for the new applied_student_id: exactly one row exists. P1 or P2 — whichever the LIMIT 1 happened to return — is gone.
5. For the escalation case: before step 2, run a guardian-update import row for S with a new phone so studentImportPreview.service.js:495 sets P1's row to approved = FALSE. Then approve the transfer and observe that P1 can come back as approved = TRUE on the new student id.

### Impact

Two distinct harms. (1) Data loss: on a two-guardian student (father + mother, or parent + grandparent) one guardian is dropped at transfer with no error and no audit entry — the audit row written at line 145-146 records only {student_id, school_id} and says nothing about parent links. That guardian permanently stops receiving check-in/check-out LINE pushes (checkin.service.js:414-421 joins parent_student ps ... AND ps.approved = TRUE) and loses LIFF access to the child (line.service.js:109, 256, 393; qrAccess.service.js:37; geofence.service.js:303 all gate on ps.approved = TRUE). (2) Access re-grant: a link that was deliberately revoked by setting approved = FALSE (studentImportPreview.service.js:495 does exactly this when a guardian-update import replaces the guardian phone) is not excluded by this SELECT. If it is the row LIMIT 1 returns, the revoked guardian is written back as approved = TRUE against the new student id and regains check-in notifications and live tracking for a child they were removed from.

### Root cause

The query treats a one-to-many relation as one-to-one (LIMIT 1) and treats the approval flag as something to set rather than something to preserve.

### Severity justification

Promote. This meets the critical bar's 'student data shown to the wrong person' with a described failure path, and it is none of the three the lead already established. Path: a school changes a student's guardian phone via import, which approves the new guardian and sets the old one to approved = FALSE; an admin later approves a transfer request for that student; approveAndApply picks the lowest parent_id — the removed guardian — and writes it onto the new student record with approved = TRUE, approved_by = the admin. The removed guardian resumes receiving that child's check-in/check-out notifications and regains LIFF access to the child's attendance and live GPS position, while the current guardian is dropped entirely (only one row is copied). No audit record captures it: the audit row at :144-146 carries only {student_id, school_id}. The silent loss of co-guardians on every multi-guardi

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Replace the single-row copy with a set-based copy that preserves approval state, e.g. INSERT INTO parent_student (parent_id, student_id, relationship, approved, approved_by, approved_at) SELECT parent_id, <newId>, relationship, approved, approved_by, approved_at FROM parent_student WHERE student_id = <st.id>, run inside the same transaction. If the product rule is that transfer must re-affirm consent, then filter to approved = TRUE and copy all matching rows — but do not force approved = TRUE on rows that were FALSE.

### Required regression tests

- approveAndApply on a student with 2 approved guardians copies 2 parent_student rows to the new student id
- approveAndApply on a student with one approved and one approved=FALSE guardian never writes approved=TRUE for the FALSE one
- approveAndApply on a student with 0 guardians still commits (regression guard for the existing `if (ps)`)

### Owner decision

- [x] **Confirmed defect — แก้ไขและขึ้นระบบจริงแล้ว 28 ส.ค. 2569** (commit `16b167e`)
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

**สิ่งที่แก้:** เปลี่ยนการคัดลอกผู้ปกครองใน `approveAndApply` จาก `SELECT ... LIMIT 1`
บวก `approved = TRUE` ตายตัว เป็น `INSERT ... SELECT` แบบยกทั้งชุด ที่พา `relationship`,
`approved`, `approved_by`, `approved_at` ไปพร้อมกัน ผู้ปกครองที่ถูกเพิกถอนสิทธิ์จึงยังคง
ถูกเพิกถอน และผู้ปกครองร่วมไม่หายไป พร้อมบันทึกจำนวนลิงก์ที่ยกไปลงใน audit ของการย้าย

**การพิสูจน์:** เพิ่มการทดสอบ 11 ข้อ ทดสอบแบบ negative control แล้ว — เมื่อนำโค้ดเดิม
กลับไปวาง การทดสอบตก 7 ข้อ แสดงว่าชุดทดสอบจับข้อบกพร่องได้จริง ไม่ใช่แค่บรรยายโค้ดใหม่

**ผลกระทบย้อนหลัง:** ตรวจข้อมูลจริงแล้ว `student_transfer_requests` ที่มีสถานะ approved
มี **0 รายการ** ข้อบกพร่องนี้จึงยังไม่เคยทำงาน ไม่มีข้อมูลเสียหายที่ต้องตามแก้
(ณ เวลาที่ตรวจ มีนักเรียน 49 คนที่มีผู้ปกครองมากกว่า 1 คน และลิงก์ที่ถูกเพิกถอนอยู่ 20 รายการ
ซึ่งจะได้รับผลกระทบทันทีหากเริ่มใช้ฟีเจอร์ย้ายก่อนแก้)

---

## AUD-004: Grade-teacher school sub-accounts are grade-scoped everywhere in /api/school but NOT in /api/reports — the reports export returns every student in the school

- **Provisional severity:** critical
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** scope-bypass
- **Layer:** service (backend) vs. route guard (backend) vs. sidebar (frontend)
- **Affected roles:** school (grade-teacher sub-account, role='school' + grade_scope set)
- **Affected entities:** students, daily_status, vehicles, schools
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ไม่ได้อยู่ในรอบตรวจทาน (เป็น critical/minor ตั้งแต่ต้น)

### Summary

buildScopeFilter destructures only date/month/school_id/affiliation_id/vehicle_id and clamps a role='school' user to s.school_id = user.scopeId. It never reads user.gradeScope. The whole rest of the school module does the opposite: backend/src/routes/school.routes.js:68-73 resolveGradeScope(req) returns req.user.gradeScope for any non-admin, and it is threaded into every school read (school.routes.js:204-208 getStudents({...gradeFilter}), :224 getVehicles({gradeFilter}), :167 getDashboard({gradeFilter})), where services/school.service.js:207 hard-pins `const effectiveGrade = gradeFilter || grade || null` so 'a teacher can't unlock other grades'. The frontend agrees with the grade boundary too (utils/authScope.js:25 isGradeTeacher, Sidebar.jsx:151-155 TEACHER_BLOCKED_PATHS) — but /reports/daily is listed in SCHOOL_NAV at Sidebar.jsx:57 and is NOT in TEACHER_BLOCKED_PATHS, PrivateRoute at 

### Evidence

- **File:** `backend/src/services/report.service.js`
- **Lines:** 9-40 (buildScopeFilter), 402-429 (getExportRows)
- **Symbol:** buildScopeFilter / getExportRows / getDailyReport
- **Caller:** routes/report.routes.js:74 GET /api/reports/daily and :215/:254/:310 GET /api/reports/export/{csv,excel,pdf} — router.use(authenticate, requireRole('school','affiliation','province','admin')) at report.routes.js:14. Fron

```js
function buildScopeFilter(user, { date, month, school_id, affiliation_id, vehicle_id }) {
  let where = 's.is_deleted = FALSE';
  const params = [];
  if (user.role === 'school') {
    where += ' AND s.school_id = ?';
    params.push(user.scopeId);
  } else if (user.role === 'affiliation') {
```

### Expected logic

If grade_scope is a real data boundary (as school.routes.js:87-95 requireFullSchoolScope and services/school.service.js:204-207 assert), reports and report exports for a role='school' user with gradeScope set should be filtered to that grade — or the reports module should be blocked for grade teachers the same way /school/audit-logs is (school.routes.js:1196 requireFullSchoolScope).

### Trigger / reproduction steps

1. Log in as a school sub-account whose users.grade_scope = 'ป.4' (created via POST /api/school/teacher-accounts, school.routes.js:1886).
2. Observe the sidebar: 'ประวัติการแก้ไข' (/school/audit-log) is hidden by Sidebar.jsx:151-155, but 'รายงาน' (/reports/daily, Sidebar.jsx:57) is shown.
3. Click 'รายงาน'. PrivateRoute (App.jsx:298) admits role 'school'; report.routes.js:14 requireRole admits 'school'.
4. On the Daily Report page click the CSV button (DailyReport.jsx:133 → ExportButtons.jsx:40).
5. GET /api/reports/export/csv?date=... reaches getExportRows → buildScopeFilter, which adds only `AND s.school_id = ?`. The downloaded CSV lists every student in the school, all grades.

### Impact

A homeroom-teacher sub-account scoped to one grade downloads a CSV/Excel/PDF containing, for EVERY student in the school regardless of grade: student_id, full name (CONCAT prefix+first+last), grade, classroom, school name, affiliation, bus plate number, and today's morning/evening check-in status and timestamps (report.service.js:407-418, headers at report.routes.js:112-116). The same account is deliberately 403'd from the school's read-only audit log, which contains strictly less PII. The daily/monthly/summary JSON endpoints likewise return school-wide per-vehicle and per-school breakdowns.

### Severity justification

Student PII (full names + grades + bus plate + daily attendance) is delivered to an account the system explicitly scopes to a single grade, and both the backend school module and the frontend sidebar treat that scope as a hard boundary. Per the brief's scale this is 'student data shown to the wrong person'. Filed as logic_conflict rather than confirmed_defect only because whether grade teachers may see school-wide reports is a business rule the Product Owner owns.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY, NOT APPLIED. Either (a) pass req.user.gradeScope into buildScopeFilter and append `AND s.grade IN (?)` using the same gradeEquivalents() helper the school service uses, for every report query including getExportRows; or (b) add a requireFullSchoolScope-equivalent guard on the reports router for role='school' users with gradeScope set, and hide /reports/daily from TEACHER_BLOCKED_PATHS in Sidebar.jsx. Pick one after the Product Owner answers the question above — do not do both silently.

### Required regression tests

- role='school' with gradeScope='ป.4' calling GET /api/reports/daily returns counts equal to that grade only (or 403, per the PO decision).
- GET /api/reports/export/csv as a grade teacher contains zero rows whose s.grade is outside the teacher's grade equivalents.
- role='school' with gradeScope=null (full school account) still sees the entire school — no behavior change.
- role='affiliation' passing ?school_id of a school in another affiliation still gets zero rows (the existing AND-clamp must not regress).

### Product Owner confirmation question

> Should a grade-teacher sub-account (role='school' with grade_scope set, e.g. 'ป.4') be able to open /reports/daily and download the report export containing the names, grades, bus plates and attendance of students in OTHER grades of the same school? If no, must reports be grade-filtered like /api/school/students, or blocked outright like /api/school/audit-logs?

### Owner decision

- [x] **Logic B ถูกต้อง — ครูสายชั้นเห็นเฉพาะสายชั้นตัวเอง** (ตัดสินใจ 28 ส.ค. 2569)
- [x] **แก้ไขและขึ้นระบบจริงแล้ว 28 ส.ค. 2569**
- [ ] Intended behavior
- [ ] Deferred

**สิ่งที่แก้ (รายงาน):** `buildScopeFilter` เพิ่ม `AND s.grade IN (...)` เมื่อผู้เรียกเป็น
role='school' ที่มี `grade_scope` โดยจับคู่แบบยืดหยุ่นผ่าน `gradeEquivalents()` เหมือนที่
โมดูลโรงเรียนใช้อยู่แล้ว จุดเดียวนี้ครอบคลุมทั้ง `getDailyReport` / `getMonthlyReport` /
`getSummaryReport` / `getExportRows` จึงครอบทั้ง JSON และไฟล์ CSV/Excel/PDF
`getPolicyReport` ไม่ต้องแก้ — มี guard 403 ก่อนแตะฐานข้อมูลอยู่แล้ว (ยืนยันด้วยการทดสอบ)

**สิ่งที่พบเพิ่มระหว่างการแก้ และแก้ไปด้วย** — การไล่ทุกเส้นทางที่บัญชีครูสายชั้นเข้าถึงได้
พบว่ารายงานไม่ใช่จุดเดียวที่ขอบเขตสายชั้นรั่ว:

| จุด | อาการ | สถานะ |
|---|---|---|
| `GET /api/school/no-show` | ไม่เรียก `resolveGradeScope` และไม่มี `requireFullSchoolScope` — เป็น read เดียวบน router ที่ไม่มีทั้งสองอย่าง คืนชื่อ-ห้อง-ทะเบียนรถของนักเรียนทั้งโรงเรียนที่ไม่ขึ้นรถ ย้อนหลังได้ทุกวัน | แก้แล้ว |
| `GET /api/verification/applications/:id/timeline` | **ไม่ใช่เรื่องสายชั้น แต่เป็นการรั่วข้ามโรงเรียน** — guard เป็นค่าคงที่ `TRUE` สำหรับทุก role ที่ไม่ใช่คนขับ และไม่เคยอ่าน `req.user.scopeId` โรงเรียนใดก็อ่าน timeline ของคำขอโรงเรียนอื่นได้ด้วยการไล่ id | แก้แล้ว |
| `/api/school/registrations/*` | ครูสายชั้นเปิดดูรายชื่อผู้โดยสารทั้งคันและยอดรวมทั้งโรงเรียนได้ | ปิดทั้งโมดูลตามที่เจ้าของระบบเลือก |
| `s.grade = ?` 6 จุด | จับคู่ระดับชั้นแบบตรงตัว — ไม่ได้ทำให้ข้อมูลรั่ว แต่ทำให้ครู **ไม่เห็นนักเรียนของตัวเอง** เมื่อระดับชั้นถูกบันทึกเป็นรูปแบบอื่น (`ประถมศึกษาปีที่ 4`) และรายการว่างอ่านได้ว่า "ไม่มีใคร" | แก้เป็นแบบยืดหยุ่นทั้ง 6 จุด |
| ป้ายกำกับบนหน้าจอ | แถบบนสุดบอกครูว่า "ขอบเขตโรงเรียน" ทั้งที่ขอบเขตจริงคือหนึ่งสายชั้น · หน้ารายงานไม่มีชิพบอกขอบเขต · ตารางสรุปรายสังกัดแสดงตัวเลขสายชั้นเดียวใต้ชื่อเขตพื้นที่ · ไฟล์ที่ครูดาวน์โหลดไม่บอกว่าเป็นข้อมูลบางส่วน | แก้ทั้งหมด |

**การพิสูจน์:** เพิ่มการทดสอบ 42 ข้อ (รวมชุดทดสอบเป็น 427 ข้อ / 41 suites ผ่านทั้งหมด)
ทดสอบแบบ negative control ทุกชุด — ถอดการแก้ออกแล้วการทดสอบตกตามคาดทุกครั้ง
(รายงาน 9/14 · no-show และการจับคู่ระดับชั้น 7/19 · ปิดโมดูลจดทะเบียน 5/9)

**สิ่งที่ตรวจแล้วไม่ใช่ปัญหา** — บันทึกไว้เพื่อไม่ให้ถูกหยิบมาตรวจซ้ำ: `/api/eta/*`
(ปิดด้วย feature flag), `POST /api/reports/decision-log` (ไม่คืนข้อมูลใด),
`/reports/policy` (มี guard ที่ service อยู่แล้ว), ความไม่ตรงกันของตัวหารใน KPI รายเดือน
และรายสรุป (มีอยู่ก่อนแล้วและไม่เกี่ยวกับขอบเขตสายชั้น), การจัดการ `grade` ที่เป็น NULL

---

## AUD-127: GET /api/verification/applications/:id/timeline has no school scope — any school account can read any other school's inspection audit trail by walking sequential ids

- **Provisional severity:** critical
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** idor / cross-tenant
- **Layer:** route (backend)
- **Affected roles:** school (both full accounts and grade-teacher sub-accounts)
- **Affected entities:** audit_logs, vehicle_inspection_applications, inspection_application_schools, users
- **Business logic confirmation required:** No
- **พบเมื่อ:** 28 ส.ค. 2569 ระหว่างดำเนินการแก้ AUD-004 — **ไม่ได้อยู่ในรายงานตรวจสอบรอบแรก**

### Summary

ตัวคุมสิทธิ์ในเส้นทางนี้เขียนไว้สำหรับคนขับเท่านั้น:

```js
const driverGuard = isDriver
  ? `EXISTS (... a.requested_by = ?)`
  : 'TRUE';
```

สำหรับ role อื่นทุกตัวรวมถึง `school` ค่าที่ได้คือสตริง `'TRUE'` และ `req.user.scopeId`
ไม่เคยถูกอ่านเลยในตัวจัดการนี้ บัญชีโรงเรียนใดก็ตามจึงอ่าน timeline ของคำขอตรวจสภาพรถ
ของโรงเรียนอื่นได้ โดยส่งเพียง id ที่ต้องการ

เส้นทางพี่น้องกัน `GET /applications/:id` ทำถูกอยู่แล้ว — `getApplication` มี
`JOIN inspection_application_schools` และคืน 404 เมื่อโรงเรียนผู้เรียกไม่ได้ผูกกับคำขอนั้น
timeline คือมุมมอง audit ของทรัพยากรเดียวกันโดยที่ join นั้นหายไป

### Evidence

- **File:** `backend/src/routes/verification.routes.js`
- **Lines:** 137-169 (guard เดิมที่บรรทัด 147-154)
- **เทียบกับ:** `backend/src/services/vehicleVerification.service.js:435-455` ซึ่งมี access join ที่ถูกต้อง

### Impact

id ของคำขอเป็น auto-increment แบบเรียงลำดับ และโรงเรียนที่ไม่ได้ผูกกับคำขอได้รับ
**แถวข้อมูลกลับไป ไม่ใช่ 404** ทั้งตารางจึงไล่อ่านได้ทีละ id

สิ่งที่หลุดออกไปคือค่า `old_value` / `new_value` ของ audit ทั้งสี่จุดที่เขียนบันทึกไว้:
เลขที่คำขอ, `vehicle_id`, `issuing_school_id`, `total_schools`, `peak_rider_count`
(ยอดผู้โดยสารของโรงเรียนนั้น), ประวัติสถานะทั้งหมด, เหตุผลการยกเลิก, `admin_override`,
`aborted_attempts` และ `review_notes` ซึ่งเป็นข้อความอิสระที่ผู้ตรวจเขียนไว้ นอกจากนี้
การ JOIN กับตาราง `users` ยังคืน `display_name` และ `role` — คือ **ชื่อเจ้าหน้าที่ของ
โรงเรียนอื่นและของเจ้าหน้าที่ขนส่งที่ดำเนินการเรื่องนั้น**

ไม่มีข้อมูลนักเรียนรายบุคคลอยู่ในชุดนี้ จึงไม่ใช่การรั่วของข้อมูลเด็ก แต่เป็นการข้ามขอบเขต
ระหว่างองค์กรที่ระบบออกแบบมาให้แยกจากกัน

### Fix applied *(28 ส.ค. 2569)*

เพิ่มสาขาสำหรับ role='school' ที่ใช้ access join แบบเดียวกับที่ `getApplication` ใช้อยู่แล้ว:

```js
EXISTS (SELECT 1 FROM inspection_application_schools aps
         WHERE aps.application_id = al.entity_id AND aps.school_id = ?)
```

คง `'TRUE'` ไว้เฉพาะ transport / province / admin ซึ่งมีขอบเขตระดับจังหวัดโดยการออกแบบ
บัญชีโรงเรียนที่ไม่มี `scopeId` จะผูกค่า `null` ซึ่งไม่ตรงกับแถวใด — **fail closed**

### Regression tests

`backend/tests/verificationTimelineScope.unit.test.js` — 10 ข้อ ครอบคลุมทั้งการผูก
access join, การ correlate กับ `al.entity_id`, กรณี scope ว่าง, ครูสายชั้น,
คนขับ (ไม่เปลี่ยน), transport/province/admin (ไม่เปลี่ยน), role นอกรายการ (403),
และจำนวน placeholder เทียบกับ params ทดสอบ negative control แล้ว

### Owner decision

- [x] **Confirmed defect — แก้ไขและขึ้นระบบจริงแล้ว 28 ส.ค. 2569**

---

## 14. Major Findings

## AUD-005: POST /api/visits/track is unauthenticated and has no rate limit at all — the public visit counter can be inflated arbitrarily and the single counter row can be lock-hammered

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** missing-rate-limit
- **Layer:** route (mounted at app.js:169)
- **Affected roles:** unauthenticated
- **Affected entities:** daily_visits
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The route has no authenticate, no optionalAuth and no rate-limit middleware. The prefix '/api/visits' is absent from GLOBAL_API_LIMITED_PREFIXES (app.js:21-35, which lists only driver, school, affiliation, province, transport, verification, documents, admin, readiness, terms, eta, geofences, route-deviations), so the 120/min floor at app.js:126 never applies to it either. Every hit takes a connection from a pool whose connectionLimit is 10 (backend/src/config/database.js:27) and performs a write against one row keyed by visit_date.

### Evidence

- **File:** `backend/src/routes/visits.routes.js`
- **Lines:** 23-42
- **Symbol:** router.post('/track')
- **Caller:** app.js:169 — app.use('/api/visits', require('./routes/visits.routes'))

```js
router.post('/track', async (req, res, next) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  await pool.query(
    `INSERT INTO daily_visits (visit_date, total_visits, public_visits, logged_in_visits)
     VALUES (?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE total_visits = total_visits + 1, ...`,
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

visits.routes.js:23-42 confirmed: `router.post('/track', async (req,res,next) => {...})` with no authenticate, no optionalAuth and no rateLimit on the router or the route; it runs INSERT ... ON DUPLICATE KEY UPDATE against one row keyed by today's visit_date. '/api/visits' is not in GLOBAL_API_LIMITED_PREFIXES (app.js:21-35) and is mounted bare at app.js:167, so the 120/min floor never applies. database.js connectionLimit is 10. The written row is read back by admin.routes.js:695-709 for the admin dashboard's today / 7-day / 30-day visit figures. docs/deployment-hardening.md documents no nginx-level rate limiting, so there is no compensating control in front of it.

### Conflict

app.js:110-113 states the intent — 'A single authenticated token should not be able to hammer any API endpoint unchecked' — but the prefix list at app.js:21-35 omits /api/visits, /api/consent and /api/line, so the stated policy and the mounted middleware disagree.

### Trigger / reproduction steps

1. From any machine, with no token: `for i in $(seq 1 100000); do curl -s -X POST https://<host>/api/visits/track -H 'Content-Type: application/json' -d '{}' & done`
2. Each request returns 201 and increments daily_visits.total_visits / public_visits for today.
3. No 429 is ever returned — verify by reading app.js:21-35 (no '/api/visits' entry) and visits.routes.js (no limiter import).

### Impact

Two effects. (1) Data integrity: the public daily_visits statistic is attacker-controlled — anyone can add millions of 'visits' with a curl loop, and any report or dashboard built on daily_visits becomes meaningless. (2) Availability: every request contends for the SAME InnoDB row (today's visit_date), so concurrent floods serialize on one row lock while holding pooled connections; with connectionLimit 10 this can starve authenticated traffic. scripts/health-smoke.sh tracks Innodb_row_lock_waits as a known-incident baseline, so row-lock pressure is a live concern on this deployment.

### Root cause

'/api/visits' was omitted from GLOBAL_API_LIMITED_PREFIXES and the router defines no limiter of its own; the endpoint is public by design but was never given a throttle or a dedup key.

### Severity justification

Major on the brief's own 'data is partly incorrect' criterion: an anonymous caller with curl can set the visit statistics rendered on the admin dashboard (admin.routes.js:695-709) to any value, with no auth and no throttle anywhere in the stack. The availability angle (every hit takes one of 10 pooled connections and serialises on a single hot InnoDB row shared with all authenticated traffic) is a genuine second failure path. Not critical: no personal data, no auth bypass, nothing destroyed.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Add a dedicated per-IP limiter to visits.routes.js (the endpoint is documented at lines 12-13 as firing ~once per browser session, so a very tight budget is safe), and/or add '/api/visits' to GLOBAL_API_LIMITED_PREFIXES. Consider treating the counter as advisory and computing it from a source that cannot be written by an anonymous caller.

### Required regression tests

- Fire N+1 requests to /api/visits/track from one IP and assert the last one returns 429.
- Assert GLOBAL_API_LIMITED_PREFIXES covers every router mounted in app.js that has no limiter of its own.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-006: Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any request that did not pass through Cloudflare

- **Provisional severity:** major
- **Status:** needs_owner_confirmation
- **Confidence:** medium
- **Category:** rate-limit-bypass
- **Layer:** express trust-proxy + nginx/Cloudflare edge
- **Affected roles:** unauthenticated, admin, province, affiliation, school, transport, driver, parent
- **Affected entities:** users, parent_student, audit_logs
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

With trust proxy = 1 Express takes the SECOND-FROM-RIGHT entry of X-Forwarded-For as req.ip. That is correct for the documented chain client -> Cloudflare -> nginx (docs/deployment-hardening.md:16 confirms nginx proxies /api/ to 127.0.0.1:3000 forwarding X-Forwarded-For), because Cloudflare appends the true client IP and nginx then appends the Cloudflare edge IP. It is NOT correct for a request that reaches nginx directly on the origin IP: then XFF is '<attacker-chosen value>, <attacker IP>' and Express returns the attacker-chosen value as req.ip.

### Evidence

- **File:** `backend/src/app.js`
- **Lines:** 37-43
- **Symbol:** app.set('trust proxy', 1)
- **Caller:** req.ip, consumed by express-rate-limit's default key generator in loginLimiter (auth.routes.js:55), bindLimiter (parent.routes.js:45), qrLimiter (qr.routes.js:17), globalApiLimiter (app.js:114) and by the audit log ipAdd

```js
// trust proxy = 1 strips the rightmost trusted entry (cf-edge), exposing the
// real client IP as req.ip for rate-limit keys + audit logs.
app.set('trust proxy', 1);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

app.js:37-43 confirmed: `app.set('trust proxy', 1)` with a comment describing the client -> Cloudflare -> nginx chain. The analysis is correct — through Cloudflare the true client stays second-from-right and req.ip is right, but on a connection made straight to the origin's nginx the XFF becomes '<attacker value>, <attacker IP>' and Express hands the attacker's chosen value to every per-IP key: loginLimiter and the per-(username+IP) lockout (auth.routes.js:35-52,132), bindLimiter (parent.routes.js), qrLimiter, globalApiLimiter, plus audit_logs.ip_address. One correction to the auditor's framing: the direct-to-backend variant is already closed — backend/src/index.js:15 binds `process.env.HOST || '127.0.0.1'` (loopback by default), which supersedes the 0.0.0.0 note in docs/deployment-hardening.md:21. So the only live vector is a request to nginx on :443 at the origin IP, bypassing Cloudflare.

### Trigger / reproduction steps

1. Precondition to confirm with the owner: the origin's :443 accepts TCP from arbitrary source IPs (not firewalled to Cloudflare ranges), or a hostname/IP resolves past Cloudflare.
2. curl --resolve schoolbuslampang.com:443:<origin-ip> -H 'X-Forwarded-For: 203.0.113.7' https://schoolbuslampang.com/api/auth/login -d '{...}'
3. nginx appends the real source, Express with trust proxy=1 drops it and keys the limiter on 203.0.113.7.
4. Increment the header value each attempt; loginLimiter and the username+IP lockout never trip.

### Impact

Every per-IP control becomes bypassable by rotating a header: loginLimiter (20 attempts / 15 min) and the per-(username+IP) lockout in auth.routes.js:35-52 — whose key is built from req.ip at line 132 — stop constraining password guessing; bindLimiter (12 per 10 min), which is the only brake on guessing a (phone, studentId) pair to link to a child, stops constraining account binding; qrLimiter stops constraining public QR scanning. Audit-log ipAddress values also become attacker-authored, so the forensic record of a login or a QR view is unreliable.

### Root cause

trust proxy = 1 trusts exactly one hop regardless of WHICH host that hop is. It is only safe while the edge is guaranteed to be Cloudflare; nothing in the application enforces that guarantee.

### Severity justification

Major if reachable, and the precondition is unresolved rather than absent: no nginx config is in the repo and docs/deployment-hardening.md marks the host firewall UNKNOWN. If :443 on the origin accepts non-Cloudflare connections, the brake in front of two credential-guessing paths (staff login lockout, parent-child bind) is removed with a rotated header — which matters more than usual given the already-confirmed critical that 404 driver accounts have password == username. Not critical by itself: it grants no access and discloses nothing.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Either (a) restrict the origin to Cloudflare IP ranges and enable Authenticated Origin Pull, then keep trust proxy = 1; or (b) have nginx overwrite (not append) X-Forwarded-For / X-Real-IP from CF-Connecting-IP only when the connection comes from a Cloudflare range, and key the limiters on that value via an explicit keyGenerator instead of the default req.ip. Also move the failed-login lockout out of the in-process Map (auth.routes.js:35) so it survives a restart.

### Required regression tests

- Send a request with a forged X-Forwarded-For directly to the origin and assert req.ip is NOT the forged value.
- Assert loginLimiter trips after 20 attempts even when X-Forwarded-For changes every request.

### Product Owner confirmation question

> Is TCP :443 on the origin server restricted to Cloudflare's published IP ranges (firewall rule or nginx allow/deny), and does nginx set rather than append X-Forwarded-For? If the origin answers requests that did not come through Cloudflare, every per-IP rate limit and the login lockout can be bypassed with a forged X-Forwarded-For header, and audit-log IPs are attacker-authored.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-007: The SPA document is served by nginx, so helmet's headers never reach it — no frame-ancestors / X-Frame-Options protects the operator console

- **Provisional severity:** major
- **Status:** configuration_risk
- **Confidence:** medium
- **Category:** missing-security-headers
- **Layer:** conflict between the Express layer and the nginx layer
- **Affected roles:** admin, province, affiliation, school, transport, driver
- **Affected entities:** SPA document and static assets
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Express does mount helmet before everything, so helmet's X-Frame-Options: SAMEORIGIN, CSP frame-ancestors 'self', nosniff, Referrer-Policy and HSTS are set — but only on responses Express actually produces. The repo's own deployment record says nginx proxies only '/api/ -> 127.0.0.1:3000' (docs/deployment-hardening.md:16) and that 'SPA HTML/asset responses (served by nginx, not the backend) lack security headers' (docs/deployment-hardening.md:22), with helmet scoped to '/api responses' (line 17). The express.static / app.get('*') branch at app.js:198-204 therefore never serves the production HTML. The document's only policy is the meta CSP at frontend/index.html:15, and frame-ancestors is not expressible in a meta CSP (browsers ignore it there) — that policy does not even contain the directive.

### Evidence

- **File:** `backend/src/app.js`
- **Lines:** 46, 198-204
- **Symbol:** app.use(helmet()) / production express.static fallback
- **Caller:** browsers loading https://schoolbuslampang.com/ (the admin, province, affiliation, school, transport and driver console)

```js
app.use(helmet());
...
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => { res.sendFile(path.join(frontendDist, 'index.html')); });
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

app.js:46 mounts helmet() and app.js:198-204 has the express.static + app.get('*') production fallback, but the repo's own deployment record says nginx proxies only /api/ to 127.0.0.1:3000 (docs/deployment-hardening.md:16), that helmet's headers apply to '/api responses' (line 17), and that 'SPA HTML/asset responses (served by nginx, not the backend) lack security headers' (line 22) — so the Express branch does not serve the production HTML. I read frontend/index.html:15: the meta CSP sets default-src/script-src/style-src/font-src/img-src/connect-src/object-src/base-uri/form-action and contains no frame-ancestors (and frame-ancestors is ignored in a meta CSP regardless). No frame-busting script exists anywhere in frontend/src, and there is no nginx config in the repo.

### Conflict

app.js:46 + app.js:198-204 imply Express secures and serves the SPA. docs/deployment-hardening.md:16-22 records that nginx serves the SPA and that helmet only covers /api. The Express branch wins only in a deployment where nginx forwards '/' to the backend, which the doc says is not the case.

### Trigger / reproduction steps

1. Host attacker.example with <iframe src="https://schoolbuslampang.com/admin"></iframe>.
2. Log in to the console in the same browser, then visit attacker.example.
3. The frame renders because no X-Frame-Options and no frame-ancestors reach the document (verify with `curl -sI https://schoolbuslampang.com/` and compare against `curl -sI https://schoolbuslampang.com/api/...`, which does carry helmet's headers).
4. Overlay a transparent clickjack target over a destructive control.

### Impact

The operator SPA can be embedded in an iframe by any website. A page that frames the console and overlays decoy UI can drive a logged-in admin, province or school user into one-click destructive or disclosing actions (approving a registration, revoking a QR, exporting a student roster) without their intent. The same gap removes nosniff and Referrer-Policy from the HTML and asset responses.

### Root cause

helmet is applied inside the Node process, but the production entry point for the HTML is nginx, which the repo does not configure with any add_header. The Express SPA-serving branch exists in code (app.js:198-204) but is shadowed by nginx, so the security headers it would have carried are lost.

### Severity justification

A concrete, attacker-initiated path exists with no precondition I cannot verify: the operator SPA has no anti-framing control of any kind, and the repo's own audit doc records the gap as still open. A framed, logged-in admin/province/school session can be driven into state-changing actions they did not intend (the token is in the framed origin's own storage, so the session is live). Confirm dialogs raise the effort but do not prevent multi-overlay clickjacking. Not critical: it needs social engineering and an already-authenticated victim, and no data flows back to the attacker. Fix is one nginx add_header (X-Frame-Options DENY / CSP frame-ancestors 'none') on the SPA location.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Decide one owner for document headers. If nginx keeps serving the SPA, add `add_header X-Frame-Options "DENY" always;`, `add_header X-Content-Type-Options "nosniff" always;`, `add_header Referrer-Policy "no-referrer" always;` and a real `Content-Security-Policy` header including `frame-ancestors 'none'` to both server blocks. If instead nginx is changed to proxy '/' to Express, helmet already covers it — but then finding about helmet's img-src/connect-src being narrower than the SPA's needs must be resolved first (see the CSP finding).

### Required regression tests

- `curl -sI https://<host>/` asserts X-Frame-Options and a CSP containing frame-ancestors are present.
- A smoke check comparing the header set on '/' against the header set on '/api/health-ish' so the two layers cannot silently diverge again.

### Product Owner confirmation question

> Which process actually serves index.html in production — nginx from disk, or the Express fallback at app.js:202? If nginx, will you accept adding X-Frame-Options / CSP frame-ancestors / nosniff / Referrer-Policy as nginx add_header directives (the optional block already drafted at docs/deployment-hardening.md, section 3), or should nginx proxy '/' to the backend so helmet covers it?

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-008: Logout cannot invalidate the access token — it stays valid for the full 24h after the user logs out

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** session-invalidation
- **Layer:** route + middleware
- **Affected roles:** admin, province, affiliation, school, transport, driver
- **Affected entities:** users, revoked_tokens
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Logout revokes only the refresh token's jti. The ACCESS token carries no jti at all (generateAccessToken, lines 74-91, signs sub/username/role/scopeType/scopeId/gradeScope/displayName/mustChangePassword and nothing else), and middleware/auth.js:34-116 consults revoked_tokens nowhere — its only kill switches are users.is_active and users.password_changed_at. Nothing in the logout handler touches either. JWT_EXPIRES_IN is 24h (backend/.env.example:22).

### Evidence

- **File:** `backend/src/routes/auth.routes.js`
- **Lines:** 393-420 (with generateAccessToken at 73-92)
- **Symbol:** POST /api/auth/logout
- **Caller:** frontend/src/hooks/useAuth.jsx:42-51 (logout())

```js
if (payload && payload.type === 'refresh' && payload.jti) {
  const expiresAt = expToDate(payload.exp);
  await pool.query(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at) ... ` ,
    [payload.jti, req.user.id, expiresAt]
  );
}
return sendSuccess(res, null, 'Logged out successfully');
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

auth.routes.js:393-420: the logout handler inserts only the presented REFRESH token's jti into revoked_tokens; with no refresh_token in the body it returns 'Logged out' having done nothing. generateAccessToken (74-91) signs sub/username/role/scopeType/scopeId/gradeScope/displayName/mustChangePassword — no jti, so an access token is not addressable for revocation. middleware/auth.js:34-116 never queries revoked_tokens; its per-request DB check (line 70) reads only is_active, must_change_password, driver_id and password_changed_at. JWT_EXPIRES_IN=24h (backend/.env.example:22). The auditor is right that the machinery exists next door: auth.js:88-93 hard-invalidates access tokens whose iat predates password_changed_at.

### Expected logic

Logout should end the session. The owner must confirm whether a 24h window of continued validity after an explicit logout is acceptable for a system holding student PII.

### Trigger / reproduction steps

1. Log in, capture the access token
2. POST /api/auth/logout with the refresh token → 200
3. Replay the captured access token against any authenticated endpoint, e.g. GET /api/auth/me → still 200 until the 24h expiry

### Impact

An access token captured before logout keeps working for up to 24 hours afterwards — on a shared or school-lab browser, from a browser-extension or proxy capture, or from a token pasted into a support ticket. The user's own 'log out' gesture provides no protection, and there is no server-side way for an operator to kill a live session short of disabling the account (is_active) or resetting the password (password_changed_at), both of which are heavier and visible to the user. Note the codebase already built the exact machinery needed — auth.js:88-93 hard-invalidates access tokens whose iat predates password_changed_at — but logout does not use it.

### Root cause

The revocation design covers only the refresh token family; access tokens are treated as short-lived and unrevocable, but the configured lifetime (24h) is not short.

### Severity justification

Major: a core function is wrong — the one session control a non-technical school user has does nothing to the credential that actually authorizes requests, for a full 24h, on shared school machines. Not critical: it is a containment failure that presupposes the attacker already holds the token, not an authn bypass.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. Either (a) add a jti to the access token and check revoked_tokens in authenticate() — one extra indexed lookup on a request that already does a users lookup, so it can be folded into the same query, or (b) reuse the existing pattern: have logout stamp a users.sessions_invalidated_at (or bump password_changed_at semantics into a separate column) and extend the auth.js:88-93 guard to it. Independently, reconsider JWT_EXPIRES_IN=24h.

### Required regression tests

- After POST /api/auth/logout, a request carrying the same access token must return 401
- POST /api/auth/refresh-token with the logged-out refresh token must return 401 (already passes today)

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-009: Refresh-token rotation is broken end to end: the backend revokes the old refresh token, the frontend never stores the new one, so every session is force-logged-out at its second refresh

- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** layer-conflict
- **Layer:** frontend/backend contract
- **Affected roles:** admin, province, affiliation, school, transport, driver
- **Affected entities:** revoked_tokens
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The backend rotates on every refresh: it mints a new refresh token AND inserts the presented jti into revoked_tokens (auth.routes.js:369-374), returning both access_token and refresh_token. The client reads only res.data.data.access_token and writes only 'access_token'; the returned refresh_token is discarded. localStorage 'refresh_token' is written exactly once, at login (frontend/src/hooks/useAuth.jsx:31). So the second refresh presents the same, now-revoked, jti, hits the revocation check at auth.routes.js:334-340, gets 401 'Refresh token has been revoked', and the interceptor's catch runs localStorage.clear() + window.location.href = '/login' (axios.js:90-95).

### Evidence

- **File:** `frontend/src/api/axios.js`
- **Lines:** 81-89 (backend counterpart: backend/src/routes/auth.routes.js:364-385)
- **Symbol:** api.interceptors.response 401 handler
- **Caller:** every authenticated API call in the SPA

```js
const res = await axios.post('/api/auth/refresh-token', {
  refresh_token: localStorage.getItem('refresh_token'),
});
const newToken = res.data.data.access_token;
localStorage.setItem('access_token', newToken);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Backend auth.routes.js:364-385 mints a new refresh token AND inserts the presented jti into revoked_tokens, returning both tokens. Frontend axios.js:81-89 reads only `res.data.data.access_token` and writes only 'access_token'; the returned refresh_token is dropped. grep over frontend/src shows localStorage 'refresh_token' is written exactly once, at useAuth.jsx:31 (login); axios.js:82 and ChangePassword.jsx:41 only read it. So refresh #2 replays the revoked jti, hits the revocation check at auth.routes.js:333-340, gets 401, and axios.js:88-95 runs localStorage.clear() + window.location.href='/login'.

### Expected logic

Owner question is not needed here — the two layers state contradictory intentions in their own comments, so one of them is wrong. The backend comment (auth.routes.js:366-368) says a stolen refresh token should be 'valid for a single use instead of the full 7-day window'; JWT_REFRESH_EXPIRES_IN is 7d, implying sessions should survive a week.

### Conflict

backend/src/routes/auth.routes.js:369-374 revokes the presented refresh jti on every rotation; frontend/src/api/axios.js:84-85 persists only the access token. At runtime the backend wins: the client's stored refresh token is dead after the first refresh, and the user is logged out on the next one.

### Trigger / reproduction steps

1. Log in in the SPA; note localStorage.refresh_token = R1
2. Force an access-token 401 (wait out JWT_EXPIRES_IN, or delete access_token) → interceptor refreshes; backend revokes R1 and returns R2; client keeps R1
3. Force a second 401 → POST /api/auth/refresh-token with R1 → 401 'Refresh token has been revoked' → localStorage.clear() and redirect to /login

### Impact

With JWT_EXPIRES_IN=24h, a session survives the first access-token expiry (refresh #1 succeeds) and is then hard-kicked to the login screen at the next expiry (refresh #2), losing any unsaved work in the tab. The configured 7-day refresh window is unreachable — the effective ceiling is roughly two access-token lifetimes. It also silently defeats the security intent of rotation: the client keeps re-presenting a dead token instead of a fresh one, so rotation buys nothing and only produces spurious logouts. This is the 'layers disagree on a rule' case in the brief.

### Root cause

Rotation was added on the backend (commented as a 'Medium fix') without the corresponding client change; the client-side refresh handler predates rotation and only ever knew about access_token.

### Severity justification

Major: the two layers disagree on the rotation rule, a deliberate security control (single-use refresh tokens) is inert, and the effective session ceiling is ~two access-token lifetimes instead of the configured 7 days — every SPA user is hard-kicked to login mid-work with no warning. Not critical: no data exposure, no authz bypass.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. In axios.js, persist the rotated token: read res.data.data.refresh_token and localStorage.setItem('refresh_token', ...) alongside the access token, inside the same try block, before processQueue. Verify the single-flight queue (isRefreshing/pendingQueue) still holds so two concurrent 401s cannot both spend the token.

### Required regression tests

- After an interceptor-driven refresh, localStorage.refresh_token must differ from its pre-refresh value
- Two consecutive forced refreshes must both succeed and must not redirect to /login

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-010: trust proxy = 1 is off by one for the documented Cloudflare→nginx chain: req.ip resolves to the Cloudflare edge IP, not the client

- **Provisional severity:** major
- **Status:** configuration_risk
- **Confidence:** medium
- **Category:** proxy-trust
- **Layer:** config
- **Affected roles:** admin, province, affiliation, school, transport, driver
- **Affected entities:** audit_logs
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The comment's own premise is that XFF arrives as `<client>, <cf-edge>` with the socket peer being nginx on 127.0.0.1 — two proxy hops in front of the app. Express's numeric trust means 'trust N hops', so with 1 it trusts only nginx and stops at the next address, which is the Cloudflare edge. I verified this against the repo's own installed proxy-addr (express 4.22.2): with remoteAddress 127.0.0.1 and XFF '203.0.113.9, 172.68.1.1', trust=1 yields req.ip = 172.68.1.1 (the cf-edge), and trust=2 yields 203.0.113.9 (the client). The value needed to produce the documented behaviour is 2, not 1.

### Evidence

- **File:** `backend/src/app.js`
- **Lines:** 37-43
- **Symbol:** app.set('trust proxy', 1)
- **Caller:** every rate limiter (auth.routes.js:55-69 loginLimiter, app.js:114-121 globalApiLimiter), the per-account lockout key (auth.routes.js:37-39), and every logAudit ipAddress argument

```js
// nginx appends `$remote_addr` (= Cloudflare edge IP) via
// proxy_add_x_forwarded_for, so XFF arrives as `<client>, <cf-edge>`.
// trust proxy = 1 strips the rightmost trusted entry (cf-edge), exposing the
// real client IP as req.ip for rate-limit keys + audit logs.
app.set('trust proxy', 1);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

app.js:37-43 carries exactly the quoted comment and `app.set('trust proxy', 1)`. Taking the comment's own premise (socket peer = nginx on 127.0.0.1, XFF = '<client>, <cf-edge>'), proxy-addr builds [127.0.0.1, cf-edge, client] and a numeric trust of 1 stops at index 1 = the cf-edge, so req.ip is the Cloudflare address and 2 would be needed. app.js:114-126 confirms globalApiLimiter is 120/min per IP over 13 /api prefixes; auth.routes.js:54-60 confirms loginLimiter 20/15min per IP; auth.routes.js:152-177 confirms every failed-login audit row records req.ip. Caveat the auditor did not state: the current value fails SAFE — if an attacker reaches the origin directly and injects XFF, trust=1 still resolves to their real address, whereas trust=2 would let them spoof past the limiter. The nginx site config is not in the repo, so the chain itself is asserted only by this comment.

### Expected logic

req.ip should be the end client, as the comment intends, so rate-limit buckets and audit records are per-user.

### Trigger / reproduction steps

1. Send a request through the production chain and log req.headers['x-forwarded-for'] alongside req.ip
2. Compare req.ip to the leftmost XFF entry — they will differ, with req.ip equal to the Cloudflare edge address
3. Equivalent local check (already run): node -e with proxy-addr, remoteAddress 127.0.0.1, XFF '203.0.113.9, 172.68.1.1', trust (a,i)=>i<1 → 172.68.1.1

### Impact

Two consequences, both real. (1) Rate-limit collapse into shared buckets: loginLimiter is 20 requests / 15 min keyed on req.ip, so every user arriving through the same Cloudflare PoP shares one bucket — a handful of failed logins from one school can lock out an entire region's users from /api/auth/login with a 429, and the same applies to the 120/min globalApiLimiter across the /api/{school,affiliation,province,admin,...} prefixes. (2) Audit corruption: every logAudit call passes req.ip (e.g. auth.routes.js:154, 165, 177 on failed logins), so audit_logs.ip_address records a Cloudflare edge address for every event. Any PDPA incident investigation that tries to attribute an action to a source is working from the wrong IP.

### Root cause

Numeric trust proxy counts hops from the socket outward; the comment reasons about it as 'strip the rightmost entry', which is the trust=2 behaviour for a two-hop chain.

### Severity justification

Major: a described availability failure path (province-wide traffic collapsing into a handful of shared 120/min and 20/15min buckets, producing 429s for legitimate users) plus systematically falsified ip_address on every audit row — the brief treats the audit trail as significant. Not critical: it over-throttles rather than under-throttles, so it is not a brute-force or authn bypass. Note for the fix: raising it to 2 is only safe once origin ingress is restricted to Cloudflare.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. Confirm the live XFF shape first (log req.headers['x-forwarded-for'] and req.ip on one request through the real chain). If it matches the documented `<client>, <cf-edge>`, set trust proxy to 2, or better, key on Cloudflare's CF-Connecting-IP after validating the peer, and re-check that req.ip is a client address in both the rate-limit key and audit output.

### Required regression tests

- A request with XFF '<client>, <edge>' from 127.0.0.1 must yield req.ip === '<client>'
- Two requests with different leftmost XFF values must land in different rate-limit buckets

### Product Owner confirmation question

> Operations: what is the actual production request chain and the exact nginx proxy_set_header X-Forwarded-For directive? The nginx config is not in this repository, so the hop count cannot be confirmed from the code alone — docs/deployment-hardening.md line 16 only states that nginx sets X-Real-IP/X-Forwarded-For.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-011: IDOR: any school account can read another school's inspection-application audit timeline (no scope predicate)

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** cross-tenant-read
- **Layer:** route handler (backend/src/routes)
- **Affected roles:** school
- **Affected entities:** vehicle_inspection_applications, audit_logs, users
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

authenticate (line 14) + requireRole('school','transport','province','admin','driver') (line 140) are the only gates. A driver-only ownership guard is folded into the SQL (lines 147-154); for every other role driverGuard is the literal string 'TRUE', so the WHERE clause is just al.entity_type='vehicle_inspection_application' AND al.entity_id = <caller-supplied id>. No inspection_application_schools / issuing_school_id join constrains the row to the caller's scope_id.

### Evidence

- **File:** `backend/src/routes/verification.routes.js`
- **Lines:** 138-169
- **Symbol:** GET /api/verification/applications/:id/timeline
- **Caller:** frontend RegistrationDetail / vehicle-verification screens; reachable directly with any school-role JWT

```js
const isDriver = req.user.role === 'driver';
const driverGuard = isDriver
  ? `EXISTS (SELECT 1 FROM vehicle_inspection_applications a
              WHERE a.id = al.entity_id AND a.requested_by = ?)`
  : 'TRUE';
...
  WHERE al.entity_type = 'vehicle_inspection_application'
    AND al.entity_id = ?
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

verification.routes.js:138-169 confirmed. router.use(authenticate) at :14 and requireRole('school','transport','province','admin','driver') at :140 are the only gates. The ownership guard at :145-154 is built ONLY for role 'driver'; for every other role driverGuard is the literal string 'TRUE', so the WHERE reduces to entity_type='vehicle_inspection_application' AND entity_id = <caller-supplied :id>. No join to issuing_school_id or scopeId. I checked the payloads that come back: vehicleVerification.service.js:365-377 and :1134-1147 log request_no, vehicle_id, issuing_school_id, total_schools, peak_rider_count; :589-600 and :1226-1234 log status transitions with cancellation reasons and review_notes; the SELECT also returns u.display_name and u.role of the other organisation's staff, raw (no redactAuditValue).

### Expected logic

A school caller should be constrained exactly as the sibling detail endpoint is: vehicleVerification.service.js getApplication (lines 435-443) adds `JOIN inspection_application_schools access_school ON access_school.application_id = a.id AND access_school.school_id = ?` for isSchool. The timeline reads the same resource and should carry the same predicate.

### Trigger / reproduction steps

1. Log in as a school account (role='school', scope_id='SCHOOL_A').
2. Note that GET /api/verification/applications/<id-belonging-to-SCHOOL_B> correctly returns 404 'ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ดูคำขอนี้' (getApplication's access_school join).
3. Call GET /api/verification/applications/<same id>/timeline with the same Bearer token.
4. Observe HTTP 200 with the full audit trail of School B's application, including actor_name / actor_role and unredacted new_value JSON.
5. Iterate :id to enumerate every application in the province.

### Impact

School A enumerates ids 1..N and reads School B's inspection-application history: request_no, vehicle_id, issuing_school_id, total_schools, peak_rider_count (audit payload at vehicleVerification.service.js:370-376 and :1139-1145), every status transition with cancellation reasons and reviewer notes (:594-599, :1232), plus u.display_name and u.role of the other organisation's staff who acted. old_value/new_value are returned raw — this handler does not call redactAuditValue, unlike the province and affiliation audit-log endpoints.

### Root cause

The driver ownership fix (added per the comment at lines 143-146) was applied only to the driver branch; the school branch was left with the constant TRUE and no equivalent join was added.

### Severity justification

Genuine cross-tenant read with a trivial attack path (enumerate :id as any school account). Held at major rather than critical because the critical bar names cross-tenant access to STUDENT PERSONAL DATA: I read the audit payloads and they are inspection-workflow metadata, counts, notes and staff names — no student identity — and the path is read-only. If the Product Owner classes inter-school inspection metadata or staff names as confidential, this becomes critical.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Give the school branch the same scope predicate the detail getter uses: add `AND EXISTS (SELECT 1 FROM vehicle_inspection_applications a JOIN inspection_application_schools aps ON aps.application_id = a.id WHERE a.id = al.entity_id AND aps.school_id = ?)` when req.user.role === 'school', bound to req.user.scopeId, and pass old_value/new_value through utils/exportSecurity.redactAuditValue as province.routes.js:241-245 does. Better still, route the timeline through vehicleVerification.service so one scope function serves both endpoints.

### Required regression tests

- School A requests the timeline of an application whose inspection_application_schools rows contain only School B → expect 404/403 and an empty body, not 200.
- School A requests the timeline of its own application → expect 200 with rows.
- Driver timeline ownership guard still returns 404 for an application requested_by another driver (do not regress the existing fix).
- Add the assertion to backend/tests/crossSchoolIsolation.test.js, which currently covers only /api/school/{students,vehicles,status-today,dashboard}.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-012: GET /api/school/no-show ignores grade_scope while every sibling endpoint in the same file applies it

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** scope-bypass
- **Layer:** route handler + service signature
- **Affected roles:** school (grade-teacher sub-account)
- **Affected entities:** students, checkin_logs, student_leaves, vehicles
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The handler never calls resolveGradeScope(req), and checkin.service.js getNoShowStudents (lines 879-899) has no gradeFilter parameter at all — its WHERE is `s.school_id = ? AND s.is_deleted = FALSE AND <session>_enabled = TRUE ...` with no grade predicate. Every neighbouring school read (lines 167, 204, 224, 240, 267, 284, 312, 434, 505, 521, 558, 664, 1833) does call resolveGradeScope.

### Evidence

- **File:** `backend/src/routes/school.routes.js`
- **Lines:** 182-191
- **Symbol:** GET /api/school/no-show → checkin.service.getNoShowStudents
- **Caller:** school no-show / dashboard follow-up view; reachable with any school-role JWT

```js
router.get('/no-show', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    ...
    const students = await checkinSvc.getNoShowStudents(pool, { schoolId, session, date });
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

school.routes.js:181-191 confirmed: the handler calls resolveSchoolId(req) but never resolveGradeScope(req), unlike its neighbours at lines 167, 204, 224, 240, 267, 284, 312, 434, 505, 521, 558. router.use at :157 admits role 'school' (which includes teacher sub-accounts — resolveGradeScope at :68-74 returns req.user.gradeScope for non-admins). checkin.service.js:879-899 getNoShowStudents takes no grade parameter at all; its WHERE is school_id + is_deleted + session-enabled + vehicle assigned + NOT EXISTS check-in + NOT EXISTS leave, and it SELECTs s.prefix, s.first_name, s.last_name, s.grade, s.classroom, s.vehicle_id, v.plate_no.

### Expected logic

Same as /missing and /leaves: narrow to the teacher's grade when req.user.gradeScope is set.

### Trigger / reproduction steps

1. Create a teacher sub-account via POST /api/school/teacher-accounts with grade_scope='ป.4' (school.routes.js:1886).
2. Log in as that teacher; the JWT carries gradeScope='ป.4' (auth.routes.js:83).
3. GET /api/school/students → correctly returns only ป.4 students.
4. GET /api/school/no-show?session=morning → returns students from every grade in the school, with full names.

### Impact

A ป.4 homeroom teacher calling GET /api/school/no-show?session=morning receives id, prefix, first_name, last_name, grade, classroom, vehicle_id and plate_no for every student in the school who has not boarded — i.e. named children of other grades, together with the operationally sensitive fact that they are unaccounted for this morning.

### Root cause

getNoShowStudents was added without the gradeFilter parameter that school.service.js and pickupPoint.service.js functions all carry, so the route had nothing to pass.

### Severity justification

Real authz-scope defect, same rule violation as the lead's critical #3 and part of the same remediation sweep. Held at major rather than promoted: the reader is staff of the same school (not a cross-tenant actor), the disclosure is bounded to the subset of children who have not boarded in one session rather than a full roster, and there is no export path. It should be fixed in the same pass as the /api/reports gap.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Add `const gradeFilter = resolveGradeScope(req);` to the handler and a gradeFilter option to checkin.service.getNoShowStudents that appends `AND s.grade IN (...)` using utils/gradeScope.gradeEquivalents(gradeFilter), matching school.service.getStudents:213-215.

### Required regression tests

- Teacher (grade_scope='ป.4'): /no-show returns only ป.4 students, including one stored as 'ประถมศึกษาปีที่ 4'.
- Full-school account: /no-show result set unchanged.
- Admin with ?school_id=X: unchanged.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-013: Grade-scope filter uses exact `s.grade = ?` in four paths where the rest of the system uses tolerant gradeEquivalents matching

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** scope-consistency
- **Layer:** service + route SQL
- **Affected roles:** school (grade-teacher sub-account)
- **Affected entities:** students, student_leaves, roster_change_requests, vehicle_latest_locations
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

gradeFilter is the canonical Thai form from the JWT ('ป.4'). students.grade is stored inconsistently — school.service.js:209-212 documents "'ป.5' vs 'ประถมศึกษาปีที่ 5' vs 'ป. 5'" — which is why school.service.js (lines 34, 213, 274, 327, 391) and pickupPoint.service.js (67, 351, 377, 454, 726) expand the filter with utils/gradeScope.gradeEquivalents() and `IN (...)`. These four call sites compare with `=` against the canonical string only.

### Evidence

- **File:** `backend/src/services/leave.service.js`
- **Lines:** 137
- **Symbol:** getLeavesForSchool (and school.routes.js:522 /missing, vehicleLocation.service.js:202 listForSchool, rosterRequest.service.js:194 getRequestsForSchool)
- **Caller:** GET /api/school/leaves (school.routes.js:553), GET /api/school/missing (515), GET /api/school/live-vehicles (1825), GET /api/school/roster-requests (659)

```js
// leave.service.js:137
const gradeAnd = gradeFilter ? ' AND s.grade = ?' : '';
// school.routes.js:522
const gradeAnd  = gradeFilter ? ' AND s.grade = ?' : '';
// vehicleLocation.service.js:202
const subqueryGrade = gradeFilter ? ' AND s.grade = ?' : '';
// rosterRequest.service.js:194
WHERE sx.id = rcr.student_id AND sx.grade = ?
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

All four sites confirmed: leave.service.js:137 (`' AND s.grade = ?'` in getLeavesForSchool), school.routes.js:521-522 and :536 (/missing), vehicleLocation.service.js:201-210 (listForSchool subquery), rosterRequest.service.js:190-201 (`sx.grade = ?` plus a JSON_EXTRACT equality for the new-student case). gradeFilter is the canonical JWT value ('ป.4'). utils/gradeScope.js:30-65 documents the stored variants ('ป.5', 'ประถมศึกษาปีที่ 5', 'ป. 5', 'อบ.2', Thai digits) and exposes gradeEquivalents(); school.service.js:29-36 and 209-216 and pickupPoint.service.js use it with `IN (...)`, with an explicit in-code note that these counts 'previously used exact = ? and under-counted variant-form grades'. So the tolerant path is the codebase's own established rule and these four sites violate it.

### Expected logic

All grade-scoped predicates use gradeEquivalents(), as backend/tests/gradeScopeCounts.test.js asserts for the list, dashboard and status-today paths ('student LIST returns the variant-grade student', 'DASHBOARD total_students matches the list total (no under-count of the variant)').

### Conflict

utils/gradeScope.gradeEquivalents is the project's stated matching rule (documented at gradeScope.js:54-56 and school.service.js:209-212) and is exercised by tests/gradeScopeCounts.test.js; these four sites implement a different rule. At runtime whichever query the screen hits decides what the teacher sees, so two screens disagree about the same roster.

### Impact

For any school whose students.grade rows are stored in long form, a homeroom teacher's /leaves, /missing, /live-vehicles and /roster-requests silently return zero or partial rows while /students for the same teacher returns the full grade. The failure is under-inclusive (fails closed for privacy) but it makes core supervision functions wrong and the wrongness is invisible — the teacher sees an empty 'missing students' list and concludes every child is accounted for.

### Severity justification

Major on two of the brief's own criteria: two layers disagree on one rule, and a core function returns partly incorrect data. The under-inclusive failure is silent and lands on /missing — the list a teacher uses to find a child who never boarded, where an empty result reads as 'everyone is accounted for'. Not critical: the filter is over-restrictive, so nothing is over-exposed.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Replace the four `= ?` predicates with `IN (?)` bound to gradeEquivalents(gradeFilter) (mysql2 expands an array for `IN (?)`, exactly as pickupPoint.service.js:377 and :454 already do), and extend tests/gradeScopeCounts.test.js to cover /leaves, /missing, /live-vehicles and /roster-requests.

### Required regression tests

- Seed one student with grade='ประถมศึกษาปีที่ 4' and a teacher with grade_scope='ป.4'; assert that student appears in /api/school/missing, /api/school/leaves (after a leave is recorded), /api/school/live-vehicles (their vehicle listed) and /api/school/roster-re
- Assert a ป.5 student never appears for the ป.4 teacher in any of the four endpoints (no widening).

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-014: Migration 042 creates a NON-UNIQUE index despite its filename, its comments, and the application code that depends on it being UNIQUE

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** missing-unique-constraint
- **Layer:** database-schema
- **Affected roles:** school, admin, parent
- **Affected entities:** parents, parent_student, students
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The file is named 042_parent_phone_unique.sql, its header says "parents.phone unique key", and line 16 says "Unique index on the active phone — prevents duplicate active parents." But the DDL on lines 17-18 is `ADD INDEX`, not `ADD UNIQUE KEY`. The `uq_` prefix is naming only; MySQL creates an ordinary non-unique secondary index. Nothing prevents two active parents rows with the same phone. The generated column `active_phone` added on lines 11-14 is therefore decorative.

### Evidence

- **File:** `backend/migrations/042_parent_phone_unique.sql`
- **Lines:** 16-18
- **Symbol:** ALTER TABLE parents ADD INDEX uq_parents_active_phone
- **Caller:** backend/src/services/studentImportPreview.service.js:290-316 — function linkParent(conn, studentId, name, phone, userId)

```js
-- Unique index on the active phone — prevents duplicate active parents.
ALTER TABLE parents
  ADD INDEX uq_parents_active_phone (active_phone);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

backend/migrations/042_parent_phone_unique.sql:11-14 adds the STORED generated column active_phone, and lines 16-18 read exactly `-- Unique index on the active phone` followed by `ALTER TABLE parents ADD INDEX uq_parents_active_phone (active_phone);`. ADD INDEX, not ADD UNIQUE KEY — MySQL creates an ordinary secondary index; the uq_ prefix is naming only. studentImportPreview.service.js:290-315 does SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1, then INSERTs on a miss, with a catch whose comment says 'The unique index (migration 042) makes the second INSERT fail with ER_DUP_ENTRY'. Since no unique constraint exists, that ER_DUP_ENTRY branch is unreachable and the check-then-insert race the migration was written to close is fully open.

### Expected logic

Per the migration's own stated intent, the index should be `ADD UNIQUE KEY uq_parents_active_phone (active_phone)` so that a second concurrent INSERT of the same active phone fails with ER_DUP_ENTRY.

### Trigger / reproduction steps

1. Confirm the DDL: read backend/migrations/042_parent_phone_unique.sql lines 16-18 — the statement is `ADD INDEX`, not `ADD UNIQUE KEY`.
2. Confirm the code depends on uniqueness: read backend/src/services/studentImportPreview.service.js lines 305-315 — the catch block comment states the unique index makes the second INSERT fail with ER_DUP_ENTRY.
3. On a live DB, run `SHOW CREATE TABLE parents` and observe `KEY uq_parents_active_phone (active_phone)` rather than `UNIQUE KEY`.
4. Trigger two concurrent student-import apply runs for two siblings that share one guardian phone; both pass the SELECT at studentImportPreview.service.js:285 and both INSERT.
5. Run `SELECT active_phone, COUNT(*) FROM parents WHERE active_phone IS NOT NULL GROUP BY active_phone HAVING COUNT(*) > 1` — rows are returned.

### Impact

The check-then-insert race the migration was written to close is still open. linkParent() does `SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1` (line 285-287), and on miss INSERTs. Its catch block (lines 305-315) explicitly comments "The unique index (migration 042) makes the second INSERT fail with ER_DUP_ENTRY — re-fetch the winning row." That catch is dead code: ER_DUP_ENTRY can never be raised by this insert. Two concurrent student imports for siblings sharing a guardian phone both pass the SELECT and both INSERT, producing duplicate parents rows. Downstream, studentImportPreview.service.js:485-487 resolves a parent by `SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1` and gets an arbitrary one of the duplicates, so a later guardian-name update lands on one row while parent_student links point at the other. The parent record for a child becomes split and non-deterministic.

### Root cause

`ADD INDEX` was written where `ADD UNIQUE KEY` was intended. The `uq_` name prefix made the mistake invisible in review, and no test asserts the constraint's uniqueness.

### Severity justification

Meets the major bar on two counts from the brief: two layers disagree on a rule (the migration and the service both believe a unique constraint exists; the DDL does not create one), and a race condition with a documented mitigation that is dead code. Not critical: duplicate parents rows corrupt guardian master data but cross no authorization boundary — checkin.service.js:404-419 resolves recipients with SELECT DISTINCT lu.line_user_id, so duplicates do not double-notify or expose one family's child to another.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. First run the duplicate report `SELECT active_phone, COUNT(*) FROM parents WHERE active_phone IS NOT NULL GROUP BY active_phone HAVING COUNT(*) > 1` and have the school owner merge or soft-delete the losers (this is a data decision, not a code decision). Only once that returns zero rows, add a new forward migration converting the index to `ADD UNIQUE KEY`. Do not edit 042 in place — its checksum is what schema_migrations tracks.

### Required regression tests

- Integration test: insert two parents rows with the same non-empty phone and is_deleted=FALSE; assert the second throws ER_DUP_ENTRY.
- Schema assertion test: query information_schema.statistics for parents/uq_parents_active_phone and assert NON_UNIQUE = 0.
- Concurrency test: run two linkParent() calls with the same phone on separate connections and assert exactly one parents row results.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-015: The test database is built from a mysqldump that is seven migrations behind, so migrations 042-048 are never executed or exercised by any test

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** schema-drift
- **Layer:** test-infrastructure
- **Affected roles:** admin, school, driver
- **Affected entities:** all tables, parents, users, students, vehicle_documents, driver_documents, audit_logs_archive, checkin_logs_archive, registration_roster_students
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The test DB is created from backend/tests/schema.sql — a mysqldump of an existing database with migration 040/041 hand-appended at lines 1074-1200 — and never by replaying backend/migrations/*.sql. I diffed the dump against the migration set. Migrations 042 through 048 are entirely absent from it: (a) 042 — the `parents` table at schema.sql:591-602 has no `active_phone` column and no uq_parents_active_phone index at all; (b) 043 — `password_changed_at` at schema.sql:842 is still `timestamp NULL DEFAULT NULL`, not the NOT NULL DEFAULT CURRENT_TIMESTAMP that 043 sets; (c) 044 — students at schema.sql:773-803 has no health_note, guardian_phone_alt, or home_address columns, and registration_roster_students does not exist; (d) 045 — vehicle_documents and driver_documents do not exist; (e) 047 — audit_logs_archive and checkin_logs_archive do not exist; (f) 046/048 — no terms seed rows are pres

### Evidence

- **File:** `backend/scripts/prepare-test-db.js`
- **Lines:** 16, 45-48, 66-75
- **Symbol:** prepare-test-db.js main() / expectedTableCount()
- **Caller:** npm run test:prepare and npm run test:ci (backend/package.json:12-14); every DB-backed jest integration test depends on the database this script builds

```js
const SCHEMA_PATH = path.join(__dirname, '../tests/schema.sql');
...
  await connection.query('DROP DATABASE IF EXISTS `lampang_bus_test`');
  await connection.query('CREATE DATABASE `lampang_bus_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.changeUser({ database: 'lampang_bus_test' });
  await connection.query(loadSchema(raw));
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

prepare-test-db.js:16 sets SCHEMA_PATH to ../tests/schema.sql and main() (lines 50-78) drops and recreates lampang_bus_test purely from that dump — migrations/*.sql is never replayed. I grepped the dump for the artefacts of 042-048: active_phone (042) absent; password_changed_at at schema.sql:842 is still `timestamp NULL DEFAULT NULL` rather than the NOT NULL DEFAULT that 043 sets; health_note / guardian_phone_alt / home_address (044) absent; the 045 driver/vehicle document tables absent; audit_logs_archive and checkin_logs_archive (047) absent. .github/workflows/full-quality.yml:54 runs `npm run test:ci`, which is exactly this stale-dump path.

### Expected logic

The test database should be built by replaying backend/migrations/*.sql in order, so that every migration is executed at least once in CI and any migration that fails, is non-idempotent, or conflicts with an earlier one is caught before it reaches production.

### Trigger / reproduction steps

1. Read backend/scripts/prepare-test-db.js:16 — the schema source is ../tests/schema.sql, not ../migrations.
2. grep backend/tests/schema.sql for `active_phone` (042), `health_note` (044), `vehicle_documents` (045), `audit_logs_archive` (047) — all return nothing.
3. Read backend/tests/schema.sql:842 — password_changed_at is still `timestamp NULL DEFAULT NULL`, contradicting 043_password_changed_at_backfill.sql:14-16.
4. Read backend/scripts/prepare-test-db.js:45-48 — expectedTableCount() counts CREATE TABLE statements in the dump itself, so the count check compares the dump to itself.
5. Run npm run test:prepare; it prints ready with the dump's own table count and reports no drift.

### Impact

Migrations 042-048 have never been proven to execute successfully anywhere in this repository's automation. Concretely: no DB-backed test can exercise the driver-document or vehicle-document upload paths (services/driverDocuments.service.js) because those tables do not exist in the test DB; cleanup-old-logs.js:30-31, which does `INSERT IGNORE INTO audit_logs_archive SELECT * FROM audit_logs`, cannot run in the test DB because the archive tables do not exist; and any test asserting session invalidation after password change passes vacuously, because with password_changed_at NULL the guard at middleware/auth.js:88 (`if (dbUser.password_changed_at && payload.iat && ...)`) short-circuits — which is precisely the bug migration 043 was written to fix. This also compounds finding 1: because 042's column is missing from the dump, even the wrong (non-unique) index cannot be observed by a test. Separately, because files 002-007 do not exist in the repo at all, the migrations directory could not rebuild a database from scratch even if the runner existed.

### Root cause

The test schema is a snapshot artifact that must be hand-refreshed after each migration, and it was last refreshed at migration 041. There is no automated check that the dump and the migration set agree, and the table-count guard is self-referential.

### Severity justification

Major per the brief: two layers disagree (the migration set and the committed test schema describe different databases), and this is a genuinely risky migration path — migrations 042-048 have never been proven to execute anywhere in the repo's automation. Concrete consequences, not hypotheticals: no DB-backed test can exercise driverDocuments.service.js because those tables do not exist in the test DB, cleanup-old-logs.js cannot run there because the archive tables are missing, and any test of post-password-change session invalidation passes vacuously because password_changed_at is still nullable. It is why idx 14 (042's broken index) survived unnoticed. Not critical on its own: it is an assurance gap, not a live exploit.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. The durable fix is to build the test DB by replaying backend/migrations/*.sql in filename order instead of importing a dump, which would also give the project the migration runner it currently lacks (finding 5). That is blocked until files 002-007 are either recovered or the 001 baseline is regenerated to stand alone — a decision for the owner. A cheaper interim step is a CI check that fails when a migration file exists whose effects are absent from tests/schema.sql. I did not modify tests/schema.sql or prepare-test-db.js.

### Required regression tests

- CI step that builds a scratch database by replaying every file in backend/migrations/ in order and fails on any error.
- Schema-parity test comparing information_schema for the migration-built DB against the dump-built DB and failing on any difference.
- A test asserting users.password_changed_at is NOT NULL, which would have caught the missing 043.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-016: There is no migration runner, and the default `npm run check:migrations` is a no-op that passes unconditionally because the drift baseline is an empty object

- **Provisional severity:** major
- **Status:** configuration_risk
- **Confidence:** high
- **Category:** schema-drift-detection
- **Layer:** ops-tooling
- **Affected roles:** admin
- **Affected entities:** schema_migrations, all tables
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Three separate gaps compound. (1) No runner exists: backend/package.json defines start, dev, test, test:prepare, test:ci, check:migrations, migrate, create:admin, seed:uat:prod, uat:live — and `npm run migrate` is scripts/migrate-from-excel.js, a spreadsheet data importer, not a DDL runner. Nothing in the repository applies backend/migrations/*.sql. They are applied by hand. (2) The default check is inert: `npm run check:migrations` takes no flags, so mode is 'static'. validateStaticBaseline (lines 40-55) only iterates `Object.entries(baseline)`, and backend/migrations/legacy-drift-baseline.json contains exactly `{}`. The loop body never executes and the function returns { approvedLegacyDriftCount: 0 }, printing OK. It never opens a database connection and never compares a file to anything. Only the un-wired `--db` mode calls validateTrackedMigrations, which is the only code path that wo

### Evidence

- **File:** `backend/scripts/validate-migration-baseline.js`
- **Lines:** 40-55, 112-118
- **Symbol:** validateStaticBaseline() and main() mode selection
- **Caller:** backend/package.json:17 — "check:migrations": "node scripts/validate-migration-baseline.js" (no flags, so mode resolves to 'static')

```js
  const mode = process.argv.includes('--capture') ? 'capture' : process.argv.includes('--db') ? 'db' : 'static';
  if (mode === 'static') {
    const result = validateStaticBaseline(DEFAULT_MIGRATION_DIR, readBaselineObject(DEFAULT_BASELINE_PATH));
    console.log(`[migrations] static baseline OK (${result.approvedLegacyDriftCount} approved legacy drift rows)`);
    return;
  }
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

validate-migration-baseline.js:113 selects mode from argv: no flag means 'static'. Static mode calls validateStaticBaseline (lines 40-55), whose entire body is `for (const [name, row] of Object.entries(baseline))` — and backend/migrations/legacy-drift-baseline.json contains exactly `{}`. The loop never executes; the function returns {approvedLegacyDriftCount: 0} and prints OK. backend/package.json defines `check:migrations` with no flags, and .github/workflows/full-quality.yml:55 runs it in exactly that inert form. The real check (validateTrackedMigrations, lines 57-79) only runs under --db, which nothing invokes. Separately, `npm run migrate` is scripts/migrate-from-excel.js — a spreadsheet data importer that INSERTs affiliations/schools/vehicles/students (lines 255-280, 352-368), not a DDL runner. Nothing in the repository applies migrations/*.sql.

### Expected logic

Applying a migration should record it, and a drift check that runs by default should compare the recorded state against both the files and the live database, failing when a file is untracked, a checksum has drifted, or the database has been edited by hand.

### Trigger / reproduction steps

1. Read backend/package.json scripts — there is no target that applies backend/migrations/*.sql; "migrate" is scripts/migrate-from-excel.js, a data importer.
2. cat backend/migrations/legacy-drift-baseline.json — the entire contents are `{}`.
3. Read validate-migration-baseline.js:113 — with no flags the mode is 'static'.
4. Read validate-migration-baseline.js:42 — the only work is `for (const [name, row] of Object.entries(baseline))`, which iterates zero times on `{}`.
5. Run npm run check:migrations — it prints "[migrations] static baseline OK (0 approved legacy drift rows)" without contacting any database.
6. Read migration-status.js:56-57 — --backfill writes status 'verified-present-existing' with the note 'schema reflects this migration in production' without verifying anything.

### Impact

Manual DB edits are undetectable by any command the project actually runs. The migration set, the live schema, and the committed test schema can diverge arbitrarily with a green check — which is exactly what finding 4 shows has already happened for seven migrations. Because the runner does not exist, applying migrations depends on an operator remembering the correct order by hand, and several files are not safely re-runnable if that order is misremembered: 041_performance_indexes.sql says so in its own header ("MySQL 8 does NOT support ADD INDEX IF NOT EXISTS"), and 023, 024, 025, 027, 030, 031, 034, 038, 039, 042, 044, 045 all use bare ADD COLUMN / ADD INDEX / DROP INDEX which error on a second apply. A re-run halfway through the sequence fails partway and leaves the schema in an indeterminate state, and nothing records how far it got.

### Root cause

The drift-detection tool's meaningful mode (--db) is behind a flag that nothing passes, and its default mode's only input is an empty baseline file, so the loop that does the checking has nothing to iterate over.

### Severity justification

Major per the brief as a genuinely risky deployment/migration path: migrations are applied by hand in an operator-remembered order, several files are explicitly not re-runnable (041's own header notes MySQL 8 has no ADD INDEX IF NOT EXISTS), and the one control that is supposed to catch drift passes unconditionally in CI. Not critical: nothing is destroyed and no access control is bypassed by this alone. Distinct from idx 17 — that is the test DB being built from a stale dump; this is the absence of a runner plus an inert drift gate. They have different fixes.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — nothing was changed and no migration was run. Point the check:migrations script at the --db mode so drift detection actually queries schema_migrations, and add a real forward-only runner that applies pending files in order inside a transaction and records each with its checksum on success. Whether to treat the existing hand-applied production schema as the baseline, or to reconstruct 002-007, is an owner decision that must precede any runner.

### Required regression tests

- CI job running validate-migration-baseline.js --db against a database built by replaying the migration set, asserting zero untracked and zero drifted files.
- Unit test asserting that the default (no-flag) invocation fails when a migration file is untracked.
- Idempotency test replaying the full migration set twice against a scratch DB, asserting the second pass either succeeds or fails with a clear already-applied signal rather than a partial apply.

### Product Owner confirmation question

> Is the production schema the authoritative baseline that the migration files should be reconciled to, or should migrations 002-007 be reconstructed so the set can rebuild a database from zero? Everything else here depends on that answer.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-017: Editing a student's guardian deletes ALL of that student's guardian links, not just the one being replaced

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** lost-update
- **Layer:** route
- **Affected roles:** school, affiliation, province, admin, parent
- **Affected entities:** parent_student, parents, students
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

currentLink is read at lines 770-777 with `LIMIT 1` and no ORDER BY, so it is one arbitrary guardian of possibly several. The DELETE that follows is keyed on student_id ONLY — it removes every parent_student row for that student, then a single fresh parents row is inserted and linked (lines 801-812). The code comment claims it detaches only 'this student from current parent'; the WHERE clause does not carry `AND parent_id = ?`. The whole block is inside a transaction (conn.beginTransaction at line 733), so the deletion commits atomically — again the transaction is not the problem, the WHERE clause is.

### Evidence

- **File:** `backend/src/routes/school.routes.js`
- **Lines:** 770-800
- **Symbol:** router.put('/students/:id')
- **Caller:** School UI student-edit form; any user passing requireFullSchoolScope (school, affiliation, province, admin with school_id)

```js
// Detach this student from current parent (preserve old parent row
// and any sibling links that point to it).
if (currentLink) {
  await conn.query(
    `DELETE FROM parent_student WHERE student_id = ?`,
    [studentId]
  );
}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

school.routes.js:770-777 reads currentLink with LIMIT 1 and no ORDER BY; :795-800 then runs `DELETE FROM parent_student WHERE student_id = ?` — keyed on student_id only, with no `AND parent_id = ?` — directly under a comment claiming it detaches only 'this student from current parent (preserve old parent row and any sibling links that point to it)'. The comment is about sibling links via the shared parents row, which the code does preserve; what it does not preserve is this student's other guardian rows. A single fresh parents row is then created (:801-806) and linked with approved = TRUE (:807-812). The block is inside the transaction begun at :733, so the over-broad delete commits atomically — the transaction is not the problem, the WHERE clause is. The audit written at :838-844 records only changed student fields plus parent_name/parent_phone, so the removal leaves no trace.

### Expected logic

Delete only the link being replaced: DELETE FROM parent_student WHERE student_id = ? AND parent_id = ?. Other guardians of the same student must keep their links.

### Trigger / reproduction steps

1. Create student S with two guardian links P1 and P2 (e.g. via the legacy import at backend/src/routes/school.routes.js:1593-1600 using two different guardian phones across two import runs, or via rosterRequest.service.js:347-363 followed by a school edit).
2. Log in as a school user for S's school.
3. PUT /api/school/students/<S.id> with a body changing only parent_phone (or parent_name).
4. SELECT * FROM parent_student WHERE student_id = <S.id> → exactly one row (the newly created parent). Both P1 and P2 links are gone.

### Impact

Any school user who edits a guardian phone or name on a student that has more than one guardian silently destroys every other guardian's link. Those guardians immediately stop receiving check-in/check-out LINE pushes (checkin.service.js:414-421 requires ps.approved = TRUE, and the row no longer exists) and lose LIFF access to that child (line.service.js:109/256/393, qrAccess.service.js:37, geofence.service.js:303). The audit written at lines 838-844 logs only changed student fields plus parent_name/parent_phone — the removal of the other guardian links leaves no trace, so the loss is undetectable after the fact. Compounding it: because currentLink is LIMIT 1 with no ORDER BY, the `noChange` comparison at lines 786-789 may compare the submitted values against the WRONG guardian, so a form re-submit with unchanged values for guardian A can still be classified as a change (when the row returned was guardian B) and trigger the wipe.

### Root cause

The DELETE's WHERE clause omits the parent_id that was just selected into currentLink, so a targeted detach becomes a full wipe.

### Severity justification

Major: silent, unaudited loss of guardian-to-student relationships on an everyday school edit, with the code contradicting its own comment. Multi-row students genuinely exist — the import phone-change path (studentImportPreview.service.js:493-495) and rosterRequest.service.js:355-362 both add rows to students that may already have one. Not critical: this removes access rather than granting it to a wrong party, so no student data reaches anyone new; the harm is guardians silently stopping receiving notifications and losing LIFF access.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Add `AND parent_id = ?` with currentLink.parent_id to the DELETE at lines 796-799. Separately, make the currentLink SELECT deterministic (ORDER BY) or, better, make the edit form address a specific parent_id so a multi-guardian student is edited unambiguously.

### Required regression tests

- PUT /students/:id with a changed guardian phone on a two-guardian student leaves the non-edited guardian's parent_student row intact
- PUT /students/:id resubmitted with identical guardian values on a two-guardian student performs no parent reassignment at all

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-018: Migration 039 dropped uq_dva_active_vehicle but two services still rely on it — the 'one active driver per vehicle' rule is now enforced by nothing, and its error handler is dead code

- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** check-then-act
- **Layer:** migration-vs-service
- **Affected roles:** school, admin, driver
- **Affected entities:** driver_vehicle_assignments, vehicles, vehicle_latest_locations, drivers, users
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Two consequences. (a) The 409 handler is unreachable for the vehicle case — 'uq_dva_active_driver_vehicle' does not contain the substring 'uq_dva_active_vehicle', so the regex never matches; a genuine same-driver-same-vehicle duplicate now falls through to `throw err` and surfaces as an unhandled ER_DUP_ENTRY (HTTP 500) instead of the intended 409 VEHICLE_ALREADY_HAS_ACTIVE_DRIVER. (b) The check at 83-87 is a plain SELECT with no FOR UPDATE, and the caller's transaction (school.routes.js:1040) never locks the vehicle row — the SELECT at school.routes.js:1043 that resolves the existing vehicle is a plain read. Nothing serializes two concurrent onboardings of the same vehicle by different drivers.

### Evidence

- **File:** `backend/src/services/driverProfile.service.js`
- **Lines:** 82-104
- **Symbol:** linkOrCreateDriverForVehicle() step (3)
- **Caller:** backend/src/routes/school.routes.js:1091-1098, inside POST /api/school/vehicles (requireFullSchoolScope). Same stale assumption at backend/src/services/driverLifecycle.service.js:6 and :119.

```js
// (3) Ensure exactly one ACTIVE assignment for this driver+vehicle.
const [[assignment]] = await conn.query(
  `SELECT id FROM driver_vehicle_assignments
   WHERE driver_id = ? AND vehicle_id = ? AND is_active = TRUE LIMIT 1`, [driverId, vehicleId]);
if (!assignment) { ... } catch (err) {
  if (err && err.code === 'ER_DUP_ENTRY' && /uq_dva_active_vehicle/.test(err.sqlMessage || err.message || '')) {
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Confirmed with one correction. driverProfile.service.js:82-104: the check at :83-87 is a plain SELECT with no FOR UPDATE and matches only driver+vehicle, and the catch at :99 tests /uq_dva_active_vehicle/, which cannot match the surviving key name uq_dva_active_driver_vehicle — so the VEHICLE_ALREADY_HAS_ACTIVE_DRIVER 409 is unreachable. driverLifecycle.service.js:99-107 by contrast locks the vehicles row FOR UPDATE and does a real application-level check, returning TARGET_VEHICLE_HAS_ACTIVE_DRIVER — while migration 039:5-9 states the shared-driver design deliberately retired that very rule. Correction to the finding: the fall-through is NOT an HTTP 500. errorHandler.js:30 maps any ER_DUP_ENTRY to status 409 with the generic message 'Duplicate entry — record already exists', so the caller gets an unlocalised 409 rather than the intended Thai message. Separately, and worse than the finding states, the consequence is not conditional on a race at all: under 039's intended shared-fleet model a vehicle legitimately has several active assignments, and vehicleLocation.service.js:29-38 getActiveDriverIdForVehicle resolves the driver with LIMIT 1 and no ORDER BY. driver.routes.js:1175 uses 

### Expected logic

Needs the Product Owner to settle: migration 039's comment says multiple authorized drivers per vehicle is now intended, but driverProfile/driverLifecycle still enforce one. Whichever is the rule, both layers must agree, and whichever invariant survives must be enforced by a DB constraint or a row lock, not an unbacked SELECT.

### Conflict

backend/migrations/030_vehicle_canonical_identity.sql:27 created `ADD UNIQUE KEY uq_dva_active_vehicle (active_vehicle_id)` — one active assignment per vehicle. backend/migrations/039_driver_pool_and_shifts.sql:8-9 then runs `ALTER TABLE driver_vehicle_assignments DROP INDEX uq_dva_active_vehicle;` and replaces it at :20-25 with `uq_dva_active_driver_vehicle (active_driver_vehicle_key)` where the generated column is CONCAT(driver_id,'|',vehicle_id). The migration comment is explicit: 'The shared-driver design deliberately replaces that rule with one active row per driver+vehicle pair; concurrent use is enforced on operating shifts.' Neither driverProfile.service.js nor driverLifecycle.service.js was updated. At runtime the DB wins: a second

### Trigger / reproduction steps

1. Confirm the constraint is gone: SHOW INDEX FROM driver_vehicle_assignments — uq_dva_active_vehicle is absent after migration 039, uq_dva_active_driver_vehicle is present.
2. Have school A and school B each POST /api/school/vehicles for the same already-existing plate, each supplying a different driver_name/driver_phone, concurrently.
3. SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = '<id>' AND is_active = TRUE → two rows.
4. POST a driver GPS ping for that vehicle and read vehicle_latest_locations.driver_id — it is whichever driver LIMIT 1 returned, not necessarily the one driving.

### Impact

Two school users (the fleet is shared province-wide — see the comment at school.routes.js:1077-1079) can POST /api/school/vehicles for the same existing plate with different driver_name values at the same time; both pass the check at 83-87 and both INSERT an active assignment. The vehicle then has two ACTIVE assignments. backend/src/services/vehicleLocation.service.js:29-38 getActiveDriverIdForVehicle resolves with `LIMIT 1` and no ORDER BY, so every GPS ping for that vehicle is attributed to an arbitrary one of the two drivers (backend/src/routes/driver.routes.js:1175, 1189) — location history and any driver-accountability report are then wrong. driverLifecycle.service.js:150 getDriverIntegrity already exposes a `vehicles_multiple_active_drivers` counter, which is evidence the drift is expected to occur but is only reported, never prevented.

### Root cause

A schema-level invariant was intentionally removed in migration 039 without updating the two services that depended on it, leaving an application-level check that has no lock and no constraint behind it.

### Severity justification

Major on the brief's explicit 'two layers disagree on a rule': migration 039 retired the one-driver-per-vehicle constraint, driverLifecycle still enforces it in application code, driverProfile enforces nothing and carries a dead catch plus a stale comment naming the dropped index. The independently confirmed misattribution of GPS pings to an arbitrary co-assigned driver is a real data-correctness defect on its own. Not critical: two drivers sharing one vehicle's roster is the stated intent of 039, so it is not a cross-tenant leak.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. If one active driver per vehicle is still the rule: restore an equivalent DB unique key (a generated active_vehicle_id column) and fix both regexes to match its name; until then, at minimum take `SELECT ... FROM vehicles WHERE id = ? FOR UPDATE` before the assignment check in linkOrCreateDriverForVehicle so concurrent onboardings of one vehicle serialize (driverLifecycle.reassignDriverVehicle at :99 already does this and is therefore safe). If multiple active drivers per vehicle is the rule: delete the dead ER_DUP_ENTRY branches and fix vehicleLocation.getActiveDriverIdForVehicle, which currently picks one arbitrarily.

### Required regression tests

- Concurrent POST /api/school/vehicles for one plate with two different drivers yields exactly one active assignment, or a deterministic 409 — never two
- A same-driver-same-vehicle duplicate insert returns 409 VEHICLE_ALREADY_HAS_ACTIVE_DRIVER, not a 500
- getDriverIntegrity().vehicles_multiple_active_drivers stays 0 after the concurrency test

### Product Owner confirmation question

> Is 'one active driver per vehicle' still a business rule, or did migration 039 permanently retire it in favour of the shared driver pool? If retired, driverLifecycle's TARGET_VEHICLE_HAS_ACTIVE_DRIVER guard and both dead uq_dva_active_vehicle catches should go, and getActiveDriverIdForVehicle must stop guessing — the GPS route should stamp the authenticated driver's own driver_id. If still a rule, it needs a real constraint or a locked check in driverProfile.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-019: Check-in idempotency guard is an unlocked SELECT with no unique index behind it — concurrent duplicate taps create duplicate check-in logs and duplicate parent notifications

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** check-then-act
- **Layer:** service
- **Affected roles:** driver, parent, school
- **Affected entities:** checkin_logs, notifications, daily_status
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The guard runs inside the transaction opened at :475, but it is a plain consistent read — no FOR UPDATE, no unique constraint. backend/migrations/001_initial_schema.sql:239-260 defines checkin_logs with PRIMARY KEY (id) and three plain INDEXes (idx_cl_date_vehicle, idx_cl_date_student, idx_cl_term_date) and no UNIQUE key at all; no later migration adds one (I grepped migrations/0[2-4]* for checkin_logs and found nothing). Under InnoDB's default REPEATABLE READ, a non-locking SELECT takes no lock, so two overlapping transactions both see zero prior rows and both proceed to the INSERT at :358-366.

### Evidence

- **File:** `backend/src/services/checkin.service.js`
- **Lines:** 333-357
- **Symbol:** _buildCheckinTransaction()
- **Caller:** processCheckin() at :470-495 and processCheckout() at :497-520, both reached from the driver check-in endpoints in backend/src/routes/driver.routes.js and the QR path; also processCheckinAll/processCheckoutAll at :525 an

```js
const [dupLog] = await conn.query(
  `SELECT id, status FROM checkin_logs
   WHERE student_id = ? AND session = ? AND check_date = CURDATE()
   ORDER BY id DESC
   LIMIT 1`,
  [student.id, session]
);
if (dupLog.length) { ... throw makeError('รายการนี้ถูกบันทึกไปแล้ว', 409); }
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

checkin.service.js:337-343 is exactly `SELECT id, status FROM checkin_logs WHERE student_id = ? AND session = ? AND check_date = CURDATE() ORDER BY id DESC LIMIT 1` — a plain consistent read with no FOR UPDATE, inside the transaction. 001_initial_schema.sql:239-259 gives checkin_logs a PK on the autoincrement id and three plain indexes with no UNIQUE key, and no later migration adds one (only 026 and 047 mention the table; 047 just clones it for archiving). Two overlapping transactions therefore both see no conflicting row and both reach the INSERT at :358-366, and each then runs the per-parent notifications INSERT at :421-439. daily_status is genuinely protected by the ON DUPLICATE KEY upsert at :371-388, so the corruption is confined to checkin_logs and notifications, as the finding says.

### Expected logic

An exact duplicate must be rejected under concurrency, not only when the requests are serialized. The comment at :333-336 states the intent explicitly ('so a double-tap or network retry can't create duplicate checkin_logs AND duplicate parent notifications') — the implementation does not achieve it under concurrency.

### Trigger / reproduction steps

1. Log in as a driver whose vehicle has student S on the roster.
2. Fire two identical POST check-in requests for S (same session) at the same moment — a double-tap on a slow connection, or two `curl` calls in parallel; the driver check-in endpoints have no per-student mutex.
3. SELECT * FROM checkin_logs WHERE student_id = <S> AND check_date = CURDATE() AND session = 'morning' → two rows with status CHECKED_IN.
4. SELECT * FROM notifications WHERE student_id = <S> AND sent = FALSE → two rows per linked parent; both are pushed by line.service.js processUnsentNotifications.

### Impact

Two duplicate checkin_logs rows for the same student/session/date, and — because step 4 at :404-437 inserts one notifications row per linked+approved parent per transaction — two notification rows per parent, which line.service.js:1273 later pushes as two separate LINE messages. The parent receives the same 'student boarded' message twice. daily_status is protected (the ON DUPLICATE KEY UPSERT at :373-388 is idempotent), so the corruption is confined to checkin_logs and notifications — but checkin_logs is the attendance record of truth for report.service.js, so attendance counts double for that student.

### Root cause

Idempotency is asserted in application code with a non-locking read, with no unique index and no row/gap lock to make the check-then-act atomic.

### Severity justification

Major: a race condition plus a missing constraint that makes the attendance record of truth partly incorrect and double-queues parent LINE messages, on the driver's most-used action where a double-tap or a retry after a mobile timeout is the normal trigger. The guard written specifically to prevent this does not hold. Not critical: no authorization boundary is crossed, no data reaches the wrong person, and daily_status stays correct so live operations are not misled. Keeps idx 15, which reports the same defect from the schema side.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Either add a UNIQUE KEY on checkin_logs (check_date, student_id, session, status) and convert the guard into catching ER_DUP_ENTRY, or take a lock that actually serializes — e.g. SELECT ... FROM students WHERE id = ? FOR UPDATE before the guard, so all check-ins for one student serialize on the student row. The daily_status UPSERT already shows the pattern the rest of the function should follow.

### Required regression tests

- Two concurrent identical processCheckin calls for one student produce exactly one checkin_logs row; one call returns 409
- Two concurrent identical processCheckin calls produce exactly one notifications row per linked parent
- processCheckin followed by processCheckout in the same session still succeeds (the valid CHECKED_IN → CHECKED_OUT transition must not be blocked by the fix)

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-020: LINE notification dispatcher performs external pushes inside an open transaction and commits only at the end — a crash mid-batch re-sends messages already delivered to parents

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** multi-step-write
- **Layer:** service
- **Affected roles:** parent
- **Affected entities:** notifications
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Up to 50 rows are claimed with FOR UPDATE SKIP LOCKED at :1289-1296 — which correctly prevents two overlapping runs claiming the same rows — and then the loop performs up to 50 HTTPS pushes to the LINE Messaging API while the transaction stays open. Each successful push writes `sent = TRUE` to an uncommitted row. The single commit happens only after the entire batch. Any failure between the first delivered push and the commit (process restart during a deploy, MySQL connection drop, wait_timeout on a long batch, container OOM) triggers `conn.rollback()` at :1320 and discards every `sent = TRUE` for messages LINE has already accepted.

### Evidence

- **File:** `backend/src/services/line.service.js`
- **Lines:** 1273-1327
- **Symbol:** processUnsentNotifications()
- **Caller:** backend/src/routes/line.routes.js:549 (dispatch endpoint / cron trigger)

```js
for (const n of rows) {
  ...
  const result = await sendTextMessage(n.target_line_user_id, text);
  if (result.sent || result.dryRun) {
    await conn.query('UPDATE notifications SET sent = TRUE, sent_at = NOW() WHERE id = ?', [n.id]);
    sent++;
  } else { ... }
}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

line.service.js:1273-1327: beginTransaction, then up to `limit` (50 from dispatch-notifications.js:24) rows claimed with FOR UPDATE SKIP LOCKED, then a loop that awaits sendTextMessage — a real HTTPS pushMessage to the LINE API (line.service.js:446-459) — and writes `UPDATE notifications SET sent = TRUE` per success, with the single conn.commit() only after the whole batch. The catch at :1319-1322 rolls back and rethrows. sendTextMessage itself never throws (it catches and returns {sent:false,error}), so a plain LINE delivery failure does not trigger the rollback; what does is a DB error on one of the UPDATEs, a connection drop, or the process dying mid-batch. In every one of those cases the sent=TRUE rows for messages LINE has already accepted are discarded, retry_count is unchanged, and the next cron minute re-selects and re-pushes them. The secondary concern is also real: those row locks and one of only 10 pool connections (config/database.js connectionLimit: 10) are held across up to 50 network round-trips.

### Expected logic

The durable record that a message was delivered must not be able to roll back after the irreversible external side effect has happened. The claim and the delivery marker should commit per message (or the row should be claimed/marked before the push, accepting at-most-once), so that a crash cannot resurrect delivered messages.

### Trigger / reproduction steps

1. Queue >10 unsent notifications (e.g. check in a bus-load of students whose parents are LINE-bound).
2. Trigger the dispatch endpoint (backend/src/routes/line.routes.js:549).
3. While the batch is mid-flight, restart the backend process (or kill the MySQL connection).
4. Observe the parents' LINE chats: the first N messages arrived.
5. Query notifications: those same N rows still have sent = FALSE.
6. Trigger dispatch again — those N parents receive the identical messages a second time.

### Impact

After the rollback the rows still have sent = FALSE and retry_count unchanged, so the next dispatch run re-selects them and pushes them again. Parents receive duplicate 'ส่งเช้า / รับเย็น' check-in notifications for their child — up to 50 duplicates per incident, and it recurs on every deploy that lands mid-batch. Secondarily, holding an InnoDB transaction with 50 locked notifications rows across 50 network round-trips keeps those row locks for the full wall-clock duration of the batch, and the pool is only 10 connections (backend/src/config/database.js connectionLimit: 10).

### Root cause

An at-least-once outbox loop where the external call sits inside the same transaction as the delivery marker, with a single batch-wide commit.

### Severity justification

Major: an irreversible external side effect is placed inside a transaction whose rollback path is reachable through ordinary operations — a deploy or process restart landing on a per-minute cron mid-batch, or any DB blip. The result is duplicate parent-facing LINE messages, and holding InnoDB row locks across dozens of external HTTP calls on a 10-connection pool is a real availability hazard. Not critical: no wrong recipient and no data loss. Sitting at the low end of major because PUSH_TYPES is currently ['emergency'] only, so real batches are small.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Commit the `sent = TRUE` per message (open/commit a short transaction per row, or claim rows in one committed transaction then push and mark outside it). Keeping FOR UPDATE SKIP LOCKED for the claim is right; what must change is that the commit boundary sits between the push and the next push, not after all of them. Note that sendTextMessage at :446-459 already swallows LINE API errors and returns {sent:false}, so the loop itself will not throw — the rollback path is driven by DB/process failures, not push failures.

### Required regression tests

- Killing the dispatcher after k successful pushes leaves exactly k rows with sent = TRUE committed
- Two overlapping dispatch runs never push the same notification id twice (guard the existing SKIP LOCKED behaviour)
- A push failure marks retry_count += 1 for that row only and does not roll back earlier successes in the batch

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-021: Roster change request duplicate guard is an unlocked check-then-act with no unique index, and the 'add new student' path has no duplicate guard at all — duplicate approvals create duplicate student records

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** check-then-act
- **Layer:** service
- **Affected roles:** driver, school
- **Affected entities:** roster_change_requests, students, parents, parent_student
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Both statements run on `pool` — separate connections, no transaction, no lock. backend/migrations/008_phase8_leaves_requests.sql:28-48 defines roster_change_requests with PRIMARY KEY (id), three FKs and two plain INDEXes (idx_rcr_school_status, idx_rcr_vehicle) and no UNIQUE key; migration 009 only adds columns. Two concurrent requests therefore both read zero rows and both insert. Worse, the 'add new student' branch at lines 14-66 (requestType === 'add' with newStudentData and no studentId) has NO duplicate check whatsoever — it validates fields, verifies the school exists at :35-37, and inserts at :46-50.

### Evidence

- **File:** `backend/src/services/rosterRequest.service.js`
- **Lines:** 119-136
- **Symbol:** createRequest()
- **Caller:** Driver roster-request endpoint in backend/src/routes/driver.routes.js (driver role)

```js
// Check for duplicate pending request (same student + vehicle + type)
const [[existing]] = await pool.query(
  `SELECT id FROM roster_change_requests
   WHERE student_id = ? AND vehicle_id = ? AND request_type = ? AND status = 'pending'`,
  [studentId, vehicleId, requestType]
);
if (existing) { ... err.statusCode = 409; throw err; }

```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

rosterRequest.service.js:119-136: the duplicate SELECT and the INSERT both run on `pool` — separate connections, no transaction, no lock — and 008_phase8_leaves_requests.sql:28-48 gives roster_change_requests a PK, three FKs and two plain indexes with no UNIQUE key. Confirmed. The stronger half also holds: the add-new-student branch (:14-66) validates names, school_id and phone format, verifies the school exists at :35-42, and INSERTs at :45-50 with no duplicate check of any kind. On approval, reviewRequest's add branch (:285-370) allocates a fresh id via allocateStudentId and INSERTs a students row whose cid_hash is derived from `placeholder-${newStudentId}-${Date.now()}-${requestId}`, so nothing dedupes two approvals of two identical requests.

### Expected logic

At most one pending request per (student, vehicle, request_type); for the new-student branch, at most one pending request per (vehicle, school, submitted identity) — enforced so that concurrent or repeated submissions cannot both land.

### Trigger / reproduction steps

1. Log in as a driver assigned to vehicle V.
2. Fire two identical POST roster-request calls with request_type 'add' and a newStudentData payload (first_name, last_name, school_id) at the same moment.
3. SELECT * FROM roster_change_requests WHERE vehicle_id = '<V>' AND status = 'pending' → two rows with identical new_student_data.
4. Log in as the school for that school_id and approve both.
5. SELECT * FROM students WHERE school_id = '<S>' AND first_name = '<name>' AND last_name = '<name>' AND is_deleted = FALSE → two rows with different ids, both assigned to vehicle V.

### Impact

For the existing-student path the duplicates are mostly noise: reviewRequest at :235-399 locks each request row FOR UPDATE and the resulting UPDATE students SET vehicle_id is idempotent. For the NEW-student path the damage is real: each approved request runs the branch at :285-370, which allocates a fresh student id (allocateStudentId at :305) and INSERTs a new students row with a synthetic cid_hash derived from `placeholder-${newStudentId}-${Date.now()}-${requestId}` — so nothing dedupes them. A driver who double-taps 'add new student', or whose client retries, gets two pending requests; a school reviewer approving both creates TWO student records for one real child, each with its own id, its own parent_student link (:347-364) and its own attendance history. Merging them afterwards requires manual DB work.

### Root cause

Idempotency asserted with a non-transactional SELECT-then-INSERT on a table that has no supporting unique constraint; the newer 'add new student' branch never had a guard added.

### Severity justification

Major on the brief's 'missing validation on a real input': a driver-facing write path with no duplicate guard at all, whose approval mints duplicate student master records that then corrupt the roster and attendance reporting. Sitting at the low end of major because the damaging outcome needs a human reviewer to approve both of two visibly identical pending requests — the existing-student path's duplicates really are just noise, since reviewRequest locks each row FOR UPDATE and the resulting UPDATE students SET vehicle_id is idempotent.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Add a UNIQUE index that covers the pending state (e.g. a STORED generated column keyed on student_id|vehicle_id|request_type that is NULL unless status='pending', mirroring the pattern already used successfully at migrations/039_driver_pool_and_shifts.sql:20-25 and 038_shared_vehicle_verification.sql:49) and convert both branches to catch ER_DUP_ENTRY into the existing 409. Add an equivalent guard for the new-student branch keyed on vehicle_id + school_id + normalized name (or an idempotency key supplied by the driver client). Note vehicleRequest.service.js:50-52 has the same unguarded SELECT-then-INSERT shape for vehicle_requests.

### Required regression tests

- Two concurrent identical createRequest calls for the same (student, vehicle, type) yield one row and one 409
- Two concurrent createRequest calls in newStudentData mode with identical payloads yield one row and one 409
- Approving a single new-student request still creates exactly one students row (guard against over-tightening the fix)

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-022: A cancelled student leave can never be re-recorded — the unique key does not exclude cancelled rows, so the re-entry always fails with a misleading 409

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** correctness
- **Layer:** schema-vs-service
- **Affected roles:** school, driver
- **Affected entities:** student_leaves
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Recording leave → cancelling it → recording the same leave again for the same (date, student, session) hits the surviving cancelled row, raises ER_DUP_ENTRY, and is reported to the user as 'นักเรียนคนนี้ถูกบันทึกการลาเช้าในวันนี้แล้ว' ('this student's morning leave is already recorded today') — which the UI also shows as false, since every read path filters cancelled = FALSE and shows no leave.

### Evidence

- **File:** `backend/src/services/leave.service.js`
- **Lines:** 26-40
- **Symbol:** createLeave() / cancelLeave()
- **Caller:** backend/src/routes/school.routes.js:566 (POST /leave) and the driver leave endpoint; cancellation via school.routes.js:589 (DELETE /leaves/:id) → cancelLeaveBySchool(), and leave.service.js:70-83 cancelLeave() for driver

```js
} catch (dbErr) {
  if (dbErr.code === 'ER_DUP_ENTRY') {
    const sessionLabel = { morning: 'เช้า', evening: 'เย็น', both: 'ทั้งวัน' }[session] || session;
    const err = new Error(`นักเรียนคนนี้ถูกบันทึกการลา${sessionLabel}ในวันนี้แล้ว`);
    err.statusCode = 409;
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

008_phase8_leaves_requests.sql:22 declares `UNIQUE KEY uk_sl_date_student_session (leave_date, student_id, session)` with no cancelled-aware generated column — unlike the soft-delete-aware pattern used elsewhere in this schema (e.g. 030's active_canonical_plate). cancelLeave (leave.service.js:69-80) is a soft cancel: `UPDATE student_leaves SET cancelled = TRUE ...`, leaving the row in place. createLeave's INSERT at :26-31 therefore collides with the cancelled row and the catch at :32-38 reports it as 'นักเรียนคนนี้ถูกบันทึกการลา<session>ในวันนี้แล้ว' with a 409. Every read path filters cancelled = FALSE — I confirmed this across leave.service.js:126/147/160, school.service.js:73/92/345, checkin.service.js:256/259/537/538/670/679/894, affiliation/province services — so the UI shows no leave while the API insists one exists.

### Expected logic

After a leave is cancelled, the same student/date/session must be recordable again. The uniqueness should apply only to non-cancelled rows.

### Conflict

backend/migrations/008_phase8_leaves_requests.sql:22 declares `UNIQUE KEY uk_sl_date_student_session (leave_date, student_id, session)` — the `cancelled` column (declared at :15) is NOT part of the key. No later migration touches student_leaves (I grepped all 42 files). Meanwhile cancellation is a soft flag: leave.service.js:71-75 and :107-110 both do `UPDATE student_leaves SET cancelled = TRUE, ...` and never delete the row. The service layer treats a cancelled leave as gone (getLeavesForVehicle at :126, getLeavesForSchool at :147 and getActiveLeaves at :160 all filter `cancelled = FALSE`); the schema treats it as still occupying the slot.

### Trigger / reproduction steps

1. As a school user, POST /api/school/leave for student S, today, session 'morning' → 201.
2. DELETE /api/school/leaves/<id> → cancelled = TRUE (the row remains).
3. Reload the leave list for today: S is not shown (all reads filter cancelled = FALSE).
4. POST /api/school/leave again for S, today, session 'morning' → 409 'นักเรียนคนนี้ถูกบันทึกการลาเช้าในวันนี้แล้ว'. There is no path through the UI to record the leave.

### Impact

A routine correction is unrecoverable through the UI: a school clerk or driver who cancels a leave entered by mistake (or entered for the wrong session) can never re-enter it for that student on that day, and the error message tells them a leave exists when the roster shows none. The student is then counted as expected-on-board for the rest of the day, so the driver's pending list and the no-show report (checkin.service.js:879 getNoShowStudents) are wrong for that student. Recovering requires a manual UPDATE against the DB.

### Root cause

A soft-delete flag was added to the row lifecycle without excluding soft-deleted rows from the unique key.

### Severity justification

Major: a core operational function is permanently wrong. Record leave, cancel it, try to record it again for the same student, date and session — it can never be re-entered through the UI, and the error text asserts a leave that no screen shows. The student then stays counted as expected-on-board, so the driver's pending list and the no-show report (checkin.service.js:879 getNoShowStudents) are wrong for the rest of the day. Not critical: nothing is lost or exposed and an operator with DB access can repair it.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Replace uk_sl_date_student_session with a partial-uniqueness equivalent — a STORED generated column that is NULL when cancelled = TRUE and CONCAT(leave_date,'|',student_id,'|',session) otherwise, with a UNIQUE key on it. That is the exact pattern already used successfully in this repo at migrations/039_driver_pool_and_shifts.sql:20-25 (active_driver_vehicle_key) and :61-67 (open_driver_id / open_vehicle_id). Keep the ER_DUP_ENTRY handler; it will then only fire for genuine active duplicates.

### Required regression tests

- create leave → cancel → create the same leave again succeeds
- create leave → create the same leave again (without cancelling) still returns 409
- a cancelled leave is excluded from getActiveLeaves and from the no-show computation

### Product Owner confirmation question

> Secondary rule question for the Product Owner, deliberately NOT reported as a defect: the same unique key treats session='both' as a value distinct from 'morning' and 'evening', so a student can currently hold a 'morning' leave AND a 'both' leave on the same day. Should 'both' be mutually exclusive with 'morning' and 'evening' for a given student and date?

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-023: Driver check-in error path crashes the whole app: ErrorState is passed an undeclared identifier `load`

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** correctness
- **Layer:** frontend
- **Affected roles:** driver
- **Affected entities:** checkin_logs, daily_status
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

`load` is never declared or imported in CheckinPanel.jsx — a repo-wide grep for `\bload\b` in that file returns exactly one hit, this line. The identifier is only evaluated when `error` is truthy, i.e. only after a failed POST /driver/checkin (line 22 `setError(...)`). At that moment React evaluates `load` during render and throws `ReferenceError: load is not defined`. The app-root ErrorBoundary (frontend/src/App.jsx:190) catches it and replaces the ENTIRE application with the generic 'เกิดข้อผิดพลาด' screen; the only recovery is window.location.reload().

### Evidence

- **File:** `frontend/src/pages/driver/CheckinPanel.jsx`
- **Lines:** 70-74
- **Symbol:** CheckinPanel (rendered by StudentList at /driver/roster)
- **Caller:** frontend/src/pages/driver/StudentList.jsx:155 — <CheckinPanel key={st.id} student={st} session={session} onDone={fetchRoster} />

```js
      {error && (
        <div className="px-4 pb-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

I read the whole file (77 lines). Line 72 is `<ErrorState message={error} onRetry={load} />` and `load` appears nowhere else — the file declares only `loading`/`setLoading` (:8), `error`/`setError` (:9), `toast` (:10), `handleAction` (:14) and `isDone`/`doneText`. It is a module scope, so the reference is a ReferenceError, and the JSX `{error && (...)}` at :70 short-circuits, so it is evaluated only once setError fires at :22 — i.e. after any failed POST /driver/checkin. App.jsx wraps everything in ErrorBoundary (components/ErrorBoundary.jsx), which replaces the entire app with the 'เกิดข้อผิดพลาด' screen and offers only reload / go home. CheckinPanel is imported only by StudentList.jsx (:7, rendered at :155 and :171), whose route /driver/roster is registered at App.jsx:212 but appears in neither DRIVER_NAV (Sidebar.jsx:25-37) nor driverTabs.

### Expected logic

A failed check-in should show the inline ErrorState with a working retry, leaving the roster on screen.

### Trigger / reproduction steps

1. Log in as a driver whose account is linked to a vehicle
2. Navigate directly to /driver/roster (not linked in the nav; type the URL or use a bookmark)
3. Tap the check-in button on a student, then tap it again after the roster refreshes (or tap once with the network throttled/offline)
4. The second POST /driver/checkin returns 409, setError runs, and the whole app is replaced by the ErrorBoundary screen

### Impact

The failure is triggered by the most ordinary error on a bus: patchy mobile data, or the backend's own idempotency guard returning 409 'รายการนี้ถูกบันทึกไปแล้ว' (backend/src/services/checkin.service.js:344-348). One tap on a stale row wipes the driver's roster screen mid-route. There is no ESLint config in frontend/ (package.json has no lint script and no .eslintrc/eslint.config.*), so nothing catches this class of bug before it ships.

### Root cause

Copy-paste of the `onRetry={load}` idiom from pages that do declare `load` (e.g. frontend/src/pages/school/VehicleList.jsx:29 `const load = useCallback(...)`), without bringing the declaration along. No lint gate in the frontend package to catch no-undef.

### Severity justification

Major: not a style opinion but a guaranteed runtime crash whose blast radius is the whole SPA, on the most ordinary failure a bus has — a dropped mobile connection, or the backend's own idempotency 409 'รายการนี้ถูกบันทึกไปแล้ว' (checkin.service.js:344-348, which I confirmed). The error path is inverted into a hard crash instead of the retry card it was written for. Held below critical, and honestly at the low end of major, because /driver/roster is reachable only by direct URL or an old bookmark — the linked driver surface is DriverDashboard. Same one-line idiom as idx 48; both lines must be fixed, they are different files and different triggers.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply: point onRetry at a function that exists in this component's scope (the component already receives `onDone`), or drop the onRetry prop; and add an ESLint config with react/recommended + no-undef to the frontend build so undeclared identifiers fail CI.

### Required regression tests

- Render CheckinPanel with a mocked api.post that rejects, assert the inline error renders and no error is thrown
- Add eslint no-undef over frontend/src and assert a clean run

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-024: Driver roster page crashes instead of showing its error state when the roster fetch fails (same undeclared `load`)

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** correctness
- **Layer:** frontend
- **Affected roles:** driver
- **Affected entities:** -
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The fetch function in this file is named `fetchRoster` (line 53). `load` is undeclared — a grep for `\bload\b` in StudentList.jsx returns only line 138. The expression is evaluated only once `error` is set, which happens in fetchRoster's catch (line 61) on any GET /driver/roster failure, and in handleBulkAction's catch path. Result: ReferenceError during render → app-root ErrorBoundary → full-app 'เกิดข้อผิดพลาด' screen instead of the intended retryable error card.

### Evidence

- **File:** `frontend/src/pages/driver/StudentList.jsx`
- **Lines:** 138
- **Symbol:** StudentList (route /driver/roster, App.jsx:212)
- **Caller:** frontend/src/App.jsx:212 — <Route path="roster" element={<StudentList />} />

```js
      {error && <ErrorState message={error} className="mb-4" onRetry={load} />}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

StudentList.jsx:138 is `{error && <ErrorState message={error} className="mb-4" onRetry={load} />}`. The fetch callback in this file is `fetchRoster` (:53-66); `load` is declared nowhere in the file. setError fires in fetchRoster's catch at :61 on any GET /driver/roster failure, so the identifier is evaluated during render exactly when the page needs its error state. Result is a ReferenceError caught by the app-root ErrorBoundary, replacing the whole application. Route /driver/roster exists at App.jsx:212 and is not in Sidebar's DRIVER_NAV or MobileBottomNav's driverTabs.

### Expected logic

A failed roster load should render the ErrorState card with a retry button, per the pattern used everywhere else in the app.

### Trigger / reproduction steps

1. Log in as a driver and open /driver/roster directly
2. Kill network connectivity (or stop the backend) and wait for the 30s poll, or reload the page
3. fetchRoster rejects → setError → render evaluates `load` → ReferenceError → app-wide ErrorBoundary screen

### Impact

Exactly the situation the ErrorState exists for — a dropped mobile connection on a moving bus — produces a hard crash of the whole SPA instead of a retry affordance. Note the interaction: a partially-loaded page cannot even display 'โหลดข้อมูลไม่สำเร็จ'.

### Root cause

Same copy-paste of `onRetry={load}` without the declaration; no frontend lint gate.

### Severity justification

Major for the same reason as idx 47: the page's primary failure mode (roster GET fails on patchy mobile data) produces a full-application crash instead of the retryable error card, and no lint exists in frontend/ to catch it (I confirmed package.json has no lint script and there is no eslint config in frontend/). Not a duplicate of idx 47 — different file, different line, different trigger, and fixing one leaves the other live — but the two ship on the same screen and should be fixed together.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: pass `fetchRoster` (already defined at line 53) or remove the prop; add ESLint no-undef to the frontend.

### Required regression tests

- Mount StudentList with api.get mocked to reject; assert ErrorState renders and no exception escapes

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-025: Inspection date defaults to the UTC calendar date, recording the wrong day between 00:00 and 07:00 Bangkok time

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** timezone
- **Layer:** frontend
- **Affected roles:** transport, admin
- **Affected entities:** vehicle_inspections, inspection_attempts, vehicles.verification_status
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

`toISOString()` yields the UTC date. Thailand is UTC+7, so from 00:00 to 06:59 Bangkok time the pre-filled 'วันที่ตรวจ' is the previous calendar day. The value is submitted as-is and stored: transport.service.js:367-372 inserts it into vehicle_inspections.inspection_date. The server does not catch it — backend/src/utils/inspectionDates.js:57 rejects only dates in the FUTURE relative to bangkokToday(), and line 60 permits back-dating up to 366 days, so a one-day-early date passes silently. The rest of the codebase uses the Bangkok-local idiom explicitly: inspectionDates.js:29-31 `bangkokToday()` uses toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }), and frontend/src/pages/reports/DailyReport.jsx:19 and admin/ResearchExport.jsx:28 do the same. The DB session is pinned to +07:00 (backend/src/config/database.js:16, 38-40), so stored dates are Bangkok wall-clock and the mismatch is r

### Evidence

- **File:** `frontend/src/pages/transport/InspectionForm.jsx`
- **Lines:** 67-70, 152
- **Symbol:** InspectionForm form state initialiser / post-save reset
- **Caller:** Submitted by handleSubmit:148 to POST /transport/inspections; the same UTC idiom is used at frontend/src/pages/transport/VerificationQueue.jsx:623 for POST /verification/transport/applications/:id/start

```js
  const [form, setForm] = useState({
    vehicle_id: prefillVehicleId || '', inspection_date: new Date().toISOString().slice(0, 10),
    expiry_date: '', result: 'PASSED', notes: '', certifying_school_id: '',
  });
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

InspectionForm.jsx:68 and :152 both use new Date().toISOString().slice(0,10), which is the UTC date; Thailand is UTC+7, so 00:00–06:59 local yields the previous day. transport.service.js:367-372 inserts the submitted value verbatim into vehicle_inspections, and inspectionDates.js only rejects FUTURE dates (:57) while allowing 366 days of back-dating (:60), so one day early passes silently. The codebase's own correct idiom sits in the same file it validates against — inspectionDates.js:29-31 bangkokToday() uses toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }). The finding is actually STRONGER than written: VerificationQueue.jsx:619-624 (the current, non-legacy flow) sends the same UTC value on 'start' with no visible date field for the officer to notice or correct, and the server-side default is identically broken — vehicleVerification.service.js:704 declares inspectionDate = new Date().toISOString().slice(0,10) and :731-737 inserts it into inspection_attempts.

### Expected logic

The default should be the Bangkok calendar date, matching bangkokToday() and every other 'today' in the system.

### Trigger / reproduction steps

1. Set the workstation clock/timezone so that Bangkok local time is between 00:00 and 06:59 (e.g. 02:00 ICT on 27 Aug → UTC is 19:00 on 26 Aug)
2. Open /transport/inspections and click 'บันทึกผลตรวจเดิม'
3. The 'วันที่ตรวจ' field is pre-filled with 2026-08-26 while the Bangkok date is 2026-08-27
4. Complete and submit; vehicle_inspections.inspection_date is stored as the previous day

### Impact

An inspection recorded before 07:00 local — a normal time for a depot check before the morning run — is dated one day early unless the officer notices and corrects the field. That date is the anchor for the certification window: expiry validity is measured from it (inspectionDates.js:76-81) and refreshVehicleEligibility recomputes vehicles.verification_status from it (transport.service.js:384-385). The same UTC idiom at VerificationQueue.jsx:623 stamps inspection_attempts.inspection_date on the current (non-legacy) verification flow — vehicleVerification.service.js:732-738 inserts the client-supplied value directly, and finalize falls back to it because the finalize payload (VerificationQueue.jsx:696-697 spreads a form whose state at line 561 contains no inspection_date) never sends one.

### Root cause

`new Date().toISOString().slice(0, 10)` used as 'today' instead of the project's own Bangkok-local helper.

### Severity justification

Major under 'data is partly incorrect': a wrong calendar date is written into the certification record for a predictable seven-hour window every day, on both the legacy form and the current verification flow, and the server default carries the same bug so there is no backstop. inspection_date anchors the validity window (inspectionDates.js:76-81, MAX_CERT_VALIDITY_DAYS) and feeds refreshVehicleEligibility → vehicles.verification_status. On the legacy form the officer can at least see and correct the pre-filled field; on VerificationQueue the date is never shown, so the error is silent. Not critical — the error is one day against a validity window measured in years, and no access control or student data is involved.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: replace with toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) in both InspectionForm.jsx:68/152 and VerificationQueue.jsx:623 (and consider the matching backend default at vehicleVerification.service.js:704, which has the same UTC idiom).

### Required regression tests

- Freeze the clock at 2026-08-27T00:30+07:00 and assert the form default equals '2026-08-27'
- Assert startInspection persists the Bangkok date, not the UTC date

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-026: Production catch-all returns HTTP 200 index.html for any unmatched GET /api/* — flag-off endpoints never 404, so the UI silently shows an empty page

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** error-handling
- **Layer:** backend HTTP layer
- **Affected roles:** admin, province, school, affiliation, transport, driver
- **Affected entities:** geofences, route_deviations, eta, qr, consent, driver registrations
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

There is no /api-scoped 404 handler in the production branch (grep for 404 in app.js returns only the /uploads wall at :79 and the dev-only fallback at :208). The routers for the dark feature flags are mounted conditionally — app.js:137 driverRegistration, :176 vehicleQr, :188 eta, :191 geofence, :194 routeDeviation — and the comments at app.js:135, :174 and :186 explicitly claim 'these paths 404'. In production they do not: an unmatched GET falls through to app.get('*') and returns 200 with the SPA's index.html and Content-Type text/html. ecosystem.config.js:30 sets NODE_ENV: 'production', and no reverse-proxy config exists in the repo to intercept it. In AdminGeofences.jsx:61-62 the response is guarded by `Array.isArray(gf.data?.data)`; gf.data is an HTML string, so `.data` is undefined, the guard fails, and setGeofences([]) runs with no error set.

### Evidence

- **File:** `backend/src/app.js`
- **Lines:** 199-204
- **Symbol:** app.get('*') SPA fallback
- **Caller:** Any frontend axios GET whose /api path is not mounted. Concretely: frontend/src/pages/admin/AdminGeofences.jsx:58-59 api.get('/geofences') and api.get('/geofences/events/list?limit=50'), reached from the route at fronten

```js
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

backend/src/app.js:196-204 is exactly as quoted: under NODE_ENV==='production' the app serves frontend/dist statically and registers app.get('*', …) sending index.html. The only 404s in the file are the /uploads wall (:78-80) and the dev-only fallback (:206-208), so in production nothing 404s an unmatched GET /api path. The feature-flag mounts are real and conditional (:136-147 driverRegistration/documents, :176-179 vehicleQr/consent, :186-196 eta/geofence/routeDeviation) and their comments do claim 'these paths 404'. ecosystem.config.js:30 sets NODE_ENV:'production'. docs/deployment-hardening.md:16 documents nginx proxying '/api/ → 127.0.0.1:3000', so the real topology sends /api to this Express app and the catch-all answers. I confirmed the downstream effect in frontend/src/pages/admin/AdminGeofences.jsx:52-67: load() does api.get('/geofences'), gets a 200 HTML string, `gf.data?.data` is undefined, so `Array.isArray(...)` is false, setGeofences([]) runs and setError is never called — the page renders its empty state, not its error state.

### Expected logic

An unmounted /api path should return 404 JSON (as the dev branch at app.js:206-209 does and as the comments at :135/:174/:186 promise), so the frontend's catch block runs and the user sees a real error.

### Trigger / reproduction steps

1. Deploy with NODE_ENV=production (ecosystem.config.js:30) and FEATURE_GEOFENCE=false, so app.js:191 does not mount /api/geofences.
2. Log in as admin. The sidebar item is hidden (Sidebar.jsx:127 gated by FLAG_GATED at :162).
3. Type /admin/geofences in the address bar. PrivateRoute (App.jsx:358) admits admin and the page mounts.
4. AdminGeofences.jsx:58 issues GET /api/geofences. Express falls through to app.js:202 and returns 200 text/html.
5. axios resolves successfully; AdminGeofences.jsx:61 Array.isArray(gf.data?.data) is false → setGeofences([]), no error. The page renders the empty state plus the seed-defaults button.

### Impact

With FEATURE_GEOFENCE off, an admin who types /admin/geofences (the route still exists at App.jsx:357; only the sidebar link is hidden by Sidebar.jsx:162) sees a fully-rendered page reporting 'ยังไม่มีจุดเตือนภัย' — no geofences configured — alongside a 'seed defaults' button, when in fact the feature is simply not mounted. That is exactly the reverse of the truth, and the page's own comment (AdminGeofences.jsx:42-43) says this empty state 'invites an admin to seed defaults over data that may already exist'. More broadly, every frontend 404/error path for GET /api/* is dead in production, and any typo'd or renamed GET endpoint degrades to a silent empty page instead of a visible failure.

### Severity justification

Major under 'two layers disagree on a rule' and 'a core function is wrong': the backend documents these paths as 404 and the frontend's whole GET error path depends on that, but in production every unmatched GET /api/* is a 200 text/html success. Concrete failure path: FEATURE_GEOFENCE off, admin opens /admin/geofences (route still registered at App.jsx), page asserts 'no geofences configured' instead of 'feature unavailable'. Same false-empty result for any typo'd, removed, or not-yet-deployed GET endpoint (e.g. a frontend deployed ahead of the backend). Not critical: no authz or data effect, and the destructive follow-up the auditor feared cannot fire — seedDefaults is a POST, which app.get('*') does not catch, so it still errors.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY, NOT APPLIED. Insert an /api-scoped 404 JSON handler immediately before the express.static/app.get('*') block in the production branch of app.js, e.g. app.use('/api', (req,res)=>res.status(404).json({success:false,message:'Route not found',errors:[],data:null})), so the SPA fallback only ever serves non-/api paths.

### Required regression tests

- With FEATURE_GEOFENCE=false and NODE_ENV=production, GET /api/geofences returns 404 with JSON content-type.
- GET /any/spa/route still returns index.html with 200.
- GET /api/school/dashboard for an authenticated school user is unaffected.
- AdminGeofences with the flag off renders an error state, not an empty list with a seed button.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-027: The SPA has no 403 handling at all; a user with must_change_password who reloads lands on a dashboard where every API call 403s and nothing tells them why

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** error-handling
- **Layer:** frontend HTTP interceptor + root redirect vs. backend auth middleware
- **Affected roles:** driver, school, affiliation, province, transport, admin
- **Affected entities:** users.must_change_password
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

backend/src/middleware/auth.js:103-110 returns 403 with code MUST_CHANGE_PASSWORD on every authenticated path except the three in MUST_CHANGE_ALLOWLIST (auth.js:11-15: /api/auth/me, /api/auth/change-password, /api/auth/logout). The axios response interceptor handles only status 401 (axios.js:57) and re-rejects everything else at :101; there is no global 403 branch and no MUST_CHANGE_PASSWORD handling anywhere in frontend/src (grep for 'MUST_CHANGE' returns zero hits). Login.jsx:44-48 is the only place that reads must_change_password, and it acts only on the login response. RootRedirect (App.jsx:180-186) ignores the flag entirely and sends the rehydrated user straight to ROLE_HOME[user.role].

### Evidence

- **File:** `frontend/src/api/axios.js`
- **Lines:** 51-102 (response interceptor); backend at backend/src/middleware/auth.js:103-110; redirect at frontend/src/App.jsx:180-186
- **Symbol:** api.interceptors.response.use / RootRedirect
- **Caller:** Every authenticated page in the app; the only reader of the flag is frontend/src/pages/Login.jsx:44.

```js
    if (dbUser.must_change_password && !MUST_CHANGE_ALLOWLIST.has(path)) {
      return sendError(
        res,
        'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',
        [{ code: 'MUST_CHANGE_PASSWORD' }],
        403
      );
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

middleware/auth.js:11-15 allow-lists only /api/auth/me, /api/auth/change-password, /api/auth/logout, and :103-110 returns 403 with code MUST_CHANGE_PASSWORD on every other authenticated path. frontend/src/api/axios.js:51-102 branches on status===401 only and re-rejects everything else at :101 — there is no 403 branch and no MUST_CHANGE_PASSWORD string anywhere in frontend/src (grep for must_change returns only Login.jsx:44 and three admin/school display sites). App.jsx:180-186 RootRedirect sends the rehydrated user to ROLE_HOME[user.role] without consulting the flag. I also checked who is in this state: driverProfile.service.js:73-76 auto-provisions driver logins with must_change_password TRUE, and admin.routes.js:240 / school.routes.js:1928,1967 / affiliationAdmin.service.js:56,103,190 all set it TRUE on create and on reset — so this is the standing state of the entire auto-provisioned driver population the lead measured, not an edge case.

### Expected logic

A 403 carrying MUST_CHANGE_PASSWORD should redirect to /change-password from anywhere, and RootRedirect should honour the flag it already has in the stored user object.

### Trigger / reproduction steps

1. Admin resets a user's password, setting users.must_change_password = TRUE (school.routes.js:1933 teacher reset, or the admin user-management reset).
2. The user logs in. Login.jsx:44 sees must_change_password and routes to /change-password. Correct so far.
3. The user reloads the page, or navigates to '/'.
4. AuthProvider rehydrates from localStorage (useAuth.jsx:13); RootRedirect (App.jsx:185) redirects to ROLE_HOME[role], e.g. /driver.
5. Every call the dashboard makes hits auth.js:103 and returns 403 MUST_CHANGE_PASSWORD. axios.js:57 only handles 401, so nothing intercepts it.
6. The user sees a broken dashboard with no explanation and no link back to /change-password except via the TopNavbar account menu.

### Impact

A user in the forced-password-change state who reloads the tab, presses browser Back from /change-password, or opens a bookmark is routed by RootRedirect to their role dashboard. Every data call on that dashboard returns 403 MUST_CHANGE_PASSWORD, which no interceptor recognises, so each page falls into its own catch and renders an error or empty state — the app does not log out and gives no indication that a password change is the blocker. The only route out is the buried 'change password' item in the account menu (components/TopNavbar.jsx:206). This hits precisely the population most likely to be in this state: newly created accounts and admin-reset accounts, including elderly drivers on mobile.

### Severity justification

Major under 'a core function is wrong' and 'two layers disagree on a rule': the backend enforces the forced password change on every request, the frontend enforces it only on the login response. Failure path: a driver whose account is in the default state logs in, is sent to /change-password, then reloads the tab or opens a bookmark; RootRedirect drops them on /driver, every call 403s, no interceptor recognises the code, each page renders its own generic error/empty state, the app neither logs them out nor says a password change is the blocker. The only escape is the account-menu 'change password' item (TopNavbar.jsx:206). This is the strongest finding in my set — it hits the largest and least technical user population by default. Not critical: no data exposure and no bypass.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY, NOT APPLIED. Add a 403 branch to the axios response interceptor that inspects error.response.data.errors[0].code and redirects to /change-password on MUST_CHANGE_PASSWORD, and make RootRedirect return <Navigate to="/change-password"/> when user.must_change_password is truthy. Decide deliberately whether other 403s should surface a shared 'no permission' screen rather than each page's ad-hoc catch.

### Required regression tests

- A must_change_password user who reloads at '/' lands on /change-password, not a dead dashboard.
- A 403 from a legitimate scope denial (e.g. requireFullSchoolScope, school.routes.js:87-95) still shows an in-page message and does NOT redirect to /change-password.
- The existing 401 refresh-and-retry queue (axios.js:56-99) is unchanged.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-028: CI never applies the 42 migration files — the integration test database is built from a separate mysqldump snapshot, so migration/schema drift is undetectable

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** ci-coverage-gap
- **Layer:** ci
- **Affected roles:** -
- **Affected entities:** backend/tests/schema.sql, backend/migrations/*.sql
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The CI test database (lampang_bus_test, created against the mysql:8.0 service container defined at full-quality.yml:15-26) is loaded from backend/tests/schema.sql — a 73KB mysqldump-style snapshot. I grepped prepare-test-db.js for the string 'migration': there is no reference to the backend/migrations/ directory anywhere in it. Combined with finding #1 (check:migrations runs in static mode and never touches a DB), no CI step in either workflow executes a single .sql file from backend/migrations/.

### Evidence

- **File:** `backend/scripts/prepare-test-db.js`
- **Lines:** 16 (SCHEMA_PATH); invoked from backend/package.json "test:ci"; run at .github/workflows/full-quality.yml:54
- **Symbol:** prepare-test-db.js SCHEMA_PATH / readRawSchema() -> npm run test:prepare -> npm run test:ci
- **Caller:** GitHub Actions job `backend-quality`, step `- run: npm run test:ci` (full-quality.yml:54), which expands to `npm run test:prepare && jest ...`

```js
// backend/scripts/prepare-test-db.js:16
const SCHEMA_PATH = path.join(__dirname, '../tests/schema.sql');

// backend/scripts/prepare-test-db.js:18-20
function readRawSchema() {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Confirmed and stronger than reported. prepare-test-db.js:16 loads backend/tests/schema.sql (73KB mysqldump, 53 CREATE TABLE) and contains no reference to backend/migrations/; test:ci = test:prepare + full jest. I did the diff the auditor did not: five tables created by migrations are absent from the snapshot — driver_documents and vehicle_documents (045), registration_roster_students (044), audit_logs_archive and checkin_logs_archive (047). All are referenced by live code (registration.routes.js, driverDocuments.service.js, vehicleRegistration.service.js). So the divergence is not latent, it exists today, and those code paths cannot be covered by any DB-backed test in CI.

### Expected logic

needs owner confirmation — see owner_question.

### Trigger / reproduction steps

1. Read .github/workflows/full-quality.yml:54 — `- run: npm run test:ci`.
2. Read backend/package.json — "test:ci": "npm run test:prepare && jest ..." and "test:prepare": "node scripts/prepare-test-db.js".
3. Read backend/scripts/prepare-test-db.js:16 — the schema source is ../tests/schema.sql.
4. grep -n 'migration' backend/scripts/prepare-test-db.js returns nothing.
5. Conclude: no CI path executes backend/migrations/*.sql.

### Impact

All 93 backend test files run against tests/schema.sql, not against the schema the migrations actually produce. If a migration and the snapshot diverge (a column added to schema.sql but not to a migration, or vice versa), CI is fully green while production — whose schema is built only by hand-applying the 42 migrations — has a different shape than the code was tested against. The failure surfaces as runtime SQL errors or silently wrong reads on the production database.

### Root cause

Two independent representations of the schema (backend/migrations/*.sql for production, backend/tests/schema.sql for tests) with no CI step that derives one from the other or compares them.

### Severity justification

Major: the verification pipeline for a hand-applied raw-SQL schema tests against a source of truth that has demonstrably diverged from the one production is built from, with no automated reconciliation. Promoted in evidence but not to critical — it produces untested code paths and latent runtime SQL errors, not an authz bypass or data loss on its own.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: build the CI test database by applying backend/migrations/*.sql in order instead of loading tests/schema.sql, or add a CI step that builds both and fails on a schema diff (e.g. compare `SHOW CREATE TABLE` output for every table between a migrations-built DB and a snapshot-built DB).

### Required regression tests

- CI job: apply migrations to DB A, load tests/schema.sql into DB B, dump both schemas normalized, assert they are identical.

### Product Owner confirmation question

> Is backend/tests/schema.sql intended to be a regenerated artifact that always equals the result of applying all 42 migrations, or is it maintained by hand? If the former, what regenerates it and what enforces that it was regenerated?

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-029: Admin dashboard 'failed logins (30d)' is hard-wired to always read 0 — the metric queries entity_type='auth_failure', which nothing in the codebase ever writes

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** monitoring-blind-spot
- **Layer:** backend route + frontend KPI
- **Affected roles:** admin
- **Affected entities:** audit_logs, users
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

All three failed-login audit writes in backend/src/routes/auth.routes.js use entityType 'user', not 'auth_failure': line 150 (`newValue: { username, result: 'failed', reason: 'user_not_found' }` with `entityType: 'user'`), line 161 (reason 'account_disabled'), line 173 (reason 'wrong_password'). A repo-wide grep for entity_type/entityType 'auth_failure' returns exactly one hit — this SELECT. The count is therefore structurally always 0.

### Evidence

- **File:** `backend/src/routes/admin.routes.js`
- **Lines:** 683-687, 718
- **Symbol:** GET /api/admin/system-health (errorApprox query)
- **Caller:** frontend/src/pages/admin/SystemHealth.jsx:45

```js
    // Error count: approximate from failed logins
    const [[errorApprox]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM audit_logs
       WHERE action = 'LOGIN' AND entity_type = 'auth_failure'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

admin.routes.js:683-687 counts audit_logs WHERE action='LOGIN' AND entity_type='auth_failure'. Grep across backend/ returns exactly one occurrence of 'auth_failure' outside the frontend label map: this SELECT. All three failed-login writes in auth.routes.js (150, 161, 173) use entityType 'user' with the reason inside new_value. The value is surfaced as login_failures_30d (line 718) and rendered with a red/green threshold >10 in frontend/src/pages/admin/SystemHealth.jsx:45-46. The tile is permanently 0/green.

### Expected logic

The metric should count the failed-login rows that auth.routes.js actually writes, i.e. rows where action='LOGIN' and JSON_EXTRACT(new_value,'$.result')='failed'.

### Trigger / reproduction steps

1. Make 20 login attempts with a wrong password (any username) against POST /api/auth/login.
2. Confirm the audit rows exist: GET /api/admin/audit-logs?action=LOGIN — the failed attempts appear with entity_type='user'.
3. GET /api/admin/system-health as admin — login_failures_30d is 0.
4. Open the admin System Health page — 'ล็อกอินล้มเหลว' shows 0 in green.

### Impact

frontend/src/pages/admin/SystemHealth.jsx:45-46 renders this value as the KPI 'ล็อกอินล้มเหลว' with a threshold `data.login_failures_30d > 10 ? 'red' : 'green'`. The tile is permanently 0 and permanently green. A credential-stuffing or brute-force campaign against /api/auth/login writes hundreds of correct audit rows, but the only place a human is shown a failed-login count reports zero, and no other alerting path in the repo watches failed logins (scripts/health-smoke.sh does not query the DB for auth events). Detection of an ongoing attack depends on an operator manually filtering /api/admin/audit-logs.

### Severity justification

Meets 'data is partly incorrect' — a security KPI displays a fabricated constant and its alert threshold can never fire. Not critical: the audit rows themselves are written correctly, and auth.routes.js:131-135 has a real per-(username,IP) lockout (isLoginLocked, 429 for 15 min), so brute-force is throttled by a control other than this dead dashboard number.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: change the predicate to match what is written, e.g. action='LOGIN' AND JSON_EXTRACT(new_value,'$.result')='failed'. Do not apply.

### Required regression tests

- Insert N failed-login audit rows via the real login route, then assert GET /api/admin/system-health returns login_failures_30d === N.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-030: The health smoke test scans the wrong log directory — PM2 was reconfigured to write outside ~/.pm2/logs, so the critical-error scan reads a stale/empty path and reports PASS

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** monitoring-blind-spot
- **Layer:** ops script vs process manager config
- **Affected roles:** admin
- **Affected entities:** operational logs
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

ecosystem.config.js:26-27 redirects the backend's streams away from the PM2 default directory: `error_file: '/home/schoolbus/logs/schoolbus-backend.error.log'`, `out_file: '/home/schoolbus/logs/schoolbus-backend.out.log'`. scripts/deploy-backend.sh:9,27 deploys with `pm2 reload $ECOSYSTEM` against that file, and ecosystem.config.js:8 documents `pm2 start ecosystem.config.js` for boot. The smoke script still greps $HOME/.pm2/logs. The stale-path theory is corroborated by the baseline comment at scripts/health-smoke.sh:49-50 and docs/phase-9-ops-notes.md:526, which reference `schoolbus-backend-error.log` (the PM2 default naming) rather than the ecosystem file's `schoolbus-backend.error.log`.

### Evidence

- **File:** `scripts/health-smoke.sh`
- **Lines:** 36, 328-336
- **Symbol:** section 'H. PM2 log scan (critical patterns)' / PM2_LOG_DIR
- **Caller:** scripts/health-smoke-alert.sh:207 (bash "$SMOKE_SCRIPT"), driven by ops/systemd/schoolbus-health-alert.timer every 30 min

```js
PM2_LOG_DIR="$HOME/.pm2/logs"
...
  PATTERN='ENOSPC|No space left|errno 28|Lock wait timeout|ER_LOCK_WAIT_TIMEOUT|deadlock|fatal|uncaught|Unhandled'
  MATCHES="$(grep -RniE "$PATTERN" "$PM2_LOG_DIR" 2>/dev/null || true)"
  if [ -z "$MATCHES" ]; then
    pass "no critical patterns found in PM2 logs"
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

scripts/health-smoke.sh:36 sets PM2_LOG_DIR="$HOME/.pm2/logs" and section H (lines 327-336) greps that directory for ENOSPC|deadlock|fatal|uncaught|Unhandled. ecosystem.config.js:26-27 sets error_file/out_file to /home/schoolbus/logs/schoolbus-backend.{error,out}.log, and scripts/deploy-backend.sh:9,27 reloads via that ecosystem file. So the scanned directory is not where the app's streams land. If the directory is absent the script emits SKIP (not FAIL); if it holds pre-June residue it reports the frozen BASELINE of 7. I also confirmed backend/package.json has no morgan/pino/Sentry/OTel dependency and backend/src/middleware/ holds only auth, errorHandler, optionalAuth, rateLimiters, roleGuard — so this scan really is the only automated error detection in the repo.

### Expected logic

The scan should read the paths PM2 is actually configured to write, i.e. /home/schoolbus/logs/schoolbus-backend.error.log (ideally derived from `pm2 jlist` rather than hard-coded).

### Conflict

ecosystem.config.js:26-27 declares the log destination; scripts/health-smoke.sh:36 hard-codes a different one. At runtime PM2's config wins and the monitor reads an unused directory.

### Trigger / reproduction steps

1. On the server, run `pm2 jlist | grep pm_err_log_path` — it points at /home/schoolbus/logs/schoolbus-backend.error.log when started from ecosystem.config.js.
2. `ls ~/.pm2/logs` — the backend's current error log is not there.
3. Append a line containing 'uncaught' to /home/schoolbus/logs/schoolbus-backend.error.log and run `bash scripts/health-smoke.sh` — section H still reports PASS/BASELINE.

### Impact

Section H is the ONLY automated error-tracking mechanism in the entire repo (there is no morgan/access log, no Sentry or other aggregation client in backend/package.json:23-37, and errorHandler.js writes only to stdout/stderr). Since 2026-06-29, when ecosystem.config.js was adopted, uncaught exceptions (backend/src/index.js:156-159), unhandled rejections (index.js:153-155), MySQL deadlocks and ENOSPC land in /home/schoolbus/logs/ while the watchdog greps a directory that at best holds pre-June residue. The check reports either PASS ('no critical patterns') or the frozen BASELINE count of 7 — never a new signal.

### Severity justification

Two layers disagree on a concrete fact (ecosystem.config.js log destination vs the watchdog's scan path), and the disagreement voids the system's only automated crash/deadlock/disk-full detection. Concrete failure path, not a hardening opinion.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: set PM2_LOG_DIR from the ecosystem config (or parse `pm2 jlist` for pm_err_log_path), and re-baseline BASELINE_PM2_CRITICAL_MATCHES against the real file. Do not apply.

### Required regression tests

- Write a synthetic 'uncaught' line into the configured pm2 error_file and assert health-smoke.sh section H does not report PASS.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-031: A user's scope change (which school/affiliation they can see) is written to the audit trail without the old or new scope_id

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** incomplete-audit-record
- **Layer:** backend route
- **Affected roles:** admin, school, affiliation
- **Affected entities:** users, audit_logs
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The handler SELECTs scope_type, scope_id and driver_id at line 146 and writes all three scope columns at line 201, but the audit record carries only display_name, is_active and role on both sides. scope_id, scope_type and the grade_scope reset are recorded on neither oldValue nor newValue. The system's tenancy boundary is users.scope_type/scope_id (students link to schools via students.school_id), so the field that determines which school's students a user can read is exactly the field left out of the record.

### Evidence

- **File:** `backend/src/routes/admin.routes.js`
- **Lines:** 182-208
- **Symbol:** PUT /api/admin/users/:id
- **Caller:** admin user-management UI

```js
    if (role && VALID_ROLES.includes(role)) {
      const scopeType = SCOPED_ROLES[role] || null;
      updates.push('role = ?', 'scope_type = ?', 'scope_id = ?');
      params.push(role, scopeType, scope_id || null);
      if (role !== 'school') updates.push('grade_scope = NULL');
...
    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: userId,
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

admin.routes.js:146 SELECTs scope_type, scope_id, driver_id; lines 182-187 write role, scope_type, scope_id and reset grade_scope; lines 189-195 bump password_changed_at precisely when role/scope changes. The logAudit at 203-208 records oldValue {display_name, is_active, role} and newValue {display_name, is_active, role} only — scope_id, scope_type and the grade_scope reset appear in neither. Re-pointing a school user from school A to school B therefore produces an audit row indistinguishable from a display-name edit.

### Expected logic

Business-rule confirmation needed on retention/PII, but at minimum the before/after of scope_type, scope_id and grade_scope belongs in the audit row, since it is the change that alters data visibility.

### Trigger / reproduction steps

1. As admin, note a school user's current scope_id via GET /api/admin/users.
2. PUT /api/admin/users/:id with body {"role":"school","scope_id":"<a different school id>"}.
3. GET /api/admin/audit-logs?action=UPDATE — the newest row for entity_type='user' shows no scope_id on either side.

### Impact

An admin re-pointing a school user from school A to school B (POST body {role:'school', scope_id:'<school B>'}) produces an audit row that reads identical to a plain display-name edit: old {role:'school'}, new {role:'school'}. After the fact, neither GET /api/admin/audit-logs nor the CSV export can answer 'who moved this account into school B and when'. The same gap hides a grade_scope reset (a narrow-scope teacher account silently widened or cleared). Note the codebase clearly understands the sensitivity — lines 189-195 bump password_changed_at on exactly this change to force re-login under the new scope — but the evidence of the change is not preserved.

### Severity justification

The tenancy boundary (users.scope_type/scope_id) is exactly the field omitted, so the audit trail cannot reconstruct who moved an account into another school's data — a significant action recorded without its before/after value. Not critical: no access is granted that authorisation does not already permit, and the same handler forces re-login on the change.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: include scope_type, scope_id and grade_scope in both oldValue (from the row already fetched at line 146) and newValue. Do not apply.

### Required regression tests

- Change a user's scope_id and assert the resulting audit row contains both the previous and new scope_id.
- Change role away from 'school' and assert the grade_scope reset appears in newValue.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-032: Exporting the audit trail as CSV is itself audited on the province and affiliation endpoints but not on the admin and school ones

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** missing-audit-on-export
- **Layer:** backend route
- **Affected roles:** admin, school
- **Affected entities:** audit_logs
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The province and affiliation CSV branches fire an EXPORT audit row immediately before responding — province.routes.js:216-217 and affiliation.routes.js:590-591 both call `logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'audit_csv', entityId: 'province'|'affiliation', ... ipAddress: req.ip, userAgent: ... }).catch(() => {})`. The admin branch (a scripted pass over every handler in admin.routes.js confirms zero logAudit calls anywhere inside the /audit-logs handler) and the school branch return the file with no audit row. Both hand out up to 5000 audit rows per request (LIMIT 5001 with truncation detection).

### Evidence

- **File:** `backend/src/routes/admin.routes.js`
- **Lines:** 556-580 (admin); backend/src/routes/school.routes.js:1226-1243 (school)
- **Symbol:** GET /api/admin/audit-logs?format=csv and GET /api/school/audit-logs?format=csv

```js
      res.setHeader('Content-Disposition', `attachment; filename=audit_admin_${new Date().toISOString().split('T')[0]}.csv`);
      if (truncated) res.setHeader('X-Truncated', 'true');
      return res.send('﻿' + csv);
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

province.routes.js:216-217 and affiliation.routes.js:590-591 both fire logAudit({action:'EXPORT', entityType:'audit_csv', ipAddress:req.ip, userAgent:...}) immediately before res.send. The admin CSV branch (admin.routes.js:556-582) and the school CSV branch (school.routes.js:1226-1243) contain no logAudit call at all — I read both branches end to end. Both return up to 5000 audit rows (LIMIT 5001 with truncation detection).

### Expected logic

Consistent with the two endpoints that already do it: every audit-trail export writes an EXPORT row naming the actor, the filters used and the row count. The Product Owner should confirm the intended policy, since this is a rule about what must be logged.

### Conflict

Four sibling implementations of the same export: province and affiliation write an EXPORT audit row; admin and school do not. Nothing at runtime reconciles them.

### Trigger / reproduction steps

1. As admin, GET /api/admin/audit-logs?format=csv — a CSV downloads.
2. GET /api/admin/audit-logs?action=EXPORT — no row exists for this export.
3. Repeat as role=province against /api/province/audit-logs?format=csv — an EXPORT/audit_csv row does appear.

### Impact

An admin (or a school user, for their own school's slice) can repeatedly download the full audit trail — which contains student and guardian data, login history and every administrative action — and leave no trace of the export. Report exports are audited (report.routes.js:244, 298, 459, 484, 521, 643) and the research dataset export is audited (admin.routes.js:1041), so this is a hole in an otherwise consistent export-evidence trail. The system even builds an 'export_evidence' sheet from action='EXPORT' rows (admin.routes.js:958, 982) for research reporting, which is therefore incomplete.

### Severity justification

Matches the brief's major criteria twice: no audit log for a significant action (bulk export of the audit trail itself), and two layers disagreeing on the same rule (two of four otherwise-identical endpoints record the export, two do not). The export_evidence sheet built from action='EXPORT' rows at admin.routes.js:958,982 is therefore incomplete by construction.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only: copy the province.routes.js:216-217 logAudit call into the admin and school CSV branches (entityId 'admin' / the school id, plus the date filters and truncated flag). Do not apply.

### Required regression tests

- For each of the four roles, export the audit CSV and assert exactly one action='EXPORT', entity_type='audit_csv' row is created.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-033: GET /api/parent/children returns every linked child's full name, classroom and school with NO consent check — the consent gate is applied to the three detail endpoints only

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** consent-enforcement
- **Layer:** backend route
- **Affected roles:** parent (LINE/LIFF)
- **Affected entities:** students, parent_student, line_bindings, consent_records
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The handler calls lineSvc.getLinkedChildren() and returns the result immediately. It never calls ensureParentConsent(req,res) — the helper defined at backend/src/routes/parent.routes.js:20-27 that the status (L114), history (L129) and eta (L158) handlers all call. getLinkedChildren → line.service.js:416-422 → getChildrenByBoundPhone (line.service.js:243-263) selects `s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom, sc.name AS school_name, v.plate_no` plus a driver_name subquery. So the response carries each child's full Thai name, grade, classroom, school name, bus plate and the driver's name.

### Evidence

- **File:** `backend/src/routes/parent.routes.js`
- **Lines:** 99-104 (compare 108-119, 123-145, 153-164)
- **Symbol:** GET /api/parent/children
- **Caller:** frontend/src/pages/parent/ParentStatus.jsx:41-43 (LIFF parent page) and backend/src/routes/line.routes.js:472,492 (LINE chat commands 'สถานะ' / 'ข้อมูลบุตร')

```js
router.get('/children', requireParentLineAuth, async (req, res, next) => {
  try {
    const children = await lineSvc.getLinkedChildren(req.lineUserId);
    sendSuccess(res, children);
  } catch (err) { next(err); }
});
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

parent.routes.js:99-104 calls lineSvc.getLinkedChildren(req.lineUserId) and returns it directly — no ensureParentConsent call. The three sibling handlers at 108-119, 123-145 and 153-164 each call ensureParentConsent (defined 20-27) after the linkage check. line.service.js:243-263 (getChildrenByBoundPhone) selects prefix, first_name, last_name, grade, classroom, school name, plate_no and a driver_name subquery, so /children is indeed the largest-PII payload in the parent channel.

### Expected logic

The module that owns this rule states the intent explicitly — backend/src/services/parentConsentGate.js:4-6: 'parent sees only children that are LINKED and have CONSENT'. Under that rule, a parent who has not granted (or has withdrawn) the tracking consent should not be shown the child's identifying data on any parent endpoint, including the list endpoint.

### Conflict

parentConsentGate.js:4-6 and env.js:194-200 both describe the gate as covering 'the /api/parent status/history/eta endpoints'; the same gate's own docstring describes the rule as covering which CHILDREN a parent may see. The route layer implements the narrower reading, so the /children payload escapes the rule the service layer declares.

### Trigger / reproduction steps

1. Set FEATURE_PARENT_CONSENT_REQUIRED=true and FEATURE_VEHICLE_QR=true and restart the backend.
2. As a bound parent inside LIFF, POST /api/consent/parent with a valid id_token (records qr_parent_optin = granted), then POST /api/consent/parent/withdraw (records qr_parent_optin = withdrawn).
3. GET /api/parent/children/<id>/status with the same id_token → 403 PARENT_CONSENT_REQUIRED, as designed.
4. GET /api/parent/children with the same id_token → 200, and the JSON still contains first_name, last_name, grade, classroom, school_name, plate_no and driver_name for every linked child.

### Impact

The consent gate is unenforceable for the single most identifying payload in the parent channel. Even after FEATURE_PARENT_CONSENT_REQUIRED is switched on, and even after a guardian exercises the PDPA ม.19(5) right to withdraw consent (POST /api/consent/parent/withdraw), /api/parent/children keeps disclosing the child's full name, grade, classroom, school, bus plate and driver name. The withdrawal produces a 403 on status/history/eta while the list screen the parent lands on first still renders the children. The LINE chat command 'ข้อมูลบุตร' (line.routes.js:491-507) goes through the same ungated call and pushes a Flex card with the same fields.

### Root cause

ensureParentConsent() was added to the three detail handlers but not to the list handler; nothing structural (e.g. a router-level middleware) forces the gate onto every child-data route.

### Severity justification

Two layers disagree on the same rule: the consent gate is applied to three of the four parent endpoints and omitted on the one carrying the most personal data, so a PDPA withdrawal would be only partially effective once the flag is on. Not critical — the recipient still has to pass LINE id_token verification and be joined through parent_student.approved=TRUE (line.service.js:254-260), so this is not disclosure to a stranger.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Either insert the same `if (!(await ensureParentConsent(req, res))) return;` guard into the /children handler after requireParentLineAuth, or (better, so the next endpoint cannot repeat the omission) promote the gate to router-level middleware mounted after requireParentLineAuth for every /children* path, with an explicit allow-list for any endpoint that must stay ungated.

### Required regression tests

- With featureEnabled=true and no consent row, GET /api/parent/children returns 403 PARENT_CONSENT_REQUIRED.
- With featureEnabled=true and a granted qr_parent_optin row, GET /api/parent/children returns 200 with the child list.
- With featureEnabled=true and a latest 'withdrawn' row, GET /api/parent/children returns 403.
- With featureEnabled=false, GET /api/parent/children returns 200 (unchanged legacy behaviour) and performs no consent DB query.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-034: Turning on FEATURE_PARENT_CONSENT_REQUIRED alone hard-locks every parent out: the consent router is not mounted, the LIFF parent page has no consent UI, and one of the two accepted consent types cannot be recorded at all

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** configuration-dependency
- **Layer:** app wiring + config + frontend
- **Affected roles:** parent (LINE/LIFF)
- **Affected entities:** consent_records
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The ONLY endpoints that can write a parent consent row are POST /api/consent/parent and POST /api/consent/parent/withdraw (consent.routes.js:44-55), and they are mounted only when FEATURE_VEHICLE_QR is true. env.js validateFeatureDependencies (L51-56) enforces exactly one dependency — 'FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true' — and says nothing about FEATURE_PARENT_CONSENT_REQUIRED. So the backend boots happily with FEATURE_PARENT_CONSENT_REQUIRED=true and FEATURE_VEHICLE_QR=false. In that state guardParentView (parentConsentGate.js:63-67) queries consent_records, finds nothing, and every /api/parent/children/:id/{status,history,eta} call returns 403 PARENT_CONSENT_REQUIRED forever, with no reachable endpoint to grant consent (/api/consent 404s). Separately, PARENT_CONSENT_TYPES[0] = 'parent_tracking_optin' (parentConsentGate.js:26) is not a key in backend/src/config/consentTe

### Evidence

- **File:** `backend/src/app.js`
- **Lines:** 176-179 (with backend/src/config/env.js:51-56 and backend/src/services/parentConsentGate.js:26)
- **Symbol:** app.js feature-flag mount block / validateFeatureDependencies / PARENT_CONSENT_TYPES
- **Caller:** backend/src/routes/parent.routes.js:20-27 ensureParentConsent → parentConsentGate.guardParentView

```js
if (env.features.vehicleQr) {
  app.use('/api/qr',      require('./routes/qr.routes'));
  app.use('/api/consent', require('./routes/consent.routes'));
}
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

app.js:176-179 mounts /api/consent only when env.features.vehicleQr is true; env.js:51-56 validateFeatureDependencies enforces only 'FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true'; env.js:196-200 reads parentConsentRequired independently, its own comment saying 'Turn on only together with FEATURE_VEHICLE_QR's consent flow' — documented but unenforced. parentConsentGate.js:26 accepts ['parent_tracking_optin','qr_parent_optin'] while consent.routes.js:44-49 can only write qr_parent_optin. I also verified the frontend claim: grep shows ParentConsentModal is imported only by frontend/src/pages/qr/VehicleQr.jsx:5,242 — frontend/src/pages/parent/{ParentStatus,ParentLink}.jsx contain no consent code at all.

### Expected logic

env.js:194-199 documents the operator instruction 'Turn on only together with FEATURE_VEHICLE_QR's consent flow.' A documented dependency that the config validator does not enforce, on a flag whose failure mode is a hard 403 for every parent, is a footgun rather than a control.

### Conflict

env.js:199 tells the operator the flags are coupled; env.js validateFeatureDependencies (L51-56) enforces coupling only for FEATURE_QR_LEVEL3. parentConsentGate.js:26 accepts a consent type ('parent_tracking_optin') that consentText.js does not define and consent.service.js:56 actively rejects.

### Trigger / reproduction steps

1. Set FEATURE_PARENT_CONSENT_REQUIRED=true, leave FEATURE_VEHICLE_QR=false (the .env.example default at line 87), restart. The backend starts — validateEnvOrExit raises nothing.
2. As a correctly bound parent, GET /api/parent/children/<id>/status with a valid LIFF id_token → 403 with code PARENT_CONSENT_REQUIRED.
3. POST /api/consent/parent with the same token → 404 (router not mounted).
4. Now also set FEATURE_VEHICLE_QR=true and restart. Open the parent LIFF page /parent. There is still no consent prompt anywhere on that page — the only ParentConsentModal call site is the QR page /qr/:token.

### Impact

An operator following docs/MVP-CUT-2026-08.md:37 ('เปิดพร้อม QR/consent') can still set the two flags independently. Setting FEATURE_PARENT_CONSENT_REQUIRED=true without FEATURE_VEHICLE_QR=true takes the entire parent tracking channel offline — every guardian loses status, history and ETA for their child with an error telling them to give consent, and there is nowhere to give it. Even with BOTH flags on, the parent-facing tracking page frontend/src/pages/parent/ParentStatus.jsx never renders a consent screen: grep across frontend/src shows ParentConsentModal is imported and used only in frontend/src/pages/qr/VehicleQr.jsx:5,242. A parent who never scans a vehicle QR therefore cannot grant the consent the /api/parent endpoints demand.

### Root cause

The consent-capture surface (router + modal) was built for the QR feature and gated on the QR flag, while the consent-enforcement surface (parentConsentGate) was added to the always-on parent API and gated on a separate flag, with no dependency check tying them together and no consent UI added to the parent page.

### Severity justification

Core function wrong plus layers disagreeing on a rule: with the flag on, guardParentView returns 403 PARENT_CONSENT_REQUIRED for status/history/eta and the LIFF parent page offers no way to grant consent — a parent who never scans a vehicle QR can never clear the gate even under the 'correct' both-flags-on configuration. Not critical: it denies the parent their own access rather than exposing data, and it only bites when an operator flips the flag.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Three separate changes: (1) extend env.js validateFeatureDependencies with 'FEATURE_PARENT_CONSENT_REQUIRED requires FEATURE_VEHICLE_QR=true' (or decouple by mounting /api/consent unconditionally); (2) remove 'parent_tracking_optin' from parentConsentGate.PARENT_CONSENT_TYPES or add a matching entry to consentText.js — today it is a dead type that would throw; (3) add the consent prompt to ParentStatus.jsx so the gate is satisfiable from the page it gates.

### Required regression tests

- validateFeatureDependencies({FEATURE_PARENT_CONSENT_REQUIRED:'true', FEATURE_VEHICLE_QR:'false'}) throws.
- recordConsent({consentType:'parent_tracking_optin'}) either succeeds against a defined text entry or the type is no longer referenced anywhere.
- With both flags on and no consent row, the parent LIFF page renders a consent prompt rather than a bare error.

### Product Owner confirmation question

> For the always-on LIFF tracking channel (child status / history / ETA), which lawful basis does the Province rely on — consent under PDPA ม.19, or a public-task/legitimate-interest basis? If consent: (a) is the qr_parent_optin text at backend/src/config/consentText.js:31-47 the text you intend for tracking data, given it describes only 'ชื่อผู้ขับรถ และช่องทางติดต่อในกรณีฉุกเฉิน' and not the child's location, boarding times or pickup point; and (b) who owns delivering a consent screen inside frontend/src/pages/parent/ParentStatus.jsx before the flag is enabled?

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-035: A driver's withdrawal of PDPA consent suspends only the QR page; the LINE/LIFF parent channel keeps publishing the driver's name

- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** consent-withdrawal-cascade
- **Layer:** service
- **Affected roles:** driver, parent (LINE/LIFF)
- **Affected entities:** drivers, driver_display_status, consent_records, students
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

withdrawConsent (consent.service.js:137-147) writes driver_display_status = 'suspended', reason = 'consent_withdrawn' when a driver withdraws qr_driver_public or qr_driver_parent. Exactly one reader of that table exists in the codebase — `grep -rn "driver_display_status" backend/src` returns consent.service.js:106,141 (writers) and qrAccess.service.js:74 (the only reader). qrAccess.buildParentView (L198-209) honours it: `const visible = !!ctx.driver && ctx.driverStatus !== 'suspended';` and nulls driver_name and emergency_contact. The parent LIFF/LINE path does not: the subquery above joins driver_vehicle_assignments with no reference to driver_display_status, so driver_name is returned regardless of the suspension.

### Evidence

- **File:** `backend/src/services/line.service.js`
- **Lines:** 243-263 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76, 198-209)
- **Symbol:** getChildrenByBoundPhone (driver_name subquery)
- **Caller:** backend/src/routes/parent.routes.js:101,111,126,155 via lineSvc.getLinkedChildren; backend/src/routes/line.routes.js:324,472,492 for the LINE Flex cards

```js
            (SELECT d.name
               FROM drivers d
               JOIN driver_vehicle_assignments dva ON dva.driver_id = d.id
              WHERE dva.vehicle_id = v.id
                AND dva.is_active = TRUE
                AND d.is_deleted = FALSE
              LIMIT 1) AS driver_name
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

consent.service.js:137-147 writes driver_display_status='suspended', reason='consent_withdrawn'. grep -rn driver_display_status backend/src returns exactly three code hits: consent.service.js:106 and :141 (writers) and qrAccess.service.js:74 (the only reader), which buildParentView at 198-209 uses to null driver_name and emergency_contact. line.service.js:243-263 joins driver_vehicle_assignments with no reference to that table, so driver_name is returned to bound parents regardless. The consent text is scoped to verified parents, not to the QR channel: consentText.js qr_driver_parent reads 'ระบบจะแสดงต่อผู้ปกครองของนักเรียนที่ใช้บริการรถของท่าน: ชื่อผู้ขับ...' — so the LINE parent channel is squarely inside what was withdrawn.

### Expected logic

backend/src/config/consentText.js:61-70 defines qr_driver_parent as 'ระบบจะแสดงต่อผู้ปกครองของนักเรียนที่ใช้บริการรถของท่าน: ชื่อผู้ขับ' with requiresConsent: true and isRequiredForService: true, and consentText.js:85-88 promises the driver that withdrawal takes effect. The parent LIFF page and the LINE 'ข้อมูลบุตร' card are precisely 'แสดงต่อผู้ปกครอง' surfaces, so the same consent should govern them.

### Conflict

qrAccess.service.js:201 treats driver_display_status='suspended' as a hard gate on disclosing driver_name to parents. line.service.js:247-253 discloses driver_name to the same audience with no such gate. Both are 'the parent view'; they disagree at runtime, and the ungated one is the always-on path (app.js:166) while the gated one is behind FEATURE_VEHICLE_QR.

### Trigger / reproduction steps

1. Enable FEATURE_VEHICLE_QR. As a driver user, POST /api/consent/withdraw with consent_type=qr_driver_parent. consent.service.js:140-145 inserts driver_display_status suspended/consent_withdrawn for that driver.
2. Scan the vehicle QR as a linked+consented parent: GET /api/qr/vehicle/:qr_token returns driver_name: null (qrAccess.js:206). Withdrawal looks effective.
3. As the same parent, GET /api/parent/children with the LIFF id_token: the response still contains driver_name for that vehicle.
4. Type 'ข้อมูลบุตร' in the LINE OA chat: line.routes.js:492-505 pushes buildParentChildrenInfoCard(children) built from the same ungated rows.

### Impact

A driver who exercises the PDPA ม.19(5) right to withdraw consent for showing their name to parents continues to have their name shown to every bound parent on the vehicle — on the /parent LIFF page (via GET /api/parent/children) and in the LINE Flex cards pushed by the 'ข้อมูลบุตร' and bind-success flows. The system reports the withdrawal as effective (the QR page goes dark) while the higher-traffic channel is unaffected. The same blind spot applies to /api/school/vehicles (school.service.js:290), transport.service.js:167,217, province.service.js:460,627 and affiliation.service.js:302,472, all of which select driver_name without consulting driver_display_status.

### Root cause

The consent-suspension flag was introduced with the QR feature and only wired into the QR view builder; the pre-existing parent query was never brought under the same rule.

### Severity justification

Two layers disagree on the same consent rule, and the consent text itself (not just the auditor's reading) scopes part 2 to identity-verified parents rather than to the QR page — so the withdrawal is reported as effective while the higher-traffic channel keeps publishing the name. Not critical: the recipients are parents already entitled to know who drives their child, and no pupil data is misdirected. Note the whole consent flow is dark while FEATURE_VEHICLE_QR=false, so this bites at QR rollout, not today.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Make driver_display_status the single source of truth for driver-name disclosure: either LEFT JOIN driver_display_status into getChildrenByBoundPhone and null driver_name when display_status='suspended', or extract qrAccess.deriveDriverDisplayStatus into a shared helper that every driver_name-returning query must call. Then decide (owner question) whether the school/province/transport/affiliation staff views are in or out of scope for the same consent.

### Required regression tests

- Given a driver with driver_display_status='suspended', getChildrenByBoundPhone returns driver_name = null for that vehicle.
- Given a driver with no driver_display_status row or display_status='normal', driver_name is returned unchanged.
- Re-granting all required driver consents (consent.service.js:102-112 sets 'consent_restored') makes driver_name reappear in the parent list.

### Product Owner confirmation question

> When a driver withdraws qr_driver_parent, should their name also disappear from the LINE/LIFF parent view and the operator screens (school/transport/province/affiliation vehicle lists), or is the withdrawal intended to cover the QR page only? The consent text says 'shown to identity-verified parents', which reads wider than the QR page.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-036: GET /api/school/audit-logs returns unredacted guardian phone numbers in its JSON response — the sibling admin, province and affiliation routes all redact the same fields, and this endpoint's own CSV branch does too

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** data-minimisation
- **Layer:** backend route
- **Affected roles:** school, admin
- **Affected entities:** audit_logs, parents, students
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The JSON branch selects `al.old_value, al.new_value` (school.routes.js:1250) and returns the rows untouched at L1261. The CSV branch of the SAME endpoint routes through auditRowsToCsv (school.routes.js:137-154), which applies `redactAuditValue(r.old_value)` / `redactAuditValue(r.new_value)` at L150-151. Those audit values contain guardian phone numbers in full: the PUT /students/:id handler builds them at school.routes.js:818 (`parent_phone: normalizedParentPhone`) and L823 (`parent_phone: st.parent_phone`). exportSecurity.js:75 lists 'parent_phone' in MASK_PHONE_KEYS precisely so it comes out as 081****678.

### Evidence

- **File:** `backend/src/routes/school.routes.js`
- **Lines:** 1249-1261 (contrast 1237 and 137-154)
- **Symbol:** GET /api/school/audit-logs (JSON branch)
- **Caller:** school / admin role UI; also reachable directly with a school JWT

```js
    return sendSuccess(res, rows, 'OK', { page, per_page, total });
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

school.routes.js:1249-1261 returns rows straight from the query, old_value/new_value included. The CSV branch of the same handler (1237) routes through auditRowsToCsv (136-153) which applies redactAuditValue at lines 150-151. exportSecurity.js:75 lists parent_phone in MASK_PHONE_KEYS, and school.routes.js:818/823 write parent_phone into both the new and old audit snapshots on PUT /students/:id — so full guardian mobile numbers are demonstrably present in the JSON payload. All three sibling routes (province 238-246, affiliation 614-621, admin 606-618) redact the identical columns.

### Expected logic

Every sibling audit-log endpoint redacts the JSON path: admin.routes.js:601-613 ('redact/mask PII … before returning JSON, matching the CSV export'), province.routes.js:238-246 ('H1 fix … The CSV path already does this; the JSON path was leaking raw values'), affiliation.routes.js:617-621. The school route is the one that was not brought in line.

### Conflict

school.routes.js CSV branch (L1237 → auditRowsToCsv L150-151) redacts; school.routes.js JSON branch (L1261) does not. Across files, admin/province/affiliation redact both branches. Runtime winner: whichever branch the caller picks — omitting ?format=csv returns raw PII.

### Trigger / reproduction steps

1. Log in as a school-role user and edit a student's guardian phone: PUT /api/school/students/:id with parent_phone. school.routes.js:818-823 writes old_value/new_value containing the old and new full phone numbers into audit_logs.
2. GET /api/school/audit-logs?action=UPDATE — the JSON `old_value` / `new_value` strings contain the full 10-digit numbers.
3. GET /api/school/audit-logs?action=UPDATE&format=csv — the same rows come back as 081****678, proving the control exists and is skipped only on the JSON path.

### Impact

A school-role account browsing the audit trail receives every guardian's full mobile number in the API response, plus any other PII captured in old_value/new_value, where the designed behaviour is a masked value. The same actor can already read parent_phone via GET /api/school/students, so this is not a privilege escalation — but it defeats a deliberate minimisation control on a bulk, paginated, easily-scraped surface (per_page up to 100, no date bound required), and it means an incident that exposes API responses or browser storage exposes phone numbers that the operator's own control says should be masked. Note the redaction gap is JSON-only: the CSV download of the same rows is correctly masked, so the leak is invisible to anyone testing via the export path.

### Root cause

The 'H1 fix' that added JSON-side redaction was applied to province.routes.js, affiliation.routes.js and admin.routes.js but not to school.routes.js, even though school.routes.js already imports redactAuditValue at L134 for its CSV path.

### Severity justification

'Two layers disagree on a rule' in its clearest form: four routes plus this route's own CSV branch implement the redaction, one JSON branch omits it, and the omission is on the school role — the most numerous operator account. Not critical: requireFullSchoolScope excludes grade-scoped teacher sub-accounts, the scope filter keeps rows inside the caller's own school, and the same actor can already read parent_phone via GET /api/school/students, so this is a defeated minimisation control rather than cross-tenant disclosure. Keep this one over idx 67, which is the same lines with a vaguer payload claim.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Mirror the admin.routes.js:607-613 pattern in the school JSON branch: map the rows through redactAuditValue before sendSuccess. Because redactAuditValue returns a JSON string, follow admin's redactVal wrapper (JSON.parse with a string fallback) so the response shape does not change for the existing UI.

### Required regression tests

- GET /api/school/audit-logs (JSON) for a row whose new_value contains parent_phone returns the masked form, byte-identical to the CSV cell for the same row.
- A row containing a key in SENSITIVE_KEYS (e.g. health_note) comes back as '[redacted]' in JSON.
- The CSV branch is unchanged and does not regress (the shadowing bug warned about at admin.routes.js:604-606 must not be reintroduced).

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-037: A child's data is unlocked by a guardian phone number plus a student code, with no proof of possession, and a correct guess returns the child's full name, grade, classroom and school before any ownership is established

- **Provisional severity:** major
- **Status:** needs_owner_confirmation
- **Confidence:** high
- **Category:** authentication-strength
- **Layer:** backend route + service
- **Affected roles:** parent (LINE/LIFF), school
- **Affected entities:** parents, parent_student, students, line_bindings
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

bind-preview verifies that the caller holds a genuine LINE id_token (so the LINE account is real) and that the submitted (phone, student_code) pair matches a parents→parent_student(approved)→students row (line.service.js:100-116). It does NOT verify that the caller controls that phone number. On a match, `match.student` — built at line.service.js:122-129 as { prefix, first_name, last_name, grade, classroom, school_name } — is returned. bind-confirm then permanently links that LINE account to the parent record, after which /api/parent/children, /status, /history (up to 90 days) and /eta are all available. The only brake is lineBindGuard's in-memory lockout (POLICY at lineBindGuard.js:23-28: 5 failures per pair, 10 per phone, 10 per student code, 12 per LINE sub, each per 10-minute window, 30-minute lock) plus the per-IP bindLimiter at parent.routes.js:45-52 (12 per 10 min). The code names

### Evidence

- **File:** `backend/src/routes/parent.routes.js`
- **Lines:** 202-256 (with backend/src/services/line.service.js:100-131 and backend/src/services/lineBindGuard.js:23-28)
- **Symbol:** POST /api/parent/line/bind-preview
- **Caller:** frontend/src/pages/parent/ParentLink.jsx (LIFF bind page); the equivalent chat path is line.routes.js:291-345

```js
    return sendSuccess(res, {
      student: match.student,
      masked_phone: tpl.maskPhone(cleanPhone),
    });
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

parent.routes.js:202-256 verifies a genuine LINE id_token, then matches the submitted (phone, student_code) against parents -> parent_student(approved=TRUE) -> students in line.service.js:100-116, and on success returns match.student — prefix, first_name, last_name, grade, classroom, school_name (built at 122-129). Nothing verifies the caller controls the phone. Compensating controls are real but knowledge-only: bindLimiter (12 per 10 min per IP, parent.routes.js:45-52) and lineBindGuard POLICY (pair 5/10 min then a 30 min lock, plus phone/student/sub counters, lineBindGuard.js:23-28), and line.service.js:144-155 blocks taking over an already-bound phone. The code comment at parent.routes.js:39-43 already acknowledges the residual and names SMS OTP as the fix.

### Expected logic

Whether (phone + student code) is an acceptable credential for access to a child's location data is a controller risk decision, so this is raised as a question, not declared a defect. The verified code fact is that no proof-of-possession step exists anywhere in the bind flow.

### Impact

Both factors are low-entropy and locally known: a Thai mobile number is 10 digits with a small prefix set and is routinely shared, and the student code is printed on school paperwork and visible to classmates, teachers and anyone handling the roster. A person who knows both — a former partner, a relative, a school volunteer, anyone who has seen a class list next to a contact list — can bind their own LINE account and thereafter see the child's name, school, classroom, bus plate, driver name, daily boarding and alighting times, up to 90 days of movement history and the pickup-point label, without the real guardian being notified (bind-confirm pushes the success card to the BINDING account, parent.routes.js:326-331, not to the displaced guardian). The lockout limits guessing but does nothing against someone who already knows both values. Mitigating: bindLineUserToPhone (line.service.js:144-155) refuses a phone already bound to a different LINE account, so this works only before the genuine guardian binds, or after they unbind.

### Severity justification

A concrete path exists by which someone who is not the guardian — but knows two locally-available identifiers — binds their own LINE account and thereafter reads a child's daily boarding times, up to 90 days of movement history, bus plate, driver name and pickup label. That is enough for major. Not critical and not one of the three established items: it is not a bypass (two correct real-world identifiers are required), the lockout makes guessing expensive, and the phone-uniqueness check blocks hijacking an already-bound guardian. Resolution needs an owner decision because the fix is an external dependency.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only — do not apply. Options in increasing strength: mask the student fields in the bind-preview response; notify the school on every bind/unbind for that student; issue a per-student one-time claim code distributed by the school on paper; or add SMS OTP proof of phone ownership. Note that lineBindGuard is in-memory and single-instance (lineBindGuard.js:11-12) — if the backend is ever run under PM2 cluster mode or behind more than one node, the lockout weakens proportionally, so any decision to keep the current credential should be paired with moving the guard to a shared store.

### Required regression tests

- bind-preview with a correct pair returns only the fields the owner approves (masked or full, per the decision).
- bind-preview with a wrong student code 5 times within 10 minutes locks the pair for 30 minutes, and rotating the source IP does not reset it.
- A successful bind-confirm emits whatever notification the owner requires to the school and/or the displaced account.

### Product Owner confirmation question

> Is possession-proof for the parent bind (SMS OTP on the guardian's phone, or a school-issued one-time claim code handed out with the roster) in scope before go-live? Without it, knowledge of a guardian phone number plus a printed student code is sufficient to obtain a child's location history.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-038: Production boots with LINE_CHANNEL_ACCESS_TOKEN unset; every emergency LINE push then silently becomes a no-op that still reports success to the driver

- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** -
- **Layer:** config + service + route
- **Affected roles:** driver, school, admin, parent
- **Affected entities:** emergency_logs, line_notifications
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

env.js requires only LINE_CHANNEL_SECRET and CRON_API_KEY when NODE_ENV=production (line 23). LINE_CHANNEL_ACCESS_TOKEN falls back to '' (line 148) and is never validated. getClient() returns null on an empty token (line 12), so pushEmergencyFlexMessage returns { dryRun: true } after only a console.log. driver.routes.js:668 does not read that return value and driver.routes.js:685-696 still responds 201 'Emergency reported'. Result: inbound LINE (webhook signature) is fail-CLOSED, outbound LINE is fail-SILENT.

### Evidence

- **File:** `backend/src/config/env.js`
- **Lines:** 23, 148; backend/src/services/line.service.js:9-15, 800-812; backend/src/routes/driver.routes.js:668-681
- **Symbol:** PRODUCTION_REQUIRED (env.js) / getClient() + pushEmergencyFlexMessage() (line.service.js) / POST /api/driver/emergency (driver.routes.js)
- **Caller:** backend/src/routes/driver.routes.js:668 calls lineSvc.pushEmergencyFlexMessage(...) inside a try/catch and discards the return value

```js
env.js:23   const PRODUCTION_REQUIRED = ['LINE_CHANNEL_SECRET', 'CRON_API_KEY'];
env.js:148    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
line.service.js:12   if (!env.line.channelAccessToken) return null;
line.service.js:810     console.log('[LINE_EMERGENCY_FLEX_PUSH] dry-run (no channel token)', { target: redacted });
line.service.js:811     return { dryRun: true };
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

env.js:23 PRODUCTION_REQUIRED = ['LINE_CHANNEL_SECRET','CRON_API_KEY'] — the access token is not in the list; env.js:148 falls back to ''. line.service.js:12 getClient() returns null on an empty token, and pushEmergencyFlexMessage (line.service.js:~808-812) then console.logs 'dry-run' and returns { dryRun: true }. driver.routes.js:668-680 awaits that call inside a try/catch that discards the return value, and driver.routes.js:685-696 unconditionally responds 201 'Emergency reported'. I also confirmed the wider gap the auditor did not state: even with a token present, a failed pushMessage returns { sent:false } (line.service.js:795-798, 826-829) and is likewise discarded — nothing in the API response, the audit row (driver.routes.js:637-655) or any table records delivery status. Mitigating fact the auditor omitted: the emergency itself IS durably persisted (emergencySvc.createEmergencyReport + logAudit), so only the LINE alert is lost, not the report.

### Expected logic

backend/.env.example:25 labels the whole LINE OA block '[OPTIONAL in dev / REQUIRED in production]'. If LINE is required in production, a blank LINE_CHANNEL_ACCESS_TOKEN should either refuse boot the same way LINE_CHANNEL_SECRET does, or the dryRun result must be surfaced to the caller and the operator.

### Conflict

backend/.env.example:25-31 documents LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_LIFF_ID / LINE_GROUP_ID as 'REQUIRED in production'. backend/src/config/env.js:23 enforces exactly one of them (LINE_CHANNEL_SECRET). At runtime env.js wins: the app boots.

### Trigger / reproduction steps

1. Set NODE_ENV=production with DB_*, JWT_*, LINE_CHANNEL_SECRET and CRON_API_KEY populated but LINE_CHANNEL_ACCESS_TOKEN left blank in backend/.env.
2. Start the backend. env.js:118-119 runs validateEnvOrExit; getMissingProductionSecrets (line 25-30) only checks LINE_CHANNEL_SECRET and CRON_API_KEY, so boot succeeds.
3. Log in as a driver and POST /api/driver/emergency.
4. Server responds 201 'Emergency reported'. line.service.js:810 logs '[LINE_EMERGENCY_FLEX_PUSH] dry-run (no channel token)' and returns { dryRun: true }; driver.routes.js:668 discards it. No LINE message is sent to LINE_GROUP_ID.

### Impact

A driver presses the emergency button, sees a success screen, and the school LINE group is never notified. Nothing in the API response, the audit trail, or any alert distinguishes 'delivered' from 'dry-run'. The only trace is a console.log line in the PM2 out-log. This is a child-safety notification path failing invisibly on a single missing environment variable.

### Root cause

PRODUCTION_REQUIRED lists only the secrets whose absence would cause an inbound control to fail open, and does not cover the outbound credential whose absence causes an outbound safety notification to fail silent.

### Severity justification

Major under 'two layers disagree on a rule' and 'core function is wrong': backend/.env.example documents the LINE block as production-required while env.js enforces only 2 of 4 variables, and the delivery outcome of a child-safety alert is never recorded anywhere structured. Not critical — no data exposure, no authz bypass, and the emergency record itself survives.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

DESCRIBE ONLY — not applied. Two independent changes: (a) add LINE_CHANNEL_ACCESS_TOKEN (and, if the emergency group is mandatory, LINE_GROUP_ID) to PRODUCTION_REQUIRED in backend/src/config/env.js:23 so production refuses to boot without them; and (b) make driver.routes.js:668 read the returned object and record `{ dryRun: true }` / `{ sent: false }` on the emergency record or in an audit row so an undelivered emergency is visible to an operator rather than only to the PM2 log.

### Required regression tests

- Unit: getMissingProductionSecrets({NODE_ENV:'production', LINE_CHANNEL_SECRET:'x', CRON_API_KEY:'y'}) must include 'LINE_CHANNEL_ACCESS_TOKEN' once fixed.
- Integration: POST /api/driver/emergency with no channel token configured must not return an unqualified success, or must persist a not-delivered marker.

### Product Owner confirmation question

> Should the backend REFUSE TO BOOT in production when LINE_CHANNEL_ACCESS_TOKEN (and LINE_GROUP_ID) are blank, or is running with LINE outbound disabled a legitimate production configuration? If it is legitimate, must an emergency report that could not be pushed to LINE be flagged back to the driver's screen and to the operator dashboard, rather than reported as a plain success?

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-039: Deploy script swallows git pull failure and then reports a successful deploy of stale code

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** deployment-integrity
- **Layer:** ops/deploy script
- **Affected roles:** admin
- **Affected entities:** deployment pipeline
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

`|| true` discards the exit status of `git pull`. Every pull failure mode — merge conflict with a locally modified file, detached HEAD (`git branch --show-current` returns empty, making the command `git pull origin`), no network, auth failure, diverged history — is silently ignored. The script proceeds to syntax-check and unit-test the OLD working tree, `pm2 reload`s the OLD code, gets a passing /health at line 31, prints `[deploy] Health check OK` and exits 0.

### Evidence

- **File:** `scripts/deploy-backend.sh`
- **Lines:** 12-14, 26-34
- **Symbol:** deploy-backend.sh (top-level script body)
- **Caller:** Operator, run manually over SSH on the production host. No CI/CD workflow invokes it — .github/workflows/ contains only check-labels.yml and full-quality.yml, neither of which deploys.

```js
echo "[deploy] Pulling latest code..."
cd $PROJECT_DIR
git pull origin $(git branch --show-current) || true
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

scripts/deploy-backend.sh:5 sets `set -euo pipefail`; line 14 is `git pull origin $(git branch --show-current) || true`, which explicitly cancels -e for exactly that command. Lines 16-24 then syntax-check and unit-test the unchanged working tree (both pass, because that code was already running), line 27 `pm2 reload`s it, lines 30-33 get a 200 from /health and `exit 0` after printing '[deploy] Health check OK'. I also confirmed the auditor's point about the compensating control: scripts/health-check.sh compares /health commit against `git rev-parse HEAD`, which agree with each other after a no-op pull, so the drift detector is structurally blind to this case. On a detached HEAD `git branch --show-current` is empty and the command degenerates to `git pull origin`.

### Expected logic

A failed pull should abort the deploy with a non-zero exit before anything is reloaded, or the script should verify HEAD actually moved to the intended commit.

### Trigger / reproduction steps

1. On the production host, leave any tracked file modified (e.g. an operator edited backend/.env.example or a doc in place) so the pull would conflict
2. Run `bash scripts/deploy-backend.sh`
3. Observe `git pull` prints its error, the script continues past it because of `|| true`
4. Observe the run ends with `[deploy] Health check OK` and exit code 0
5. Run `git rev-parse --short HEAD` and compare against the commit that was supposed to ship — they differ

### Impact

An operator deploying an urgent fix (e.g. a student-data or auth correction) is told the deploy succeeded while production still runs the old code. The one control that would catch it — health-check.sh lines 55-63, which compares /health `commit` against `git rev-parse HEAD` — cannot catch this case, because after a no-op pull the running commit and the checkout HEAD agree with each other and both are stale. The operator has no signal at all.

### Root cause

Deliberate error suppression (`|| true`) on the step that determines what code is about to be deployed.

### Severity justification

Major under 'a core function is wrong': the production deploy path emits a green, unambiguous success signal while shipping nothing, and the only existing drift check cannot detect it. Not critical — no authz bypass, no data exposure, no data loss; the failure is that nothing changes.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: capture the intended target SHA before the pull, drop `|| true` so a pull failure exits non-zero under `set -e`, and after the pull assert `git rev-parse HEAD` equals the target SHA before reaching the `pm2 reload` at line 27.

### Required regression tests

- Deploy dry-run against a checkout with a deliberate merge conflict — script must exit non-zero before `pm2 reload`
- Deploy dry-run from a detached HEAD — script must exit non-zero rather than running `git pull origin` with an empty branch argument

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-040: Deploy reloads PM2 without installing dependencies or applying pending migrations

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** deployment-integrity
- **Layer:** ops/deploy script
- **Affected roles:** admin, province, affiliation, school, transport, driver
- **Affected entities:** deployment pipeline, backend service availability
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Between the `git pull` (line 14) and the `pm2 reload` (line 27) there is no `npm ci`/`npm install` and no migration step. The gate that does run is `node -c` (line 19), which only PARSES each file — it never resolves `require()`, so a newly added dependency that is absent from node_modules passes cleanly. The unit suite at line 24 uses backend/jest.unit.config.js, whose testMatch is `tests/**/*.unit.test.js` and which is documented there as DB-free, so it exercises neither the dependency graph of the whole app nor the schema. There is also no migration runner anywhere in the project: backend/package.json line 18 maps `"migrate"` to `scripts/migrate-from-excel.js` (an Excel data importer, not a schema runner), and the 48 files in backend/migrations/ are applied by hand.

### Evidence

- **File:** `scripts/deploy-backend.sh`
- **Lines:** 14-27
- **Symbol:** deploy-backend.sh (top-level script body)
- **Caller:** Operator, manual SSH run on production.

```js
git pull origin $(git branch --show-current) || true
...
for f in $(find src -name '*.js' -not -path '*/node_modules/*'); do
  node -c "$f" || { echo "[deploy] Syntax error in $f"; exit 1; }
done
...
pm2 reload $ECOSYSTEM
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Between line 14 (pull) and line 27 (`pm2 reload $ECOSYSTEM`) there is no npm ci/install and no schema step. The only pre-reload gates are `node -c` per file (line 19), which parses but never resolves require(), and the DB-free unit config (line 24). I verified there is no migration runner in the project: backend/package.json maps `migrate` to scripts/migrate-from-excel.js (an Excel data importer); backend/scripts/ contains only migrate-from-excel.js, migration-status.js (read-only reporter/backfill) and validate-migration-baseline.js. backend/src/index.js:124-125 guards only migrations 039 and 040 at startup; every other schema gap surfaces per-request.

### Expected logic

A deploy should install the locked dependency set and apply (or at minimum verify) pending schema migrations before the new code is put into service.

### Trigger / reproduction steps

1. Commit a change to backend/src that adds `require('some-new-package')` and adds it to package.json
2. Run scripts/deploy-backend.sh on production
3. `node -c` passes (parse-only), unit tests pass (the new module is not in the unit test path)
4. `pm2 reload` restarts the app; it throws MODULE_NOT_FOUND at boot
5. PM2 retries per ecosystem.config.js max_restarts:10 then stops; the health loop at lines 30-36 times out after ~24s and the script exits 1 with the API down

### Impact

Two concrete production-breaking classes get through the gate. (a) A commit adding a dependency reloads into production and the process crashes on `require`; ecosystem.config.js lines 22-24 then retries it 10 times with backoff and gives up, leaving the API down. (b) A commit needing a new migration reloads against the old schema: backend/src/index.js only guards two specific cases (assertDriverShiftMigrationPresent for migration 039, assertTrackingMigrationPresent for 040, and only when the matching feature flag is on) — any other migration gap surfaces as per-request ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR against live user traffic instead of a clean refusal to start.

### Root cause

The deploy script's only pre-reload gates are a parser check and a DB-free unit suite; the two steps that make new code runnable (dependency install, schema migration) are absent from the automation and are assumed to have been done by hand.

### Severity justification

Major as 'a genuinely risky deployment or migration path': two concrete production-breaking classes pass the gate — a new dependency (crash on require, then ecosystem.config.js max_restarts:10 gives up and the API stays down) and a pending migration (production reloads against the old schema, and only 039/040 are checked at boot). Distinct from idx 54: that one is about a false success signal, this one is about the gate's missing steps.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: add `npm ci --omit=dev` after the pull; add a pre-reload migration status gate using the existing backend/scripts/migration-status.js (already cited in docs/OPERATOR_RUNBOOK.md line 141 as expecting '0 untracked / 0 drift') and abort if it reports pending or drifted migrations.

### Required regression tests

- Deploy a branch that adds an uninstalled dependency — the script must fail before `pm2 reload`
- Deploy a branch with an unapplied migration — the migration gate must fail before `pm2 reload`

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-041: scripts/backup.sh writes the full student database dump and a copy of backend/.env into a world-traversable directory with no permission hardening

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** data-exposure
- **Layer:** ops/backup script
- **Affected roles:** admin
- **Affected entities:** students, users, parents, backend/.env secrets
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Neither the directory nor any file it produces is chmod'ed anywhere in the 83-line script. `mkdir -p` creates /home/schoolbus/backups/backup-$TAG at the process umask (0755 under a default umask of 022), and `database.sql` is created by a plain shell redirect, so it lands at 0644 — a complete, uncompressed dump of every student, parent phone number, national-ID hash and user password hash, readable by any local account on the host. uploads.tar.gz (line 58) and pm2-processes.json (line 67) are created the same way. Line 52 additionally copies backend/.env — DB password, JWT_SECRET, LINE channel access token — into that same directory. The sibling script scripts/backup-db.sh gets this right at lines 47, 84 and 92 (`chmod 700` on the directory, `chmod 600` on the dump and the checksum), which makes the omission here a clear inconsistency rather than a deliberate policy.

### Evidence

- **File:** `scripts/backup.sh`
- **Lines:** 42-52, 57-58
- **Symbol:** backup.sh (top-level script body)
- **Caller:** Operator, run manually (its header documents `bash scripts/backup.sh pre-deploy-v2`). Not on the cron schedule in docs/OPERATOR_RUNBOOK.md lines 10-18, which schedules the separate backup-db.sh at 02:30.

```js
mkdir -p "$BACKUP_DIR"
...
mysqldump --defaults-extra-file="$MYSQL_DEFAULTS_FILE" "$DB_NAME" > "$BACKUP_DIR/database.sql" 2>/dev/null
...
cp "$APP_DIR/backend/.env" "$BACKUP_DIR/backend.env"
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Verified line by line. backup.sh does chmod 600 only on the mysqldump defaults temp file (line 24). Line 42 `mkdir -p "$BACKUP_DIR"` runs at the ambient umask; line 46 creates database.sql by plain shell redirect; line 52 `cp "$APP_DIR/backend/.env" "$BACKUP_DIR/backend.env"` copies the DB password, JWT_SECRET and LINE tokens into the same directory; line 58 writes uploads.tar.gz and line 67 pm2-processes.json the same way. There is no chmod on the directory or on any produced file anywhere in the 83-line script. The contrast the auditor draws is real: the sibling scripts/backup-db.sh chmods the directory 700 (line 47) and every dump/checksum 600 (lines 84, 92), and even documents that policy in its own header at line 19.

### Expected logic

Backup artefacts containing student PII and application secrets should be created 0600 inside a 0700 directory, matching backup-db.sh.

### Trigger / reproduction steps

1. As the schoolbus user run `bash scripts/backup.sh pre-deploy-test`
2. Run `ls -la /home/schoolbus/backups/backup-pre-deploy-test/` and `stat -c '%a %n' /home/schoolbus/backups/backup-pre-deploy-test/*`
3. Observe database.sql at 0644 and the containing directory at 0755
4. From any other local account: `cat /home/schoolbus/backups/backup-pre-deploy-test/database.sql | head` returns student rows

### Impact

Any local shell account on the production host — a second operator, a support user, a service account, or an attacker who obtains any low-privilege foothold — can read the entire production student dataset out of database.sql without touching MySQL, and can traverse into the backup directory. This is the artefact an operator is most likely to produce right before a risky deploy, so it tends to be the freshest full copy of production on disk.

### Root cause

The permission hardening added to backup-db.sh (lines 47/84/92) was never back-ported to the older backup.sh, and backup.sh additionally copies the secret-bearing .env that backup-db.sh deliberately never touches.

### Severity justification

Major, and the closest of my set to critical. The defect is confirmed and the project already knows the correct pattern (backup-db.sh applies it), so this is a real inconsistency, not a style preference. Held below critical only because the exposure requires a second local account on the production host, which is not observable from the repository — with a plaintext .env copy at 0644 this is unauthenticated local access to student PII and the JWT signing secret, i.e. it becomes a critical secret leak the moment such an account exists.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: set `umask 077` at the top of backup.sh, `chmod 700` the created directory and `chmod 600` every artefact, mirroring backup-db.sh. Reconsider whether backend.env belongs in the backup at all, or whether the secrets should live only in the operator's password manager as docs/go-live-handoff.md already assumes for admin credentials. Audit and re-permission any backup-* directories already on disk.

### Required regression tests

- After running backup.sh, assert the directory is 0700 and every file in it is 0600
- Assert a non-privileged local user cannot stat or read the backup directory

### Product Owner confirmation question

> Does any local shell account other than root and the app user exist on the production host (second operator, support user, service account, or any account with a shell)? If yes, escalate this to critical: /home/schoolbus/backups/backup-*/backend.env is a readable copy of JWT_SECRET and the DB password, and database.sql is a full uncompressed student dump.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-042: Repository documents disagree on whether a restore drill has ever been executed, and no drill evidence exists

- **Provisional severity:** major
- **Status:** logic_conflict
- **Confidence:** high
- **Category:** disaster-recovery
- **Layer:** ops documentation vs evidence artefacts
- **Affected roles:** admin
- **Affected entities:** backup/restore capability
- **Business logic confirmation required:** Yes
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

scripts/restore-drill-db.sh exists and is well-guarded (lines 30-43 refuse to target lampang_bus/mysql/sys/production; lines 64-67 refuse when RESTORE_DB equals the .env DB_NAME; lines 87-90 verify the sha256 sidecar before restoring), but there is no evidence it has ever completed against a real backup. The evidence-pack machinery built for exactly this — scripts/create-restore-drill-evidence-pack.js and scripts/validate-restore-drill-evidence.js — has produced nothing: `find outputs output -path '*restore-drill*' -type f` returns zero files, and outputs/ contains only ui-redesign screenshot folders.

### Evidence

- **File:** `docs/go-live-handoff.md`
- **Lines:** 46 (vs docs/READINESS_SCORECARD_2026-08.md:95 and docs/OPERATOR_RUNBOOK.md:74-98)
- **Symbol:** Section 2 completed-work table, row 10.10D
- **Caller:** Owner/operator go-live sign-off reads this table as evidence; docs/go-live-handoff.md line 168 makes 'Restore drill ran successfully at least once (see 10.10D closeout)' a go-live gate that this same table marks satisfie

```js
| 10.10D | Restore drill script + manual run verified | ✅ |
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

The conflict is exactly as described and is sharper than the summary suggests. docs/go-live-handoff.md:46 records '10.10D | Restore drill script + manual run verified | OK'. docs/READINESS_SCORECARD_2026-08.md:95 says 'Restore readiness | not ready because drill DB does not yet exist'. docs/OPERATOR_RUNBOOK.md:74-98 states that as of 2026-08-25 the drill DB has not been created, lists the remaining privileged CREATE DATABASE step, and ends with 'Do not mark backup governance FULL GREEN until at least one restore drill has completed'. I confirmed the evidence-pack machinery has produced nothing: `find outputs output -iname '*restore-drill*'` returns zero files and outputs/ holds only ui-redesign screenshots.

### Expected logic

Business/governance decision — the Product Owner must state it, not me.

### Conflict

docs/go-live-handoff.md line 46 marks the restore drill ✅ verified. docs/READINESS_SCORECARD_2026-08.md line 95 states 'Restore readiness | not ready because drill DB does not yet exist'. docs/OPERATOR_RUNBOOK.md lines 79-80 state 'As of 2026-08-25 the config is staged on production, but the drill database does not exist yet', and line 98 states 'Do not mark backup governance FULL GREEN until at least one restore drill has completed'. The scorecard is the later document (2026-08 vs the handoff's 10.10-series phase numbering), so at runtime the scorecard/runbook position is the one that reflects the current server: the drill DB is absent, therefore no drill has been run.

### Trigger / reproduction steps

1. Read docs/go-live-handoff.md line 46 — restore drill marked ✅
2. Read docs/READINESS_SCORECARD_2026-08.md line 95 — restore readiness 'not ready because drill DB does not yet exist'
3. Read docs/OPERATOR_RUNBOOK.md lines 79-98 — drill DB absent, explicit instruction not to mark backup governance green
4. Run `find outputs output -path '*restore-drill*' -type f` — no evidence files exist

### Impact

Backups are produced, checksummed and verified as FILES (backup-db.sh lines 86-91 gzip -t + sha256sum; health-check.sh lines 93-103 re-verifies every 5 minutes), but nothing in the repository shows the dumps have ever been proven to LOAD and yield correct row counts. Every recovery path in docs/go-live-handoff.md section 9 terminates in 'restore from the .sql.gz', and docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md line 151 additionally requires a drill against the same backup BEFORE any production restore — so if the dumps are unrestorable, that is discovered for the first time during a real incident.

### Root cause

A completed-work table was marked ✅ at phase 10.10D and never reconciled against the later 2026-08 readiness assessment that found the drill database had never been created.

### Severity justification

Major, not a documentation nit: a sign-off artefact records a disaster-recovery control as verified that two other current documents say has never been executed, and no drill evidence exists anywhere in the repo. Backups are produced and integrity-checked as files (gzip -t + sha256 in backup-db.sh:86-91, re-verified by health-check.sh every 5 minutes), so this is not the 'no working backup' critical — it is an unproven recovery path plus a false completion claim. It cannot be settled from the repository.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: reconcile the three documents to a single stated status; if the drill has genuinely not run, execute the operator sequence already written in docs/OPERATOR_RUNBOOK.md lines 87-96 and validate it with the existing scripts/validate-restore-drill-evidence.js.

### Required regression tests

- scripts/restore-test-readiness.sh exits 0 (READY)
- scripts/validate-restore-drill-evidence.js on a real evidence pack passes WITHOUT --allow-pending

### Product Owner confirmation question

> Has a restore drill ever been completed against a real production dump — i.e. does lampang_bus_restore_drill exist and has a dump been loaded into it with row counts checked? If yes, produce the evidence pack; if no, docs/go-live-handoff.md line 46 is a false sign-off and should be reverted to amber before go-live.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-043: No schema down-migrations exist, yet the governance checklist mandates using them and forbids restore as the first option

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** rollback
- **Layer:** migrations vs ops documentation
- **Affected roles:** admin
- **Affected entities:** schema migrations, rollback procedure
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

The checklist instructs the operator to use 'only the prepared rollback migration' for any schema change, and then explicitly forbids restoring the production DB as the first option. No such prepared rollback migration exists. backend/migrations/ holds 48 forward-only .sql files (001 through 048) plus legacy-drift-baseline.json; there is no down/, no *_down.sql, no *_rollback.sql, no *_revert.sql. The one file whose name contains 'rollback', 031_import_history_rollback.sql, is a FORWARD migration that creates tables for the application's own import-undo feature (the same feature described for school users in docs/user-guide-school.md lines 177-185) — it is not a schema down-migration. There is also no migration runner to execute one: backend/package.json line 18 maps `migrate` to the Excel importer.

### Evidence

- **File:** `docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md`
- **Lines:** 144-151
- **Symbol:** Section 8 Rollback Checklist
- **Caller:** Incident commander / operator following the rollback checklist after a bad schema deploy.

```js
- หาก migration แตะ schema ให้ใช้ rollback migration ที่เตรียมไว้เท่านั้น
- ห้าม restore production DB เป็นทางเลือกแรก เว้นแต่ incident commander + owner อนุมัติ
- ก่อน restore production ต้องทำ restore drill กับ backup เดียวกันก่อน
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md:143-151 (Section 8) does say to use only the prepared rollback migration for any schema-touching change, forbids restoring the production DB as a first option without incident commander plus owner approval, and requires a restore drill on the same backup before any production restore. backend/migrations/ contains 42 forward-only .sql files plus legacy-drift-baseline.json — the auditor's '48 .sql files' is a miscount of the highest sequence number (048), not the file count, but the substance holds: there is no down/, no *_down.sql, *_rollback.sql or *_revert.sql. I opened 031_import_history_rollback.sql: it is a forward ALTER TABLE/CREATE INDEX migration for the application's import-undo feature, not a schema down-migration.

### Expected logic

Either the down-migrations the checklist promises exist, or the checklist stops pointing at an artefact that does not exist.

### Trigger / reproduction steps

1. Read docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md line 149 instructing use of the prepared rollback migration
2. Run `ls backend/migrations/` — 48 forward .sql files, no down/revert/rollback schema files
3. Open backend/migrations/031_import_history_rollback.sql — it is a forward CREATE for the app's import-undo feature, not a schema down-migration
4. Run `grep -n '"migrate"' backend/package.json` — line 18 points at scripts/migrate-from-excel.js, an Excel importer, so there is no runner for a down-migration either

### Impact

After a schema migration that breaks production, the operator opens the rollback checklist and is directed to an artefact that is not there, while the same checklist forbids the only remaining option (restore) without incident-commander plus owner approval AND a prior restore drill on that same backup — a drill that, per the finding above, has never been rehearsed. The documented rollback path for a bad schema change is therefore not executable as written, at the exact moment it is needed.

### Root cause

The rollback policy was written assuming a migration tool with down-migrations; the project uses hand-applied forward-only raw SQL and no down-migrations were ever authored.

### Severity justification

Major as a genuinely risky migration path: the documented procedure for the single highest-risk production operation directs the operator to an artefact that provably does not exist, while gating the only remaining option behind approvals and a drill that (idx 58) has never been rehearsed. Forward-only migrations are a legitimate choice; the defect is that the governance document asserts a capability the repo does not have. Not critical — a restore path still exists in principle.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: for each migration that alters an existing table, author and store the paired down SQL alongside it, or amend the checklist to state honestly that schema rollback is restore-from-backup only — in which case the restore drill becomes a hard prerequisite rather than a deferred item.

### Required regression tests

- Add a CI check asserting that every migration touching an existing table has a paired down file, or that the checklist no longer claims one exists

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-044: The only end-to-end deploy and rollback document is stale — its rollback commands target a PM2 app name and path that do not exist in production

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** runbook-accuracy
- **Layer:** ops documentation
- **Affected roles:** admin
- **Affected entities:** rollback procedure, deployment runbook
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Every identifier in this rollback block is wrong for the current production host. The PM2 app is named `schoolbus-backend` (ecosystem.config.js line 18; docs/OPERATOR_RUNBOOK.md lines 122-133 confirm the ecosystem was adopted in 10.13C-2), so `pm2 stop lampang-bus` and `pm2 restart lampang-bus` both fail with 'process not found'. The application root is /home/schoolbus/apps/lampang-bus-system (deploy-backend.sh line 7, backup-db.sh line 23, restore-drill-db.sh line 25, and every ops/systemd unit's WorkingDirectory), not /opt/lampang-bus-system. The same document's setup section is stale in ways that are actively unsafe: Phase C4 (lines 66-72) lists only 4 of the 48 migrations and asserts the result should be 24 tables; Phase C3 (line 62) instructs `docker-compose up -d`, which docs/deployment-hardening.md lines 79-84 explicitly forbids in production because that compose file also defines

### Evidence

- **File:** `docs/production-launch-checklist.md`
- **Lines:** 132-150 (rollback), 62, 66-72, 102-103
- **Symbol:** Section 'Rollback (ถ้ามีปัญหาหลังเปิด)' and Phase C/E
- **Caller:** Operator following the launch checklist during a post-deploy incident.

```js
pm2 stop lampang-bus
...
cd /opt/lampang-bus-system
git log --oneline -5
git checkout <commit-hash-before>
cd frontend && npm run build
pm2 restart lampang-bus
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

The rollback block at docs/production-launch-checklist.md:132-150 is verbatim `pm2 stop lampang-bus`, `cd /opt/lampang-bus-system`, `git checkout <commit-hash-before>`, `pm2 restart lampang-bus`. Production is `schoolbus-backend` (ecosystem.config.js:18) at /home/schoolbus/apps/lampang-bus-system (deploy-backend.sh:7, backup-db.sh:23), so both pm2 commands fail with 'process not found' and the cd fails. Phase C4 (lines 66-72) lists 4 of the 42 migrations and asserts a 24-table result where tests/schema.sql now has 53. One sub-claim is WRONG and I am correcting it: docker-compose.yml puts adminer behind `profiles: ["debug"]` (line 40) with a loopback-only port, so `docker-compose up -d` as instructed at line 62 does NOT start Adminer — the guard the auditor missed. I also checked the auditor's stated mitigation and it is weaker than claimed: docs/OPERATOR_RUNBOOK.md:126-133 covers restarting/re-adopting PM2 and reverting to `npm start`, but contains no code-rollback (checkout previous commit) procedure at all.

### Expected logic

The rollback runbook should name the process and path that actually exist, or be withdrawn in favour of docs/OPERATOR_RUNBOOK.md.

### Trigger / reproduction steps

1. Open docs/production-launch-checklist.md line 136 and run `pm2 stop lampang-bus` on production
2. PM2 reports the process is not found; the real process is `schoolbus-backend` per ecosystem.config.js line 18
3. Line 141's `cd /opt/lampang-bus-system` fails; the real root per deploy-backend.sh line 7 is /home/schoolbus/apps/lampang-bus-system
4. Compare line 62's `docker-compose up -d` against docs/deployment-hardening.md lines 79-84, which state that compose file must not be run in production

### Impact

An operator reaching for the rollback procedure mid-incident runs three commands that each fail, in a document whose surrounding content looks authoritative. docs/OPERATOR_RUNBOOK.md line 133 carries the correct sequence but is a different file, and this one is the only document that presents a complete deploy-plus-rollback narrative. The Phase C3 instruction is worse than useless: an operator rebuilding from this checklist would stand up the Adminer service that the hardening audit specifically confirmed is not running.

### Root cause

The document is dated 2026-04-05 (its own note at line 155 acknowledges staleness on feature status only) and predates both the /home/schoolbus path move and the 10.13C-2 PM2 ecosystem adoption; the feature-status table was refreshed while the operational commands were not.

### Severity justification

Major as an unexecutable documented recovery procedure. I nearly demoted this — the commands fail loudly rather than doing damage — but the runbook has no code-rollback equivalent, so this stale file is in fact the repo's ONLY written procedure for reverting a bad deploy, and it is wrong in every identifier. Combined with idx 56 (no automated rollback), there is no working rollback path, manual or automated. The Adminer sub-claim is withdrawn.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, not applied: correct the process name and paths, cut the migration list down to a pointer at the full backend/migrations/ set applied in order, remove or clearly quarantine the docker-compose instruction with a reference to docs/deployment-hardening.md section 4, or mark the whole document superseded by docs/OPERATOR_RUNBOOK.md.

### Required regression tests

- Grep the docs tree for `pm2 .* lampang-bus` and `/opt/lampang-bus-system` and assert zero hits outside a clearly-marked historical archive

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-045: Frontend has zero automated tests and no test runner: 169 source files, all UI role-gating and scope filtering unverified

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** high
- **Category:** test-coverage
- **Layer:** frontend
- **Affected roles:** admin, province, affiliation, school, transport, driver, parent
- **Affected entities:** frontend/src (169 files)
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

CONFIRMED as the brief suspected. A recursive search of frontend/src for *.test.*, *.spec.*, and __tests__ directories returns zero matches across 169 .js/.jsx files (and 0 .ts/.tsx — no type checking either, despite @types/react being declared and therefore inert). devDependencies contain no vitest, jest, @testing-library/*, playwright, cypress, jsdom, or happy-dom. The scripts block has no `test` and no `lint` entry. The CI frontend-build job runs exactly three things: check:labels:strict (a Thai UI-label string checker), check:hybrid-ui (a motion/style convention checker), and vite build. scripts/browser-review.mjs is a 768-line Playwright screenshot capture tool, but its own header states it uses 'a mock auth context (so we do not need a live backend / real login)', it writes screenshots to /tmp/lampang-shots for human review, it requires a manually started vite server and a --no-sav

### Evidence

- **File:** `frontend/package.json`
- **Lines:** 1-40 (scripts block and devDependencies)
- **Symbol:** package.json scripts / devDependencies
- **Caller:** .github/workflows/full-quality.yml:57-73 (frontend-build job)

```js
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^6.1.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.6",
    "vite": "^8.2.2"
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Independently confirmed. find over frontend/src: 169 .js/.jsx files, 0 .ts/.tsx, 0 files matching *.test.* or *.spec.*, no __tests__ directory. frontend/package.json scripts are dev, build, preview, qa:browser, check:labels{,:strict,:verbose}, check:hybrid-ui, hooks:install{,:strict}, hooks:remove — no test, no lint. devDependencies contain no vitest, jest, @testing-library/*, playwright, cypress, jsdom or happy-dom. CI's frontend job runs two bespoke string/convention linters and `vite build`.

### Expected logic

For a system where six roles plus LINE-authenticated parents see different students, at minimum the components that decide what a role may see or do should have unit tests, and the login-to-dashboard path should have one end-to-end assertion.

### Trigger / reproduction steps

1. From frontend/, run a recursive find for -name '*.test.*' -o -name '*.spec.*' -o -name '__tests__' excluding node_modules: zero results.
2. grep -i for vitest|jest|@testing-library|playwright|cypress|jsdom|happy-dom in frontend/package.json: zero results.
3. Read the scripts block in frontend/package.json: dev, build, preview, qa:browser, check:labels*, check:hybrid-ui, hooks:* — no test, no lint.
4. Read .github/workflows/full-quality.yml:70-73: the frontend job runs npm ci, check:labels:strict, check:hybrid-ui, npm run build. No test invocation.
5. Read the header of scripts/browser-review.mjs (lines 1-18): it captures screenshots to /tmp/lampang-shots under a mock auth context and is run manually, not by CI.

### Impact

What this concretely means: every frontend guard is unverified. Any conditional rendering that hides another school's data, any role check that decides whether a school user sees a province control, any client-side scope filter, any student-list rendering, and every axios error path can regress and CI will still be fully green — `vite build` only proves the bundle parses. Note the correct qualifier: because the backend enforces scope server-side (proven by crossSchoolIsolation.test.js and schoolScope.unit.test.js), a frontend regression leaks nothing the API would not already refuse. The realistic failure mode is therefore broken or confusing UI reaching production undetected — wrong buttons shown, blank dashboards, silent request failures — rather than cross-tenant data disclosure. The 93-file backend suite and the 0-file frontend create a badly lopsided safety net for a codebase where the frontend is the half being redesigned.

### Root cause

Testing effort was invested entirely in the backend (93 files, 858 tests) while the frontend was governed by convention checkers (UI label standards, hybrid motion UI) and human visual review via screenshots, which catch style-guide drift but assert nothing about behavior.

### Severity justification

Kept at major, and I considered demoting it. It is not a coverage-percentage complaint: there is no test capability at all for the entire user-facing half of a system that renders children's personal data, in a repo that carries 93 backend test files — so this is an asymmetric omission, not a project-wide stance. It matters concretely because the frontend duplicates backend rules (role gating, scope filtering, menu visibility), and a UI-vs-API rule divergence is a defect class this audit has a whole separate domain for; nothing here can detect one. Not critical, and the auditor's qualifier is correct: the security boundary is server-side and tested, so a frontend regression cannot leak what the API would refuse.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, do not apply. Add vitest + @testing-library/react + jsdom, a `test` script, and a CI step. Prioritise by risk rather than coverage percentage: first the role/scope gating components and any client-side filter over student lists, then the auth context and axios interceptor (401/403 handling), then one Playwright end-to-end covering login to role dashboard for school and driver. The existing scripts/browser-review.mjs already proves Playwright works against this app and could be promoted from screenshot capture to assertions.

### Required regression tests

- Component tests for every element whose rendering depends on user.role or user.scopeId.
- A test that the axios 401/403 interceptor redirects to login rather than rendering a blank screen.
- One Playwright end-to-end per role covering login through the role's landing dashboard.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## AUD-046: multer pinned to end-of-life 1.x and a dead alpha-version json2csv ships in the production dependency tree

- **Provisional severity:** major
- **Status:** confirmed_defect
- **Confidence:** medium
- **Category:** dependency-risk
- **Layer:** backend dependencies
- **Affected roles:** school, admin, transport
- **Affected entities:** backend/package.json, student import upload endpoints
- **Business logic confirmation required:** No
- **ผ่านรอบตรวจทาน:** ตรวจแล้ว หลักฐานยืนยัน

### Summary

Resolved versions read from backend/package-lock.json: multer 1.4.5-lts.2, json2csv 6.0.0-alpha.2, express 4.22.2, mysql2 3.20.0, jsonwebtoken 9.0.3, bcrypt 6.0.0, helmet 7.2.0, exceljs 4.4.0, pdfkit 0.15.2, express-rate-limit 8.5.2. Two problems. (a) multer: the `^1.4.5-lts.1` range cannot ever resolve to 2.x, so the lockfile is stuck on the 1.x line. Multer 1.x is end-of-life and carries an upstream npm deprecation advising migration to 2.x specifically on security grounds. It is reachable, not shelf-ware: multer is required in 4 files under backend/src and backend/scripts and backs the student-import upload path that backend/tests/uploadProtection.test.js and the studentImport* magic-byte/zip-preflight tests exercise. (b) json2csv: pinned at 6.0.0-alpha.2, an alpha prerelease of a package whose maintained successor is the scoped @json2csv/* family, and I found ZERO references to it an

### Evidence

- **File:** `backend/package.json`
- **Lines:** 31-45 (dependencies block); resolved versions from backend/package-lock.json
- **Symbol:** dependencies
- **Caller:** npm ci in production and in .github/workflows/full-quality.yml:52

```js
    "json2csv": "^6.0.0-alpha.2",
    "jsonwebtoken": "^9.0.2",
    "multer": "^1.4.5-lts.1",
    "mysql2": "^3.9.7",
```

**ผู้ตรวจทานอ่านโค้ดที่บรรทัดนั้นซ้ำแล้วพบว่า:**

Versions confirmed from backend/package-lock.json: multer 1.4.5-lts.2, json2csv 6.0.0-alpha.2, express 4.22.2, mysql2 3.20.0, jsonwebtoken 9.0.3, bcrypt 6.0.0. The `^1.4.5-lts.1` range cannot resolve to 2.x, so npm update can never move off the EOL line. multer is genuinely reachable — required in affiliation.routes.js, driver.routes.js, registration.routes.js, school.routes.js plus driverDocuments.service.js and utils/fileType.js. I checked reachability more precisely than the finding did: in registration.routes.js the multer instance is defined at line 32 but every router mounting it is behind `authenticate` (lines 71 and 170), so the upload paths are authenticated, not anonymous. json2csv: my grep across backend/src and backend/scripts returns zero references, so it ships in production dependencies entirely unused.

### Expected logic

Production dependencies should be on supported major versions, and unused packages should not be installed at all.

### Trigger / reproduction steps

1. Read backend/package.json dependencies: json2csv ^6.0.0-alpha.2 and multer ^1.4.5-lts.1.
2. Resolve actual installed versions from backend/package-lock.json: multer 1.4.5-lts.2, json2csv 6.0.0-alpha.2.
3. grep -rn 'json2csv' across backend/src, backend/scripts, backend/tests, and repo-root scripts/: zero hits, confirming it is unused.
4. grep -rl "require('multer'" across backend/src and backend/scripts: 4 files, confirming multer is reachable.
5. Observe the caret range ^1.4.5-lts.1 cannot resolve to 2.x under semver, so the EOL pin is permanent until the manifest is edited.

### Impact

For multer: file uploads are attacker-adjacent by definition — the student-import flow accepts spreadsheets from school users — and staying on an EOL major means any future fix in the 1.x line may simply not arrive, while the caret range guarantees `npm update` will never move off it. For json2csv: a dead dependency is pure attack surface and pure supply-chain exposure with zero compensating benefit; an alpha prerelease additionally means no stability or security-response commitment from the maintainer. I want to be explicit about the limit of this finding: I did not run npm audit and I am not citing any CVE identifier, because I could not verify one from the repository contents. The risk stated here is derived from the version strings and usage analysis I actually read, not from a vulnerability database.

### Root cause

The manifest was never revisited after multer 2.x shipped, and json2csv is a leftover from an export implementation that was replaced by the in-house exportSecurity helpers without the dependency being removed. No automated dependency audit runs in CI to surface either.

### Severity justification

Major on the multer half only, under 'a reachable dependency vulnerability': multer 1.x is end-of-life and npm-deprecated on explicitly security grounds with fixes only in 2.x, the declared range structurally prevents ever reaching 2.x, and it sits on file-upload endpoints that accept spreadsheets from school users — the most attacker-adjacent input the backend has. Caveat carried forward from the auditor: neither of us ran npm audit or validated a specific advisory ID against 1.4.5-lts.2. The json2csv half is minor on its own — an unreferenced package is not reachable attack surface, just avoidable weight — and should not be presented as part of the major.

### Recommended remediation *(อธิบายเท่านั้น — ไม่ได้ดำเนินการ)*

Describe only, do not apply. (1) Remove json2csv from backend/package.json entirely — it has no importers, so removal is a no-op for behavior; CSV output already goes through the project's own backend/src/utils/exportSecurity.js csvCell helper, which is well tested in exportSecurity.test.js. (2) Plan a multer 1.x to 2.x migration; the API surface used is small (4 files) so the change is bounded, and uploadProtection.test.js plus the studentImportMagicByte/RowCap/ZipPreflight unit tests give a reasonable safety net for the upgrade. (3) Add `npm audit --omit=dev --audit-level=high` as a step in the backend-quality CI job so dependency drift is surfaced by tooling rather than by audit.

### Required regression tests

- npm audit --omit=dev --audit-level=high as a required CI step.
- A depcheck-style CI step failing on declared-but-unimported production dependencies.
- Re-run backend/tests/uploadProtection.test.js and the four studentImport* upload unit tests after any multer major upgrade.

### Owner decision

- [ ] Confirmed defect
- [ ] Intended behavior
- [ ] Change severity to Critical / Major / Minor
- [ ] Deferred

---

## 15. Minor Findings

| ID | Finding | Status | File |
|---|---|---|---|
| AUD-047 | School review of a vehicle-inspection application fails OPEN: any `approved` value | confirmed_defect | `backend/src/routes/verification.routes.js:115-133` |
| AUD-048 | POST /api/reports/decision-log has zero input validation and always returns 201 su | confirmed_defect | `backend/src/routes/report.routes.js:651-667` |
| AUD-049 | Multer upload errors bypass every Thai error message and return HTTP 500 'Internal | confirmed_defect | `backend/src/routes/affiliation.routes.js:35-40` |
| AUD-050 | No validation layer exists: every write endpoint validates its own body ad hoc, so | confirmed_defect | `backend/package.json:22-36` |
| AUD-051 | Non-string and over-length body values reach SQL and crash with HTTP 500 instead o | confirmed_defect | `backend/src/routes/school.routes.js:713-715` |
| AUD-052 | POST /api/line/process-notifications returns the raw internal error message to the | confirmed_defect | `backend/src/routes/line.routes.js:548-555` |
| AUD-053 | English internal error strings are returned to Thai school staff and drivers on co | confirmed_defect | `backend/src/middleware/roleGuard.js:16-21` |
| AUD-054 | LINE parent id_token is accepted from the URL query string, putting a credential i | configuration_risk | `backend/src/routes/parent.routes.js:70-79` |
| AUD-055 | Body parsers run before every rate limiter, so an unauthenticated attacker forces  | configuration_risk | `backend/src/app.js:63-68, 114-126` |
| AUD-056 | Unauthenticated requests to /api/consent/* trigger an outbound HTTPS call to LINE  | configuration_risk | `backend/src/routes/consent.routes.js:16-29, 40-55` |
| AUD-057 | Several security controls fail open on an exact NODE_ENV === 'production' string t | configuration_risk | `backend/src/routes/line.routes.js:20-24` |
| AUD-058 | The only CSP that reaches the SPA document allows 'unsafe-inline' and 'unsafe-eval | confirmed_defect | `frontend/index.html:15` |
| AUD-059 | CORS reflects any Origin outside production, which is safe today only because cred | configuration_risk | `backend/src/app.js:54-62` |
| AUD-060 | The per-account login lockout is keyed on the source IP and held in process memory | configuration_risk | `backend/src/routes/auth.routes.js:35-52 (used at 132-135, 151, 162, 174, 181)` |
| AUD-061 | Refresh-token rotation is not atomic and its revocation INSERT lacks the ON DUPLIC | confirmed_defect | `backend/src/routes/auth.routes.js:334-374` |
| AUD-062 | PUT /api/admin/users/:id silently ignores an unrecognised role value and reports s | confirmed_defect | `backend/src/routes/admin.routes.js:182-191` |
| AUD-063 | School audit-log JSON endpoint returns unredacted old_value/new_value while the pr | confirmed_defect | `backend/src/routes/school.routes.js:1249-1261` |
| AUD-064 | GET /api/eta/student/:studentId checks school_id but not grade_scope | confirmed_defect | `backend/src/routes/eta.routes.js:110-115` |
| AUD-065 | geofences.target_id is INT but schools.id is VARCHAR(10), so the admin seed-defaul | suspected_defect | `backend/migrations/040_intelligent_tracking.sql:77-100 (defect on line 81)` |
| AUD-066 | notifications has no index on `sent`, is excluded from every retention rule, and a | confirmed_defect | `backend/migrations/001_initial_schema.sql:362-374` |
| AUD-067 | The four newest workflow-queue tables were created with no foreign keys at all, so | confirmed_defect | `backend/migrations/032_student_transfer_requests.sql:6-35` |
| AUD-068 | Vehicle location UPSERT has no recorded_at ordering guard and recorded_at is clien | suspected_defect | `backend/src/services/vehicleLocation.service.js:55-72` |
| AUD-069 | Geofence ENTER/EXIT state lives in a per-process in-memory Map and is read-modify- | suspected_defect | `backend/src/services/geofence.service.js:142-176` |
| AUD-070 | logAudit swallows every failure, including when handed a transactional connection  | suspected_defect | `backend/src/utils/audit.js:40-66` |
| AUD-071 | Vehicle inspection form omits the server's 'PASSED requires an expiry date' rule,  | confirmed_defect | `frontend/src/pages/transport/InspectionForm.jsx:122-131, 300-326, 372-378` |
| AUD-072 | Inspection form creates a vehicle before the inspection POST, leaving an orphan pe | confirmed_defect | `frontend/src/pages/transport/InspectionForm.jsx:132-165` |
| AUD-073 | Driver bulk check-in failures are rendered inside the green success box | confirmed_defect | `frontend/src/pages/driver/DriverDashboard.jsx:194-211, 458-462` |
| AUD-074 | 30-second roster poll has no request sequencing, so a slow response overwrites the | confirmed_defect | `frontend/src/pages/driver/DriverDashboard.jsx:113-143, 155-167` |
| AUD-075 | Student search issues an uncancelled request per debounced keystroke, so a slow re | confirmed_defect | `frontend/src/pages/school/StudentSearch.jsx:61-88` |
| AUD-076 | Vehicle-restore request button has no in-flight guard, and the backend dedupe is a | confirmed_defect | `frontend/src/pages/school/ImportPreviewModal.jsx:203-214, 290-302` |
| AUD-077 | Partial bulk-vehicle save leaves already-created rows in the form, so a retry re-p | confirmed_defect | `frontend/src/pages/school/SchoolBulkVehicles.jsx:158-190` |
| AUD-078 | KPI cards render a missing percentage as a definite '0.0%' | confirmed_defect | `frontend/src/components/KpiCard.jsx:10-17, 36` |
| AUD-079 | Admin dashboard's '24-hour deletions' panel uses a UTC date window, going blind fo | confirmed_defect | `frontend/src/pages/admin/AdminDashboard.jsx:30, 34, 55-56, 114-128` |
| AUD-080 | /driver/shift is hidden by the menu when FEATURE_DRIVER_SHIFT_SELECTION is off, bu | confirmed_defect | `frontend/src/components/Sidebar.jsx:161-178 (FLAG_GATED + filter); route at frontend/src/App.jsx:219; backend at backend/src/routes/driver.routes.js:149-190` |
| AUD-081 | Route authorization is decided from a localStorage-resident user object that is ne | confirmed_defect | `frontend/src/hooks/useAuth.jsx:11-24 (rehydrate), 30-32 (token storage); guard at frontend/src/App.jsx:126-140` |
| AUD-082 | Sidebar and MobileBottomNav apply the driverRegistration flag in opposite directio | logic_conflict | `frontend/src/components/MobileBottomNav.jsx:10-20; conflicting rule at frontend/src/components/Sidebar.jsx:169-172` |
| AUD-083 | Feature flags are captured once at login and never refreshed; a null features obje | confirmed_defect | `frontend/src/components/Sidebar.jsx:173-178; source at frontend/src/hooks/useAuth.jsx:17-22 and 33-36` |
| AUD-084 | Grade-teacher route restrictions exist only in the sidebar — no route guard — so t | confirmed_defect | `frontend/src/components/Sidebar.jsx:151-155 (TEACHER_BLOCKED_PATHS), 184-185 (menu-only filter)` |
| AUD-085 | ExportButtons uses raw fetch with the localStorage token, bypassing the axios 401- | confirmed_defect | `frontend/src/components/ExportButtons.jsx:38-43` |
| AUD-086 | CI step `npm run check:migrations` is a structural no-op that can never fail — the | confirmed_defect | `.github/workflows/full-quality.yml:13, 55 (job name and step); backend/scripts/validate-migration-baseline.js:111-116 and 39-53; backend/migrations/legacy-drift-baseline.json:1` |
| AUD-087 | Production deploy gate runs only 35 of the 93 backend test files (unit config only | confirmed_defect | `scripts/deploy-backend.sh:23-24; backend/jest.unit.config.js:9` |
| AUD-088 | check-labels.yml declares no `permissions:` block, so GITHUB_TOKEN runs at the rep | configuration_risk | `.github/workflows/check-labels.yml:1-32 (whole file — no permissions key anywhere); compare .github/workflows/full-quality.yml:8-9` |
| AUD-089 | All third-party actions are pinned to floating major tags (@v4), not commit SHAs | configuration_risk | `.github/workflows/full-quality.yml:46, 47, 64, 65; and .github/workflows/check-labels.yml:17, 19` |
| AUD-090 | No dependency vulnerability scanning or Dependabot configuration anywhere in the r | confirmed_defect | `.github/workflows/full-quality.yml:52-55 (backend steps) and 70-73 (frontend steps) — no audit/scan step in either; .github/ contains only the two workflow files` |
| AUD-091 | .claude/ is gitignored but 371 .claude/** files are tracked, including .claude/set | confirmed_defect | `.gitignore:11 (`.claude/`); tracked files enumerated via `git ls-files .claude` (371 paths, incl. .claude/settings.local.json)` |
| AUD-092 | docs/ops-backup-restore.md is a git symlink pointing at a dated one-off incident n | suspected_defect | `docs/ops-backup-restore.md:whole file — git mode 120000, 33-byte link target `PRODUCTION-RECOVERY-2026-06-23.md`` |
| AUD-093 | Missing standard repository files: no README, LICENSE, SECURITY.md, CONTRIBUTING.m | confirmed_defect | `.github/:`git ls-files .github` returns exactly 2 paths: workflows/check-labels.yml, workflows/full-quality.yml; `git ls-files | grep -v '/'` returns 10 root files, none of them README.md or LICENSE` |
| AUD-094 | School audit-log JSON endpoint returns raw old_value/new_value — the PII redaction | confirmed_defect | `backend/src/routes/school.routes.js:1249-1261` |
| AUD-095 | Admin dashboard 'password resets this month' is hard-wired to always read 0 — quer | confirmed_defect | `backend/src/routes/admin.routes.js:632-636, 716` |
| AUD-096 | Critical error-log matches are classified WARN, and WARN exits 0 — so the alerter  | configuration_risk | `scripts/health-smoke.sh:350-353, 363-368` |
| AUD-097 | 41% of audit writes (60 of 147) record no ip_address or user_agent, including affi | confirmed_defect | `backend/src/services/affiliationAdmin.service.js:102-110 (and 61, 132, 195, 459 in the same file)` |
| AUD-098 | Audit writes fail silently — an unknown action or a DB error is swallowed, the cal | configuration_risk | `backend/src/utils/audit.js:40-43, 61-67` |
| AUD-099 | Production 5xx logging is a bare message string — no stack, no route, no user, no  | confirmed_defect | `backend/src/middleware/errorHandler.js:44-58` |
| AUD-100 | /health answers HTTP 200 with success:true while the database is down — any monito | configuration_risk | `backend/src/app.js:84-107` |
| AUD-101 | Audit-log retention runs only from a hand-installed cron that is not in the repo — | not_verified | `backend/scripts/cleanup-old-logs.js:17-20, 66-70` |
| AUD-102 | In the shipped configuration no parent consent record can exist, and the consent l | needs_owner_confirmation | `backend/.env.example:87 (with backend/src/app.js:176-179, backend/src/config/env.js:200, backend/migrations/035_consent_records.sql:9-27)` |
| AUD-103 | The LINE bind chat flow writes the guardian's phone number and the student code in | confirmed_defect | `backend/src/routes/line.routes.js:163-167 (with backend/src/services/line.service.js:1213-1229 and 1239-1252)` |
| AUD-104 | There is no erasure mechanism for a child who leaves: withdrawal is a soft delete  | needs_owner_confirmation | `backend/src/routes/school.routes.js:913-929 (with backend/scripts/cleanup-old-logs.js:28-37)` |
| AUD-105 | Withdrawing the QR consent publicly re-labels the driver as 'ระงับ' (suspended) —  | needs_owner_confirmation | `backend/src/services/qrAccess.service.js:193 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76)` |
| AUD-106 | Parent reads of a child's status, 90-day movement history and ETA are not audited  | confirmed_defect | `backend/src/routes/parent.routes.js:99-164 (contrast backend/src/services/qrAccess.service.js:233-247)` |
| AUD-107 | scripts/backup.sh copies the entire plaintext backend/.env (JWT_SECRET, DB_PASSWOR | configuration_risk | `scripts/backup.sh:42, 46, 52, 81` |
| AUD-108 | backend/scripts/seed-uat-override-fixture.js has no production guard, defaults to  | configuration_risk | `backend/scripts/seed-uat-override-fixture.js:354-364, 407, 433-439` |
| AUD-109 | .gitignore matches only the exact filename .env — .env.production, .env.local, .en | configuration_risk | `.gitignore:3, 6-9, 24-25, 28-29` |
| AUD-110 | backend/.env.example omits 13 environment variables that backend/src/config/env.js | confirmed_defect | `backend/.env.example:whole file (110 lines); missing keys are read at backend/src/config/env.js:186-188, 200, 205-216` |
| AUD-111 | docker-compose.yml puts DB_ROOT_PASSWORD on the healthcheck command line, where it | configuration_risk | `docker-compose.yml:26-31` |
| AUD-112 | Deploy takes no pre-deploy backup and performs no rollback when its own health che | confirmed_defect | `scripts/deploy-backend.sh:1-11, 29-40` |
| AUD-113 | Off-host backup sync failure is not detected by any automated monitor | confirmed_defect | `scripts/health-check.sh:77-105 (vs scripts/offhost-backup-sync.sh:26-27, 145-150)` |
| AUD-114 | No RPO or RTO is stated anywhere in the repository | needs_owner_confirmation | `docs/OPERATOR_RUNBOOK.md:6-20 (schedule table; the absence is repo-wide)` |
| AUD-115 | The nginx configuration is not version-controlled and its backup step fails silent | configuration_risk | `scripts/backup.sh:70-83` |
| AUD-116 | GET /api/province/status-today runs an unbounded full-table student read (no LIMIT | suspected_defect | `backend/src/services/province.service.js:492-512` |
| AUD-117 | geofence.checkForVehicle runs one query per geofence on cold cache, and school geo | confirmed_defect | `backend/src/services/geofence.service.js:131-175 (loop), 39-49 (per-iteration query), 428-435 (NULL vehicle_id seed)` |
| AUD-118 | eta.refreshForVehicle issues one INSERT ... ON DUPLICATE KEY UPDATE per pickup poi | confirmed_defect | `backend/src/services/eta.service.js:104-126` |
| AUD-119 | GET /api/admin/snapshots takes LIMIT from an unvalidated query param — a negative  | confirmed_defect | `backend/src/routes/admin.routes.js:835-847` |
| AUD-120 | auth.test.js RBAC test is permanently dead: it logs in as a user that is never see | confirmed_defect | `backend/tests/auth.test.js:191-212` |
| AUD-121 | studentImportScope.test.js claims to prove cross-school student-code isolation but | confirmed_defect | `backend/tests/studentImportScope.test.js:13, 24-38` |
| AUD-122 | The DB-free unit suite has no database guard at all; loadTestEnv silently no-ops w | configuration_risk | `backend/jest.unit.config.js:1-11 (and backend/tests/loadTestEnv.js:150-156)` |
| AUD-123 | The backup/restore readiness safety test passes vacuously when the shell interpret | confirmed_defect | `backend/tests/operationsHealth.test.js:82-115` |
| AUD-124 | admin and transport roles have no integration test with a real JWT; the shared fix | confirmed_defect | `backend/tests/setup.js:76-92` |
| AUD-125 | Two migration tests assert only that .sql files contain certain strings, so they p | confirmed_defect | `backend/tests/vehicleVerification.test.js:8-32 (and backend/tests/driverShift.test.js:8-19)` |
| AUD-126 | importRollback.test.js uses no-op transaction methods, so it cannot assert rollbac | confirmed_defect | `backend/tests/importRollback.test.js:14-23` |

รายละเอียดเต็มของทุกรายการรวม Minor อยู่ใน `docs/audit/_final.json`
---

## 16. Frontend Review

ตรวจ route table (`frontend/src/App.jsx`), การซ่อนเมนู (`Sidebar.jsx`, `MobileBottomNav.jsx`),
การจัดการ token (`api/axios.js`, `hooks/useAuth.jsx`) และหน้าที่ผู้ใช้ใช้บ่อยที่สุด

**สิ่งที่ทำถูก:** `PrivateRoute` ตรวจบทบาทจริงไม่ใช่แค่ซ่อนเมนู · ระบบมีการซ่อนเมนู
ตาม feature flag ที่สอดคล้องกับการ mount route ฝั่ง backend · ไม่พบหน้าที่ปล่อยให้
เปลี่ยน id ใน URL แล้วเห็นข้อมูลผู้อื่นได้โดยไม่ผ่านการตรวจฝั่ง server

**ข้อควรทราบเชิงโครงสร้าง:** token เก็บใน `localStorage` ซึ่งเข้าถึงได้จาก JavaScript
ทุกตัวในหน้า หากเกิด XSS ที่ใดที่หนึ่ง token จะถูกขโมยได้ ทางเลือกที่ปลอดภัยกว่าคือ
cookie แบบ `HttpOnly` + `SameSite` แต่จะต้องเพิ่มการป้องกัน CSRF เข้ามาแทน
เป็นการแลกเปลี่ยนที่ต้องตัดสินใจในระดับสถาปัตยกรรม ไม่ใช่ข้อบกพร่องในตัวเอง

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-004 | Grade-teacher school sub-accounts are grade-scoped everywhere in /api/school but NOT in /a | critical | `backend/src/services/report.service.js:9-40 (buildScopeFilter), 402-429 (getExportRows)` |
| AUD-023 | Driver check-in error path crashes the whole app: ErrorState is passed an undeclared ident | major | `frontend/src/pages/driver/CheckinPanel.jsx:70-74` |
| AUD-024 | Driver roster page crashes instead of showing its error state when the roster fetch fails  | major | `frontend/src/pages/driver/StudentList.jsx:138` |
| AUD-025 | Inspection date defaults to the UTC calendar date, recording the wrong day between 00:00 a | major | `frontend/src/pages/transport/InspectionForm.jsx:67-70, 152` |
| AUD-026 | Production catch-all returns HTTP 200 index.html for any unmatched GET /api/* — flag-off e | major | `backend/src/app.js:199-204` |
| AUD-027 | The SPA has no 403 handling at all; a user with must_change_password who reloads lands on  | major | `frontend/src/api/axios.js:51-102 (response interceptor); backend at backend/src/middleware/auth.js:103-110; redirect at frontend/src/App.jsx:180-186` |
| AUD-071 | Vehicle inspection form omits the server's 'PASSED requires an expiry date' rule, so the d | minor | `frontend/src/pages/transport/InspectionForm.jsx:122-131, 300-326, 372-378` |
| AUD-072 | Inspection form creates a vehicle before the inspection POST, leaving an orphan pending ve | minor | `frontend/src/pages/transport/InspectionForm.jsx:132-165` |
| AUD-073 | Driver bulk check-in failures are rendered inside the green success box | minor | `frontend/src/pages/driver/DriverDashboard.jsx:194-211, 458-462` |
| AUD-074 | 30-second roster poll has no request sequencing, so a slow response overwrites the post-ch | minor | `frontend/src/pages/driver/DriverDashboard.jsx:113-143, 155-167` |
| AUD-075 | Student search issues an uncancelled request per debounced keystroke, so a slow response c | minor | `frontend/src/pages/school/StudentSearch.jsx:61-88` |
| AUD-076 | Vehicle-restore request button has no in-flight guard, and the backend dedupe is a non-ato | minor | `frontend/src/pages/school/ImportPreviewModal.jsx:203-214, 290-302` |
| AUD-077 | Partial bulk-vehicle save leaves already-created rows in the form, so a retry re-posts the | minor | `frontend/src/pages/school/SchoolBulkVehicles.jsx:158-190` |
| AUD-078 | KPI cards render a missing percentage as a definite '0.0%' | minor | `frontend/src/components/KpiCard.jsx:10-17, 36` |
| AUD-079 | Admin dashboard's '24-hour deletions' panel uses a UTC date window, going blind for 7 hour | minor | `frontend/src/pages/admin/AdminDashboard.jsx:30, 34, 55-56, 114-128` |
| AUD-080 | /driver/shift is hidden by the menu when FEATURE_DRIVER_SHIFT_SELECTION is off, but the ro | minor | `frontend/src/components/Sidebar.jsx:161-178 (FLAG_GATED + filter); route at frontend/src/App.jsx:219; backend at backend/src/routes/driver.routes.js:149-190` |
| AUD-081 | Route authorization is decided from a localStorage-resident user object that is never reva | minor | `frontend/src/hooks/useAuth.jsx:11-24 (rehydrate), 30-32 (token storage); guard at frontend/src/App.jsx:126-140` |
| AUD-082 | Sidebar and MobileBottomNav apply the driverRegistration flag in opposite directions for / | minor | `frontend/src/components/MobileBottomNav.jsx:10-20; conflicting rule at frontend/src/components/Sidebar.jsx:169-172` |
| AUD-083 | Feature flags are captured once at login and never refreshed; a null features object hides | minor | `frontend/src/components/Sidebar.jsx:173-178; source at frontend/src/hooks/useAuth.jsx:17-22 and 33-36` |
| AUD-084 | Grade-teacher route restrictions exist only in the sidebar — no route guard — so typing th | minor | `frontend/src/components/Sidebar.jsx:151-155 (TEACHER_BLOCKED_PATHS), 184-185 (menu-only filter)` |
| AUD-085 | ExportButtons uses raw fetch with the localStorage token, bypassing the axios 401-refresh  | minor | `frontend/src/components/ExportButtons.jsx:38-43` |

## 17. Backend and API Review

ตรวจ endpoint ทั้ง 247 รายการในเชิงโครงสร้าง และอ่านตัว handler ของกลุ่มที่แตะ
ข้อมูลนักเรียน รถ คนขับ ผู้ใช้ และรายงาน

**รูปแบบที่ดี:** การป้องกันถูกวางที่ระดับ router (`router.use(authenticate, requireRole(...))`)
ใน 17 ไฟล์ ทำให้เพิ่ม endpoint ใหม่แล้วได้การป้องกันอัตโนมัติ — เป็นรูปแบบที่ป้องกัน
ความผิดพลาดจากการลืมได้ดีกว่าการใส่ทีละเส้นทาง และผู้ตรวจยืนยันว่า**ไม่มี route ใด
ประกาศก่อนบรรทัด `router.use`** ซึ่งเป็นช่องโหว่คลาสสิกของรูปแบบนี้

**จุดอ่อนที่พบ:** ไม่มีชั้น validation กลาง (เช่น zod/joi) — การตรวจ input กระจาย
อยู่ในแต่ละ handler ทำให้ความเข้มงวดไม่เท่ากัน และเป็นที่มาของ finding หลายรายการ

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-005 | POST /api/visits/track is unauthenticated and has no rate limit at all — the public visit  | major | `backend/src/routes/visits.routes.js:23-42` |
| AUD-006 | Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any re | major | `backend/src/app.js:37-43` |
| AUD-007 | The SPA document is served by nginx, so helmet's headers never reach it — no frame-ancesto | major | `backend/src/app.js:46, 198-204` |
| AUD-047 | School review of a vehicle-inspection application fails OPEN: any `approved` value that is | minor | `backend/src/routes/verification.routes.js:115-133` |
| AUD-048 | POST /api/reports/decision-log has zero input validation and always returns 201 success ev | minor | `backend/src/routes/report.routes.js:651-667` |
| AUD-049 | Multer upload errors bypass every Thai error message and return HTTP 500 'Internal server  | minor | `backend/src/routes/affiliation.routes.js:35-40` |
| AUD-050 | No validation layer exists: every write endpoint validates its own body ad hoc, so coverag | minor | `backend/package.json:22-36` |
| AUD-051 | Non-string and over-length body values reach SQL and crash with HTTP 500 instead of return | minor | `backend/src/routes/school.routes.js:713-715` |
| AUD-052 | POST /api/line/process-notifications returns the raw internal error message to the client, | minor | `backend/src/routes/line.routes.js:548-555` |
| AUD-053 | English internal error strings are returned to Thai school staff and drivers on core flows | minor | `backend/src/middleware/roleGuard.js:16-21` |
| AUD-054 | LINE parent id_token is accepted from the URL query string, putting a credential into web- | minor | `backend/src/routes/parent.routes.js:70-79` |
| AUD-055 | Body parsers run before every rate limiter, so an unauthenticated attacker forces a 10 MB  | minor | `backend/src/app.js:63-68, 114-126` |
| AUD-056 | Unauthenticated requests to /api/consent/* trigger an outbound HTTPS call to LINE before b | minor | `backend/src/routes/consent.routes.js:16-29, 40-55` |
| AUD-057 | Several security controls fail open on an exact NODE_ENV === 'production' string test, inc | minor | `backend/src/routes/line.routes.js:20-24` |
| AUD-058 | The only CSP that reaches the SPA document allows 'unsafe-inline' and 'unsafe-eval' for sc | minor | `frontend/index.html:15` |
| AUD-059 | CORS reflects any Origin outside production, which is safe today only because credentials  | minor | `backend/src/app.js:54-62` |

## 18. Authentication and Authorization Review

### Role-Permission Matrix (สร้างจากโค้ดจริง)

| Router | Guard ที่บรรทัด | บทบาทที่เข้าได้ |
|---|---|---|
| `/api/admin` | `admin.routes.js:32` | admin |
| `/api/province` | `province.routes.js:35` | province, admin |
| `/api/affiliation` | `affiliation.routes.js:161` | affiliation, admin |
| `/api/school` | `school.routes.js:157` | school, admin |
| `/api/transport` | `transport.routes.js:14` | transport, admin |
| `/api/driver` | `driver.routes.js:87` | driver |
| `/api/reports` | `report.routes.js:14` | school, affiliation, province, admin |
| `/api/documents` | `documents.routes.js:26` | driver, school, transport, admin |
| `/api/readiness` | `readiness.routes.js:16` | province, admin |
| `/api/route-deviations` | `routeDeviation.routes.js:27` | admin, province |
| `/api/geofences` | `geofence.routes.js:34,64` | ทุกบทบาทที่ล็อกอิน แล้ว admin เท่านั้นสำหรับการเขียน |
| `/api/verification` | `verification.routes.js:14` | ทุกบทบาทที่ล็อกอิน แล้วจำกัดรายเส้นทาง |
| `/api/terms`, `/api/eta` | `terms.routes.js:10`, `eta.routes.js:33` | ทุกบทบาทที่ล็อกอิน |
| `/api/parent` | `requireParentLineAuth` | ผู้ปกครองที่ยืนยันผ่าน LINE id_token |
| `/api/qr/vehicle/:token` | `optionalAuth` | สาธารณะ (จำกัดข้อมูลตามระดับ) |

### จุดที่ชั้นต่าง ๆ ไม่ตรงกัน

ช่องโหว่ที่ร้ายแรงที่สุดในระบบนี้ไม่ใช่ "ไม่มีการป้องกัน" แต่คือ **"ป้องกันในที่หนึ่ง
แต่ลืมในอีกที่หนึ่ง"** — `AUD-004` คือตัวอย่างที่ชัดที่สุด: บัญชีครูประจำชั้นถูกจำกัด
ระดับชั้นอย่างเคร่งครัดทั่วทั้ง `/api/school` แต่ `/api/reports` ไม่เคยอ่าน `gradeScope` เลย

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-001 | Auto-provisioned driver logins use the vehicle licence plate as BOTH username and password | critical | `backend/src/services/driverProfile.service.js:73-79` |
| AUD-002 | Auto-provisioned school accounts use the school code as the initial password, with the use | critical | `backend/src/services/affiliationAdmin.service.js:39-58 (and the same pattern at 187-193)` |
| AUD-008 | Logout cannot invalidate the access token — it stays valid for the full 24h after the user | major | `backend/src/routes/auth.routes.js:393-420 (with generateAccessToken at 73-92)` |
| AUD-009 | Refresh-token rotation is broken end to end: the backend revokes the old refresh token, th | major | `frontend/src/api/axios.js:81-89 (backend counterpart: backend/src/routes/auth.routes.js:364-385)` |
| AUD-010 | trust proxy = 1 is off by one for the documented Cloudflare→nginx chain: req.ip resolves t | major | `backend/src/app.js:37-43` |
| AUD-011 | IDOR: any school account can read another school's inspection-application audit timeline ( | major | `backend/src/routes/verification.routes.js:138-169` |
| AUD-012 | GET /api/school/no-show ignores grade_scope while every sibling endpoint in the same file  | major | `backend/src/routes/school.routes.js:182-191` |
| AUD-013 | Grade-scope filter uses exact `s.grade = ?` in four paths where the rest of the system use | major | `backend/src/services/leave.service.js:137` |
| AUD-060 | The per-account login lockout is keyed on the source IP and held in process memory, so it  | minor | `backend/src/routes/auth.routes.js:35-52 (used at 132-135, 151, 162, 174, 181)` |
| AUD-061 | Refresh-token rotation is not atomic and its revocation INSERT lacks the ON DUPLICATE KEY  | minor | `backend/src/routes/auth.routes.js:334-374` |
| AUD-062 | PUT /api/admin/users/:id silently ignores an unrecognised role value and reports success | minor | `backend/src/routes/admin.routes.js:182-191` |
| AUD-063 | School audit-log JSON endpoint returns unredacted old_value/new_value while the province a | minor | `backend/src/routes/school.routes.js:1249-1261` |
| AUD-064 | GET /api/eta/student/:studentId checks school_id but not grade_scope | minor | `backend/src/routes/eta.routes.js:110-115` |

## 19. Business Logic Review

ตามข้อกำหนดของโจทย์ ผู้ตรวจ**ไม่ตัดสินกฎทางธุรกิจแทนเจ้าของระบบ** รายการที่เป็น
คำถามเชิงกติกาถูกจัดเป็น `needs_owner_confirmation` หรือ `logic_conflict` และรวบรวม
ไว้ใน **`docs/audit/LOGIC_CONFIRMATION_REGISTER.md`** จำนวน 13 รายการ

### Logic Conflict Matrix

| ID | Logic A (ที่หนึ่ง) | Logic B (อีกที่หนึ่ง) | ฝ่ายที่ชนะตอน runtime |
|---|---|---|---|
| AUD-004 | `/api/school` กรองตาม `grade_scope` ทุกจุด | `/api/reports` ไม่อ่าน `gradeScope` เลย | reports — ครูได้ข้อมูลทั้งโรงเรียน |
| AUD-003 | import กรอง `ps.approved = TRUE` | ย้ายโรงเรียนไม่กรอง `approved` | ย้ายโรงเรียน — ผู้ปกครองที่ถูกถอดสิทธิ์กลับมา |
| AUD-009 | backend/src/routes/auth.routes.js:369-374 revokes the presented refres | (ดูรายละเอียดใน register) | backend |
| AUD-018 | backend/migrations/030_vehicle_canonical_identity.sql:27 created `ADD  | (ดูรายละเอียดใน register) | backend |
| AUD-035 | qrAccess.service.js:201 treats driver_display_status='suspended' as a  | (ดูรายละเอียดใน register) | backend |
| AUD-038 | backend/.env.example:25-31 documents LINE_CHANNEL_ACCESS_TOKEN / LINE_ | (ดูรายละเอียดใน register) | backend |
| AUD-042 | docs/go-live-handoff.md line 46 marks the restore drill ✅ verified. do | (ดูรายละเอียดใน register) | backend |
| AUD-082 | Sidebar.jsx:170 maps '/driver/applications' → 'driverRegistration' in  | (ดูรายละเอียดใน register) | backend |

## 20. Database and Data Integrity Review

Schema จัดการด้วยไฟล์ `.sql` 42 ไฟล์ มีสคริปต์ `validate-migration-baseline.js`
สำหรับตรวจความสอดคล้อง (รันแล้ว exit 0)

**ยืนยันบนฐานข้อมูลจริง:** migration 011/043 ลงครบ (`password_changed_at` ไม่มีแถวใดเป็น NULL)
· MySQL event scheduler เปิดอยู่ ทำให้การตัด `revoked_tokens` ทำงานจริง (ปัจจุบัน 33 แถว)
· session timezone = `+07:00` ตรงตามการออกแบบ · MySQL 8.0.46

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-003 | Student transfer copies only ONE guardian link and ignores parent_student.approved — co-gu | critical | `backend/src/services/studentTransfer.service.js:134-136` |
| AUD-014 | Migration 042 creates a NON-UNIQUE index despite its filename, its comments, and the appli | major | `backend/migrations/042_parent_phone_unique.sql:16-18` |
| AUD-015 | The test database is built from a mysqldump that is seven migrations behind, so migrations | major | `backend/scripts/prepare-test-db.js:16, 45-48, 66-75` |
| AUD-016 | There is no migration runner, and the default `npm run check:migrations` is a no-op that p | major | `backend/scripts/validate-migration-baseline.js:40-55, 112-118` |
| AUD-017 | Editing a student's guardian deletes ALL of that student's guardian links, not just the on | major | `backend/src/routes/school.routes.js:770-800` |
| AUD-018 | Migration 039 dropped uq_dva_active_vehicle but two services still rely on it — the 'one a | major | `backend/src/services/driverProfile.service.js:82-104` |
| AUD-019 | Check-in idempotency guard is an unlocked SELECT with no unique index behind it — concurre | major | `backend/src/services/checkin.service.js:333-357` |
| AUD-020 | LINE notification dispatcher performs external pushes inside an open transaction and commi | major | `backend/src/services/line.service.js:1273-1327` |
| AUD-021 | Roster change request duplicate guard is an unlocked check-then-act with no unique index,  | major | `backend/src/services/rosterRequest.service.js:119-136` |
| AUD-022 | A cancelled student leave can never be re-recorded — the unique key does not exclude cance | major | `backend/src/services/leave.service.js:26-40` |
| AUD-065 | geofences.target_id is INT but schools.id is VARCHAR(10), so the admin seed-defaults endpo | minor | `backend/migrations/040_intelligent_tracking.sql:77-100 (defect on line 81)` |
| AUD-066 | notifications has no index on `sent`, is excluded from every retention rule, and accumulat | minor | `backend/migrations/001_initial_schema.sql:362-374` |
| AUD-067 | The four newest workflow-queue tables were created with no foreign keys at all, so approva | minor | `backend/migrations/032_student_transfer_requests.sql:6-35` |
| AUD-068 | Vehicle location UPSERT has no recorded_at ordering guard and recorded_at is client-suppli | minor | `backend/src/services/vehicleLocation.service.js:55-72` |
| AUD-069 | Geofence ENTER/EXIT state lives in a per-process in-memory Map and is read-modify-written  | minor | `backend/src/services/geofence.service.js:142-176` |
| AUD-070 | logAudit swallows every failure, including when handed a transactional connection — a sign | minor | `backend/src/utils/audit.js:40-66` |

## 21. Database Access Review

| ประเด็น | ผลตรวจ | หลักฐาน |
|---|---|---|
| บัญชีที่แอปใช้ | `schoolbus_db@localhost` — **ไม่ใช่ root** | `SELECT CURRENT_USER()` |
| สิทธิ์ | `ALL PRIVILEGES` เฉพาะ 3 ฐานของแอป, `USAGE` บน `*.*` | `SHOW GRANTS` |
| เปิดจากภายนอกหรือไม่ | **ไม่** — host เป็น `localhost` และ MySQL ผูก `127.0.0.1` | `ss -lntp`, `bind-address` |
| อ่านตาราง `mysql.user` ได้หรือไม่ | **ไม่ได้** — ยืนยันว่าไม่มีสิทธิ์ระดับ global | คำสั่งถูกปฏิเสธ |
| connection string เก็บที่ใด | `backend/.env` สิทธิ์ **600** ไม่ถูก track ใน git | `stat`, `.gitignore:3` |
| แยก dev/test/prod หรือไม่ | แยก 3 ฐาน: `lampang_bus`, `_test`, `_restore_drill` | `SHOW GRANTS` |
| TLS ในการเชื่อมต่อ | ไม่ได้ใช้ — แต่เชื่อมต่อผ่าน loopback เท่านั้น จึงไม่ผ่านเครือข่าย | `config/database.js` |

**ข้อสังเกต:** บัญชีเดียวกันถือทั้งสิทธิ์อ่าน/เขียนระดับ runtime และสิทธิ์ `DROP`/`ALTER`
ซึ่งเกินกว่าที่แอปต้องใช้ขณะทำงาน การแยกบัญชีสำหรับ migration ออกจากบัญชี runtime
จะลดความเสียหายหากแอปถูกยึด — เป็นการเสริมความแข็งแรง ไม่ใช่ข้อบกพร่องที่พิสูจน์ได้
(จัดเป็น Minor เพราะเข้าถึงได้จาก loopback เท่านั้น)

## 22. Backup and Disaster Recovery Review

**หมวดนี้เป็นจุดแข็งของระบบ** และผู้ตรวจยืนยันบนเซิร์ฟเวอร์จริงทุกข้อ

| ด้าน | ผลตรวจ | หลักฐาน |
|---|---|---|
| ความถี่ | ทุกวัน 02:30 น. (Asia/Bangkok) ผ่าน cron | `crontab -l` |
| สิ่งที่สำรอง | ฐานข้อมูลทั้งหมด บีบอัด `.sql.gz` | `backup-db.sh` |
| ความสมบูรณ์ | มีไฟล์ `.sha256` คู่กันทุกชุด | ไฟล์จริงบนเซิร์ฟเวอร์ |
| ชุดล่าสุด | 27 ส.ค. 2569 02:30 น. ขนาด 2.5 MB | `find -printf` |
| Retention ในเครื่อง | 7 วัน | `backup-db.sh:26,96-97` |
| สิทธิ์ไฟล์ | โฟลเดอร์ 700, ไฟล์ 600 | `backup-db.sh` |
| **สำเนานอกเครื่อง** | **มี** — rclone ทุกวัน 02:50 น. ทำงานล่าสุด 27 ส.ค. 02:50:59 | `offhost-backup-sync.log` |
| ทนต่อการถูกยึดเครื่อง | ใช้ `rclone copy` **ไม่ใช่ `sync`** จึงไม่ลบไฟล์ปลายทาง | `offhost-backup-sync.sh:105` |
| **เคยซ้อมกู้คืนจริง** | **เคย** — 26 ส.ค. 2569 กู้ได้ **58/58 ตาราง ใน 4 วินาที** | `uat-evidence/.../restore-drill/*.log` |
| เครื่องมือตรวจหลักฐาน | มี `validate-restore-drill-evidence.js` และ `create-restore-drill-evidence-pack.js` | `scripts/` |

### RPO / RTO

**ไม่ได้กำหนดไว้** — คำว่า RPO/RTO ปรากฏในเอกสารเพียง 3 จุด และทั้งหมดอยู่ในบริบท
"สิ่งที่ต้องบันทึกตอนเกิดเหตุ" ไม่ใช่เป้าหมายที่ตกลงกันไว้ล่วงหน้า

ผลคือไม่มีใครตอบได้ว่า "ข้อมูลหายย้อนหลังได้กี่ชั่วโมงจึงยังยอมรับได้" ทั้งที่
สำรองวันละครั้งหมายความว่า **RPO จริงคือสูงสุด 24 ชั่วโมง** — ต้องยืนยันว่ายอมรับได้
(บันทึกเป็น `AUD-114`)

### ความเสี่ยงที่เหลือ

หากผู้โจมตียึดเซิร์ฟเวอร์ได้ จะได้ credential ของ rclone ไปด้วย และอาจลบไฟล์ปลายทาง
ด้วยตนเองได้ แม้สคริปต์จะใช้ `copy` ก็ตาม การป้องกันคือกำหนดสิทธิ์ปลายทางให้
เขียนได้อย่างเดียว หรือเปิด versioning/object-lock — **ตรวจไม่ได้จากที่นี่**

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-041 | scripts/backup.sh writes the full student database dump and a copy of backend/.env into a  | major | `scripts/backup.sh:42-52, 57-58` |
| AUD-042 | Repository documents disagree on whether a restore drill has ever been executed, and no dr | major | `docs/go-live-handoff.md:46 (vs docs/READINESS_SCORECARD_2026-08.md:95 and docs/OPERATOR_RUNBOOK.md:74-98)` |
| AUD-043 | No schema down-migrations exist, yet the governance checklist mandates using them and forb | major | `docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md:144-151` |
| AUD-112 | Deploy takes no pre-deploy backup and performs no rollback when its own health check fails | minor | `scripts/deploy-backend.sh:1-11, 29-40` |
| AUD-113 | Off-host backup sync failure is not detected by any automated monitor | minor | `scripts/health-check.sh:77-105 (vs scripts/offhost-backup-sync.sh:26-27, 145-150)` |
| AUD-114 | No RPO or RTO is stated anywhere in the repository | minor | `docs/OPERATOR_RUNBOOK.md:6-20 (schedule table; the absence is repo-wide)` |
| AUD-115 | The nginx configuration is not version-controlled and its backup step fails silently | minor | `scripts/backup.sh:70-83` |

## 23. Security Review

ตรวจตามแนวทาง OWASP รายการที่**ตรวจแล้วไม่พบปัญหา**: SQL injection (ไล่ทุกจุดที่
สร้าง SQL ไม่ใช่สุ่มตัวอย่าง) · alg:none / JWT algorithm confusion · secret หลุดใน
git history (429 commits) · dependency vulnerability (0 ทั้งสองฝั่ง) · การรั่วของ
stack trace ใน production · การตรวจลายเซ็น LINE webhook

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-005 | POST /api/visits/track is unauthenticated and has no rate limit at all — the public visit  | major | `backend/src/routes/visits.routes.js:23-42` |
| AUD-006 | Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any re | major | `backend/src/app.js:37-43` |
| AUD-007 | The SPA document is served by nginx, so helmet's headers never reach it — no frame-ancesto | major | `backend/src/app.js:46, 198-204` |
| AUD-038 | Production boots with LINE_CHANNEL_ACCESS_TOKEN unset; every emergency LINE push then sile | major | `backend/src/config/env.js:23, 148; backend/src/services/line.service.js:9-15, 800-812; backend/src/routes/driver.routes.js:668-681` |
| AUD-055 | Body parsers run before every rate limiter, so an unauthenticated attacker forces a 10 MB  | minor | `backend/src/app.js:63-68, 114-126` |
| AUD-056 | Unauthenticated requests to /api/consent/* trigger an outbound HTTPS call to LINE before b | minor | `backend/src/routes/consent.routes.js:16-29, 40-55` |
| AUD-057 | Several security controls fail open on an exact NODE_ENV === 'production' string test, inc | minor | `backend/src/routes/line.routes.js:20-24` |
| AUD-058 | The only CSP that reaches the SPA document allows 'unsafe-inline' and 'unsafe-eval' for sc | minor | `frontend/index.html:15` |
| AUD-059 | CORS reflects any Origin outside production, which is safe today only because credentials  | minor | `backend/src/app.js:54-62` |
| AUD-107 | scripts/backup.sh copies the entire plaintext backend/.env (JWT_SECRET, DB_PASSWORD, LINE  | minor | `scripts/backup.sh:42, 46, 52, 81` |
| AUD-108 | backend/scripts/seed-uat-override-fixture.js has no production guard, defaults to the prod | minor | `backend/scripts/seed-uat-override-fixture.js:354-364, 407, 433-439` |
| AUD-109 | .gitignore matches only the exact filename .env — .env.production, .env.local, .env.bak, * | minor | `.gitignore:3, 6-9, 24-25, 28-29` |
| AUD-110 | backend/.env.example omits 13 environment variables that backend/src/config/env.js actuall | minor | `backend/.env.example:whole file (110 lines); missing keys are read at backend/src/config/env.js:186-188, 200, 205-216` |
| AUD-111 | docker-compose.yml puts DB_ROOT_PASSWORD on the healthcheck command line, where it is read | minor | `docker-compose.yml:26-31` |
| AUD-116 | GET /api/province/status-today runs an unbounded full-table student read (no LIMIT, no pag | minor | `backend/src/services/province.service.js:492-512` |
| AUD-117 | geofence.checkForVehicle runs one query per geofence on cold cache, and school geofences a | minor | `backend/src/services/geofence.service.js:131-175 (loop), 39-49 (per-iteration query), 428-435 (NULL vehicle_id seed)` |
| AUD-118 | eta.refreshForVehicle issues one INSERT ... ON DUPLICATE KEY UPDATE per pickup point on ev | minor | `backend/src/services/eta.service.js:104-126` |
| AUD-119 | GET /api/admin/snapshots takes LIMIT from an unvalidated query param — a negative value pr | minor | `backend/src/routes/admin.routes.js:835-847` |

## 24. Server and Hosting Review

| ด้าน | ผลตรวจ |
|---|---|
| OS | Ubuntu 24.04 |
| Process manager | pm2 (`schoolbus-backend`) — online 8 ชม. ขณะตรวจ, unstable restarts 0 |
| พอร์ตที่เปิดสาธารณะ | 22 (SSH), 80, 443 เท่านั้น |
| Backend | ผูก `127.0.0.1:3000` — เข้าถึงจากภายนอกโดยตรงไม่ได้ |
| MySQL | ผูก `127.0.0.1:3306` |
| พื้นที่ดิสก์ | ใช้ 14G จาก 42G (35%) |
| Health check | cron ทุก 5 นาที + systemd timers (`health-smoke`, `health-alert`, `heartbeat`, `housekeeping`) |
| Timezone | `CRON_TZ=Asia/Bangkok`, MySQL session `+07:00` |
| Firewall | **ตรวจไม่ได้** (ต้องใช้ sudo) |

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-039 | Deploy script swallows git pull failure and then reports a successful deploy of stale code | major | `scripts/deploy-backend.sh:12-14, 26-34` |
| AUD-040 | Deploy reloads PM2 without installing dependencies or applying pending migrations | major | `scripts/deploy-backend.sh:14-27` |
| AUD-044 | The only end-to-end deploy and rollback document is stale — its rollback commands target a | major | `docs/production-launch-checklist.md:132-150 (rollback), 62, 66-72, 102-103` |

## 25. GitHub and CI/CD Review

มี workflow 2 ตัว: `check-labels.yml` และ `full-quality.yml`

**ตรวจไม่ได้ทั้งหมดในหมวดนี้ (ต้องมีสิทธิ์ใน GitHub):** branch protection ของ `main`,
การบังคับ review, การห้าม force push, รายชื่อผู้มีสิทธิ์, 2FA, deploy keys,
Actions secrets, environment approval

**สิ่งที่ตรวจได้จากไฟล์:** ดูรายการด้านล่าง

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-028 | CI never applies the 42 migration files — the integration test database is built from a se | major | `backend/scripts/prepare-test-db.js:16 (SCHEMA_PATH); invoked from backend/package.json "test:ci"; run at .github/workflows/full-quality.yml:54` |
| AUD-086 | CI step `npm run check:migrations` is a structural no-op that can never fail — the baselin | minor | `.github/workflows/full-quality.yml:13, 55 (job name and step); backend/scripts/validate-migration-baseline.js:111-116 and 39-53; backend/migrations/legacy-drift-baseline.json:1` |
| AUD-087 | Production deploy gate runs only 35 of the 93 backend test files (unit config only) before | minor | `scripts/deploy-backend.sh:23-24; backend/jest.unit.config.js:9` |
| AUD-088 | check-labels.yml declares no `permissions:` block, so GITHUB_TOKEN runs at the repository  | minor | `.github/workflows/check-labels.yml:1-32 (whole file — no permissions key anywhere); compare .github/workflows/full-quality.yml:8-9` |
| AUD-089 | All third-party actions are pinned to floating major tags (@v4), not commit SHAs | minor | `.github/workflows/full-quality.yml:46, 47, 64, 65; and .github/workflows/check-labels.yml:17, 19` |
| AUD-090 | No dependency vulnerability scanning or Dependabot configuration anywhere in the repo | minor | `.github/workflows/full-quality.yml:52-55 (backend steps) and 70-73 (frontend steps) — no audit/scan step in either; .github/ contains only the two workflow files` |
| AUD-091 | .claude/ is gitignored but 371 .claude/** files are tracked, including .claude/settings.lo | minor | `.gitignore:11 (`.claude/`); tracked files enumerated via `git ls-files .claude` (371 paths, incl. .claude/settings.local.json)` |
| AUD-092 | docs/ops-backup-restore.md is a git symlink pointing at a dated one-off incident note, not | minor | `docs/ops-backup-restore.md:whole file — git mode 120000, 33-byte link target `PRODUCTION-RECOVERY-2026-06-23.md`` |
| AUD-093 | Missing standard repository files: no README, LICENSE, SECURITY.md, CONTRIBUTING.md, CODEO | minor | `.github/:`git ls-files .github` returns exactly 2 paths: workflows/check-labels.yml, workflows/full-quality.yml; `git ls-files | grep -v '/'` returns 10 root files, none of them README.md or LICENSE` |

## 26. Testing and Code Quality Review

### คำสั่งที่รันจริง และผลลัพธ์

| คำสั่ง | ผล |
|---|---|
| `npm run test:unit` (backend) | **374 passed / 374** · 36 suites · 11.1 วินาที |
| `npm audit` (backend) | **0 vulnerabilities** (info 0, low 0, moderate 0, high 0, critical 0) |
| `npm audit` (frontend) | **0 vulnerabilities** |
| `npm run build` (frontend) | สำเร็จ |
| `node scripts/validate-migration-baseline.js` | exit 0 |
| `npm run check:labels` (frontend) | PASSED |
| `node scripts/ui-redesign/nav-snapshot.mjs` | exit 0 |
| `node scripts/ui-redesign/page-status.mjs` | exit 0 |
| `node scripts/ui-redesign/route-matrix.mjs` | exit 0 |
| `node scripts/ui-redesign/permission-check.mjs` | exit 0 |
| `node scripts/ui-redesign/driver-errors-check.mjs` | exit 0 |

**ไม่ได้รัน** `test:ci` / `test:prepare` เพราะสร้างและรีเซ็ตฐานข้อมูล — อยู่นอกขอบเขต
การตรวจแบบอ่านอย่างเดียว จึงมีการทดสอบระดับ integration ที่**ยังไม่ได้ยืนยันผล**

### ข้อสังเกตสำคัญเรื่องความครอบคลุม

ชุดทดสอบ 374 รายการที่รันได้ทั้งหมดเป็น unit test ที่ไม่แตะฐานข้อมูล ส่วนการทดสอบที่
จะจับ Critical ทั้ง 4 รายการได้ — โดยเฉพาะการพิสูจน์ว่าโรงเรียน A อ่านข้อมูลของ
โรงเรียน B ไม่ได้ — ต้องใช้ฐานข้อมูลจริง จึงไม่ได้อยู่ในชุดที่รันได้ที่นี่

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-045 | Frontend has zero automated tests and no test runner: 169 source files, all UI role-gating | major | `frontend/package.json:1-40 (scripts block and devDependencies)` |
| AUD-046 | multer pinned to end-of-life 1.x and a dead alpha-version json2csv ships in the production | major | `backend/package.json:31-45 (dependencies block); resolved versions from backend/package-lock.json` |
| AUD-120 | auth.test.js RBAC test is permanently dead: it logs in as a user that is never seeded and  | minor | `backend/tests/auth.test.js:191-212` |
| AUD-121 | studentImportScope.test.js claims to prove cross-school student-code isolation but tests a | minor | `backend/tests/studentImportScope.test.js:13, 24-38` |
| AUD-122 | The DB-free unit suite has no database guard at all; loadTestEnv silently no-ops when .env | minor | `backend/jest.unit.config.js:1-11 (and backend/tests/loadTestEnv.js:150-156)` |
| AUD-123 | The backup/restore readiness safety test passes vacuously when the shell interpreter is mi | minor | `backend/tests/operationsHealth.test.js:82-115` |
| AUD-124 | admin and transport roles have no integration test with a real JWT; the shared fixture see | minor | `backend/tests/setup.js:76-92` |
| AUD-125 | Two migration tests assert only that .sql files contain certain strings, so they pass whet | minor | `backend/tests/vehicleVerification.test.js:8-32 (and backend/tests/driverShift.test.js:8-19)` |
| AUD-126 | importRollback.test.js uses no-op transaction methods, so it cannot assert rollback-on-fai | minor | `backend/tests/importRollback.test.js:14-23` |

## 27. Monitoring and Logging Review

มี audit log ที่ออกแบบมาดี (147 จุดเรียก `logAudit`) และมีการปิดบังข้อมูลส่วนบุคคล
ในบางเส้นทาง (เช่น เขียนชื่อนักเรียนเป็น `[redacted]` ในตอนบันทึกคำขอของคนขับ)

**จุดอ่อนหลัก:** ไม่มีระบบรวมศูนย์ error (ไม่มี Sentry/pino/morgan) และการตรวจจับ
อัตโนมัติเพียงอย่างเดียวคือสคริปต์ `health-smoke.sh` ซึ่งอ่าน log จาก path ที่
**ไม่ตรงกับที่ pm2 เขียนจริง** (`AUD-` ในตารางด้านล่าง)

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-029 | Admin dashboard 'failed logins (30d)' is hard-wired to always read 0 — the metric queries  | major | `backend/src/routes/admin.routes.js:683-687, 718` |
| AUD-030 | The health smoke test scans the wrong log directory — PM2 was reconfigured to write outsid | major | `scripts/health-smoke.sh:36, 328-336` |
| AUD-031 | A user's scope change (which school/affiliation they can see) is written to the audit trai | major | `backend/src/routes/admin.routes.js:182-208` |
| AUD-032 | Exporting the audit trail as CSV is itself audited on the province and affiliation endpoin | major | `backend/src/routes/admin.routes.js:556-580 (admin); backend/src/routes/school.routes.js:1226-1243 (school)` |
| AUD-094 | School audit-log JSON endpoint returns raw old_value/new_value — the PII redaction applied | minor | `backend/src/routes/school.routes.js:1249-1261` |
| AUD-095 | Admin dashboard 'password resets this month' is hard-wired to always read 0 — queries enti | minor | `backend/src/routes/admin.routes.js:632-636, 716` |
| AUD-096 | Critical error-log matches are classified WARN, and WARN exits 0 — so the alerter is silen | minor | `scripts/health-smoke.sh:350-353, 363-368` |
| AUD-097 | 41% of audit writes (60 of 147) record no ip_address or user_agent, including affiliation- | minor | `backend/src/services/affiliationAdmin.service.js:102-110 (and 61, 132, 195, 459 in the same file)` |
| AUD-098 | Audit writes fail silently — an unknown action or a DB error is swallowed, the caller's tr | minor | `backend/src/utils/audit.js:40-43, 61-67` |
| AUD-099 | Production 5xx logging is a bare message string — no stack, no route, no user, no request  | minor | `backend/src/middleware/errorHandler.js:44-58` |
| AUD-100 | /health answers HTTP 200 with success:true while the database is down — any monitor keyed  | minor | `backend/src/app.js:84-107` |
| AUD-101 | Audit-log retention runs only from a hand-installed cron that is not in the repo — the arc | minor | `backend/scripts/cleanup-old-logs.js:17-20, 66-70` |

## 28. PDPA and Personal Data Review

ระบบเก็บชื่อเด็ก ระดับชั้น ห้องเรียน จุดรับส่ง และเบอร์ผู้ปกครอง — อยู่ในบังคับ
พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล

**สิ่งที่ทำถูก:** ตัวตนผู้ปกครองยืนยันจาก LINE id_token ที่ตรวจกับ `api.line.me` จริง
และ**ไม่มี fallback ที่รับตัวตนจาก query parameter** ซึ่งเป็นช่องโหว่ที่พบบ่อยใน
ระบบลักษณะนี้ · หน้า QR สาธารณะปิดบังชื่อคนขับและเบอร์ติดต่อไว้ · มีการ mask
เบอร์โทรใน audit log ฝั่ง CSV

**ประเด็นที่ต้องให้ผู้ควบคุมข้อมูลตัดสิน** (อยู่ใน register): ฐานทางกฎหมายในการ
ประมวลผล (ความยินยอม หรือ ภารกิจของรัฐ) · ระยะเวลาเก็บและกลไกลบข้อมูลเด็กที่ออกจาก
ระบบ · ความเข้มของการพิสูจน์ตัวตนผู้ปกครองตอนผูกบัญชี LINE

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| AUD-033 | GET /api/parent/children returns every linked child's full name, classroom and school with | major | `backend/src/routes/parent.routes.js:99-104 (compare 108-119, 123-145, 153-164)` |
| AUD-034 | Turning on FEATURE_PARENT_CONSENT_REQUIRED alone hard-locks every parent out: the consent  | major | `backend/src/app.js:176-179 (with backend/src/config/env.js:51-56 and backend/src/services/parentConsentGate.js:26)` |
| AUD-035 | A driver's withdrawal of PDPA consent suspends only the QR page; the LINE/LIFF parent chan | major | `backend/src/services/line.service.js:243-263 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76, 198-209)` |
| AUD-036 | GET /api/school/audit-logs returns unredacted guardian phone numbers in its JSON response  | major | `backend/src/routes/school.routes.js:1249-1261 (contrast 1237 and 137-154)` |
| AUD-037 | A child's data is unlocked by a guardian phone number plus a student code, with no proof o | major | `backend/src/routes/parent.routes.js:202-256 (with backend/src/services/line.service.js:100-131 and backend/src/services/lineBindGuard.js:23-28)` |
| AUD-102 | In the shipped configuration no parent consent record can exist, and the consent ledger ha | minor | `backend/.env.example:87 (with backend/src/app.js:176-179, backend/src/config/env.js:200, backend/migrations/035_consent_records.sql:9-27)` |
| AUD-103 | The LINE bind chat flow writes the guardian's phone number and the student code into line_ | minor | `backend/src/routes/line.routes.js:163-167 (with backend/src/services/line.service.js:1213-1229 and 1239-1252)` |
| AUD-104 | There is no erasure mechanism for a child who leaves: withdrawal is a soft delete that ret | minor | `backend/src/routes/school.routes.js:913-929 (with backend/scripts/cleanup-old-logs.js:28-37)` |
| AUD-105 | Withdrawing the QR consent publicly re-labels the driver as 'ระงับ' (suspended) — exercisi | minor | `backend/src/services/qrAccess.service.js:193 (with backend/src/services/consent.service.js:137-147 and backend/src/services/qrAccess.service.js:72-76)` |
| AUD-106 | Parent reads of a child's status, 90-day movement history and ETA are not audited anywhere | minor | `backend/src/routes/parent.routes.js:99-164 (contrast backend/src/services/qrAccess.service.js:233-247)` |

## 29. Product Owner Confirmation Items

รวม **13 รายการ** ที่ต้องให้เจ้าของระบบหรือผู้ควบคุมข้อมูลตัดสิน
ก่อนจึงจะสรุปได้ว่าเป็นข้อบกพร่องหรือเป็นพฤติกรรมที่ตั้งใจ

รายละเอียดเต็มพร้อมช่องให้ลงนามอยู่ใน **`docs/audit/LOGIC_CONFIRMATION_REGISTER.md`**

| ID | ประเด็นที่ต้องตัดสิน | Provisional severity |
|---|---|---|
| AUD-004 | Grade-teacher school sub-accounts are grade-scoped everywhere in /api/school but NOT in /api | critical |
| AUD-006 | Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any requ | major |
| AUD-009 | Refresh-token rotation is broken end to end: the backend revokes the old refresh token, the  | major |
| AUD-018 | Migration 039 dropped uq_dva_active_vehicle but two services still rely on it — the 'one act | major |
| AUD-035 | A driver's withdrawal of PDPA consent suspends only the QR page; the LINE/LIFF parent channe | major |
| AUD-037 | A child's data is unlocked by a guardian phone number plus a student code, with no proof of  | major |
| AUD-038 | Production boots with LINE_CHANNEL_ACCESS_TOKEN unset; every emergency LINE push then silent | major |
| AUD-042 | Repository documents disagree on whether a restore drill has ever been executed, and no dril | major |
| AUD-082 | Sidebar and MobileBottomNav apply the driverRegistration flag in opposite directions for /dr | minor |
| AUD-102 | In the shipped configuration no parent consent record can exist, and the consent ledger has  | minor |
| AUD-104 | There is no erasure mechanism for a child who leaves: withdrawal is a soft delete that retai | minor |
| AUD-105 | Withdrawing the QR consent publicly re-labels the driver as 'ระงับ' (suspended) — exercising | minor |
| AUD-114 | No RPO or RTO is stated anywhere in the repository | minor |

## 30. Remediation Roadmap

ไม่ระบุจำนวนวัน เพราะไม่มีหลักฐานเรื่องกำลังคนที่มี

### P0 — ต้องแก้ก่อนเปิดใช้จริง

| Finding | ประเด็น | Complexity | ต้อง downtime | ต้องให้ PO ยืนยัน |
|---|---|---|---|---|
| **AUD-001** | รหัสผ่านคนขับ = ทะเบียนรถ · **404 บัญชีเปิดใช้งานอยู่** | M | ไม่ | ไม่ |
| **AUD-002** | รหัสผ่านโรงเรียน = รหัส OBEC · 19 บัญชี | S | ไม่ | ไม่ |
| **AUD-003** | ย้ายโรงเรียนคืนสิทธิ์ผู้ปกครองที่ถูกถอด | S | ไม่ | ไม่ |
| **AUD-004** | ครูประจำชั้นดึงรายชื่อทั้งโรงเรียนผ่าน `/api/reports` | S | ไม่ | **ต้องการ** |

**หมายเหตุสำคัญสำหรับ AUD-001/002:** การแก้โค้ดอย่างเดียวไม่พอ เพราะบัญชีที่
เปราะบางอยู่แล้ว 423 บัญชีจะยังเปราะบางต่อไป ต้องมีขั้นตอน**บังคับรีเซ็ตรหัสผ่าน
ทั้งหมดพร้อมกัน** ด้วยค่าที่สุ่มจริงและส่งผ่านช่องทางที่ไม่ใช่ข้อมูลสาธารณะ
ซึ่งเป็นงานปฏิบัติการที่ต้องวางแผนร่วมกับแผนอบรมผู้ใช้

### P1 — ต้องแก้ก่อนตรวจรับ

| Finding | ประเด็น | Complexity |
|---|---|---|
| AUD-005 | POST /api/visits/track is unauthenticated and has no rate limit at all — the public visi | M |
| AUD-006 | Per-IP rate limiting is defeated by a spoofed X-Forwarded-For if the origin accepts any  | M |
| AUD-007 | The SPA document is served by nginx, so helmet's headers never reach it — no frame-ances | L |
| AUD-008 | Logout cannot invalidate the access token — it stays valid for the full 24h after the us | M |
| AUD-009 | Refresh-token rotation is broken end to end: the backend revokes the old refresh token,  | M |
| AUD-010 | trust proxy = 1 is off by one for the documented Cloudflare→nginx chain: req.ip resolves | M |
| AUD-011 | IDOR: any school account can read another school's inspection-application audit timeline | L |
| AUD-012 | GET /api/school/no-show ignores grade_scope while every sibling endpoint in the same fil | M |
| AUD-013 | Grade-scope filter uses exact `s.grade = ?` in four paths where the rest of the system u | M |
| AUD-014 | Migration 042 creates a NON-UNIQUE index despite its filename, its comments, and the app | M |
| AUD-015 | The test database is built from a mysqldump that is seven migrations behind, so migratio | L |
| AUD-016 | There is no migration runner, and the default `npm run check:migrations` is a no-op that | M |
| AUD-017 | Editing a student's guardian deletes ALL of that student's guardian links, not just the  | M |
| AUD-018 | Migration 039 dropped uq_dva_active_vehicle but two services still rely on it — the 'one | L |
| AUD-019 | Check-in idempotency guard is an unlocked SELECT with no unique index behind it — concur | M |
| AUD-020 | LINE notification dispatcher performs external pushes inside an open transaction and com | L |
| AUD-021 | Roster change request duplicate guard is an unlocked check-then-act with no unique index | L |
| AUD-022 | A cancelled student leave can never be re-recorded — the unique key does not exclude can | L |

*(Major ที่เหลืออีก 24 รายการอยู่ในหมวด 14)*

### P2 — แก้หลังเปิดใช้ตามแผน

Minor ทั้ง 80 รายการ (หมวด 15) — ส่วนใหญ่เป็นเรื่องความสม่ำเสมอของข้อความ
ความครบถ้วนของ log การเสริมความแข็งแรงที่ยังไม่มีเส้นทางความล้มเหลวที่พิสูจน์ได้
และเอกสาร

## 31. Production Readiness Assessment

### คำตัดสิน: **NOT READY**

ตามเกณฑ์ข้อ 25 ของโจทย์ ห้ามสรุปว่า READY หากยังมี Critical Finding ที่ยังไม่แก้
ขณะนี้มี **4 รายการ** และหนึ่งในนั้นมีหลักฐานเชิงปริมาณจากระบบจริงว่ามีบัญชีที่
ถูกเข้าถึงได้ทันที **423 บัญชี**

### เหตุผลจากหลักฐาน

1. **AUD-001** — 404 จาก 451 บัญชีคนขับ (89.6%) เข้าสู่ระบบได้ด้วยทะเบียนรถที่
   ติดอยู่ข้างรถ ทุกบัญชีเปิดใช้งานอยู่ วัดจากฐานข้อมูลจริงด้วย `bcrypt.compare`
2. **AUD-002** — 19 บัญชีโรงเรียนเข้าได้ด้วยรหัส OBEC ที่เผยแพร่ในทำเนียบสถานศึกษา
   บัญชีโรงเรียนอ่านรายชื่อนักเรียนทั้งโรงเรียนได้
3. **AUD-003** — ผู้ปกครองที่ถูกถอดสิทธิ์กลับมาได้รับข้อมูลตำแหน่งเด็กอีกครั้ง
   โดยไม่มีใครสั่ง ซึ่งในบริบทโรงเรียนอาจเป็นเรื่องความปลอดภัยของเด็กโดยตรง
4. **AUD-004** — ครูประจำชั้นที่ถูกจำกัดให้เห็นเฉพาะชั้นของตน ดาวน์โหลดรายชื่อ
   นักเรียนทั้งโรงเรียนพร้อมสถานะการเดินทางได้ (รอการยืนยันกติกาจากเจ้าของระบบ)

### เงื่อนไขที่จะทำให้เป็น READY WITH CONDITIONS

- แก้ AUD-001, AUD-002 **และรีเซ็ตรหัสผ่านบัญชีที่เปราะบางทั้ง 423 บัญชี**
- แก้ AUD-003 (เพิ่ม `AND approved = TRUE` และเลิกใช้ `LIMIT 1` ที่ไม่มี `ORDER BY`)
- ได้คำตอบจากเจ้าของระบบเรื่อง AUD-004 แล้วดำเนินการตามนั้น
- มีชุดทดสอบที่พิสูจน์ว่าข้อมูลข้ามโรงเรียนถูกกั้นจริง (ปัจจุบันไม่มี)
- กำหนด RPO/RTO เป็นข้อผูกพัน

### สิ่งที่ไม่ควรกังวลเกินเหตุ

หมวดที่มักเป็นอุปสรรคในการตรวจรับระบบราชการ — การสำรองข้อมูล การกู้คืน
การแยกสิทธิ์ฐานข้อมูล การปิดพอร์ต การจัดการ secret — **ระบบนี้ทำได้ดีและมี
หลักฐานยืนยันแล้ว** ปัญหาที่เหลือกระจุกอยู่ที่วิธีแจกจ่ายบัญชีและความไม่สอดคล้อง
ระหว่างชั้น ซึ่งแก้ได้ด้วยการเปลี่ยนแปลงที่มีขอบเขตชัดเจน ไม่ใช่การรื้อสถาปัตยกรรม

## 32. Appendices

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/audit/SYSTEM_AUDIT_REPORT.md` | รายงานฉบับนี้ |
| `docs/audit/AUDIT_COVERAGE.md` | Coverage manifest — อะไรตรวจแล้ว อะไรตรวจไม่ได้ |
| `docs/audit/LOGIC_CONFIRMATION_REGISTER.md` | 13 รายการที่ต้องให้เจ้าของระบบยืนยัน |
| `docs/audit/_final.json` | findings ทั้ง 126 รายการพร้อมข้อมูลครบ |
| `docs/audit/_route-inventory.json` | ทะเบียน endpoint ทั้ง 247 รายการ |
| `docs/audit/_coverage.json` | บันทึกการอ่านไฟล์รายโดเมน |
| `docs/audit/_unable.json` | 128 รายการที่ผู้ตรวจรายโดเมนระบุว่าตรวจไม่ได้ |

## 33. Commands Executed

ทุกคำสั่งเป็นการอ่านหรือทดสอบที่ไม่เขียนข้อมูล

```bash
# ที่เก็บ
git rev-parse HEAD / git status / git ls-files / git log --all

# ทดสอบและตรวจคุณภาพ
cd backend && npm ci --no-audit --no-fund     # ติดตั้ง dependency ในเครื่องเท่านั้น
cd backend && npm run test:unit               # 374 passed
cd backend && npm audit --json                # 0 vulnerabilities
cd frontend && npm audit --json               # 0 vulnerabilities
cd frontend && npm run build                  # สำเร็จ
cd frontend && npm run check:labels           # PASSED
node backend/scripts/validate-migration-baseline.js
node scripts/ui-redesign/{nav-snapshot,page-status,route-matrix,permission-check,driver-errors-check}.mjs

# ตรวจบนเซิร์ฟเวอร์จริง (อ่านอย่างเดียวทั้งหมด)
ss -lntp                                      # พอร์ตที่เปิดฟัง
crontab -l / systemctl list-timers            # งานตามเวลา
SHOW GRANTS FOR CURRENT_USER()                # สิทธิ์ฐานข้อมูล
SELECT @@event_scheduler, VERSION(), @@session.time_zone
SHOW COLUMNS FROM users LIKE ...              # ยืนยัน migration
bcrypt.compare(username, password_hash)       # วัดบัญชีที่ใช้รหัสเริ่มต้น
stat -c %a backend/.env                       # สิทธิ์ไฟล์
```

**ไม่ได้รัน:** `test:ci`, `test:prepare`, `prisma` ใด ๆ (ไม่มีในระบบ), migration,
seed, deploy, restart หรือคำสั่งเขียนข้อมูลใด ๆ

## 34. Test Results

```
Test Suites: 36 passed, 36 total
Tests:       374 passed, 374 total
Snapshots:   0 total
Time:        11.097 s
```

ไม่มี test ที่ fail · ไม่มี test ที่ skip ในชุดที่รัน · ไม่พบ flaky test ในรอบเดียวที่รัน

## 35. Files Reviewed

ดู `docs/audit/AUDIT_COVERAGE.md` หมวด 3 ซึ่งบันทึกรายไฟล์ที่ผู้ตรวจแต่ละโดเมน
อ่านจริง พร้อมช่วงบรรทัด

---

*รายงานฉบับนี้ไม่มีการแก้ไขระบบใด ๆ ทั้งสิ้น ตามข้อกำหนดข้อ 3.1 ของโจทย์*
*ไม่มีการเปิดเผยค่า secret รหัสผ่าน token หรือข้อมูลส่วนบุคคลใด ๆ ในเอกสารนี้*
*ขอให้เจ้าของระบบตรวจ Logic Confirmation Register ก่อนเริ่มแผนแก้ไขโค้ด*