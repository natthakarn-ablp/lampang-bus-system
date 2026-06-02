#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lampang Bus System — Production Health Smoke Script (Phase 9.16)
#
# Purpose:  Read-only post-deploy / post-incident smoke check.
#           Verifies frontend, backend /health, PM2, disk, MySQL lock state,
#           housekeeping timer, recent critical log patterns, and git tree.
#
# Usage:    bash scripts/health-smoke.sh
#           (runnable from any cwd — it auto-locates the repo root)
#
# Exit:     0   all PASS / BASELINE / WARN
#           1   one or more FAIL
#
# Result labels:
#   [PASS]      check succeeded
#   [BASELINE]  known historical signal acknowledged (does NOT exit 1)
#   [WARN]      unexpected but non-blocking — investigate
#   [FAIL]      blocking — exit 1
#   [SKIP]      check could not be performed (missing tool/file)
#
# Safety:   no sudo, no restarts, no writes, no DB mutations, no secrets in
#           output, no file deletions. Safe to run during traffic.
# ═══════════════════════════════════════════════════════════════════════════

# Strict mode — but NOT -e: we want to collect every failure, not abort early.
set -uo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
FRONTEND_URL="https://schoolbuslampang.com/"
BACKEND_URL="http://127.0.0.1:3000/health"
PM2_APP_NAME="schoolbus-backend"
HOUSEKEEPING_TIMER="schoolbus-housekeeping.timer"
DISK_WARN_PCT=80
DISK_FAIL_PCT=90
PM2_LOG_DIR="$HOME/.pm2/logs"

# ─── Phase 9.16 baselines ──────────────────────────────────────────────────
# Known historical signals from the 2026-05-13 pre-Phase-9.2 disk-pressure
# incident. Each baseline is paired with a rule that promotes the signal back
# to WARN/FAIL when a *new* event would push the metric past the baseline.
# See docs/phase-9-ops-notes.md Section 13 for reset procedures.

# InnoDB lifetime row-lock waits captured at end-of-incident. Current waits
# must still be 0; lifetime must be ≤ this number to count as baseline.
BASELINE_INNODB_ROW_LOCK_WAITS=16

# Number of critical-pattern matches in PM2 error log captured at end-of-
# incident (lines 712–718 of schoolbus-backend-error.log on 2026-05-13).
BASELINE_PM2_CRITICAL_MATCHES=7

# Safeguard: if MySQL Uptime is below this many seconds, ignore the lifetime
# baseline. A fresh server hasn't accumulated the historical residue, so any
# nonzero counter is genuinely new. 86400 s = 24 h.
BASELINE_MYSQL_UPTIME_GUARD_SECONDS=86400

TMP_HEALTH="$(mktemp -t health-smoke.XXXXXX.json)"
trap 'rm -f "$TMP_HEALTH"' EXIT

cd "$APP_DIR" 2>/dev/null || { echo "FATAL: cannot cd to $APP_DIR"; exit 1; }

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
BASELINE_COUNT=0

color()    { local c="$1"; shift; printf '\033[%sm%s\033[0m' "$c" "$*"; }
pass()     { PASS_COUNT=$((PASS_COUNT + 1));         printf "  %s %s\n" "$(color '1;32' '[PASS]')"     "$*"; }
warn()     { WARN_COUNT=$((WARN_COUNT + 1));         printf "  %s %s\n" "$(color '1;33' '[WARN]')"     "$*"; }
fail()     { FAIL_COUNT=$((FAIL_COUNT + 1));         printf "  %s %s\n" "$(color '1;31' '[FAIL]')"     "$*"; }
skip()     { SKIP_COUNT=$((SKIP_COUNT + 1));         printf "  %s %s\n" "$(color '1;34' '[SKIP]')"     "$*"; }
baseline() { BASELINE_COUNT=$((BASELINE_COUNT + 1)); printf "  %s %s\n" "$(color '1;35' '[BASELINE]')" "$*"; }
section()  { printf "\n%s\n" "$(color '1;36' "── $* ──")"; }

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Lampang Bus System — Health Smoke (Phase 9.16)      ║"
echo "╚══════════════════════════════════════════════════════╝"
printf "Time:     %s\n" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf "Repo:     %s\n" "$APP_DIR"
printf "Frontend: %s\n" "$FRONTEND_URL"
printf "Backend:  %s\n" "$BACKEND_URL"

