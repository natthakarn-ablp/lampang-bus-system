'use strict';

// Six-role read workload for an isolated local sandbox only. This does not
// establish full-system capacity: check-in, exports, imports and LINE are out
// of scope. Responses, tokens, URL parameters and identities are never saved.
const fs = require('fs');
const path = require('path');
const { runStage } = require('./load-test');

const SCENARIOS = Object.freeze([
  { key: 'school_status', role: 'school', weight: 0.35, writes: false, method: 'GET', path: '/api/school/status-today' },
  { key: 'driver_roster', role: 'driver', weight: 0.20, writes: false, method: 'GET', path: '/api/driver/roster' },
  { key: 'transport_dashboard', role: 'transport', weight: 0.15, writes: false, method: 'GET', path: '/api/transport/dashboard' },
  { key: 'affiliation_dashboard', role: 'affiliation', weight: 0.12, writes: false, method: 'GET', path: '/api/affiliation/dashboard' },
  { key: 'province_dashboard', role: 'province', weight: 0.10, writes: false, method: 'GET', path: '/api/province/dashboard' },
  { key: 'admin_pending_count', role: 'admin', weight: 0.08, writes: false, method: 'GET', path: '/api/admin/pending-requests-count' },
]);
const ROLES = SCENARIOS.map((scenario) => scenario.role);

function checkSandboxTarget(raw) {
  let url;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'invalid_target' }; }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return { ok: false, reason: 'target_must_be_loopback_http' };
  }
  if (!url.port || url.port === '3000' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    return { ok: false, reason: 'target_requires_explicit_nonproduction_port_and_origin_only' };
  }
  return { ok: true, origin: url.origin };
}

function readRoleTokens(file) {
  const tokens = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('invalid_token_file');
  const missing = ROLES.filter((role) => typeof tokens[role] !== 'string' || !tokens[role]);
  if (missing.length) throw new Error(`missing_sandbox_roles:${missing.join(',')}`);
  return Object.fromEntries(ROLES.map((role) => [role, tokens[role]]));
}

function parsePlan(args) {
  const raw = args.users;
  if (typeof raw !== 'string' || !/^\d+(,\d+)*$/.test(raw)) throw new Error('users_must_be_explicit_integer_list');
  const users = raw.split(',').map(Number);
  const maxUsers = Number(args['max-users']);
  const duration = Number(args.duration);
  if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 200 || users.some((n) => n < 1 || n > maxUsers)) {
    throw new Error('max_users_must_be_1_to_200_and_cover_every_stage');
  }
  if (!Number.isInteger(duration) || duration < 10 || duration > 120) throw new Error('duration_must_be_10_to_120_seconds');
  if (users.some((n, i) => i > 0 && n <= users[i - 1])) throw new Error('users_must_increase');
  return users.map((n) => ({ label: `staff-read-${n}`, users: n, durationSec: duration }));
}

function assessStage(stage) {
  const failures = [];
  if (stage.aborted) failures.push(`stopped:${stage.aborted.reason}`);
  for (const scenario of SCENARIOS) {
    const result = stage.by_scenario[scenario.key];
    if (!result || result.served < 30) failures.push(`${scenario.key}:under_30_served`);
    else if (result.served_ratio < 0.5) failures.push(`${scenario.key}:under_half_served`);
    else if (result.error_rate > 0.01) failures.push(`${scenario.key}:error_rate_over_1_percent`);
    else if (result.p95_ms > 1000) failures.push(`${scenario.key}:p95_over_provisional_1000ms`);
  }
  if (!stage.server || !stage.server.samples) failures.push('server_capacity_samples_missing');
  return { provisional_pass: failures.length === 0, failures };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('unknown_argument');
    const key = argv[i].slice(2);
    if (args[key] !== undefined) throw new Error(`duplicate_argument:${key}`);
    if (key === 'dry-run') args[key] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
    else throw new Error(`missing_value:${key}`);
  }
  const allowed = new Set(['dry-run', 'target', 'sandbox', 'token-file', 'users', 'max-users', 'duration', 'out']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`unknown_option:${key}`);
  return args;
}

async function verifySandbox(origin) {
  const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (response.status !== 200) throw new Error('sandbox_health_failed');
  const payload = await response.json();
  const data = payload && payload.data;
  if (!payload.success || data?.service !== 'lampang-bus-backend' || data.environment !== 'test' || !data.database?.connected) {
    throw new Error('target_not_verified_test_sandbox');
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['dry-run']) {
    process.stdout.write(`dry_run_only roles=${ROLES.join(',')} scenarios=${SCENARIOS.length} writes=0 requests_sent=0\n`);
    return;
  }
  if (args.sandbox !== 'isolated-synthetic') throw new Error('explicit_isolated_synthetic_sandbox_required');
  const target = checkSandboxTarget(args.target);
  if (!target.ok) throw new Error(target.reason);
  const plan = parsePlan(args);
  if (!args['token-file']) throw new Error('private_sandbox_token_file_required');
  const tokens = readRoleTokens(args['token-file']);
  await verifySandbox(target.origin);

  const results = [];
  for (const stage of plan) {
    const result = await runStage({
      target: target.origin, scenarios: SCENARIOS, users: stage.users, durationSec: stage.durationSec,
      tokens, adminToken: tokens.admin, sampleIntervalSec: 5, requestTimeoutMs: 5000,
      stop: { abortErrorRate: 0.05, abortP95Ms: 5000, abortRssMb: 512, abortConsecutive: 2, watchIntervalSec: 5 },
    });
    const assessment = assessStage(result);
    results.push({ label: stage.label, ...result, assessment });
    if (result.aborted || !assessment.provisional_pass) break;
  }
  const report = {
    kind: 'isolated_synthetic_six_staff_read_rehearsal',
    generated_at: new Date().toISOString(),
    roles: ROLES, read_only: true, production_capacity_claim: false,
    acceptance_thresholds_provisional: true,
    stage_plan: plan, stages: results,
    incomplete_stages: plan.slice(results.length).map((stage) => stage.label),
    limitations: ['no_write_workflows', 'no_LINE_parent', 'no_production_load', 'staging_hardware_may_differ'],
  };
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    process.stdout.write('wrote_private_aggregate_report\n');
  }
  process.stdout.write(`stages_run=${results.length} provisional_pass=${results.length === plan.length && results.every((r) => r.assessment.provisional_pass)}\n`);
  if (results.length !== plan.length || results.some((r) => !r.assessment.provisional_pass)) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});

module.exports = { SCENARIOS, ROLES, checkSandboxTarget, readRoleTokens, parsePlan, assessStage, parseArgs, verifySandbox };
