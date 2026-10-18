'use strict';

/** Inspect driver permissions from the mounted Express graph without DB I/O. */
const path = require('path');
const fs = require('fs');
const { collectRoutes, classify, stubDatabase, tagRouterSources } = require('./generate-rbac-matrix');
const { REQUIRED_ROUTES, FORBIDDEN_PREFIXES, FEATURE_MOUNTED_ROUTES } = require('../src/config/driverPermissionContract');

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
    return collectRoutes(require(appPath)).map(classify).filter((route) => route.path.startsWith('/api'));
  } finally {
    restoreRouter();
    restoreDb();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function verifyDriverPermissions(routes = collectMountedRoutes()) {
  const findings = [];
  const checks = [];
  const byKey = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));

  for (const expected of REQUIRED_ROUTES) {
    const key = `${expected.method} ${expected.path}`;
    const actual = byKey.get(key);
    let passed = Boolean(actual);
    let detail = actual ? `scope=${expected.scope}` : 'missing route';
    if (actual && !actual.roles.includes('driver')) {
      passed = false; detail = `driver missing from roles: ${actual.roles.join(',')}`;
    } else if (actual && expected.exactRoles && !sameRoles(actual.roles, expected.exactRoles)) {
      passed = false; detail = `roles=${actual.roles.join(',')} expected=${expected.exactRoles.join(',')}`;
    } else if (actual && expected.requiredRoles && !expected.requiredRoles.every((role) => actual.roles.includes(role))) {
      passed = false; detail = `required role missing: ${expected.requiredRoles.join(',')}`;
    }
    checks.push({ id: expected.id, category: expected.category, key, feature: expected.feature || null, passed, detail });
    if (!passed) findings.push({ code: 'REQUIRED_PERMISSION_DRIFT', key, detail });
  }

  for (const forbidden of FORBIDDEN_PREFIXES) {
    const exposed = routes.filter((route) => route.path.startsWith(forbidden.prefix) && route.roles.includes('driver'));
    const passed = exposed.length === 0;
    checks.push({ id: `deny:${forbidden.prefix}`, category: 'DENY', key: forbidden.prefix, passed,
      detail: passed ? forbidden.reason : exposed.map((route) => `${route.method} ${route.path}`).join(', ') });
    if (!passed) findings.push({ code: 'FORBIDDEN_PERMISSION_EXPOSED', prefix: forbidden.prefix, routes: exposed });
  }

  const unexpectedExports = routes.filter((route) => route.roles.includes('driver') && /export/i.test(route.path));
  checks.push({ id: 'deny:driver-export', category: 'DENY', key: '*export*', passed: unexpectedExports.length === 0,
    detail: unexpectedExports.length ? unexpectedExports.map((route) => `${route.method} ${route.path}`).join(', ') : 'คนขับไม่มี route ส่งออก' });
  if (unexpectedExports.length) findings.push({ code: 'DRIVER_EXPORT_EXPOSED', routes: unexpectedExports });

  const transportVerificationWrites = routes.filter((route) => route.roles.includes('driver') && route.write && route.path.startsWith('/api/verification/transport/'));
  checks.push({ id: 'deny:transport-approval', category: 'DENY', key: '/api/verification/transport/*', passed: transportVerificationWrites.length === 0,
    detail: transportVerificationWrites.length ? 'คนขับเข้าถึงงานอนุมัติขนส่ง' : 'คนขับอ่านได้เฉพาะ timeline ที่อยู่ใน scope' });
  if (transportVerificationWrites.length) findings.push({ code: 'DRIVER_APPROVAL_EXPOSED', routes: transportVerificationWrites });

  const driverRoutes = routes.filter((route) => route.roles.includes('driver'));
  const counts = Object.fromEntries(['VIEW', 'EDIT', 'EMERGENCY', 'DENY'].map((category) => [
    category, checks.filter((check) => check.category === category && check.passed).length,
  ]));
  counts.CONDITIONAL = FEATURE_MOUNTED_ROUTES.filter((route) => {
    const mounted = byKey.get(`${route.method} ${route.path}`);
    return mounted && mounted.roles.includes('driver');
  }).length;

  return {
    schema_version: '1.0', generated_at: new Date().toISOString(), role: 'driver',
    source: 'mounted Express route graph; all feature routers mounted for guard inspection',
    driver_route_count: driverRoutes.length, counts, checks, findings, passed: findings.length === 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const report = verifyDriverPermissions();
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) {
    const outFile = path.resolve(args[outIndex + 1]);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`[driver-permissions] ${report.passed ? 'PASS' : 'FAIL'} routes=${report.driver_route_count} findings=${report.findings.length}\n`);
    for (const [category, count] of Object.entries(report.counts)) process.stdout.write(`  ${category.padEnd(11)} ${count}\n`);
    for (const finding of report.findings) process.stdout.write(`  - ${finding.code}: ${finding.key || finding.prefix || ''}\n`);
  }
  if (args.includes('--check') && !report.passed) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { collectMountedRoutes, verifyDriverPermissions };
