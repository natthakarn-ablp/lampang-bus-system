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

## 12. Phase 9.15 Health Smoke Script

`scripts/health-smoke.sh` is a read-only, sudo-free post-deploy and
post-incident smoke check. It runs in under a couple of seconds and verifies
the full operator surface: frontend reachability, backend `/health` envelope
(including the Phase 9.14 enrichment), PM2 process state, disk + inode
headroom, MySQL InnoDB lock state via the app DB user, the
`schoolbus-housekeeping.timer` activity, recent critical PM2 log patterns,
and git working-tree cleanliness.

**Usage:**

```bash
cd /home/schoolbus/apps/lampang-bus-system
bash scripts/health-smoke.sh
```

**Exit codes:**

| Exit | Meaning |
|------|---------|
| `0`  | All PASS, or PASS + WARN only |
| `1`  | One or more FAIL |

**Result labels** printed per check: `[PASS]`, `[WARN]`, `[FAIL]`, `[SKIP]`.
A trailing `Summary:` block totals each label and prints one of:

- `HEALTH SMOKE PASSED`
- `HEALTH SMOKE PASSED WITH WARNINGS`
- `HEALTH SMOKE FAILED`

**Thresholds:**

- Disk `/` usage: WARN ≥ 80 %, FAIL ≥ 90 % (same for inodes)
- `Innodb_row_lock_current_waits > 0` → FAIL
- `Innodb_row_lock_waits` lifetime > 0 (no current) → WARN (historical, normal)
- PM2 `online` with uptime < 30 s → WARN (possible flap)
- `/health` `data.commit ≠ git HEAD` → WARN (service needs restart to refresh)

**Safety contract:** no sudo, no service restarts, no DB writes, no file
mutations, no `pm2 flush`, no log truncation. The script only reads. The DB
password is sourced inline via `MYSQL_PWD=` in a subshell and is never
printed. `.claude/settings.json` untracked is downgraded to WARN, not FAIL.

**When to run:**

- After every `pm2 reload` or front-end deploy
- After any disk-pressure remediation (LVM resize, log rotation)
- After any DB schema change
- Periodically (manual or cron) as a coarse production heartbeat

---

## 13. Phase 9.16 Smoke Baseline Constants

The Phase 9.15 smoke script (`scripts/health-smoke.sh`) treats three known
historical signals as `[BASELINE]` rather than `[WARN]`, so a normal run
reports `HEALTH SMOKE PASSED WITH BASELINED OBSERVATIONS` instead of
recurring warnings every time. New incidents that push a metric past its
baseline still surface as `[WARN]` or `[FAIL]`.

### 13.1 Constants

The constants are declared near the top of `scripts/health-smoke.sh`:

| Constant | Default | Meaning |
|---|---|---|
| `BASELINE_INNODB_ROW_LOCK_WAITS` | `16` | Lifetime `Innodb_row_lock_waits` captured at end of the 2026-05-13 disk-pressure incident. Values ≤ this with current waits = 0 are baseline. |
| `BASELINE_PM2_CRITICAL_MATCHES` | `7` | Number of historical critical-pattern matches in `~/.pm2/logs/schoolbus-backend-error.log` (lines 712–718) from the same incident. A count exactly equal to this is baseline. |
| `BASELINE_MYSQL_UPTIME_GUARD_SECONDS` | `86400` (24 h) | If MySQL `Uptime` is below this, the InnoDB baseline is disabled — the counter is fresh and any nonzero value is genuinely new. |

### 13.2 Decision tree — InnoDB row-lock waits

| Condition | Result |
|---|---|
| `current_waits > 0` | `[FAIL]` — active contention |
| `current_waits = 0` AND `lifetime = 0` | `[PASS]` |
| `current_waits = 0` AND MySQL `Uptime < 24h` | `[WARN]` — baseline disabled, counter is fresh |
| `current_waits = 0` AND `lifetime ≤ 16` AND `Uptime ≥ 24h` | `[BASELINE]` |
| `current_waits = 0` AND `lifetime > 16` AND `Uptime ≥ 24h` | `[WARN]` — new contention beyond baseline |

