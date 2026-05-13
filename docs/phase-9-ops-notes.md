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

*Document created: 2026-05-13 (Phase 9.1)*
