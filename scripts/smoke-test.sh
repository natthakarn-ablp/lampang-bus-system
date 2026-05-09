#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Lampang Bus System — Production Smoke Test
# Usage: bash scripts/smoke-test.sh [base-url]
# Default: http://127.0.0.1:3000
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

BASE="${1:-http://127.0.0.1:3000}"
PASS=0
FAIL=0
TOTAL=0

check() {
  local label="$1"
  local method="$2"
  local url="$3"
  local expect_code="$4"
  local auth="${5:-}"
  local body="${6:-}"

  TOTAL=$((TOTAL + 1))
  local args=(-s -o /tmp/smoke_body -w "%{http_code}" -X "$method")
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer $auth")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")

  local code
  code=$(curl "${args[@]}" "$BASE$url")

  if [ "$code" = "$expect_code" ]; then
    printf "  ✅ %-45s %s\n" "$label" "$code"
    PASS=$((PASS + 1))
  else
    printf "  ❌ %-45s %s (expected %s)\n" "$label" "$code" "$expect_code"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local label="$1"
  local field="$2"
  local expect="$3"
  TOTAL=$((TOTAL + 1))
  local actual
  actual=$(python3 -c "import json; d=json.load(open('/tmp/smoke_body')); print(d.get('$field',''))" 2>/dev/null)
  if [ "$actual" = "$expect" ]; then
    printf "  ✅ %-45s %s=%s\n" "$label" "$field" "$actual"
    PASS=$((PASS + 1))
  else
    printf "  ❌ %-45s %s=%s (expected %s)\n" "$label" "$field" "$actual" "$expect"
    FAIL=$((FAIL + 1))
  fi
}

echo "╔══════════════════════════════════════╗"
echo "║  Lampang Bus System — Smoke Test     ║"
echo "╚══════════════════════════════════════╝"
echo "Base URL: $BASE"
echo ""

# ── 1. Basic connectivity ──
echo "── Connectivity ──"
check "Frontend/HTML" GET "/" 200

# ── 2. Auth flow ──
echo ""
echo "── Auth ──"
check "Login (valid)" POST "/api/auth/login" 200 "" '{"username":"test","password":"1234"}'
TOKEN=$(python3 -c "import json; d=json.load(open('/tmp/smoke_body')); print(d.get('data',{}).get('access_token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "  ⚠️  Could not obtain test token — skipping authenticated tests"
  echo ""
  echo "═══ Results: $PASS/$TOTAL passed, $FAIL failed ═══"
  exit 1
fi

check "Login (invalid)" POST "/api/auth/login" 401 "" '{"username":"test","password":"wrong"}'
check "Auth/me (valid token)" GET "/api/auth/me" 200 "$TOKEN"
check_json "Auth/me returns user" "success" "True"
check "Auth/me (no token)" GET "/api/auth/me" 401

# ── 3. School endpoints ──
echo ""
echo "── School (role=school) ──"
check "School dashboard" GET "/api/school/dashboard" 200 "$TOKEN"
check "School students" GET "/api/school/students?per_page=5" 200 "$TOKEN"
check_json "Students success" "success" "True"
check "School vehicles" GET "/api/school/vehicles" 200 "$TOKEN"
check "School emergencies" GET "/api/school/emergencies?page=1" 200 "$TOKEN"

# ── 4. RBAC isolation ──
echo ""
echo "── RBAC isolation ──"
check "School→province (blocked)" GET "/api/province/dashboard" 403 "$TOKEN"
check "School→admin (blocked)" GET "/api/admin/users" 403 "$TOKEN"
check "School→driver (blocked)" GET "/api/driver/status-today" 403 "$TOKEN"

# ── 5. Driver endpoint ──
echo ""
echo "── Driver ──"
check "Driver login" POST "/api/auth/login" 200 "" '{"username":"นข 1571 ลำปาง","password":"1234"}'
DRV_TOKEN=$(python3 -c "import json; d=json.load(open('/tmp/smoke_body')); print(d.get('data',{}).get('access_token',''))" 2>/dev/null)
if [ -n "$DRV_TOKEN" ]; then
  check "Driver status-today" GET "/api/driver/status-today" 200 "$DRV_TOKEN"
  check "Driver roster" GET "/api/driver/roster?session=morning" 200 "$DRV_TOKEN"
fi

# ── 6. Parent endpoint ──
echo ""
echo "── Parent ──"
check "Parent (no line_user_id)" GET "/api/parent/children" 400

# ── 7. PM2 / process health ──
echo ""
echo "── Process ──"
PM2_STATUS=$(pm2 list 2>/dev/null | grep schoolbus-backend | grep -o "online" || echo "OFFLINE")
TOTAL=$((TOTAL + 1))
if [ "$PM2_STATUS" = "online" ]; then
  printf "  ✅ %-45s %s\n" "PM2 schoolbus-backend" "$PM2_STATUS"
  PASS=$((PASS + 1))
else
  printf "  ❌ %-45s %s\n" "PM2 schoolbus-backend" "$PM2_STATUS"
  FAIL=$((FAIL + 1))
fi

# ── Summary ──
echo ""
echo "════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ ALL PASSED: $PASS/$TOTAL"
else
  echo "  ⚠️  $PASS passed, $FAIL FAILED out of $TOTAL"
fi
echo "════════════════════════════════════════"

rm -f /tmp/smoke_body
exit "$FAIL"
