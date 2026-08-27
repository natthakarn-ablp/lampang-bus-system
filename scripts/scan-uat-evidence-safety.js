#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'uat-safety');

const TEXT_EXTENSIONS = new Set(['.csv', '.json', '.log', '.md', '.txt']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const REQUIRED_MANIFEST_FLAGS = [
  'calls_apis',
  'runs_restore_drill',
  'runs_deploy',
  'runs_migrations',
  'runs_imports',
  'runs_feature_flags',
  'writes_production_db',
];

const lineRules = [
  {
    id: 'secret-assignment',
    severity: 'FAIL',
    description: 'Secret-like environment variable assignment found',
    action: 'Remove the value. Keep only the variable name or a redacted placeholder.',
    regex: /\b(?:DB_PASSWORD|MYSQL_PWD|JWT_SECRET|SECRET_KEY|LINE_CHANNEL_SECRET|CHANNEL_ACCESS_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN|PASSWORD|TOKEN)\b\s*[:=]\s*["']?(?!\s*(?:$|<|\[|TODO|TBD|PENDING|REDACTED|redacted|xxx|example|test-only))\S{6,}/i,
  },
  {
    id: 'bearer-token',
    severity: 'FAIL',
    description: 'Bearer token value found',
    action: 'Remove the token and re-capture evidence with only redacted auth state.',
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/,
  },
  {
    id: 'jwt-token',
    severity: 'FAIL',
    description: 'JWT-like token value found',
    action: 'Remove the token and rotate it if it came from a real environment.',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'line-user-id',
    severity: 'FAIL',
    description: 'Raw LINE user ID found',
    action: 'Replace with a redacted placeholder such as LINE_USER_REDACTED.',
    regex: /\bU[0-9a-f]{32}\b/i,
  },
  {
    id: 'email-address',
    severity: 'WARN',
    description: 'Email address found in UAT evidence',
    action: 'Confirm it is a test account or redact it before final sign-off.',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
];

let targetPath = null;
let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();
let writeReport = true;

function usage() {
  console.error('Usage: node scripts/scan-uat-evidence-safety.js [uat-evidence-dir|manifest.json] [--out-dir <dir>] [--run-id <id>] [--no-report]');
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
  } else if (arg === '--no-report') {
    writeReport = false;
  } else if (!targetPath) {
    targetPath = path.resolve(arg);
  } else {
    usage();
    process.exit(2);
  }
}

const resolvedTarget = targetPath || latestPackPath();
if (!resolvedTarget) {
  console.error('[uat-safety] ERROR: no UAT evidence pack found');
  process.exit(1);
}

const stat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
if (!stat) {
  console.error(`[uat-safety] ERROR: target not found: ${resolvedTarget}`);
  process.exit(1);
}

const packDir = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
const manifestPath = stat.isDirectory() ? path.join(resolvedTarget, 'manifest.json') : resolvedTarget;

const findings = [];
const files = walk(packDir).filter((filePath) => fs.statSync(filePath).isFile());
let textFilesScanned = 0;
let binaryFilesSeen = 0;
let largeFilesSkipped = 0;

checkManifest();

for (const filePath of files) {
  scanPath(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileSize = fs.statSync(filePath).size;
  if (!TEXT_EXTENSIONS.has(ext)) {
    binaryFilesSeen += 1;
    continue;
  }
  if (fileSize > MAX_TEXT_BYTES) {
    largeFilesSkipped += 1;
    addFinding({
      severity: 'WARN',
      rule: 'large-text-file',
      file: rel(filePath),
      line: 0,
      description: 'Large text evidence file was not scanned',
      action: 'Review and redact manually before final sign-off.',
      preview: '',
    });
    continue;
  }
  textFilesScanned += 1;
  scanTextFile(filePath);
}

const failCount = findings.filter((finding) => finding.severity === 'FAIL').length;
const warnCount = findings.filter((finding) => finding.severity === 'WARN').length;
const status = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'PENDING' : 'PASS';
const totals = {
  files_total: files.length,
  text_files_scanned: textFilesScanned,
  binary_files_seen: binaryFilesSeen,
  large_files_skipped: largeFilesSkipped,
  fail: failCount,
  warn: warnCount,
  manual_review: binaryFilesSeen,
};

let outputDir = null;
let reportFiles = [];
if (writeReport) {
  outputDir = path.join(outRoot, runId);
  fs.mkdirSync(outputDir, { recursive: true });
  reportFiles = [
    writeFile('summary.md', summaryMarkdown(status, totals)),
    writeFile('findings.csv', findingsCsv()),
  ];
  reportFiles.push(writeFile('manifest.json', `${JSON.stringify({
      generated_at: new Date().toISOString(),
      run_id: runId,
      root: ROOT,
      source_pack: rel(packDir),
      source_manifest: rel(manifestPath),
      status,
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
        copies_detected_values: false,
      },
      files: reportFiles,
    }, null, 2)}\n`),
  );
}

if (outputDir) console.log(`[uat-safety] output: ${outputDir}`);
console.log(`[uat-safety] summary scanned=${textFilesScanned} fail=${failCount} warn=${warnCount} manual_review=${binaryFilesSeen} status=${status}`);
console.log('[uat-safety] safety: no APIs, DB writes, deploys, restore drills, imports, migrations, feature flags, raw evidence copying, or detected-value copying');

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

function relPack(filePath) {
  return path.relative(packDir, filePath).replace(/\\/g, '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
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

function checkManifest() {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    addFinding({
      severity: 'FAIL',
      rule: 'manifest-json',
      file: rel(manifestPath),
      line: 0,
      description: 'UAT evidence manifest is not valid JSON',
      action: 'Regenerate the UAT evidence pack or fix the manifest before sign-off.',
      preview: '',
    });
    return;
  }

  const safety = manifest.safety || {};
  const unsafe = REQUIRED_MANIFEST_FLAGS.filter((flag) => safety[flag] !== false);
  for (const flag of unsafe) {
    addFinding({
      severity: 'FAIL',
      rule: 'unsafe-manifest-flag',
      file: rel(manifestPath),
      line: 0,
      description: `Manifest safety flag is not false: ${flag}`,
      action: 'Regenerate the UAT evidence pack with a non-mutating generator.',
      preview: '',
    });
  }
}

function scanPath(filePath) {
  const relative = relPack(filePath);
  if (hasThaiCid(relative)) {
    addFinding({
      severity: 'FAIL',
      rule: 'cid-in-path',
      file: rel(filePath),
      line: 0,
      description: 'Thai national ID-like value found in evidence file path',
      action: 'Rename the file with a redacted or synthetic identifier.',
      preview: '',
    });
  }
  if (hasThaiPhone(relative)) {
    addFinding({
      severity: 'FAIL',
      rule: 'phone-in-path',
      file: rel(filePath),
      line: 0,
      description: 'Thai phone-like value found in evidence file path',
      action: 'Rename the file with a redacted or synthetic identifier.',
      preview: '',
    });
  }
}

function scanTextFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    scanLineRules(filePath, line, index + 1);
    if (isChecksumMetadata(line)) return;
    if (hasThaiCid(line)) {
      addFinding({
        severity: 'FAIL',
        rule: 'full-thai-cid',
        file: rel(filePath),
        line: index + 1,
        description: 'Thai national ID-like value found',
        action: 'Redact the CID or replace it with a synthetic test identifier.',
        preview: redactLine(line),
      });
    }
    if (hasThaiPhone(line)) {
      addFinding({
        severity: 'FAIL',
        rule: 'thai-phone',
        file: rel(filePath),
        line: index + 1,
        description: 'Thai phone-like value found',
        action: 'Redact the phone number unless it is a clearly synthetic placeholder.',
        preview: redactLine(line),
      });
    }
  });
}

function isChecksumMetadata(line) {
  return /["']?sha256["']?\s*[:=]/i.test(line)
    || /^\s*[a-f0-9]{64}\s+/.test(String(line || ''));
}

function scanLineRules(filePath, line, lineNumber) {
  for (const rule of lineRules) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    if (!regex.test(line)) continue;
    addFinding({
      severity: rule.severity,
      rule: rule.id,
      file: rel(filePath),
      line: lineNumber,
      description: rule.description,
      action: rule.action,
      preview: redactLine(line),
    });
  }
}

function hasThaiCid(value) {
  const matches = String(value || '').match(/(?<!\d)(?:\d[\s-]?){12}\d(?![\s-]?\d)/g) || [];
  return matches.some((match) => digitsOnly(match).length === 13);
}

function hasThaiPhone(value) {
  const matches = String(value || '').match(/(?<!\d)0[689](?:[\s-]?\d){8}(?![\s-]?\d)/g) || [];
  return matches.some((match) => digitsOnly(match).length === 10);
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function addFinding(finding) {
  findings.push(finding);
}

function redactLine(line) {
  const redacted = String(line || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/g, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/\bU[0-9a-f]{32}\b/gi, '[redacted-line-user-id]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/(?<!\d)(?:\d[\s-]?){12}\d(?![\s-]?\d)/g, '[redacted-cid]')
    .replace(/(?<!\d)0[689](?:[\s-]?\d){8}(?![\s-]?\d)/g, '[redacted-phone]');
  return redacted.slice(0, 180);
}

function summaryMarkdown(statusValue, totalsValue) {
  const findingRows = findings.length > 0
    ? findings.map((finding) => `| ${finding.severity} | ${finding.rule} | \`${finding.file}\` | ${finding.line || ''} | ${escapePipe(finding.description)} | ${escapePipe(finding.action)} | ${escapePipe(finding.preview)} |`).join('\n')
    : '| PASS | none | | | No text safety findings | | |';

  return `# UAT Evidence Safety Scan

- Generated: ${new Date().toISOString()}
- Run ID: \`${runId}\`
- Source pack: \`${rel(packDir)}\`
- Source manifest: \`${rel(manifestPath)}\`
- Status: ${statusValue}
- Text files scanned: ${totalsValue.text_files_scanned}
- Non-text files needing manual redaction review: ${totalsValue.manual_review}
- Fail findings: ${totalsValue.fail}
- Warning findings: ${totalsValue.warn}

## Safety

- This scanner only reads local UAT evidence and writes local reports.
- It does not call APIs, write production DB, deploy, run restore drills, run migrations/imports, or change feature flags.
- It does not copy detected sensitive values into reports. Previews are redacted.
- It cannot OCR screenshots or PDFs; non-text evidence still needs manual redaction review before final sign-off.

## Findings

| Severity | Rule | File | Line | Description | Action | Redacted preview |
|---|---|---|---:|---|---|---|
${findingRows}

## Final Rule

The final UAT pack should have zero FAIL findings. Any WARN finding must be accepted by the UAT lead/DPO or redacted before \`node scripts/verify-100-readiness.js\` can be treated as final evidence.
`;
}

function findingsCsv() {
  const columns = ['severity', 'rule', 'file', 'line', 'description', 'action', 'redacted_preview'];
  const rows = findings.map((finding) => [
    finding.severity,
    finding.rule,
    finding.file,
    finding.line || '',
    finding.description,
    finding.action,
    finding.preview,
  ]);
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
