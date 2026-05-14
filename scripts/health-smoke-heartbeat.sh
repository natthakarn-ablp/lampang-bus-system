#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lampang Bus System — Weekly Health Alert Heartbeat (Phase 9.19)
#
# Purpose:  Send one LINE push message per week confirming that the alert
#           pipeline is alive. Proves the bot/token/target chain still
#           works even if no incident has tripped the alerter recently.
#
#           Stateless — does not read or write /var/lib/schoolbus state.
#           Does not handle incidents — if smoke is currently failing,
#           the heartbeat is skipped and the alert wrapper is left to do
#           its job on the next 30-min cycle.
#
# Usage:    bash scripts/health-smoke-heartbeat.sh
#           (typically driven by schoolbus-health-heartbeat.timer,
#           OnCalendar=Mon 08:00)
#
# Exit:     0   heartbeat delivered, or recovery-skip noted
#           1   smoke currently failing (heartbeat intentionally skipped;
#               alert wrapper handles incidents)
#           2   creds missing OR LINE push failed
#           3   smoke script not runnable
#
# Env vars (from /etc/schoolbus/health-alert.env via systemd
# EnvironmentFile=- — same file as the alerter):
#   LINE_CHANNEL_ACCESS_TOKEN
#   LINE_TARGET_ID
#
# Safety:   no sudo, no DB writes, no service restarts, no state writes,
#           token never echoed.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
SMOKE_SCRIPT="$APP_DIR/scripts/health-smoke.sh"
SERVICE_NAME="lampang-bus-system"
LINE_PUSH_ENDPOINT="https://api.line.me/v2/bot/message/push"
HEALTH_URL="http://127.0.0.1:3000/health"
MAX_MSG_CHARS=4900

cd "$APP_DIR" 2>/dev/null || { echo "FATAL: cannot cd to $APP_DIR"; exit 3; }

SMOKE_OUT="$(mktemp -t hb-smoke.XXXXXX)"
PUSH_BODY="$(mktemp -t hb-push.XXXXXX.json)"
PUSH_RESP="$(mktemp -t hb-resp.XXXXXX)"
trap 'rm -f "$SMOKE_OUT" "$PUSH_BODY" "$PUSH_RESP"' EXIT
chmod 0600 "$PUSH_BODY" 2>/dev/null || true

NOW_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
HOST="$(hostname -s 2>/dev/null || hostname || echo unknown)"
HEAD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Run smoke once.
if [ ! -x "$SMOKE_SCRIPT" ]; then
  echo "FATAL: smoke script not executable: $SMOKE_SCRIPT"
  exit 3
fi
bash "$SMOKE_SCRIPT" 2>&1 | tee "$SMOKE_OUT"
SMOKE_EXIT="${PIPESTATUS[0]}"

# If smoke is failing right now, don't send a "we're alive" message — that
# would be misleading. The alert wrapper running 30-min cycles will take
# care of incidents; the heartbeat is just for quiet weeks.
if [ "$SMOKE_EXIT" != "0" ]; then
  echo
  echo "Smoke is FAILING (exit $SMOKE_EXIT) — heartbeat skipped."
  echo "  → schoolbus-health-alert.service handles incidents on its own cadence."
  exit 1
fi

# Gather safe operational facts.
strip_ansi() { sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g'; }
SUMMARY_LINE="$(strip_ansi < "$SMOKE_OUT" | grep -E 'PASS:[[:space:]]*[0-9]+' | tail -1 | sed 's/^[[:space:]]*//')"
[ -z "$SUMMARY_LINE" ] && SUMMARY_LINE="(no summary captured)"
VERDICT_LINE="$(strip_ansi < "$SMOKE_OUT" | grep -E 'HEALTH SMOKE' | tail -1 | sed 's/^[[:space:]]*//')"
[ -z "$VERDICT_LINE" ] && VERDICT_LINE="HEALTH SMOKE (verdict not captured)"

# /health.commit (best-effort; missing → "unknown").
HEALTH_COMMIT="$(curl -s --max-time 5 "$HEALTH_URL" 2>/dev/null \
  | python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
    print(d['data'].get('commit') or 'unknown')
except Exception:
    print('unknown')
" 2>/dev/null || echo unknown)"

# Disk (root). Format: "45% used, 12G avail".
DISK_LINE="$(df -h / 2>/dev/null | awk 'NR==2 {printf "%s used, %s avail", $5, $4}')"
[ -z "$DISK_LINE" ] && DISK_LINE="(df read failed)"

# Build the message.
MSG="$(printf '💚 Lampang Bus health heartbeat (weekly)\nservice: %s\nhost: %s\ntime: %s\ngit HEAD: %s\n/health.commit: %s\nsmoke summary: %s\nsmoke verdict: %s\ndisk /: %s' \
  "$SERVICE_NAME" "$HOST" "$NOW_UTC" "$HEAD_SHA" "$HEALTH_COMMIT" "$SUMMARY_LINE" "$VERDICT_LINE" "$DISK_LINE")"

if [ "${#MSG}" -gt "$MAX_MSG_CHARS" ]; then
  MSG="${MSG:0:$MAX_MSG_CHARS}"$'\n…(truncated)'
fi

# Check creds (token never echoed).
if [ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] || [ -z "${LINE_TARGET_ID:-}" ]; then
  echo
  echo "HEARTBEAT NOT DELIVERED: missing LINE_CHANNEL_ACCESS_TOKEN or LINE_TARGET_ID"
  echo "  → /etc/schoolbus/health-alert.env (root:schoolbus, 0640)"
  echo "  → docs/phase-9-ops-notes.md Section 16"
  exit 2
fi

# Build push body via python3 (safe JSON escaping); token stays in -H only.
TARGET_ID="$LINE_TARGET_ID" MSG="$MSG" python3 - <<'PY' > "$PUSH_BODY"
import json, os
print(json.dumps({
    "to": os.environ["TARGET_ID"],
    "messages": [{"type": "text", "text": os.environ["MSG"]}],
}))
PY
chmod 0600 "$PUSH_BODY" 2>/dev/null || true

HTTP_CODE="$(curl --silent --show-error --max-time 10 \
  -o "$PUSH_RESP" \
  -w '%{http_code}' \
  -X POST "$LINE_PUSH_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
  --data @"$PUSH_BODY" \
  2>/dev/null || echo "000")"

case "$HTTP_CODE" in
  200|201|202)
    echo
    echo "HEARTBEAT DELIVERED via LINE push (HTTP $HTTP_CODE)"
    exit 0
    ;;
  401|403)
    echo
    echo "HEARTBEAT DELIVERY FAILED: LINE authentication rejected (HTTP $HTTP_CODE)"
    exit 2
    ;;
  000)
    echo
    echo "HEARTBEAT DELIVERY FAILED: could not reach LINE API (network/timeout)"
    exit 2
    ;;
  *)
    HEAD=""
    if [ -s "$PUSH_RESP" ]; then
      HEAD="$(head -c 300 "$PUSH_RESP" 2>/dev/null | sed -E "s|${LINE_CHANNEL_ACCESS_TOKEN}|<redacted>|g" 2>/dev/null || true)"
    fi
    echo
    echo "HEARTBEAT DELIVERY FAILED: LINE returned HTTP $HTTP_CODE"
    [ -n "$HEAD" ] && echo "  body (token-redacted, first 300B): $HEAD"
    exit 2
    ;;
esac
