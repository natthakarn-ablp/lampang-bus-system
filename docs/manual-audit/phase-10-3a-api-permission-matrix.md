# Phase 10.3A — API × Permission Matrix

*Audit date: 2026-05-14*
*Source commit: `db9ca0e`*

## Legend

| Column | Meaning |
|---|---|
| **API group** | URL mount point |
| **Endpoint** | Path under that mount |
| **Method** | HTTP verb |
| **Allowed roles** | Roles that pass `router.use(requireRole(...))` for this endpoint |
| **Scope** | How scope is enforced: `none` / `JWT.scope_id` / `JWT vehicle` / `parent ↔ student` / `signature` |
| **Sensitivity** | `low` (aggregate) / `med` (read PII) / `high` (write or expose secrets) |
| **Manual explanation needed** | `yes` if user-facing flow; `no` if internal/admin-only |
| **Risk note** | Sentence about safety or carry-forward |

## /api/auth/*

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/login` | POST | public | none | high | yes | rate-limited; returns access + refresh tokens |
| `/me` | GET | any JWT | self | low | yes | safe; profile data only |
| `/change-password` | POST | any JWT | self | high | yes | revokes refresh tokens; must-change-password flow |
| `/refresh-token` | POST | public (with refresh JWT) | self | high | no | issues new access token; revoked-tokens table blocks reuse |
| `/logout` | POST | any JWT | self | low | yes | adds refresh JWT to revoked_tokens |

## /api/admin/*

`router.use(authenticate, requireRole('admin'))` at mount.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/users` | GET | admin | none | med | yes | full user list; filter by role / active / search |
| `/users` | POST | admin | none | high | yes | hashes password (bcrypt 12); must_change_password=TRUE |
| `/users/:id` | PUT | admin | none | high | yes | update display_name, is_active, role, scope_id |
| `/users/:id/reset-password` | POST | admin | none | high | yes | hashes new pw; forces re-change; revokes refresh tokens |
| `/users/:id` | DELETE | admin | none | high | yes | soft-delete only |
| `/users-needing-action` | GET | admin | none | low | yes | dashboard card |
| `/roster-requests-pending` | GET | admin | none | low | yes | dashboard card |
| `/pickup-points` | GET/POST/PUT/DELETE | admin | none | med | yes | full CRUD; affects driver/school views |
| `/pickup-points/:id/students` | POST/DELETE/PUT | admin | none | med | yes | link/unlink students |
| `/pickup-points/:id/assignable-students` | GET | admin | none | med | yes | dropdown source |
| `/audit-logs` | GET | admin | none | med | yes | CSV export (`?format=csv`) |
| `/system-health` | GET | admin | none | low | yes | aggregate ops view |
| `/snapshots/run` | POST | admin | none | high | no | privileged — could mark baseline incorrectly |
| `/snapshots` | GET | admin | none | low | yes | snapshot history |
| `/evaluation-summary` | GET | admin | none | low | yes | per-role action counts |
| `/research-export` | GET | admin | none | high | yes | CSV/Excel/JSON; contains role-action telemetry |
| `/research-export/preview` | GET | admin | none | low | yes | row-count preview |
| `/live-vehicles` | GET | admin | none | med | yes | live GPS aggregate |
| `/transfer-requests` | GET | admin | none | med | yes | **Phase 10.13B** — list pending transfer requests |
| `/transfer-requests/:id/approve` | POST | admin | none | high | yes | **Phase 10.13B** — Option B: soft-close source + create target; idempotent; blocks on duplicate student code |
| `/transfer-requests/:id/reject` | POST | admin | none | high | yes | **Phase 10.13B** — requires reason |
| `/vehicle-requests` | GET | admin | none | med | yes | **Phase 10.13B** — list vehicle requests (RESTORE / use / add / inspect) |
| `/vehicle-requests/:id/approve` | POST | admin | none | high | yes | **Phase 10.13B** — RESTORE only meaningful action; blocks on duplicate plate |
| `/driver-integrity` | GET | admin | none | low | yes | **Phase 10.13B** — dashboard: orphan drivers/vehicles, duplicate accounts |
| `/driver-integrity/restore` | POST | admin | none | high | yes | **Phase 10.13B** — restore canonical driver account only |
| `/driver-integrity/move` | POST | admin | none | high | yes | **Phase 10.13B** — end current assignment + create new |
| `/driver-integrity/disable` | POST | admin | none | high | yes | **Phase 10.13B** — end assignment + disable account (no history delete) |

