'use strict';

/**
 * scripts/restore-drill-db.sh — the operator's restore drill, made
 * rehearsable off the server (2026-09-05, lead-engineer instruction G).
 *
 * The script restores a backup into an ISOLATED database and compares row
 * counts. Its server paths were hard-coded, so the only way to exercise it
 * was on production's MySQL with a real dump. APP_DIR / BACKUP_DIR / ENV_FILE
 * are now environment-overridable, which let the mechanics be rehearsed
 * inside the local MySQL container against a synthetic dump of
 * lampang_bus_staging (61 tables, counts matched, drill DB dropped) — see
 * docs/performance/phase9-rehearsal-2026-09-05.md. The real drill on the
 * server against a real backup remains an approved operator action.
 *
 * Source-level here: the safety rails the rehearsal relied on must stay.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'restore-drill-db.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');
const hasBash = (() => { try { return spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout.trim() === 'ok'; } catch { return false; } })();

describe('restore-drill-db.sh', () => {
  it('has LF line endings — a CR after `set -euo pipefail` broke the first container rehearsal', () => {
    expect(`has CR: ${src.includes('\r')}`).toBe('has CR: false');
  });

  it('keeps the server defaults but lets every path be overridden', () => {
    expect(src).toMatch(/^APP_DIR="\$\{APP_DIR:-\/home\/schoolbus\/apps\/lampang-bus-system\}"$/m);
    expect(src).toMatch(/^BACKUP_DIR="\$\{BACKUP_DIR:-\/home\/schoolbus\/backups\/lampang-bus\}"$/m);
    expect(src).toMatch(/^ENV_FILE="\$\{ENV_FILE:-\$\{APP_DIR\}\/backend\/\.env\}"$/m);
  });

  it('still refuses to target the production database or a system schema', () => {
    for (const name of ['lampang_bus', 'production', 'mysql', 'information_schema', 'performance_schema', 'sys']) {
      expect(src).toContain(`"${name}"`);
    }
    expect(src).toMatch(/refuse to target reserved\/production DB/);
    expect(src).toMatch(/RESTORE_DB matches production DB_NAME/);
  });

  it('verifies the backup before restoring and never puts the password on argv', () => {
    expect(src).toMatch(/sha256sum -c/);
    expect(src).toMatch(/gzip -t/);
    expect(src).toMatch(/--defaults-extra-file=/);
    expect(src).toMatch(/unset DB_PASSWORD/);
    expect(src).not.toMatch(/-p"?\$DB_PASSWORD/);
  });

  it('drops the drill database only when asked, and never the source', () => {
    expect(src).toMatch(/CLEAN_RESTORE_DRILL:-0/);
    expect(src).toMatch(/DROP DATABASE IF EXISTS \\`\$RESTORE_DB\\`/);
    expect(src).not.toMatch(/DROP DATABASE IF EXISTS \\`\$DB_NAME\\`/);
  });

  (hasBash ? it : it.skip)('parses', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    expect(`bash -n exit ${r.status}: ${r.stderr}`).toBe('bash -n exit 0: ');
  });
});
