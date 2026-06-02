# Operations — Backup & Restore Procedure

> ระบบรถรับส่งนักเรียนจังหวัดลำปาง — production ops runbook
> Last updated: Phase 10.10D/E (2026-06-02)

---

## 1. Backup schedule

| Item | Value |
|---|---|
| Database | `lampang_bus` (MySQL 8.0 on `127.0.0.1:3306`) |
| Schedule | Daily 02:30 Asia/Bangkok |
| Script | [`scripts/backup-db.sh`](../scripts/backup-db.sh) |
| Backup directory | `/home/schoolbus/backups/lampang-bus/` (mode 700, outside repo) |
| Filename pattern | `lampang_bus_YYYYmmdd_HHMMSS.sql.gz` (mode 600) |
| Checksum sidecar | `…sql.gz.sha256` (mode 600) |
| Retention | **7 days** — older files auto-deleted at next run |
| Compression | gzip, `--single-transaction --quick --routines --triggers --events --no-tablespaces` |
| Credentials | Read from `backend/.env`; passed via mode-600 temp `defaults-extra-file` (cleaned on exit). Never on argv. |
| Log | Cron appends to `/home/schoolbus/backups/lampang-bus/backup.log` |

Operator crontab (active):
```
CRON_TZ=Asia/Bangkok
30 2 * * * /home/schoolbus/apps/lampang-bus-system/scripts/backup-db.sh \
  >> /home/schoolbus/backups/lampang-bus/backup.log 2>&1
```

---

## 2. Manual backup

```bash
cd /home/schoolbus/apps/lampang-bus-system
./scripts/backup-db.sh
```

Expected output (last lines):
```
[backup-db] OK   /home/schoolbus/backups/lampang-bus/lampang_bus_YYYYmmdd_HHMMSS.sql.gz (NNNK)
[backup-db] sha  /home/schoolbus/backups/lampang-bus/lampang_bus_YYYYmmdd_HHMMSS.sql.gz.sha256
[backup-db] retention=7d  kept=N  removed_dumps=N  removed_sums=N
[backup-db] YYYY-mm-ddTHH:MM:SS+00:00 done
```

---

## 3. Verify a backup

```bash
cd /home/schoolbus/backups/lampang-bus
LATEST=$(ls -1t lampang_bus_*.sql.gz | head -1)
sha256sum -c "$LATEST.sha256"   # → "$LATEST: OK"
gzip -t "$LATEST"                # silent on success
zcat "$LATEST" | head -5         # MySQL dump header should appear
```

---

## 4. Restore drill (test database only — NEVER over production)

The restore drill loads a backup into an **isolated test database**
`lampang_bus_restore_drill` so we can prove the dump is restorable
without ever touching `lampang_bus`.

### 4.1 One-time prerequisite — grant CREATE on the drill DB

The application user `schoolbus_db` only has privileges on `lampang_bus.*`,
so it cannot create the drill database. The DB admin must run **once**:

```sql
-- Run as MySQL root / admin
GRANT ALL PRIVILEGES ON `lampang_bus_restore_drill`.* TO 'schoolbus_db'@'localhost';
GRANT CREATE, DROP ON *.* TO 'schoolbus_db'@'localhost';
FLUSH PRIVILEGES;
```

> If a tighter privilege model is required, alternatives are:
> (a) a dedicated `schoolbus_drill` MySQL user with `CREATE, DROP` only,
> or (b) the admin pre-creates an empty `lampang_bus_restore_drill` and
> grants `ALL` on it; the script's `DROP DATABASE IF EXISTS` will then
> work because the user owns the drill DB.

### 4.2 Run the drill

```bash
cd /home/schoolbus/apps/lampang-bus-system

# Use the latest backup
./scripts/restore-drill-db.sh

# Or pin a specific file
./scripts/restore-drill-db.sh /home/schoolbus/backups/lampang-bus/lampang_bus_YYYYmmdd_HHMMSS.sql.gz
```

The script:
1. Refuses to target `lampang_bus`, `mysql`, `information_schema`,
   `performance_schema`, `sys`, or `production`.
