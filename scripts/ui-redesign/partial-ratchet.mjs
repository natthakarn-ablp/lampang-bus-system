import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PARTIAL_BASELINE = resolve(here, 'baselines/page-status-baseline.json');

export function evaluatePartialRatchet(status, { log = console.log } = {}) {
  const failures = [];
  const removable = [];
  let baseline;

  try {
    baseline = JSON.parse(readFileSync(PARTIAL_BASELINE, 'utf8'));
  } catch (error) {
    return { ok: false, failures: [`partial baseline unreadable: ${error.code || error.message}`], removable };
  }

  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.acceptedPartial)) {
    return { ok: false, failures: ['partial baseline schema is invalid'], removable };
  }

  const baselineByFile = new Map();
  for (const entry of baseline.acceptedPartial) {
    const patterns = Array.isArray(entry.patterns) ? entry.patterns : [];
    if (!entry.file || !patterns.length || !String(entry.reason || '').trim()) {
      failures.push(`invalid baseline entry: ${entry.file || '(missing file)'}`);
      continue;
    }
    if (baselineByFile.has(entry.file)) {
      failures.push(`duplicate baseline entry: ${entry.file}`);
      continue;
    }
    baselineByFile.set(entry.file, new Set(patterns));
  }

  const rowsByFile = new Map(status.rows.map((row) => [row.file, row]));
  const currentPartial = status.rows.filter((row) => row.status === 'Partial');

  for (const row of currentPartial) {
    const currentGaps = Object.entries(row.detail)
      .filter(([, value]) => value === 'todo')
      .map(([pattern]) => pattern);
    const accepted = baselineByFile.get(row.file);
    if (!accepted) {
      failures.push(`new Partial page outside baseline: ${row.file} (${currentGaps.join(', ')})`);
      continue;
    }
    const newPatterns = currentGaps.filter((pattern) => !accepted.has(pattern));
    if (newPatterns.length) {
      failures.push(`baseline page gained gap(s): ${row.file} (${newPatterns.join(', ')})`);
    }
    const fixedPatterns = [...accepted].filter((pattern) => !currentGaps.includes(pattern));
    if (fixedPatterns.length) removable.push(`${row.file}: ${fixedPatterns.join(', ')}`);
  }

  for (const [file, patterns] of baselineByFile) {
    const row = rowsByFile.get(file);
    if (!row) {
      failures.push(`baseline page is missing from page inventory: ${file}`);
    } else if (row.status !== 'Partial') {
      removable.push(`${file}: whole entry (${[...patterns].join(', ')})`);
    }
  }

  for (const file of status.nativeDialogs || []) {
    failures.push(`native confirm/prompt is forbidden: ${file}`);
  }

  log(`\nUI Partial ratchet: ${currentPartial.length} current / ${baselineByFile.size} accepted baseline`);
  if (removable.length) {
    log('Baseline entries/patterns now removable:');
    removable.forEach((item) => log(`  - ${item}`));
  }
  if (failures.length) {
    log('Ratchet failures:');
    failures.forEach((failure) => log(`  - ${failure}`));
  } else {
    log('PASS — no new Partial page, no added baseline gap, and no native confirm/prompt');
  }

  return { ok: failures.length === 0, failures, removable };
}