### 13.3 Decision tree — PM2 critical log matches

| Condition | Result |
|---|---|
| 0 matches | `[PASS]` |
| `count == 7` | `[BASELINE]` (historical entries; first 3 shown for traceability) |
| `count < 7` | `[BASELINE]` — logs likely rotated; operator should reset baseline |
| `count > 7` | `[WARN]` — `(count − 7)` new critical entries; last 20 shown |

### 13.4 NOT baselined (still WARN)

- `/health.commit ≠ git HEAD` — service may need restart to pick up new code
- Tracked working-tree modifications — still `[FAIL]`
- Untracked files **other than** `.claude/settings.json` — still `[WARN]`

### 13.5 Reset procedure after operational events

After the following events, the operator should review and adjust the
baseline constants in `scripts/health-smoke.sh`:

- **MySQL restart** — `Innodb_row_lock_waits` resets to 0. The script's
  uptime guard automatically disables the baseline for 24 h. After 24 h, set
  `BASELINE_INNODB_ROW_LOCK_WAITS=0` (or the new clean lifetime value).
- **PM2 log rotation** (e.g., after the housekeeping timer runs) — the
  historical lines 712–718 will be archived. Run the script once; if it
  reports `count < 7`, set `BASELINE_PM2_CRITICAL_MATCHES=0` (or the new
  count if some entries survive in the rotated tail).
- **New incident** — after diagnosing and resolving a real WARN/FAIL, if the
  metric stabilizes at a new higher value, update the baseline upward only
  with explicit reasoning in the commit message.

### 13.6 Known limitation

The script does not fingerprint individual log lines. If exactly 7
historical lines rotate out **and** exactly 7 new critical lines appear
between two runs, the count remains 7 and the script will continue to
report `[BASELINE]`. Mitigation: run the script frequently enough that
single-event deltas are visible (rotation events are weekly; a daily smoke
run will catch the rotation transition the next morning).

---

## 14. Phase 9.17 Health Smoke Watchdog Timer

A systemd timer + oneshot service that runs `scripts/health-smoke.sh`
automatically every 30 minutes, recording each run to the journal. This
is **passive monitoring** — no LINE, email, or webhook alerting is wired
up yet. That gate is deferred to Phase 9.18 so operators can observe
real-world noise levels for a few days first.

### 14.1 Tracked source

| Path | Purpose |
|---|---|
| `ops/systemd/schoolbus-health-smoke.service` | Oneshot service that runs the smoke script as `schoolbus:schoolbus` |
| `ops/systemd/schoolbus-health-smoke.timer`   | Drives the cadence (30 min) |

Installed copies live in `/etc/systemd/system/` and are owned by `root:root`
— never edit them in place. Update the tracked source, re-`sudo install`,
then `sudo systemctl daemon-reload`.

### 14.2 What it does

- `Type=oneshot`, runs once per fire, exits when the script exits.
- Records full smoke output to the systemd journal under the service unit.
- Considered **healthy** when the script exits `0`. The script exits `0`
  on `PASS`, `BASELINE`, and `WARN`. Only `FAIL` (exit `1`) makes the
  service unit "failed".
- This means `[WARN]` observations (e.g., the commit-drift WARN after a
  script/docs-only commit) leave the service `active (exited)` and do
  not produce any alert today.

### 14.3 Schedule

| Trigger | Setting |
|---|---|
| First run after boot | `OnBootSec=5min` (lets nginx/MySQL/PM2 settle) |
| Subsequent runs | `OnUnitActiveSec=30min` |
| Missed-while-off recovery | `Persistent=true` — runs once after boot if a fire-time was missed |

### 14.4 Installation (one-time, requires sudo)

