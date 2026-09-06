#!/usr/bin/env bash
# Safe backend deploy script for schoolbus project.
# Phase 10.15B — validates syntax and unit tests before reloading PM2,
# so a broken code change cannot take the backend down.
#
# History
#   2026-09-05 (docs/ops/deploy-2026-09-05-c0b0d49.md §6): the pull used to be
#   `git pull … || true`, so a failed pull let the script "deploy" whatever was
#   already checked out and report success. Rewritten to fetch, check
#   branch/dirty tree, fast-forward only, record before/after, install when the
#   lockfile moved, and stop before PM2 on any failure up to the reload.
#
#   2026-09-06 (review of 2fc67d1 and of the first rewrite): the gaps below are
#   each closed here and pinned by backend/tests/deployBackendScript.unit.test.js
#   (a throwaway repository with stub pm2/npx/npm/curl/mv):
#     1. A local commit ahead of the remote passed `merge --ff-only` as
#        "already up to date" and was deployed. Now the fetched commit is
#        pinned by full SHA, HEAD must be its ancestor before the merge and
#        equal to it afterwards.
#     2. Two deploys at once raced on FETCH_HEAD, the checkout and
#        node_modules. A directory lock with one owner file per holder pid
#        refuses a second run; a dead holder's file is removed by name and the
#        directory by `rmdir`, so two reclaimers can never delete each other's
#        fresh lock, and a half-written owner file is never proof of a stale
#        lock (see acquire_lock).
#     3. Whether to run `npm ci` was decided by diffing the two commits, so a
#        retry after a failed install (or a pull done by hand first) skipped
#        it. A marker written only by a completed install records which
#        lockfile it satisfied; the install runs whenever marker and lockfile
#        disagree, in a staging directory, and is swapped in afterwards. The
#        previous tree is kept and is put back on EVERY failure after the swap
#        (syntax, tests, reload, health), and a swap that fails half-way puts
#        the live tree back before aborting.
#     4. The rollback reference was the checkout's HEAD. When the operator had
#        pulled by hand first that was not the release that was running. The
#        reference is now the commit /health reports for the expected service
#        before anything moves, validated as a SHA and resolved in the
#        repository; without it the script refuses to start (or, on explicit
#        DEPLOY_UNKNOWN_RUNNING=use-checkout, uses HEAD and says so).
#     5. The health check accepted any HTTP 200 with no timeout. Every probe
#        now has a timeout (HEALTH_TIMEOUT_SEC >= 1; curl treats 0 as no
#        limit), and the body must say success, name the expected service,
#        report the deployed commit and a connected database.
#     6. A history line that could not be written was reported as "recorded".
#        The start line is written before anything moves (a write failure
#        aborts), the end line carries the result, dependency state and exit
#        code, is written while the lock is still held, and a failed end write
#        is reported as such.
#     7. `find` failing inside a process substitution was invisible to set -e.
#        The file list is collected first and must be non-empty.
#     8. A rollback `git reset --hard` would have destroyed edits made in the
#        checkout while the deploy ran. The tree is re-checked before the
#        reset; if it is dirty the rollback is refused and the manual steps
#        are printed instead.
#
# What this script guarantees, stated exactly: every failure up to and
# including the unit tests stops BEFORE `pm2 reload`, and if dependencies were
# already swapped in they are put back. A health-check failure happens after
# the reload by definition; it is answered by rolling code and dependencies
# back to the release that was running before this run and reloading again.
#
# Every path and command below can be overridden by environment for an
# isolated test run. The defaults are the production server's.
#
# Usage:  bash scripts/deploy-backend.sh
# Env:    PROJECT_DIR, BACKEND_DIR, ECOSYSTEM, APP_NAME, DEPLOY_REMOTE,
#         EXPECTED_BRANCH, HEALTH_URL, HEALTH_SERVICE, DEPLOY_LOG,
#         DEPLOY_STATE_DIR, DEPLOY_INSTALL=auto|always|never,
#         DEPLOY_ROLLBACK=auto|never, DEPLOY_UNKNOWN_RUNNING=abort|use-checkout,
#         HEALTH_ATTEMPTS, HEALTH_TIMEOUT_SEC, HEALTH_SLEEP_SEC,
#         LOCK_WAIT_ATTEMPTS, LOCK_ORPHAN_SEC,
#         DEPLOY_CURL, DEPLOY_PM2, DEPLOY_NPM, DEPLOY_NPX, DEPLOY_NODE, DEPLOY_MV
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/schoolbus/apps/lampang-bus-system}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_DIR/backend}"
ECOSYSTEM="${ECOSYSTEM:-$PROJECT_DIR/ecosystem.config.js}"
APP_NAME="${APP_NAME:-schoolbus-backend}"
REMOTE="${DEPLOY_REMOTE:-origin}"
EXPECTED_BRANCH="${EXPECTED_BRANCH:-}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"
# The service name /health must report (backend/package.json "name"), so a
# different process answering on the port cannot pass as ours.
HEALTH_SERVICE="${HEALTH_SERVICE:-lampang-bus-backend}"
# Outside the checkout on purpose: a log inside it would be an untracked file
# in the deployed tree. /home/schoolbus/logs is where the other logs live.
DEPLOY_LOG="${DEPLOY_LOG:-$(dirname "$(dirname "$PROJECT_DIR")")/logs/deploy-history.log}"
# Lock, dependency staging area and the previous node_modules — also outside
# the checkout, beside the logs.
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-$(dirname "$(dirname "$PROJECT_DIR")")/deploy-state}"
DEPLOY_INSTALL="${DEPLOY_INSTALL:-auto}"
DEPLOY_ROLLBACK="${DEPLOY_ROLLBACK:-auto}"
DEPLOY_UNKNOWN_RUNNING="${DEPLOY_UNKNOWN_RUNNING:-abort}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-5}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"
LOCK_WAIT_ATTEMPTS="${LOCK_WAIT_ATTEMPTS:-6}"
LOCK_ORPHAN_SEC="${LOCK_ORPHAN_SEC:-120}"
# The external commands, overridable so a test can point at a stub by absolute
# path instead of relying on PATH order.
CURL_BIN="${DEPLOY_CURL:-curl}"
PM2_BIN="${DEPLOY_PM2:-pm2}"
NPM_BIN="${DEPLOY_NPM:-npm}"
NPX_BIN="${DEPLOY_NPX:-npx}"
NODE_BIN="${DEPLOY_NODE:-node}"
MV_BIN="${DEPLOY_MV:-mv}"
# Written into node_modules by a completed install: the sha256 of
# package.json + package-lock.json that install satisfied.
DEPS_MARKER=".deploy-lockfile.sha256"

