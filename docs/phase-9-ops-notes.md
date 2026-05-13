# Phase 9 Ops Notes

Operational items carried forward from the Pre-Phase 9 disk-pressure incident
on 2026-05-13. None of these are blockers for Phase 9.1 (rate-limit hardening),
but every Phase 9.x sub-task should consider them before introducing new
write/import/export work.

## 1. MySQL `tmpdir` is on the root filesystem

```
mysql> SHOW VARIABLES LIKE 'tmpdir';
+---------------+-------+
| Variable_name | Value |
+---------------+-------+
| tmpdir        | /tmp  |
+---------------+-------+
```

Root fs `/dev/mapper/ubuntu--vg-ubuntu--lv` (11 GB) hit **100% used / 9.5 MB
free** earlier today. When it filled, file-based MySQL temp writes started
emitting `OS errno 28 (No space left on device)` against `/tmp/MYfd=*`, and
the transactions holding those temp files hit `innodb_lock_wait_timeout` (50 s)
on other concurrent queries. 13 lifetime row-lock waits + 3 errno-28 + 4 lock
wait timeouts were captured before backend stabilized (it never crashed —
caught by `errorHandler`).

**Phase 9.x candidates (pick one):**

1. **Expand root LVM** (lowest risk, no MySQL restart):
   ```
   sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv
   sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv
   ```
   Verify free PE in the volume group first: `sudo vgdisplay ubuntu-vg`.

2. **Relocate MySQL `tmpdir`** to a dedicated mount with adequate space and
   add to `/etc/mysql/mysql.conf.d/mysqld.cnf`:
   ```
   [mysqld]
   tmpdir = /var/lib/mysql-tmp
   ```
   Requires a MySQL restart (production impact — schedule in a maintenance
   window).

3. **Add tmpfs `/tmp` with size cap** so spillage hits memory limits early
   instead of saturating root fs. Not recommended unless RAM headroom is
   confirmed (server has 4 GB total per `df` tmpfs sizes).

## 2. System-journal + apt cache pending sudo cleanup

After the Phase 9.1 cleanup, root sits at **1.2 GB free / 89% used**.
Additional cleanup that needs sudo:

```
sudo journalctl --vacuum-size=100M    # frees ~516 MB from /var/log/journal
sudo apt-get clean                    # frees ~200 MB from /var/lib/apt/lists
```

Combined: pushes margin to ~1.9 GB free / ~82% used. Run when a sudo session
is available.

## 3. Automated cache / log rotation absent

There is no periodic cleanup configured. The disk fills slowly from:

| Path                                | Approx size today | Owner       |
|-------------------------------------|------------------:|-------------|
| `/home/schoolbus/.vscode-server`    | 960 MB            | user        |
| `/var/log/journal`                  | 716 MB            | root        |
| `/var/lib/apt/lists`                | 242 MB            | root        |
| `/home/schoolbus/.cache/*`          | (variable)        | user        |
| `/home/schoolbus/.npm/_cacache`     | (regrows)         | user        |

A Phase 9.x candidate is a small systemd-timer or cron job that runs
`journalctl --vacuum-time=14d` + `apt-get autoclean` weekly. Not in scope for
9.1.

## 4. DB user lacks `PROCESS` privilege for live triage

`schoolbus_db@localhost` cannot read `INNODB_TRX`, `data_lock_waits`, or
`SHOW ENGINE INNODB STATUS`. During the 08:14 lock-wait incident this blocked
real-time identification of the holding transaction.

**Phase 9.x candidate:** create a `schoolbus_triage@localhost` role with
`GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'schoolbus_triage'@'localhost'`
and document its password in the operator runbook (not the repo).

## 5. PM2 startup deploy churn

Today's deploy window logged 77 PM2 restarts in the first few minutes after
`pm2 start` (05:30 AM). Each restart completed startup successfully; the
pattern is consistent with PM2 retrying through `npm run build` windows
where `frontend/dist/index.html` was momentarily missing.

**Phase 9.x candidate:** sequence the deploy script so `npm run build`
finishes before the backend is signalled, or replace `pm2 restart`-on-build
with `pm2 reload` after build completion. Not in scope for 9.1.

---

## What Phase 9.1 actually changed (for cross-reference)

- `backend/src/app.js` — added `app.set('trust proxy', 1)` so Express
  resolves `req.ip` correctly behind the Cloudflare + nginx chain.
