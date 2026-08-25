#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lampang Bus System - Phase 9 evidence collector
#
# Collects gate output into timestamped files for owner/operator sign-off.
# It does not run restore drills, deploys, feature-flag changes, or DB writes.
#
# Usage:
#   BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public
#   bash scripts/collect-phase9-evidence.sh local
#   bash scripts/collect-phase9-evidence.sh public local
#   BASE_URL=http://127.0.0.1:3000 bash scripts/collect-phase9-evidence.sh production
#
# Output:
#   outputs/phase9-evidence/<timestamp>/summary.md
#   outputs/phase9-evidence/<timestamp>/manifest.json
#   outputs/phase9-evidence/<timestamp>/*.log
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_ROOT="${PHASE9_EVIDENCE_DIR:-$ROOT/outputs/phase9-evidence}"
TS="$(date +%Y%m%d-%H%M%S)"
GENERATED_AT="$(date -Iseconds)"
OUT_DIR="$OUT_ROOT/$TS"
SUMMARY="$OUT_DIR/summary.md"
MANIFEST="$OUT_DIR/manifest.json"
GATES_TSV="$OUT_DIR/.gates.tsv"
MODES=("$@")
if [ "${#MODES[@]}" -eq 0 ]; then
  MODES=(public)
fi

mkdir -p "$OUT_DIR" || {
  echo "[evidence] ERROR: cannot create $OUT_DIR" >&2
  exit 1
}

PASS=0
FAIL=0
GIT_HEAD="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"

append_summary() {
  printf '%s\n' "$*" >> "$SUMMARY"
}

sanitize_mode() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

mode_base_url() {
  local mode="$1"
  if [ -n "${BASE_URL:-}" ]; then
    printf '%s' "$BASE_URL"
  elif [ "$mode" = "public" ]; then
    printf '%s' "https://schoolbuslampang.com"
  else
    printf '%s' "http://127.0.0.1:3000"
  fi
}

run_mode() {
  local mode="$1"
  local safe_mode
  local log_file
  local url
  local result
  local gate_summary
  local gate_pass
  local gate_warn
  local gate_fail
  local gate_skip
  safe_mode="$(sanitize_mode "$mode")"
  log_file="$OUT_DIR/gate-$safe_mode.log"
  url="$(mode_base_url "$mode")"

  append_summary ""
  append_summary "## Gate: \`$mode\`"
  append_summary ""
  append_summary "- Base URL: \`$url\`"
  append_summary "- Log: \`$(basename "$log_file")\`"

  echo "[evidence] running mode=$mode base=$url"
  if BASE_URL="$url" "$ROOT/scripts/production-readiness-gate.sh" "$mode" >"$log_file" 2>&1; then
    result="PASS"
    append_summary "- Result: PASS"
    gate_summary="$(grep -E '^\[gate\] summary ' "$log_file" | tail -1 || true)"
    if [ -n "$gate_summary" ]; then
      append_summary "- Gate summary: \`$gate_summary\`"
    fi
    gate_pass="$(printf '%s' "$gate_summary" | sed -n 's/.*pass=\([0-9][0-9]*\).*/\1/p')"
    gate_warn="$(printf '%s' "$gate_summary" | sed -n 's/.*warn=\([0-9][0-9]*\).*/\1/p')"
    gate_fail="$(printf '%s' "$gate_summary" | sed -n 's/.*fail=\([0-9][0-9]*\).*/\1/p')"
    gate_skip="$(printf '%s' "$gate_summary" | sed -n 's/.*skip=\([0-9][0-9]*\).*/\1/p')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$mode" "$url" "$(basename "$log_file")" "$result" \
      "${gate_pass:-}" "${gate_warn:-}" "${gate_fail:-}" "${gate_skip:-}" >> "$GATES_TSV"
    PASS=$((PASS + 1))
    return 0
  fi
  result="FAIL"
  append_summary "- Result: FAIL"
  gate_summary="$(grep -E '^\[gate\] summary ' "$log_file" | tail -1 || true)"
  if [ -n "$gate_summary" ]; then
    append_summary "- Gate summary: \`$gate_summary\`"
  fi
  gate_pass="$(printf '%s' "$gate_summary" | sed -n 's/.*pass=\([0-9][0-9]*\).*/\1/p')"
  gate_warn="$(printf '%s' "$gate_summary" | sed -n 's/.*warn=\([0-9][0-9]*\).*/\1/p')"
  gate_fail="$(printf '%s' "$gate_summary" | sed -n 's/.*fail=\([0-9][0-9]*\).*/\1/p')"
  gate_skip="$(printf '%s' "$gate_summary" | sed -n 's/.*skip=\([0-9][0-9]*\).*/\1/p')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$mode" "$url" "$(basename "$log_file")" "$result" \
    "${gate_pass:-}" "${gate_warn:-}" "${gate_fail:-}" "${gate_skip:-}" >> "$GATES_TSV"
  FAIL=$((FAIL + 1))
  return 1
}

