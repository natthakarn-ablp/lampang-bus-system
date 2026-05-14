#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lampang Bus System — FAIL-only Health Smoke Alerter (Phase 9.19)
#
# Purpose:  Run scripts/health-smoke.sh, capture its output, and send a LINE
#           push alert ONLY when the smoke script exits non-zero. With the
#           Phase 9.19 debounce in place, an ongoing FAIL with the same
#           signature is reported once, not every 30 minutes.
#
#           [PASS] / [BASELINE] / [WARN] observations are NEVER alerted —
#           the smoke script exits 0 in those cases and this wrapper stays
#           silent. As a recovery courtesy, the first PASS after a previous
#           FAIL sends one "recovered" notification (toggle via
#           ALERT_RECOVERY_ENABLED).
#
# Usage:    bash scripts/health-smoke-alert.sh
#           (typically driven by schoolbus-health-alert.timer)
#
# Exit:     0   smoke passed; no alert needed (recovery may have been sent)
#           1   smoke failed AND alert delivered
#           2   smoke failed AND alert could not be delivered (missing
#               creds, network error, non-2xx from LINE, or duplicate
#               suppressed by debounce)
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
# Safety:   no sudo, no service restarts, no DB mutations. State writes
#           are limited to $ALERT_STATE_DIR and contain only hashes,
#           epoch ints, and "PASS"/"FAIL" strings — never secrets.
#           Token is never echoed. Curl headers carrying the bearer token
#           are never traced.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

APP_DIR="/home/schoolbus/apps/lampang-bus-system"
SMOKE_SCRIPT="$APP_DIR/scripts/health-smoke.sh"
SERVICE_NAME="lampang-bus-system"
LINE_PUSH_ENDPOINT="https://api.line.me/v2/bot/message/push"
MAX_MSG_CHARS=4900   # LINE hard cap is 5000 per text; keep margin

# ─── Phase 9.19 debounce constants ─────────────────────────────────────────
# State directory lives outside the repo (under /var/lib/schoolbus/) so it
# survives deploys without polluting git. Contents: hashes + epoch ints +
# PASS/FAIL strings — never secrets.
ALERT_STATE_DIR="/var/lib/schoolbus/health-alert"
ALERT_DEBOUNCE_SECONDS=21600   # 6 h — suppress duplicate alerts within this window
ALERT_RECOVERY_ENABLED=1       # 0 to disable PASS-after-FAIL notifications

cd "$APP_DIR" 2>/dev/null || { echo "FATAL: cannot cd to $APP_DIR"; exit 3; }

SMOKE_OUT="$(mktemp -t health-smoke-out.XXXXXX)"
PUSH_BODY="$(mktemp -t health-smoke-push.XXXXXX.json)"
PUSH_RESP="$(mktemp -t health-smoke-resp.XXXXXX)"
trap 'rm -f "$SMOKE_OUT" "$PUSH_BODY" "$PUSH_RESP"' EXIT
chmod 0600 "$PUSH_BODY" 2>/dev/null || true

NOW_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
NOW_EPOCH="$(date -u '+%s')"
HOST="$(hostname -s 2>/dev/null || hostname || echo unknown)"
HEAD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ─── State helpers ─────────────────────────────────────────────────────────
# Read a state file. Missing or unreadable → empty string. Never errors.
state_read() {
  local key="$1"
  [ -r "$ALERT_STATE_DIR/$key" ] && cat "$ALERT_STATE_DIR/$key" 2>/dev/null || true
}

# Write a state file atomically. Best-effort; failures log a WARN but do
# not abort the wrapper.
state_write() {
  local key="$1" value="$2"
  if [ ! -w "$ALERT_STATE_DIR" ]; then
    return 1
  fi
  local tmp="$ALERT_STATE_DIR/.$key.tmp.$$"
  printf '%s' "$value" > "$tmp" 2>/dev/null && mv -f "$tmp" "$ALERT_STATE_DIR/$key" 2>/dev/null
}

# Check whether debounce is active for this run. Sets STATE_OK=1 if usable.
STATE_OK=0
STATE_WARN=""
if [ -d "$ALERT_STATE_DIR" ] && [ -w "$ALERT_STATE_DIR" ]; then
  STATE_OK=1
else
  STATE_WARN="WARN: state dir $ALERT_STATE_DIR not writable — debounce inactive (every FAIL will alert)"
fi

# Compute a stable failure signature from safe data only.
# Canonical body = [FAIL] lines + summary line, ANSI-stripped, trim trailing WS.
# Identical underlying incidents produce the same SHA-256.
fail_signature() {
  local src="$1"
  awk '/\[FAIL\]/ || /^[[:space:]]*PASS:[[:space:]]*[0-9]+/' "$src" \
    | sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g; s/[[:space:]]+$//' \
    | sha256sum \
    | awk '{print $1}'
}

