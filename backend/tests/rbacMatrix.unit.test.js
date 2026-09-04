'use strict';

/**
 * Access control regression suite, driven by the live router graph rather than
 * by a written-down matrix. A route added without a guard fails here on the
 * commit that adds it, which is the only time it is cheap to fix.
 *
 * Feature-flagged routers are mounted for this run so a dark-launched module
 * cannot skip the check by being off in the test environment.
 */

const path = require('path');

const FLAGS = [
  'FEATURE_DRIVER_REGISTRATION',
  'FEATURE_VEHICLE_QR',
  'FEATURE_PARENT_CONSENT_REQUIRED',
  'FEATURE_ETA',
  'FEATURE_GEOFENCE',
  'FEATURE_ROUTE_DEVIATION',
  'FEATURE_DRIVER_SHIFT',
];

const SCRIPTS = path.join(__dirname, '..', 'scripts');

let routes;
let scopeReport;

beforeAll(() => {
  const saved = {};
  for (const f of FLAGS) { saved[f] = process.env[f]; process.env[f] = 'true'; }
  try {
    // Loaded inside the flag window so every router is mounted.
    const { collectRoutes, classify, stubDatabase, tagRouterSources } = require(path.join(SCRIPTS, 'generate-rbac-matrix.js'));
    const restoreDb = stubDatabase();
    const restoreRouter = tagRouterSources();
    let app;
    try {
      app = require(path.join(__dirname, '..', 'src', 'app.js'));
    } finally {
      restoreRouter();
      restoreDb();
    }
    const mounted = collectRoutes(app).map(classify);
    routes = mounted.filter((r) => r.path.startsWith('/api') || r.path === '/health');

    const scopeAudit = require(path.join(SCRIPTS, 'audit-scope-enforcement.js'));
    const handlers = scopeAudit.attachRoles(
      scopeAudit.listRouteFiles().flatMap(scopeAudit.auditFile),
      mounted
    );
    scopeReport = {
      handlers,
      inScope: handlers.filter((h) => h.needs_scope),
      gaps: handlers.filter((h) => h.needs_scope && h.scope_kind === 'none'),
    };
  } finally {
    for (const f of FLAGS) {
      if (saved[f] === undefined) delete process.env[f];
      else process.env[f] = saved[f];
    }
  }
});

describe('RBAC coverage', () => {
  it('mounts a non-trivial API surface (guards against a silent no-op)', () => {
    // If app.js ever fails to mount its routers, every other assertion here
    // would pass vacuously.
    expect(routes.length).toBeGreaterThan(200);
  });

  it('leaves no route without a guard or a recorded reason', () => {
    const unguarded = routes.filter((r) => r.findings.length > 0);
    expect(unguarded.map((r) => `${r.method} ${r.path}: ${r.findings.join(',')}`)).toEqual([]);
  });

  it('records a reason for every intentionally open route', () => {
    const accepted = routes.filter((r) => r.accepted_exception);
    expect(accepted.length).toBeGreaterThan(0);
    for (const r of accepted) {
      expect(typeof r.accepted_exception).toBe('string');
      expect(r.accepted_exception.length).toBeGreaterThan(40);
    }
  });

  it('does not expose a write action to every role at once', () => {
    const wideWrites = routes.filter((r) => r.write && r.roles.length === 6);
    expect(wideWrites.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('keeps province read-mostly, matching the documented RBAC matrix', () => {
    // CLAUDE.md §8: province is oversight, not data entry. A new province
    // write should be a deliberate decision, not a drift.
    const provinceWrites = routes.filter((r) => r.write && r.roles.includes('province') && !r.roles.includes('school'));
    expect(provinceWrites.length).toBeLessThanOrEqual(2);
  });

  it('never lets driver or transport reach an admin user-management route', () => {
    const userAdmin = routes.filter((r) => r.path.startsWith('/api/admin/users'));
    expect(userAdmin.length).toBeGreaterThan(0);
    for (const r of userAdmin) {
      expect(r.roles).toEqual(['admin']);
    }
  });

  it('keeps check-in writes away from oversight roles', () => {
    // CLAUDE.md §8: check-in is driver-only, with a school override.
    const checkin = routes.filter((r) => r.write && /checkin/i.test(r.path));
    expect(checkin.length).toBeGreaterThan(0);
    for (const r of checkin) {
      expect(r.roles).not.toContain('province');
      expect(r.roles).not.toContain('affiliation');
      expect(r.roles).not.toContain('transport');
    }
  });
});

describe('server-side scope enforcement', () => {
  it('finds id-addressed writes to check (guards against a vacuous pass)', () => {
    expect(scopeReport.handlers.length).toBeGreaterThan(50);
    expect(scopeReport.inScope.length).toBeGreaterThan(20);
  });

  it('resolves caller scope on every id-addressed write a scoped role can reach', () => {
    expect(scopeReport.gaps.map((g) => `${g.file} ${g.method} ${g.mounted_path}`)).toEqual([]);
  });

  it('maps every audited handler to a mounted path with all flags on', () => {
    const unmounted = scopeReport.handlers.filter((h) => h.roles === null);
    expect(unmounted.map((h) => `${h.file} ${h.method} ${h.path}`)).toEqual([]);
  });
});
