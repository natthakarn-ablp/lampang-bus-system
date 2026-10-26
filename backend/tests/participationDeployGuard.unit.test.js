'use strict';

/**
 * Migration 050 has to be described in three places, and they have to agree.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-09-05 closure audit found production with migration 051 applied and
 * migration 050 NOT applied (docs/project-closure/handoff-2026-09-05.md §0.1).
 * `scripts/deploy-backend.sh` is `git pull` + `pm2 reload` and does not apply
 * migrations, so that state persists until somebody runs 050 by hand. If
 * FEATURE_PARTICIPATION_CASES were flipped on in that state, app.js would mount
 * /api/participation and every request to it would die with ER_NO_SUCH_TABLE.
 *
 * Three files have to know about these tables:
 *
 *   migrations/050_participation_cases.sql   creates them in a real database
 *   tests/schema.sql                         creates them in the test database,
 *                                            which is built from that file and
 *                                            NOT by replaying migrations
 *   src/index.js                             refuses to boot with the flag on
 *                                            and the tables absent
 *
 * This is the sibling of sharedStateDeployGuard.unit.test.js, with one
 * deliberate difference: 051's tables are read on every login, so that guard
 * runs unconditionally. 050's tables are read only behind the flag, so this
 * guard MUST return early when the flag is off — otherwise a dark deployment
 * (flag off, migration not yet run, which is production today) would refuse
 * to boot for a feature nobody has turned on.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not execute the guard. That needs a live boot against a database
 * missing the tables, which was done by hand when the guard was added (see the
 * commit message) and is worth repeating if the guard is edited.
 */

const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const MIGRATION = read('migrations', '050_participation_cases.sql');
const ROLLBACK = read('migrations', 'rollback', '050_participation_cases_rollback.sql');
const SCHEMA = read('tests', 'schema.sql');
const INDEX = read('src', 'index.js');
const APP = read('src', 'app.js');

const PARENT = 'participation_cases';
const CHILD = 'participation_case_events';
const TABLES = [PARENT, CHILD];

// `CREATE TABLE participation_cases (` — with or without IF NOT EXISTS, with or
// without backticks. A trailing `\b` would not work here because schema.sql
// writes the name in backticks and a backtick is not a word character.
const creates = (src, t) => new RegExp('CREATE TABLE (?:IF NOT EXISTS )?`?' + t + '`?\\s*\\(').test(src);

function guardBody() {
  const start = INDEX.indexOf('async function assertParticipationCasesMigrationPresent');
  expect(`guard found: ${start !== -1}`).toBe('guard found: true');
  return INDEX.slice(start, INDEX.indexOf('\n}', start));
}

describe('migration 050 and its rollback', () => {
  it('creates both tables', () => {
    const missing = TABLES.filter((t) => !creates(MIGRATION, t));
    expect(`missing from the migration: ${missing.join(', ')}`).toBe('missing from the migration: ');
  });

  it('has a rollback that drops both', () => {
    const missing = TABLES.filter((t) => !new RegExp(`DROP TABLE IF EXISTS ${t}\\b`).test(ROLLBACK));
    expect(`missing from the rollback: ${missing.join(', ')}`).toBe('missing from the rollback: ');
  });

  it('drops the child before the parent, because of the foreign key', () => {
    const child = ROLLBACK.indexOf(`DROP TABLE IF EXISTS ${CHILD}`);
    const parent = ROLLBACK.indexOf(`DROP TABLE IF EXISTS ${PARENT}`);
    expect(`child dropped first: ${child < parent}`).toBe('child dropped first: true');
  });
});

describe('tests/schema.sql knows about them too', () => {
  it('declares both, because the test database is built from this file', () => {
    const missing = TABLES.filter((t) => !creates(SCHEMA, t));
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
  it('names both tables', () => {
    const block = INDEX.slice(INDEX.indexOf('REQUIRED_PARTICIPATION_TABLES'));
    const missing = TABLES.filter((t) => !block.includes(`'${t}'`));
    expect(`not guarded: ${missing.join(', ')}`).toBe('not guarded: ');
  });

  it('is gated on the same flag app.js uses to mount the router', () => {
    // The tables are only read when the router is mounted, and app.js mounts
    // it on env.features.participationCases. The guard has to key off the SAME
    // flag: a different one would either miss the real condition or block a
    // dark deployment where nothing reads the tables.
    expect(`app.js mounts on the flag: ${/if \(env\.features\.participationCases\)/.test(APP)}`)
      .toBe('app.js mounts on the flag: true');
    expect(`guard returns early when the flag is off: ${/if \(!env\.features\.participationCases\) return;/.test(guardBody())}`)
      .toBe('guard returns early when the flag is off: true');
  });

  it('is actually called at startup', () => {
    expect(`invoked: ${/await assertParticipationCasesMigrationPresent\(\);/.test(INDEX)}`)
      .toBe('invoked: true');
  });

  it('exits rather than continuing when a table is missing', () => {
    expect(`exits: ${/process\.exit\(1\)/.test(guardBody())}`).toBe('exits: true');
  });

  it('tells the operator which file to run and which flag to turn off', () => {
    // A fatal that does not name the fix costs an outage's worth of guessing.
    const body = guardBody();
    expect(`names the migration file: ${/050_participation_cases\.sql/.test(body)}`)
      .toBe('names the migration file: true');
    expect(`names the flag to disable: ${/FEATURE_PARTICIPATION_CASES=false/.test(body)}`)
      .toBe('names the flag to disable: true');
  });

  it('warns instead of exiting when the probe itself fails', () => {
    // A permissions hiccup reading information_schema is not evidence that the
    // tables are absent, and blocking boot on an ambiguous probe would turn a
    // transient error into a refusal to start. Same rule as the other guards.
    expect(`has a catch that warns: ${/catch[\s\S]*console\.warn/.test(guardBody())}`)
      .toBe('has a catch that warns: true');
  });
});
