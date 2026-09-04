'use strict';

/**
 * Generates the role-to-route/API/write-action matrix required by Phase 5 of
 * `docs/project-closure/master-project-closure-plan.md`.
 *
 * It builds the app for real and walks Express's own router graph, so what it
 * reports is what is actually mounted. A grep over route files cannot tell a
 * guard that runs from one that is merely written down, and that difference is
 * the whole point of an access-control audit.
 *
 * Usage:
 *   node scripts/generate-rbac-matrix.js                 # human-readable table
 *   node scripts/generate-rbac-matrix.js --json          # machine-readable
 *   node scripts/generate-rbac-matrix.js --out <file>    # write JSON to file
 *   node scripts/generate-rbac-matrix.js --check         # non-zero exit on findings
 *
 * No database connection is made: the pool is stubbed before the app loads,
 * because route registration never queries.
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ALL_ROLES = ['driver', 'school', 'affiliation', 'province', 'transport', 'admin'];
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/**
 * Endpoints that are authenticated by something other than a JWT role, so an
 * absent `requireRole` is correct rather than a gap. Each entry says which
 * mechanism takes over, and the guard function is asserted to be present.
 */
const NON_ROLE_AUTH = [
  { prefix: '/api/auth', mechanism: 'public or self-service (login, refresh, change-password)' },
  { prefix: '/api/parent', mechanism: 'LINE id_token via requireParentLineAuth' },
  { prefix: '/api/consent', mechanism: 'LINE id_token via requireParentLineAuth' },
  { prefix: '/api/line', mechanism: 'LINE webhook signature' },
  { prefix: '/api/qr', mechanism: 'signed QR token' },
  { prefix: '/api/health', mechanism: 'public health probe' },
];

/**
 * Routes that are authenticated but intentionally open to every role, or
 * intentionally public. Each needs a reason, because "we decided that was
 * fine" is exactly the kind of thing that stops being true silently. A route
 * not on this list and not covered by NON_ROLE_AUTH is reported as a finding.
 */
const ACCEPTED_OPEN_ROUTES = [
  {
    method: 'GET', path: '/health',
    reason: 'Public liveness probe. Returns service name, version, commit and DB connectivity only — no scoped data.',
  },
  {
    method: 'GET', path: '/api/terms/current',
    reason: 'Authenticated, any role. Returns the current academic term id and window, which every role needs to label data correctly. No PII and no scoped rows.',
  },
  {
    method: 'POST', path: '/api/visits/track',
    reason: 'Public aggregate visit counter. No PII, no IP, no user-agent stored. Rate-limited via GLOBAL_API_LIMITED_PREFIXES; flagged non_attributable_traffic_counter so it is never used as a research metric.',
  },
];

function acceptedException(route) {
  return ACCEPTED_OPEN_ROUTES.find((a) => a.method === route.method && a.path === route.path) || null;
}

/**
 * Tags every Router with the file that created it. Route files do not know
 * their own mount prefix, so without this the only way to map a file-local
 * path like `/:id` back to its mounted path is a suffix match — and `/:id`
 * is a suffix of a dozen unrelated routes. Tagging makes the mapping exact.
 */
function tagRouterSources() {
  const express = require('express');
  const originalRouter = express.Router;
  function patched(...args) {
    const router = originalRouter.apply(this, args);
    // Frame 0 is Error, frame 1 is this function, frame 2 is the caller.
    const frame = (new Error().stack || '').split('\n')[2] || '';
    const fileMatch = frame.match(/\(?([A-Za-z]:[\\/][^):]+|\/[^):]+)[:)]/);
    router.__sourceFile = fileMatch ? path.basename(fileMatch[1]) : null;
    return router;
  }
  Object.assign(patched, originalRouter);
  express.Router = patched;
  return () => { express.Router = originalRouter; };
}

function stubDatabase() {
  const orig = Module.prototype.require;
  const stubPool = {
    query: async () => [[], []],
    execute: async () => [[], []],
    getConnection: async () => ({
      query: async () => [[], []],
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
    end: async () => {},
  };
  Module.prototype.require = function patched(request) {
    if (/(^|[\\/])config[\\/]database$/.test(request) || request.endsWith('config/database')) {
      return { pool: stubPool, testConnection: async () => true };
    }
    return orig.apply(this, arguments);
  };
  return () => { Module.prototype.require = orig; };
}

/** Turns an Express layer regexp back into the path fragment it was built from. */
function layerPrefix(layer) {
  if (layer.path) return layer.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  if (src === '^\\/?(?=\\/|$)') return '';
  const m = src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
}

function describeGuards(handlers) {
  const roles = [];
  const named = [];
  let sawRoleGuard = false;
  for (const fn of handlers) {
    if (fn && fn.guardType === 'requireRole') {
      sawRoleGuard = true;
      roles.push(...fn.allowedRoles);
    } else if (fn && fn.name) {
      named.push(fn.name);
    }
  }
  return { roles: [...new Set(roles)], named: [...new Set(named)], sawRoleGuard };
}

/**
 * Walks a router, accumulating middleware that applies to everything below it
 * (`router.use(...)`) so a route inherits the guards mounted above it.
 */
function walkRouter(router, basePath, inherited, out) {
  const stack = (router && router.stack) || [];
  for (const layer of stack) {
    if (layer.route) {
      const routePath = basePath + (layer.route.path === '/' ? '' : layer.route.path);
      const handlers = layer.route.stack.map((s) => s.handle);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          path: routePath || '/',
          local_path: layer.route.path,
          source_file: router.__sourceFile || null,
          handlers: [...inherited, ...handlers],
        });
      }
      continue;
    }
    const handle = layer.handle;
    const isRouter = handle && handle.stack && typeof handle === 'function';
    if (isRouter) {
      walkRouter(handle, basePath + layerPrefix(layer), [...inherited], out);
    } else if (handle) {
      // Plain middleware. `router.use(fn)` with no path applies to siblings
      // registered after it, which is how every route file mounts its guards.
      const prefix = layerPrefix(layer);
      if (!prefix) inherited.push(handle);
    }
  }
}

