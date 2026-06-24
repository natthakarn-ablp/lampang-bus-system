# Production DB Recovery — 2026-06-23

## สถานะปัจจุบัน

- Production app ยังเปิดหน้าเว็บได้ แต่ฐานข้อมูลหลัก `lampang_bus` บน Production เคยพบว่าไม่มีอยู่แล้ว
- อาการใน backend log ที่บันทึกไว้ในเอกสารก่อนหน้า: `Unknown database 'lampang_bus'`
- จากเครื่อง local นี้ SSH เข้า Production โดยตรงไม่ได้:
  - `schoolbus@ssh.schoolbus.lp-pao.go.th` → `Permission denied`
  - `root@ssh.schoolbus.lp-pao.go.th` → `Permission denied`
  - `schoolbus@openclaw.srv1068766.hstgr.cloud` → `Permission denied`
  - `root@openclaw.srv1068766.hstgr.cloud` → `Permission denied`
- ดังนั้นขั้นตอนด้านล่างต้องรันใน terminal ที่ SSH เข้า Production ได้แล้ว

## Recovery candidate ที่ตรวจแล้วบน local

ไฟล์ local:

```text
E:\private-lampang-bus-data\production-clone\lampang_bus_20260622_090627.sql.gz
E:\private-lampang-bus-data\production-clone\lampang_bus_20260622_090627.sql.gz.sha256
```

ผลตรวจบน local:

```text
sha256_ok=true
sha256=30632A52AD57DFF278CD3F79D9BFB61C7732CE497F3DF70F9F479E7EFC9C5446
gzip=OK
dump CREATE TABLE=38
dump INSERT tables=33
```

Restore drill ลงฐาน local ชั่วคราว `lampang_bus_recovery_verify_20260623` ผ่าน:

```text
tables=38
schools=121
users=359
students=1692
vehicles=210
drivers=194
driver_vehicle_assignments=212
daily_status=249
schema_migrations=31
mysqlcheck=OK
```

หลัง restore เข้า Production แล้ว ตัวเลขก่อนรัน migration 038/039 ควรตรงกับชุดนี้

## คำสั่งสำหรับรันบน Production

> รันจาก shell บน Production เท่านั้น ห้ามรันจากเครื่อง local

### 1. เก็บหลักฐานก่อน restore

```bash
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
BACKUP_DIR="/home/schoolbus/backups/lampang-bus"
LOG_DIR="/home/schoolbus/logs"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$LOG_DIR" "$BACKUP_DIR"

{
  echo "time=$(date -Is)"
  echo "host=$(hostname)"
  echo "whoami=$(whoami)"
  echo "app_dir=$APP_DIR"
  pm2 status || true
  systemctl status mysql --no-pager || true
  sudo mysql -Nse "SHOW DATABASES LIKE 'lampang_bus';" || true
} | tee "$LOG_DIR/prod-db-recovery-precheck-$STAMP.log"

sudo journalctl -u mysql --since '2026-06-22 08:00:00' --no-pager \
  > "$LOG_DIR/mysql-incident-$STAMP.log" || true

pm2 logs schoolbus-backend --lines 500 --nostream \
  > "$LOG_DIR/backend-incident-$STAMP.log" || true
```

ถ้ายังไม่มี VPS snapshot จาก provider ให้ทำ snapshot ก่อนขั้นต่อไป

### 2. ตรวจ backup บน Production

```bash
set -euo pipefail

cd /home/schoolbus/backups/lampang-bus
ls -lh lampang_bus_20260622_090627.sql.gz lampang_bus_20260622_090627.sql.gz.sha256
sha256sum -c lampang_bus_20260622_090627.sql.gz.sha256
gzip -t lampang_bus_20260622_090627.sql.gz
```

ต้องเห็นผลว่า sha256 และ gzip ผ่านก่อนทำข้อถัดไป

### 3. Restore ลงฐานกู้คืนแยกก่อน

