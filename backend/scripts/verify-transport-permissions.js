'use strict';

/**
 * Repeatable transport-role permission check.
 *
 * This inspects the mounted Express graph with all feature routers mounted. It
 * does not connect to a database and performs no writes. Runtime feature flags
 * must still be recorded separately by the operator workflow.
 */
const path = require('path');
const fs = require('fs');
const {
  collectRoutes, classify, stubDatabase, tagRouterSources,
} = require('./generate-rbac-matrix');
const {
  REQUIRED_ROUTES, FORBIDDEN_PREFIXES, CONDITIONAL_ROUTES,
} = require('../src/config/transportPermissionContract');

const ROUTER_FLAGS = [
  'FEATURE_DRIVER_REGISTRATION', 'FEATURE_VEHICLE_QR',
  'FEATURE_PARENT_CONSENT_REQUIRED', 'FEATURE_ETA', 'FEATURE_GEOFENCE',
  'FEATURE_ROUTE_DEVIATION', 'FEATURE_DRIVER_SHIFT', 'FEATURE_PARTICIPATION_CASES',
];

function sameRoles(actual, expected) {
  return [...actual].sort().join(',') === [...expected].sort().join(',');
}

function collectMountedRoutes() {
  const saved = Object.fromEntries(ROUTER_FLAGS.map((key) => [key, process.env[key]]));
  for (const key of ROUTER_FLAGS) process.env[key] = 'true';
  const restoreDb = stubDatabase();
  const restoreRouter = tagRouterSources();
  try {
    const appPath = path.join(__dirname, '..', 'src', 'app.js');
    delete require.cache[require.resolve(appPath)];
    const app = require(appPath);
    return collectRoutes(app).map(classify)
      .filter((route) => route.path.startsWith('/api'));
  } finally {
    restoreRouter();
    restoreDb();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function verifyTransportPermissions(routes = collectMountedRoutes()) {
  const findings = [];
  const checks = [];
  const byKey = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));

  for (const expected of REQUIRED_ROUTES) {
    const key = `${expected.method} ${expected.path}`;
    const actual = byKey.get(key);
    let passed = Boolean(actual);
    let detail = actual ? 'mounted' : 'missing route';
    if (actual && !actual.roles.includes('transport')) {
      passed = false;
      detail = `transport missing from roles: ${actual.roles.join(',')}`;
    } else if (actual && expected.exactRoles && !sameRoles(actual.roles, expected.exactRoles)) {
      passed = false;
      detail = `roles=${actual.roles.join(',')} expected=${expected.exactRoles.join(',')}`;
    } else if (actual && expected.requiredRoles && !expected.requiredRoles.every((role) => actual.roles.includes(role))) {
      passed = false;
      detail = `required role missing: ${expected.requiredRoles.join(',')}`;
    }
    checks.push({ id: expected.id, category: expected.category, key, passed, detail });
    if (!passed) findings.push({ code: 'REQUIRED_PERMISSION_DRIFT', key, detail });
  }

  for (const forbidden of FORBIDDEN_PREFIXES) {
    const exposed = routes.filter((route) => route.path.startsWith(forbidden.prefix) && route.roles.includes('transport'));
    const passed = exposed.length === 0;
    checks.push({
      id: `deny:${forbidden.prefix}`, category: 'DENY', key: forbidden.prefix,
      passed, detail: passed ? forbidden.reason : exposed.map((route) => `${route.method} ${route.path}`).join(', '),
    });
    if (!passed) findings.push({ code: 'FORBIDDEN_PERMISSION_EXPOSED', prefix: forbidden.prefix, routes: exposed });
  }

  for (const conditional of CONDITIONAL_ROUTES) {
    const key = `${conditional.method} ${conditional.path}`;
    const actual = byKey.get(key);
    const passed = Boolean(actual && sameRoles(actual.roles, ['admin', 'transport']));
    checks.push({ id: conditional.id, category: 'CONDITIONAL', key, feature: conditional.feature, passed,
      detail: passed ? 'guarded when feature is enabled' : 'missing or role drift' });
    if (!passed) findings.push({ code: 'CONDITIONAL_PERMISSION_DRIFT', key, feature: conditional.feature });
  }

  const transportRoutes = routes.filter((route) => route.roles.includes('transport'));
  const counts = Object.fromEntries(
    ['VIEW', 'EDIT', 'APPROVE', 'EXPORT', 'DENY', 'CONDITIONAL'].map((category) => [
      category, checks.filter((check) => check.category === category && check.passed).length,
    ])
  );

  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    role: 'transport',
    source: 'mounted Express route graph; all feature routers mounted for guard inspection',
    transport_route_count: transportRoutes.length,
    counts,
    checks,
    findings,
    passed: findings.length === 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const report = verifyTransportPermissions();
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) {
    const outFile = path.resolve(args[outIndex + 1]);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[transport-permissions] ${report.passed ? 'PASS' : 'FAIL'} routes=${report.transport_route_count} findings=${report.findings.length}\n`);
    for (const [category, count] of Object.entries(report.counts)) {
      process.stdout.write(`  ${category.padEnd(11)} ${count}\n`);
    }
    for (const finding of report.findings) process.stdout.write(`  - ${finding.code}: ${finding.key || finding.prefix}\n`);
  }
  if (args.includes('--check') && !report.passed) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { collectMountedRoutes, verifyTransportPermissions };
