'use strict';

/**
 * Migration 051 has to be described in three places, and they have to agree.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/deploy-backend.sh` is `git pull` followed by `pm2 reload`. It does
 * not apply migrations. So deploying this build onto a database that has not
 * had 051 run is a realistic ordering mistake, not a theoretical one — and it
 * is the worst kind, because the login lockout is read on EVERY login attempt
 * for every role. The first symptom is that nobody can sign in, reported as a
 * 500 that names ER_NO_SUCH_TABLE and nothing else.
 *
 * Three files have to know about these tables:
 *
 *   migrations/051_shared_security_state.sql   creates them in a real database
 *   tests/schema.sql                           creates them in the test database,
 *                                              which is built from that file and
 *                                              NOT by replaying migrations
 *   src/index.js                               refuses to boot without them
 *
 * Forgetting any one of them fails somewhere far from the cause: forgetting
 * schema.sql turned every login in CI into a missing-table error, and
 * forgetting the boot guard turns a deploy into an outage. This compares all
 * three so the next migration that adds an unconditionally-read table cannot
 * quietly skip one.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not execute the guard — that needs a live boot against a database
 * missing the tables. That was done by hand and is worth repeating if the
 * guard is edited: build a copy of the schema, drop the three tables, start
 * the app, and confirm it exits with the FATAL line rather than serving.
 */

const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const MIGRATION = read('migrations', '051_shared_security_state.sql');
const ROLLBACK = read('migrations', 'rollback', '051_shared_security_state_rollback.sql');
const SCHEMA = read('tests', 'schema.sql');
const INDEX = read('src', 'index.js');

const TABLES = ['login_lockouts', 'line_webhook_events_seen', 'line_bind_lockouts'];

describe('migration 051 and its rollback', () => {
  it('creates all three tables', () => {
    const missing = TABLES.filter((t) => !new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(MIGRATION));
    expect(`missing from the migration: ${missing.join(', ')}`).toBe('missing from the migration: ');
  });

  it('has a rollback that drops all three', () => {
    const missing = TABLES.filter((t) => !new RegExp(`DROP TABLE IF EXISTS ${t}\\b`).test(ROLLBACK));
    expect(`missing from the rollback: ${missing.join(', ')}`).toBe('missing from the rollback: ');
  });

  it('does not create the table that is still waiting on a DPO decision', () => {
    // line_link_sessions would hold a phone number in readable form. The DDL
    // proposal makes that a D0-8 decision and it has not been made, so the
    // migration must not quietly include it.
    //
    // The NAME appears in the migration on purpose — a comment explaining the
    // omission — so this asks whether it is created, not whether it is
    // mentioned. Checking for the string alone failed on the explanation.
    expect(`creates line_link_sessions: ${/CREATE TABLE[^;]*line_link_sessions/i.test(MIGRATION)}`)
      .toBe('creates line_link_sessions: false');
    expect(`explains why it is absent: ${/line_link_sessions/.test(MIGRATION)}`)
      .toBe('explains why it is absent: true');
    expect(`names the decision that gates it: ${/D0-8/.test(MIGRATION)}`)
      .toBe('names the decision that gates it: true');
  });
});

describe('tests/schema.sql knows about them too', () => {
  it('declares all three, because the test database is built from this file', () => {
    const missing = TABLES.filter((t) => !new RegExp(`CREATE TABLE ${t}\\b`).test(SCHEMA));
    expect(`missing from schema.sql: ${missing.join(', ')}`).toBe('missing from schema.sql: ');
  });

  it('drops before creating, matching the rest of the file', () => {
    // prepare-test-db.js loads this file into an existing database, so a
    // create without a drop fails the second time it runs.
    const missing = TABLES.filter((t) => !SCHEMA.includes(`DROP TABLE IF EXISTS \`${t}\``));
    expect(`no DROP for: ${missing.join(', ')}`).toBe('no DROP for: ');
  });
});

describe('the boot guard', () => {
  it('names all three tables', () => {
    const block = INDEX.slice(INDEX.indexOf('REQUIRED_SHARED_STATE_TABLES'));
    const missing = TABLES.filter((t) => !block.includes(`'${t}'`));
    expect(`not guarded: ${missing.join(', ')}`).toBe('not guarded: ');
  });

  it('runs on every boot, not behind a feature flag', () => {
    // The guards next to it start with `if (!env.features.X) return;` because
    // their tables are only read when that flag is on. These three are on the
    // unconditional path, so an early return here would defeat the point.
    const start = INDEX.indexOf('async function assertSharedSecurityStateMigrationPresent');
    expect(`guard found: ${start !== -1}`).toBe('guard found: true');
    const body = INDEX.slice(start, INDEX.indexOf('\n}', start));
    expect(`returns early on a flag: ${/if\s*\(!env\.features\./.test(body)}`)
      .toBe('returns early on a flag: false');
  });

  it('is actually called at startup', () => {
    expect(`invoked: ${/await assertSharedSecurityStateMigrationPresent\(\);/.test(INDEX)}`)
      .toBe('invoked: true');
  });

  it('exits rather than continuing when a table is missing', () => {
    const start = INDEX.indexOf('async function assertSharedSecurityStateMigrationPresent');
    const body = INDEX.slice(start, INDEX.indexOf('\n}', start));
    expect(`exits: ${/process\.exit\(1\)/.test(body)}`).toBe('exits: true');
  });

  it('tells the operator which file to run and how to go back', () => {
    // A fatal that does not name the fix costs an outage's worth of guessing.
    const start = INDEX.indexOf('async function assertSharedSecurityStateMigrationPresent');
    const body = INDEX.slice(start, INDEX.indexOf('\n}', start));
    expect(`names the migration file: ${/051_shared_security_state\.sql/.test(body)}`)
      .toBe('names the migration file: true');
    expect(`mentions deploying the previous release: ${/previous release/.test(body)}`)
      .toBe('mentions deploying the previous release: true');
  });

  it('warns instead of exiting when the probe itself fails', () => {
    // A permissions hiccup reading information_schema is not evidence that the
    // tables are absent, and blocking boot on an ambiguous probe would turn a
    // transient error into a refusal to start. Same rule as the guards above.
    const start = INDEX.indexOf('async function assertSharedSecurityStateMigrationPresent');
    const body = INDEX.slice(start, INDEX.indexOf('\n}', start));
    expect(`has a catch that warns: ${/catch[\s\S]*console\.warn/.test(body)}`)
      .toBe('has a catch that warns: true');
  });
});

describe('the deploy script still does not run migrations', () => {
  it('confirms the assumption this guard is built on', () => {
    // If deploy-backend.sh ever starts applying migrations, the guard becomes
    // a belt alongside braces rather than the only thing standing between a
    // deploy and an outage — worth knowing, and worth this test failing so
    // somebody re-reads this file.
    const deploy = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'deploy-backend.sh'), 'utf8');
    expect(`applies migrations: ${/migrations?\//.test(deploy)}`).toBe('applies migrations: false');
    expect(`reloads pm2: ${/pm2 reload/.test(deploy)}`).toBe('reloads pm2: true');
  });
});
