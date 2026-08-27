#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const defaultUatPath = path.join(ROOT, 'docs', 'UAT_SIGNOFF_2026-08.md');
const defaultApprovalPath = path.join(ROOT, 'docs', 'PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');

const args = process.argv.slice(2);
let allowPending = false;
let uatPath = defaultUatPath;
let approvalPath = defaultApprovalPath;

function usage() {
  console.error('Usage: node scripts/validate-go-live-signoff.js [--allow-pending] [--uat <path>] [--approval <path>]');
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--allow-pending') {
    allowPending = true;
  } else if (arg === '--uat' && args[i + 1]) {
    uatPath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--approval' && args[i + 1]) {
    approvalPath = path.resolve(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const state = { ok: 0, pending: 0, fail: 0 };

function ok(message) {
  state.ok += 1;
  console.log(`[go-live-signoff] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[go-live-signoff] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[go-live-signoff] FAIL: ${message}`);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`file not found: ${filePath}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
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

function parseTable(markdown, heading) {
  const section = extractSection(markdown, heading);
  if (!section) {
    fail(`missing section: ${heading}`);
    return null;
  }
  const lines = section.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2 || !isSeparator(lines[1])) {
    fail(`missing markdown table in section: ${heading}`);
    return null;
  }
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow).filter(Boolean);
  ok(`table found: ${heading}`);
  return { header, rows, heading };
}

function requireColumns(table, columns) {
  let passed = true;
  for (const column of columns) {
    if (!table.header.includes(column)) {
      fail(`${table.heading} missing column: ${column}`);
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

function indexRows(table, keyColumn) {
  const map = new Map();
  for (const row of table.rows) {
    const object = rowToObject(table, row);
    const key = normalizeCell(object[keyColumn]);
    if (key) map.set(key, object);
  }
  return map;
}

function isBlankOrPlaceholder(value) {
  const text = normalizeCell(value);
  if (!text) return true;
  if (text.includes(' / ')) return true;
  if (/^(todo|tbd|pending|n\/a|-|—)$/i.test(text)) return true;
  return false;
}

function requirePass(sectionName, key, value, label) {
  const text = normalizeCell(value).toUpperCase();
  if (isBlankOrPlaceholder(value)) {
    pending(`${sectionName} ${key} ${label} missing`);
    return;
  }
  if (text !== 'PASS') {
    fail(`${sectionName} ${key} ${label} must be PASS, found: ${value}`);
    return;
  }
  ok(`${sectionName} ${key} ${label}=PASS`);
}

function requireApproved(sectionName, key, value) {
  const text = normalizeCell(value).toUpperCase();
  if (isBlankOrPlaceholder(value)) {
    pending(`${sectionName} ${key} approval missing`);
    return;
  }
  if (!['APPROVED', 'PASS', 'อนุมัติ'].includes(text)) {
    fail(`${sectionName} ${key} approval must be APPROVED/PASS/อนุมัติ, found: ${value}`);
    return;
  }
  ok(`${sectionName} ${key} approved`);
}

function requireFilled(sectionName, key, value, label) {
  if (isBlankOrPlaceholder(value)) {
    pending(`${sectionName} ${key} ${label} missing`);
    return;
  }
  ok(`${sectionName} ${key} ${label} filled`);
}

function validateChecklistTable(markdown, config) {
  const table = parseTable(markdown, config.heading);
  if (!table) return;
  if (!requireColumns(table, [config.keyColumn, config.resultColumn, config.evidenceColumn])) return;

  const rows = indexRows(table, config.keyColumn);
  for (const key of config.required) {
    const row = rows.get(key);
    if (!row) {
      fail(`${config.name} missing row: ${key}`);
      continue;
    }
    requirePass(config.name, key, row[config.resultColumn], 'result');
    requireFilled(config.name, key, row[config.evidenceColumn], 'evidence');
  }
}

function validateSignoffTable(markdown, config) {
  const table = parseTable(markdown, config.heading);
  if (!table) return;
  if (!requireColumns(table, [config.roleColumn, config.resultColumn, config.dateColumn, config.signatureColumn, config.nameColumn])) return;

  const rows = indexRows(table, config.roleColumn);
  for (const role of config.required) {
    const row = rows.get(role);
    if (!row) {
      fail(`${config.name} missing sign-off role: ${role}`);
      continue;
    }
    requireFilled(config.name, role, row[config.nameColumn], 'name');
    requirePass(config.name, role, row[config.resultColumn], 'result');
    requireFilled(config.name, role, row[config.dateColumn], 'date');
    requireFilled(config.name, role, row[config.signatureColumn], 'signature');
  }
}

function validateApprovalScope(markdown) {
  const table = parseTable(markdown, '## สิ่งที่ขออนุมัติ');
  if (!table) return;
  if (!requireColumns(table, ['Scope', 'อนุมัติ', 'หมายเหตุ'])) return;

  const required = [
    'Run production read-only gate on server',
    'Create/use restore drill DB `lampang_bus_restore_drill`',
    'Run restore drill from latest backup into drill DB',
    'Deploy approved commit/worktree',
    'Run postdeploy gate and 30-60 minute monitor',
  ];
  const rows = indexRows(table, 'Scope');
  for (const scope of required) {
    const row = rows.get(scope);
    if (!row) {
      fail(`approval scope missing row: ${scope}`);
      continue;
    }
    requireApproved('Approval scope', scope, row['อนุมัติ']);
  }
}

const uatMarkdown = readFile(uatPath);
const approvalMarkdown = readFile(approvalPath);

if (uatMarkdown) {
  validateChecklistTable(uatMarkdown, {
    name: 'Common checks',
    heading: '## 1. Common Checks',
    keyColumn: 'ID',
    resultColumn: 'ผล',
    evidenceColumn: 'Evidence',
    required: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'],
  });
  validateChecklistTable(uatMarkdown, {
    name: 'Role checks',
    heading: '## 2. Role Checks',
    keyColumn: 'Role',
    resultColumn: 'ผล',
    evidenceColumn: 'Evidence',
    required: ['Admin', 'Province', 'Affiliation', 'School full', 'School teacher', 'Driver', 'Transport', 'Parent/LINE'],
  });
  validateChecklistTable(uatMarkdown, {
    name: 'Report checks',
    heading: '## 3. Report/Export Checks',
    keyColumn: 'ID',
    resultColumn: 'ผล',
    evidenceColumn: 'Evidence',
    required: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
  });
  validateChecklistTable(uatMarkdown, {
    name: 'LINE checks',
    heading: '## 4. LINE Checks',
    keyColumn: 'ID',
    resultColumn: 'ผล',
    evidenceColumn: 'Evidence',
    required: ['L1', 'L2', 'L3', 'L4', 'L5'],
  });
  validateChecklistTable(uatMarkdown, {
    name: 'Ops checks',
    heading: '## 5. Ops Checks',
    keyColumn: 'ID',
    resultColumn: 'ผล',
    evidenceColumn: 'Evidence',
    required: ['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8'],
  });
  validateSignoffTable(uatMarkdown, {
    name: 'UAT sign-off',
    heading: '## 6. Sign-off',
    nameColumn: 'ผู้รับผิดชอบ',
    roleColumn: 'บทบาท',
    resultColumn: 'ผลรวม',
    dateColumn: 'วันที่',
    signatureColumn: 'ลายเซ็น',
    required: ['Project owner', 'Technical owner', 'Operator', 'Province representative', 'School representative', 'Driver representative', 'Parent representative'],
  });
}

if (approvalMarkdown) {
  validateApprovalScope(approvalMarkdown);
  validateSignoffTable(approvalMarkdown, {
    name: 'Owner/operator approval',
    heading: '## Sign-off',
    nameColumn: 'ผู้อนุมัติ',
    roleColumn: 'บทบาท',
    resultColumn: 'ผล',
    dateColumn: 'วันที่/เวลา',
    signatureColumn: 'ลายเซ็น',
    required: ['Owner', 'Technical owner', 'Operator', 'DPO/Legal'],
  });
}

console.log(`[go-live-signoff] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);

if (state.fail > 0) {
  process.exit(1);
}
if (state.pending > 0 && !allowPending) {
  process.exit(1);
}
console.log(allowPending && state.pending > 0 ? '[go-live-signoff] PASS (pending allowed)' : '[go-live-signoff] PASS');