```bash
cd /home/schoolbus/apps/lampang-bus-system
sudo install -m 0644 ops/systemd/schoolbus-health-smoke.service /etc/systemd/system/schoolbus-health-smoke.service
sudo install -m 0644 ops/systemd/schoolbus-health-smoke.timer   /etc/systemd/system/schoolbus-health-smoke.timer
sudo systemctl daemon-reload
sudo systemctl enable --now schoolbus-health-smoke.timer
sudo systemctl start schoolbus-health-smoke.service   # one-shot trial
```

### 14.5 Check status

```bash
systemctl is-active schoolbus-health-smoke.timer
systemctl list-timers --all | grep schoolbus-health-smoke
systemctl status schoolbus-health-smoke.timer --no-pager
systemctl status schoolbus-health-smoke.service --no-pager
```

### 14.6 View logs

```bash
# Last 200 lines of the service's most recent runs:
journalctl -u schoolbus-health-smoke.service --no-pager -n 200

# Follow new runs as they happen:
journalctl -u schoolbus-health-smoke.service -f

# Just the failures, last 7 days:
journalctl -u schoolbus-health-smoke.service --since '7 days ago' -p err
```

### 14.7 Run manually (no sudo required for the script itself)

```bash
bash /home/schoolbus/apps/lampang-bus-system/scripts/health-smoke.sh

# Or via systemctl (uses the unit's User/Env, requires sudo):
sudo systemctl start schoolbus-health-smoke.service
```

### 14.8 Disable / rollback

```bash
sudo systemctl disable --now schoolbus-health-smoke.timer
sudo rm /etc/systemd/system/schoolbus-health-smoke.service
sudo rm /etc/systemd/system/schoolbus-health-smoke.timer
sudo systemctl daemon-reload
```

The repo templates under `ops/systemd/` remain in version control so the
operator can re-install at any time with the Section 14.4 block.

### 14.9 Important behavioral notes

- **No alerts today.** This phase is observation only. Phase 9.18 will
  add alert routing (LINE first, likely conditional on `FAIL`-only) once
  we know the steady-state noise profile.
- **`[WARN]` and `[BASELINE]` are not silent.** They are recorded in the
  journal at info level. Operators should periodically review the journal
  (e.g., weekly) for new WARN patterns even though there is no automated
  page.
- **Commit drift is expected and tolerated.** Until backend is restarted
  after the Phase 9.17 commit lands, every timer fire will record a
  commit-drift `[WARN]`. Service stays healthy because exit code is 0.
- **PM2 logs are read as `schoolbus` user.** That's why the service runs
  as `User=schoolbus, Group=schoolbus` and sets `PM2_HOME=/home/schoolbus/.pm2`.

---

## 15. Phase 9.18 FAIL-only Health Alerting

The Phase 9.17 watchdog records every smoke run to the journal but does
not page anyone. Phase 9.18 adds a separate, opt-in alerter that pushes
a LINE message **only when the smoke exits non-zero**. `[PASS]`,
`[BASELINE]`, and `[WARN]` never trigger an alert; only `[FAIL]` (which
is what makes the smoke script exit `1`) does.

### 15.1 Tracked source

| Path | Purpose |
|---|---|
| `scripts/health-smoke-alert.sh` | Wrapper: runs smoke, sends LINE push on non-zero exit, exits matching the smoke result |
| `ops/systemd/schoolbus-health-alert.service` | Oneshot service that runs the wrapper as `schoolbus:schoolbus`, sources `/etc/schoolbus/health-alert.env` (optional) |
| `ops/systemd/schoolbus-health-alert.timer` | Drives the cadence every 30 min, offset 5 min from the watchdog |

The Phase 9.17 watchdog (`schoolbus-health-smoke.timer/service`) is **not
modified** by this phase. The alerter is a separate unit pair so it can
be disabled without affecting passive monitoring (Option A from the
design choice).

### 15.2 Alert rules

| Smoke exit | Wrapper action | Wrapper exit |
|---|---|---|
| `0` (PASS / BASELINE / WARN) | Print `"No alert sent"` to journal | `0` |
| `1` (FAIL) and creds present | POST to `/v2/bot/message/push`, log delivery result | `1` (delivered) or `2` (HTTP error) |
| `1` (FAIL) and creds missing | Log `"ALERT NOT DELIVERED: missing creds"` | `2` |
| script unrunnable | Log `"FATAL: smoke script not executable"` | `3` |