# ─── A. Git / repo state ─────────────────────────────────────────────────
section "A. Git / repo state"
GIT_HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
if [ "$GIT_HEAD" = "?" ]; then
  fail "git rev-parse failed — not a git repo?"
else
  pass "git HEAD = $GIT_HEAD"
fi

# Tracked changes are FAIL.
# Untracked .claude/settings.json is BASELINE (repo policy keeps it local).
# Any OTHER untracked file is WARN (unexpected — investigate or .gitignore).
PORCELAIN="$(git status --porcelain 2>/dev/null || true)"
TRACKED_MODS="$(printf '%s\n' "$PORCELAIN" | grep -vE '^\?\? ' | grep -v '^$' || true)"
UNTRACKED_BASELINE="$(printf '%s\n' "$PORCELAIN" | grep -E '^\?\? \.claude/settings\.json$' || true)"
OTHER_UNTRACKED="$(printf '%s\n' "$PORCELAIN" | grep -E '^\?\? ' | grep -vE '^\?\? \.claude/settings\.json$' || true)"

if [ -n "$TRACKED_MODS" ]; then
  fail "unexpected tracked changes in working tree:"
  printf '%s\n' "$TRACKED_MODS" | sed 's/^/         /'
else
  pass "no tracked working-tree changes"
fi
if [ -n "$UNTRACKED_BASELINE" ]; then
  baseline ".claude/settings.json untracked (allowlisted by repo policy)"
fi
if [ -n "$OTHER_UNTRACKED" ]; then
  warn "unexpected untracked files (outside baseline allowlist):"
  printf '%s\n' "$OTHER_UNTRACKED" | sed 's/^/         /'
fi

# ─── B. Frontend reachability ────────────────────────────────────────────
section "B. Frontend reachability"
FE_HEAD="$(curl -sI --max-time 10 "$FRONTEND_URL" 2>/dev/null | head -1 || true)"
FE_CODE="$(printf '%s' "$FE_HEAD" | awk '{print $2}')"
if [ -z "$FE_CODE" ]; then
  fail "frontend unreachable ($FRONTEND_URL)"
else
  case "$FE_CODE" in
    200) pass "frontend $FE_CODE OK" ;;
    301|302|303|307|308) pass "frontend $FE_CODE redirect (acceptable)" ;;
    *) fail "frontend returned HTTP $FE_CODE" ;;
  esac
fi

# ─── C. Backend /health ──────────────────────────────────────────────────
section "C. Backend /health"
HTTP_BODY_CODE="$(curl -s --max-time 5 -o "$TMP_HEALTH" -w '%{http_code}' "$BACKEND_URL" 2>/dev/null || echo '000')"
if [ "$HTTP_BODY_CODE" != "200" ]; then
  fail "/health returned HTTP $HTTP_BODY_CODE"