function collectRoutes(app) {
  const out = [];
  // Express 4 exposes the root router as `_router`; touching `app.router`
  // throws a 3.x-migration error, so it is never probed.
  const rootStack = (app._router && app._router.stack) || [];
  walkRouter({ stack: rootStack }, '', [], out);
  return out;
}

function classify(route) {
  const { roles, named, sawRoleGuard } = describeGuards(route.handlers);
  const isWrite = WRITE_METHODS.has(route.method.toLowerCase());
  const nonRole = NON_ROLE_AUTH.find((n) => route.path.startsWith(n.prefix));
  const hasAuthenticate = named.includes('authenticate');
  const hasOptionalAuth = named.includes('optionalAuth');

  const findings = [];
  if (!sawRoleGuard && !nonRole) {
    findings.push('no_role_guard');
  }
  if (!hasAuthenticate && !hasOptionalAuth && !nonRole) {
    findings.push('no_authenticate');
  }
  if (sawRoleGuard && roles.length === ALL_ROLES.length && isWrite) {
    findings.push('write_open_to_every_role');
  }

  const classified = {
    method: route.method,
    path: route.path,
    local_path: route.local_path || null,
    source_file: route.source_file || null,
    write: isWrite,
    roles: sawRoleGuard ? roles.sort() : [],
    guards: named.filter((n) => n && n !== 'bound dispatch' && !n.startsWith('router')),
    auth_mechanism: nonRole ? nonRole.mechanism : (sawRoleGuard ? 'jwt_role' : 'unknown'),
    findings,
  };

  const accepted = acceptedException(classified);
  if (accepted && findings.length > 0) {
    classified.accepted_exception = accepted.reason;
    classified.findings = [];
  }
  return classified;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const check = args.includes('--check');
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  // Route registration is gated on feature flags, so report which were on.
  const flags = Object.fromEntries(
    Object.keys(process.env)
      .filter((k) => k.startsWith('FEATURE_'))
      .map((k) => [k, process.env[k]])
  );

  const restoreDb = stubDatabase();
  const restoreRouter = tagRouterSources();
  let app;
  try {
    app = require(path.join(__dirname, '..', 'src', 'app.js'));
  } finally {
    restoreRouter();
    restoreDb();
  }

  const routes = collectRoutes(app).map(classify)
    .filter((r) => r.path.startsWith('/api') || r.path === '/health')
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

  const byRole = {};
  for (const role of ALL_ROLES) {
    const reachable = routes.filter((r) => r.roles.includes(role));
    byRole[role] = {
      total: reachable.length,
      write: reachable.filter((r) => r.write).length,
      read: reachable.filter((r) => !r.write).length,
    };
  }

  const findings = routes.filter((r) => r.findings.length > 0);

  const report = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    feature_flags: flags,
    totals: {
      routes: routes.length,
      write_routes: routes.filter((r) => r.write).length,
      routes_with_role_guard: routes.filter((r) => r.roles.length > 0).length,
      findings: findings.length,
    },
    by_role: byRole,
    routes,
    findings,
  };

  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`[rbac] wrote ${outFile} (${routes.length} routes, ${findings.length} findings)\n`);
  } else if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`[rbac] routes=${report.totals.routes} write=${report.totals.write_routes} guarded=${report.totals.routes_with_role_guard}\n`);
    for (const role of ALL_ROLES) {
      process.stdout.write(`  ${role.padEnd(12)} read=${String(byRole[role].read).padStart(3)} write=${String(byRole[role].write).padStart(3)}\n`);
    }
    if (findings.length) {
      process.stdout.write(`\n[rbac] ${findings.length} route(s) need review:\n`);
      for (const f of findings) {
        process.stdout.write(`  ${f.method.padEnd(6)} ${f.path.padEnd(52)} ${f.findings.join(',')} (auth=${f.auth_mechanism})\n`);
      }
    } else {
      process.stdout.write('\n[rbac] no unguarded routes found\n');
    }
  }

  if (check && findings.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { collectRoutes, classify, stubDatabase, tagRouterSources, ALL_ROLES, WRITE_METHODS };
