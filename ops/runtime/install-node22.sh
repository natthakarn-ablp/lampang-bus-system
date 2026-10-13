#!/usr/bin/env bash
# One owner-authenticated operation. Never add this to unattended sudo.
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" = 0 ] || { echo 'Owner password sudo is required' >&2; exit 2; }
[ "$#" = 1 ] && [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected reviewed full release SHA' >&2; exit 2; }
RELEASE="$1"
APP=/home/schoolbus/apps/lampang-bus-system
SAVE=/root/schoolbus-node22-20261013
STAGE=/home/schoolbus/deploy-state/node22-stage-20261013
ARCHIVE=node-v22.23.3-linux-x64.tar.xz
SHA=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
NODE_ROOT=/opt/schoolbus-node-v22.23.3
NODE="$NODE_ROOT/bin/node"
DROPIN=/etc/systemd/system/pm2-schoolbus.service.d/30-schoolbus-node22.conf
DEPLOY=/home/schoolbus/deploy-state/deploy-backend.sh
DEPLOY_SHA=6a35438abf5d5ebb0776d5a44bc79f69f7106b5c1577208b443217d3e397c2dd
BRANCH=feat/tracking-security-hardening
PIN="/home/schoolbus/deploy-state/reviewed-$RELEASE.git"
NODE_CHANGED=0
DROPIN_CHANGED=0
RESTART_ATTEMPTED=0
NODE_BEFORE_EXISTS=0
OWNER_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
as_owner() {
  runuser -u schoolbus -- env PATH="$OWNER_PATH" sh -c 'cd /home/schoolbus; exec "$@"' owner-operation "$@"
}
rollback_runtime() {
  local status=$?
  trap - EXIT
  if [ "$status" != 0 ]; then
    set +e
    echo "Runtime operation failed (exit $status); restoring only changes made by this operation" >&2
    if [ "$DROPIN_CHANGED" = 1 ] && cmp -s "$SAVE/dropin.installed" "$DROPIN"; then
      rm -- "$DROPIN"
      systemctl daemon-reload
    fi
    if [ "$NODE_CHANGED" = 1 ]; then
      if [ -L /usr/local/bin/node ] && [ "$(readlink /usr/local/bin/node)" = "$NODE" ]; then
        if [ "$NODE_BEFORE_EXISTS" = 1 ]; then
          cp -a "$SAVE/node.before" /usr/local/bin/node.schoolbus-restore
          mv -Tf /usr/local/bin/node.schoolbus-restore /usr/local/bin/node
        else
          rm -- /usr/local/bin/node
        fi
      else
        echo 'Node link changed externally; refusing to overwrite it' >&2
      fi
      # Code/dependency rollback remains the responsibility of the approved
      # deploy script. This release only changes CI/operator artifacts.
      if [ "$RESTART_ATTEMPTED" = 1 ]; then
        systemctl restart pm2-schoolbus
      fi
    fi
    printf 'FAILED exit=%s; runtime rollback attempted; inspect protected log before retrying\n' "$status" \
      | as_owner tee /home/schoolbus/logs/node22-runtime-status.log >/dev/null
  fi
  exit "$status"
}
umask 077
test ! -e "$SAVE/begin"
test ! -e "$NODE_ROOT"
test ! -e "$DROPIN" && test ! -L "$DROPIN"
test ! -e /home/schoolbus/deploy-state/deploy-backend.lock
install -d -m 700 "$SAVE"
touch "$SAVE/begin"
trap rollback_runtime EXIT
exec > >(tee -a "$SAVE/operation.log") 2>&1
test "$(sha256sum "$DEPLOY" | cut -d ' ' -f 1)" = "$DEPLOY_SHA"
test "$(as_owner /usr/bin/node --version)" = v20.20.2
test -z "$(as_owner git -C "$APP" status --porcelain --untracked-files=no)"
test "$(as_owner git -C "$APP" branch --show-current)" = "$BRANCH"
as_owner git -C "$APP" fetch origin "$BRANCH"
test "$(as_owner git -C "$APP" rev-parse FETCH_HEAD)" = "$RELEASE"
# Refuse application changes in this runtime-only release.
test -z "$(as_owner git -C "$APP" diff --name-only HEAD "$RELEASE" -- backend/src frontend/src backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json ecosystem.config.js)"
as_owner git init --bare "$PIN"
as_owner git --git-dir="$PIN" fetch "$APP" "$RELEASE:refs/heads/$BRANCH"
test "$(as_owner git --git-dir="$PIN" rev-parse "refs/heads/$BRANCH")" = "$RELEASE"
cp "$STAGE/$ARCHIVE" "$SAVE/$ARCHIVE"
chmod 600 "$SAVE/$ARCHIVE"
printf '%s  %s\n' "$SHA" "$SAVE/$ARCHIVE" | sha256sum -c -
xz -t "$SAVE/$ARCHIVE"
cp -a /etc/systemd/system/pm2-schoolbus.service "$SAVE/service.before"
cp -a /home/schoolbus/.pm2/dump.pm2 "$SAVE/pm2-dump.before"
chmod 600 "$SAVE/pm2-dump.before"
if [ -e /usr/local/bin/node ] || [ -L /usr/local/bin/node ]; then
  cp -a /usr/local/bin/node "$SAVE/node.before"
  NODE_BEFORE_EXISTS=1
fi
as_owner bash "$APP/scripts/backup-db.sh"
install -d -m 755 "$NODE_ROOT"
tar -xJf "$SAVE/$ARCHIVE" -C "$NODE_ROOT" --strip-components=1 --no-same-owner
# The protected backup umask must not make the root-owned runtime unreadable
# to the service account. Keep write access root-only, restore read/execute.
chmod -R u=rwX,go=rX "$NODE_ROOT"
test "$("$NODE" --version)" = v22.23.3
NODE_CHANGED=1
ln -s "$NODE" "$SAVE/node.link"
mv -Tf "$SAVE/node.link" /usr/local/bin/node
install -d -m 755 /etc/systemd/system/pm2-schoolbus.service.d
printf '[Service]\nEnvironment=PATH=%s:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' "$NODE_ROOT/bin" > "$SAVE/dropin.installed"
install -m 644 -o root -g root "$SAVE/dropin.installed" "$DROPIN"
DROPIN_CHANGED=1
systemctl daemon-reload
OWNER_PATH="$NODE_ROOT/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
test "$(as_owner node --version)" = v22.23.3
RESTART_ATTEMPTED=1
as_owner env DEPLOY_REMOTE="$PIN" EXPECTED_BRANCH="$BRANCH" bash "$DEPLOY"
as_owner pm2 save
chmod 700 /home/schoolbus/.pm2
find /home/schoolbus/.pm2 -maxdepth 1 -type f -name 'dump.pm2*' -exec chmod 600 {} +
RESTART_ATTEMPTED=1
systemctl restart pm2-schoolbus
HEALTHY=0
for attempt in {1..20}; do
  if curl --max-time 5 --fail --silent http://127.0.0.1:3000/health \
    | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s),d=j.data||{};process.exit(j.success&&d.service==="lampang-bus-backend"&&d.database?.connected&&d.node_version==="v22.23.3"&&process.argv[1].startsWith(d.commit||"!")?0:1)}catch{process.exit(1)}})' "$RELEASE"; then
    HEALTHY=1; break
  fi
  sleep 1
done
test "$HEALTHY" = 1
PM2_PID="$(cat /home/schoolbus/.pm2/pm2.pid)"
[[ "$PM2_PID" =~ ^[0-9]+$ ]]
test "$(readlink -f "/proc/$PM2_PID/exe")" = "$NODE"
printf '%s Node runtime upgraded to v22.23.3; backend and PM2 daemon verified; release=%s\n' "$(date -Is)" "$RELEASE" \
  | as_owner tee /home/schoolbus/logs/node22-runtime-status.log
printf '%s runtime release=%s version=v22.23.3; recovery=%s\n' "$(date -Is)" "$RELEASE" "$SAVE" \
  | as_owner tee -a /home/schoolbus/logs/deploy-history.log >/dev/null