- `backend/src/routes/driver.routes.js` — the per-driver location rate-limit
  `keyGenerator` now wraps the IP fallback with the library's
  `ipKeyGenerator` helper to handle IPv6 prefixes safely.

These two changes silence ~80 lifetime `express-rate-limit` validation
warnings observed in PM2 logs and harden the rate-limit IP key against
spoofing via direct loopback hits and IPv6 client spoofing. No route, schema,
or RBAC change.

---

# Phase 9.7 Runbook — Triage Role + Disk/Log Rotation

The sections above are historical context. The sections below are the
operator runbook. None of these commands have been executed; they are
templates with placeholders. Run them only with explicit authorization.

## 6. MySQL triage role (recommended)

### 6.1 Why a separate role
The application user `schoolbus_db@localhost` has `ALL PRIVILEGES ON
lampang_bus.*` (database-scoped). It deliberately does **not** hold
global privileges, so it cannot read:

| Diagnostic source | Required privilege |
|---|---|
| `information_schema.INNODB_TRX` | `PROCESS` |
| `SHOW ENGINE INNODB STATUS` | `PROCESS` |
| `SHOW FULL PROCESSLIST` (all users, not just own) | `PROCESS` |
| `performance_schema.data_locks` / `data_lock_waits` | `SELECT ON performance_schema.*` |
| `sys.innodb_lock_waits` (the convenience view) | `SELECT ON sys.*` (and underlying perf-schema) |

During the 2026-05-13 08:14 incident, this gap blocked live identification
of the transaction holding the lock. The fix is a **separate, read-only
triage role** — never used by the app, never logged into via UI.

### 6.2 Create the role (run as MySQL root, in a maintenance window)

```sql
-- Template — replace <TRIAGE_PASSWORD_PLACEHOLDER> with a strong unique
-- password generated at run time. Do not commit the real password.
CREATE USER 'schoolbus_triage'@'localhost'
  IDENTIFIED BY '<TRIAGE_PASSWORD_PLACEHOLDER>';

-- Global privileges — minimal set for live diagnostics.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'schoolbus_triage'@'localhost';

-- Read-only access to performance_schema + sys (already read-only by
-- design; explicit grant lets the role traverse the convenience views).
GRANT SELECT ON performance_schema.* TO 'schoolbus_triage'@'localhost';
GRANT SELECT ON sys.*                TO 'schoolbus_triage'@'localhost';

-- Read-only access to the app schema for cross-referencing trx → table.
GRANT SELECT ON lampang_bus.* TO 'schoolbus_triage'@'localhost';

FLUSH PRIVILEGES;
```

Password storage: keep it **outside the repo**. Suggested locations
(pick one and document chosen path in the operator handover):
- `/root/.schoolbus-triage-credentials` (mode 0600, root-owned), or
- 1Password / Bitwarden vault under "Lampang Bus / MySQL triage", or
- Server's secrets manager (if one is adopted later).

### 6.3 Verify the role works

```bash
# Confirm grants present
mysql -h127.0.0.1 -u'schoolbus_triage' -p'<TRIAGE_PASSWORD>' \
  -e "SHOW GRANTS FOR CURRENT_USER();"

# Should succeed (was previously denied as schoolbus_db)
mysql -h127.0.0.1 -u'schoolbus_triage' -p'<TRIAGE_PASSWORD>' \
  -e "SELECT COUNT(*) AS trx_count FROM information_schema.INNODB_TRX;"
```

### 6.4 Rotation / revocation

```sql
-- Rotate password
ALTER USER 'schoolbus_triage'@'localhost'
  IDENTIFIED BY '<NEW_TRIAGE_PASSWORD>';

-- Remove the role entirely if the gap is closed by other means
DROP USER 'schoolbus_triage'@'localhost';
```

## 7. Live lock-wait diagnostics (as triage role)

Use this when:
- `Innodb_row_lock_current_waits > 0`, or
- backend `errorHandler` logs `Lock wait timeout exceeded`, or
- a long-running transaction is suspected.

