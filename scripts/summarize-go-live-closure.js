#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const schema = require('./lib/closure-report-schema');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE_ROOT = path.join(ROOT, 'outputs', 'go-live-bundle');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'outputs', 'go-live-closure-status');
// The action-row schema and the evidence-existence rule are shared with the
// go-live bundle, both validators and the automated readiness collector.
const { ACTION_COLUMNS, TIMESTAMPED_RUN_DIR } = schema;

let bundlePath = null;
// Overridable so the no-bundle branch can be exercised against an empty root
// without deleting real bundles from outputs/go-live-bundle.
let bundleRoot = DEFAULT_BUNDLE_ROOT;
let outputRoot = DEFAULT_OUTPUT_ROOT;
let runId = timestampBangkok();
let allowPending = false;

function usage() {
  console.error('Usage: node scripts/summarize-go-live-closure.js [--bundle <dir|manifest.json>] [--bundle-root <dir>] [--out-dir <dir>] [--run-id <id>] [--allow-pending]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--bundle' && args[i + 1]) {
    bundlePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--bundle-root' && args[i + 1]) {
    bundleRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--out-dir' && args[i + 1]) {
    outputRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else if (arg === '--allow-pending') {
    allowPending = true;
  } else {
    usage();
    process.exit(2);
  }
}

const selectedBundle = normalizeBundlePath(bundlePath) || latestPack(bundleRoot);
const outDir = path.join(outputRoot, runId);
fs.mkdirSync(outDir, { recursive: true });

const generatedAt = new Date().toISOString();
const gitHead = git(['rev-parse', '--short', 'HEAD']);
const gitStatusLines = git(['status', '--short'])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const result = buildStatus();
writeFile('summary.md', summary(result));
writeFile('owner-actions.csv', actionItemsCsv(result.actionItems));
writeFile('owner-actions.json', `${JSON.stringify(result.actionItems, null, 2)}\n`);
writeFile('manifest.json', `${JSON.stringify({
  generated_at: generatedAt,
  run_id: runId,
  root: ROOT,
  selected_bundle: selectedBundle ? rel(selectedBundle.dir) : null,
  source_git_head: gitHead || null,
  bundle_git_head: result.bundleGitHead || null,
  git_status_clean: gitStatusLines.length === 0,
  status: result.status,
  allow_pending: allowPending,
  totals: result.totals,
  owner_totals: result.ownerTotals,
  action_columns: ACTION_COLUMNS,
  safety: {
    calls_apis: false,
    runs_deploy: false,
    runs_restore_drill: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    writes_any_database: false,
    copies_raw_uat_evidence: false,
  },
  files: ['summary.md', 'owner-actions.csv', 'owner-actions.json', 'manifest.json'],
}, null, 2)}\n`);

console.log(`[closure-status] output: ${outDir}`);
console.log(`[closure-status] summary status=${result.status} actions=${result.actionItems.length} fail=${result.totals.fail} pending=${result.totals.pending} pass=${result.totals.pass} allow_pending=${allowPending}`);
console.log('[closure-status] safety: local files only; no APIs, DB writes, deploys, restore drills, imports, migrations, or feature flags');

if (result.status === 'FAIL') {
  process.exit(1);
}
if (result.status === 'PENDING' && !allowPending) {
  process.exit(1);
}

function buildStatus() {
  if (!selectedBundle) {
    // The owner board must be derived from the same action list the report
    // prints, never hardcoded. An empty ownerTotals here printed "none | 0"
    // in the Owner Board while Next Actions carried a P0 for technical-owner,
    // so the one person who had to act did not appear on the board.
    //
    // The source here is the scan, not the directory. `outputs/go-live-bundle`
    // may not exist at all, and naming a directory that has never been created
    // as the "source" of a status is precisely the confusion this schema splits
    // apart: the scan is what produced FAIL, the root is only where the bundle
    // has to appear.
    const actionItems = [actionRow({
      id: 'bundle-missing',
      category: 'go-live-bundle',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: 1,
      source: `scan of ${rel(bundleRoot)} found no run directory containing manifest.json`,
      source_type: 'command',
      expected_evidence_root: rel(bundleRoot),
      evidence_instruction: `run node scripts/create-go-live-bundle.js; it will ${TIMESTAMPED_RUN_DIR}`,
      action: 'Create a go-live bundle before running final closure review.',
    })];
    return {
      status: 'FAIL',
      bundleGitHead: '',
      checks: [],
      actionItems,
      totals: { pass: 0, pending: 0, fail: 1 },
      ownerTotals: summarizeOwners(actionItems),
    };
  }

  const manifestPath = path.join(selectedBundle.dir, 'manifest.json');
  const parsedManifest = readJson(manifestPath);
  const manifest = parsedManifest || {};
  const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
  const actionItems = readActionItems(selectedBundle.dir);
  const syntheticActions = [];

  // A bundle whose manifest cannot be read, or carries no checks, used to fall
  // straight through to PASS: `readJson(...) || {}` produced zero checks, zero
  // totals and zero action rows, so a corrupt bundle on a clean worktree read as
  // "nothing left to do". A closure board that cannot see the checks has not
  // reviewed them, and the only honest verdict is FAIL.
  let manifestFailures = 0;
  let checksProblem = '';
  if (!parsedManifest) {
    manifestFailures += 1;
    checksProblem = `bundle manifest is not readable JSON: ${rel(manifestPath)}`;
    syntheticActions.push(actionRow({
      id: 'bundle-manifest-unreadable',
      category: 'go-live-bundle',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: 1,
      source: rel(manifestPath),
      source_type: 'report',
      expected_evidence_root: rel(bundleRoot),
      evidence_instruction: `regenerate the bundle; it will ${TIMESTAMPED_RUN_DIR}`,
      action: `Regenerate the go-live bundle: ${rel(manifestPath)} is not readable JSON, so no check result in it can be trusted.`,
    }));
  } else if (checks.length === 0) {
    manifestFailures += 1;
    checksProblem = `bundle manifest records no checks: ${rel(manifestPath)}`;
    syntheticActions.push(actionRow({
      id: 'bundle-manifest-has-no-checks',
      category: 'go-live-bundle',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: 1,
      source: rel(manifestPath),
      source_type: 'report',
      expected_evidence_root: rel(bundleRoot),
      evidence_instruction: `regenerate the bundle; it will ${TIMESTAMPED_RUN_DIR}`,
      action: `Regenerate the go-live bundle: ${rel(manifestPath)} lists no checks, so this board would review nothing.`,
    }));
  }

  if (gitStatusLines.length > 0) {
    syntheticActions.push(actionRow({
      id: 'source-worktree-not-clean',
      category: 'source-state',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: gitStatusLines.length,
      source: 'git status --short',
      source_type: 'command',
      expected_evidence_root: rel(path.join(selectedBundle.dir, 'SOURCE_STATE.md')),
      evidence_instruction: 'review the source candidates listed here, then commit them or record an explicit approval of the deployed source state',
      action: 'Commit, ignore, or explicitly approve every source-state change before final go-live review.',
    }));
  }

  if (gitHead && manifest.git_head && gitHead !== manifest.git_head) {
    syntheticActions.push(actionRow({
      id: 'bundle-stale-git-head',
      category: 'go-live-bundle',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: 1,
      source: rel(manifestPath),
      source_type: 'report',
      expected_evidence_root: rel(bundleRoot),
      evidence_instruction: `regenerate the bundle at the current HEAD; it will ${TIMESTAMPED_RUN_DIR}`,
      action: `Regenerate the go-live bundle because current HEAD ${gitHead} differs from bundle HEAD ${manifest.git_head}.`,
    }));
  }

  for (const check of checks) {
    if (check.status === 'FAIL') {
      const checkLog = check.log || rel(path.join(selectedBundle.dir, 'summary.md'));
      syntheticActions.push(actionRow({
        id: `check-fail-${safeName(check.id).toLowerCase()}`,
        category: 'failed-check',
        owner: ownerForCheck(check.id),
        priority: 'P0',
        pending_count: 1,
        source: checkLog,
        source_type: 'log',
        expected_evidence_root: checkLog,
        evidence_instruction: `fix the cause recorded in this log, then regenerate the bundle so ${check.id} is no longer FAIL`,
        action: `Fix failing go-live bundle check: ${check.id}. ${check.detail || ''}`.trim(),
      }));
    }
  }

  const mergedActions = sortActions([...syntheticActions, ...actionItems]);
  const totals = summarizeChecks(checks, syntheticActions);
  totals.fail += manifestFailures;
  const status = totals.fail > 0
    ? 'FAIL'
    : totals.pending > 0 || mergedActions.length > 0
      ? 'PENDING'
      : 'PASS';

  return {
    status,
    bundleGitHead: manifest.git_head || '',
    checks,
    checksProblem,
    actionItems: mergedActions,
    totals,
    ownerTotals: summarizeOwners(mergedActions),
    manifest,
  };
}

function readActionItems(bundleDir) {
  const actionPath = path.join(bundleDir, 'ACTION_ITEMS.json');
  const parsed = readJson(actionPath);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item, index) => {
    const expectedRoot = text(item.expected_evidence_root) || rel(path.join(bundleDir, 'summary.md'));
    return {
      id: text(item.id) || `action-${index + 1}`,
      category: text(item.category) || 'unknown',
      owner: text(item.owner) || 'project-owner',
      priority: text(item.priority) || 'P1',
      pending_count: Number(item.pending_count || 1),
      source: text(item.source) || rel(actionPath),
      source_type: text(item.source_type) || 'report',
      expected_evidence_root: expectedRoot,
      // Re-derived here rather than copied: the closure board is generated later
      // than the bundle, and evidence may have appeared or been removed since.
      evidence_status: evidenceStatus(expectedRoot),
      evidence_instruction: text(item.evidence_instruction) || 'supply the evidence this row is waiting for',
      action: text(item.action) || 'Review pending action item.',
    };
  });
}

