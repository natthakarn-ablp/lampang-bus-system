'use strict';

/**
 * Source guard against re-deriving a calendar date from UTC.
 *
 * `new Date().toISOString().slice(0, 10)` looks harmless in review and is
 * wrong for seven hours a day, every day — including the whole morning bus
 * route. It had spread to seventeen call sites before it was caught. The rule
 * is easier to enforce than to remember, so it is enforced here.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function load(dir, exts, root) {
  return walk(dir, exts).map((f) => ({
    file: path.relative(root, f),
    code: stripComments(fs.readFileSync(f, 'utf8')),
  }));
}

const BACKEND_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(__dirname, '..', '..');
const FILES = load(SRC, ['.js'], BACKEND_ROOT);
// The browser has the same failure mode: `toISOString()` is UTC whatever the
// device timezone is, and a device left on UTC (or a user abroad) is not
// hypothetical. An inspection form that prefills yesterday is a wrong record.
const FRONTEND_FILES = load(FRONTEND_SRC, ['.jsx', '.js'], REPO_ROOT);

describe('calendar dates are Bangkok dates', () => {
  it('finds source files to check (guards against a vacuous pass)', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it('never slices a calendar date out of an ISO string', () => {
    // `.toISOString()` on its own is fine — that is an instant, and instants
    // are timezone-free. Slicing a date out of one is what breaks.
    const offenders = FILES.filter((f) =>
      /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(f.code)
      || /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/.test(f.code)
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('never builds a SQL DATETIME literal from a UTC wall clock', () => {
    // The GPS bug: `.toISOString().slice(0, 23).replace('T', ' ')` handed MySQL
    // a UTC wall clock on a +07:00 connection, storing it 7 hours early.
    const offenders = FILES.filter((f) =>
      /toISOString\(\)\s*\.\s*slice\([^)]*\)\s*\.\s*replace\(\s*['"]T['"]/.test(f.code)
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('adds no new hand-rolled Bangkok date conversion outside the helper', () => {
    // These files predate `utils/thaiTime.js` and are already correct — they
    // spell out `toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })`
    // inline. They are listed rather than counted so a NEW file hand-rolling
    // the conversion fails here even if an old one is migrated the same day.
    // Remove entries as they migrate to the helper; never add one.
    const KNOWN_INLINE = [
      'routes/admin.routes.js',
      'routes/affiliation.routes.js',
      'routes/driver.routes.js',
      'routes/school.routes.js',
      'routes/visits.routes.js',
      'services/affiliation.service.js',
      'services/eta.service.js',
      'services/line.service.js',
      'services/province.service.js',
      'services/report.service.js',
      'services/routeDeviation.service.js',
      'services/school.service.js',
      'services/term.service.js',
      'utils/inspectionDates.js',
    ].map((p) => path.join('src', p));

    const inline = FILES
      .filter((f) => /toLocaleDateString\(\s*['"]en-CA['"]/.test(f.code))
      .map((f) => f.file)
      .filter((f) => !f.endsWith(path.join('utils', 'thaiTime.js')));

    const unexpected = inline.filter((f) => !KNOWN_INLINE.includes(f));
    expect(unexpected).toEqual([]);
  });

  it('never slices a calendar date out of an ISO string in the UI either', () => {
    expect(FRONTEND_FILES.length).toBeGreaterThan(50);
    const offenders = FRONTEND_FILES.filter((f) =>
      /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(f.code)
      || /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/.test(f.code)
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('keeps the pooled connection pinned to +07:00', () => {
    const db = FILES.find((f) => f.file.endsWith(path.join('config', 'database.js')));
    expect(db).toBeDefined();
    expect(db.code).toContain("'+07:00'");
    expect(db.code).toMatch(/SET time_zone/);
    expect(db.code).toContain("charset: 'utf8mb4'");
  });
});
