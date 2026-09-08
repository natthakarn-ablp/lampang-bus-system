'use strict';

/**
 * scripts/apply-migration-050.sh, executed against a throwaway app directory.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the step that has to happen BEFORE FEATURE_PARTICIPATION_CASES is
 * turned on. scripts/deploy-backend.sh does not apply migrations, and
 * backend/src/index.js refuses to boot when the flag is on and these two
 * tables are absent — in fork mode a refused boot is a crash loop and an
 * outage. The 2026-09-05 closure audit found production with 051 applied and
 * 050 not, which is exactly the state this script exists to leave behind.
 *
 * Its two rails are the only thing standing between a mistyped command and a
 * database change nobody can undo: it refuses to run without a verified
 * backup younger than 48 hours, and it counts the tables before and after and
 * refuses to declare success if the count did not reach two. Neither rail was
 * tested, while the older and far less dangerous restore-drill script had a
 * suite of its own.
 *
 * WHAT THE SCRIPT GUARANTEES (stated exactly, and asserted here)
 * --------------------------------------------------------------
 * It is read-only until one `mysql < migration` invocation, and every refusal
 * before that point leaves the database untouched — a missing input, missing
 * credentials, no backup, a stale backup, or an unreachable server all stop
 * with nothing applied. After that single write it re-counts, and a count that
 * is not two is reported as a failure that explicitly says not to turn the
 * flag on. There is no rollback here and none is claimed: 050 creates two
 * empty tables and nothing else, so the recovery is to drop them.
 *
 * HOW
 * ---
 * The architecture is deployBackendScript.unit.test.js's. A throwaway APP_DIR
 * holding backend/.env and a copy of the REAL migration file, a BACKUP_DIR
 * whose file mtimes are set from the test, and a stub `mysql` handed to the
 * script by ABSOLUTE path through MIGRATION_MYSQL — not through PATH order,
 * which is a hypothesis about how Git Bash resolves a name, not a guarantee.
 * The stub records `$0`, so a case can prove the stub was the thing invoked.
 *
 * The modelled database is a file listing the tables that exist. The stub only
 * creates a table if the SQL it received on stdin actually mentions it, so the
 * happy path passes only because the real migration file reached mysql.
 *
 * Nothing here touches /home/schoolbus, a real database, or a feature flag.
 * Every child process has a timeout.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'apply-migration-050.sh');
const MIGRATION_SRC = path.join(ROOT, 'backend', 'migrations', '050_participation_cases.sql');
const MIGRATION_SQL = fs.readFileSync(MIGRATION_SRC, 'utf8');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

const TABLES = ['participation_cases', 'participation_case_events'];
const PASSWORD = 'fixture-password-never-real';
const toPosix = (p) => p.replace(/\\/g, '/');

function resolveBash() {
  const explicit = process.env.DEPLOY_TEST_BASH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform === 'win32') {
    for (const candidate of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'bash';
}
const BASH = resolveBash();
const bashProbe = (() => {
  try {
    const r = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 20000 });
    return { ok: r.status === 0 && (r.stdout || '').trim() === 'ok', error: r.error && r.error.message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
})();
const hasBash = bashProbe.ok;
const describeWithBash = hasBash ? describe : describe.skip;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const ENV_BASE = [
  'NODE_ENV=production',
  'PORT=3000',
  'DB_HOST=10.0.0.7',
  'DB_PORT=3307',
  'DB_NAME=lampang_bus',
  'DB_USER=schoolbus',
  `DB_PASSWORD=${PASSWORD}`,
  'JWT_SECRET=0123456789abcdef0123456789abcdef',
  '',
].join('\n');

function writeStub(dir) {
  // One stub for both shapes the script uses: `-e QUERY` (read-only) and
  // `DBNAME < file` (the single write). Which one it is decides everything.
  // The queries are multi-line, so the recorded argv is flattened onto one
  // line — a call has to be one entry in the log for a count to mean anything.
  const body = `#!/usr/bin/env bash
printf 'mysql %s\\n' "$(printf '%s ' "$@" | tr '\\n' ' ')" >> "$STUB_LOG"
echo "mysql $0" >> "$STUB_LOG.paths"
defaults=""; query=""; want=0
for a in "$@"; do
  if [ "$want" = 1 ]; then query="$a"; want=0; continue; fi
  case "$a" in
    --defaults-extra-file=*) defaults="\${a#--defaults-extra-file=}" ;;
    -e) want=1 ;;
  esac
done
# Keep a copy of the credentials file, so a test can prove the password
# travelled in a file and never on argv.
[ -n "$defaults" ] && cat "$defaults" > "$STUB_DEFAULTS_BODY"
if [ "\${STUB_MYSQL_EXIT:-0}" != 0 ]; then echo "stub mysql: ERROR 2003 (HY000): Can't connect to MySQL server" >&2; exit "\${STUB_MYSQL_EXIT}"; fi
present() { grep -qx "$1" "$STUB_TABLES" 2>/dev/null; }
if [ -z "$query" ]; then
  cat > "$STUB_APPLIED"
  if [ "\${STUB_APPLY_EXIT:-0}" != 0 ]; then echo "stub mysql: ERROR 1064 (42000) at line 27" >&2; exit "\${STUB_APPLY_EXIT}"; fi
  sql="$(cat "$STUB_APPLIED")"
  for t in ${TABLES.join(' ')}; do
    case " \${STUB_APPLY_SKIP:-} " in *" $t "*) continue ;; esac
    case "$sql" in *"CREATE TABLE IF NOT EXISTS $t"*) present "$t" || echo "$t" >> "$STUB_TABLES" ;; esac
  done
  exit 0
fi
case "$query" in
  *"COUNT(*)"*)
    n=0
    for t in ${TABLES.join(' ')}; do present "$t" && n=$(( n + 1 )); done
    echo "$n"
    ;;
  *table_rows*)
    for t in ${TABLES.join(' ')}; do present "$t" && printf '%s\\t%s\\n' "$t" 0; done
    ;;
  *) echo "stub mysql: unexpected query: $query" >&2; exit 1 ;;
esac
exit 0
`;
  const file = path.join(dir, 'mysql');
  write(file, body);
  fs.chmodSync(file, 0o755);
  return file;
}

const HOUR = 3600 * 1000;

/** APP_DIR (backend/.env + the real migration) + BACKUP_DIR + the mysql stub. */
function makeFixture({ env = ENV_BASE, migration = MIGRATION_SQL, tables = [] } = {}) {
  const base = toPosix(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-050-fixture-')));
  const app = `${base}/app`;
  write(`${app}/backend/.env`, env);
  if (migration !== null) write(`${app}/backend/migrations/050_participation_cases.sql`, migration);
  const backups = `${base}/backups`;
  fs.mkdirSync(backups, { recursive: true });
  const stubs = `${base}/stubs`;
  writeStub(stubs);
  const tablesFile = `${base}/tables.txt`;
  write(tablesFile, tables.length ? `${tables.join('\n')}\n` : '');
  fs.mkdirSync(`${base}/tmp`, { recursive: true });
  // Absolute paths everywhere in the script, so it runs from an empty
  // directory — see the sibling flag suite for why that matters on Git Bash.
  fs.mkdirSync(`${base}/cwd`, { recursive: true });
  return {
    base,
    cwd: `${base}/cwd`,
    app,
    envFile: `${app}/backend/.env`,
    migration: `${app}/backend/migrations/050_participation_cases.sql`,
    backups,
    stubs,
    tablesFile,
    tmp: `${base}/tmp`,
    stubLog: `${base}/stub.log`,
    applied: `${base}/applied.sql`,
    defaultsBody: `${base}/defaults-body.txt`,
  };
}

/** A backup file whose mtime is `ageHours` in the past. */
function addBackup(fx, name, ageHours) {
  const file = path.join(fx.backups, name);
  write(file, 'not a real dump\n');
  const when = new Date(Date.now() - ageHours * HOUR);
  fs.utimesSync(file, when, when);
  return file;
}

const INHERITED_MIGRATION_VARS = ['APP_DIR', 'BACKUP_DIR', 'DRY_RUN', 'SKIP_BACKUP_CHECK', 'MIGRATION_MYSQL', 'TMPDIR'];
function baseEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (INHERITED_MIGRATION_VARS.includes(k) || k.startsWith('STUB_')) continue;
    out[k] = v;
  }
  return out;
}