RESULT="aborted-before-fetch"
STARTED_RECORD=0
LOCK_DIR=""
LOCK_HELD=0
# untouched | moved-aside | swapped | restored | restore-failed
DEPS_STATE="untouched"
PREV_DEPS="$DEPLOY_STATE_DIR/node_modules.prev"
FAILED_DEPS="$DEPLOY_STATE_DIR/node_modules.failed"
STAGE="$DEPLOY_STATE_DIR/deps-staging"

fail() { echo "[deploy] ABORT: $*" >&2; exit 1; }
now() { date -Is; }
who() { whoami 2>/dev/null || echo unknown; }
record() { mkdir -p "$(dirname "$DEPLOY_LOG")" && echo "$(now) $*" >> "$DEPLOY_LOG"; }
pid_alive() { kill -0 "$1" 2>/dev/null || ps -p "$1" >/dev/null 2>&1; }
is_uint() { [[ "$1" =~ ^[0-9]+$ ]]; }

# ── Lock ─────────────────────────────────────────────────────────────────────
# $DEPLOY_STATE_DIR/deploy-backend.lock/ is the lock (mkdir is atomic). The
# holder writes owner.<pid> — a temp file renamed into place, so a name that
# exists is a complete record. Reclaiming a dead holder removes ITS file by
# name and the directory with rmdir, which fails if anyone else has written a
# file in the meantime; nothing here ever rm -rf's a directory it did not
# create in this run.
lock_owner_files() {
  local f
  for f in "$1"/owner.*; do
    [ -e "$f" ] || continue
    case "$f" in *.tmp) continue ;; esac
    echo "$f"
  done
}
lock_age_sec() {
  local m
  m="$(stat -c %Y "$1" 2>/dev/null || true)"
  if [[ "$m" =~ ^[0-9]+$ ]]; then echo $(( $(date +%s) - m )); else echo 0; fi
}
acquire_lock() {
  local lock="$DEPLOY_STATE_DIR/deploy-backend.lock" attempt f pid holder count age
  for ((attempt = 1; attempt <= LOCK_WAIT_ATTEMPTS + 1; attempt++)); do
    if mkdir "$lock" 2>/dev/null; then
      if ! { printf '%s %s %s\n' "$$" "$(now)" "$(who)" > "$lock/owner.$$.tmp" \
          && mv -f "$lock/owner.$$.tmp" "$lock/owner.$$"; }; then
        rm -f "$lock/owner.$$.tmp" "$lock/owner.$$" 2>/dev/null || true
        fail "created $lock but could not write its owner file — another run may have reclaimed it; rerun"
      fi
      count=0
      while IFS= read -r f; do [ -n "$f" ] && count=$((count + 1)); done <<< "$(lock_owner_files "$lock")"
      if [ "$count" -ne 1 ]; then
        rm -f "$lock/owner.$$" 2>/dev/null || true
        fail "lock $lock has $count owner files after this run wrote its own — a concurrent run collided; rerun"
      fi
      LOCK_DIR="$lock"; LOCK_HELD=1
      return 0
    fi
    # Somebody holds it (or held it). Identify them from the owner file NAME.
    count=0; pid=""; holder=""
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      count=$((count + 1)); pid="${f##*/owner.}"; holder="$(cat "$f" 2>/dev/null || true)"
    done <<< "$(lock_owner_files "$lock")"
    if [ "$count" -eq 1 ] && is_uint "$pid"; then
      if pid_alive "$pid"; then
        fail "another deploy is running (pid $pid, started ${holder#* }) — lock $lock"
      fi
      echo "[deploy] note: stale lock from '${holder:-pid $pid}' (process not running) — reclaiming $lock" >&2
      rm -f "$lock/owner.$pid" 2>/dev/null || true
      rmdir "$lock" 2>/dev/null || true   # fails if someone wrote a new owner meanwhile; the loop re-reads
      continue
    fi
    if [ "$count" -gt 1 ]; then
      fail "lock $lock has $count owner files — two runs collided; if none of the pids is alive remove the directory by hand"
    fi
    # No complete owner file: either a holder between mkdir and its owner
    # write, a half-written file, or a run that died right after mkdir. Only
    # age tells them apart, and only an old directory is treated as orphaned.
    age="$(lock_age_sec "$lock")"
    if [ "$age" -gt "$LOCK_ORPHAN_SEC" ]; then
      echo "[deploy] note: lock $lock has no owner file after ${age}s — treating as orphaned" >&2
      rmdir "$lock" 2>/dev/null || true
      continue
    fi
    [ "$attempt" -le "$LOCK_WAIT_ATTEMPTS" ] && sleep 1
  done
  fail "could not acquire $lock: its owner is not readable yet (no complete owner file after ${LOCK_WAIT_ATTEMPTS}s) — if no deploy is running and the directory is older than ${LOCK_ORPHAN_SEC}s it will be reclaimed on the next run"
}
release_lock() {
  [ "$LOCK_HELD" -eq 1 ] && [ -n "$LOCK_DIR" ] || return 0
  rm -f "$LOCK_DIR/owner.$$" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || echo "[deploy] WARNING: $LOCK_DIR not removed — it holds another run's owner file" >&2
  LOCK_HELD=0
}