2. Verifies `sha256sum -c` and `gzip -t` on the dump.
3. `DROP DATABASE IF EXISTS lampang_bus_restore_drill` then `CREATE DATABASE … utf8mb4`.
4. Streams `gunzip -c | mysql … lampang_bus_restore_drill`.
5. Prints restored vs production table count and key-table row counts:
   `users, schools, students, vehicles, parents, line_users,
   line_bindings, notifications, checkin_logs, daily_status, emergency_logs`.

Production DB **is never modified** by this script.

### 4.3 Cleanup

The test DB is **kept** after the drill so the operator can inspect it.
To remove it:

```bash
LATEST=$(ls -1t /home/schoolbus/backups/lampang-bus/lampang_bus_*.sql.gz | head -1)
CLEAN_RESTORE_DRILL=1 ./scripts/restore-drill-db.sh "$LATEST"
```

The cleanup branch drops only `lampang_bus_restore_drill`.

### 4.4 Safety warning

🚫 **NEVER** run the restore drill with `RESTORE_DB=lampang_bus` — the
script will refuse, but do not work around the guard. Production
restore is a separate, deliberately-manual operation that should
involve `pm2 stop schoolbus-backend` and the legacy
[`scripts/restore.sh`](../scripts/restore.sh) with operator confirmation.

---

## 5. Health & backup monitor

Script: [`scripts/health-check.sh`](../scripts/health-check.sh)

Checks:
1. `/health` returns `success=true` with `database.connected=true`
2. `/health` reports a non-empty commit
3. Latest backup file exists in `BACKUP_DIR`
4. Latest backup age ≤ `BACKUP_MAX_AGE_HOURS` (default 36)
5. Latest backup sha256 verifies
6. Disk use on `/` < `DISK_THRESHOLD` (default 85%)
7. PM2 `schoolbus-backend` status = `online`
8. PM2 `pm2-logrotate` status = `online` (warn-only if missing)

Exit codes: `0` = all pass, `1` = one or more critical fail.

Run manually:
```bash
./scripts/health-check.sh
```

Cron (every 5 minutes, logs to `health-check.log`):
```
*/5 * * * * /home/schoolbus/apps/lampang-bus-system/scripts/health-check.sh \
  >> /home/schoolbus/backups/lampang-bus/health-check.log 2>&1
```

---

## 6. Inspecting the operator crontab

```bash
crontab -l
```

Expected entries:
- `CRON_TZ=Asia/Bangkok`
- `30 2 * * *` — daily DB backup
- `*/5 * * * *` — health check

---

## 7. Off-host backup

### 7.1 Why

Daily backups currently live on the same VPS as the production
database. A disk-loss / VM-loss event would destroy both at once.
Off-host sync mitigates that single point of failure by replicating
the latest dump + checksum to an independent location.

### 7.2 Script

[`scripts/offhost-backup-sync.sh`](../scripts/offhost-backup-sync.sh)

The script:
1. Verifies the local sha256 and gzip of the latest backup **before**
   it tries to upload anything.
2. Uploads **only** `lampang_bus_*.sql.gz` + `lampang_bus_*.sql.gz.sha256`.
   Logs, `.env`, partial dumps, and the sync marker file are
   explicitly excluded by include/exclude filters.
3. Supports two transport methods (pick one):
   - **rclone** — for cloud object storage (S3, B2, GDrive, …)
   - **rsync over SSH** — for a second host you own
4. Supports `DRY_RUN=1` to preview without writing.
5. On a real (non-dry-run) success, writes a timestamp marker at
   `/home/schoolbus/backups/lampang-bus/.last_offhost_sync`
   for future health-check integration.

### 7.3 Configure

Copy the template and edit (the real file is **gitignored by
convention**: do not commit):
```bash
cp scripts/offhost-backup-sync.env.example scripts/offhost-backup-sync.env
chmod 600 scripts/offhost-backup-sync.env
$EDITOR scripts/offhost-backup-sync.env
```

Pick **one** method:

