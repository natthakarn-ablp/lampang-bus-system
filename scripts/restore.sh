#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Lampang Bus System — Production Restore Script
# Usage: bash scripts/restore.sh <backup-dir>
# Example: bash scripts/restore.sh /home/schoolbus/backups/backup-20260410
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

BACKUP_DIR="${1:?Usage: bash scripts/restore.sh <backup-dir>}"
APP_DIR="/home/schoolbus/apps/lampang-bus-system"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup directory not found: $BACKUP_DIR"
  exit 1
fi

if [ ! -f "$BACKUP_DIR/database.sql" ]; then
  echo "ERROR: database.sql not found in $BACKUP_DIR"
  exit 1
fi

# Load DB credentials from current .env (or backup .env)
ENV_FILE="$APP_DIR/backend/.env"
[ ! -f "$ENV_FILE" ] && ENV_FILE="$BACKUP_DIR/backend.env"
DB_USER=$(grep -oP '^DB_USER=\K.*' "$ENV_FILE")
DB_PASS=$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE")
DB_NAME=$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE")
DB_HOST=$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" || echo localhost)
DB_PORT=$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" || echo 3306)

# Stage credentials in a private defaults-extra-file so the password
# never appears on the mysql command line or in /proc/<pid>/environ.
MYSQL_DEFAULTS_FILE="$(mktemp -t lampang_bus_restore.XXXXXX)"
chmod 600 "$MYSQL_DEFAULTS_FILE"
trap 'rm -f "$MYSQL_DEFAULTS_FILE" 2>/dev/null || true' EXIT INT TERM
cat > "$MYSQL_DEFAULTS_FILE" <<EOF
[client]
host=${DB_HOST}
port=${DB_PORT}
user=${DB_USER}
password=${DB_PASS}
EOF
unset DB_PASS

echo "╔══════════════════════════════════════╗"
echo "║  Lampang Bus System — Restore        ║"
echo "╚══════════════════════════════════════╝"
echo "Source: $BACKUP_DIR"
echo "DB:     $DB_NAME"
echo ""
echo "⚠️  This will OVERWRITE the current database."
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# 1. Stop backend
echo ""
echo "[1/5] Stopping backend..."
pm2 stop schoolbus-backend 2>/dev/null || true
sleep 1

# 2. Restore database
echo "[2/5] Restoring database..."
mysql --defaults-extra-file="$MYSQL_DEFAULTS_FILE" "$DB_NAME" < "$BACKUP_DIR/database.sql" 2>/dev/null
echo "  → database restored"

# 3. Restore .env if needed
echo "[3/5] Checking .env..."
if [ -f "$BACKUP_DIR/backend.env" ] && [ ! -f "$APP_DIR/backend/.env" ]; then
  cp "$BACKUP_DIR/backend.env" "$APP_DIR/backend/.env"
  echo "  → .env restored from backup"
else
  echo "  → .env already present (kept current)"
fi

# 4. Restore uploads if present
echo "[4/5] Restoring uploads..."
if [ -f "$BACKUP_DIR/uploads.tar.gz" ]; then
  tar xzf "$BACKUP_DIR/uploads.tar.gz" -C "$APP_DIR/backend/"
  echo "  → uploads restored"
else
  echo "  → (no uploads in backup)"
fi

# 5. Start backend
echo "[5/5] Starting backend..."
pm2 start schoolbus-backend 2>/dev/null || pm2 start npm --name schoolbus-backend --cwd "$APP_DIR/backend" -- start
sleep 2
pm2 list | grep schoolbus

echo ""
echo "═══ Restore complete ═══"
echo ""
echo "Next steps:"
echo "  1. Run smoke test:  bash scripts/smoke-test.sh"
echo "  2. Check logs:      pm2 logs schoolbus-backend --lines 10"
echo "  3. Verify frontend: curl -sI https://schoolbuslampang.com/"