finish() {
  local code=$?
  if [ "$STARTED_RECORD" -eq 1 ]; then
    if ! record "end result=$RESULT head=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown) deps=$DEPS_STATE exit=$code"; then
      echo "[deploy] WARNING: the end line was NOT written to $DEPLOY_LOG (result=$RESULT deps=$DEPS_STATE exit=$code) — record it by hand" >&2
    fi
  fi
  release_lock
}
trap finish EXIT

# ── Health helpers ───────────────────────────────────────────────────────────
# One probe, bounded. -f makes a non-2xx an error; --max-time is the bound the
# old loop lacked (curl without it can hang for the TCP timeout on every try).
health_body() { "$CURL_BIN" -fsS --max-time "$HEALTH_TIMEOUT_SEC" "$HEALTH_URL" 2>/dev/null; }

# Grade a /health body against the commit that should be running. Prints one
# token: ok:<commit> | no-body | unparseable | success-false |
# service-mismatch:<name> | commit-mismatch:<commit> | db-disconnected. The
# status code alone said nothing: /health is 200 with the DB down and 200
# from the old process.
health_verdict() {
  "$NODE_BIN" -e '
    const expected = process.argv[1] || "";
    const service = process.argv[2] || "";
    let body = "";
    try { body = require("fs").readFileSync(0, "utf8"); } catch (e) { body = ""; }
    if (!body.trim()) { console.log("no-body"); process.exit(0); }
    let j;
    try { j = JSON.parse(body); } catch (e) { console.log("unparseable"); process.exit(0); }
    const d = (j && j.data) || {};
    const commit = typeof d.commit === "string" ? d.commit.trim() : "";
    const svc = typeof d.service === "string" ? d.service.trim() : "";
    if (!j || j.success !== true) { console.log("success-false"); process.exit(0); }
    if (svc !== service) { console.log("service-mismatch:" + (svc || "none").slice(0, 60)); process.exit(0); }
    if (!/^[0-9a-f]{7,40}$/.test(commit) || !expected.startsWith(commit)) { console.log("commit-mismatch:" + (commit || "none").slice(0, 40)); process.exit(0); }
    if (!(d.database && d.database.connected === true)) { console.log("db-disconnected"); process.exit(0); }
    console.log("ok:" + commit);
  ' "$1" "$HEALTH_SERVICE"
}