**Method A — rclone (recommended for cloud):**
```bash
sudo apt-get install -y rclone
rclone config   # interactively configure a remote, e.g. "lampang-s3"
```
Then in `scripts/offhost-backup-sync.env`:
```
OFFHOST_BACKUP_METHOD=rclone
OFFHOST_RCLONE_REMOTE=lampang-s3:lampang-bus-backups/database
```

**Method B — rsync over SSH (recommended for a second VPS):**
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/offhost_id_ed25519 -C "lampang-bus-backup"
# Then add ~/.ssh/offhost_id_ed25519.pub to the remote host's
# ~backup-user/.ssh/authorized_keys (e.g. via ssh-copy-id).
```
Then in `scripts/offhost-backup-sync.env`:
```
OFFHOST_BACKUP_METHOD=rsync
OFFHOST_RSYNC_TARGET=backup-user@backup.example.com:/srv/lampang-bus-backups
OFFHOST_SSH_KEY=/home/schoolbus/.ssh/offhost_id_ed25519
```

### 7.4 Dry-run

```bash
DRY_RUN=1 ./scripts/offhost-backup-sync.sh
```

Expected output ends with `done` and (for rsync) lists the files
that *would* be transferred. No marker file is written on dry-run.

### 7.5 Real sync

```bash
./scripts/offhost-backup-sync.sh
```

### 7.6 Verify remote

For rclone:
```bash
rclone ls "$OFFHOST_RCLONE_REMOTE" --include "lampang_bus_*.sql.gz"
```
For rsync:
```bash
ssh -i "$OFFHOST_SSH_KEY" "$OFFHOST_RSYNC_TARGET%%:*" \
    "ls -lh ${OFFHOST_RSYNC_TARGET#*:}"
```

Always verify the remote checksum sidecar matches the local one;
if it doesn't, do **not** delete the local copy.

### 7.7 Recommended cron schedule

Add to `crontab -e` **only after a real sync has succeeded**:
```
# Lampang Bus off-host backup sync (Phase 10.10F) — runs 15 min after local backup
45 2 * * * /home/schoolbus/apps/lampang-bus-system/scripts/offhost-backup-sync.sh \
  >> /home/schoolbus/backups/lampang-bus/offhost-sync.log 2>&1
```

### 7.8 What must NOT be uploaded

The include/exclude filters in the script enforce this, but as a
checklist:
- `backend/.env` or any other `.env*` file
- `backup.log`, `health-check.log`, `offhost-sync.log`
- Any screenshot or UAT artifact
- SSH private keys
- The PM2 dump.pm2 file
- `node_modules/`, `.git/`

Only `lampang_bus_*.sql.gz` and the matching `.sha256` sidecar
should cross the network.

### 7.9 Restore flow from an off-host copy

```bash
# 1. Pull the artifacts back to a fresh host
rclone copy "$OFFHOST_RCLONE_REMOTE/lampang_bus_YYYYmmdd_HHMMSS.sql.gz"        ./
rclone copy "$OFFHOST_RCLONE_REMOTE/lampang_bus_YYYYmmdd_HHMMSS.sql.gz.sha256" ./

# 2. Verify
sha256sum -c lampang_bus_YYYYmmdd_HHMMSS.sql.gz.sha256
gzip -t      lampang_bus_YYYYmmdd_HHMMSS.sql.gz

# 3. Drill into the test DB (NEVER over lampang_bus)
./scripts/restore-drill-db.sh /path/to/lampang_bus_YYYYmmdd_HHMMSS.sql.gz
```

---

## 8. Operator checklist after a restore drill

- [ ] Drill exited 0
- [ ] Restored table count matches production table count
- [ ] Key row counts (`students`, `vehicles`, `checkin_logs`) look reasonable
  (a small lag vs production is expected when the dump is a few hours old)
- [ ] `curl -s http://127.0.0.1:3000/health` still returns `success=true`
  with the same `commit` as before the drill (no app restart was performed)
- [ ] `pm2 list` still shows `schoolbus-backend` online with 0 restarts
- [ ] If drill DB is no longer needed, run cleanup (§4.3)
