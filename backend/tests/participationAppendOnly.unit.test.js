'use strict';

/**
 * The participation event log is append-only. This is what holds that.
 *
 * WHY A SOURCE-LEVEL TEST
 * -----------------------
 * "No code updates or deletes an event" is a property of the whole codebase,
 * not of one function, and there is no runtime call that can demonstrate it —
 * you cannot prove absence by exercising a route. So it is checked the way this
 * repo checks its other source-level invariants (publishedDocsSurface,
 * researchIntegrityGuard): read the source with fs and assert on it.
 *
 * WHAT IS NEW HERE
 * ----------------
 * participation.unit.test.js already greps for two shapes:
 *
 *     /UPDATE\s+participation_case_events/i
 *     /DELETE\s+FROM\s+participation_case_events/i
 *
 * That file stays as it is; this one is the stronger form of the same check.
 * The grep above is a BLOCKLIST of two spellings, and a blocklist of spellings
 * is exactly what formatting defeats. Every one of these slips past it while
 * doing precisely what it forbids:
 *
 *     UPDATE `participation_case_events` SET ...      (backticks)
 *     UPDATE lampang_bus.participation_case_events    (schema-qualified)
 *     UPDATE lampang_bus.`participation_case_events`  (both at once)
 *     DELETE e FROM participation_case_events e JOIN  (multi-table delete)
 *     TRUNCATE participation_case_events              (not a DELETE at all)
 *     REPLACE INTO participation_case_events          (an update wearing INSERT)
 *     ALTER TABLE participation_case_events           (rewrite the column away)
 *
 * (A query merely built across lines is NOT one of them — `\s` matches a
 * newline, so the old grep does catch that. It is listed among the fixtures
 * below anyway, because a scanner that stopped catching it would be broken.)
 *
 * So this inverts the test. Instead of hunting for the two known-bad shapes, it
 * finds EVERY place the source names the table in a position where SQL can name
 * a table — after FROM, INTO, JOIN, UPDATE, TABLE or TRUNCATE — works out which
 * statement each one belongs to, and requires that statement to be a read or an
 * append. Anything else, including a verb nobody has thought of yet, fails. A
 * whitelist cannot be widened by spelling something differently.
 *
 * WHAT IT STILL CANNOT SEE
 * ------------------------
 * A table name that never appears as a literal — assembled from fragments, or
 * arriving in a variable — is out of reach of any static check. The assembled
 * case is caught below by refusing partial names next to a `+`. The variable
 * case is not caught, and no source-reading test can catch it; it is one of the
 * reasons the migration is also checked here, since a database that grants no
 * path to edit a row does not depend on what the application intends.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const SRC = path.join(BACKEND, 'src');

const EVENTS = 'participation_case_events';
const CASES = 'participation_cases';

// Reading and appending are what an evidence log is for. Anything that could
// change or remove a row that is already there is not.
const ALLOWED_VERBS = {
  [EVENTS]: ['SELECT', 'INSERT'],
  // The case row is a projection of the events and is MEANT to change, so an
  // UPDATE is legitimate there. Removing one is not: the events would outlive
  // the case they belong to and the FK would refuse anyway.
  [CASES]: ['SELECT', 'INSERT', 'UPDATE'],
};

// ─── Reading the source without being fooled by its comments ────────────────

/**
 * Blank out JavaScript comments, preserving every offset and newline so a
 * reported line number still points at the real line.
 *
 * Comments have to go before anything is classified: a comment that mentions
 * DELETE immediately above a legitimate SELECT would otherwise be read as the
 * statement's verb, and the check would fail on prose.
 */
function blankComments(source) {
  let out = '';
  let mode = 'code';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (mode === 'code') {
      // An escape inside a regex literal (\/) must not be read as a comment.
      if (ch === '\\') { out += ch + next; i += 2; continue; }
      if (ch === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (ch === "'" || ch === '"' || ch === '`') mode = ch;
      out += ch; i += 1; continue;
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out += ch; } else out += ' ';
      i += 1; continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? ch : ' '; i += 1; continue;
    }
    // Inside a string literal — SQL lives here, so it is kept verbatim.
    if (ch === '\\') { out += ch + next; i += 2; continue; }
    if (ch === mode) mode = 'code';
    out += ch; i += 1;
  }
  return out;
}