# Build the standard alert/recovery message.
build_message() {
  local kind="$1" smoke_exit="$2" summary="$3" tail_lines="$4" debounce_note="$5"
  local emoji subj
  case "$kind" in
    fail)     emoji="🚨"; subj="Lampang Bus health smoke FAILED" ;;
    recover)  emoji="✅"; subj="Lampang Bus health RECOVERED" ;;
    reminder) emoji="🚨"; subj="Lampang Bus health still FAILING (${ALERT_DEBOUNCE_SECONDS}s reminder)" ;;
    *)        emoji="ℹ️"; subj="Lampang Bus health notice" ;;
  esac
  local body
  body="$(printf '%s %s\nservice: %s\nhost: %s\ntime: %s\ngit HEAD: %s\nsmoke exit: %s\n\n%s' \
    "$emoji" "$subj" "$SERVICE_NAME" "$HOST" "$NOW_UTC" "$HEAD_SHA" "$smoke_exit" "$summary")"
  if [ -n "$debounce_note" ]; then
    body="$body"$'\n'"$debounce_note"
  fi
  if [ -n "$tail_lines" ]; then
    body="$body"$'\n\n--- tail ---\n'"$tail_lines"
  fi
  if [ "${#body}" -gt "$MAX_MSG_CHARS" ]; then
    body="${body:0:$MAX_MSG_CHARS}"$'\n…(truncated)'
  fi
  printf '%s' "$body"
}

# Send one LINE push. Echoes a single status line. Returns 0 on 2xx, 1 otherwise.
# Token is read from env, used only in the Authorization header.
send_line_push() {
  local message="$1"
  if [ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] || [ -z "${LINE_TARGET_ID:-}" ]; then
    echo "ALERT NOT DELIVERED: missing LINE_CHANNEL_ACCESS_TOKEN or LINE_TARGET_ID"
    echo "  → configure /etc/schoolbus/health-alert.env (root:schoolbus, 0640)"
    echo "  → see docs/phase-9-ops-notes.md Section 15"
    return 1
  fi
  TARGET_ID="$LINE_TARGET_ID" MSG="$message" python3 - <<'PY' > "$PUSH_BODY"
import json, os
print(json.dumps({
    "to": os.environ["TARGET_ID"],
    "messages": [{"type": "text", "text": os.environ["MSG"]}],
}))
PY
  chmod 0600 "$PUSH_BODY" 2>/dev/null || true
  local code
  code="$(curl --silent --show-error --max-time 10 \
    -o "$PUSH_RESP" \
    -w '%{http_code}' \
    -X POST "$LINE_PUSH_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
    --data @"$PUSH_BODY" \
    2>/dev/null || echo "000")"
  case "$code" in
    200|201|202)
      echo "ALERT DELIVERED via LINE push (HTTP $code)"
      return 0
      ;;
    401|403)
      echo "ALERT DELIVERY FAILED: LINE authentication rejected (HTTP $code)."
      echo "  → check that LINE_CHANNEL_ACCESS_TOKEN is current and the bot can push to LINE_TARGET_ID"
      return 1
      ;;
    000)
      echo "ALERT DELIVERY FAILED: could not reach LINE API (network/timeout)."
      return 1
      ;;
    *)
      local head=""
      if [ -s "$PUSH_RESP" ]; then
        head="$(head -c 300 "$PUSH_RESP" 2>/dev/null | sed -E "s|${LINE_CHANNEL_ACCESS_TOKEN}|<redacted>|g" 2>/dev/null || true)"
      fi
      echo "ALERT DELIVERY FAILED: LINE returned HTTP $code"
      [ -n "$head" ] && echo "  body (token-redacted, first 300B): $head"
      return 1
      ;;
  esac
}

# ─── Run smoke (or simulate failure for wiring tests) ──────────────────────
if [ "${FORCE_FAIL:-0}" = "1" ]; then
  printf 'FORCED FAILURE (FORCE_FAIL=1) — smoke not actually run\n  [FAIL] synthetic failure for wiring test\n  PASS: 0   BASELINE: 0   WARN: 0   FAIL: 1   SKIP: 0\n  HEALTH SMOKE FAILED\n' > "$SMOKE_OUT"
  cat "$SMOKE_OUT"
  SMOKE_EXIT=1