write_manifest() {
  local first
  local mode
  local url
  local log_name
  local result
  local gate_pass
  local gate_warn
  local gate_fail
  local gate_skip
  local modes_json
  local m

  modes_json=""
  for m in "${MODES[@]}"; do
    if [ -n "$modes_json" ]; then
      modes_json="$modes_json, "
    fi
    modes_json="$modes_json\"$(json_escape "$m")\""
  done

  cat > "$MANIFEST" <<EOF
{
  "generated_at": "$(json_escape "$GENERATED_AT")",
  "root": "$(json_escape "$ROOT")",
  "git_head": "$(json_escape "$GIT_HEAD")",
  "modes": [$modes_json],
  "safety": {
    "runs_restore_drill": false,
    "runs_deploy": false,
    "runs_migrations": false,
    "runs_imports": false,
    "runs_feature_flags": false,
    "writes_production_db": false
  },
  "gates": [
EOF

  first=1
  if [ -f "$GATES_TSV" ]; then
    while IFS=$'\t' read -r mode url log_name result gate_pass gate_warn gate_fail gate_skip; do
      if [ "$first" -eq 0 ]; then
        printf ',\n' >> "$MANIFEST"
      fi
      first=0
      cat >> "$MANIFEST" <<EOF
    {
      "mode": "$(json_escape "$mode")",
      "base_url": "$(json_escape "$url")",
      "log": "$(json_escape "$log_name")",
      "result": "$(json_escape "$result")",
      "summary": {
        "pass": ${gate_pass:-0},
        "warn": ${gate_warn:-0},
        "fail": ${gate_fail:-0},
        "skip": ${gate_skip:-0}
      }
    }
EOF
    done < "$GATES_TSV"
  fi

  cat >> "$MANIFEST" <<EOF

  ],
  "remaining_manual_gates": [
    "UAT sign-off for every role",
    "Restore drill against lampang_bus_restore_drill",
    "DPO/legal approval for consent/QR/LINE policy",
    "Owner deployment approval and rollback plan",
    "Postdeploy gate after the approved release"
  ],
  "totals": {
    "passed_gates": $PASS,
    "failed_gates": $FAIL
  }
}
EOF
  rm -f "$GATES_TSV" 2>/dev/null || true
}

cat > "$SUMMARY" <<EOF
# Phase 9 Evidence Pack

- Generated: $GENERATED_AT
- Root: \`$ROOT\`
- Modes: \`${MODES[*]}\`

## Safety

- This collector only runs readiness gates and writes local evidence files.
- It does not run restore drill, deploy, migrations, imports, feature flags, or production DB writes.
- Keep real UAT credentials, secrets, LINE tokens, and raw PII out of attached evidence.

EOF

if [ -n "$GIT_HEAD" ]; then
  append_summary "## Source"
  append_summary ""
  append_summary "- Git HEAD: \`$GIT_HEAD\`"
fi

for mode in "${MODES[@]}"; do
  case "$mode" in
    local|public|production|postdeploy)
      run_mode "$mode" || true
      ;;
    *)
      append_summary ""
      append_summary "## Gate: \`$mode\`"
      append_summary ""
      append_summary "- Result: FAIL"
      append_summary "- Reason: unsupported mode"
      echo "[evidence] unsupported mode=$mode" >&2
      FAIL=$((FAIL + 1))
      ;;
  esac
done

append_summary ""
append_summary "## Remaining Manual Gates"
append_summary ""
append_summary "- UAT sign-off for every role"
append_summary "- Restore drill against \`lampang_bus_restore_drill\`"
append_summary "- DPO/legal approval for consent/QR/LINE policy"
append_summary "- Owner deployment approval and rollback plan"
append_summary "- Postdeploy gate after the approved release"
append_summary ""
append_summary "## Summary"
append_summary ""
append_summary "- Passed gates: $PASS"
append_summary "- Failed gates: $FAIL"
write_manifest
append_summary "- Manifest: \`manifest.json\`"

echo "[evidence] summary: $SUMMARY"
echo "[evidence] manifest: $MANIFEST"
echo "[evidence] pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