// The six keywords after which SQL names a table. A statement cannot touch a
// table without using one of them, so an occurrence introduced by none of them
// is a mention (an array of table names, a log line) and not a reference.
// `IF NOT EXISTS` / `IF EXISTS` sit between the keyword and the name; without
// this, `DROP TABLE IF EXISTS participation_case_events` would not be seen as a
// reference at all — the exact kind of gap this whole file exists to close.
// The quoting is the fiddly part, and getting it subtly wrong is how this kind
// of scanner ends up blind. An earlier version put the optional backtick BEFORE
// the optional schema qualifier, which matched `` `events` `` and matched
// `db.events`, but not `` db.`events` `` — the two spellings combined. A single
// statement written that way passed the whole file. So the quote is now optional
// around the schema and around the table independently, and the combined form is
// one of the fixtures below.
const TABLE_POSITION = new RegExp(
  '\\b(FROM|INTO|JOIN|UPDATE|TABLE|TRUNCATE)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?'
  + '(?:[`"]?\\w+[`"]?\\s*\\.\\s*)?[`"]?'
  + `(${CASES}|${EVENTS})[\`"]?\\b`,
  'gi'
);

const STATEMENT_VERB = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER|RENAME)\b/gi;

/** The verb of the statement an occurrence belongs to: the nearest one before it. */
function verbBefore(text, index) {
  const before = text.slice(0, index);
  let verb = null;
  let match;
  STATEMENT_VERB.lastIndex = 0;
  while ((match = STATEMENT_VERB.exec(before)) !== null) verb = match[1].toUpperCase();
  return verb;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Every table reference in one file, classified by the statement it is part of.
 * `verb` is null when no statement verb precedes it at all, which is treated as
 * a violation below — this fails closed.
 */
function tableReferences(rawSource, label = '') {
  const source = blankComments(rawSource);
  const found = [];
  let match;
  TABLE_POSITION.lastIndex = 0;
  while ((match = TABLE_POSITION.exec(source)) !== null) {
    const keyword = match[1].toUpperCase();
    // After UPDATE or TRUNCATE the keyword IS the verb; after FROM, INTO, JOIN
    // or TABLE the verb is whatever opened the statement.
    let verb = keyword === 'UPDATE' || keyword === 'TRUNCATE'
      ? keyword
      : verbBefore(source, match.index);
    // `INSERT ... ON DUPLICATE KEY UPDATE` is an edit spelled as an append, and
    // the clause that makes it one sits AFTER the table name, where the rule
    // above cannot see it. Look ahead to the end of the statement: an insert
    // that carries it is an upsert, and an upsert rewrites a row that exists.
    const end = source.indexOf(';', match.index);
    const tail = source.slice(match.index, Math.min(end === -1 ? source.length : end, match.index + 500));
    if (verb === 'INSERT' && /ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(tail)) verb = 'UPSERT';
    found.push({
      where: `${label}:${lineOf(source, match.index)}`,
      table: match[2].toLowerCase(),
      verb,
      excerpt: source.slice(match.index, match.index + 60).replace(/\s+/g, ' '),
    });
  }
  return found;
}

const violations = (references) => references.filter(
  (r) => !r.verb || !ALLOWED_VERBS[r.table].includes(r.verb)
);

// ─── The runtime source ─────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SOURCES = walk(SRC).map((file) => ({
  label: path.relative(BACKEND, file).replace(/\\/g, '/'),
  code: fs.readFileSync(file, 'utf8'),
}));

const ALL_REFERENCES = SOURCES.flatMap((f) => tableReferences(f.code, f.label));

