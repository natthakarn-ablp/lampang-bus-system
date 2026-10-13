#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Lampang Bus System — Production Backup Script
# Usage: bash scripts/backup.sh [tag]
# Example: bash scripts/backup.sh pre-deploy-v2
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
umask 077

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
BACKUP_BASE="/home/schoolbus/backups"
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_DIR="$BACKUP_BASE/backup-$TAG"

# Same dedicated backup actor as backup-db.sh; explicit ENV_FILE takes priority.
DB_BACKUP_ENV_FILE="${DB_BACKUP_ENV_FILE:-/home/schoolbus/.config/schoolbus/db-backup.env}"
if [ "${ENV_FILE+x}" != x ]; then
  if [ -e "$DB_BACKUP_ENV_FILE" ] || [ -L "$DB_BACKUP_ENV_FILE" ]; then
    ENV_FILE="$DB_BACKUP_ENV_FILE"
  else
    ENV_FILE="$APP_DIR/backend/.env"
  fi
fi
[ -f "$ENV_FILE" ] && [ -r "$ENV_FILE" ] || { echo 'ERROR: backup credential file unavailable' >&2; exit 1; }
DB_USER=$(grep -oP '^DB_USER=\K.*' "$ENV_FILE")
DB_PASS=$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE")
DB_NAME=$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE")
DB_HOST=$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" || echo localhost)
DB_PORT=$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" || echo 3306)

# Stage the MySQL password in a private defaults-extra-file so it
# never appears on the mysqldump command line or in /proc/<pid>/environ.
MYSQL_DEFAULTS_FILE="$(mktemp -t lampang_bus_backup.XXXXXX)"
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
echo "║  Lampang Bus System — Backup         ║"
echo "╚══════════════════════════════════════╝"
echo "Tag:    $TAG"
echo "Target: $BACKUP_DIR"
echo ""

mkdir -p "$BACKUP_DIR"

# 1. Database
echo "[1/5] Backing up MySQL database..."
mysqldump --defaults-extra-file="$MYSQL_DEFAULTS_FILE" --single-transaction --quick \
  --routines --triggers --events --no-tablespaces "$DB_NAME" > "$BACKUP_DIR/database.sql"
DB_SIZE=$(wc -c < "$BACKUP_DIR/database.sql")
echo "  → database.sql ($DB_SIZE bytes)"

# 2. Backend .env
echo "[2/5] Backing up backend .env..."
cp "$APP_DIR/backend/.env" "$BACKUP_DIR/backend.env"
echo "  → backend.env"

# 3. Uploads directory
echo "[3/5] Backing up uploads..."
if [ -d "$APP_DIR/backend/uploads" ] && [ "$(ls -A "$APP_DIR/backend/uploads" 2>/dev/null)" ]; then
  tar czf "$BACKUP_DIR/uploads.tar.gz" -C "$APP_DIR/backend" uploads/
  echo "  → uploads.tar.gz"
else
  echo "  → (empty/skipped)"
fi

# 4. PM2 process metadata
echo "[4/5] Saving PM2 metadata..."
pm2 save 2>/dev/null
pm2 prettylist > "$BACKUP_DIR/pm2-processes.json" 2>/dev/null
echo "  → pm2-processes.json"

# 5. Nginx config (requires sudo — skip if not available)
echo "[5/5] Backing up Nginx config..."
if sudo -n cp /etc/nginx/sites-available/schoolbus-503200 "$BACKUP_DIR/nginx.conf" 2>/dev/null; then
  echo "  → nginx.conf"
else
  echo "  → (skipped — needs sudo)"
fi

echo ""
echo "═══ Backup complete ═══"
echo "Location: $BACKUP_DIR"
ls -lh "$BACKUP_DIR/"
echo ""
echo "Git state: $(git -C "$APP_DIR" rev-parse --short HEAD) on $(git -C "$APP_DIR" branch --show-current)"
