#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');

let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();
let baseUrl = 'https://schoolbuslampang.com';
let mode = 'sandbox';

function usage() {
  console.error('Usage: node scripts/create-uat-evidence-pack.js [--out-dir <dir>] [--run-id <id>] [--base-url <url>] [--mode sandbox|read-only-production]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--out-dir' && args[i + 1]) {
    outRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else if (arg === '--base-url' && args[i + 1]) {
    baseUrl = args[i + 1];
    i += 1;
  } else if (arg === '--mode' && args[i + 1]) {
    mode = args[i + 1];
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

if (!['sandbox', 'read-only-production'].includes(mode)) {
  console.error(`[uat-pack] ERROR: unsupported mode: ${mode}`);
  process.exit(2);
}

const roles = [
  ['admin', 'Admin', ['/admin', '/admin/users', '/admin/audit', '/admin/readiness'], [
    'Login with admin account and confirm dashboard loads within 5 seconds.',
    'Confirm user management is visible only to admin.',
    'Review audit log for recent export/action records without exposing secrets.',
    'Open readiness/system health page and capture non-secret health evidence.',
    'Try a province-only or school-only URL and confirm access is denied or redirected.',
  ], 'Read-only in production. User edits must be sandbox-only unless separately approved.'],
  ['province', 'Province', ['/province', '/province/reports', '/province/status', '/reports/policy'], [
    'Confirm province dashboard KPIs load.',
    'Open daily status and confirm province-level scope only.',
    'Open report views and verify export buttons are available as policy allows.',
    'Confirm policy report is visible to province/admin only.',
    'Capture redacted evidence without student-level PII.',
  ], 'Read-only for production UAT; report exports must follow PDPA handling policy.'],
  ['affiliation', 'Affiliation', ['/affiliation', '/affiliation/status', '/affiliation/reports'], [
    'Confirm only own affiliation is visible.',
    'Compare school counts with expected affiliation scope.',
    'Verify cross-affiliation data is not visible.',
    'Attempt a province/admin-only URL and confirm access is denied or redirected.',
  ], 'Read-only for production UAT; data corrections must be recorded for data owners.'],
  ['school-full', 'School full', ['/school', '/school/students', '/school/vehicles', '/school/import', '/school/reports'], [
    'Confirm school dashboard loads.',
    'Review students, vehicles, drivers, and parent records for own school only.',
    'Run import preview in sandbox with a test file; do not import into production.',
    'Open daily/monthly/summary reports and confirm school scope.',
    'Open school audit log and capture redacted evidence.',
  ], 'Any add/edit/import/delete workflow must be sandbox-only during UAT.'],
  ['school-teacher', 'School teacher', ['/school', '/school/students', '/school/reports'], [
    'Confirm teacher-scoped dashboard loads.',
    'Verify visible students match assigned grade/scope only.',
    'Confirm critical write actions are hidden or denied.',
    'Attempt out-of-scope student or route view and confirm access is denied.',
  ], 'No production writes. Teacher scope must be proven with redacted evidence.'],
  ['driver', 'Driver', ['/driver', '/driver/shift', '/driver/pretrip'], [
    'Login on mobile-sized viewport and confirm assigned vehicle/roster loads.',
    'In sandbox, perform check-in and check-out for test students.',
    'In sandbox, test emergency flow once with a clearly marked test incident.',
    'Confirm no other vehicle roster is visible.',
    'Capture mobile evidence without full student PII.',
  ], 'Driver check-in/out/emergency testing must be sandbox-only.'],
  ['transport', 'Transport', ['/transport', '/transport/vehicles', '/transport/verification'], [
    'Open vehicle inspection/verification pages.',
    'Confirm pickup map or vehicle views do not reveal student-level PII.',
    'Review vehicle evidence/inspection workflow in sandbox if it writes data.',
    'Attempt a school/admin-only URL and confirm access is denied or redirected.',
  ], 'Inspection writes must be sandbox-only unless owner separately approves production operation.'],
  ['parent-line', 'Parent/LINE', ['/parent', '/parent/link'], [
    'Open parent LIFF/status page and confirm it loads.',
    'Use a LINE OA test account to bind to a test student in sandbox.',
    'Confirm parent can only see their own linked student.',
    'Test unbind/rebind with test account if policy requires it.',
    'Confirm routine status is LIFF pull first; push messages only follow province policy.',
  ], 'Binding/unbinding must use test accounts and sandbox/test data unless formally approved.'],
  ['operator', 'Operator', ['/health', '/api/auth/me', '/parent', '/parent/link'], [
    'Run public gate against https://schoolbuslampang.com and attach gate log.',
    'Run production read-only gate on server when owner approves.',
    'Verify latest local backup and off-host evidence.',
    'Run restore drill only against lampang_bus_restore_drill after approval.',
    'Run postdeploy gate after approved deployment and monitor logs for 30-60 minutes.',
  ], 'Production/postdeploy gate is read-only; restore drill may write only to the drill DB.'],
].map(([slug, title, routes, checks, writePolicy]) => ({ slug, title, routes, checks, writePolicy }));

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

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return { path: rel(filePath), sha256: sha256(content) };
}

function roleChecklist(role) {
  const routes = role.routes.map((route) => `| \`${baseUrl}${route}\` | | | | |`).join('\n');
  const checks = role.checks.map((check, index) => `| ${index + 1} | ${check} | | | |`).join('\n');
  return `# UAT Evidence - ${role.title}

- Run ID: \`${runId}\`
- Mode: \`${mode}\`
- Base URL: \`${baseUrl}\`
- Tester name:
- Tester role:
- Date/time:

## Safety

- Do not write production data during UAT unless a separate approved operation explicitly allows it.
- Do not record passwords, tokens, LINE user IDs, full CID, raw student lists, or unredacted parent data.
- Write workflows must use sandbox/UAT data.
- ${role.writePolicy}

## Route Smoke

| Route | Result | Evidence path/link | Time | Notes |
|---|---|---|---|---|
${routes}

## Role Checks

| # | Check | Result | Evidence path/link | Notes |
|---:|---|---|---|---|
${checks}

## Issues

| Severity | Description | Owner | Status | Evidence |
|---|---|---|---|---|
| | | | | |

## Sign-off

| Name | Result | Date/time | Signature/approval evidence |
|---|---|---|---|
| | PASS / PASS WITH CONDITIONS / FAIL | | |
`;
}

function readme() {
  const roleRows = roles.map((role) => `| ${role.title} | \`${role.slug}.md\` |`).join('\n');
  return `# UAT Evidence Pack

- Run ID: \`${runId}\`
- Generated: ${new Date().toISOString()}
- Mode: \`${mode}\`
- Base URL: \`${baseUrl}\`

## Safety

- This generator only writes local evidence templates.
- It does not call APIs, deploy, restore, migrate, import, change feature flags, or write any database.
- Keep screenshots and notes redacted. Do not store secrets or raw student/parent PII in this folder.
- Production testing is read-only unless a separate owner/operator approval explicitly allows a named operation.

## Files

| Role | File |
|---|---|
${roleRows}

## Closeout

1. Fill each role file after UAT.
2. Transfer PASS/evidence links into \`docs/UAT_SIGNOFF_2026-08.md\`.
3. Fill owner/operator approval in \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\`.
4. Run \`node scripts/validate-go-live-signoff.js\`.
5. Run \`node scripts/verify-100-readiness.js\`.
`;
}

const files = [];
const outputDir = path.join(outRoot, runId);
files.push(writeFile(path.join(outputDir, 'README.md'), readme()));
for (const role of roles) {
  files.push(writeFile(path.join(outputDir, `${role.slug}.md`), roleChecklist(role)));
}

const manifest = {
  generated_at: new Date().toISOString(),
  run_id: runId,
  root: ROOT,
  base_url: baseUrl,
  mode,
  roles: roles.map((role) => role.slug),
  safety: {
    calls_apis: false,
    runs_restore_drill: false,
    runs_deploy: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
  },
  files,
};
files.push(writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`));

console.log(`[uat-pack] output: ${outputDir}`);
console.log(`[uat-pack] files=${files.length} roles=${roles.length} mode=${mode}`);