function actionRow(item) {
  return schema.actionRow(ROOT, item);
}

function evidenceStatus(expectedRoot) {
  return schema.evidenceStatus(ROOT, expectedRoot);
}

function summarizeChecks(checks, syntheticActions) {
  const totals = checks.reduce((acc, check) => {
    const key = String(check.status || '').toLowerCase();
    if (key === 'pass') acc.pass += 1;
    else if (key === 'pending') acc.pending += 1;
    else if (key === 'fail') acc.fail += 1;
    else acc.fail += 1;
    return acc;
  }, { pass: 0, pending: 0, fail: 0 });

  for (const action of syntheticActions) {
    // Rows that stand for a failure are counted as failures by the caller, not
    // a second time here as pending.
    if (action.id.startsWith('check-fail-')) continue;
    if (action.id.startsWith('bundle-manifest-')) continue;
    totals.pending += 1;
  }
  return totals;
}

function summarizeOwners(items) {
  const owners = {};
  for (const item of items) {
    const owner = item.owner || 'project-owner';
    owners[owner] = owners[owner] || { actions: 0, pending_count: 0, p0: 0, p1: 0, p2: 0 };
    owners[owner].actions += 1;
    owners[owner].pending_count += Number(item.pending_count || 0);
    const priority = String(item.priority || '').toLowerCase();
    if (priority === 'p0') owners[owner].p0 += 1;
    else if (priority === 'p2') owners[owner].p2 += 1;
    else owners[owner].p1 += 1;
  }
  return owners;
}