describe('nothing in src/ can change a recorded event', () => {
  it('every reference to either table is a read, an append, or a case projection', () => {
    // The whitelist, applied to every occurrence rather than to two spellings.
    // A failure names file, line and the statement it objected to.
    expect(violations(ALL_REFERENCES).map((v) => `${v.where} ${v.verb} → ${v.excerpt}`)).toEqual([]);
  });

  it('the event log is never the target of an UPDATE, in any spelling', () => {
    const targeted = ALL_REFERENCES.filter((r) => r.table === EVENTS && r.verb === 'UPDATE');
    expect(targeted.map((r) => r.where)).toEqual([]);
  });

  it('no event row is ever removed, by DELETE, TRUNCATE or a dropped table', () => {
    const removed = ALL_REFERENCES.filter(
      (r) => r.table === EVENTS && ['DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'RENAME'].includes(r.verb)
    );
    expect(removed.map((r) => `${r.where} ${r.verb}`)).toEqual([]);
  });

  it('no case row is ever removed either', () => {
    // A deleted case would orphan its events: the evidence would survive with
    // nothing to attach it to, which is worse than either outcome on its own.
    const removed = ALL_REFERENCES.filter(
      (r) => r.table === CASES && ['DELETE', 'TRUNCATE', 'DROP'].includes(r.verb)
    );
    expect(removed.map((r) => `${r.where} ${r.verb}`)).toEqual([]);
  });

  it('no table name is assembled from fragments', () => {
    // The one evasion a name-based check can still be shown to catch. A name
    // that arrives in a variable cannot be caught here at all — see the header.
    const assembled = SOURCES.flatMap((f) => {
      const code = blankComments(f.code);
      const hits = code.match(/['"`][\w.]*participation[\w.]*['"`]\s*\+|\+\s*['"`][\w.]*participation[\w.]*['"`]/gi) || [];
      return hits.map((h) => `${f.label}: ${h.trim()}`);
    });
    expect(assembled).toEqual([]);
  });

  it('is a floor, not a vacuous pass — the tables really are referenced in src/', () => {
    // Every assertion above is over ALL_REFERENCES. If the scan found nothing —
    // a moved directory, a renamed table, a regex that stopped matching — the
    // whole file would pass having checked nothing.
    const tables = new Set(ALL_REFERENCES.map((r) => r.table));
    expect([...tables].sort()).toEqual([CASES, EVENTS].sort());
    expect(ALL_REFERENCES.filter((r) => r.table === EVENTS && r.verb === 'INSERT').length)
      .toBeGreaterThan(0);
    expect(ALL_REFERENCES.filter((r) => r.table === EVENTS && r.verb === 'SELECT').length)
      .toBeGreaterThan(0);
  });
});

describe('the check itself survives being written differently', () => {
  // The point of the whitelist is that formatting cannot get past it. That is a
  // claim about this classifier, so it is tested against the classifier rather
  // than asserted in a comment. Each of these does something forbidden to the
  // event log; every one must be caught. Template literals carry real newlines,
  // because a query built across lines is the case that matters most.
  const FORBIDDEN = [
    ["a plain update", `conn.query('UPDATE ${EVENTS} SET note = ? WHERE id = ?', [n, id]);`],
    ["lower case", `conn.query('update ${EVENTS} set note = ? where id = ?');`],
    ["mixed case", `conn.query('UpDaTe ${EVENTS} SeT note = ?');`],
    ["backticked name", 'conn.query(\'UPDATE `' + EVENTS + "` SET note = ?');"],
    ["schema-qualified", `conn.query('UPDATE lampang_bus.${EVENTS} SET note = ?');`],
    // The two above, combined. This is the one an earlier version of the scanner
    // missed entirely — not flagged, and not even counted as a reference, so the
    // "every reference is attributed" backstop never saw it either.
    ["schema-qualified AND backticked", 'conn.query(\'UPDATE lampang_bus.`' + EVENTS + "` SET note = ?');"],
    ["backticked schema and table", 'conn.query(\'DELETE FROM `lampang_bus`.`' + EVENTS + "` WHERE id = ?');"],
    ["double-quoted identifier (ANSI_QUOTES)", `conn.query('UPDATE "${EVENTS}" SET note = ?');`],
    ["built across lines", `conn.query(\`UPDATE\n        ${EVENTS}\n      SET note = ?\n    WHERE id = ?\`);`],
    ["tabs and runs of spaces", `conn.query('UPDATE   \t ${EVENTS}   SET note = ?');`],
    ["a plain delete", `conn.query('DELETE FROM ${EVENTS} WHERE id = ?');`],
    ["a delete split over lines", `conn.query(\`DELETE\n      FROM ${EVENTS}\n     WHERE id = ?\`);`],
    ["a multi-table delete", `conn.query('DELETE e FROM ${EVENTS} e JOIN ${CASES} c ON c.id = e.case_id');`],
    ["truncate with TABLE", `conn.query('TRUNCATE TABLE ${EVENTS}');`],
    ["truncate without TABLE", `conn.query('TRUNCATE ${EVENTS}');`],
    ["replace, an update wearing INSERT", `conn.query('REPLACE INTO ${EVENTS} (id, note) VALUES (?, ?)');`],
    ["insert ... on duplicate key update", `conn.query('INSERT INTO ${EVENTS} (id) VALUES (?) ON DUPLICATE KEY UPDATE note = ?');`],
    ["altering the column away", `conn.query('ALTER TABLE ${EVENTS} DROP COLUMN note');`],
    ["dropping the table", `conn.query('DROP TABLE ${EVENTS}');`],
    ["dropping it conditionally", `conn.query('DROP TABLE IF EXISTS ${EVENTS}');`],
    ["recreating it empty", `conn.query('CREATE TABLE IF NOT EXISTS ${EVENTS} (id BIGINT)');`],
    ["renaming it out of the way", `conn.query('RENAME TABLE ${EVENTS} TO old_events');`],
    ["a delete on the case table", `conn.query('DELETE FROM ${CASES} WHERE id = ?');`],
    ["a delete hidden under a comment about appending", `// we only ever append here\n    conn.query('DELETE FROM ${EVENTS} WHERE id = ?');`],
  ];

  for (const [name, snippet] of FORBIDDEN) {
    it(`catches ${name}`, () => {
      const found = violations(tableReferences(snippet, 'snippet'));
      expect(`${name}: ${found.length > 0}`).toBe(`${name}: true`);
    });
  }

  const ALLOWED = [
    ["appending an event", `conn.query('INSERT INTO ${EVENTS} (case_id, event_type) VALUES (?, ?)');`],
    ["reading the trail", `conn.query('SELECT id, event_type FROM ${EVENTS} WHERE case_id = ? ORDER BY id');`],
    ["reading it through a join", `conn.query('SELECT c.id FROM ${CASES} c JOIN ${EVENTS} e ON e.case_id = c.id');`],
    ["projecting the case row", `conn.query('UPDATE ${CASES} SET status = ? WHERE id = ?');`],
    ["a locking read of the case", `conn.query('SELECT * FROM ${CASES} WHERE id = ? FOR UPDATE');`],
    ["naming the tables in a list", `const REQUIRED = ['${CASES}', '${EVENTS}'];`],
    ["talking about them in prose", `// nothing may UPDATE or DELETE ${EVENTS}, ever\nconst x = 1;`],
  ];

  for (const [name, snippet] of ALLOWED) {
    it(`allows ${name}`, () => {
      const found = violations(tableReferences(snippet, 'snippet'));
      expect(`${name}: ${found.map((f) => f.verb).join(',')}`).toBe(`${name}: `);
    });
  }

  it('catches the real deletes that live OUTSIDE src/, where they belong', () => {
    // The fixtures above are written by the same hand as the classifier, which
    // is the weakness of every self-test. These two files are not: they are
    // real code, written for other reasons, that really does delete these rows —
    // tests/teardown.js clears test rows, and scripts/seed-synthetic-staging.js
    // removes its own synthetic dataset. Both are out-of-band tools that no
    // request can reach, which is why the scan above covers src/ only. If either
    // ever moves into src/, that scan catches it; meanwhile they serve here as
    // the honest proof that the classifier finds mutation written by someone
    // who was not trying to be found.
    const outOfBand = [
      ['tests/teardown.js', path.join(BACKEND, 'tests', 'teardown.js')],
      ['scripts/seed-synthetic-staging.js', path.join(BACKEND, 'scripts', 'seed-synthetic-staging.js')],
    ];
    const verdicts = outOfBand.map(([label, file]) => {
      if (!fs.existsSync(file)) return `${label}: missing`;
      const found = violations(tableReferences(fs.readFileSync(file, 'utf8'), label));
      return `${label}: ${found.length > 0 ? 'caught' : 'MISSED'}`;
    });
    expect(verdicts).toEqual([
      'tests/teardown.js: caught',
      'scripts/seed-synthetic-staging.js: caught',
    ]);
  });

  it('treats a reference with no statement at all as a violation, not as safe', () => {
    // Fails closed. An occurrence this classifier cannot attribute to a verb is
    // one it does not understand, and "not understood" must never read as "fine".
    const found = violations(tableReferences(`someHelper(\`FROM ${EVENTS}\`);`, 'snippet'));
    expect(found).toHaveLength(1);
    expect(found[0].verb).toBeNull();
  });
});

describe('migration 050 grants no path to edit an event row', () => {
  const read = (...parts) => fs.readFileSync(path.join(BACKEND, ...parts), 'utf8');
  // SQL comments explain the rule by naming what it forbids, so they are
  // stripped before the schema is read — the same reasoning as the existing
  // "stores no direct student reference" test.
  const strip = (sql) => sql.replace(/^\s*--.*$/gm, '');

  const MIGRATION = strip(read('migrations', '050_participation_cases.sql'));
  const ROLLBACK = strip(read('migrations', 'rollback', '050_participation_cases_rollback.sql'));

  /** The CREATE TABLE statement for one table, from its name to the closing `;`. */
  function tableBlock(sql, table) {
    const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(`${table} is created: ${start !== -1}`).toBe(`${table} is created: true`);
    return sql.slice(start, sql.indexOf(';', start));
  }

  const eventsTable = tableBlock(MIGRATION, EVENTS);
  const casesTable = tableBlock(MIGRATION, CASES);

  it('gives the event row no column that changes after it is written', () => {
    // `updated_at ... ON UPDATE CURRENT_TIMESTAMP` is the database editing a row
    // on its own. On an evidence table it is worse than pointless: it would make
    // every row carry a timestamp implying it may legitimately be rewritten.
    expect(eventsTable).not.toMatch(/ON UPDATE/i);
    expect(eventsTable).not.toMatch(/updated_at/i);
  });

  it('gives the case row one, because a projection is meant to change', () => {
    // The contrast is the point: the two tables are deliberately different, so
    // the absence above is a decision and not an omission.
    expect(casesTable).toMatch(/updated_at\s+TIMESTAMP[^,]*ON UPDATE CURRENT_TIMESTAMP/i);
  });

  it('does not let a case take its events down with it', () => {
    // ON DELETE CASCADE on the child would turn "delete the case" into "destroy
    // the evidence", silently. Without it the FK refuses, which is the answer a
    // governance table should give.
    expect(eventsTable).not.toMatch(/CASCADE/i);
    expect(eventsTable).toMatch(/FOREIGN KEY \(case_id\)\s+REFERENCES participation_cases/i);
  });

  it('installs nothing that could rewrite a row behind the application', () => {
    // A trigger, a routine or a view with CHECK OPTION is a second author of
    // these rows that no source-reading test would ever see.
    for (const object of ['TRIGGER', 'PROCEDURE', 'FUNCTION', 'VIEW', 'EVENT']) {
      expect(`creates a ${object}: ${new RegExp(`CREATE\\s+(?:OR REPLACE\\s+)?${object}`, 'i').test(MIGRATION)}`)
        .toBe(`creates a ${object}: false`);
    }
    // No GRANT either: privileges are the operator's to hand out, and a
    // migration that widens them does it invisibly.
    expect(MIGRATION).not.toMatch(/\bGRANT\b/i);
  });

  it('creates the two tables and does nothing else to them', () => {
    // The same classifier, pointed at the SQL. Applying a migration must not
    // write governance records — a seeded case would be evidence of a
    // conversation that never happened — and on a re-run it must not edit or
    // remove rows either. CREATE is the only verb allowed to name these tables
    // here, so a later hand-edit adding an INSERT or an ALTER fails this.
    const references = tableReferences(MIGRATION, '050');
    expect(references.map((r) => `${r.table}: ${r.verb}`).sort())
      .toEqual([`${CASES}: CREATE`, `${EVENTS}: CREATE`].sort());
  });

  it('rolls back by dropping the tables, never by emptying them', () => {
    // DELETE or TRUNCATE here would destroy the evidence and leave the schema
    // looking untouched — the one outcome an operator could not detect
    // afterwards. Dropping fails loudly if anything still references it, and
    // the file's own instruction is to check both tables are empty first.
    expect(ROLLBACK).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    expect(ROLLBACK).toMatch(new RegExp(`DROP TABLE IF EXISTS ${EVENTS}`));
    expect(ROLLBACK).toMatch(new RegExp(`DROP TABLE IF EXISTS ${CASES}`));
  });
});
