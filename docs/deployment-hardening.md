# Deployment Hardening — Phase 10.12H

Audited deployment-level exposure for the Lampang Bus System. This document
records the findings, the one in-app fix applied (CORS allow-list), and the
**operator actions** (system/nginx/firewall) that require `sudo` and are not
performed by the application.

> No secrets or `.env` values are included here.

## Risk classification (as audited)

| Area | State | Notes |
|------|-------|-------|
| MySQL bind | 🟢 GREEN | `bind-address = 127.0.0.1` (config + runtime `ss`); `mysqlx` also 127.0.0.1. Not network-reachable. |
| Adminer | 🟢 GREEN | Not running (no `:8080` listener, no docker containers). The `docker-compose.yml` Adminer/3306 services must **not** be deployed in production. |
| nginx entrypoint | 🟢 GREEN | nginx owns `:80`/`:443`, TLS via certbot, proxies `/api/ → 127.0.0.1:3000` with `Host`/`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`. |
| API security headers | 🟢 GREEN | `helmet()` sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS on `/api` responses. |
| `/uploads` | 🟢 GREEN | App returns 404 (Phase 10.12F); nginx SPA-fallbacks the path (never serves the files). |
| CORS | 🟡→🟢 | Was wildcard `cors()` (no credentials → low risk). **Fixed in app:** production allow-list via `CORS_ORIGINS`. |
| Backend bind | 🟡 YELLOW | Node listens on `0.0.0.0:3000` (all interfaces). Reachable directly if the host firewall allows `:3000`, bypassing nginx/TLS. **Operator action below.** |
| Host firewall | 🟡 UNKNOWN | `ufw` status needs `sudo` — verify `:3000` and `:3306` are not externally reachable. |
| nginx static headers | 🟡 YELLOW | SPA HTML/asset responses (served by nginx, not the backend) lack security headers. Optional `add_header` hardening below. |
| nginx `/uploads` deny | 🟡 YELLOW | No explicit `location /uploads` block (currently SPA-fallbacks). Optional explicit 404 below. |

## In-app fix applied this phase (CORS)

`backend/src/app.js` now restricts cross-origin browser reads in production to
`CORS_ORIGINS` (default: `https://schoolbuslampang.com`,
`https://www.schoolbuslampang.com`, `https://schoolbus.lp-pao.go.th`).
Non-production reflects any origin. Requests without an `Origin` header
(server-to-server: LINE webhook, health checks, monitors) always pass.
Credentials remain off (auth is a Bearer token, not a cookie). The SPA is
same-origin with the API, so legitimate browser traffic is unaffected.

To change the allow-list without a code change, set in `backend/.env`:

```
CORS_ORIGINS=https://schoolbuslampang.com,https://www.schoolbuslampang.com
```

Requires a backend restart to take effect: `pm2 restart schoolbus-backend --update-env`.

## Operator actions (require sudo — NOT performed by the app)

### 1. Bind the backend to loopback (close direct `:3000`)
The backend should only be reachable through nginx. Two options:

- **Firewall (sufficient on its own):** ensure the host firewall denies inbound `:3000` (and `:3306`).
  ```bash
  sudo ufw status verbose          # verify 3000/3306 are NOT allowed inbound
  # if ufw is active and 3000 is open:
  sudo ufw deny 3000/tcp
  sudo ufw deny 3306/tcp
  ```
- **Bind to 127.0.0.1 (defense-in-depth):** set `HOST=127.0.0.1` in `backend/.env` and change the listen call to honor it, e.g. `app.listen(env.app.port, process.env.HOST || undefined, …)`. nginx already proxies to `127.0.0.1:3000`, so this does not affect the public site. Apply as a reviewed code change, then `pm2 restart schoolbus-backend --update-env`. Verify: `ss -lntp | grep :3000` shows `127.0.0.1:3000`.

### 2. (Optional) Explicit nginx `/uploads` deny — defense-in-depth
Add to **both** server blocks (`schoolbus`, `schoolbus-503200` → main `schoolbuslampang.com`):
```nginx
location ^~ /uploads/ { return 404; }
```
Validate and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3. (Optional) Security headers on static (SPA) responses
nginx serves the SPA HTML/assets directly (helmet only covers `/api`). Add inside each main `server { … }`:
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "no-referrer" always;
# add_header Content-Security-Policy "default-src 'self'; ..." always;  # craft to match the SPA
```
Then `sudo nginx -t && sudo systemctl reload nginx`.

### 4. Production docker-compose hygiene
The root `docker-compose.yml` defines an **Adminer** service (`:8080`) and
publishes MySQL `:3306` to the host. It is **not** currently running (the app
uses the system MySQL on `127.0.0.1`). Do **not** run that compose file in
production. If a compose stack is needed, use a production variant that:
- removes the `adminer` service,
- binds MySQL to loopback only: `ports: ["127.0.0.1:3306:3306"]` (or no published port).

## Verification checklist
- [ ] `ss -lntp` → `:3000` is `127.0.0.1` only (or firewall denies external `:3000`)
- [ ] `ss -lntp` → `:3306` is `127.0.0.1` only ✅ (confirmed)
- [ ] no `:8080`/Adminer listener ✅ (confirmed)
- [ ] `sudo ufw status` → 3000/3306 not externally reachable
- [ ] `curl -s https://schoolbuslampang.com/health` → `success:true`
- [ ] CORS: cross-origin browser read from a non-listed origin is blocked; same-origin SPA works
