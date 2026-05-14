#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lampang Bus System — FAIL-only Health Smoke Alerter (Phase 9.18)
#
# Purpose:  Run scripts/health-smoke.sh, capture its output, and send a LINE
#           push alert ONLY when the smoke script exits non-zero.
#           [PASS] / [BASELINE] / [WARN] observations are NEVER alerted —
#           the smoke script exits 0 in those cases and this wrapper stays
#           silent.
#
# Usage:    bash scripts/health-smoke-alert.sh
#           (typically driven by schoolbus-health-alert.timer)
#
# Exit:     0   smoke passed; no alert needed
#           1   smoke failed AND alert delivered
#           2   smoke failed AND alert could not be delivered (missing
#               creds, network error, or non-2xx from LINE)
#           3   smoke could not run (script missing / bash error)
#
# Env vars (sourced from /etc/schoolbus/health-alert.env via systemd
# EnvironmentFile=- — i.e. file is optional, no failure if absent):
#   LINE_CHANNEL_ACCESS_TOKEN   — LINE Messaging API channel access token
#   LINE_TARGET_ID              — user / group / room ID to push to
#
# Optional dev flag:
#   FORCE_FAIL=1   skip the real smoke run and pretend it returned exit 1
#                  with a synthetic body — used for wiring tests without
#                  touching production state. Still respects creds rules.
#
# Safety:   no sudo, no restarts, no writes outside /tmp, no DB mutations.
#           Token is never echoed. Curl headers carrying the bearer token
#           are never traced. Output sent to journal contains the smoke
#           report but never the token.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
SMOKE_SCRIPT="$APP_DIR/scripts/health-smoke.sh"
SERVICE_NAME="lampang-bus-system"
LINE_PUSH_ENDPOINT="https://api.line.me/v2/bot/message/push"
MAX_MSG_CHARS=4900   # LINE hard cap is 5000 per text; keep margin

cd "$APP_DIR" 2>/dev/null || { echo "FATAL: cannot cd to $APP_DIR"; exit 3; }

SMOKE_OUT="$(mktemp -t health-smoke-out.XXXXXX)"
PUSH_BODY="$(mktemp -t health-smoke-push.XXXXXX.json)"
PUSH_RESP="$(mktemp -t health-smoke-resp.XXXXXX)"
trap 'rm -f "$SMOKE_OUT" "$PUSH_BODY" "$PUSH_RESP"' EXIT
# Restrict push body permissions early (it never carries the token, only
# the alert text + target id, but small belts-and-braces).
chmod 0600 "$PUSH_BODY" 2>/dev/null || true

NOW_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
HOST="$(hostname -s 2>/dev/null || hostname || echo unknown)"
HEAD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ─── Run smoke (or simulate failure for wiring tests) ────────────────────
if [ "${FORCE_FAIL:-0}" = "1" ]; then
  printf 'FORCED FAILURE (FORCE_FAIL=1) — smoke not actually run\n  PASS: 0   BASELINE: 0   WARN: 0   FAIL: 1   SKIP: 0\n  HEALTH SMOKE FAILED\n' > "$SMOKE_OUT"
  cat "$SMOKE_OUT"
  SMOKE_EXIT=1
elif [ ! -x "$SMOKE_SCRIPT" ]; then
  echo "FATAL: smoke script not executable: $SMOKE_SCRIPT"
  SMOKE_EXIT=3
  # Synthesize a minimal failure body so the alert path still has content.
  printf 'Smoke script missing or not executable: %s\n' "$SMOKE_SCRIPT" > "$SMOKE_OUT"
else
  # tee so journal gets the full report; capture exit code via PIPESTATUS.
  bash "$SMOKE_SCRIPT" 2>&1 | tee "$SMOKE_OUT"
  SMOKE_EXIT="${PIPESTATUS[0]}"
fi

# ─── Quiet path: smoke healthy → no alert, exit 0 ────────────────────────
if [ "$SMOKE_EXIT" = "0" ]; then
  echo
  echo "No alert sent (smoke exit 0)."
  exit 0