# What is running right now, from /health: sets RUNNING_BEFORE to the commit
# (validated as a git SHA, 7-40 hex) when the body names the expected service,
# else "unknown" with RUNNING_DETAIL saying why. Recorded before anything
# moves, because it — not the checkout — is the release a rollback returns to.
RUNNING_BEFORE="unknown"
RUNNING_DETAIL=""
probe_running() {
  local body out svc commit
  RUNNING_BEFORE="unknown"; RUNNING_DETAIL=""
  if ! body="$(health_body)"; then RUNNING_DETAIL="no HTTP 2xx from $HEALTH_URL within ${HEALTH_TIMEOUT_SEC}s"; return 0; fi
  out="$(printf '%s' "$body" | "$NODE_BIN" -e '
    let b = "";
    try { b = require("fs").readFileSync(0, "utf8"); } catch (e) { b = ""; }
    let j = null;
    try { j = JSON.parse(b); } catch (e) { console.log("unparseable"); process.exit(0); }
    const d = (j && j.data) || {};
    const svc = typeof d.service === "string" ? d.service.trim().slice(0, 60) : "";
    const commit = typeof d.commit === "string" ? d.commit.trim().slice(0, 40) : "";
    console.log(svc + " " + commit);
  ' 2>/dev/null || echo unparseable)"
  if [ "$out" = unparseable ]; then RUNNING_DETAIL="the response was not the /health JSON"; return 0; fi
  svc="${out%% *}"; commit="${out#* }"
  if [ "$svc" != "$HEALTH_SERVICE" ]; then RUNNING_DETAIL="/health names service '${svc:-none}', not $HEALTH_SERVICE"; return 0; fi
  if [[ ! "$commit" =~ ^[0-9a-f]{7,40}$ ]]; then RUNNING_DETAIL="/health commit '${commit:-none}' is not a git SHA"; return 0; fi
  RUNNING_BEFORE="$commit"
}

# Poll until the body grades ok for $1 (full sha). Sets HEALTH_STATUS (last
# verdict) and HEALTH_COMMIT (on success). Bounded by attempts × (timeout + sleep).
HEALTH_STATUS="unreachable"
HEALTH_COMMIT=""
wait_for_health() {
  local expected="$1" i body verdict
  HEALTH_STATUS="unreachable"
  for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
    if body="$(health_body)"; then
      verdict="$(printf '%s' "$body" | health_verdict "$expected")"
      case "$verdict" in
        ok:*) HEALTH_STATUS="ok"; HEALTH_COMMIT="${verdict#ok:}"; return 0 ;;
        *) HEALTH_STATUS="$verdict" ;;
      esac
    else
      HEALTH_STATUS="unreachable"
    fi
    [ "$i" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_SLEEP_SEC"
  done
  return 1
}

explain_health() {
  case "$1" in
    unreachable) echo "no HTTP 2xx from $HEALTH_URL within ${HEALTH_TIMEOUT_SEC}s per probe" ;;
    no-body|unparseable) echo "the response was not the /health JSON" ;;
    success-false) echo "/health reported success:false" ;;
    service-mismatch:*) echo "/health names service '${1#service-mismatch:}' — the process answering is not $HEALTH_SERVICE" ;;
    commit-mismatch:*) echo "/health reports commit ${1#commit-mismatch:} — the process answering is not running the deployed commit" ;;
    db-disconnected) echo "/health says the database is not connected" ;;
    *) echo "$1" ;;
  esac
}

# ── Dependencies: put the previous tree back ─────────────────────────────────
# Used on every failure after the swap. Returns 0 when backend/node_modules
# is the previous tree again; the failed tree is kept at $FAILED_DEPS.
restore_prev_deps() {
  [ "$DEPS_STATE" = swapped ] || return 0
  rm -rf "$FAILED_DEPS"
  if [ -d "$BACKEND_DIR/node_modules" ] && ! "$MV_BIN" "$BACKEND_DIR/node_modules" "$FAILED_DEPS"; then
    DEPS_STATE="restore-failed"
    echo "[deploy] ERROR: could not move the new node_modules to $FAILED_DEPS — the NEW tree is still live; previous tree at $PREV_DEPS" >&2
    return 1
  fi
  if ! "$MV_BIN" "$PREV_DEPS" "$BACKEND_DIR/node_modules"; then
    DEPS_STATE="restore-failed"
    echo "[deploy] ERROR: backend has NO node_modules — previous tree at $PREV_DEPS, new tree at $FAILED_DEPS; put one back by hand NOW" >&2
    return 1
  fi
  DEPS_STATE="restored"
  echo "[deploy] Dependencies restored to the previous tree; the new tree is kept at $FAILED_DEPS" >&2
  return 0
}
deps_note() {
  case "$DEPS_STATE" in
    untouched) echo "the live node_modules was not touched" ;;
    restored) echo "the previous node_modules was put back (new tree at $FAILED_DEPS)" ;;
    restore-failed) echo "DEPENDENCY RESTORE FAILED — see the ERROR above" ;;
    *) echo "dependency state: $DEPS_STATE" ;;
  esac
}

