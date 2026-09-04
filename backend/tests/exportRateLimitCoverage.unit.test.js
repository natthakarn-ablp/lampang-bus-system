'use strict';

/**
 * Every endpoint that builds an export must sit behind an export rate limiter.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A REQUEST TEST
 * -----------------------------------------------
 * All the export limiters carry `skip: (req) => process.env.NODE_ENV === 'test'`,
 * so under jest they let everything through. A test that fired 41 requests and
 * asserted a 429 would pass whether or not the limiter was mounted — it would
 * assert nothing at all. Reading the route declarations is what actually
 * distinguishes a guarded endpoint from an unguarded one here.
 *
 * WHAT IT CAUGHT
 * --------------
 * GET /api/affiliation/audit-logs supports ?format=csv and builds the whole
 * audit trail of a district, and was the only one of the four audit-log
 * endpoints (admin, province, school, affiliation) without exportFormatLimiter.
 * Nothing pointed at it: the other three had it, the route worked, and the
 * generic 120/min floor made the gap invisible in normal use.
 *
 * The point of scanning rather than listing is that a new export endpoint is
 * caught the day it is written, instead of the next time someone audits by hand.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');
const APP_JS = path.join(__dirname, '..', 'src', 'app.js');

// A route declaration: `router.get('/x', ...)`, and the named routers
// registration.routes.js uses (`driverRouter.post(...)`).
const DECLARATION = /^\s*(?:[A-Za-z_$][\w$]*)?[Rr]outer\.(get|post|put|patch|delete)\(\s*'([^']*)'/;

// Signals that a handler produces an export: a generated file, or a response
// assembled from a whole result set rather than one record.
const EXPORT_SIGNALS = [
  /Content-Disposition/,
  /format\s*===?\s*'csv'/,
  /format\s*===?\s*'excel'/,
  /format\s*===?\s*'pdf'/,
  /res\.attachment/,
  /exceljs/i,
];

/**
 * Comment lines are dropped before scanning. A route's JSDoc block sits above
 * its declaration, so it is captured as part of the PREVIOUS route's body —
 * which is how `PUT /school-accounts/:id` first appeared to be an unguarded
 * export, on the strength of the words ".xlsx/.csv upload" in the comment
 * introducing the endpoint after it.
 *
 * Only whole comment lines are removed, never a `//` inside a line: stripping
 * those properly means tracking string literals, and a real export signal never
 * appears at the start of a comment line anyway.
 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function routeBlocks(file) {
  const lines = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8').split(/\r?\n/);
  const blocks = [];
  let current = null;
  lines.forEach((line, i) => {
    const m = line.match(DECLARATION);
    if (m) {
      if (current) blocks.push(current);
      current = { file, method: m[1].toUpperCase(), routePath: m[2], line: i + 1, declaration: line, body: [] };
    } else if (current && !isCommentLine(line)) {
      current.body.push(line);
    }
  });
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Mounts that carry the limiter in app.js instead of on each route. The mount
 * is asserted below, so moving the limiter off the mount fails this file rather
 * than silently un-guarding every route in it.
 */
const APP_LEVEL_MOUNTS = [
  { file: 'report.routes.js', mount: '/api/reports', limiter: 'exportLimiter' },
];

/**
 * Endpoints that trip a signal without being exports. Each needs a reason, and
 * the reason has to be about what the endpoint does — not "it seemed fine".
 */
const NOT_AN_EXPORT = [
  {
    file: 'documents.routes.js',
    routePath: '/:docType/:id/file',
    reason:
      'Serves one stored document with Content-Disposition: inline — it views a '
      + 'single file rather than assembling a dataset, and the UI fetches it one '
      + 'click at a time behind a busy guard. Throttling it at 40/5min would '
      + 'reach a school office sharing one NAT address before it reached anyone '
      + 'scraping.',
  },
];

const appSource = fs.readFileSync(APP_JS, 'utf8');
const appLevelFiles = new Set(APP_LEVEL_MOUNTS.map((m) => m.file));
const allowed = new Set(NOT_AN_EXPORT.map((e) => `${e.file} ${e.routePath}`));

function exportBlocks() {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .flatMap(routeBlocks)
    .filter((b) => EXPORT_SIGNALS.some((s) => s.test(b.body.join('\n'))));
}

describe('export rate-limit coverage', () => {
  test('every export endpoint is declared with an export limiter', () => {
    const unguarded = exportBlocks()
      .filter((b) => !appLevelFiles.has(b.file))
      .filter((b) => !allowed.has(`${b.file} ${b.routePath}`))
      .filter((b) => !/Limiter/.test(b.declaration))
      .map((b) => `${b.file}:${b.line} ${b.method} ${b.routePath}`);

    expect(unguarded).toEqual([]);
  });

  test('the app-level export mounts still carry their limiter', () => {
    for (const m of APP_LEVEL_MOUNTS) {
      const mounted = new RegExp(
        `app\\.use\\(\\s*'${m.mount.replace(/\//g, '\\/')}'\\s*,\\s*${m.limiter}\\s*,`
      );
      expect(`${m.mount} mounted with ${m.limiter}: ${mounted.test(appSource)}`)
        .toBe(`${m.mount} mounted with ${m.limiter}: true`);
    }
  });

  test('the four audit-log endpoints are guarded the same way', () => {
    // These four are the same query against different scopes and all export on
    // ?format=csv, so a difference between them is a mistake rather than a
    // decision. affiliation was the one that had drifted.
    const files = ['admin.routes.js', 'affiliation.routes.js', 'province.routes.js', 'school.routes.js'];
    const found = files.map((file) => {
      const block = routeBlocks(file).find((b) => b.routePath === '/audit-logs' && b.method === 'GET');
      return `${file}: ${block && /exportFormatLimiter/.test(block.declaration)}`;
    });
    expect(found).toEqual(files.map((f) => `${f}: true`));
  });

  test('the scan finds the endpoints it is supposed to be watching', () => {
    // A scanner that silently matches nothing would make the first test pass
    // for the wrong reason. These are known exports; if the signals stop
    // recognising them the coverage test is no longer checking anything.
    const seen = exportBlocks().map((b) => `${b.file} ${b.routePath}`);
    expect(seen).toEqual(expect.arrayContaining([
      'admin.routes.js /audit-logs',
      'admin.routes.js /research-export',
      'affiliation.routes.js /audit-logs',
      'province.routes.js /audit-logs',
      'school.routes.js /audit-logs',
      'report.routes.js /export/csv',
    ]));
    expect(seen.length).toBeGreaterThanOrEqual(10);
  });

  test('every allow-list entry names a route that still exists', () => {
    // An allow-list that outlives its route is a hole with a comment on it.
    const live = new Set(
      fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))
        .flatMap(routeBlocks).map((b) => `${b.file} ${b.routePath}`)
    );
    const stale = NOT_AN_EXPORT
      .filter((e) => !live.has(`${e.file} ${e.routePath}`))
      .map((e) => `${e.file} ${e.routePath}`);
    expect(stale).toEqual([]);
  });
});