### 15.3 Protected env file — MUST be created manually in SSH

**Never paste real LINE secrets into chat.** Create the env file directly
on the server:

```bash
sudo mkdir -p /etc/schoolbus
sudo chmod 0755 /etc/schoolbus
sudo chown root:root /etc/schoolbus

# Create the env file — paste real values inline in your editor:
sudo install -m 0640 -o root -g schoolbus /dev/null /etc/schoolbus/health-alert.env
sudo nano /etc/schoolbus/health-alert.env   # or vi / vim
```

Contents (paste the real LINE channel access token and target ID in
place of the angle-bracketed placeholders):

```
# Health-alert push credentials for Lampang Bus System.
# Permissions: root:schoolbus 0640.  NEVER commit to git.
# NEVER paste real values into chat or PR descriptions.

LINE_CHANNEL_ACCESS_TOKEN=<paste your LINE channel access token here>
LINE_TARGET_ID=<paste the user/group/room ID to push to>
```

| Path | Owner | Group | Mode | Why |
|---|---|---|---|---|
| `/etc/schoolbus/` | root | root | 0755 | Standard system-config dir |
| `/etc/schoolbus/health-alert.env` | root | schoolbus | 0640 | Readable by the `schoolbus` user (and root) only |

**LINE_TARGET_ID** must be a user ID (`Uxxxx…`), group ID (`Cxxxx…`), or
room ID (`Rxxxx…`) that the bot has been invited to and is allowed to
push to. It is NOT a display name. The simplest is to create a dedicated
LINE group for ops alerts, invite the bot, and grab the group ID via the
LINE Developers Console or a webhook trace.

### 15.4 Installation (one-time, requires sudo)

After creating the env file (or even before — the unit's
`EnvironmentFile=-` is optional and the wrapper handles missing creds
gracefully):

```bash
cd /home/schoolbus/apps/lampang-bus-system

sudo install -m 0644 ops/systemd/schoolbus-health-alert.service /etc/systemd/system/schoolbus-health-alert.service
sudo install -m 0644 ops/systemd/schoolbus-health-alert.timer   /etc/systemd/system/schoolbus-health-alert.timer

sudo systemctl daemon-reload
sudo systemctl enable --now schoolbus-health-alert.timer

# Optional: one-shot trial run (should say "No alert sent" while smoke is healthy):
sudo systemctl start schoolbus-health-alert.service
journalctl -u schoolbus-health-alert.service --no-pager -n 200
```

### 15.5 Test without sending a real alert

```bash
# Dry run as the schoolbus user. Smoke is currently healthy so this
# should print "No alert sent" and exit 0. Safe to run any time.
bash /home/schoolbus/apps/lampang-bus-system/scripts/health-smoke-alert.sh
echo "exit code: $?"
```

### 15.6 Force a wiring test WITHOUT touching production

```bash
# FORCE_FAIL=1 skips the real smoke and pretends it returned exit 1 with
# a synthetic body. Combined with NO env file (or unset creds), the
# wrapper will print "ALERT NOT DELIVERED: missing creds" and exit 2 —
# proving the FAIL branch is wired without sending any LINE message.
FORCE_FAIL=1 LINE_CHANNEL_ACCESS_TOKEN= LINE_TARGET_ID= \
  bash /home/schoolbus/apps/lampang-bus-system/scripts/health-smoke-alert.sh
echo "exit code: $?"
```

To send a real test alert (only do this when on call, with notification
group on standby — it will produce a LINE notification to whoever is in
the target group/user):

```bash
FORCE_FAIL=1 bash /home/schoolbus/apps/lampang-bus-system/scripts/health-smoke-alert.sh
```