## /api/province/*

`router.use(authenticate, requireRole('province','admin'))` at mount.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/dashboard` | GET | province, admin | none (full read) | low | yes | aggregate counts |
| `/affiliations` | GET | province, admin | none | low | yes | drop-down source for `/admin/users` dropdown (Phase 10.1A/B) |
| `/schools` | GET | province, admin | none | low | yes | filter `?affiliation_id=` |
| `/students` | GET | province, admin | none | med | yes | PII; filter heavy |
| `/vehicles` | GET | province, admin | none | low | yes | **PII-sanitized** — phone fields stripped |
| `/vehicles-at-risk` | GET | province, admin | none | low | yes | inspection + insurance risk score |
| `/status-today` | GET | province, admin | none | med | yes | daily checkin/out |
| `/trend` | GET | province, admin | none | low | yes | last N days (default 7) |
| `/emergencies` | GET | province, admin | none | med | yes | province-wide |
| `/audit-logs` | GET | province, admin | none | med | yes | CSV export |
| `/live-vehicles` | GET | province, admin | none | med | yes | live GPS (audited) |
| `/pickup-map` | GET | province, admin | none | med | yes | read-only province-wide |

## /api/readiness/*

`router.use(authenticate, requireRole('province','admin'))` at mount. Read-only, no PII.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/` | GET | province, admin | none | low | yes | **2026-06-22** — deployment readiness checklist (no PII) |

## /api/affiliation/*