function sortActions(items) {
  return items.slice().sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
    const byOwner = String(a.owner).localeCompare(String(b.owner));
    if (byOwner !== 0) return byOwner;
    return String(a.id).localeCompare(String(b.id));
  });
}

function priorityRank(value) {
  const priority = String(value || '').toUpperCase();
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  if (priority === 'P2') return 2;
  return 3;
}

function ownerForCheck(id) {
  if (/uat/i.test(id)) return 'uat-lead';
  if (/restore|operator|production|postdeploy|monitor/i.test(id)) return 'operator';
  if (/signoff|approval/i.test(id)) return 'project-owner';
  return 'technical-owner';
}

function summary(result) {
  const bundle = selectedBundle ? rel(selectedBundle.dir) : 'not found';
  const ownerRows = Object.entries(result.ownerTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, totals]) => `| ${owner} | ${totals.actions} | ${totals.pending_count} | ${totals.p0} | ${totals.p1} | ${totals.p2} |`)
    .join('\n') || '| none | 0 | 0 | 0 | 0 | 0 |';

  const checkRows = result.checks.length > 0
    ? result.checks.map((check) => `| ${check.id || ''} | ${check.status || ''} | ${escapeCell(check.detail || '')} | ${check.log ? `\`${check.log}\`` : ''} |`).join('\n')
    : `| go-live-bundle | FAIL | ${escapeCell(result.checksProblem || 'no bundle available')} | |`;

  const nextRows = result.actionItems.length > 0
    ? result.actionItems.slice(0, 30).map((item) => `| ${item.priority} | ${item.owner} | ${item.category} | ${item.pending_count} | ${escapeCell(item.action)} | \`${item.source}\` | \`${item.expected_evidence_root}\` | ${item.evidence_status} |`).join('\n')
    : '| PASS | none | none | 0 | No remaining action item in the selected bundle. | | | |';

  return `# Go-live Closure Status

- Generated: ${generatedAt}
- Status: ${result.status}
- Allow pending: ${allowPending}
- Selected bundle: \`${bundle}\`
- Current git HEAD: \`${gitHead || 'unknown'}\`
- Bundle git HEAD: \`${result.bundleGitHead || 'unknown'}\`
- Git status clean: ${gitStatusLines.length === 0 ? 'yes' : 'no'}
- Action items: ${result.actionItems.length}

## Gate Totals

- PASS: ${result.totals.pass}
- PENDING: ${result.totals.pending}
- FAIL: ${result.totals.fail}

## Owner Board

| Owner | Actions | Pending fields | P0 | P1 | P2 |
|---|---:|---:|---:|---:|---:|
${ownerRows}

## Checks

| Check | Status | Detail | Log |
|---|---|---|---|
${checkRows}

## Next Actions

| Priority | Owner | Category | Pending | Action | Status source | Expected evidence root | Evidence |
|---|---|---|---:|---|---|---|---|
${nextRows}

## Final Commands

\`\`\`bash
node scripts/validate-go-live-bundle.js ${bundle}
node scripts/summarize-go-live-closure.js --bundle ${bundle}
node scripts/validate-go-live-closure-status.js ${rel(outDir)}
node scripts/verify-100-readiness.js
\`\`\`

All commands above must pass without \`--allow-pending\` before readiness can be called 100%.

## Safety

This report reads local bundle files and writes local summary files only. It does not call APIs, write a database, deploy, run restore drills, run migrations/imports, change feature flags, or copy raw UAT evidence.
`;
}

function actionItemsCsv(items) {
  return schema.actionRowsCsv(items);
}

function normalizeBundlePath(targetPath) {
  if (!targetPath) return null;
  if (!fs.existsSync(targetPath)) return null;
  const stat = fs.statSync(targetPath);
  const dir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  return fs.existsSync(path.join(dir, 'manifest.json')) ? { dir } : null;
}

function latestPack(root) {
  if (!fs.existsSync(root)) return null;
  const packs = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({
      dir: candidate,
      mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return packs.length > 0 ? { dir: packs[0].dir } : null;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(outDir, name), content);
}

function git(argsForGit) {
  const result = spawnSync('git', argsForGit, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
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

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
