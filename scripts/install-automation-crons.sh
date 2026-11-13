#!/usr/bin/env bash
# Install the in-app automation cron lines (2026-11-13) for the current user.
#
# Ensures these three lines are in the user's crontab (see
# docs/ops/automation-crons.md). The server clock is UTC and its cron ignores
# CRON_TZ, so the hours below are UTC (01:00 UTC = 08:00 Bangkok, 13:00 UTC =
# 20:00 Bangkok). None of these scripts sends LINE.
#
#   - idempotent: a line that is already present (exact match, ignoring
#     leading/trailing spaces) is not added again;
#   - never removes or edits any other line;
#   - if an ACTIVE line already runs the same script with a different schedule
#     or path, that line is left alone, the wanted line is NOT added (it would
#     run twice) and the script exits 2 after handling the others;
#   - prints a unified diff of old -> new crontab;
#   - --dry-run prints the diff and writes nothing (no backup, no crontab);
#   - before writing, the current crontab is saved to
#     $BACKUP_DIR/crontab.backup-<UTC stamp> (restore: crontab <that file>).
#
# The GPS stale alert (backend/scripts/gps-stale-alert.js) is deliberately NOT
# here: it pushes LINE, and enabling it is the owner's separate decision.
#
# Usage:  bash scripts/install-automation-crons.sh [--dry-run]
# Env:    BACKUP_DIR (default /home/schoolbus/deploy-state),
#         APP_DIR (default /home/schoolbus/apps/lampang-bus-system),
#         LOG_DIR (default /home/schoolbus/logs) — overridden only by tests.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/schoolbus/apps/lampang-bus-system}"
LOG_DIR="${LOG_DIR:-/home/schoolbus/logs}"
BACKUP_DIR="${BACKUP_DIR:-/home/schoolbus/deploy-state}"
DRY_RUN=0

say()  { echo "[crons] $*"; }
fail() { echo "[crons] ABORT: $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) fail "unknown argument '$arg' (only --dry-run is accepted)" ;;
  esac
done

command -v crontab >/dev/null 2>&1 || fail "crontab command not found"

# script name | schedule (UTC) | log file
WANTED=(
  "pending-queue-alert.js|0 1 * * *|pending-queue-alert.log"
  "daily-snapshot.js|0 13 * * *|daily-snapshot.log"
  "ops-watch.js|*/30 * * * *|ops-watch.log"
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CUR="$TMP/current"
NEW="$TMP/new"

# `crontab -l` exits non-zero with "no crontab for <user>" when there is none.
set +e
crontab -l > "$CUR" 2> "$TMP/err"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  if grep -qi "no crontab" "$TMP/err"; then
    : > "$CUR"
    say "no crontab yet for $(whoami 2>/dev/null || echo this user); starting from empty"
  else
    cat "$TMP/err" >&2
    fail "crontab -l failed (exit $RC); nothing was changed"
  fi
fi

trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }

cp "$CUR" "$NEW"
# Make sure appended lines start on their own line.
if [ -s "$NEW" ] && [ "$(tail -c1 "$NEW" | od -An -c | tr -d ' ')" != '\n' ]; then echo >> "$NEW"; fi

ADDED=0
CONFLICTS=0
for spec in "${WANTED[@]}"; do
  IFS='|' read -r script sched log <<< "$spec"
  line="$sched cd $APP_DIR/backend && ${NODE_BIN:-/usr/local/bin/node} scripts/$script >> $LOG_DIR/$log 2>&1"
  present=0
  other=""
  while IFS= read -r existing || [ -n "$existing" ]; do
    t="$(trim "$existing")"
    [ -z "$t" ] && continue
    case "$t" in \#*) continue ;; esac
    if [ "$t" = "$line" ]; then present=1; break; fi
    case "$t" in *"scripts/$script"*) other="$t" ;; esac
  done < "$CUR"
  if [ "$present" -eq 1 ]; then
    say "already present: $script"
  elif [ -n "$other" ]; then
    CONFLICTS=$((CONFLICTS + 1))
    echo "[crons] WARNING: $script already runs from a different line; not adding a second one:" >&2
    echo "[crons]   existing: $other" >&2
    echo "[crons]   wanted:   $line" >&2
  else
    echo "$line" >> "$NEW"
    ADDED=$((ADDED + 1))
    say "will add: $script ($sched UTC)"
  fi
done

if [ "$ADDED" -eq 0 ]; then
  say "no change needed"
  [ "$CONFLICTS" -eq 0 ] || exit 2
  exit 0
fi

say "diff (current -> new):"
diff -u --label crontab.current --label crontab.new "$CUR" "$NEW" || true

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry run: nothing written"
  [ "$CONFLICTS" -eq 0 ] || exit 2
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/crontab.backup-$STAMP"
[ -e "$BACKUP" ] && BACKUP="$BACKUP.$$"
cp "$CUR" "$BACKUP" || fail "could not write backup $BACKUP; nothing was changed"
say "backup of the current crontab: $BACKUP"

crontab "$NEW" || fail "crontab rejected the new file; the old one is unchanged (backup: $BACKUP)"

# Read back: every line that was there before plus the added ones must be there now.
crontab -l > "$TMP/after" 2>/dev/null || fail "could not read the crontab back; restore with: crontab $BACKUP"
cmp -s "$NEW" "$TMP/after" || fail "crontab read back differs from what was written; check it, restore with: crontab $BACKUP"
say "installed $ADDED line(s). Undo: crontab $BACKUP"
[ "$CONFLICTS" -eq 0 ] || exit 2
exit 0
