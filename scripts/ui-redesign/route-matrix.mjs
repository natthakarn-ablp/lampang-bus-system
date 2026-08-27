#!/usr/bin/env node
/**
 * route-matrix.mjs — every route in App.jsx, joined to its page's migration
 * status, with nothing left unclassified.
 *
 * page-status.mjs answers "is this FILE migrated". This answers "does every
 * ROUTE have a status", which is the question the goal actually asks. The two
 * counts differ because several routes render no page of their own:
 *   redirect   — <Navigate to=…>, kept for a deep link that used to exist
 *   index      — the parent module's landing route, rendered by another file
 *   alias      — a second path onto the same page (LIFF endpoint variants)
 *   shell      — a layout wrapper with no content of its own
 *   external   — hands off outside the SPA
 *
 * Usage:
 *   node scripts/ui-redesign/route-matrix.mjs         # table + reconciliation
 *   node scripts/ui-redesign/route-matrix.mjs --md
 *   node scripts/ui-redesign/route-matrix.mjs --gate  # exit 1 if anything is unresolved
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const APP = resolve(root, 'frontend/src/App.jsx');
const appSrc = readFileSync(APP, 'utf8');

// component name -> source file, from the lazy()/static import list
const COMPONENT_FILE = {};
for (const m of appSrc.matchAll(/const (\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('([^']+)'\)\)/g)) {
  COMPONENT_FILE[m[1]] = m[2].replace(/^\.\//, '');
}
for (const m of appSrc.matchAll(/^import (\w+) from '\.\/([^']+)';/gm)) {
  COMPONENT_FILE[m[1]] = m[2];
}

// Routes that render no page of their own. Each says why.
const NON_PAGE = {
  '/manual/*':          ['external', 'redirects out of the SPA to the published static manual'],
  '/driver/leaves':     ['redirect', '<Navigate to="/driver"> — the leaves feature folded into the dashboard; the path is kept so old links still resolve'],
  '/school/status':     ['redirect', '<Navigate to="/school"> — daily status folded into the school dashboard'],
  '/school/missing':    ['redirect', '<Navigate to="/school"> — retired view, path kept for old links'],
  '/parent/link/link':  ['alias',    'LINE rewrites the LIFF endpoint by appending /link; this absorbs the double segment'],
  '/link':              ['alias',    'same LIFF endpoint defence for the case where Endpoint URL is set to /'],
  '/':                  ['redirect', 'RootRedirect — sends each role to its own home'],
  '/*':                 ['redirect', 'catch-all back to /'],
  '/driver':            ['index',    'DriverLayout index route — renders DriverDashboard'],
  '/school':            ['index',    'SchoolLayout index route — renders SchoolDashboard'],
  '/affiliation':       ['index',    'AffiliationLayout index route — renders AffiliationDashboard'],
  '/province':          ['index',    'ProvinceLayout index route — renders ProvinceDashboard'],
  '/transport':         ['index',    'TransportLayout index route — renders TransportDashboard'],
  '/reports':           ['index',    'ReportsLayout index route — renders DailyReport'],
};

/**
 * path -> component.
 *
 * Rather than trying to parse JSX line by line — which the multi-line
 * `element={ <PrivateRoute…> }` blocks defeat — take each `<Route path="X"`
 * occurrence, look at the text up to the next `<Route`, and pick the first
 * component name in it that is a known page import. That is unambiguous
 * because PrivateRoute, Layout and Navigate are not page imports.
 */