# ── 0. Settings, directories and the deploy lock ─────────────────────────────
is_uint "$HEALTH_ATTEMPTS" && [ "$HEALTH_ATTEMPTS" -ge 1 ] || fail "HEALTH_ATTEMPTS must be an integer >= 1 (got '$HEALTH_ATTEMPTS')"
is_uint "$HEALTH_TIMEOUT_SEC" && [ "$HEALTH_TIMEOUT_SEC" -ge 1 ] || fail "HEALTH_TIMEOUT_SEC must be an integer >= 1 — curl treats 0 as no time limit (got '$HEALTH_TIMEOUT_SEC')"
is_uint "$HEALTH_SLEEP_SEC" || fail "HEALTH_SLEEP_SEC must be an integer >= 0 (got '$HEALTH_SLEEP_SEC')"
is_uint "$LOCK_WAIT_ATTEMPTS" || fail "LOCK_WAIT_ATTEMPTS must be an integer >= 0 (got '$LOCK_WAIT_ATTEMPTS')"
is_uint "$LOCK_ORPHAN_SEC" && [ "$LOCK_ORPHAN_SEC" -ge 1 ] || fail "LOCK_ORPHAN_SEC must be an integer >= 1 (got '$LOCK_ORPHAN_SEC')"
case "$DEPLOY_INSTALL" in auto|always|never) ;; *) fail "DEPLOY_INSTALL must be auto, always or never (got '$DEPLOY_INSTALL')" ;; esac
case "$DEPLOY_ROLLBACK" in auto|never) ;; *) fail "DEPLOY_ROLLBACK must be auto or never (got '$DEPLOY_ROLLBACK')" ;; esac
case "$DEPLOY_UNKNOWN_RUNNING" in abort|use-checkout) ;; *) fail "DEPLOY_UNKNOWN_RUNNING must be abort or use-checkout (got '$DEPLOY_UNKNOWN_RUNNING')" ;; esac
[ -n "$HEALTH_SERVICE" ] || fail "HEALTH_SERVICE must not be empty"
[ -d "$PROJECT_DIR" ] || fail "project dir not found: $PROJECT_DIR"
[ -d "$BACKEND_DIR" ] || fail "backend dir not found: $BACKEND_DIR"
mkdir -p "$DEPLOY_STATE_DIR" || fail "cannot create $DEPLOY_STATE_DIR"
acquire_lock
cd "$PROJECT_DIR"

# ── 1. Which branch, is the tree clean, and what is running ──────────────────
BRANCH="$(git symbolic-ref --short -q HEAD || true)"
[ -n "$BRANCH" ] || fail "detached HEAD — check out the deploy branch first"
if [ -n "$EXPECTED_BRANCH" ] && [ "$BRANCH" != "$EXPECTED_BRANCH" ]; then
  fail "on branch '$BRANCH' but EXPECTED_BRANCH='$EXPECTED_BRANCH'"
fi
# Modified or staged TRACKED files block the deploy: a fast-forward over them
# would either fail or silently carry a server-side edit into the release.
# Untracked files (a dist backup, a log) are reported but do not block —
# the first run of this script stopped on its own backup directory.
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | head -10 >&2
  fail "worktree has modified tracked files — a deploy must start from the committed tree (see above)"
fi
UNTRACKED="$(git status --porcelain --untracked-files=normal | grep '^??' || true)"
[ -z "$UNTRACKED" ] || echo "[deploy] note: untracked files present (not blocking): $(echo "$UNTRACKED" | sed 's/^?? //' | tr '\n' ' ')"
BEFORE_FULL="$(git rev-parse HEAD)"
BEFORE="$(git rev-parse --short HEAD)"
probe_running
echo "[deploy] branch=$BRANCH checkout=$BEFORE running=$RUNNING_BEFORE${RUNNING_DETAIL:+ ($RUNNING_DETAIL)} remote=$REMOTE"
# The rollback reference is the release that is RUNNING. If /health cannot
# identify it there is nothing to return to, so the deploy does not start —
# before the fetch, before anything is touched (unless the operator asserts
# the checkout is that release with DEPLOY_UNKNOWN_RUNNING=use-checkout).
ROLLBACK_SOURCE="running"
if [ "$RUNNING_BEFORE" = unknown ]; then
  case "$DEPLOY_UNKNOWN_RUNNING" in
    use-checkout)
      ROLLBACK_FULL="$BEFORE_FULL"; ROLLBACK_SOURCE="checkout-unverified"
      echo "[deploy] WARNING: the running commit is unknown ($RUNNING_DETAIL); DEPLOY_UNKNOWN_RUNNING=use-checkout makes the checkout ($BEFORE) the rollback reference — it is NOT verified to be what was running" >&2 ;;
    *)
      fail "the running release could not be identified ($RUNNING_DETAIL) — a rollback reference cannot be established, so nothing was changed (still at $BEFORE). If the service is known to be down and the checkout is the release to return to, rerun with DEPLOY_UNKNOWN_RUNNING=use-checkout" ;;
  esac
