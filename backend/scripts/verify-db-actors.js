'use strict';
// Destructive synthetic rehearsal only. Never imports the application pool or .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

async function main() {
  const container = process.env.DB_ACTOR_TEST_CONTAINER;
  const port = Number(process.env.DB_ACTOR_TEST_PORT || 3307);
  const password = process.env.DB_ACTOR_TEST_ROOT_PASSWORD;
  assert.equal(process.env.ALLOW_DB_ACTOR_TEST, 'synthetic-local-only');
  assert([3306, 3307].includes(port));
  assert(['synthetic-db-actors-local-only', 'test-root-password'].includes(password));
  assert(!container || /^lampang_db_actors_[0-9]{8}$/.test(container));
  const database = 'lampang_bus_actors_test';
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, multipleStatements: true });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'db-actors-'));
  const accounts = ['actors_runtime_fixture', 'actors_backup_fixture', 'actors_schema_fixture'];
  const actorPassword = 'synthetic-actor-only';
  const connections = [];
  const createdAccounts = [];
  let databaseCreated = false;
  let restoreCreated = false;
  let schedulerBefore;
  const stats = {};
  function command(args, input) {
    const r = container
      ? spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
      : spawnSync(args[0], args.slice(1), { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('Synthetic backup/restore command failed: ' + (r.stderr || r.error?.code || r.status));
    return r.stdout;
  }
  try {
    const [databases] = await admin.query('SHOW DATABASES');
    const allowed = new Set(['mysql', 'sys', 'information_schema', 'performance_schema', 'lampang_bus_test']);
    assert(databases.every(row => allowed.has(row.Database)), 'instance contains an unexpected database; refusing destructive rehearsal');
    const [[scheduler]] = await admin.query('SELECT @@event_scheduler AS value');
    schedulerBefore = scheduler.value;
    // This test instance was explicitly acknowledged with known synthetic root
    // credentials and contains only system schemas plus the CI test database.
    if (schedulerBefore === 'ON') await admin.query('SET GLOBAL event_scheduler=OFF');
    assert.equal((await admin.query("SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [database]))[0][0].n, 0, 'fixture database already exists; do not overwrite');
    for (const user of accounts) {
      assert.equal((await admin.query('SELECT COUNT(*) AS n FROM mysql.user WHERE User=?', [user]))[0][0].n, 0, 'fixture account already exists');
    }
    await admin.query(`CREATE DATABASE ${database}`);
    databaseCreated = true;
    await admin.query(`USE ${database};
      CREATE TABLE sample (id INT PRIMARY KEY, value VARCHAR(40));
      CREATE TABLE audit_fixture (id INT);
      CREATE VIEW sample_view AS SELECT id, value FROM sample`);
    await admin.query('CREATE TRIGGER sample_insert AFTER INSERT ON sample FOR EACH ROW INSERT INTO audit_fixture VALUES (NEW.id)');
    await admin.query('CREATE PROCEDURE sample_routine() SELECT COUNT(*) FROM sample');
    await admin.query('CREATE EVENT sample_event ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM audit_fixture WHERE id < 0');
    for (const user of accounts) {
      await admin.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [user, actorPassword]);
      createdAccounts.push(user);
    }
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${database}.* TO '${accounts[0]}'@'%';
      GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON ${database}.* TO '${accounts[1]}'@'%';
      GRANT SHOW_ROUTINE ON *.* TO '${accounts[1]}'@'%';
      GRANT ALL PRIVILEGES ON ${database}.* TO '${accounts[2]}'@'%';`);
    for (const user of accounts) connections.push(await mysql.createConnection({ host: '127.0.0.1', port, user, password: actorPassword, database }));
    const [runtime, backup, schema] = connections;
    await runtime.beginTransaction();
    await runtime.query("INSERT INTO sample VALUES(1,'synthetic')");
    await runtime.query("UPDATE sample SET value='changed' WHERE id=1");
    assert.equal((await runtime.query('SELECT value FROM sample WHERE id=1'))[0][0].value, 'changed');
    await runtime.rollback();
    assert.equal((await runtime.query('SELECT COUNT(*) AS n FROM sample'))[0][0].n, 0);
    await runtime.query("INSERT INTO sample VALUES(2,'backup-evidence')");
    await runtime.query("INSERT INTO sample VALUES(3,'delete-evidence')");
    await runtime.query('DELETE FROM sample WHERE id=3');
    for (const sql of ['CREATE TABLE denied (id INT)', 'ALTER TABLE sample ADD denied INT', 'DROP TABLE sample', 'TRUNCATE TABLE sample', 'CALL sample_routine()']) {
      await assert.rejects(runtime.query(sql), e => ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_PROCACCESS_DENIED_ERROR'].includes(e.code));
    }
    await assert.rejects(backup.query("UPDATE sample SET value='must-not-change'"), e => e.code === 'ER_TABLEACCESS_DENIED_ERROR');
    await assert.rejects(backup.query('CREATE TABLE denied (id INT)'), e => e.code === 'ER_TABLEACCESS_DENIED_ERROR');
    await schema.query('CREATE TABLE migration_fixture(id INT)');
    await schema.query('ALTER TABLE migration_fixture ADD name VARCHAR(20)');
    await schema.query('DROP TABLE migration_fixture');
    stats.runtime_crud_transactions_and_ddl_denials = true;
    stats.schema_migration_and_rollback = true;
    // Backup needs SHOW_ROUTINE for definitions, never global SELECT.
    const config = `[client]\nhost=127.0.0.1\nport=${container ? 3306 : port}\nuser=${accounts[1]}\npassword=${actorPassword}\n`;
    const configPath = container ? '/tmp/actors-backup-fixture.cnf' : path.join(base, 'backup.cnf');
    if (container) command(['sh', '-c', 'umask 077; cat > /tmp/actors-backup-fixture.cnf'], config);
    else fs.writeFileSync(configPath, config, { mode: 0o600 });
    const dump = command(['mysqldump', '--defaults-extra-file=' + configPath, '--single-transaction', '--quick', '--routines', '--triggers', '--events', '--no-tablespaces', database]);
    for (const token of ['CREATE TABLE', 'sample_view', 'CREATE DEFINER', 'sample_routine', 'sample_insert', 'sample_event', 'backup-evidence']) assert(dump.includes(token), 'backup missing ' + token);
    const restoreConfigPath = container ? '/tmp/actors-root-fixture.cnf' : path.join(base, 'root.cnf');
    const rootConfig = `[client]\nhost=127.0.0.1\nport=${container ? 3306 : port}\nuser=root\npassword=${password}\n`;
    if (container) command(['sh', '-c', 'umask 077; cat > /tmp/actors-root-fixture.cnf'], rootConfig);
    else fs.writeFileSync(restoreConfigPath, rootConfig, { mode: 0o600 });
    const [[restoreScheduler]] = await admin.query('SELECT @@event_scheduler AS value');
    assert.equal(restoreScheduler.value, 'OFF', 'never clone definers/events into a live scheduler');
    await admin.query('CREATE DATABASE lampang_bus_actors_restore_test');
    restoreCreated = true;
    command(['mysql', '--defaults-extra-file=' + restoreConfigPath, 'lampang_bus_actors_restore_test'], dump);
    assert.equal((await admin.query("SELECT value FROM lampang_bus_actors_restore_test.sample WHERE id=2"))[0][0].value, 'backup-evidence');
    for (const [table, field] of [['EVENTS', 'EVENT_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) {
      assert.equal((await admin.query(`SELECT COUNT(*) AS n FROM information_schema.${table} WHERE ${field}='lampang_bus_actors_restore_test'`))[0][0].n, 1);
    }
    stats.full_backup_and_isolated_restore = true;
    console.log(JSON.stringify({ ...stats, fixture_only: true, backend_ddl_privileges: false, backup_global_select: false, backup_global_show_routine: true }));
  } finally {
    for (const c of connections) await c.end();
    // Only clean databases/accounts after this rehearsal created them. An early
    // refusal must never delete a pre-existing fixture belonging to another run.
    if (restoreCreated) await admin.query('DROP DATABASE lampang_bus_actors_restore_test');
    if (databaseCreated) await admin.query(`DROP DATABASE ${database}`);
    for (const user of createdAccounts) await admin.query('DROP USER ?@\'%\'', [user]);
    if (schedulerBefore === 'ON') await admin.query('SET GLOBAL event_scheduler=ON');
    if (container) command(['rm', '-f', '/tmp/actors-backup-fixture.cnf', '/tmp/actors-root-fixture.cnf']);
    await admin.end();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
