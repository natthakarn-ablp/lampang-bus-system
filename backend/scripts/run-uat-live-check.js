'use strict';

/**
 * run-uat-live-check.js
 *
 * Logs in with an approved UAT credentials pack and checks read-mostly routes
 * for each Test* role. It never prints passwords or auth headers.
 *
 * Usage:
 *   node scripts/run-uat-live-check.js --credentials ../outputs/uat-credentials/<run>/test-users.json --base-url http://127.0.0.1:3000
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'uat-live-check');

let credentialsPath = '';
let baseUrl = 'http://127.0.0.1:3000';
let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--credentials' && args[i + 1]) {
    credentialsPath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--base-url' && args[i + 1]) {
    baseUrl = args[i + 1].replace(/\/+$/, '');
    i += 1;
  } else if (arg === '--out-dir' && args[i + 1]) {
    outRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

if (!credentialsPath) {
  credentialsPath = latestCredentialsPack();
}
if (!credentialsPath || !fs.existsSync(credentialsPath)) {
  console.error('[uat-live] ERROR: credentials file not found; pass --credentials');
  process.exit(2);
}

const outDir = path.join(outRoot, runId);
fs.mkdirSync(outDir, { recursive: true });

const routes = {
  admin: ['/api/auth/me', '/api/admin/system-health', '/api/admin/users?role=admin'],
  province: ['/api/auth/me', '/api/province/dashboard', '/api/province/status-today'],
  affiliation: ['/api/auth/me', '/api/affiliation/dashboard', '/api/affiliation/status-today'],
  school: ['/api/auth/me', '/api/school/dashboard', '/api/school/status-today'],
  driver: ['/api/auth/me', '/api/driver/status-today', '/api/driver/roster'],
  transport: ['/api/auth/me', '/api/transport/dashboard', '/api/transport/vehicles'],
};

main().catch((error) => {
  console.error(`[uat-live] ERROR: ${error.message}`);
  process.exit(1);
});

async function main() {
  const pack = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const rows = [];

  for (const credential of pack.credentials || []) {
    const login = await requestJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: credential.username, password: credential.password }),
    });
    const access = accessTokenFrom(login.body);
    const loginPass = login.status === 200 && Boolean(access);
    rows.push(row(credential, 'login', login.status, loginPass));
    if (!access) continue;

    for (const routePath of routes[routeRole(credential)] || ['/api/auth/me']) {
      const got = await requestJson(`${baseUrl}${routePath}`, {
        headers: { authorization: ['Bearer', access].join(' ') },
      });
      rows.push(row(credential, routePath, got.status, got.status >= 200 && got.status < 300));
    }
  }

  const pass = rows.filter((item) => item.result === 'PASS').length;
  const fail = rows.filter((item) => item.result === 'FAIL').length;
  writeOutputs(pack, rows, pass, fail);
  console.log(`[uat-live] output: ${rel(outDir)}`);
  console.log(`[uat-live] summary pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function accessTokenFrom(body) {
  return body.token ||
    body.accessToken ||
    (body.data && (body.data.token || body.data.accessToken || body.data.access_token)) ||
    (body.data && body.data.tokens && body.data.tokens.accessToken) ||
    '';
}

function routeRole(credential) {
  return credential.username === 'Testteacher' ? 'school' : credential.role;
}

function row(credential, check, status, passed) {
  return {
    username: credential.username,
    role: credential.role,
    check,
    status,
    result: passed ? 'PASS' : 'FAIL',
  };
}

function writeOutputs(pack, rows, pass, fail) {
  const summary = `# Production UAT Live Check

- Generated: ${new Date().toISOString()}
- Base URL: \`${baseUrl}\`
- Credentials pack: \`${rel(credentialsPath)}\`
- PASS: ${pass}
- FAIL: ${fail}

| Username | Role | Check | HTTP | Result |
|---|---|---|---:|---|
${rows.map((item) => `| ${item.username} | ${item.role} | ${item.check} | ${item.status} | ${item.result} |`).join('\n')}

## Safety

This check logs in with approved UAT accounts and calls read-mostly routes. It does not print passwords, auth headers, response bodies, or student/parent PII.
`;
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
  fs.writeFileSync(path.join(outDir, 'results.csv'), csv(rows, ['username', 'role', 'check', 'status', 'result']));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    credentials_pack: rel(credentialsPath),
    credential_usernames: (pack.credentials || []).map((item) => item.username),
    pass,
    fail,
    safety: {
      prints_passwords: false,
      prints_auth_headers: false,
      prints_response_bodies: false,
      writes_test_user_last_login: true,
      writes_student_or_vehicle_data: false,
    },
    files: ['summary.md', 'results.csv', 'manifest.json'],
  }, null, 2)}\n`);
}

function latestCredentialsPack() {
  const root = path.join(ROOT, 'outputs', 'uat-credentials');
  if (!fs.existsSync(root)) return '';
  const latest = fs.readdirSync(root)
    .map((name) => path.join(root, name, 'test-users.json'))
    .filter((candidate) => fs.existsSync(candidate))
    .sort()
    .pop();
  return latest || '';
}

function csv(rows, columns) {
  return `${[
    columns.join(','),
    ...rows.map((item) => columns.map((column) => csvCell(item[column])).join(',')),
  ].join('\n')}\n`;
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function rel(target) {
  return path.relative(ROOT, target).replace(/\\/g, '/');
}

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function timestampBangkok() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function usage() {
  console.error('Usage: node scripts/run-uat-live-check.js [--credentials <file>] [--base-url <url>] [--out-dir <dir>] [--run-id <id>]');
}