fi

# ── 2. Fetch, pin the target, establish the rollback reference, fast-forward ─
echo "[deploy] Fetching $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH" || fail "git fetch failed — nothing was deployed (still at $BEFORE)"
# Pinned by full SHA the moment it is fetched. Everything after this refers to
# TARGET_FULL, never to FETCH_HEAD, which another process could move.
TARGET_FULL="$(git rev-parse FETCH_HEAD)"
TARGET="$(git rev-parse --short "$TARGET_FULL")"
if [ "$TARGET_FULL" != "$BEFORE_FULL" ] && ! git merge-base --is-ancestor "$BEFORE_FULL" "$TARGET_FULL"; then
  fail "cannot fast-forward $BEFORE -> $TARGET: HEAD is not an ancestor of $REMOTE/$BRANCH (local commits on the server, or a diverged branch) — resolve by hand; still at $BEFORE"
fi
# The running commit is resolved now that the fetch has brought the branch
# history in. A commit the repository does not contain cannot be returned to,
# so the deploy stops here — a rollback to the wrong commit is not a rollback.
if [ "$RUNNING_BEFORE" != unknown ]; then
  ROLLBACK_FULL="$(git rev-parse --verify --quiet "${RUNNING_BEFORE}^{commit}" 2>/dev/null || true)"
  [ -n "$ROLLBACK_FULL" ] || fail "/health reports commit $RUNNING_BEFORE, which this repository does not contain (or it is ambiguous) — cannot establish a rollback reference; nothing was changed (still at $BEFORE)"
fi
ROLLBACK="$(git rev-parse --short "$ROLLBACK_FULL")"
# The start line is written BEFORE anything moves. If it cannot be written
# there is no deploy: the log is the rollback record.
record "start branch=$BRANCH before=$BEFORE target=$TARGET running_before=$RUNNING_BEFORE rollback_ref=$ROLLBACK($ROLLBACK_SOURCE) by=$(who)" \
  || fail "cannot write $DEPLOY_LOG — refusing to deploy without a record (still at $BEFORE)"
STARTED_RECORD=1
RESULT="failed-before-reload"
if [ "$TARGET_FULL" != "$BEFORE_FULL" ]; then
  git merge --ff-only "$TARGET_FULL" || fail "cannot fast-forward $BEFORE -> $TARGET — resolve by hand; still at $BEFORE"
fi
AFTER_FULL="$(git rev-parse HEAD)"
AFTER="$(git rev-parse --short HEAD)"
# A merge that "succeeded" but left HEAD elsewhere (a local commit ahead of
# the remote reports "Already up to date") is not a deploy of the target.
[ "$AFTER_FULL" = "$TARGET_FULL" ] || fail "HEAD is $AFTER after the merge but the fetched commit is $TARGET — refusing to continue"
if [ "$AFTER_FULL" = "$BEFORE_FULL" ]; then
  echo "[deploy] already up to date at $AFTER (re-running checks and reload)"
else
  echo "[deploy] fast-forwarded $BEFORE -> $AFTER"
fi
if [ "$ROLLBACK_FULL" = "$BEFORE_FULL" ]; then
  echo "[deploy] rollback reference: previous commit was $ROLLBACK ($ROLLBACK_SOURCE; recorded in $DEPLOY_LOG)"
else
  echo "[deploy] rollback reference: previous commit was $ROLLBACK ($ROLLBACK_SOURCE) — the checkout was at $BEFORE, which was not what was running"
fi

# ── 3. Dependencies: install whenever the last COMPLETED install does not ────
#       match the lockfile now checked out (or DEPLOY_INSTALL=always)
cd "$BACKEND_DIR"
lockfile_sum() { cat package.json package-lock.json | sha256sum | cut -d' ' -f1; }
WANT_SUM="$(lockfile_sum)" || fail "cannot hash package.json/package-lock.json in $BACKEND_DIR"
HAVE_SUM="$(cat "node_modules/$DEPS_MARKER" 2>/dev/null || echo none)"
case "$DEPLOY_INSTALL" in
  always) DO_INSTALL=1 ;;
  never)  DO_INSTALL=0 ;;
  auto)   if [ "$WANT_SUM" = "$HAVE_SUM" ]; then DO_INSTALL=0; else DO_INSTALL=1; fi ;;