function envFor(fx, env = {}) {
  return {
    ...baseEnv(),
    // The script reads .env with `grep -oP`, and GNU grep refuses -P outside a
    // unibyte or UTF-8 locale — a Jest child on Windows inherits no LANG at
    // all, and there the reads would come back empty and the script would stop
    // at "DB_USER / DB_NAME / DB_PASSWORD missing" for a reason that has
    // nothing to do with the case under test. The server runs UTF-8; the
    // fixture says so explicitly rather than depending on the machine.
    LANG: 'C.UTF-8',
    APP_DIR: fx.app,
    BACKUP_DIR: fx.backups,
    TMPDIR: fx.tmp,
    MIGRATION_MYSQL: `${fx.stubs}/mysql`,
    STUB_LOG: fx.stubLog,
    STUB_TABLES: fx.tablesFile,
    STUB_APPLIED: fx.applied,
    STUB_DEFAULTS_BODY: fx.defaultsBody,
    ...env,
  };
}

function run(fx, env = {}) {
  const r = spawnSync(BASH, [SCRIPT], { cwd: fx.cwd, encoding: 'utf8', env: envFor(fx, env), timeout: 60000 });
  const calls = fs.existsSync(fx.stubLog) ? fs.readFileSync(fx.stubLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  return {
    ...r,
    out: `${r.stdout}\n${r.stderr}`,
    mysqlCalls: calls,
    tables: fs.readFileSync(fx.tablesFile, 'utf8').split('\n').filter(Boolean),
    applied: fs.existsSync(fx.applied) ? fs.readFileSync(fx.applied, 'utf8') : null,
  };
}

describe('bash for the behavioural fixtures', () => {
  it(`is available (${BASH}); set DEPLOY_TEST_BASH to point at one — a skipped fixture suite is not a passing one`, () => {
    expect(`bash ok: ${hasBash}${hasBash ? '' : ` (${bashProbe.error || 'probe failed'})`}`).toBe('bash ok: true');
  });
});

describeWithBash('apply-migration-050.sh against a throwaway app directory', () => {
  jest.setTimeout(60000);
  let fx;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp dir */ } });

  // ── happy paths ──────────────────────────────────────────────────────────
  it('happy path: names the target, counts before, applies the real file, counts after, lists what it made', () => {
    addBackup(fx, 'lampang_bus-20260908-0300.sql.gz', 2);
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('target database: lampang_bus on 10.0.0.7:3307 (user schoolbus)');
    expect(r.out).toContain('latest backup: lampang_bus-20260908-0300.sql.gz (2h old)');
    expect(r.out).toContain('tables present before: 0 of 2');
    expect(r.out).toContain(`applying ${fx.migration} to lampang_bus ...`);
    expect(r.out).toContain('tables present after: 2 of 2');
    expect(r.out).toContain('participation_cases: created, 0 rows');
    expect(r.out).toContain('participation_case_events: created, 0 rows');
    expect(r.out).toMatch(/next: add FEATURE_PARTICIPATION_CASES=true to backend\/\.env, then pm2 reload/);
    expect(r.tables.sort()).toEqual([...TABLES].sort());
    // The tables exist only because the real file reached mysql on stdin.
    expect(r.applied).toBe(MIGRATION_SQL);
  });

  it('falls back to 127.0.0.1:3306 when the env file does not name a host or port', () => {
    const local = makeFixture({ env: `DB_NAME=lampang_bus\nDB_USER=schoolbus\nDB_PASSWORD=${PASSWORD}\n` });
    try {
      addBackup(local, 'dump.sql.gz', 1);
      const r = run(local);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.out).toContain('target database: lampang_bus on 127.0.0.1:3306 (user schoolbus)');
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it('is idempotent: with both tables already there it stops after the count and says the flag is safe', () => {
    const local = makeFixture({ tables: TABLES });
    try {
      addBackup(local, 'dump.sql.gz', 1);
      const r = run(local);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.out).toContain('tables present before: 2 of 2');
      expect(r.out).toContain('already applied — nothing to do. Safe to turn the flag on.');
      expect(r.applied).toBeNull();
      expect(r.mysqlCalls).toHaveLength(1); // the count, and nothing else
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it('finishes what a half-applied run started: one table present, applies, reaches two', () => {
    const local = makeFixture({ tables: ['participation_cases'] });
    try {
      addBackup(local, 'dump.sql.gz', 1);
      const r = run(local);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.out).toContain('tables present before: 1 of 2');
      expect(r.out).toContain('tables present after: 2 of 2');
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it('DRY_RUN=1 reads the state and changes nothing', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx, { DRY_RUN: '1' });
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain(`DRY RUN: would apply ${fx.migration} to lampang_bus. Nothing was changed.`);
    expect(r.applied).toBeNull();
    expect(r.tables).toEqual([]);
    expect(r.mysqlCalls).toHaveLength(1);
  });

  it('proves the stub was what ran: every recorded $0 is under the stub directory, not a PATH lookup', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx);
    expect(r.status).toBe(0);
    const paths = fs.readFileSync(`${fx.stubLog}.paths`, 'utf8').trim().split('\n');
    const foreign = paths.filter((l) => !l.split(' ')[1].startsWith(fx.stubs));
    expect(`foreign invocations: ${foreign.join('; ')}`).toBe('foreign invocations: ');
    expect(new Set(paths.map((l) => l.split(' ')[0]))).toEqual(new Set(['mysql']));
  });

  // ── the backup rail ──────────────────────────────────────────────────────
  it('no backup at all: refuses, names the script to run, and never opens a connection', () => {
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`no backup found in ${fx.backups} — run scripts/backup-db.sh first (or set SKIP_BACKUP_CHECK=1)`);
    expect(r.mysqlCalls).toEqual([]);
    expect(r.tables).toEqual([]);
    expect(r.applied).toBeNull();
  });

  it('a backup directory that does not exist is the same as no backup', () => {
    const r = run(fx, { BACKUP_DIR: `${fx.base}/nowhere` });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no backup found in/);
    expect(r.mysqlCalls).toEqual([]);
  });

  it('an uncompressed dump is not a backup — only *.sql.gz counts', () => {
    write(path.join(fx.backups, 'lampang_bus-20260908.sql'), 'plain dump\n');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no backup found in/);
    expect(r.mysqlCalls).toEqual([]);
  });

  it('a backup older than 48h: refuses, says how old, and the database is untouched', () => {
    addBackup(fx, 'lampang_bus-20260906-0300.sql.gz', 49);
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('latest backup is 49h old — take a fresh one (or set SKIP_BACKUP_CHECK=1)');
    expect(r.mysqlCalls).toEqual([]);
    expect(r.tables).toEqual([]);
    expect(r.applied).toBeNull();
  });

  it('48h exactly is still accepted — the boundary is <= 48, not < 48', () => {
    addBackup(fx, 'lampang_bus-20260906-0300.sql.gz', 48.5); // integer hours: 48
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('(48h old)');
    expect(r.tables.sort()).toEqual([...TABLES].sort());
  });

  it('judges the NEWEST backup, not the first one it finds', () => {
    // `ls -1t` is what makes this true; an alphabetical listing would have
    // picked the stale one here and refused a database that is well backed up.
    addBackup(fx, 'aaa-old.sql.gz', 70);
    addBackup(fx, 'zzz-fresh.sql.gz', 3);
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('latest backup: zzz-fresh.sql.gz (3h old)');
  });

  it('SKIP_BACKUP_CHECK=1 is the only way past the rail, and it is deliberate', () => {
    const r = run(fx, { SKIP_BACKUP_CHECK: '1' });
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).not.toMatch(/latest backup/);
    expect(r.tables.sort()).toEqual([...TABLES].sort());
  });

  it.each([['0'], ['true'], ['yes'], ['']])('SKIP_BACKUP_CHECK=%p does NOT skip the check — only the literal 1 does', (value) => {
    const r = run(fx, { SKIP_BACKUP_CHECK: value });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no backup found in/);
    expect(r.mysqlCalls).toEqual([]);
  });

  // ── inputs ───────────────────────────────────────────────────────────────
  it('refuses when backend/.env is missing, before anything else', () => {
    fs.rmSync(fx.envFile);
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`env file not found: ${fx.envFile}`);
    expect(r.mysqlCalls).toEqual([]);
  });

  it('refuses when the migration file is missing and suggests the reason', () => {
    const local = makeFixture({ migration: null });
    try {
      addBackup(local, 'dump.sql.gz', 1);
      const r = run(local);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(`migration not found: ${local.migration} (git pull first?)`);
      expect(r.mysqlCalls).toEqual([]);
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it.each([
    ['no DB_ lines at all', 'NODE_ENV=production\nPORT=3000\n'],
    ['a name and a user but no password', 'DB_NAME=lampang_bus\nDB_USER=schoolbus\n'],
    ['a password but no database name', `DB_USER=schoolbus\nDB_PASSWORD=${PASSWORD}\n`],
    ['keys commented out', `# DB_NAME=lampang_bus\n# DB_USER=schoolbus\n# DB_PASSWORD=${PASSWORD}\n`],
  ])('refuses credentials it could not read (%s) rather than connecting with blanks', (_label, env) => {
    const local = makeFixture({ env });
    try {
      addBackup(local, 'dump.sql.gz', 1);
      const r = run(local);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/DB_USER \/ DB_NAME \/ DB_PASSWORD missing in/);
      expect(r.mysqlCalls).toEqual([]);
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  // ── credentials ──────────────────────────────────────────────────────────
  it('never puts the password on argv: it goes through a defaults-file that is gone afterwards', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx);
    expect(r.status).toBe(0);
    const leaked = r.mysqlCalls.filter((l) => l.includes(PASSWORD) || /(^|\s)-p/.test(l));
    expect(`argv carrying credentials: ${leaked.join('; ')}`).toBe('argv carrying credentials: ');
    expect(r.mysqlCalls.every((l) => l.includes('--defaults-extra-file='))).toBe(true);
    // and it really was the credentials that travelled in the file
    const body = fs.readFileSync(fx.defaultsBody, 'utf8');
    expect(body).toContain('[client]');
    expect(body).toContain('host=10.0.0.7');
    expect(body).toContain('port=3307');
    expect(body).toContain('user=schoolbus');
    expect(body).toContain(`password=${PASSWORD}`);
    // The trap cleaned it up: TMPDIR is the fixture's, so nothing is left.
    expect(fs.readdirSync(fx.tmp)).toEqual([]);
  });

  it('cleans the defaults-file up when the run FAILS too', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx, { STUB_MYSQL_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(fs.readFileSync(fx.defaultsBody, 'utf8')).toContain(`password=${PASSWORD}`);
    expect(fs.readdirSync(fx.tmp)).toEqual([]);
  });

  it('the count query asks for raw output — a header row would be read as the count', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx);
    expect(r.status).toBe(0);
    const counts = r.mysqlCalls.filter((l) => l.includes('COUNT(*)'));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((l) => l.includes('-N') && l.includes('-B'))).toBe(true);
  });

  // ── failure after the write ──────────────────────────────────────────────
  it('an unreachable database is reported as such, and nothing is applied', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx, { STUB_MYSQL_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('cannot query lampang_bus — check credentials and connectivity');
    expect(r.applied).toBeNull();
    expect(r.tables).toEqual([]);
  });

  it('a migration that errors half-way stops the script — it never claims a count it did not verify', () => {
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx, { STUB_APPLY_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ERROR 1064/);
    expect(r.out).not.toMatch(/tables present after/);
    expect(r.out).not.toMatch(/Safe to turn the flag on|done\./);
  });

  it('an apply that leaves only one table is a failure, and says NOT to turn the flag on', () => {
    // The dangerous outcome this rail exists for: mysql exits 0, the operator
    // reads "applying …" and turns the flag on, and the boot guard kills the
    // site. The count after is what stops that.
    addBackup(fx, 'dump.sql.gz', 1);
    const r = run(fx, { STUB_APPLY_SKIP: 'participation_case_events' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('tables present after: 1 of 2');
    expect(r.out).toContain('expected 2 tables after applying, found 1 — do NOT turn the flag on yet');
    expect(r.tables).toEqual(['participation_cases']);
  });
});