else
  pass "/health HTTP 200"
  if command -v python3 >/dev/null 2>&1; then
    # All field reads via python3 — never echo full body to avoid future surprises.
    H_SUCCESS=$(python3 -c "import json,sys
try: print(json.load(open('$TMP_HEALTH')).get('success',''))
except: pass" 2>/dev/null)
    H_SERVICE=$(python3 -c "import json,sys
try: print(json.load(open('$TMP_HEALTH'))['data'].get('service',''))
except: pass" 2>/dev/null)
    H_ENV=$(python3 -c "import json,sys
try: print(json.load(open('$TMP_HEALTH'))['data'].get('environment',''))
except: pass" 2>/dev/null)
    H_COMMIT=$(python3 -c "import json,sys
try: print(json.load(open('$TMP_HEALTH'))['data'].get('commit') or '')
except: pass" 2>/dev/null)
    H_DB=$(python3 -c "import json,sys
try: print(json.load(open('$TMP_HEALTH'))['data']['database'].get('connected',''))
except: pass" 2>/dev/null)

    [ "$H_SUCCESS" = "True" ]              && pass "data.success = true"              || fail "data.success ≠ true (got '$H_SUCCESS')"
    [ "$H_SERVICE" = "lampang-bus-backend" ] && pass "data.service = lampang-bus-backend" || fail "data.service ≠ lampang-bus-backend (got '$H_SERVICE')"
    [ "$H_ENV" = "production" ]            && pass "data.environment = production"     || fail "data.environment ≠ production (got '$H_ENV')"
    [ "$H_DB" = "True" ]                   && pass "data.database.connected = true"    || fail "data.database.connected ≠ true (got '$H_DB')"

    if [ -z "$H_COMMIT" ]; then
      fail "data.commit missing"
    elif [ "$H_COMMIT" = "$GIT_HEAD" ]; then
      pass "data.commit ($H_COMMIT) matches git HEAD"
    else
      warn "data.commit ($H_COMMIT) ≠ git HEAD ($GIT_HEAD) — service may need restart to pick up new SHA"
    fi
  else
    skip "python3 not available — skipping JSON field assertions"
  fi
fi

# ─── D. PM2 ──────────────────────────────────────────────────────────────
section "D. PM2 process"
if command -v pm2 >/dev/null 2>&1; then
  PM2_LINE="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for p in d:
        if p.get('name')=='$PM2_APP_NAME':
            st=p['pm2_env'].get('status','?')
            rs=p['pm2_env'].get('restart_time','?')
            up=p['pm2_env'].get('pm_uptime',0)
            import time
            uptime_s=max(0,int((time.time()*1000-up)/1000)) if up else 0
            print(f'{st}|{rs}|{uptime_s}')
            break
    else:
        print('NOTFOUND|0|0')
except Exception:
    print('PARSE_ERROR|0|0')
" 2>/dev/null)"
  PM2_STATUS="${PM2_LINE%%|*}"
  PM2_REST="$(printf '%s' "$PM2_LINE" | cut -d'|' -f2)"
  PM2_UP_S="$(printf '%s' "$PM2_LINE" | cut -d'|' -f3)"
  case "$PM2_STATUS" in
    online)
      if [ "${PM2_UP_S:-0}" -lt 30 ] 2>/dev/null; then
        warn "$PM2_APP_NAME online but uptime only ${PM2_UP_S}s — possibly flapping (restart count = $PM2_REST)"
      else
        pass "$PM2_APP_NAME online (uptime ${PM2_UP_S}s, restart count $PM2_REST)"
      fi
      ;;
    NOTFOUND) fail "PM2 process '$PM2_APP_NAME' not found" ;;
    PARSE_ERROR) warn "could not parse pm2 jlist output" ;;
    *) fail "$PM2_APP_NAME status = '$PM2_STATUS' (expected online)" ;;
  esac
else
  skip "pm2 binary not in PATH"
fi

# ─── E. Disk ─────────────────────────────────────────────────────────────
section "E. Disk usage (/)"
DF_LINE="$(df -P / 2>/dev/null | awk 'NR==2 {print $5,$2,$3,$4}')"
USE_PCT="$(printf '%s' "$DF_LINE" | awk '{gsub("%","",$1); print $1}')"
DISK_TOTAL="$(printf '%s' "$DF_LINE" | awk '{print $2}')"
DISK_USED="$(printf '%s' "$DF_LINE" | awk '{print $3}')"
DISK_AVAIL="$(printf '%s' "$DF_LINE" | awk '{print $4}')"
if [ -z "$USE_PCT" ]; then
  fail "could not read df / output"
elif [ "$USE_PCT" -ge "$DISK_FAIL_PCT" ]; then
  fail "/ usage ${USE_PCT}% (>= ${DISK_FAIL_PCT}%)"
elif [ "$USE_PCT" -ge "$DISK_WARN_PCT" ]; then
  warn "/ usage ${USE_PCT}% (>= ${DISK_WARN_PCT}%) — used $DISK_USED / total $DISK_TOTAL, avail $DISK_AVAIL"
else
  pass "/ usage ${USE_PCT}% — used $DISK_USED / total $DISK_TOTAL, avail $DISK_AVAIL"
fi

# Inodes
INODE_PCT="$(df -iP / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [ -z "$INODE_PCT" ]; then
  warn "could not read inode usage"
elif [ "$INODE_PCT" -ge "$DISK_FAIL_PCT" ]; then
  fail "/ inode usage ${INODE_PCT}%"
elif [ "$INODE_PCT" -ge "$DISK_WARN_PCT" ]; then
  warn "/ inode usage ${INODE_PCT}%"
else
  pass "/ inode usage ${INODE_PCT}%"
fi

# ─── F. MySQL lock sanity ────────────────────────────────────────────────
section "F. MySQL lock sanity"
ENV_FILE="$APP_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  skip "backend/.env not found — cannot run DB checks"
elif ! command -v mysql >/dev/null 2>&1; then
  skip "mysql client not in PATH"
else
  DB_USER_VAL="$(grep -oP '^DB_USER=\K.*' "$ENV_FILE" | head -1)"
  DB_PASS_VAL="$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE" | head -1)"
  DB_NAME_VAL="$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE" | head -1)"
  DB_HOST_VAL="$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE" | head -1)"
  DB_PORT_VAL="$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE" | head -1)"
  if [ -z "$DB_USER_VAL" ] || [ -z "$DB_PASS_VAL" ] || [ -z "$DB_NAME_VAL" ]; then
    skip "DB credentials missing in $ENV_FILE"
  else
    # Run MySQL with credentials exported into the subshell only — never echoed.
    # Use MYSQL_PWD env to avoid showing -p on the command line.
    SQL=$(cat <<'SQL_EOF'
SELECT 'tmpdir',@@tmpdir
UNION ALL
SELECT 'Innodb_row_lock_current_waits',VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_row_lock_current_waits'
UNION ALL
SELECT 'Innodb_row_lock_waits',VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_row_lock_waits'
UNION ALL
SELECT 'Created_tmp_disk_tables',VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Created_tmp_disk_tables'
UNION ALL
SELECT 'Uptime',VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime';
SQL_EOF
)
    MYSQL_OUT="$(MYSQL_PWD="$DB_PASS_VAL" mysql -N -h "${DB_HOST_VAL:-localhost}" -P "${DB_PORT_VAL:-3306}" -u "$DB_USER_VAL" "$DB_NAME_VAL" -e "$SQL" 2>/dev/null || true)"
    unset DB_PASS_VAL
    if [ -z "$MYSQL_OUT" ]; then
      fail "MySQL query failed (auth or connectivity)"
    else
      CUR_WAITS="$(printf '%s\n' "$MYSQL_OUT" | awk -F'\t' '$1=="Innodb_row_lock_current_waits"{print $2}')"
      LIFE_WAITS="$(printf '%s\n' "$MYSQL_OUT" | awk -F'\t' '$1=="Innodb_row_lock_waits"{print $2}')"
      TMPDIR_VAL="$(printf '%s\n' "$MYSQL_OUT" | awk -F'\t' '$1=="tmpdir"{print $2}')"
      TMP_DISK_TABLES="$(printf '%s\n' "$MYSQL_OUT" | awk -F'\t' '$1=="Created_tmp_disk_tables"{print $2}')"
      MYSQL_UPTIME="$(printf '%s\n' "$MYSQL_OUT" | awk -F'\t' '$1=="Uptime"{print $2}')"
      MYSQL_UPTIME="${MYSQL_UPTIME:-0}"
      pass "mysql connectivity OK (tmpdir=$TMPDIR_VAL, Created_tmp_disk_tables=$TMP_DISK_TABLES, Uptime=${MYSQL_UPTIME}s)"

      # Decision tree for InnoDB lock counters:
      #   current > 0                          → FAIL (active contention)
      #   current = 0 AND lifetime = 0         → PASS (clean)
      #   current = 0 AND uptime < 24h         → WARN if lifetime > 0
      #                                          (counter is fresh; baseline doesn't apply)
      #   current = 0 AND lifetime ≤ baseline  → BASELINE (known historical residue)
      #   current = 0 AND lifetime > baseline  → WARN (new contention since baseline)
      if [ "${CUR_WAITS:-0}" != "0" ]; then
        fail "Innodb_row_lock_current_waits=$CUR_WAITS — active lock contention"
      elif [ "${LIFE_WAITS:-0}" = "0" ]; then
        pass "Innodb_row_lock_current_waits=0, lifetime Innodb_row_lock_waits=0"
      elif [ "${MYSQL_UPTIME:-0}" -lt "$BASELINE_MYSQL_UPTIME_GUARD_SECONDS" ] 2>/dev/null; then
        warn "Innodb_row_lock_waits=$LIFE_WAITS lifetime, current=0 — MySQL Uptime ${MYSQL_UPTIME}s < ${BASELINE_MYSQL_UPTIME_GUARD_SECONDS}s, baseline disabled (counter is fresh)"
      elif [ "${LIFE_WAITS:-0}" -le "$BASELINE_INNODB_ROW_LOCK_WAITS" ] 2>/dev/null; then
        baseline "Innodb_row_lock_waits=$LIFE_WAITS lifetime, current=0 (≤ baseline $BASELINE_INNODB_ROW_LOCK_WAITS — historical residue from 2026-05-13 incident)"
      else
        NEW_WAITS=$((LIFE_WAITS - BASELINE_INNODB_ROW_LOCK_WAITS))
        warn "Innodb_row_lock_waits=$LIFE_WAITS lifetime, current=0 — exceeds baseline $BASELINE_INNODB_ROW_LOCK_WAITS by $NEW_WAITS (new contention since baseline)"
      fi
    fi
  fi
