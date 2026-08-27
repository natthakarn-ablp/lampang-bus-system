#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'uat-status');

const REQUIRED_ROLES = [
  ['admin', 'Admin'],
  ['province', 'Province'],
  ['affiliation', 'Affiliation'],
  ['school-full', 'School full'],
  ['school-teacher', 'School teacher'],
  ['driver', 'Driver'],
  ['transport', 'Transport'],
  ['parent-line', 'Parent/LINE'],
  ['operator', 'Operator'],
].map(([slug, title]) => ({ slug, title }));

const SAFETY_FLAGS = [
  'calls_apis',
  'runs_restore_drill',
  'runs_deploy',
  'runs_migrations',
  'runs_imports',
  'runs_feature_flags',
  'writes_production_db',
];

let targetPath = null;
let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();

function usage() {
  console.error('Usage: node scripts/summarize-uat-evidence.js [uat-evidence-dir|manifest.json] [--out-dir <dir>] [--run-id <id>]');
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
  } else if (!targetPath) {
    targetPath = path.resolve(arg);
  } else {
    usage();
    process.exit(2);
  }
}

const state = {
  structuralFailures: [],
  missingItems: [],
  issueRows: [],
  roleSummaries: [],
};

const resolvedTarget = targetPath || latestPackPath();
if (!resolvedTarget) {
  console.error('[uat-status] ERROR: no UAT evidence pack found');
  process.exit(1);
}

const stat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
if (!stat) {
  console.error(`[uat-status] ERROR: target not found: ${resolvedTarget}`);
  process.exit(1);
}

const packDir = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
const manifestPath = stat.isDirectory() ? path.join(resolvedTarget, 'manifest.json') : resolvedTarget;

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`[uat-status] ERROR: manifest is not valid JSON: ${err.message}`);
  process.exit(1);
}

const manifestRoles = Array.isArray(manifest.roles) ? manifest.roles : [];
for (const role of REQUIRED_ROLES) {
  if (!manifestRoles.includes(role.slug)) {
    addStructuralFailure(`manifest missing role: ${role.slug}`);
  }
}

const safety = manifest.safety || {};
const unsafe = SAFETY_FLAGS.filter((flag) => safety[flag] !== false);
if (unsafe.length > 0) {
  addStructuralFailure(`unsafe manifest flags: ${unsafe.join(', ')}`);
}

for (const role of REQUIRED_ROLES) {
  state.roleSummaries.push(summarizeRole(role));
}

const totals = state.roleSummaries.reduce((acc, role) => {
  acc.totalRequired += role.totalRequired;
  acc.complete += role.complete;
  acc.missing += role.missing;
  acc.failed += role.failed;
  acc.conditions += role.conditions;
  acc.openIssues += role.openIssues;
  return acc;
}, {
  totalRequired: 0,
  complete: 0,
  missing: 0,
  failed: 0,
  conditions: 0,
  openIssues: 0,
});
totals.structuralFailures = state.structuralFailures.length;
totals.completionPct = percentage(totals.complete, totals.totalRequired);

const overallStatus = state.structuralFailures.length > 0 || totals.failed > 0
  ? 'FAIL'
  : totals.missing > 0 || totals.conditions > 0 || totals.openIssues > 0
    ? 'PENDING'
    : 'PASS';

const outputDir = path.join(outRoot, runId);
fs.mkdirSync(outputDir, { recursive: true });

const files = [];
files.push(writeFile('summary.md', summaryMarkdown(overallStatus, totals)));
files.push(writeFile('role-status.csv', roleStatusCsv()));
files.push(writeFile('missing-items.csv', missingItemsCsv()));
files.push(writeFile('issues.csv', issuesCsv()));
files.push(writeFile('manifest.json', `${JSON.stringify({
  generated_at: new Date().toISOString(),
  run_id: runId,
  root: ROOT,
  source_pack: rel(packDir),
  source_manifest: rel(manifestPath),
  status: overallStatus,
  totals,
  safety: {
    calls_apis: false,
    runs_restore_drill: false,
    runs_deploy: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    copies_raw_uat_evidence: false,
  },
  files,
}, null, 2)}\n`));