(the env vars will be picked up from `/etc/schoolbus/health-alert.env`
when invoked via `sudo systemctl start schoolbus-health-alert.service`,
not via direct shell run — for a direct shell test with real creds,
`source` the env file beforehand:
`set -a; source /etc/schoolbus/health-alert.env; set +a`)

### 15.7 Status, logs, disable

```bash
# Status / next-fire time:
systemctl is-active schoolbus-health-alert.timer
systemctl list-timers --all | grep schoolbus-health-alert
systemctl status schoolbus-health-alert.timer --no-pager
systemctl status schoolbus-health-alert.service --no-pager

# Last 200 lines from the alerter's runs:
journalctl -u schoolbus-health-alert.service --no-pager -n 200

# Follow:
journalctl -u schoolbus-health-alert.service -f

# Disable alerts (watchdog keeps running):
sudo systemctl disable --now schoolbus-health-alert.timer

# Full rollback (remove unit files too):
sudo systemctl disable --now schoolbus-health-alert.timer
sudo rm /etc/systemd/system/schoolbus-health-alert.service
sudo rm /etc/systemd/system/schoolbus-health-alert.timer
sudo systemctl daemon-reload
# (optional, removes secrets too:)
sudo rm /etc/schoolbus/health-alert.env
```

### 15.8 Important behavioral notes

- **No alerts on WARN/BASELINE.** Operators must still review the
  watchdog journal weekly for new WARN patterns. The Phase 9.17
  watchdog still records every run regardless.
- **Duplicate smoke runs.** Watchdog and alerter both invoke the smoke
  script every 30 min (offset 5 min). This is intentional (Option A) so
  alerting is isolated and easy to disable. The smoke is read-only and
  costs ~3 s of CPU; doubling that is negligible.
