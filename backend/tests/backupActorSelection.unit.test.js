'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = p => p.replace(/\\/g, '/');
const script = path.resolve(__dirname, '../../scripts/backup-db.sh');

describe('daily backup credential actor selection', () => {
  let base, app, preferred, backups, bin;
  const config = user => `DB_HOST=127.0.0.1\nDB_PORT=3307\nDB_NAME=synthetic\nDB_USER=${user}\nDB_PASSWORD=synthetic-only\n`;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-actor-'));
    app = path.join(base, 'app'); preferred = path.join(base, 'backup.env');
    backups = path.join(base, 'backups'); bin = path.join(base, 'bin');
    fs.mkdirSync(path.join(app, 'backend'), { recursive: true }); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(app, 'backend/.env'), config('legacy'));
    fs.writeFileSync(path.join(bin, 'mysqldump'), `#!/usr/bin/env bash
set -eu
case "$1" in --defaults-extra-file=*) defaults="\${1#*=}";; *) exit 70;; esac
printf '%s\\n' '-- MySQL dump synthetic fixture'
sed -n 's/^user=/actor=/p' "$defaults"
`, { mode: 0o755 });
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));
  function run(extra = {}) {
    const env = { ...process.env, APP_DIR: posix(app), BACKUP_DIR: posix(backups), DB_BACKUP_ENV_FILE: posix(preferred), PATH: posix(bin) + path.delimiter + process.env.PATH, ...extra };
    delete env.ENV_FILE;
    if (Object.hasOwn(extra, 'ENV_FILE')) env.ENV_FILE = extra.ENV_FILE;
    return spawnSync(bash, [posix(script)], { env, encoding: 'utf8', timeout: 15000 });
  }
  function dumpedActor() {
    const dump = fs.readdirSync(backups).find(f => f.endsWith('.sql.gz'));
    return zlib.gunzipSync(fs.readFileSync(path.join(backups, dump))).toString();
  }
  test('preserves legacy deployment before dedicated credentials exist', () => {
    const result = run(); expect(result.status).toBe(0); expect(dumpedActor()).toContain('actor=legacy');
  });
  test('uses the backup actor automatically without changing existing cron', () => {
    fs.writeFileSync(preferred, config('backup'));
    expect(run().status).toBe(0); expect(dumpedActor()).toContain('actor=backup');
  });
  test('explicit operator file takes precedence over dedicated and runtime credentials', () => {
    fs.writeFileSync(preferred, config('backup'));
    const operator = path.join(base, 'operator.env'); fs.writeFileSync(operator, config('operator'));
    expect(run({ ENV_FILE: posix(operator) }).status).toBe(0); expect(dumpedActor()).toContain('actor=operator');
  });
  test('a broken installed credential path fails instead of silently using runtime', () => {
    fs.mkdirSync(preferred);
    expect(run().status).not.toBe(0); expect(fs.existsSync(backups)).toBe(false);
  });
  test.each(['missing', 'empty'])('explicit %s credential path never falls back', type => {
    fs.writeFileSync(preferred, config('backup'));
    expect(run({ ENV_FILE: type === 'empty' ? '' : posix(path.join(base, 'absent.env')) }).status).not.toBe(0);
    expect(fs.existsSync(backups)).toBe(false);
  });
});