console.log(`[uat-status] output: ${outputDir}`);
console.log(`[uat-status] status=${overallStatus} completion=${totals.completionPct}% missing=${totals.missing} failed=${totals.failed} conditions=${totals.conditions} open_issues=${totals.openIssues} structural_failures=${totals.structuralFailures}`);
console.log('[uat-status] safety: no APIs, DB writes, deploys, restore drills, imports, migrations, feature flags, or raw evidence copying');

if (overallStatus === 'FAIL') {
  process.exit(1);
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

function latestPackPath() {
  if (!fs.existsSync(DEFAULT_UAT_EVIDENCE_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_UAT_EVIDENCE_ROOT)
    .map((name) => path.join(DEFAULT_UAT_EVIDENCE_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({ path: candidate, mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeFile(name, content) {
  const filePath = path.join(outputDir, name);
  fs.writeFileSync(filePath, content);
  return {
    path: rel(filePath),
    sha256: sha256(content),
  };
}

function addStructuralFailure(message) {
  state.structuralFailures.push(message);
}

function normalizeCell(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return body.split('|').map(normalizeCell);
}

function isSeparator(line) {
  const cells = splitRow(line);
  return Boolean(cells && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function extractSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return null;
  const rest = markdown.slice(start);
  const next = rest.slice(heading.length).search(/\n##\s+/);
  return next === -1 ? rest : rest.slice(0, heading.length + next);
}

function parseTable(markdown, heading, roleSlug) {
  const section = extractSection(markdown, heading);
  if (!section) {
    addStructuralFailure(`${roleSlug} missing section: ${heading}`);
    return null;
  }
  const lines = section.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2 || !isSeparator(lines[1])) {
    addStructuralFailure(`${roleSlug} missing markdown table in section: ${heading}`);
    return null;
  }
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow).filter(Boolean);
  return { header, rows, heading };
}

function requireColumns(table, columns, roleSlug) {
  let passed = true;
  for (const column of columns) {
    if (!table.header.includes(column)) {
      addStructuralFailure(`${roleSlug} ${table.heading} missing column: ${column}`);
      passed = false;
    }
  }
  return passed;
}

function rowToObject(table, row) {
  const object = {};
  table.header.forEach((name, index) => {
    object[name] = row[index] || '';
  });
  return object;
}

function isBlankOrPlaceholder(value) {
  const text = normalizeCell(value);
  if (!text) return true;
  if (text.includes(' / ')) return true;
  if (/^(todo|tbd|pending|n\/a|-)$/i.test(text)) return true;
  return false;
}

function isPass(value) {
  return normalizeCell(value).toUpperCase() === 'PASS';
}

function isFail(value) {
  return normalizeCell(value).toUpperCase() === 'FAIL';
}

function isCondition(value) {
  return normalizeCell(value).toUpperCase() === 'PASS WITH CONDITIONS';
}

function summarizeRole(role) {
  const rolePath = path.join(packDir, `${role.slug}.md`);
  const summary = {
    slug: role.slug,
    title: role.title,
    file: rel(rolePath),
    status: 'PENDING',
    totalRequired: 0,
    complete: 0,
    missing: 0,
    failed: 0,
    conditions: 0,
    openIssues: 0,
    completionPct: 0,
  };

  if (!fs.existsSync(rolePath)) {
    addStructuralFailure(`${role.slug} file missing`);
    addMissing(summary, 'file', role.slug, 'role file', '', 'P0', 'Create or restore the role evidence file.');
    finalizeRole(summary);
    return summary;
  }

  const markdown = fs.readFileSync(rolePath, 'utf8');

  for (const field of ['Tester name:', 'Tester role:', 'Date/time:']) {
    const value = extractListField(markdown, field);
    requireFilled(summary, 'tester-info', field.replace(':', ''), field.replace(':', ''), value, 'P1');
  }

  const routeTable = parseTable(markdown, '## Route Smoke', role.slug);
  if (routeTable && requireColumns(routeTable, ['Route', 'Result', 'Evidence path/link', 'Time', 'Notes'], role.slug)) {
    routeTable.rows.forEach((row, index) => {
      const object = rowToObject(routeTable, row);
      const item = object.Route || `route ${index + 1}`;
      requireResult(summary, 'route-smoke', item, object.Result);
      requireFilled(summary, 'route-smoke', item, 'Evidence path/link', object['Evidence path/link'], 'P1');
      requireFilled(summary, 'route-smoke', item, 'Time', object.Time, 'P2');
    });
  }

  const checkTable = parseTable(markdown, '## Role Checks', role.slug);
  if (checkTable && requireColumns(checkTable, ['#', 'Check', 'Result', 'Evidence path/link', 'Notes'], role.slug)) {
    checkTable.rows.forEach((row, index) => {
      const object = rowToObject(checkTable, row);
      const item = object.Check || `check ${index + 1}`;
      requireResult(summary, 'role-check', item, object.Result);
      requireFilled(summary, 'role-check', item, 'Evidence path/link', object['Evidence path/link'], 'P1');
    });
  }

  const issuesTable = parseTable(markdown, '## Issues', role.slug);
  if (issuesTable && requireColumns(issuesTable, ['Severity', 'Description', 'Owner', 'Status', 'Evidence'], role.slug)) {
    issuesTable.rows.forEach((row) => recordIssue(summary, rowToObject(issuesTable, row)));
  }

  const signoffTable = parseTable(markdown, '## Sign-off', role.slug);
  if (signoffTable && requireColumns(signoffTable, ['Name', 'Result', 'Date/time', 'Signature/approval evidence'], role.slug)) {
    const object = rowToObject(signoffTable, signoffTable.rows[0] || []);
    requireFilled(summary, 'sign-off', 'sign-off', 'Name', object.Name, 'P0');
    requireResult(summary, 'sign-off', 'sign-off', object.Result, 'P0');
    requireFilled(summary, 'sign-off', 'sign-off', 'Date/time', object['Date/time'], 'P0');
    requireFilled(summary, 'sign-off', 'sign-off', 'Signature/approval evidence', object['Signature/approval evidence'], 'P0');
  }

  finalizeRole(summary);
  return summary;
}

function extractListField(markdown, field) {
  const prefix = `- ${field}`;
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function requireFilled(summary, section, item, field, value, priority) {
  summary.totalRequired += 1;
  if (isBlankOrPlaceholder(value)) {
    addMissing(summary, section, item, field, value, priority, `Fill ${field}.`);
    return;
  }
  summary.complete += 1;
}

function requireResult(summary, section, item, value, priority = 'P1') {
  summary.totalRequired += 1;
  const text = normalizeCell(value);
  if (isBlankOrPlaceholder(text)) {
    addMissing(summary, section, item, 'Result', value, priority, 'Set Result to PASS after evidence is reviewed.');
    return;
  }
  if (isPass(text)) {
    summary.complete += 1;
    return;
  }
  if (isCondition(text)) {
    summary.conditions += 1;
    addMissing(summary, section, item, 'Result', value, priority, 'Resolve condition or record a tracked exception before 100%.');
    return;
  }
  if (isFail(text)) {
    summary.failed += 1;
    addMissing(summary, section, item, 'Result', value, 'P0', 'Fix failed UAT item and retest.');
    return;
  }
  summary.failed += 1;
  addMissing(summary, section, item, 'Result', value, 'P0', 'Use PASS only for green UAT; otherwise track as FAIL or condition.');
}

function addMissing(summary, section, item, field, value, priority, action) {
  summary.missing += 1;
  state.missingItems.push({
    role: summary.slug,
    section,
    item: stripMarkdown(item),
    field,
    current_value: normalizeCell(value),
    priority,
    action,
  });
}

function recordIssue(summary, issue) {
  const values = ['Severity', 'Description', 'Owner', 'Status', 'Evidence'].map((column) => normalizeCell(issue[column]));
  if (values.every((value) => isBlankOrPlaceholder(value))) return;

  const status = normalizeCell(issue.Status);
  const open = !/^(closed|resolved|done|pass|accepted)$/i.test(status);
  if (open) summary.openIssues += 1;
  state.issueRows.push({
    role: summary.slug,
    severity: normalizeCell(issue.Severity),
    description: normalizeCell(issue.Description),
    owner: normalizeCell(issue.Owner),
    status: status || 'OPEN',
    evidence: normalizeCell(issue.Evidence),
  });
}

function finalizeRole(summary) {
  summary.completionPct = percentage(summary.complete, summary.totalRequired);
  if (summary.failed > 0 || state.structuralFailures.some((failure) => failure.startsWith(`${summary.slug} `))) {
    summary.status = 'FAIL';
  } else if (summary.missing > 0 || summary.conditions > 0 || summary.openIssues > 0) {
    summary.status = 'PENDING';
  } else {
    summary.status = 'PASS';
  }
}

function percentage(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function stripMarkdown(value) {
  return normalizeCell(value).replace(/`/g, '');
}

function roleRowsMarkdown() {
  return state.roleSummaries.map((role) => `| ${role.title} | ${role.status} | ${role.completionPct}% | ${role.missing} | ${role.failed} | ${role.conditions} | ${role.openIssues} | \`${role.file}\` |`).join('\n');
}

function topMissingMarkdown() {
  if (state.missingItems.length === 0) return '- none';
  const maxRows = 30;
  const rows = state.missingItems.slice(0, maxRows)
    .map((item) => `| ${item.priority} | ${item.role} | ${item.section} | ${escapePipe(item.item)} | ${item.field} | ${escapePipe(item.action)} |`)
    .join('\n');
  const more = state.missingItems.length > maxRows
    ? `\n\nThere are ${state.missingItems.length - maxRows} more rows in \`missing-items.csv\`.`
    : '';
  return `| Priority | Role | Section | Item | Field | Action |
|---|---|---|---|---|---|
${rows}${more}`;
}

function structuralFailuresMarkdown() {
  if (state.structuralFailures.length === 0) return '- none';
  return state.structuralFailures.map((failure) => `- ${failure}`).join('\n');
}

function summaryMarkdown(status, total) {
  return `# UAT Status Report

- Generated: ${new Date().toISOString()}
- Run ID: \`${runId}\`
- Source pack: \`${rel(packDir)}\`
- Source manifest: \`${rel(manifestPath)}\`
- Status: ${status}
- Completion: ${total.completionPct}%
- Missing fields/items: ${total.missing}
- Failed results: ${total.failed}
- Conditional results: ${total.conditions}
- Open issues: ${total.openIssues}
- Structural failures: ${total.structuralFailures}

## Safety

- This report only reads local Markdown evidence files and writes local status files.
- It does not call APIs, write production DB, deploy, run restore drills, run migrations/imports, or change feature flags.
- It does not copy raw screenshots or sensitive evidence. It records paths, statuses, and missing fields only.
- Keep secrets, full CID, LINE user IDs, and unredacted student/parent data out of UAT evidence.

## Role Summary

| Role | Status | Completion | Missing | Failed | Conditions | Open issues | File |
|---|---|---:|---:|---:|---:|---:|---|
${roleRowsMarkdown()}

## Structural Failures

${structuralFailuresMarkdown()}

## Top Missing Items

${topMissingMarkdown()}

## Files

- \`role-status.csv\` - one row per role for UAT lead tracking.
- \`missing-items.csv\` - all missing/failed/conditional items to assign.
- \`issues.csv\` - issues entered in role evidence files.
- \`manifest.json\` - generated report metadata and safety flags.

## Next Commands

\`\`\`bash
node scripts/validate-uat-evidence-pack.js ${rel(packDir)}
node scripts/validate-go-live-signoff.js
node scripts/verify-100-readiness.js
\`\`\`
`;
}

function roleStatusCsv() {
  const columns = ['role', 'title', 'status', 'total_required', 'complete', 'completion_pct', 'missing', 'failed', 'conditions', 'open_issues', 'file'];
  const rows = state.roleSummaries.map((role) => [
    role.slug,
    role.title,
    role.status,
    role.totalRequired,
    role.complete,
    role.completionPct,
    role.missing,
    role.failed,
    role.conditions,
    role.openIssues,
    role.file,
  ]);
  return csv(columns, rows);
}

function missingItemsCsv() {
  const columns = ['role', 'section', 'item', 'field', 'current_value', 'priority', 'action'];
  const rows = state.missingItems.map((item) => columns.map((column) => item[column]));
  return csv(columns, rows);
}

function issuesCsv() {
  const columns = ['role', 'severity', 'description', 'owner', 'status', 'evidence'];
  const rows = state.issueRows.map((issue) => columns.map((column) => issue[column]));
  return csv(columns, rows);
}

function csv(columns, rows) {
  return `${[
    columns.join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapePipe(value) {
  return String(value || '').replace(/\|/g, '\\|');
}