esac
if [ "$DO_INSTALL" -eq 1 ]; then
  if [ "$DEPLOY_INSTALL" = always ]; then WHY="DEPLOY_INSTALL=always"
  elif [ "$HAVE_SUM" = none ]; then WHY="no record of a completed install in node_modules"
  else WHY="lockfile differs from the last completed install"; fi
  echo "[deploy] Installing backend dependencies (npm ci in a staging directory — $WHY)..."
  rm -rf "$STAGE" && mkdir -p "$STAGE" || fail "cannot prepare $STAGE"
  cp package.json package-lock.json "$STAGE/" || fail "cannot copy the package files to $STAGE"
  if [ -f .npmrc ]; then cp .npmrc "$STAGE/"; fi
  # The running process's node_modules is untouched until the new tree is
  # complete. A failed install leaves nothing half-installed, and the next
  # run sees the same mismatch and tries again.
  (cd "$STAGE" && "$NPM_BIN" ci) || fail "npm ci failed — PM2 not reloaded; the live node_modules was not touched; code is at $AFTER, previous $ROLLBACK"
  [ -d "$STAGE/node_modules" ] || fail "npm ci reported success but produced no node_modules in $STAGE"
  echo "$WANT_SUM" > "$STAGE/node_modules/$DEPS_MARKER"
  rm -rf "$PREV_DEPS"
  if [ -d node_modules ]; then
    # mv either renames (atomic) or, across devices, copies and removes the
    # source only after the copy completed — a failure leaves the live tree
    # where it was.
    "$MV_BIN" node_modules "$PREV_DEPS" || fail "could not move the live node_modules aside — nothing changed; the staged install is at $STAGE/node_modules"
    DEPS_STATE="moved-aside"
  fi
  if ! "$MV_BIN" "$STAGE/node_modules" node_modules; then
    if [ "$DEPS_STATE" = moved-aside ]; then
      if "$MV_BIN" "$PREV_DEPS" node_modules; then
        DEPS_STATE="restored"
        fail "could not move the new node_modules into place — the previous tree was put back; the staged install is at $STAGE/node_modules; PM2 not reloaded"
      fi
      DEPS_STATE="restore-failed"
      fail "could not move the new node_modules into place AND could not put the previous tree back — backend has NO node_modules; previous at $PREV_DEPS, new at $STAGE/node_modules — fix by hand NOW; PM2 not reloaded"
    fi
    fail "could not move the new node_modules into place (there was no previous tree); the staged install is at $STAGE/node_modules; PM2 not reloaded"
  fi
  DEPS_STATE="swapped"
  echo "[deploy] Dependencies installed and swapped in; previous tree kept at $PREV_DEPS"
elif [ "$DEPLOY_INSTALL" = never ] && [ "$WANT_SUM" != "$HAVE_SUM" ]; then
  echo "[deploy] WARNING: DEPLOY_INSTALL=never — node_modules does NOT match the lockfile (last completed install: ${HAVE_SUM:0:12}, lockfile now: ${WANT_SUM:0:12}); deploying on the operator's assertion that the live tree is compatible" >&2
else
  echo "[deploy] Dependencies unchanged since the last completed install; skipping npm ci"
fi

# ── 4. Syntax check every source file ────────────────────────────────────────
echo "[deploy] Running backend syntax checks..."
# Collected first: a failure inside `< <(find …)` was invisible to set -e.
FILES=""
if [ -d src ]; then
  FILES="$(find src -name '*.js' -not -path '*/node_modules/*' | sort)" || fail "find failed under $BACKEND_DIR/src"
fi
[ -n "$FILES" ] || { restore_prev_deps || true; fail "no JavaScript files found under $BACKEND_DIR/src — refusing to deploy an empty source tree; $(deps_note)"; }
COUNT=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  "$NODE_BIN" -c "$f" || { restore_prev_deps || true; fail "syntax error in $f — PM2 not reloaded; code is at $AFTER (previous $ROLLBACK); $(deps_note)"; }
  COUNT=$((COUNT + 1))
done <<< "$FILES"
echo "[deploy] All $COUNT backend JS files pass syntax check"

# ── 5. Unit tests (DB-free) ──────────────────────────────────────────────────
echo "[deploy] Running unit tests..."
"$NPX_BIN" jest --config jest.unit.config.js --runInBand --forceExit || { restore_prev_deps || true; fail "unit tests failed — PM2 not reloaded; code is at $AFTER (previous $ROLLBACK); $(deps_note)"; }

