# Deploy record — `ccb7d12..658f908`

Range from `ccb7d124a1ca852820dbb037d857f98950d56938` (see `deploy-ccb7d12.md`) to `658f908`, the merge of PR #36 into `feat/tracking-security-hardening` (merged 2026-10-25 23:36 UTC).

This record was written from the repository and from externally observable behaviour only. Nothing below was read from the server or the production database. Every field that needs server evidence reads "(รอกรอก)" (to be filled) and must be filled by whoever holds that evidence. "(รอกรอก)" means "not known", not "did not happen".

**Production status of migrations 052/053: (รอกรอก)** — still unconfirmed; see `deploy-ccb7d12.md`.

## Range contents

| PR | Merged | Title |
|---|---|---|
| #36 | 2026-10-25 | fix(auth): tighten routing and participation (`6d9d8c2`) |

Notable change: `backend/src/app.js` mounts `app.use('/api', apiNotFound)` before the production SPA catch-all, so an unknown `/api/...` path returns a JSON 404 (`{ success: false, message: 'Route not found', errors: [], data: null }`) instead of `index.html` with HTTP 200. Covered by `backend/tests/apiNotFound.unit.test.js`.

## Migrations in this range

None. No file under `backend/migrations/` changed between `ccb7d12` and `658f908`.

## External evidence (observed 26 October 2026 / 2569, about 07:45 as reported; time zone not recorded)

Observed from outside the server, by an operator, not by reading the server.

| Observation | What it shows |
|---|---|
| Live entry assets are `index-DLGT_uix.js` and `index-RdVYHY3D.css` | A local `vite build` of `658f908` emits exactly these two names. A build of `ccb7d12` emits `index-Dn49I2eo.js` with the same CSS, so the **JS** name is what distinguishes `658f908`; the CSS alone does not. |
| Unknown `/api/` paths (for example `/api/health`, which does not exist in this code) answer 404 with a JSON body | Matches the `apiNotFound` behaviour added in #36. |

Both point to the `658f908` frontend and backend being live at that time. They do not establish when the deploy ran, who ran it, or whether migrations 052/053 were applied.

## Production operations (UTC)

To be filled from server evidence only. Write "(รอกรอก)" (to be filled) rather than estimate a value.

| Time | Evidence |
|---|---|
| (รอกรอก) | Pre-deploy `/health` commit: (รอกรอก) |
| (รอกรอก) | Deploy lock absent in `deploy-state`: (รอกรอก) |
| (รอกรอก) | Pre-release database backup (file name, verified how): (รอกรอก) |
| (รอกรอก) | SHA-256 of `deploy-state/deploy-backend.sh` matches repo `scripts/deploy-backend.sh`: (รอกรอก) |
| (รอกรอก) | Migration 052 applied (how verified, `schema_migrations` row / DDL comparison): (รอกรอก) |
| (รอกรอก) | Migration 053 applied (how verified, `schema_migrations` row / DDL comparison): (รอกรอก) |
| (รอกรอก) | Backend deploy result (`deploy-history.log` line, server test count): (รอกรอก) |
| (รอกรอก) | Frontend publish result (`DEPLOY_FRONTEND=1`, `dist.prev-*` backup path): (รอกรอก) |
| (รอกรอก) | Post-deploy `/health` commit: (รอกรอก) |
| (รอกรอก) | Post-deploy health smoke (PASS / WARN / FAIL counts): (รอกรอก) |
| (รอกรอก) | `/manual/` and a protected API returning 401: (รอกรอก) |

Deployed commit: (รอกรอก) — external evidence above points to `658f908`
Deploy date: (รอกรอก)
Operator: (รอกรอก)

## Verification limits and remaining work

- The asset and 404 observations are outside-in. They are consistent with `658f908`, but the deployed commit is confirmed only by the server's `/health` and `deploy-history.log`, which are still (รอกรอก).
- Because `658f908` contains the whole `14f30bc..ccb7d12` range, the same evidence suggests that range is live too. That does not change the 052/053 status: `deploy-backend.sh` does not apply migrations.
- No server, database, LINE channel or production data was touched to write this record.

This record is not a PDPA certification or a guarantee that every risk is closed.
