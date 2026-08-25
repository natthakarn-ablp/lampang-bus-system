#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'signoff-draft');

const roles = [
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

const signoffRoleRows = new Map([
  ['admin', 'Admin'],
  ['province', 'Province'],
  ['affiliation', 'Affiliation'],
  ['school-full', 'School full'],
  ['school-teacher', 'School teacher'],
  ['driver', 'Driver'],
  ['transport', 'Transport'],
  ['parent-line', 'Parent/LINE'],
]);

let targetPath = null;
let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();

function usage() {
  console.error('Usage: node scripts/create-go-live-signoff-draft.js [uat-evidence-dir|manifest.json] [--out-dir <dir>] [--run-id <id>]');
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

const resolvedTarget = targetPath || latestPackPath();
if (!resolvedTarget) {
  console.error('[signoff-draft] ERROR: no UAT evidence pack found');
  process.exit(1);
}

const stat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
if (!stat) {
  console.error(`[signoff-draft] ERROR: target not found: ${resolvedTarget}`);
  process.exit(1);
}

const packDir = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
const manifestPath = stat.isDirectory() ? path.join(resolvedTarget, 'manifest.json') : resolvedTarget;
const structuralFailures = [];

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  structuralFailures.push(`manifest is not valid JSON: ${err.message}`);
}

const roleSummaries = roles.map((role) => summarizeRole(role));
const failRoles = roleSummaries.filter((role) => role.status === 'FAIL').length;
const pendingRoles = roleSummaries.filter((role) => role.status === 'PENDING').length;
const passRoles = roleSummaries.filter((role) => role.status === 'PASS').length;
const status = structuralFailures.length > 0 || failRoles > 0
  ? 'FAIL'
  : pendingRoles > 0
    ? 'PENDING'
    : 'PASS';

const outputDir = path.join(outRoot, runId);
fs.mkdirSync(outputDir, { recursive: true });

const files = [];
files.push(writeFile('summary.md', summaryMarkdown()));
files.push(writeFile('role-transfer.csv', roleTransferCsv()));
files.push(writeFile('UAT_SIGNOFF_DRAFT.md', signoffDraftMarkdown()));
files.push(writeFile('manifest.json', `${JSON.stringify({
  generated_at: new Date().toISOString(),
  run_id: runId,
  root: ROOT,
  source_pack: rel(packDir),
  source_manifest: rel(manifestPath),
  status,
  totals: {
    pass_roles: passRoles,
    pending_roles: pendingRoles,
    fail_roles: failRoles,
    structural_failures: structuralFailures.length,
  },
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

console.log(`[signoff-draft] output: ${outputDir}`);
console.log(`[signoff-draft] summary pass_roles=${passRoles} pending=${pendingRoles} fail=${failRoles} structural_failures=${structuralFailures.length} status=${status}`);
console.log('[signoff-draft] safety: no APIs, DB writes, deploys, restore drills, imports, migrations, feature flags, or raw evidence copying');

if (status === 'FAIL') process.exit(1);

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
    structuralFailures.push(`${roleSlug} missing section: ${heading}`);
    return null;
  }
  const lines = section.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2 || !isSeparator(lines[1])) {
    structuralFailures.push(`${roleSlug} missing markdown table in section: ${heading}`);
    return null;
  }
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow).filter(Boolean);
  return { header, rows, heading };
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

function resultStatus(value) {
  const text = normalizeCell(value).toUpperCase();
  if (isBlankOrPlaceholder(text)) return 'PENDING';
  if (text === 'PASS') return 'PASS';
  if (text === 'PASS WITH CONDITIONS') return 'PENDING';
  return 'FAIL';
}

function summarizeRole(role) {
  const filePath = path.join(packDir, `${role.slug}.md`);
  const summary = {
    slug: role.slug,
    title: role.title,
    file: rel(filePath),
    routeTotal: 0,
    routePass: 0,
    routePending: 0,
    routeFail: 0,
    checkTotal: 0,
    checkPass: 0,
    checkPending: 0,
    checkFail: 0,
    signoffResult: '',
    signoffName: '',
    signoffDate: '',
    signoffEvidence: '',
    missingRequired: 0,
    status: 'PENDING',
  };

  if (!fs.existsSync(filePath)) {
    structuralFailures.push(`${role.slug} evidence file missing`);
    summary.status = 'FAIL';
    return summary;
  }

  const markdown = fs.readFileSync(filePath, 'utf8');
  for (const field of ['Tester name:', 'Tester role:', 'Date/time:']) {
    const value = extractListField(markdown, field);
    if (isBlankOrPlaceholder(value)) summary.missingRequired += 1;
  }

  summarizeResultTable(summary, markdown, '## Route Smoke', 'Result', 'Evidence path/link', 'route');
  summarizeResultTable(summary, markdown, '## Role Checks', 'Result', 'Evidence path/link', 'check');

  const signoffTable = parseTable(markdown, '## Sign-off', role.slug);
  if (signoffTable) {
    const object = rowToObject(signoffTable, signoffTable.rows[0] || []);
    summary.signoffName = object.Name || '';
    summary.signoffResult = object.Result || '';
    summary.signoffDate = object['Date/time'] || '';
    summary.signoffEvidence = object['Signature/approval evidence'] || '';
    for (const value of [summary.signoffName, summary.signoffResult, summary.signoffDate, summary.signoffEvidence]) {
      if (isBlankOrPlaceholder(value)) summary.missingRequired += 1;
    }
  }

  const failures = summary.routeFail + summary.checkFail + (resultStatus(summary.signoffResult) === 'FAIL' ? 1 : 0);
  const pending = summary.routePending + summary.checkPending + summary.missingRequired + (resultStatus(summary.signoffResult) === 'PENDING' ? 1 : 0);
  summary.status = failures > 0 ? 'FAIL' : pending > 0 ? 'PENDING' : 'PASS';
  return summary;
}

function extractListField(markdown, field) {
  const prefix = `- ${field}`;
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function summarizeResultTable(summary, markdown, heading, resultColumn, evidenceColumn, bucket) {
  const table = parseTable(markdown, heading, summary.slug);
  if (!table) return;
  for (const row of table.rows) {
    const object = rowToObject(table, row);
    const status = resultStatus(object[resultColumn]);
    const evidenceMissing = isBlankOrPlaceholder(object[evidenceColumn]);
    summary[`${bucket}Total`] += 1;
    if (status === 'PASS' && !evidenceMissing) {
      summary[`${bucket}Pass`] += 1;
    } else if (status === 'FAIL') {
      summary[`${bucket}Fail`] += 1;
    } else {
      summary[`${bucket}Pending`] += 1;
    }
    if (evidenceMissing) summary.missingRequired += 1;
  }
}

function summaryMarkdown() {
  const structural = structuralFailures.length === 0
    ? '- none'
    : structuralFailures.map((failure) => `- ${failure}`).join('\n');
  return `# Go-live Sign-off Draft

- Generated: ${new Date().toISOString()}
- Run ID: \`${runId}\`
- Source pack: \`${rel(packDir)}\`
- Source manifest: \`${rel(manifestPath)}\`
- Status: ${status}
- Role PASS: ${passRoles}
- Role PENDING: ${pendingRoles}
- Role FAIL: ${failRoles}
- Structural failures: ${structuralFailures.length}

## Safety

- This generator only reads local UAT evidence and writes local draft files.
- It does not call APIs, write production DB, deploy, run restore drills, run migrations/imports, or change feature flags.
- It does not copy raw screenshots or sensitive evidence into the draft. It references role evidence files and sign-off evidence paths only.
- Do not paste this draft into the official sign-off until the UAT lead has reviewed the source evidence and safety scan.

## Role Summary

| Role | Status | Route pass/total | Role-check pass/total | Missing required | Source |
|---|---|---:|---:|---:|---|
${roleSummaries.map((role) => `| ${role.title} | ${role.status} | ${role.routePass}/${role.routeTotal} | ${role.checkPass}/${role.checkTotal} | ${role.missingRequired} | \`${role.file}\` |`).join('\n')}

## Structural Failures

${structural}

## Files

- \`UAT_SIGNOFF_DRAFT.md\` - human-reviewed draft rows for \`docs/UAT_SIGNOFF_2026-08.md\`.
- \`role-transfer.csv\` - spreadsheet-friendly transfer map for role rows.
- \`manifest.json\` - draft metadata and safety flags.
`;
}