elif [ ! -x "$SMOKE_SCRIPT" ]; then
  echo "FATAL: smoke script not executable: $SMOKE_SCRIPT"
  SMOKE_EXIT=3
  printf 'Smoke script missing or not executable: %s\n' "$SMOKE_SCRIPT" > "$SMOKE_OUT"
else
  bash "$SMOKE_SCRIPT" 2>&1 | tee "$SMOKE_OUT"
  SMOKE_EXIT="${PIPESTATUS[0]}"
fi

[ -n "$STATE_WARN" ] && { echo; echo "$STATE_WARN"; }

# Extract summary + tail once (cheap; both branches may use them).
strip_ansi() { sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g'; }
SUMMARY_LINE="$(strip_ansi < "$SMOKE_OUT" | grep -E 'PASS:[[:space:]]*[0-9]+' | tail -1 | sed 's/^[[:space:]]*//')"
[ -z "$SUMMARY_LINE" ] && SUMMARY_LINE="(no summary line captured)"
TAIL_LINES="$(strip_ansi < "$SMOKE_OUT" | tail -20 | sed 's/^[[:space:]]*//')"

# ─── Quiet path: smoke healthy ─────────────────────────────────────────────
if [ "$SMOKE_EXIT" = "0" ]; then
  if [ "$STATE_OK" = "1" ]; then
    LAST_STATUS="$(state_read last_status)"
    if [ "$LAST_STATUS" = "FAIL" ] && [ "$ALERT_RECOVERY_ENABLED" = "1" ]; then
      echo
      echo "Smoke now PASSING after previous FAIL — sending recovery notification."
      RECOVER_MSG="$(build_message recover 0 "$SUMMARY_LINE" "" "")"
      send_line_push "$RECOVER_MSG"
      state_write last_status PASS || echo "WARN: could not update last_status"
    elif [ "$LAST_STATUS" = "FAIL" ] && [ "$ALERT_RECOVERY_ENABLED" != "1" ]; then
      echo
      echo "Smoke now PASSING after previous FAIL — recovery notification disabled (ALERT_RECOVERY_ENABLED=$ALERT_RECOVERY_ENABLED)."
      state_write last_status PASS || true
    else
      state_write last_status PASS || true
    fi
  fi
  echo
  echo "No alert sent (smoke exit 0)."
  exit 0
fi

# ─── Alert path: smoke FAIL or could not run ───────────────────────────────
echo
echo "Smoke exit code: $SMOKE_EXIT — evaluating alert policy."

NEW_HASH="$(fail_signature "$SMOKE_OUT")"

# Default decision: SEND. We override to SUPPRESS only when debounce applies.
DECISION="send"
DEBOUNCE_NOTE=""
KIND="fail"

if [ "$STATE_OK" = "1" ]; then
  LAST_HASH="$(state_read last_fail_hash)"
  LAST_ALERT_TIME="$(state_read last_alert_time)"
  LAST_ALERT_TIME="${LAST_ALERT_TIME:-0}"
  LAST_STATUS="$(state_read last_status)"
  AGE=$(( NOW_EPOCH - LAST_ALERT_TIME ))

  if [ "$LAST_STATUS" = "FAIL" ] && [ -n "$LAST_HASH" ] && [ "$LAST_HASH" = "$NEW_HASH" ]; then
    if [ "$AGE" -lt "$ALERT_DEBOUNCE_SECONDS" ] 2>/dev/null; then
      DECISION="suppress"
      DEBOUNCE_NOTE="(suppressing duplicate; last alert ${AGE}s ago, debounce window ${ALERT_DEBOUNCE_SECONDS}s)"
    else
      KIND="reminder"
      DEBOUNCE_NOTE="(reminder: same failure has persisted for ≥ ${ALERT_DEBOUNCE_SECONDS}s)"
    fi
  fi
fi

# Always record fail-time and FAIL status so a future PASS can trigger recovery.
state_write last_fail_time "$NOW_EPOCH" || true
state_write last_status FAIL || true
state_write last_fail_hash "$NEW_HASH" || true

if [ "$DECISION" = "suppress" ]; then
  echo "Duplicate FAIL suppressed by debounce $DEBOUNCE_NOTE"
  # Smoke still failed — exit 2 to keep the systemd unit's status accurate.
  exit 2
fi

# Build + send the alert.
ALERT_MSG="$(build_message "$KIND" "$SMOKE_EXIT" "$SUMMARY_LINE" "$TAIL_LINES" "$DEBOUNCE_NOTE")"
if send_line_push "$ALERT_MSG"; then
  state_write last_alert_time "$NOW_EPOCH" || true
  exit 1
else
  # Delivery failure — keep last_alert_time unchanged so the next run retries
  # instead of being silenced by debounce.
  exit 2
fi
