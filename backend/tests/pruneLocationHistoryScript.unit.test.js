'use strict';

/**
 * scripts/prune-location-history.sh — the nightly GPS-history prune.
 *
 * Until 2026-11 the script did not even parse (an unbalanced quote in its
 * .env reader), so the cron it documents would have failed every night. This
 * runs it for real against a stub `mysql` in a throw-away directory:
 *   • it parses (bash -n)
 *   • retention resolves env → backend/.env → default 7
 *   • a non-integer retention is refused before any SQL is built
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/prune-location-history.sh');
const hasBash = spawnSync('bash', ['--version']).status === 0;
const maybe = hasBash ? describe : describe.skip;

maybe('prune-location-history.sh', () => {
  let dir;
  let run;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'backend'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'prune-location-history.sh'));
    fs.writeFileSync(path.join(dir, 'backend', '.env'), 'DB_NAME="x"\nDB_USER=u\nDB_PASSWORD=\'p\'\nDB_HOST=h\n');
    const stub = path.join(dir, 'bin', 'mysql');
    fs.writeFileSync(stub, '#!/bin/bash\necho "$@" >> "$STUB_LOG"\necho 0\n');
    fs.chmodSync(stub, 0o755);
    run = (env = {}, args = ['--dry-run']) => {
      const log = path.join(dir, `log-${Math.random()}`);
      const r = spawnSync('bash', [path.join(dir, 'scripts', 'prune-location-history.sh'), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          LOCATION_HISTORY_RETENTION_DAYS: '',
          ...env,
          STUB_LOG: log,
          PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
        },
      });
      const sql = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      return { ...r, sql };
    };
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('parses', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
  });

  test('defaults to 7 days and reads DB_NAME through the quoted .env value', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('retention=7d dry_run=1 db=x');
    expect(r.sql).toContain('INTERVAL 7 DAY');
  });

  test('environment overrides', () => {
    const r = run({ LOCATION_HISTORY_RETENTION_DAYS: '14' });
    expect(r.stdout).toContain('retention=14d');
  });

  test('a non-integer retention is refused before any SQL', () => {
    const r = run({ LOCATION_HISTORY_RETENTION_DAYS: '7; DROP TABLE x' });
    expect(r.status).toBe(1);
    expect(r.sql).toBe('');
  });

  test('a real (non-dry) run completes', () => {
    const r = run({ LOCATION_HISTORY_RETENTION_DAYS: '7' }, []);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[prune-history] DONE');
    expect(r.sql).toMatch(/DELETE FROM vehicle_location_history WHERE recorded_at < DATE_SUB\(NOW\(\), INTERVAL 7 DAY\)/);
  });
});