function roleTransferRows() {
  return roleSummaries
    .filter((role) => signoffRoleRows.has(role.slug))
    .map((role) => ({
      destination_section: '## 2. Role Checks',
      destination_key: signoffRoleRows.get(role.slug),
      suggested_result: role.status === 'PASS' ? 'PASS' : '',
      suggested_evidence: role.status === 'PASS'
        ? `${role.file}; sign-off evidence: ${normalizeCell(role.signoffEvidence)}`
        : role.file,
      source_status: role.status,
      source_file: role.file,
      note: role.status === 'PASS'
        ? 'Ready for UAT lead review before transfer.'
        : 'Do not transfer PASS yet; complete role evidence first.',
    }));
}

function roleTransferCsv() {
  const columns = ['destination_section', 'destination_key', 'suggested_result', 'suggested_evidence', 'source_status', 'source_file', 'note'];
  const rows = roleTransferRows().map((row) => columns.map((column) => row[column]));
  return `${[
    columns.join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n')}\n`;
}

function signoffDraftMarkdown() {
  const transferRows = roleTransferRows();
  return `# UAT Sign-off Draft

- Generated: ${new Date().toISOString()}
- Source pack: \`${rel(packDir)}\`
- Status: ${status}

This draft is not the official sign-off. Review source evidence, run the UAT safety scan, and then transfer approved rows into \`docs/UAT_SIGNOFF_2026-08.md\`.

## Role Checks Draft Rows

| Role | Suggested result | Suggested evidence | Source status | Source file | Note |
|---|---|---|---|---|---|
${transferRows.map((row) => `| ${row.destination_key} | ${row.suggested_result} | ${escapePipe(row.suggested_evidence)} | ${row.source_status} | \`${row.source_file}\` | ${row.note} |`).join('\n')}

## Manual Sections Still Required

- \`## 1. Common Checks\` must be filled by the UAT lead after reviewing role evidence.
- \`## 3. Report/Export Checks\` must be filled from report-specific UAT evidence.
- \`## 4. LINE Checks\` must be filled from LINE OA/LIFF test evidence.
- \`## 5. Ops Checks\` must be filled from operator gate, backup, restore drill, deploy, and monitor evidence.
- \`## 6. Sign-off\` must be signed by the named representatives.

## Final Commands

\`\`\`bash
node scripts/scan-uat-evidence-safety.js ${rel(packDir)}
node scripts/summarize-uat-evidence.js ${rel(packDir)}
node scripts/validate-uat-evidence-pack.js ${rel(packDir)}
node scripts/validate-go-live-signoff.js
\`\`\`
`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapePipe(value) {
  return String(value || '').replace(/\|/g, '\\|');
}