```sql
-- 1) Which transactions are currently open?
SELECT trx_id, trx_state, trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_secs,
       trx_rows_locked, trx_isolation_level,
       LEFT(trx_query, 120) AS query_head
FROM   information_schema.INNODB_TRX
ORDER BY trx_started;

-- 2) Who is waiting on whom?  (MySQL 8.0 replacement for INNODB_LOCK_WAITS)
SELECT * FROM performance_schema.data_lock_waits \G

-- 3) Convenience view — one row per waiter with both sides resolved.
SELECT * FROM sys.innodb_lock_waits \G

-- 4) Full InnoDB engine status (deadlock history, semaphores, etc.)
SHOW ENGINE INNODB STATUS \G

-- 5) Kill a confirmed-stuck blocker (extreme — only with operator approval)
--    Get the thread ID from INNODB_TRX.trx_mysql_thread_id, then:
KILL <thread_id>;
```

Counter snapshot for trend monitoring:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
SHOW GLOBAL STATUS LIKE 'Created_tmp%';
SHOW VARIABLES   LIKE 'tmpdir';
SHOW VARIABLES   LIKE 'innodb_lock_wait_timeout';
```

The pre-9.7 baseline (for comparison against future readings) was:

| Metric | Value at 2026-05-13 ~09:30 |
|---|---|
| `Innodb_row_lock_current_waits` | 0 |
| `Innodb_row_lock_waits` (lifetime) | 13 |
| `Innodb_row_lock_time_max` | 50661 ms (= 50 s cap) |
| `Created_tmp_disk_tables` | 4 (since process start) |
| `Created_tmp_files` | 1861 |
| `tmpdir` | `/tmp` |
| `innodb_lock_wait_timeout` | 50 s |

## 8. Disk / log monitoring snapshot

Run as `schoolbus` (no sudo needed):

```bash
# Overall margin
df -hT /
df -ih

# Largest consumers
du -xhd1 /                  2>/dev/null | sort -h | tail -10
du -xhd1 /home/schoolbus    2>/dev/null | sort -h | tail -10
du -xhd1 /var/log           2>/dev/null | sort -h | tail -10

# Journal / apt growth
journalctl --disk-usage             # user-visible portion
du -shx /var/log/journal 2>/dev/null # full system journal (root-readable)
du -shx /var/lib/apt/lists 2>/dev/null

# PM2 logs
du -shx /home/schoolbus/.pm2/logs
ls -lh  /home/schoolbus/.pm2/logs
```

**Healthy ranges (post-Phase-9.2 expansion to 22 GB):**

| Path | Healthy | Warning | Critical |
|---|---|---|---|
| `/` filesystem use% | ≤ 70% | 70-85% | > 85% |
| `/var/log/journal` | ≤ 500 MB | 500 MB – 1 GB | > 1 GB |
| `/var/lib/apt/lists` | ≤ 300 MB | 300-500 MB | > 500 MB |
| `~/.pm2/logs` | ≤ 50 MB | 50-200 MB | > 200 MB |

## 9. Journal + apt rotation policy (recommended)

### 9.1 One-shot cleanup (immediate, run when sudo is available)

```bash
# System journal — keep ~14 days, cap at 200 MB
sudo journalctl --vacuum-time=14d
sudo journalctl --vacuum-size=200M

# apt — clean .deb cache + autoclean obsolete lists
sudo apt-get clean
sudo apt-get autoclean

# Verify
df -h /
sudo du -shx /var/log/journal /var/lib/apt/lists
```

### 9.2 Recurring policy via systemd-timer (recommended over cron)

Two files, install as root:

**`/etc/systemd/system/schoolbus-housekeeping.service`**
```
[Unit]
Description=Lampang Bus System — weekly journal + apt housekeeping
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/journalctl --vacuum-time=14d
ExecStart=/usr/bin/journalctl --vacuum-size=200M
ExecStart=/usr/bin/apt-get -y autoclean
Nice=10
IOSchedulingClass=best-effort
```

**`/etc/systemd/system/schoolbus-housekeeping.timer`**
```
[Unit]
Description=Run schoolbus-housekeeping weekly

[Timer]
OnCalendar=Sun 03:30
Persistent=true
RandomizedDelaySec=15m
Unit=schoolbus-housekeeping.service

[Install]
WantedBy=timers.target
```

Install:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now schoolbus-housekeeping.timer
systemctl list-timers schoolbus-housekeeping.timer
```

Sanity check after the first weekly run:
```bash
journalctl -u schoolbus-housekeeping.service --no-pager | tail
df -h /
```

