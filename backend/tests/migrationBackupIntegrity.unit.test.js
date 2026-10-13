'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const crypto = require('crypto'), zlib = require('zlib');
const { spawnSync } = require('child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const root = path.resolve(__dirname, '../..');
const posix = p => p.replace(/\\/g, '/');

describe.each(['050', '051'])('migration %s integrity preflight', number => {
  let base, app, backups, marker, mysql, dump;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-integrity-'));
    app = path.join(base, 'app'); backups = path.join(base, 'backups');
    fs.mkdirSync(path.join(app, 'backend/migrations'), { recursive: true });
    fs.mkdirSync(backups);
    fs.writeFileSync(path.join(app, 'backend/.env'), 'DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USER=fixture\nDB_PASSWORD=synthetic-not-real\nDB_NAME=lampang_bus\n');
    const migration = number === '050' ? '050_participation_cases.sql' : '051_shared_security_state.sql';
    fs.copyFileSync(path.join(root, 'backend/migrations', migration), path.join(app, 'backend/migrations', migration));
    marker = path.join(base, 'mysql-invoked');
    mysql = path.join(base, 'mysql');
    fs.writeFileSync(mysql, '#!/usr/bin/env bash\nprintf invoked >> "$FIXTURE_MARKER"\necho 0\n');
    fs.chmodSync(mysql, 0o755);
    dump = path.join(backups, 'fixture.sql.gz');
    fs.writeFileSync(dump, zlib.gzipSync('-- MySQL dump synthetic fixture\n'));
    checksum();
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));
  function checksum() {
    fs.writeFileSync(dump + '.sha256', crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex') + '  fixture.sql.gz\n');
  }
  function run(extra = {}) {
    const env = { ...process.env, LANG: 'C.UTF-8', APP_DIR: posix(app), BACKUP_DIR: posix(backups), MIGRATION_MYSQL: posix(mysql), FIXTURE_MARKER: posix(marker), DRY_RUN: '1', SKIP_BACKUP_CHECK: '0', ...extra };
    return spawnSync(bash, [posix(path.join(root, 'scripts', 'apply-migration-' + number + '.sh'))], { env, encoding: 'utf8', timeout: 20000 });
  }
  test('valid gzip and checksum allow the read-only preflight', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('backup integrity: verified');
    expect(r.stdout).toContain('DRY RUN');
  });
  test('missing sidecar stops before database invocation', () => {
    fs.unlinkSync(dump + '.sha256');
    expect(run().status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
  test('wrong digest stops before database invocation', () => {
    fs.writeFileSync(dump + '.sha256', '0'.repeat(64) + '  fixture.sql.gz\n');
    expect(run().status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
  test('corrupt gzip with matching checksum stops before database invocation', () => {
    fs.writeFileSync(dump, 'not a gzip stream'); checksum();
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('gzip integrity');
    expect(fs.existsSync(marker)).toBe(false);
  });
  test('stale backup stops before database invocation', () => {
    const old = new Date(Date.now() - 50 * 3600000);
    fs.utimesSync(dump, old, old);
    expect(run().status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
  test('bypass requires the existing explicit operator flag', () => {
    fs.unlinkSync(dump + '.sha256');
    expect(run({ SKIP_BACKUP_CHECK: '1' }).status).toBe(0);
    expect(run({ SKIP_BACKUP_CHECK: 'true' }).status).not.toBe(0);
  });
});
