#!/usr/bin/env node
/**
 * page-status.mjs — per-page migration status, derived from source.
 *
 * A page is only "Complete" if, for every pattern it actually CONTAINS, it uses
 * the shared primitive for that pattern. A page with no table is not penalised
 * for not using DataTable — it is marked N/A for that pattern.
 *
 * Patterns detected:
 *   table       <table> in the file            -> needs DataTable
 *   filter      a search/filter control        -> needs FilterBar
 *   form        a labelled input/select/textarea -> needs FormField
 *   destructive window.confirm or a delete call -> needs ConfirmDialog
 *   modal       a fixed-inset overlay          -> needs Modal / ConfirmDialog / ResponsiveDrawer
 *   header      a page-level <h1>              -> needs PageHeader
 *   states      a data fetch                   -> needs Loading + Empty/Error states
 *
 * Usage:
 *   node scripts/ui-redesign/page-status.mjs           # table
 *   node scripts/ui-redesign/page-status.mjs --md      # markdown
 *   node scripts/ui-redesign/page-status.mjs --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const SRC = resolve(root, 'frontend/src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.jsx')) out.push(p);
  }
  return out;
}

// Files that are components consumed by pages, not routed pages themselves,
// but which own a page's whole body — treated as pages for status purposes.
const PAGE_LIKE = new Set(['AuditLogTable.jsx', 'VehicleRosterCard.jsx']);

const PATTERNS = [
  {
    key: 'header',
    has: s => /<h1[\s>]/.test(s),
    uses: s => /PageHeader/.test(s),
  },
  {
    key: 'table',
    has: s => /<table[\s>]/.test(s),
    uses: s => /DataTable/.test(s),
  },
  {
    key: 'filter',
    // a search box or a filter select that drives the list
    has: s => /placeholder="[^"]*ค้นหา/.test(s) || /(setFilter|filterRole|statusFilter|affFilter|schoolFilter|setSearch)\b/.test(s),
    uses: s => /FilterBar/.test(s),
  },
  {
    key: 'form',
    has: s => /<(input|textarea)[\s\n]/.test(s) || /<select[\s\n]/.test(s),
    uses: s => /FormField|FilterBar/.test(s),
  },
  {
    key: 'destructive',
    has: s => /window\.confirm|api\.delete\(/.test(s),
    uses: s => /ConfirmDialog/.test(s),
  },
  {
    key: 'modal',
    has: s => /fixed inset-0/.test(s),
    uses: s => /\b(Modal|ConfirmDialog|ResponsiveDrawer)\b/.test(s),
  },
  {
    key: 'states',
    // Only a page that READS data needs page-level loading / empty / error
    // states. A page that only POSTs (a check-in button, an incident form)
    // shows its progress on the submit button, and a full-page spinner there
    // would be wrong.
    has: s => /api\.get\(/.test(s),
    uses: s => /(LoadingState|Skeleton|DataTable)/.test(s) && /(EmptyState|ErrorState|DataTable|AlertBanner)/.test(s),
  },
];

/**
 * Documented exemptions: `file -> { pattern: reason }`.
 *
 * An exemption is only legitimate when the pattern genuinely does not apply to
 * that page — not when the work was skipped. Each one states why, so the claim
 * is checkable rather than taken on trust.
 */
const EXEMPT = {
  'pages/school/SchoolAuditLog.jsx': {
    header: 'the <h1> is the permission-denied state for grade-teacher accounts, not a page header; the real page header is PageHeader inside AuditLogTable',
  },
  'pages/parent/ParentStatus.jsx': {
    header: 'LIFF webview page with no app shell — its <h1>s are the not-linked and no-children states plus the LINE-style app bar; PageHeader is a shell header and does not apply',
  },
  'pages/qr/VehicleQr.jsx': {
    header: 'public QR scan page, rendered standalone outside the shell for unauthenticated scanners',
  },
  'pages/admin/ExecutiveSummary.jsx': {
    header: 'branded print-oriented header band, matching the reports pages; it IS the page header, just not the shell variant',
  },
  'pages/admin/MeasurementFramework.jsx': {
    header: 'branded print-oriented header band, matching the reports pages',
  },
  // The four report pages open on a navy branded band that already carries the
  // report name, the system name and the reporting period — everything
  // PageHeader would provide, in the form the printed report uses. Swapping it
  // for the shell header would make the screen and the print output disagree.
  'pages/reports/DailyReport.jsx':   { header: 'branded report band carrying title + period; matches the printed output' },
  'pages/reports/MonthlyReport.jsx': { header: 'branded report band carrying title + period; matches the printed output' },
  'pages/reports/SummaryReport.jsx': { header: 'branded report band carrying title + period; matches the printed output' },
  'pages/reports/PolicyReport.jsx':  { header: 'branded report band carrying title + period; matches the printed output' },
  'pages/Login.jsx': {
    header: 'production-approved login page (commit d9485ec); deliberately branded and outside the shell',
    form: 'the login form is the page; its fields carry autocomplete and wired labels already, verified in the baseline audit',
    modal: 'the contact-admin panel is inline on the page, not a dialog',
  },
  'pages/ChangePassword.jsx': {
    header: 'rendered outside the shell, before a session is fully established',
  },
};

const rows = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const base = rel.split('/').pop();
  const isPage = rel.startsWith('pages/') || PAGE_LIKE.has(base);
  if (!isPage) continue;
  // Layout shells route to children; they carry no data patterns of their own.
  if (/Layout\.jsx$/.test(base)) continue;

  const src = readFileSync(file, 'utf8');
  const exempt = EXEMPT[rel] || {};
  const detail = {};
  const reasons = {};
  let applicable = 0, satisfied = 0;
  for (const p of PATTERNS) {
    if (!p.has(src)) { detail[p.key] = 'n/a'; continue; }
    if (exempt[p.key]) { detail[p.key] = 'exempt'; reasons[p.key] = exempt[p.key]; continue; }
    applicable++;
    const ok = p.uses(src);
    if (ok) satisfied++;
    detail[p.key] = ok ? 'ok' : 'todo';
  }
  const anyExempt = Object.keys(reasons).length > 0;
  const status = applicable === 0 ? (anyExempt ? 'N/A (reasoned)' : 'N/A')
               : satisfied === applicable ? 'Complete'
               : 'Partial';
  rows.push({ file: rel, status, applicable, satisfied, detail, reasons });
}

rows.sort((a, b) => a.file.localeCompare(b.file));

const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, rows }, null, 2));
} else if (process.argv.includes('--md')) {
  console.log('| page | status | gaps |');
  console.log('|---|---|---|');
  for (const r of rows) {
    const gaps = Object.entries(r.detail).filter(([, v]) => v === 'todo').map(([k]) => k).join(', ');
    console.log(`| \`${r.file}\` | ${r.status} | ${gaps || '—'} |`);
  }
  console.log(`\nComplete ${counts.Complete || 0} · Partial ${counts.Partial || 0} · N/A ${counts['N/A'] || 0}`);
} else {
  for (const r of rows) {
    const gaps = Object.entries(r.detail).filter(([, v]) => v === 'todo').map(([k]) => k).join(',');
    const mark = r.status === 'Complete' ? 'OK ' : r.status === 'N/A' ? '-- ' : '>> ';
    console.log(`${mark}${r.file.padEnd(48)} ${r.status.padEnd(9)} ${gaps}`);
  }
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ·  '));
}

// Exit non-zero while anything is still Partial, so this can gate the goal.
process.exit((counts.Partial || 0) === 0 ? 0 : 1);