### 9.3 PM2 log retention

PM2 logs (`~/.pm2/logs/`) were **100 KB total** at the time of writing
— healthy and well-behaved (Phase 9.1's silenced rate-limit warnings
cut log growth substantially). No timer needed today. If they ever
grow past the 200 MB critical threshold, install the bundled
`pm2-logrotate` module (no system sudo needed):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## 10. Emergency ENOSPC checklist

Use this when `df -h /` reports ≥ 95% use, or PM2/MySQL logs surface
`No space left on device` / `errno 28`.

**Step 1 — Confirm scope (read-only, 30 seconds)**
```bash
df -hT
df -ih
journalctl --disk-usage
ls -lh /home/schoolbus/.pm2/logs
du -xhd1 / 2>/dev/null | sort -h | tail -10
```

**Step 2 — Confirm production is still serving**
```bash
curl -sI https://schoolbus.503200.xyz/ | head -2
curl -s http://127.0.0.1:3000/health
pm2 status
```
If the backend is down: `pm2 restart schoolbus-backend --update-env`,
then re-check `/health`.

**Step 3 — Safe user-space cleanup (no sudo)**
```bash
# npm cache — fully regenerable
npm cache clean --force                         # ~190 MB historically

# Stale /tmp files older than 24h (excludes systemd-private / sockets)
find /tmp -xdev -type f -mtime +1 \
  -not -path '/tmp/systemd-private-*' \
  -not -path '/tmp/mcp-*' \
  -not -path '/tmp/claude-*' \
  -not -path '/tmp/vmware-*' \
  -not -path '/tmp/vscode-typescript*' \
  -user schoolbus -print
# If candidates look safe, re-run with -delete instead of -print.

# Stale node-compile-cache for the older Node hash (keep the active hash)
ls /tmp/node-compile-cache/ 2>/dev/null
node -v   # confirm the active version's hash before deleting other dirs

# Old Playwright browser binaries (QA-only, redownloaded on demand)
rm -rf /home/schoolbus/.cache/ms-playwright

# Old VS Code server bin/ versions (NOT the active one)
ACTIVE=$(ps -eo args | grep vscode-server/bin/ | grep -v grep \
         | grep -oE '[a-f0-9]{40}' | sort -u | head -1)
for d in /home/schoolbus/.vscode-server/bin/*; do
  hash="${d##*/}"
  [ "$hash" = "$ACTIVE" ] || echo "STALE: $d"
done
# Remove only entries reported as STALE.
```

**Step 4 — Root-side cleanup (needs sudo)**
```bash
sudo journalctl --vacuum-size=200M    # ~516 MB historical reclaim
sudo apt-get clean                    # ~200 MB historical reclaim
sudo apt-get autoclean
```

**Step 5 — Last-resort: expand LVM (if free PE exists in the VG)**
```bash
sudo vgs ubuntu-vg                                            # check VFree
sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv
sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv              # online grow
df -h /
```

**Step 6 — DO NOT delete**
- `/var/lib/mysql/*` (database files)
- `/home/schoolbus/apps/lampang-bus-system/backend/uploads/*` (driver photos, imports)
- `/home/schoolbus/apps/lampang-bus-system/frontend/dist/*` (live production bundle)
- Any file under `/home/schoolbus/apps/lampang-bus-system/.env`
- Backups under `/home/schoolbus/backups`

**Step 7 — Post-incident**
- File a one-line entry below the running incident log in this doc
  (date, root cause hint, freed-bytes total).
- Re-run Section 8's monitoring snapshot and confirm Healthy ranges.
- If recurrence < 30 days from prior incident, escalate to either
  expand LVM (Section 1) or move MySQL `tmpdir` off `/`.

## 11. Deploy script churn (carry-forward, low priority)

On 2026-05-13 05:30 the PM2 lifetime restart counter reached 77 in the
deploy window. Root cause was `pm2 restart`-while-`npm run build` flap-
ping the static-handler ENOENT briefly. Cosmetic only (each restart
completed startup successfully). Mitigation candidate:

```bash
# In deploy script — wait for dist before signalling
(cd frontend && npm run build) \
  && test -f frontend/dist/index.html \
  && pm2 reload schoolbus-backend --update-env
```

Out of Phase 9.7 scope.

---

*Document updated: 2026-05-13 (Phase 9.7 — operator runbook)*