`router.use(authenticate, requireRole('affiliation','admin'))` at mount.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/dashboard` | GET | aff, admin | JWT.scope_id | low | yes | |
| `/schools` | GET | aff, admin | JWT.scope_id | low | yes | |
| `/students` | GET | aff, admin | JWT.scope_id | med | yes | |
| `/vehicles` | GET | aff, admin | JWT.scope_id | low | yes | |
| `/status-today` | GET | aff, admin | JWT.scope_id | med | yes | |
| `/emergencies` | GET | aff, admin | JWT.scope_id | med | yes | |
| `/live-vehicles` | GET | aff, admin | JWT.scope_id | med | yes | |
| `/pickup-map` | GET | aff, admin | JWT.scope_id | med | yes | |
| `/audit-log` | GET | aff, admin | JWT.scope_id | med | yes | CSV export |
| `/school-accounts` | GET | aff, admin | JWT.scope_id | med | yes | list of school accounts in affiliation |
| `/school-accounts` | POST | aff, admin | JWT.scope_id | high | yes | create account for existing school |
| `/school-accounts/new-school` | POST | aff, admin | JWT.scope_id | high | yes | create school + account in one tx (Section A on `/affiliation/accounts`) |
| `/school-accounts/import-template` | GET | aff, admin | none (read-only) | low | yes | **Phase 10.2A** — streams `.xlsx` |
| `/school-accounts/import/preview` | POST | aff, admin | JWT.scope_id | med | yes | **Phase 10.2A** — multer; validates only; no DB writes; **never returns plaintext password** |
| `/school-accounts/import/commit` | POST | aff, admin | JWT.scope_id | high | yes | **Phase 10.2A** — transactional bulk insert; bcrypt; **never returns plaintext password** |
| `/school-accounts/:id/reset-password` | POST | aff, admin | JWT.scope_id | high | no | available via API; not surfaced in current Phase 10.2A UI |
| `/school-accounts/:id` | PUT | aff, admin | JWT.scope_id | med | no | toggle is_active; not surfaced in Phase 10.2A UI |

## /api/school/*

`router.use(authenticate, requireRole('school','admin'))` at mount. Many writes additionally gated by `requireFullSchoolScope()` (blocks grade-teacher sub-accounts).

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/dashboard` | GET | school, admin | JWT.scope_id | low | yes | |
| `/students` | GET | school, admin | JWT.scope_id | med | yes | search + filters |
| `/students/import/preview` | POST | school (full), admin | JWT.scope_id | med | yes | CSV/XLSX validate-only |
| `/students/import` | POST | school (full), admin | JWT.scope_id | high | yes | bulk insert students |
| `/students/export?date=` | GET | school, admin | JWT.scope_id | high | yes | CSV with BOM |
| `/vehicles` | GET | school, admin | JWT.scope_id | low | yes | |
| `/vehicles/import/preview` | POST | school (full), admin | JWT.scope_id | med | yes | |
| `/vehicles/import` | POST | school (full), admin | JWT.scope_id | high | yes | |
| `/status-today` | GET | school, admin | JWT.scope_id | med | yes | |
| `/emergencies` | GET/POST | school, admin | JWT.scope_id | med | yes | |
| `/approvals` | GET | school, admin | JWT.scope_id | med | yes | roster-change-requests |
| `/approvals/:id/approve` | POST | school, admin | JWT.scope_id | high | yes | |
| `/approvals/:id/reject` | POST | school, admin | JWT.scope_id | high | yes | |
| `/audit-log` | GET | school (full), admin | JWT.scope_id | med | yes | CSV export |
| `/live-vehicles` | GET | school, admin | JWT.scope_id | med | yes | audited read |
| `/pickup-map` | GET | school, admin | JWT.scope_id | med | yes | |
| `/pickup-points` | GET/POST | school, admin | JWT.scope_id + vehicle | med | yes | school can create for own vehicles |
| `/pickup-points/:id/students` | PUT | school, admin | JWT.scope_id + vehicle | med | yes | bulk-link students |
| `/accounts` | GET | school, admin | JWT.scope_id | med | yes | grade-teacher account list |
| `/accounts` | POST | school (full), admin | JWT.scope_id | high | yes | create grade-teacher account |
| `/accounts/:id` | PUT/DELETE | school (full), admin | JWT.scope_id | high | yes | edit / soft-delete |
| `/vehicles/:id/verify` | POST | school (full), admin | JWT.scope_id | high | yes | **2026-06-22** — submit vehicle for verification (PENDING_VERIFICATION) |

## /api/driver/*

`router.use(authenticate, requireRole('driver'))` at mount.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/roster` | GET | driver | JWT vehicle | med | yes | own vehicle only |
| `/checkin` | POST | driver | JWT vehicle | high | yes | per-student |
| `/checkout` | POST | driver | JWT vehicle | high | yes | per-student |
| `/checkin-all` | POST | driver | JWT vehicle | high | yes | batch checkin |
| `/emergency` | POST | driver | JWT vehicle | high | yes | |
| `/status-today` | GET | driver | JWT vehicle | med | yes | |
| `/pickup-points` | GET/POST | driver | JWT vehicle | med | yes | own vehicle |
| `/pickup-points/:id` | GET/PUT/DELETE | driver | JWT vehicle + own pickup | med | yes | |
| `/pickup-students` | GET | driver | JWT vehicle | med | yes | modal data source |
| `/location` | POST | driver | JWT vehicle | low | no | rate-limited 6/min; automated by app |
| `/profile` | GET/POST | driver | JWT.user_id | med | yes | own profile only |
| `/upload-photo` | POST | driver | JWT.user_id | high | yes | multer; image only |
| `/leaves` | GET/POST | driver | JWT.user_id | med | yes | leave requests |
| `/roster-requests` | GET | driver | JWT vehicle | med | yes | pending requests for vehicle |
| `/shift` | GET | driver | JWT.user_id | low | yes | **2026-06-22** — current/active shift status |
| `/shift/start` | POST | driver | JWT.user_id + vehicle | high | yes | **2026-06-22** — start shift; blocks if ACTIVE shift exists |
| `/shift/end` | POST | driver | JWT.user_id + vehicle | high | yes | **2026-06-22** — end active shift (COMPLETED) |

## /api/transport/*

`router.use(authenticate, requireRole('transport','admin'))` at mount.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/dashboard` | GET | transport, admin | none | low | yes | inspection summary |
| `/vehicles` | GET | transport, admin | none | low | yes | with inspection status |
| `/vehicles` | POST | transport, admin | none | high | yes | create new vehicle for inspection |
| `/vehicles/:id` | GET | transport, admin | none | low | yes | |
| `/schools` | GET | transport, admin | none | low | yes | dropdown source |
| `/inspections` | GET | transport, admin | none | med | yes | filter by vehicle/result |
| `/inspections` | POST | transport, admin | none | high | yes | record new inspection |
| `/inspections/:id` | PUT | transport, admin | none | high | yes | edit existing |
| `/pickup-map` | GET | transport, admin | none | med | yes | read-only overlay |
| `/verification-queue` | GET | transport, admin | none | low | yes | **2026-06-22** — list vehicles pending verification |
| `/verification-queue/:id/approve` | POST | transport, admin | none | high | yes | **2026-06-22** — approve verification + audit log |
| `/verification-queue/:id/reject` | POST | transport, admin | none | high | yes | **2026-06-22** — reject verification + reason + audit log |