const ROUTE_COMPONENT = {};
{
  // parent module paths, so `path="students"` resolves to `/school/students`
  const parents = [];
  const lines = appSrc.split('\n');
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^<Route$/.test(line)) { pending = true; continue; }
    if (pending) {
      const pm = line.match(/^path="([^"]+)"/);
      if (pm) { parents.push(pm[1]); pending = false; }
      continue;
    }
  }

  const marks = [...appSrc.matchAll(/<Route\s+(index|path="([^"]+)")/g)];
  let currentParent = null;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const chunk = appSrc.slice(m.index, marks[i + 1]?.index ?? appSrc.length);
    const isIndex = m[1] === 'index';
    let path = m[2];

    if (!isIndex && path && path.startsWith('/') && parents.includes(path) && !/element=/.test(chunk.split('\n')[0])) {
      currentParent = path;          // a module wrapper opens here
    }
    if (isIndex) path = currentParent;
    else if (path && !path.startsWith('/')) path = `${currentParent || ''}/${path}`;
    if (!path) continue;

    // Prefer the page component. `Layout` is a static import too, and it wraps
    // most admin routes, so a naive "first known component" picks the shell.
    const names = [...chunk.matchAll(/<(\w+)[\s/>]/g)].map(x => x[1]);
    const comp = names.find(n => COMPONENT_FILE[n]?.startsWith('pages/'))
              ?? names.find(n => COMPONENT_FILE[n] && !/^components\/(Layout|ErrorBoundary)$/.test(COMPONENT_FILE[n]));
    if (comp) ROUTE_COMPONENT[path] = comp;
  }
}

// page-status output, keyed by file.
// page-status exits non-zero while anything is Partial — that is its gate, not
// a failure to produce output, so read stdout either way.
function pageStatusJson() {
  try {
    return execFileSync(process.execPath, [resolve(here, 'page-status.mjs'), '--json'],
      { encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}
const status = JSON.parse(pageStatusJson());
const STATUS_BY_FILE = Object.fromEntries(status.rows.map(r => [r.file, r]));

const inventory = JSON.parse(readFileSync(resolve(root, 'outputs/ui-redesign/nav-before.json'), 'utf8'));
const paths = [...new Set(inventory.routes.map(r => r.path))];

const rows = paths.map(path => {
  if (NON_PAGE[path]) {
    const [kind, why] = NON_PAGE[path];
    return { path, kind, status: 'N/A', why };
  }
  const comp = ROUTE_COMPONENT[path];
  const base = comp && COMPONENT_FILE[comp];
  if (!base) return { path, kind: 'unresolved', status: 'UNCLASSIFIED', why: `no component found (element=${comp || '?'})` };
  // App.jsx imports without the extension; page-status keys on the real file
  const file = base.endsWith('.jsx') ? base : `${base}.jsx`;
  const st = STATUS_BY_FILE[file];
  if (!st) return { path, kind: 'page', status: 'UNCLASSIFIED', why: `page-status has no row for ${file}` };
  return { path, kind: 'page', status: st.status, why: file,
           gaps: Object.entries(st.detail).filter(([, v]) => v === 'todo').map(([k]) => k) };
});

const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const unresolved = rows.filter(r => r.status === 'UNCLASSIFIED');
const partial = rows.filter(r => r.status === 'Partial');

if (process.argv.includes('--md')) {
  console.log('| route | kind | status | page / reason | gaps |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| \`${r.path}\` | ${r.kind} | ${r.status} | ${r.why} | ${(r.gaps || []).join(', ') || '—'} |`);
  }
} else {
  for (const r of rows) {
    const mark = r.status === 'Complete' ? 'OK ' : r.status.startsWith('N/A') ? '-- ' : r.status === 'Partial' ? '>> ' : '?? ';
    console.log(`${mark}${r.path.padEnd(34)} ${r.kind.padEnd(11)} ${r.status.padEnd(15)} ${(r.gaps || []).join(',')}`);
  }
}

console.log(`\nroutes: ${rows.length}`);
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ·  '));
console.log(`reconciles to 89: ${rows.length === 89 ? 'YES' : 'NO (' + rows.length + ')'}`);
if (unresolved.length) {
  console.log('\nUNCLASSIFIED:');
  unresolved.forEach(r => console.log(`  ${r.path} — ${r.why}`));
}

if (process.argv.includes('--gate')) {
  const bad = unresolved.length + partial.length;
  process.exit(bad === 0 && rows.length === 89 ? 0 : 1);
}