describe('apply-migration-050.sh source', () => {
  const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('uses LF line endings so the server\'s bash can run it', () => {
    expect(`has CR: ${SRC.includes('\r')}`).toBe('has CR: false');
  });

  it('stops on error, unset variables and a failed pipe', () => {
    expect(SRC).toMatch(/^set -euo pipefail$/m);
  });

  it('keeps the server defaults, so an unset environment behaves exactly as it did', () => {
    expect(code).toMatch(/^APP_DIR="\$\{APP_DIR:-\/home\/schoolbus\/apps\/lampang-bus-system\}"$/m);
    expect(code).toMatch(/^BACKUP_DIR="\$\{BACKUP_DIR:-\/home\/schoolbus\/backups\/lampang-bus\}"$/m);
    expect(code).toMatch(/^ENV_FILE="\$\{APP_DIR\}\/backend\/\.env"$/m);
    expect(code).toMatch(/^MIGRATION="\$\{APP_DIR\}\/backend\/migrations\/050_participation_cases\.sql"$/m);
  });

  it('invokes mysql through MYSQL_BIN — a bare name resolves through PATH', () => {
    const blankStrings = (l) => l.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const bare = code.split('\n').map(blankStrings).filter((l) => /(^|[\s;&|(])mysql\s/.test(l));
    expect(bare).toEqual([]);
    expect(code).toContain('MYSQL_BIN="${MIGRATION_MYSQL:-mysql}"');
  });

  it('writes the credentials to a mode-600 file and removes it on every exit path', () => {
    const chmodAt = code.indexOf('chmod 600 "$DEFAULTS_FILE"');
    const writeAt = code.indexOf('cat > "$DEFAULTS_FILE"');
    expect(`chmod before write: ${chmodAt > -1 && chmodAt < writeAt}`).toBe('chmod before write: true');
    expect(code).toMatch(/trap cleanup EXIT INT TERM/);
    expect(code).toMatch(/rm -f "\$DEFAULTS_FILE"/);
    expect(code).not.toMatch(/-p"?\$\{?DB_PASSWORD/);
  });

  it('the backup rail cannot be weakened by accident: 48 hours, and one named escape hatch', () => {
    expect(code).toMatch(/\[ "\$AGE_H" -le 48 \] \|\| fail/);
    expect(code).toMatch(/SKIP_BACKUP_CHECK:-0\}" != "1"/);
    // `ls -1t` is load-bearing: an alphabetical pick would judge the wrong file.
    expect(code).toMatch(/ls -1t "\$BACKUP_DIR"\/\*\.sql\.gz/);
  });

  it('counts the same tables it expects — EXPECTED and the query cannot drift apart', () => {
    // EXPECTED is ${#TABLES[@]} but the query names TABLES[0] and TABLES[1] by
    // index. A third entry would raise EXPECTED without being counted, and
    // every run would then fail as "expected 3, found 2" — safe, but wrong for
    // a reason nobody would find quickly. Keep the two in step.
    expect(code).toMatch(/^TABLES=\(participation_cases participation_case_events\)$/m);
    expect(code).toMatch(/^EXPECTED="\$\{#TABLES\[@\]\}"$/m);
    expect(code).toContain("table_name IN ('${TABLES[0]}','${TABLES[1]}')");
  });

  it('verifies the result before it tells the operator to turn the flag on', () => {
    const verifyAt = code.indexOf('[ "$AFTER" = "$EXPECTED" ] || fail');
    const nextAt = code.indexOf('next: add FEATURE_PARTICIPATION_CASES=true');
    expect(`verified before advising: ${verifyAt > -1 && verifyAt < nextAt}`).toBe('verified before advising: true');
  });

  it('does not touch the flag itself — that is the other script\'s job, and the order matters', () => {
    // It NAMES the next two steps for the operator, in a quoted string. What
    // it must never do is perform them: creating the tables is safe at any
    // hour precisely because turning the flag on is somebody's separate,
    // deliberate act (scripts/enable-feature-flag.sh, which can roll back).
    expect(SRC).toContain('next: add FEATURE_PARTICIPATION_CASES=true to backend/.env, then pm2 reload');
    const commands = code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(commands).not.toMatch(/FEATURE_/);
    expect(commands).not.toMatch(/pm2/);
    expect(commands).not.toMatch(/\$ENV_FILE"?\s*>/);
  });
});

describe('the migration this script applies', () => {
  // The script's own SAFETY note says 050 "alters nothing, drops nothing", and
  // that claim is why it is documented as safe to run at any hour on a live
  // system. If the file ever stopped being additive, that sentence — and the
  // absence of any rollback in the script — would become wrong.
  const statements = MIGRATION_SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

  it('is additive only: no DROP, ALTER, TRUNCATE, DELETE, INSERT or UPDATE statement', () => {
    const found = (statements.match(/^\s*(DROP|ALTER|TRUNCATE|DELETE|INSERT|UPDATE|REPLACE|GRANT)\b.*/gim) || []);
    expect(`non-additive statements: ${found.join(' | ')}`).toBe('non-additive statements: ');
  });

  it('creates exactly the two tables the script counts, and creates them idempotently', () => {
    const created = (statements.match(/CREATE TABLE IF NOT EXISTS (\w+)/g) || []).map((m) => m.split(' ').pop());
    expect(created.sort()).toEqual([...TABLES].sort());
    expect(statements).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });
});
