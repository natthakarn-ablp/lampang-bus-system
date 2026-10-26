'use strict';

/**
 * Audits server-side scope enforcement on write handlers that address a
 * resource by id.
 *
 * The RBAC matrix (`generate-rbac-matrix.js`) answers "which roles may call
 * this endpoint". It cannot answer the question IDOR actually turns on: once a
 * school user is inside `PUT /api/school/students/:id`, does the handler prove
 * that student belongs to *their* school? A role guard that passes plus a
 * missing scope predicate is exactly the shape of a cross-tenant leak, and
 * hiding the menu does not change it.
 *
 * Only routes reachable by a role that HAS a narrower scope need enforcement:
 *
 *   school       → one school (users.scope_id)
 *   affiliation  → the schools under one affiliation
 *   driver       → the vehicle currently assigned to them
 *
 * `admin` (system-wide), `province` (whole province) and `transport` (all
 * vehicles, no PII) have no narrower scope to enforce, so an admin-only or
 * transport-only endpoint is reported as out-of-scope rather than as a gap.
 * That distinction comes from the live router graph, not from a hand-written
 * list, so a route that later becomes reachable by a scoped role starts being
 * checked automatically.
 *
 * This is a static check: it proves a scope value is obtained and used, not
 * that the SQL predicate is correct. It is a floor under the cross-scope
 * integration tests, not a replacement for them.
 *
 * Usage:
 *   node scripts/audit-scope-enforcement.js            # report
 *   node scripts/audit-scope-enforcement.js --check    # non-zero exit on gaps
 *   node scripts/audit-scope-enforcement.js --out f    # JSON to file
 */

const fs = require('fs');
const path = require('path');
const { collectRoutes, classify, stubDatabase, tagRouterSources } = require('./generate-rbac-matrix');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');
const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];

/** Roles that address a subset of the data and therefore need enforcement. */
const SCOPED_ROLES = ['school', 'affiliation', 'driver'];

/**
 * Tokens showing the handler constrains the resource to the caller's
 * organisational scope.
 */
const ORG_SCOPE_TOKENS = [
  'resolveSchoolId',
  'resolveAffiliationId',
  'resolveScopeId',
  'req.user.scopeId',
  'user.scopeId',
  'isScopeAllowed',
  'requireFullSchoolScope',
  'resolveGradeScope',
  // participation.routes.js builds its predicate from the caller's token and
  // re-applies it inside the write transaction.
  'scopeClause',
];

/**
 * Tokens for endpoints whose resource is keyed to the actor rather than to an
 * organisation — a driver ending their own shift, a parent reading their own
 * binding. These count, but separately: "it is mine" and "it is in my school"
 * are different guarantees.
 */
const SELF_SCOPE_TOKENS = [
  'getDriverVehicle',
  'resolveDriverVehicle',
  'req.user.driverId',
  'user.driverId',
  'driverId',
  'req.lineUserId',
  'lineUserId',
];

/**
 * `req.user.id` appears in nearly every handler because `logAudit` records the
 * actor, so counting it blindly would make this audit pass vacuously. Audit
 * calls are stripped before matching, leaving only uses where the actor id
 * genuinely constrains the row being written.
 */
const ACTOR_TOKEN = 'req.user.id';