```bash
set -euo pipefail

RECOVERY_DB="lampang_bus_recovery_20260623"
DUMP="/home/schoolbus/backups/lampang-bus/lampang_bus_20260622_090627.sql.gz"

pm2 stop schoolbus-backend || true

sudo mysql -e "
DROP DATABASE IF EXISTS \`$RECOVERY_DB\`;
CREATE DATABASE \`$RECOVERY_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"

zcat "$DUMP" | sudo mysql "$RECOVERY_DB"

sudo mysql -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RECOVERY_DB';"
sudo mysql -t "$RECOVERY_DB" -e "
SELECT 'schools' table_name, COUNT(*) rows_count FROM schools
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'vehicles', COUNT(*) FROM vehicles
UNION ALL SELECT 'drivers', COUNT(*) FROM drivers
UNION ALL SELECT 'driver_vehicle_assignments', COUNT(*) FROM driver_vehicle_assignments
UNION ALL SELECT 'daily_status', COUNT(*) FROM daily_status
UNION ALL SELECT 'schema_migrations', COUNT(*) FROM schema_migrations;
"
mysqlcheck --check "$RECOVERY_DB" | tee "/home/schoolbus/logs/mysqlcheck-$RECOVERY_DB-$(date +%Y%m%d_%H%M%S).log"
```

ต้องได้:

```text
tables=38
schools=121
users=359
students=1692
vehicles=210
drivers=194
driver_vehicle_assignments=212
daily_status=249
schema_migrations=31
mysqlcheck ทุก table = OK
```

ถ้าตัวเลขไม่ตรง ให้หยุดและอย่า restore เข้า `lampang_bus`

### 4. Restore เข้า canonical database name

```bash
set -euo pipefail

DUMP="/home/schoolbus/backups/lampang-bus/lampang_bus_20260622_090627.sql.gz"

EXISTS="$(sudo mysql -Nse "SHOW DATABASES LIKE 'lampang_bus';")"
if [ -n "$EXISTS" ]; then
  echo "ABORT: database lampang_bus already exists. Inspect before restoring." >&2
  exit 2
fi

sudo mysql -e "CREATE DATABASE lampang_bus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat "$DUMP" | sudo mysql lampang_bus

sudo mysql -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='lampang_bus';"
sudo mysql -t lampang_bus -e "
SELECT 'schools' table_name, COUNT(*) rows_count FROM schools
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'vehicles', COUNT(*) FROM vehicles
UNION ALL SELECT 'drivers', COUNT(*) FROM drivers
UNION ALL SELECT 'driver_vehicle_assignments', COUNT(*) FROM driver_vehicle_assignments
UNION ALL SELECT 'daily_status', COUNT(*) FROM daily_status
UNION ALL SELECT 'schema_migrations', COUNT(*) FROM schema_migrations;
"
mysqlcheck --check lampang_bus | tee "/home/schoolbus/logs/mysqlcheck-lampang_bus-$(date +%Y%m%d_%H%M%S).log"
```

### 5. ตรวจสิทธิ์ app user และ restart backend

```bash
set -euo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
DB_USER="$(grep -oP '^DB_USER=\K.*' "$APP_DIR/backend/.env" | head -1)"
DB_NAME="$(grep -oP '^DB_NAME=\K.*' "$APP_DIR/backend/.env" | head -1)"

echo "DB_NAME=$DB_NAME"
echo "DB_USER=$DB_USER"

if [ "$DB_NAME" != "lampang_bus" ]; then
  echo "ABORT: backend/.env DB_NAME is not lampang_bus" >&2
  exit 2
fi

sudo mysql -e "SHOW GRANTS FOR '$DB_USER'@'localhost';" \
  || sudo mysql -e "SHOW GRANTS FOR '$DB_USER'@'%';"

pm2 restart schoolbus-backend --update-env
sleep 3
curl -fsS http://127.0.0.1:3000/health
pm2 logs schoolbus-backend --lines 80 --nostream | tail -80
```

ผลที่ต้องเห็น:

- `/health` คืน JSON
- `data.database.connected` เป็น `true`
- log ใหม่ไม่มี `Unknown database 'lampang_bus'`

## หลังระบบกลับมา

1. ทำ fresh backup ใหม่ทันที:

   ```bash
   cd /home/schoolbus/apps/lampang-bus-system
   ./scripts/backup-db.sh
   ```

2. ยังไม่รัน migration 038/039 และยังไม่ deploy code ใหม่จนกว่าจะตรวจ health, login smoke, และ backup หลัง recovery ผ่าน
3. บันทึก incident report:
   - first known `Unknown database`
   - backup time: 2026-06-22 09:06 UTC / 16:06 เวลาไทย
   - cutover time
   - RPO โดยประมาณ
   - root cause ถ้ายังไม่มีหลักฐานให้เขียนว่า `ยังสรุปสาเหตุไม่ได้จากหลักฐานที่มี`
