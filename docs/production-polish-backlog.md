# Production Polish Backlog — Lampang Bus System

**Generated:** 2026-04-03
**Source:** Code inspection + runtime smoke test

## Priority Levels
- **P0** = Must fix before production go-live
- **P1** = Fix within first sprint after go-live
- **P2** = Technical debt / future improvement

---

## P0 — Before Go-Live

### 1. Reset admin password
- **Why:** Current admin password is unknown (was changed but not recorded)
- **Files:** backend/scripts/create-admin.js
- **Risk:** No admin access to system
- **Fix:** Re-run create-admin with known password, or add password reset script
- **Phase:** Immediate

### 2. Rotate seeded default passwords
- **Why:** 66 accounts use password '1234' (seeded from Excel)
- **Files:** backend/scripts/migrate-from-excel.js (source), users table
- **Risk:** Unauthorized access with known default password
- **Fix:** Force must_change_password=TRUE for all seeded accounts, or bulk password reset
- **Phase:** Before production

### 3. Production deployment infrastructure
- **Why:** No Dockerfile, no nginx config, no production build pipeline
- **Files:** Missing: Dockerfile, nginx.conf, docker-compose.prod.yml
- **Risk:** Cannot deploy to production server
- **Fix:** Create minimal Dockerfile + nginx reverse proxy config
- **Phase:** Before production

---

## P1 — Post Go-Live (Short Term)

### 4. Backend PDF Thai font support
- **Why:** Backend PDF export (pdfkit) falls back to Helvetica — Thai text garbled
- **Files:** backend/fonts/ (missing), backend/src/routes/report.routes.js
- **Risk:** Backend PDF unusable for Thai. Client-side print works as workaround.
- **Fix:** Install THSarabunNew.ttf in backend/fonts/
- **Phase:** Post go-live

### 5. Harden must_change_password at backend middleware
- **Why:** Currently enforced only at frontend (soft redirect). User can bypass via API.
- **Files:** backend/src/middleware/auth.js
- **Risk:** User skips password change by calling API directly
- **Fix:** Add middleware check: if must_change_password=TRUE, reject all non-auth routes
- **Phase:** Post go-live

### 6. CSV parser comma-in-field handling
- **Why:** Import parser uses naive line.split(',') — fields with commas break
- **Files:** backend/src/routes/school.routes.js (import endpoint)
- **Risk:** Import fails silently on rows with commas in names
- **Fix:** Use proper CSV parser library (csv-parse)
- **Phase:** Post go-live

---

## P2 — Technical Debt

### 7. cid_hash placeholder resolution
- **Why:** Students created via roster request or import have placeholder cid_hash, not real national ID hash
- **Files:** backend/src/services/rosterRequest.service.js, school.routes.js (import)
- **Risk:** Cannot match students by national ID if needed later
- **Fix:** Add UI for school to update cid_hash after student creation
- **Phase:** Future

### 8. Audit log query performance
- **Why:** Audit-logs query uses subquery on students table for school/affiliation scope
- **Files:** backend/src/routes/school.routes.js, affiliation.routes.js
- **Risk:** Slow queries when audit_logs table grows large
- **Fix:** Add school_id column to audit_logs, or add composite index
- **Phase:** Future

### 9. LINE OA Integration
- **Why:** Phase 6 per CLAUDE.md roadmap — not started
- **Files:** backend/src/routes/line.routes.js (not created yet)
- **Risk:** No parent notification system
- **Fix:** Implement LINE webhook + rich menu + push notifications
- **Phase:** Next major phase

### 10. Transport module
- **Why:** Phase 5 per CLAUDE.md roadmap — not started
- **Files:** backend/src/routes/transport.routes.js (not created yet)
- **Risk:** No vehicle inspection workflow
- **Fix:** Implement transport inspection CRUD
- **Phase:** Next major phase
