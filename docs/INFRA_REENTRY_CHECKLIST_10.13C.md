# Infrastructure Re-Entry Checklist — 10.13C-2 (resume)

Resume points for the two deferred infra items. PM2 ecosystem is already adopted.
No production data is changed by any step here.

## A. Restore-test DB (one privileged step → then a safe drill)

Config is already staged (gitignored): `scripts/restore-test.env` +
`/home/schoolbus/.restore-test.cnf` (chmod 600). The app user has scoped
`ALL PRIVILEGES ON lampang_bus_restore_drill.*` but **no global CREATE**, so a
privileged user must create the DB.

1. ☐ As root/admin MySQL user:
   ```
   CREATE DATABASE lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. ☐ Verify it exists:
   ```
   mysql -e "SHOW DATABASES LIKE 'lampang_bus_restore_drill';"
   ```
3. ☐ Readiness:
   ```
   scripts/restore-test-readiness.sh        # expect READY (exit 0)
   ```
4. ☐ Safe restore drill (**test DB only** — dumps carry no `USE` line, so production is unreachable):
   ```
   DRILL=lampang_bus_restore_drill
   CNF=/home/schoolbus/.restore-test.cnf
   # clean slate (drop any leftover tables in the DRILL DB only)
   mysql --defaults-file="$CNF" "$DRILL" -Nse "SHOW TABLES" | while read t; do mysql --defaults-file="$CNF" "$DRILL" -e "DROP TABLE \`$t\`"; done
   zcat "$(ls -t /home/schoolbus/backups/lampang-bus/*.sql.gz | head -1)" | mysql --defaults-file="$CNF" "$DRILL"
   mysql --defaults-file="$CNF" "$DRILL" -e "SELECT COUNT(*) AS students FROM students; SELECT COUNT(*) AS vehicles FROM vehicles;"
   ```
5. ☐ Verify production counts **unchanged** (query `lampang_bus` separately; must match pre-drill).
6. ☐ Cleanup (optional): drop the drill tables (loop above) so the DB stays empty.
7. ☐ Never run `USE lampang_bus` or restore into `lampang_bus`.

## B. Off-host backup (config → dry-run → cron)

1. ☐ Choose a method and create `scripts/offhost-backup-sync.env` (**chmod 600**, gitignored):
   - rclone: `OFFHOST_BACKUP_METHOD=rclone` + `OFFHOST_RCLONE_REMOTE=remote:path`
   - rsync: `OFFHOST_BACKUP_METHOD=rsync` + `OFFHOST_RSYNC_TARGET=user@host:/path` [+ `OFFHOST_SSH_KEY=/home/schoolbus/.ssh/…`]
2. ☐ `chmod 600 scripts/offhost-backup-sync.env`
3. ☐ Validate: `scripts/check-offhost-backup-config.sh` (exit 0)
4. ☐ Dry-run (uploads nothing): `DRY_RUN=1 scripts/offhost-backup-sync.sh`
5. ☐ Confirm no secrets printed in the output.
6. ☐ Install cron **only after** a clean dry-run:
   ```
   45 2 * * * cd /home/schoolbus/apps/lampang-bus-system && ./scripts/offhost-backup-sync.sh >> /home/schoolbus/logs/offhost-backup.log 2>&1
   ```
7. ☐ After the first real run, confirm the backup appears on the remote and `.last_offhost_sync` is updated.

## C. PM2 (monitor only — already adopted)

- ☐ `pm2 status` — `schoolbus-backend` online, running from `ecosystem.config.js` (`node src/index.js`).
- ☐ Watch `restart_time`; a climbing count signals a crash loop (backoff caps it). Investigate via `pm2 logs schoolbus-backend`.
- ☐ Rollback if ever needed: `pm2 delete schoolbus-backend && cd backend && pm2 start npm --name schoolbus-backend -- start && pm2 save`.