## /api/reports/*

`router.use(authenticate, requireRole('school','affiliation','province','admin'))` at mount. Server filters by JWT scope.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/daily` | GET | school, aff, prov, admin | JWT scope filter | med | yes | |
| `/monthly` | GET | school, aff, prov, admin | JWT scope filter | med | yes | |
| `/summary` | GET | school, aff, prov, admin | JWT scope filter | med | yes | |
| `/export/csv` | GET | school, aff, prov, admin | JWT scope filter | high | yes | |
| `/export/excel` | GET | school, aff, prov, admin | JWT scope filter | high | yes | |
| `/export/pdf` | GET | school, aff, prov, admin | JWT scope filter | high | yes | embeds THSarabunNew font |

## /api/parent/*

Public; identifies parent via `?line_user_id=` query.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/children` | GET | public + line_user_id | parent ↔ student link | med | yes | rate-limited 60/min/IP |
| `/children/:id/status` | GET | public + line_user_id | parent ↔ student link | med | yes | |
| `/children/:id/history` | GET | public + line_user_id | parent ↔ student link | med | yes | `?days=7` default |

**MVP carry-forward:** parent auth is by query-parameter LIFF-context only. Future hardening (LIFF access-token verify or JWT) is a known follow-up.

## /api/line/*

Public; identifies caller via LINE signature.

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/webhook` | POST | LINE platform | signature | high | yes | HMAC-SHA256 verified with LINE channel secret; never echoes signature or token |
| `/process-notifications` | POST | cron / internal | API key header | low | no | trigger pending notifications; gated by `x-api-key` |

## /api/visits/*

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/track` | POST | public | none (aggregate) | low | no | daily visit counter; no PII |

## /health

| Endpoint | Method | Allowed roles | Scope | Sensitivity | Manual | Risk note |
|---|---|---|---|---|---|---|
| `/health` | GET | public | none | low | no | service / version / commit / env / DB-connected; never exposes secrets (Phase 9.14 contract) |

## Summary stats

- **Total endpoints inventoried:** ~130 (post-2026-06-22 additions: transfer-requests, vehicle-requests, driver-integrity, readiness, shift, verification-queue)
- **Endpoints user-manual-relevant:** ~100
- **Endpoints admin-only:** ~35
- **Endpoints with bulk import:** 4 (school students, school vehicles, affiliation school-accounts preview, affiliation school-accounts commit)
- **Endpoints with file export:** 8 (CSV / Excel / PDF across admin, province, affiliation, school, reports)
- **Endpoints with PII sanitization explicitly applied:** 1 (province `/vehicles` strips driver/attendant/owner phone)
- **Endpoints rate-limited:** 4 (auth login/refresh, driver location, parent `/children`)