fi

# ─── G. Housekeeping systemd timer ───────────────────────────────────────
section "G. Housekeeping timer"
if command -v systemctl >/dev/null 2>&1; then
  TIMER_STATE="$(systemctl is-active "$HOUSEKEEPING_TIMER" 2>/dev/null || true)"
  case "$TIMER_STATE" in
    active)
      pass "$HOUSEKEEPING_TIMER is active"
      NEXT="$(systemctl list-timers --all 2>/dev/null | grep -F "$HOUSEKEEPING_TIMER" | head -1 || true)"
      [ -n "$NEXT" ] && printf "         next: %s\n" "$(printf '%s' "$NEXT" | awk '{print $1,$2,$3,$4,$5,$6}')"
      ;;
    inactive|failed|"")
      warn "$HOUSEKEEPING_TIMER state = '${TIMER_STATE:-not found}'"
      ;;
    *)
      warn "$HOUSEKEEPING_TIMER state = '$TIMER_STATE'"
      ;;
  esac
else
  skip "systemctl not available"
fi

# ─── H. Recent critical PM2 log scan ─────────────────────────────────────
section "H. PM2 log scan (critical patterns)"
if [ ! -d "$PM2_LOG_DIR" ]; then
  skip "$PM2_LOG_DIR does not exist"
