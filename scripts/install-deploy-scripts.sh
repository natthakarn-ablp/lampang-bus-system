#!/usr/bin/env bash
# Install the reviewed deploy scripts into deploy-state (OPS-001, 2026-11-08).
#
# The server runs $DEPLOY_STATE_DIR/deploy-backend.sh, a COPY outside the
# checkout, so merging a change to scripts/deploy-backend.sh changes nothing on
# the server until it is installed. This script installs deploy-backend.sh and
# its helper deploy-ci-gate.js from ONE reviewed commit, pinned by full SHA:
#
#   1. the SHA must be on $REMOTE/$BRANCH after a fetch (refs only; the
#      checkout and the running service are not touched);
#   2. both files are taken from that commit's git objects (git show), never
#      from the working tree, and syntax-checked;
#   3. the gate from that same commit checks, read-only, that Full Quality
#      passed on push for that SHA — no green CI, no install;
#   4. under the SAME lock deploy-backend.sh uses (no deploy can run while
#      files are swapped), the current files are backed up, the helper is
#      installed BEFORE the main script (so there is no moment where the new
#      main script exists without its helper), each via a temp file + rename;
#   5. installed bytes are compared with the commit's (sha256), and the
#      installed main script is asked to start: it must get past its own
#      settings and helper checks and stop at the lock this script holds.
#
# Usage (on the server):
#   bash install-deploy-scripts.sh <full-40-hex-sha>       install from that commit
#   bash install-deploy-scripts.sh --restore <stamp>       put a backup set back
#
# Run the copy taken from the same reviewed commit, e.g.:
#   git -C /home/schoolbus/apps/lampang-bus-system show <sha>:scripts/install-deploy-scripts.sh > /tmp/install-deploy-scripts.sh
#   bash /tmp/install-deploy-scripts.sh <sha>
#
# Env (defaults are the production server's; overridden only by the tests):
#   PROJECT_DIR, DEPLOY_STATE_DIR, DEPLOY_REMOTE, INSTALL_BRANCH, DEPLOY_NODE,
#   DEPLOY_LOG, DEPLOY_CI_TOKEN_FILE (passed through to the gate)
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/schoolbus/apps/lampang-bus-system}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-$(dirname "$(dirname "$PROJECT_DIR")")/deploy-state}"
REMOTE="${DEPLOY_REMOTE:-origin}"
BRANCH="${INSTALL_BRANCH:-feat/tracking-security-hardening}"
NODE_BIN="${DEPLOY_NODE:-node}"
DEPLOY_LOG="${DEPLOY_LOG:-$(dirname "$(dirname "$PROJECT_DIR")")/logs/deploy-history.log}"
MAIN=deploy-backend.sh
HELPER=deploy-ci-gate.js
LOCK="$DEPLOY_STATE_DIR/deploy-backend.lock"
LOCK_HELD=0
TMP=""

say()  { echo "[install] $*"; }
fail() { echo "[install] ABORT: $*" >&2; exit 1; }
record() { mkdir -p "$(dirname "$DEPLOY_LOG")" && echo "$(date -Is) $*" >> "$DEPLOY_LOG"; }
sum() { sha256sum "$1" | cut -d' ' -f1; }

cleanup() {
  [ -n "$TMP" ] && rm -rf "$TMP"
  if [ "$LOCK_HELD" -eq 1 ]; then
    rm -f "$LOCK/owner.$$"
    rmdir "$LOCK" 2>/dev/null || echo "[install] WARNING: $LOCK not removed — it holds another owner file" >&2
  fi
}
trap cleanup EXIT

# Same lock format as deploy-backend.sh: a directory made with mkdir (atomic)
# and owner.<pid> holding "pid date user". A deploy started meanwhile sees a
# live owner and refuses; this script refuses if a deploy holds it.
take_lock() {
  mkdir -p "$DEPLOY_STATE_DIR"
  mkdir "$LOCK" 2>/dev/null || fail "lock $LOCK exists — a deploy (or another install) is running or left a lock; nothing was changed"
  LOCK_HELD=1
  printf '%s %s %s\n' "$$" "$(date -Is)" "$(whoami 2>/dev/null || echo unknown)" > "$LOCK/owner.$$.tmp"
  mv -f "$LOCK/owner.$$.tmp" "$LOCK/owner.$$"
}

# Copy $1 to $2 through a temp file in the same directory, then rename.
place() {
  local src="$1" dst="$2" mode="$3"
  cp "$src" "$dst.new.$$"
  chmod "$mode" "$dst.new.$$"
  mv -f "$dst.new.$$" "$dst"
}

