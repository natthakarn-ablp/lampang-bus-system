#!/usr/bin/env bash
# Real CLI fixtures in private temporary directories. No production data/Drive.
set -euo pipefail
umask 077
fixture_scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture_tools=$(mktemp -d -t schoolbus-backup-tools-XXXXXX)
trap 'rm -rf -- "$fixture_tools"' EXIT
if [[ -z ${AGE_TEST_BIN:-} || -z ${AGE_TEST_KEYGEN:-} || -z ${RCLONE_TEST_BIN:-} ]]; then
  curl -fsSL --connect-timeout 10 --max-time 90 --retry 1 \
    https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz \
    -o "$fixture_tools/age.tar.gz"
  printf '%s  %s\n' cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 "$fixture_tools/age.tar.gz" | sha256sum -c -
  tar -xzf "$fixture_tools/age.tar.gz" -C "$fixture_tools"
  curl -fsSL --connect-timeout 10 --max-time 90 --retry 1 \
    https://github.com/rclone/rclone/releases/download/v1.75.0/rclone-v1.75.0-linux-amd64.zip \
    -o "$fixture_tools/rclone.zip"
  printf '%s  %s\n' aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa "$fixture_tools/rclone.zip" | sha256sum -c -
  unzip -q "$fixture_tools/rclone.zip" -d "$fixture_tools"
  export AGE_TEST_BIN="$fixture_tools/age/age"
  export AGE_TEST_KEYGEN="$fixture_tools/age/age-keygen"
  export RCLONE_TEST_BIN="$fixture_tools/rclone-v1.75.0-linux-amd64/rclone"
fi
printf '%s  %s\n' eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c "$AGE_TEST_BIN" | sha256sum -c -
printf '%s  %s\n' f3f9aff817f9766029e50adf9a7963c169e475b8f10c7927823568a0d9443db7 "$RCLONE_TEST_BIN" | sha256sum -c -
python3 -W error::ResourceWarning "$fixture_scripts/test-seal-full-backup.py"
python3 -W error::ResourceWarning "$fixture_scripts/test-copy-sealed-backup.py"