else
  PATTERN='ENOSPC|No space left|errno 28|Lock wait timeout|ER_LOCK_WAIT_TIMEOUT|deadlock|fatal|uncaught|Unhandled'
  MATCHES="$(grep -RniE "$PATTERN" "$PM2_LOG_DIR" 2>/dev/null || true)"
  if [ -z "$MATCHES" ]; then
    pass "no critical patterns found in PM2 logs"
  else
    COUNT="$(printf '%s\n' "$MATCHES" | wc -l | awk '{print $1}')"

    # Decision tree for PM2 critical-pattern matches:
    #   count = baseline  → BASELINE (known historical entries)
    #   count > baseline  → WARN     (new entries — show last 20)
    #   count < baseline  → BASELINE (logs likely rotated — note for operator)
    #   count = 0         → PASS (handled in outer branch)
    if [ "$COUNT" = "$BASELINE_PM2_CRITICAL_MATCHES" ]; then
      baseline "PM2 critical matches=$COUNT (== baseline — historical entries from 2026-05-13 incident; first 3 shown for traceability)"
      printf '%s\n' "$MATCHES" | head -3 | sed 's/^/         /'
    elif [ "$COUNT" -lt "$BASELINE_PM2_CRITICAL_MATCHES" ] 2>/dev/null; then
      baseline "PM2 critical matches=$COUNT (< baseline $BASELINE_PM2_CRITICAL_MATCHES — logs likely rotated; consider resetting baseline)"
      printf '%s\n' "$MATCHES" | sed 's/^/         /'
    else
      NEW_COUNT=$((COUNT - BASELINE_PM2_CRITICAL_MATCHES))
      warn "PM2 critical matches=$COUNT (baseline $BASELINE_PM2_CRITICAL_MATCHES + $NEW_COUNT new) — showing last 20:"
      printf '%s\n' "$MATCHES" | tail -20 | sed 's/^/         /'
    fi
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────
section "Summary"
printf "  PASS: %d   BASELINE: %d   WARN: %d   FAIL: %d   SKIP: %d\n" \
  "$PASS_COUNT" "$BASELINE_COUNT" "$WARN_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
echo
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "  %s\n" "$(color '1;31' 'HEALTH SMOKE FAILED')"
  exit 1
elif [ "$WARN_COUNT" -gt 0 ]; then
  printf "  %s\n" "$(color '1;33' 'HEALTH SMOKE PASSED WITH WARNINGS')"
  exit 0
elif [ "$BASELINE_COUNT" -gt 0 ]; then
  printf "  %s\n" "$(color '1;35' 'HEALTH SMOKE PASSED WITH BASELINED OBSERVATIONS')"
  exit 0
else
  printf "  %s\n" "$(color '1;32' 'HEALTH SMOKE PASSED')"
  exit 0
fi
