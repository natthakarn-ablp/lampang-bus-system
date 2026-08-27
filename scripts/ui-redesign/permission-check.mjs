#!/usr/bin/env node
/**
 * permission-check.mjs — does any role's menu point at a route that role is
 * not allowed to open?
 *
 * The redesign moved a lot of navigation around. "The menus still have the
 * same number of entries" (nav-snapshot) does not answer whether an entry now
 * points somewhere the role cannot go, or — worse — somewhere it should not
 * see. This joins the two facts that are already derivable from source:
 *
 *   App.jsx     — every route and the roles its guard admits
 *   Sidebar.jsx — every menu entry, per role
 *
 * and reports three separate failures:
 *
 *   LEAK    a role's menu links to a route whose guard excludes that role
 *   DEAD    a role's menu links to a path that is not a route at all
 *   ORPHAN  a route admits a role that has no menu entry reaching it
 *           (reported for information — deep links and detail pages are
 *           legitimately unlisted, so this is not a failure)
 *
 * This checks what the UI OFFERS. It is not a substitute for the server-side
 * authorisation it sits in front of; the backend guard is the control that
 * matters and is untouched by this work.
 *
 * Usage:
 *   node scripts/ui-redesign/permission-check.mjs
 *   node scripts/ui-redesign/permission-check.mjs --json
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  execFileSync('node', [join(here, 'nav-snapshot.mjs'), '--json'], { encoding: 'utf8' })
);

const { routes, nav } = snapshot;

// A menu entry may point at a route declared with a trailing wildcard or an
// index path; normalise both sides before comparing.
const norm = p => (p || '').replace(/\/\*$/, '').replace(/\/+$/, '') || '/';

const byPath = new Map();
for (const r of routes) byPath.set(norm(r.path), r);

/** Roles a route admits: its own guard, else the guard of its parent layout. */
function rolesFor(route) {
  if (route.roles && route.roles.length) return route.roles;
  if (route.parent) {
    const p = byPath.get(norm(route.parent));
    if (p?.roles?.length) return p.roles;
  }
  return null; // unguarded (login, change-password, public QR, manual)
}

const leaks = [];
const dead = [];
const reachable = new Map(); // role -> Set(path)

for (const [role, items] of Object.entries(nav)) {
  reachable.set(role, new Set());
  for (const item of items) {
    const target = norm(item.to);
    reachable.get(role).add(target);
    const route = byPath.get(target);
    if (!route) {
      dead.push({ role, to: item.to, label: item.label });
      continue;
    }
    const allowed = rolesFor(route);
    if (allowed && !allowed.includes(role)) {
      leaks.push({ role, to: item.to, label: item.label, allowed });
    }
  }
}

const orphans = [];
for (const r of routes) {
  const allowed = rolesFor(r);
  if (!allowed) continue;
  for (const role of allowed) {
    if (!nav[role]) continue;
    if (!reachable.get(role)?.has(norm(r.path))) {
      orphans.push({ role, path: r.path });
    }
  }
}

const result = { leaks, dead, orphans, roles: Object.keys(nav).length, routes: routes.length };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('=== MENU → ROUTE PERMISSION CHECK ===');
  console.log(`  ${result.routes} routes · ${result.roles} roles with menus\n`);

  if (leaks.length === 0) console.log('  ✓ leaks: 0 — no menu offers a route its role cannot open');
  else {
    console.log(`  ✗ LEAKS (${leaks.length}):`);
    for (const l of leaks) console.log(`      ${l.role} → ${l.to} (${l.label}) — route admits ${l.allowed.join(', ')}`);
  }

  if (dead.length === 0) console.log('  ✓ dead links: 0 — every menu entry resolves to a route');
  else {
    console.log(`  ✗ DEAD LINKS (${dead.length}):`);
    for (const d of dead) console.log(`      ${d.role} → ${d.to} (${d.label})`);
  }

  // Informational only: a detail or deep-linked page is legitimately unlisted.
  const byRole = orphans.reduce((m, o) => ((m[o.role] = (m[o.role] || 0) + 1), m), {});
  const summary = Object.entries(byRole).map(([r, n]) => `${r} ${n}`).join(' · ');
  console.log(`  · routes reachable only by deep link: ${orphans.length}${summary ? ` (${summary})` : ''}`);

  console.log(`\n${leaks.length === 0 && dead.length === 0 ? '✓ PASS' : '✗ FAIL'}`);
}

process.exit(leaks.length === 0 && dead.length === 0 ? 0 : 1);