# ── --restore <stamp> ────────────────────────────────────────────────────────
if [ "${1:-}" = "--restore" ]; then
  STAMP="${2:-}"
  [[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "--restore needs the backup stamp (YYYYMMDDTHHMMSSZ) printed by the install"
  [ -f "$DEPLOY_STATE_DIR/$MAIN.pre-install-$STAMP" ] || fail "no backup $DEPLOY_STATE_DIR/$MAIN.pre-install-$STAMP"
  take_lock
  place "$DEPLOY_STATE_DIR/$MAIN.pre-install-$STAMP" "$DEPLOY_STATE_DIR/$MAIN" 755
  if [ -f "$DEPLOY_STATE_DIR/$HELPER.pre-install-$STAMP" ]; then
    place "$DEPLOY_STATE_DIR/$HELPER.pre-install-$STAMP" "$DEPLOY_STATE_DIR/$HELPER" 644
  else
    # There was no helper before the install: the restored main script does not
    # call one, so remove the installed copy rather than leave a stray file.
    rm -f "$DEPLOY_STATE_DIR/$HELPER"
  fi
  record "deploy-scripts restored from backup $STAMP by=$(whoami 2>/dev/null || echo unknown)" || true
  say "restored $MAIN$( [ -f "$DEPLOY_STATE_DIR/$HELPER" ] && echo " and $HELPER" || echo "; $HELPER removed (none before)") from backup $STAMP"
  say "$MAIN sha256 $(sum "$DEPLOY_STATE_DIR/$MAIN")"
  exit 0
fi

# ── install <sha> ────────────────────────────────────────────────────────────
SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "give the full 40-character merge SHA whose Full Quality push run is green (got '${SHA:-none}'); nothing was changed"
[ -d "$PROJECT_DIR/.git" ] || fail "no git checkout at $PROJECT_DIR"

say "fetching $REMOTE/$BRANCH (refs only — the checkout is not touched)..."
git -C "$PROJECT_DIR" fetch -q "$REMOTE" "$BRANCH" || fail "git fetch failed; nothing was changed"
HEAD_FULL="$(git -C "$PROJECT_DIR" rev-parse FETCH_HEAD)"
git -C "$PROJECT_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null || fail "$SHA is not in the repository after the fetch; nothing was changed"
git -C "$PROJECT_DIR" merge-base --is-ancestor "$SHA" "$HEAD_FULL" || fail "$SHA is not on $REMOTE/$BRANCH; nothing was changed"

TMP="$(mktemp -d)"
git -C "$PROJECT_DIR" show "$SHA:scripts/$MAIN" > "$TMP/$MAIN" 2>/dev/null || fail "scripts/$MAIN is not in $SHA; nothing was changed"
git -C "$PROJECT_DIR" show "$SHA:scripts/$HELPER" > "$TMP/$HELPER" 2>/dev/null || fail "scripts/$HELPER is not in $SHA — this commit predates the CI gate; nothing was changed"
bash -n "$TMP/$MAIN" || fail "$MAIN from $SHA does not parse; nothing was changed"
"$NODE_BIN" --check "$TMP/$HELPER" || fail "$HELPER from $SHA does not parse; nothing was changed"

say "checking CI for $SHA with the gate from that commit (read-only)..."
set +e
"$NODE_BIN" "$TMP/$HELPER" --sha "$SHA" --branch "$BRANCH"
GATE=$?
set -e
[ "$GATE" -eq 0 ] || fail "CI is not green for $SHA (gate exit $GATE) — not installing; nothing was changed"

take_lock
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -f "$DEPLOY_STATE_DIR/$MAIN" ]; then cp -p "$DEPLOY_STATE_DIR/$MAIN" "$DEPLOY_STATE_DIR/$MAIN.pre-install-$STAMP"; fi
if [ -f "$DEPLOY_STATE_DIR/$HELPER" ]; then cp -p "$DEPLOY_STATE_DIR/$HELPER" "$DEPLOY_STATE_DIR/$HELPER.pre-install-$STAMP"; fi
# Helper first: from here on, whichever main script is in place finds what it needs.
place "$TMP/$HELPER" "$DEPLOY_STATE_DIR/$HELPER" 644
place "$TMP/$MAIN" "$DEPLOY_STATE_DIR/$MAIN" 755

for f in "$MAIN" "$HELPER"; do
  want="$(sum "$TMP/$f")"; have="$(sum "$DEPLOY_STATE_DIR/$f")"
  [ "$want" = "$have" ] || fail "$f installed bytes differ from $SHA ($have != $want) — restore with: bash $0 --restore $STAMP"
  say "$f sha256 $have (matches $SHA)"
done

# The installed main script must find its helper and pass its settings checks;
# it then stops at the lock this script holds, before fetching or moving anything.
set +e
PROBE="$(DEPLOY_TARGET_SHA="$SHA" PROJECT_DIR="$PROJECT_DIR" DEPLOY_STATE_DIR="$DEPLOY_STATE_DIR" LOCK_WAIT_ATTEMPTS=0 \
  bash "$DEPLOY_STATE_DIR/$MAIN" 2>&1)"
set -e
case "$PROBE" in
  *"another deploy is running (pid $$"*) say "installed $MAIN resolves $HELPER and stops at the lock as expected" ;;
  *) echo "$PROBE" | tail -5 >&2
     fail "installed $MAIN did not reach the lock check (see above) — restore with: bash $0 --restore $STAMP" ;;
esac

record "deploy-scripts installed from $SHA backup=$STAMP by=$(whoami 2>/dev/null || echo unknown)" || true
say "done. Backup stamp: $STAMP (undo: bash $0 --restore $STAMP)"
say "next: deploy $SHA with DEPLOY_TARGET_SHA=$SHA (see docs/ops/DEPLOY_CI_GATE.md)"
