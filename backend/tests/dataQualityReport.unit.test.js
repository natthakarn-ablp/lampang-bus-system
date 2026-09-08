'use strict';

/**
 * Guard for backend/scripts/data-quality-report.js.
 *
 * WHY THIS IS A SOURCE-LEVEL TEST AND NOT A RUNTIME ONE
 * -----------------------------------------------------
 * The script is meant to be run by an operator against the REAL production
 * database, which holds the personal data of about 1,300 children. There is no
 * safe way to prove at runtime, on a developer machine, that it will not read a
 * name or a phone number there — the developer machine has no such database.
 *
 * So the promise is enforced where it is actually made: in the file. This test
 * reads the source and refuses to let a query mention a personal column, or do
 * anything other than SELECT. If someone later adds `SELECT s.first_name` to
 * "make the report more useful", this fails before it can ever be run against
 * production.
 *
 * It reads the file rather than requiring it because requiring pulls in
 * src/config/database, which pulls in env.js, which throws when DB_HOST and the
 * rest are absent — as they are on any machine that is not the server.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'data-quality-report.js');
const SRC = fs.readFileSync(SCRIPT_PATH, 'utf8');

/** Everything inside a backtick-quoted `sql:` value, which is where every query lives. */
function sqlBlocks() {
  return [...SRC.matchAll(/sql:\s*`([\s\S]*?)`/g)].map((m) => m[1]);
}

describe('the data-quality report can only ever read counts', () => {
  it('has queries to check at all', () => {
    expect(sqlBlocks().length).toBeGreaterThanOrEqual(10);
  });

  it('every statement is a SELECT — no write reaches production through this file', () => {
    const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|SET\s+@)\b/i;
    for (const sql of sqlBlocks()) {
      expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(sql).not.toMatch(FORBIDDEN);
    }
  });

  it('every query returns a count, never rows of data', () => {
    for (const sql of sqlBlocks()) {
      // COUNT(*) AS n is the only projection the renderer knows how to read, and
      // it is also the only projection that cannot carry a person out of the DB.
      expect(sql).toMatch(/COUNT\(\*\)\s+AS\s+n/i);
      // A bare `SELECT column` would mean someone widened the projection.
      expect(sql).not.toMatch(/SELECT\s+(?!COUNT|1\b|cid_hash\b)[a-z_]+\s*,/i);
    }
  });

  it('no query reads a column that identifies a person', () => {
    // cid_hash is the one deliberate exception and it is allowed ONLY inside a
    // GROUP BY that counts duplicate groups — the value itself never leaves.
    const PERSONAL = [
      'first_name', 'last_name', 'student_name', 'display_name', 'prefix',
      'phone', 'owner_phone', 'parent_phone', 'driver_phone',
      'line_user_id', 'dropoff_address', 'username', 'password_hash',
      'national_id', 'citizen_id', 'cid ', 'notes', 'detail',
    ];
    for (const sql of sqlBlocks()) {
      for (const col of PERSONAL) {
        expect(sql.toLowerCase()).not.toContain(col);
      }
    }
  });

  it('cid_hash appears only in the duplicate-group count, never as a projected value', () => {
    for (const sql of sqlBlocks()) {
      if (!sql.includes('cid_hash')) continue;
      // Either it is being tested for emptiness, or it is grouped and counted.
      const grouped = /GROUP BY cid_hash/i.test(sql) && /COUNT\(\*\)\s*>\s*1/i.test(sql);
      const nullCheck = /cid_hash IS NULL/i.test(sql);
      expect(grouped || nullCheck).toBe(true);
    }
  });

  it('does not connect to the database merely by being required', () => {
    // A top-level IIFE would open a pool and call process.exit during any test
    // run that happens to import this file.
    expect(SRC).toMatch(/if \(require\.main === module\)/);
    expect(SRC).not.toMatch(/^\(async \(\) => \{/m);
  });
});

describe('every check explains itself to the person who must sign it off', () => {
  it('each check carries a Thai label, a severity and a reason', () => {
    const blocks = [...SRC.matchAll(/\{\s*\n\s*key: '([a-z0-9_]+)',([\s\S]*?)\n  \},/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const [, key, body] of blocks) {
      expect(body).toMatch(/label: '[^']*[฀-๿][^']*'/);
      expect(body).toMatch(/severity: (CRITICAL|WARN|INFO)/);
      // The reason is what a school director reads to decide whether to act. A
      // check without one is a number nobody can act on.
      expect(body).toMatch(/why: '[^']*[฀-๿][^']*'/);
      expect(key.length).toBeGreaterThan(3);
    }
  });

  it('the report states in its own output that it carries no personal data', () => {
    expect(SRC).toMatch(/safety: 'aggregate counts only/);
  });

  it('does not reduce the defects to a single score', () => {
    // A percentage would let a school certify data by reading one number, which
    // is exactly what the closure plan is trying to stop.
    expect(SRC).not.toMatch(/quality_score|overall_score|score:\s*\d/);
    expect(SRC).toMatch(/critical_open/);
  });
});