# ── 7. Roll back: code and dependencies, then prove the previous commit ──────
# Called after the reload for a failed reload or a failed health check. Never
# returns. "Previous" means the release that was running before this run
# (ROLLBACK), which is the checkout's old HEAD only when nobody pulled by hand.
roll_back() {
  local why="$1" manual dirty
  "$PM2_BIN" describe "$APP_NAME" || true
  if [ "$DEPLOY_ROLLBACK" = never ]; then
    RESULT="health-failed-no-rollback"
    manual="cd \"$PROJECT_DIR\" && git reset --hard $ROLLBACK_FULL"
    if [ "$DEPS_STATE" = swapped ]; then
      manual="$manual && mv \"$BACKEND_DIR/node_modules\" \"$FAILED_DEPS\" && mv \"$PREV_DEPS\" \"$BACKEND_DIR/node_modules\""
    fi
    manual="$manual && $PM2_BIN reload \"$ECOSYSTEM\""
    echo "[deploy] DEPLOY_ROLLBACK=$DEPLOY_ROLLBACK — leaving $AFTER in place ($why). previous commit was $ROLLBACK; to roll back by hand: $manual" >&2
    exit 1
  fi
  if [ "$AFTER_FULL" = "$ROLLBACK_FULL" ] && [ "$DEPS_STATE" != swapped ]; then
    RESULT="health-failed-nothing-to-roll-back"
    echo "[deploy] Nothing changed in this run relative to what was running (code $AFTER, dependencies untouched), so there is nothing to roll back — the failure is in the running service or its database, not in this deploy ($why). previous commit was $ROLLBACK" >&2
    exit 1
  fi
  echo "[deploy] Rolling back to $ROLLBACK ($why)..." >&2
  cd "$PROJECT_DIR"
  if [ "$AFTER_FULL" != "$ROLLBACK_FULL" ]; then
    # The tree was clean when this run started; that is not permission to
    # destroy edits made since. Re-check, and refuse rather than reset over them.
    dirty="$(git status --porcelain --untracked-files=no)"
    if [ -n "$dirty" ]; then
      RESULT="rollback-refused-dirty-tree"
      echo "$dirty" | head -10 >&2
      manual="cd \"$PROJECT_DIR\" && git reset --hard $ROLLBACK_FULL"
      if [ "$DEPS_STATE" = swapped ]; then
        manual="$manual && mv \"$BACKEND_DIR/node_modules\" \"$FAILED_DEPS\" && mv \"$PREV_DEPS\" \"$BACKEND_DIR/node_modules\""
      fi
      manual="$manual && $PM2_BIN reload \"$ECOSYSTEM\""
      echo "[deploy] ROLLBACK REFUSED: tracked files were modified while this deploy ran (above); git reset --hard would destroy them. The service is at $AFTER and unhealthy ($why). Save or discard those edits, then: $manual" >&2
      exit 1
    fi
    if ! git reset -q --hard "$ROLLBACK_FULL"; then
      RESULT="rollback-failed"
      fail "git reset --hard $ROLLBACK_FULL failed — repository left at $(git rev-parse --short HEAD); previous node_modules at $PREV_DEPS"
    fi
  fi
  if ! restore_prev_deps; then
    RESULT="rollback-failed"
    fail "could not restore the previous node_modules — code is back at $ROLLBACK, dependencies are not (see the ERROR above)"
  fi
  if ! "$PM2_BIN" reload "$ECOSYSTEM"; then
    RESULT="rollback-failed"
    fail "pm2 reload failed during rollback — code is back at $ROLLBACK; check '$PM2_BIN describe $APP_NAME'"
  fi
  if wait_for_health "$ROLLBACK_FULL"; then
    RESULT="rolled-back"
    echo "[deploy] Rolled back: running $HEALTH_COMMIT ($ROLLBACK), database connected. $AFTER was NOT deployed — $why" >&2
  else
    RESULT="rolled-back-unhealthy"
    echo "[deploy] Rolled back the code to $ROLLBACK but health still fails: $(explain_health "$HEALTH_STATUS") — the fault is not in $AFTER alone; check the service and the database now" >&2
  fi
  exit 1
}

# ── 6. Reload (pm2 reload), then prove the deployed commit answers ───────────
echo "[deploy] Reloading PM2..."
RESULT="reloaded-unverified"
if ! "$PM2_BIN" reload "$ECOSYSTEM"; then
  echo "[deploy] pm2 reload failed — the process state is unknown; rolling back" >&2
  roll_back "pm2 reload of $AFTER failed"
fi

echo "[deploy] Waiting for health: up to $HEALTH_ATTEMPTS probes (${HEALTH_TIMEOUT_SEC}s timeout + ${HEALTH_SLEEP_SEC}s each); the body must say success, service $HEALTH_SERVICE, commit $AFTER and database connected..."
if wait_for_health "$AFTER_FULL"; then
  RESULT="ok"
  echo "[deploy] Health check OK — running $HEALTH_COMMIT (deployed $AFTER, was $ROLLBACK), database connected"
  exit 0
fi
FIRST_FAILURE="$HEALTH_STATUS"
echo "[deploy] Health check FAILED after reload: $(explain_health "$FIRST_FAILURE")" >&2
roll_back "its health check failed with: $(explain_health "$FIRST_FAILURE")"