fi

# ─── Alert path: smoke FAIL or could not run ─────────────────────────────
echo
echo "Smoke exit code: $SMOKE_EXIT — preparing FAIL alert."

# Extract the summary line (if present) and the last lines of output, stripped of ANSI.
strip_ansi() { sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g'; }
SUMMARY_LINE="$(strip_ansi < "$SMOKE_OUT" | grep -E 'PASS:[[:space:]]*[0-9]+' | tail -1 | sed 's/^[[:space:]]*//')"
[ -z "$SUMMARY_LINE" ] && SUMMARY_LINE="(no summary line captured)"
TAIL_LINES="$(strip_ansi < "$SMOKE_OUT" | tail -20 | sed 's/^[[:space:]]*//')"

# Build the alert message (UTF-8, plain text).
ALERT_MSG="$(printf '🚨 Lampang Bus health smoke FAILED\nservice: %s\nhost: %s\ntime: %s\ngit HEAD: %s\nsmoke exit: %s\n\n%s\n\n--- tail ---\n%s' \
  "$SERVICE_NAME" "$HOST" "$NOW_UTC" "$HEAD_SHA" "$SMOKE_EXIT" "$SUMMARY_LINE" "$TAIL_LINES")"

# Truncate to LINE's text length budget (chars, not bytes — close enough).
if [ "${#ALERT_MSG}" -gt "$MAX_MSG_CHARS" ]; then
  ALERT_MSG="${ALERT_MSG:0:$MAX_MSG_CHARS}"$'\n…(truncated)'
fi

# ─── Check creds (without echoing them) ──────────────────────────────────
if [ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] || [ -z "${LINE_TARGET_ID:-}" ]; then
  echo "ALERT NOT DELIVERED: missing LINE_CHANNEL_ACCESS_TOKEN or LINE_TARGET_ID"
  echo "  → configure /etc/schoolbus/health-alert.env (root:schoolbus, 0640)"
  echo "  → see docs/phase-9-ops-notes.md Section 15"
  exit 2
fi

# ─── Build LINE push JSON via python3 to avoid manual escaping ───────────
# Token is NOT placed in the body — it goes in the Authorization header only.
TARGET_ID="$LINE_TARGET_ID" MSG="$ALERT_MSG" python3 - <<'PY' > "$PUSH_BODY"
import json, os
print(json.dumps({
    "to": os.environ["TARGET_ID"],
    "messages": [{"type": "text", "text": os.environ["MSG"]}],
}))
PY
chmod 0600 "$PUSH_BODY" 2>/dev/null || true

# ─── Send (token only in -H, never logged) ───────────────────────────────
# --silent: no progress bar
# --show-error: but print errors
# --max-time 10: don't block timer cycle if LINE is slow
# -w '%{http_code}': capture status
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
    echo "ALERT DELIVERED via LINE push (HTTP $HTTP_CODE)"
    exit 1
    ;;
  401|403)
    echo "ALERT DELIVERY FAILED: LINE authentication rejected (HTTP $HTTP_CODE)."
    echo "  → check that LINE_CHANNEL_ACCESS_TOKEN is current and the bot can push to LINE_TARGET_ID"
    exit 2
    ;;
  000)
    echo "ALERT DELIVERY FAILED: could not reach LINE API (network/timeout)."
    exit 2
    ;;
  *)
    # Strip token from any echoed response just in case (it shouldn't appear).
    RESP_HEAD="$(head -c 300 "$PUSH_RESP" 2>/dev/null | sed -E "s|${LINE_CHANNEL_ACCESS_TOKEN}|<redacted>|g" 2>/dev/null || true)"
    echo "ALERT DELIVERY FAILED: LINE returned HTTP $HTTP_CODE"
    [ -n "$RESP_HEAD" ] && echo "  body (token-redacted, first 300B): $RESP_HEAD"
    exit 2
    ;;
esac
