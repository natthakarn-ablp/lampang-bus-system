#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Turn one feature flag on (or off) in backend/.env, reload the service, and
# put it back automatically if the service does not come up healthy.
#
# WHY THIS SCRIPT EXISTS
#   ecosystem.config.js declares no exec_mode and no instances, so PM2 runs
#   this app in fork mode. `pm2 reload` is therefore a stop and start, not a
#   seamless swap. If the new process refuses to boot — which is exactly what
#   backend/src/index.js does when a flag is on and its migration is missing —
#   PM2 retries (max_restarts 10, restart_delay 5000, exponential backoff) and
#   then parks the app `errored`. The whole site is down for every role until
#   someone edits the file back by hand.
#
#   Flipping a flag is therefore a production change that needs the same care
#   as a deploy: a backup of the file, a health verdict, and an automatic
#   rollback when that verdict is bad. That is all this script is.
#
# WHAT IT DOES NOT DO
#   It does not apply migrations. Run scripts/apply-migration-0NN.sh first when
#   the flag needs tables; this script only checks that the app still boots.
#
# Usage (on the app server):
#   bash scripts/enable-feature-flag.sh FEATURE_PARTICIPATION_CASES
#   bash scripts/enable-feature-flag.sh FEATURE_ETA false      # turn one off
#   DRY_RUN=1 bash scripts/enable-feature-flag.sh FEATURE_ETA  # show only
# ─────────────────────────────────────────────────────────────
set -euo pipefail

FLAG="${1:-}"
VALUE="${2:-true}"
APP_DIR="${APP_DIR:-/home/schoolbus/apps/lampang-bus-system}"
STATE_DIR="${STATE_DIR:-/home/schoolbus/deploy-state}"
ENV_FILE="${APP_DIR}/backend/.env"
ECOSYSTEM="${APP_DIR}/ecosystem.config.js"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"
DRY_RUN="${DRY_RUN:-0}"

# Only flags this application actually reads (backend/src/config/env.js).
KNOWN_FLAGS="FEATURE_DRIVER_REGISTRATION FEATURE_PARTICIPATION_CASES \
FEATURE_PARENT_CONSENT_REQUIRED FEATURE_VEHICLE_QR FEATURE_QR_LEVEL3 \
FEATURE_ETA FEATURE_GEOFENCE FEATURE_ROUTE_DEVIATION \
FEATURE_DRIVER_SHIFT_SELECTION FEATURE_ADMIN_PASSWORD_RECOVERY"

say()  { echo "[flag] $*"; }
fail() { echo "[flag] ERROR: $*" >&2; exit 1; }

[ -n "$FLAG" ] || fail "usage: bash scripts/enable-feature-flag.sh <FEATURE_NAME> [true|false]"
case " $KNOWN_FLAGS " in
  *" $FLAG "*) : ;;
  *) fail "unknown flag: $FLAG (this app reads: $KNOWN_FLAGS)" ;;
esac
case "$VALUE" in true|false) : ;; *) fail "value must be true or false, got: $VALUE" ;; esac
[ -f "$ENV_FILE" ]   || fail "env file not found: $ENV_FILE"
[ -f "$ECOSYSTEM" ]  || fail "ecosystem file not found: $ECOSYSTEM"
mkdir -p "$STATE_DIR"

# Portable: `grep -P` is unavailable on some locales (it fails outright under
# a non-UTF-8 Git Bash), and a silent empty result there would make this script
# think an already-set flag was unset and append a duplicate line.
read_flag() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
CURRENT="$(read_flag "$FLAG")"
say "flag:    ${FLAG}"
say "current: ${CURRENT:-<not set>}"
say "wanted:  ${VALUE}"

if [ "${CURRENT:-}" = "$VALUE" ]; then
  say "already ${VALUE} — nothing to do."
  exit 0
fi

# Pairs the application refuses to boot without. Catch them here with a clear
# message rather than through a crash loop.
if [ "$FLAG" = "FEATURE_PARENT_CONSENT_REQUIRED" ] && [ "$VALUE" = "true" ]; then
  QR="$(read_flag FEATURE_VEHICLE_QR)"
  [ "$QR" = "true" ] || fail "FEATURE_PARENT_CONSENT_REQUIRED requires FEATURE_VEHICLE_QR=true (the consent router is the only way a parent can grant consent)"
fi
if [ "$FLAG" = "FEATURE_QR_LEVEL3" ] && [ "$VALUE" = "true" ]; then
  QR="$(read_flag FEATURE_VEHICLE_QR)"
  [ "$QR" = "true" ] || fail "FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true"
fi

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN: would set ${FLAG}=${VALUE} and reload. Nothing was changed."
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${STATE_DIR}/env.backup-${STAMP}-${FLAG}"
cp -a "$ENV_FILE" "$BACKUP"
say "env backed up: ${BACKUP}"

# Replace an existing line, otherwise append one. Written to a temp file and
# moved into place so a failure here cannot leave a half-written .env.
TMP="$(mktemp -t lampang_env.XXXXXX)"
chmod 600 "$TMP"
trap 'rm -f "$TMP" 2>/dev/null || true' EXIT INT TERM
if [ -n "${CURRENT:-}" ]; then
  sed "s|^${FLAG}=.*|${FLAG}=${VALUE}|" "$ENV_FILE" > "$TMP"
else
  cat "$ENV_FILE" > "$TMP"
  printf '\n# set by scripts/enable-feature-flag.sh on %s\n%s=%s\n' "$STAMP" "$FLAG" "$VALUE" >> "$TMP"
fi
cat "$TMP" > "$ENV_FILE"
say "env updated: $(grep -c '^FEATURE_' "$ENV_FILE") feature line(s) now set"

say "reloading (fork mode: this is a stop and start) ..."
pm2 reload "$ECOSYSTEM" >/dev/null 2>&1 || say "pm2 reload returned non-zero — checking health anyway"

verdict() {
  local body
  body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  [ -n "$body" ] || { echo "unreachable"; return; }
  case "$body" in
    *'"success":true'*) : ;;
    *) echo "success-false"; return ;;
  esac
  case "$body" in
    *'"connected":true'*) echo "ok" ;;
    *) echo "db-disconnected" ;;
  esac
}

RESULT="unreachable"
for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
  sleep "$HEALTH_SLEEP_SEC"
  RESULT="$(verdict)"
  [ "$RESULT" = "ok" ] && break
  say "health attempt ${i}/${HEALTH_ATTEMPTS}: ${RESULT}"
done

if [ "$RESULT" = "ok" ]; then
  say "health OK — ${FLAG}=${VALUE} is live"
  say "note: anyone already signed in must sign out and back in before menus change"
  exit 0
fi

# ── rollback ────────────────────────────────────────────────────────────────
say "health verdict: ${RESULT} — rolling the flag back"
cp -a "$BACKUP" "$ENV_FILE"
pm2 reload "$ECOSYSTEM" >/dev/null 2>&1 || true
BACK="unreachable"
for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
  sleep "$HEALTH_SLEEP_SEC"
  BACK="$(verdict)"
  [ "$BACK" = "ok" ] && break
done
if [ "$BACK" = "ok" ]; then
  fail "${FLAG} was NOT enabled; the previous configuration is restored and the service is healthy"
fi
echo "[flag] FATAL: rollback did not restore health (verdict: ${BACK})." >&2
echo "[flag] Restore by hand:  cp -a ${BACKUP} ${ENV_FILE} && pm2 reload ${ECOSYSTEM}" >&2
exit 2