/** Removes `logAudit(...)` calls from the search window. */
function stripAuditCalls(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('logAudit', i);
    if (idx === -1) { out += text.slice(i); break; }
    out += text.slice(i, idx);
    const open = text.indexOf('(', idx);
    if (open === -1) { i = idx + 'logAudit'.length; continue; }
    let depth = 0;
    let j = open;
    for (; j < text.length; j += 1) {
      if (text[j] === '(') depth += 1;
      else if (text[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    i = j + 1;
  }
  return out;
}

/**
 * Balanced-brace body starting at or after `from`. Route handlers are
 * well-formed function bodies, so this is reliable enough to use as a search
 * window; braces inside strings can extend it, never truncate it.
 */
function extractBody(src, from) {
  const start = src.indexOf('{', from);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

const ROUTE_RE = new RegExp(
  `(\\w+)\\.(${WRITE_METHODS.join('|')})\\(\\s*(['"\`])([^'"\`]+)\\3`,
  'g'
);

function auditFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const base = path.basename(file);
  const results = [];
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    const [, routerVar, method, , routePath] = m;
    if (!routePath.includes(':')) continue;

    const bodyStart = src.indexOf('{', m.index);
    const body = extractBody(src, m.index);
    const middlewareChunk = src.slice(m.index, bodyStart + 1);
    const searchable = stripAuditCalls(middlewareChunk + body);

    const orgScope = ORG_SCOPE_TOKENS.filter((t) => searchable.includes(t));
    const selfScope = SELF_SCOPE_TOKENS.filter((t) => searchable.includes(t));
    const actorScope = searchable.includes(ACTOR_TOKEN) ? [ACTOR_TOKEN] : [];

    results.push({
      file: base,
      router: routerVar,
      method: method.toUpperCase(),
      path: routePath,
      org_scope_tokens: orgScope,
      self_scope_tokens: selfScope,
      actor_scope_tokens: actorScope,
      scope_kind: orgScope.length ? 'organisation'
        : selfScope.length ? 'self'
          : actorScope.length ? 'actor'
            : 'none',
    });
  }
  return results;
}

function listRouteFiles() {
  return fs.readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.routes.js'))
    .map((f) => path.join(ROUTES_DIR, f));
}

/** Loads the live router graph so roles come from what is actually mounted. */
function loadMountedRoutes() {
  const restoreDb = stubDatabase();
  const restoreRouter = tagRouterSources();
  try {
    const app = require(path.join(__dirname, '..', 'src', 'app.js'));
    return collectRoutes(app).map(classify);
  } finally {
    restoreRouter();
    restoreDb();
  }
}

/**
 * Matches a file-local route path to its mounted full path, keyed on the file
 * that defined the router plus the local path. A suffix match would be wrong
 * here: `/:id` is the suffix of a dozen unrelated routes across every module.
 *
 * One file can be mounted more than once (registration.routes.js exports a
 * driver router and a school router). Those roles are unioned, because
 * enforcement is required if ANY caller of that handler is scoped.
 */
function attachRoles(handlers, mounted) {
  for (const h of handlers) {
    const candidates = mounted.filter(
      (r) => r.source_file === h.file && r.method === h.method && r.local_path === h.path
    );
    if (candidates.length === 0) {
      h.mounted_path = null;
      h.roles = null; // Not mounted under the current feature flags.
    } else {
      h.mounted_path = candidates.map((c) => c.path).join(' | ');
      h.roles = [...new Set(candidates.flatMap((c) => c.roles))];
    }
    h.needs_scope = Array.isArray(h.roles) && h.roles.some((r) => SCOPED_ROLES.includes(r));
  }
  return handlers;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  const mounted = loadMountedRoutes();
  const handlers = attachRoles(listRouteFiles().flatMap(auditFile), mounted);

  const inScope = handlers.filter((h) => h.needs_scope);
  const gaps = inScope.filter((h) => h.scope_kind === 'none');
  const actorOnly = inScope.filter((h) => h.scope_kind === 'actor');
  const unmounted = handlers.filter((h) => h.roles === null);

  const report = {
    schema_version: '2.0',
    generated_at: new Date().toISOString(),
    scoped_roles: SCOPED_ROLES,
    feature_flags: Object.fromEntries(
      Object.keys(process.env).filter((k) => k.startsWith('FEATURE_')).map((k) => [k, process.env[k]])
    ),
    totals: {
      id_addressed_writes: handlers.length,
      reachable_by_scoped_role: inScope.length,
      organisation_scoped: inScope.filter((h) => h.scope_kind === 'organisation').length,
      self_scoped: inScope.filter((h) => h.scope_kind === 'self').length,
      actor_scoped_only: actorOnly.length,
      gaps: gaps.length,
      not_mounted_under_current_flags: unmounted.length,
    },
    handlers,
    gaps,
    actor_scoped_only: actorOnly,
  };

  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`[scope] wrote ${outFile}\n`);
  }

  const t = report.totals;
  process.stdout.write(
    `[scope] id-addressed writes=${t.id_addressed_writes} `
    + `scoped-role-reachable=${t.reachable_by_scoped_role} `
    + `org=${t.organisation_scoped} self=${t.self_scoped} actor-only=${t.actor_scoped_only} `
    + `gaps=${t.gaps} unmounted=${t.not_mounted_under_current_flags}\n`
  );

  if (gaps.length) {
    process.stdout.write('\n[scope] reachable by a scoped role but no scope resolved:\n');
    for (const g of gaps) {
      process.stdout.write(`  ${g.file.padEnd(30)} ${g.method.padEnd(6)} ${(g.mounted_path || g.path).padEnd(48)} roles=${(g.roles || []).join(',')}\n`);
    }
  } else {
    process.stdout.write('[scope] every id-addressed write reachable by a scoped role resolves that scope\n');
  }

  if (actorOnly.length) {
    process.stdout.write('\n[scope] actor-scoped only — confirm the row is keyed on the actor:\n');
    for (const r of actorOnly) {
      process.stdout.write(`  ${r.file.padEnd(30)} ${r.method.padEnd(6)} ${(r.mounted_path || r.path)}\n`);
    }
  }

  if (check && gaps.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { auditFile, listRouteFiles, attachRoles, ORG_SCOPE_TOKENS, SELF_SCOPE_TOKENS, SCOPED_ROLES };
