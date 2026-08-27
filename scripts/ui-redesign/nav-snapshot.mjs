#!/usr/bin/env node
/**
 * nav-snapshot.mjs — UI redesign regression guard.
 *
 * Extracts two inventories from source (no browser, no DB needed):
 *   1. Route inventory  — every <Route path> in App.jsx + its allowedRoles
 *   2. Navigation snapshot — every sidebar item per role (path/label/group/icon)
 *
 * Used to prove the redesign changes only GROUPING and PRESENTATION, never the
 * set of reachable routes or the set of menu entries a role can see.
 *
 * Usage:
 *   node scripts/ui-redesign/nav-snapshot.mjs > outputs/ui-redesign/nav-before.json
 *   node scripts/ui-redesign/nav-snapshot.mjs --compare outputs/ui-redesign/nav-before.json
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const APP     = resolve(root, 'frontend/src/App.jsx');
const SIDEBAR = resolve(root, 'frontend/src/components/Sidebar.jsx');

// ── 1. Route inventory ──────────────────────────────────────────────────────
// App.jsx nests child <Route path="x"> under a parent <Route path="/parent">.
// Track the parent prefix by watching for the parent's closing </Route>.
function extractRoutes(src) {
  const lines = src.split('\n');
  const routes = [];
  const push = (path, roles, parent) => {
    if (!routes.some(r => r.path === path)) routes.push({ path, roles, parent });
  };

  let parent = null;    // active parent <Route path="/x"> … </Route> block
  let opening = null;   // parent tag being assembled across lines
  let roles = null;     // most recent allowedRoles seen

  for (const raw of lines) {
    const line = raw.trim();

    const rm = line.match(/allowedRoles=\{\[([^\]]*)\]\}/);
    if (rm) {
      roles = rm[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
      if (opening) opening.roles = roles;
    }

    if (line.startsWith('</Route>')) { parent = null; roles = null; continue; }

    // multi-line parent: `<Route` alone, then `path="…"`, then a bare `>`
    if (/^<Route$/.test(line)) { opening = { path: null, roles: null }; continue; }
    if (opening) {
      const pm = line.match(/^path="([^"]+)"/);
      if (pm) { opening.path = pm[1]; continue; }
      if (/^>$/.test(line)) {
        parent = { path: opening.path, roles: opening.roles };
        push(parent.path, parent.roles, null);
        opening = null;
      }
      continue;
    }

    // `<Route index …/>` resolves to the parent's own path (already pushed)
    if (/^<Route\s+index/.test(line)) continue;

    const pm = line.match(/^<Route\s+path="([^"]+)"/);
    if (!pm) continue;
    const p = pm[1];

    if (p.startsWith('/')) {
      // absolute leaf route; its allowedRoles may appear on a later line
      push(p, null, null);
      const idx = routes.findIndex(r => r.path === p);
      // remember slot so a following allowedRoles line can fill it
      pendingSlot = idx;
      continue;
    }
    push(`${parent ? parent.path : ''}/${p}`, parent?.roles ?? null, parent?.path ?? null);
  }
  return routes;
}
let pendingSlot = -1;

// second pass: attach allowedRoles to absolute leaf routes (roles appear on the
// line AFTER `<Route path="/admin/x" element={`)
function attachLeafRoles(src, routes) {
  const lines = src.split('\n');
  let lastPath = null;
  for (const raw of lines) {
    const line = raw.trim();
    const pm = line.match(/^<Route\s+path="(\/[^"]+)"/);
    // a fully self-contained one-liner carries no allowedRoles of its own
    if (pm) { lastPath = line.includes('/>') ? null : pm[1]; continue; }
    const rm = line.match(/allowedRoles=\{\[([^\]]*)\]\}/);
    if (rm && lastPath) {
      const r = routes.find(x => x.path === lastPath);
      if (r && !r.roles) {
        r.roles = rm[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
      }
      lastPath = null;
    }
  }
  return routes;
}

// ── 2. Navigation snapshot ──────────────────────────────────────────────────
// The NAV arrays are plain object literals; `icon:` values are identifiers, so
// quote them before JSON-parsing.
function extractNav(src) {
  const out = {};
  const names = {
    DRIVER_NAV: 'driver', SCHOOL_NAV: 'school', AFFILIATION_NAV: 'affiliation',
    PROVINCE_NAV: 'province', TRANSPORT_NAV: 'transport', ADMIN_NAV: 'admin',
  };

  for (const [constName, role] of Object.entries(names)) {
    const start = src.indexOf(`const ${constName} = [`);
    if (start === -1) { out[role] = { error: 'NOT FOUND' }; continue; }
    let i = src.indexOf('[', start);
    let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '[') depth++;
      else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    const body = src.slice(i, end + 1);

    const items = [];
    let group = null;
    // one entry per `{ ... }`
    for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
      const seg = m[1];
      const sec = seg.match(/section:\s*'([^']*)'/);
      if (sec) { group = sec[1]; continue; }
      const to = seg.match(/to:\s*'([^']*)'/);
      if (!to) continue;
      const icon = seg.match(/icon:\s*([A-Za-z0-9_]+)/);
      let label = seg.match(/label:\s*'([^']*)'/)?.[1];
      if (!label) label = seg.match(/label:\s*(PAGE_TITLES\.[A-Z_]+)/)?.[1] ?? null;
      items.push({ to: to[1], label, group, icon: icon?.[1] ?? null });
    }
    out[role] = items;
  }
  return out;
}

const appSrc = readFileSync(APP, 'utf8');
const sideSrc = readFileSync(SIDEBAR, 'utf8');

const snapshot = {
  routes: attachLeafRoles(appSrc, extractRoutes(appSrc)),
  nav: extractNav(sideSrc),
};

// ── compare mode ────────────────────────────────────────────────────────────
const compareIdx = process.argv.indexOf('--compare');
if (compareIdx !== -1) {
  const prev = JSON.parse(readFileSync(process.argv[compareIdx + 1], 'utf8'));
  let failures = 0;

  const setOf = arr => new Set(arr.map(r => r.path));
  const before = setOf(prev.routes), after = setOf(snapshot.routes);
  const lostRoutes  = [...before].filter(p => !after.has(p));
  const addedRoutes = [...after].filter(p => !before.has(p));

  console.log('=== ROUTE INVENTORY ===');
  console.log(`  before: ${before.size}   after: ${after.size}`);
  if (lostRoutes.length)  { console.log(`  ✗ LOST ROUTES (${lostRoutes.length}):`); lostRoutes.forEach(p => console.log(`      ${p}`)); failures++; }
  else console.log('  ✓ no route lost');
  if (addedRoutes.length) { console.log(`  + added (${addedRoutes.length}): ${addedRoutes.join(', ')}`); }

  console.log('\n=== NAVIGATION PER ROLE ===');
  for (const role of Object.keys(prev.nav)) {
    const b = new Set((prev.nav[role] || []).map(i => i.to));
    const a = new Set((snapshot.nav[role] || []).map(i => i.to));
    const lost  = [...b].filter(p => !a.has(p));
    const added = [...a].filter(p => !b.has(p));
    const status = lost.length ? '✗' : '✓';
    console.log(`  ${status} ${role.padEnd(12)} before=${b.size} after=${a.size}`);
    if (lost.length)  { console.log(`      LOST: ${lost.join(', ')}`); failures++; }
    if (added.length) { console.log(`      ADDED: ${added.join(', ')}`); }
    // every nav target must resolve to a real route
    const orphans = [...a].filter(p => !after.has(p));
    if (orphans.length) { console.log(`      ✗ ORPHAN (no route): ${orphans.join(', ')}`); failures++; }
  }

  console.log(`\n${failures === 0 ? '✓ PASS — no route or menu entry lost' : `✗ FAIL — ${failures} problem(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

console.log(JSON.stringify(snapshot, null, 2));