- **Token is never echoed, even on errors.** Curl carries it in
  `Authorization: Bearer …` only. If the LINE API echoes any string
  back that happens to contain the token (it won't, but defensive),
  the wrapper redacts it before printing.
- **Missing creds is not a crash.** The unit uses
  `EnvironmentFile=-` so it starts without the file; the wrapper checks
  for empty vars and exits with a "missing creds" message. Until the
  env file is populated, FAIL events log the message but don't push.
- **Do not commit the env file.** `/etc/schoolbus/` is outside the
  repo by design. If you ever copy it accidentally, scrub from history
  immediately and rotate the LINE channel access token.

---

## 16. Phase 9.19 Alert Debounce + Weekly Heartbeat

The Phase 9.18 FAIL-only alerter would push the same LINE message every
30 minutes for an ongoing incident — noisy and easy to ignore. Phase 9.19
adds three things, on top of Phase 9.18, without changing the existing
timers:

- **Debounce.** Identical FAIL signatures within a 6-hour window send only
  one alert. A new signature (different failing checks) breaks the debounce
  and alerts immediately. A persistent failure ≥ 6 h pushes one reminder.
- **Recovery notification.** The first PASS after a previous FAIL sends one
  optional "✅ recovered" message, then the system goes silent again.
- **Weekly heartbeat.** A separate timer pushes one proof-of-life message
  every Monday confirming the alert pipeline still works.

### 16.1 Tracked source

| Path | Purpose |
|---|---|
| `scripts/health-smoke-alert.sh` | Phase 9.18 wrapper, now with debounce + recovery |
| `scripts/health-smoke-heartbeat.sh` | NEW — weekly LINE proof-of-life |
| `ops/systemd/schoolbus-health-heartbeat.service` | Oneshot, runs the heartbeat |
| `ops/systemd/schoolbus-health-heartbeat.timer` | `OnCalendar=Mon 08:00`, Persistent |

Phase 9.17 watchdog (`schoolbus-health-smoke.timer`) and Phase 9.18 alerter
(`schoolbus-health-alert.timer`) remain **unchanged**.

### 16.2 Debounce policy

Constants at the top of `scripts/health-smoke-alert.sh`:

```bash
ALERT_STATE_DIR=/var/lib/schoolbus/health-alert
ALERT_DEBOUNCE_SECONDS=21600       # 6 hours
ALERT_RECOVERY_ENABLED=1
```

Failure signature = SHA-256 of `[FAIL]` lines + summary line from smoke
output (ANSI-stripped, trailing whitespace trimmed). Stable across runs of
the same underlying incident; changes immediately when a different check
fails or counts change.

Decision tree on smoke FAIL:

| Condition | Action | Wrapper exit |
|---|---|---|
| First FAIL after PASS (or no prior state) | Send alert, record state | `1` (sent) / `2` (delivery fail) |
| Same signature, < 6 h since last alert | **Suppress** — log "Duplicate FAIL suppressed by debounce" | `2` |
| Same signature, ≥ 6 h since last alert | Send **reminder** ("still FAILING") | `1` / `2` |
| Different signature | Treat as new incident → send alert immediately | `1` / `2` |
| Delivery failure on a send-decision | Do NOT update `last_alert_time` → next run retries instead of being silenced | `2` |

Decision tree on smoke PASS:

| Prior state | `ALERT_RECOVERY_ENABLED` | Action |
|---|---|---|
| `PASS` or unknown | any | Quiet exit 0 (existing 9.18 behavior) |
| `FAIL` | `1` | Send one ✅ recovery msg, set state to PASS, exit 0 |
| `FAIL` | `0` | No message, set state to PASS, exit 0 |

### 16.3 State directory

```
/var/lib/schoolbus/health-alert/   owner schoolbus:schoolbus, mode 0750
├── last_fail_hash    SHA-256 hex of canonical failing body
├── last_fail_time    epoch seconds (UTC)
├── last_alert_time   epoch seconds of the most recent successful push
└── last_status       "PASS" or "FAIL"
```

State files contain **no secrets** — only hashes, integers, and the literal
strings `PASS`/`FAIL`. They are safe to inspect, copy, or back up. If the
directory is missing or not writable, the wrapper falls back to Phase 9.18
behavior (alert on every FAIL) and prints one `WARN: state dir … not
writable — debounce inactive` line per run.

### 16.4 View / inspect / reset state

```bash
# Inspect (token-free, safe to share):
ls -la /var/lib/schoolbus/health-alert/
for f in /var/lib/schoolbus/health-alert/*; do
  echo "=== $f ==="; cat "$f"; echo
done

# Reset to "no prior incident" (e.g. after handling an outage):
sudo rm -f /var/lib/schoolbus/health-alert/last_fail_hash \
           /var/lib/schoolbus/health-alert/last_fail_time \
           /var/lib/schoolbus/health-alert/last_alert_time \
           /var/lib/schoolbus/health-alert/last_status

# Or just blank "last_status" so the next FAIL alerts immediately:
sudo -u schoolbus tee /var/lib/schoolbus/health-alert/last_status >/dev/null <<< "PASS"
```

### 16.5 Weekly heartbeat

`scripts/health-smoke-heartbeat.sh` sends ONE LINE message per Monday
08:00 UTC (= Monday 15:00 Asia/Bangkok) with:

```
💚 Lampang Bus health heartbeat (weekly)
service: lampang-bus-system
host: schbus
time: <ISO UTC>
git HEAD: <short SHA>
/health.commit: <short SHA from /health>
smoke summary: PASS: N BASELINE: N WARN: N FAIL: N
smoke verdict: HEALTH SMOKE PASSED (WITH …)
disk /: 45% used, 12G avail
```

Behavior:

- Runs `health-smoke.sh` once. If `FAIL`, **heartbeat is skipped** (exit 1)
  so the operator isn't told "everything is fine" mid-incident — the
  alert wrapper handles that case on its own 30-min cycle.
- Missing creds → safe message + exit 2.
- LINE push uses the same `Authorization: Bearer …` pattern as the alerter.
  Token never echoed.

### 16.6 Run heartbeat manually

```bash
# Real push (if env file is readable in your shell):
set -a; sudo cat /etc/schoolbus/health-alert.env > /tmp/he.env && source /tmp/he.env && shred -u /tmp/he.env; set +a
bash /home/schoolbus/apps/lampang-bus-system/scripts/health-smoke-heartbeat.sh

# Or via systemd one-shot (uses the unit's EnvironmentFile cleanly):
sudo systemctl start schoolbus-health-heartbeat.service
journalctl -u schoolbus-health-heartbeat.service --no-pager -n 200
```

### 16.7 Status, logs, disable

```bash
# Status / next-fire:
systemctl is-active schoolbus-health-heartbeat.timer
systemctl list-timers --all | grep schoolbus-health-heartbeat
systemctl status schoolbus-health-heartbeat.timer --no-pager
systemctl status schoolbus-health-heartbeat.service --no-pager

# Logs:
journalctl -u schoolbus-health-heartbeat.service --no-pager -n 200
journalctl -u schoolbus-health-alert.service --no-pager -n 200
journalctl -u schoolbus-health-smoke.service --no-pager -n 200

# Disable heartbeat (alerter + watchdog unaffected):
sudo systemctl disable --now schoolbus-health-heartbeat.timer

# Disable alerter (watchdog + heartbeat unaffected):
sudo systemctl disable --now schoolbus-health-alert.timer

# Disable everything Phase 9.18+9.19 (passive watchdog still runs):
sudo systemctl disable --now schoolbus-health-alert.timer schoolbus-health-heartbeat.timer
```

### 16.8 Full installation (one-time, requires sudo)

```bash
cd /home/schoolbus/apps/lampang-bus-system

# State directory for debounce
sudo mkdir -p /var/lib/schoolbus/health-alert
sudo chown schoolbus:schoolbus /var/lib/schoolbus/health-alert
sudo chmod 750 /var/lib/schoolbus/health-alert

# Heartbeat unit pair
sudo install -m 0644 ops/systemd/schoolbus-health-heartbeat.service /etc/systemd/system/schoolbus-health-heartbeat.service
sudo install -m 0644 ops/systemd/schoolbus-health-heartbeat.timer   /etc/systemd/system/schoolbus-health-heartbeat.timer
sudo systemctl daemon-reload
sudo systemctl enable --now schoolbus-health-heartbeat.timer

# Optional one-shot trial runs
sudo systemctl start schoolbus-health-alert.service       # exercises the debounce path
sudo systemctl start schoolbus-health-heartbeat.service   # sends one real heartbeat
journalctl -u schoolbus-health-alert.service --no-pager -n 200
journalctl -u schoolbus-health-heartbeat.service --no-pager -n 200
```

The alerter script is updated in place via the Phase 9.19 commit; no
re-install is needed for that file because it lives under `scripts/`
and is owned by `schoolbus`.

### 16.9 Important behavioral notes

- **WARN/BASELINE still produce no alert.** Debounce and recovery operate
  only on the smoke FAIL/PASS transition. The Phase 9.16 baselines remain
  the gate that keeps the steady state silent.
- **State dir missing ≠ outage.** If `/var/lib/schoolbus/health-alert/` is
  removed or unwritable, the alerter falls back to Phase 9.18 behavior
  (alert on every FAIL). One `WARN` line is logged per run so operators
  can tell debounce is inactive.
- **Delivery failures don't burn the debounce window.** A 401/timeout
  doesn't update `last_alert_time`, so the next run retries instead of
  being silenced for 6 hours.
- **Reminder cadence.** A long-running incident pushes once when first
  detected, then again every ~6 hours. Tune via `ALERT_DEBOUNCE_SECONDS`
  if 6 h is wrong for your on-call rotation.
- **Heartbeat is silent during incidents.** A Monday 08:00 fire that lands
  on a FAIL state exits non-zero and pushes no message. Combined with the
  alerter's reminder cadence, the operator sees the incident, not a
  conflicting "all good" message.
- **No new secrets.** Heartbeat and alerter share the same
  `/etc/schoolbus/health-alert.env` from Phase 9.18. Nothing new to rotate.

---

*Document updated: 2026-05-14 (Phase 9.19 — alert debounce + weekly heartbeat)*
