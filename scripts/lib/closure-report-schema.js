'use strict';

/**
 * The one action-row schema, and the one way of grading a gate.
 *
 * Five programs used to carry their own copy of both: create-go-live-bundle.js
 * and summarize-go-live-closure.js emitted action rows, the two validators
 * re-declared the column list they expected, and
 * collect-automated-readiness-evidence.js graded gate output on its own. The
 * copies drifted - the bundle wrote an `evidence` column the closure board
 * re-interpreted, the collector called a gate PASS on an exit code the gate
 * never intended as a verdict - and drift in a readiness report is not a
 * cosmetic problem: it is how a report ends up green about something nobody
 * checked.
 *
 * Two ideas are worth stating once, here, because every consumer depends on
 * them:
 *
 * 1. `source` and `expected_evidence_root` are different questions.
 *    `source` is "what produced this status" and must be a command that was run
 *    or a path that exists right now. `expected_evidence_root` is "where does
 *    the closing evidence have to land" and may legitimately not exist yet.
 *    A single `evidence` column meant both, so a row pointing at
 *    `outputs/uat-evidence/<timestamp>/` read as though UAT evidence existed
 *    while naming a path that resolves to nothing.
 *
 * 2. A directory is not evidence. `outputs/restore-drill/` existing says only
 *    that somebody made a folder. Evidence exists when there is a file, or a
 *    directory carrying a pack manifest. `evidence_status` is derived from the
 *    filesystem and is only ever MISSING or INCOMPLETE: an action row is by
 *    definition unfinished, so it can never read as PASS.
 */

const fs = require('fs');
const path = require('path');

const ACTION_COLUMNS = [
  'id',
  'category',
  'owner',
  'priority',
  'pending_count',
  'source',
  'source_type',
  'expected_evidence_root',
  'evidence_status',
  'evidence_instruction',
  'action',
];

const ACTION_CSV_HEADER = ACTION_COLUMNS.join(',');

// `command` and `environment` describe a check that was run, not a file on
// disk, so they are the only source types exempt from the existence check.
const SOURCE_TYPES = ['command', 'environment', 'document', 'log', 'report', 'evidence-pack'];
const PATHLESS_SOURCE_TYPES = ['command', 'environment'];
const EVIDENCE_STATUSES = ['MISSING', 'INCOMPLETE'];
const PRIORITIES = ['P0', 'P1', 'P2'];

// Two paths that gate one check are written as `a + b`, so a row can name both
// sign-off documents instead of hiding half the gate.
const PATH_SEPARATOR = ' + ';

const TIMESTAMPED_RUN_DIR = 'create a timestamped run directory under this root when the work is actually performed';

const UAT_SIGNOFF_DOC = 'docs/UAT_SIGNOFF_2026-08.md';
const OWNER_APPROVAL_DOC = 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md';
const SCORECARD_DOC = 'docs/READINESS_SCORECARD_2026-08.md';
const SIGNOFF_DOCS = `${UAT_SIGNOFF_DOC}${PATH_SEPARATOR}${OWNER_APPROVAL_DOC}`;

const EVIDENCE_ROOTS = {
  phase9: 'outputs/phase9-evidence',
  uat: 'outputs/uat-evidence',
  restoreDrill: 'outputs/restore-drill',
  operatorGates: 'outputs/operator-gates',
  goLiveBundle: 'outputs/go-live-bundle',
};

function actionPathParts(value) {
  return String(value == null ? '' : value)
    .split(PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Evidence exists when there is a file, or a directory that actually carries a
 * pack manifest - directly, for a run directory, or in a child, for a root that
 * already has runs under it. An empty root is a place to put evidence.
 */
function evidenceIsPresent(root, relPath) {
  const target = String(relPath || '');
  if (!target) return false;
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  if (!fs.existsSync(abs)) return false;
  if (!fs.statSync(abs).isDirectory()) return true;
  if (fs.existsSync(path.join(abs, 'manifest.json'))) return true;
  return fs.readdirSync(abs).some((name) => fs.existsSync(path.join(abs, name, 'manifest.json')));
}

function evidenceStatus(root, expectedRoot) {
  const parts = actionPathParts(expectedRoot);
  if (parts.length === 0) return 'MISSING';
  return parts.every((part) => evidenceIsPresent(root, part)) ? 'INCOMPLETE' : 'MISSING';
}

/**
 * Build one action row, deriving `evidence_status` rather than accepting it.
 */
function actionRow(root, item) {
  return {
    id: item.id,
    category: item.category,
    owner: item.owner,
    priority: item.priority,
    pending_count: item.pending_count == null ? 1 : item.pending_count,
    source: item.source,
    source_type: item.source_type,
    expected_evidence_root: item.expected_evidence_root,
    evidence_status: evidenceStatus(root, item.expected_evidence_root),
    evidence_instruction: item.evidence_instruction,
    action: item.action,
  };
}

function actionRowsCsv(rows) {
  const lines = [
    ACTION_CSV_HEADER,
    ...rows.map((row) => ACTION_COLUMNS.map((column) => csvCell(row[column])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

/**
 * Validate rows against the schema. `handlers` supplies the ok/pending/fail
 * counters of the calling validator so the messages keep that validator's
 * prefix and totals.
 */
function validateActionRows(rows, label, root, handlers) {
  for (const [index, item] of rows.entries()) {
    const where = `${label} row ${index + 1}`;

    for (const key of ACTION_COLUMNS) {
      if (item[key] == null || String(item[key]).trim() === '') {
        handlers.fail(`${where} missing ${key}`);
      }
    }

    const combined = ACTION_COLUMNS.map((key) => String(item[key] == null ? '' : item[key])).join(' ');
    if (combined.includes('<timestamp>')) {
      handlers.fail(`${where} contains an unresolved <timestamp> placeholder`);
    }

    const priority = String(item.priority || '').trim();
    if (!PRIORITIES.includes(priority)) {
      handlers.fail(`${where} invalid priority: ${priority || '(blank)'}`);
    }

    const pendingCount = Number(item.pending_count);
    if (!Number.isFinite(pendingCount) || pendingCount < 0) {
      handlers.fail(`${where} invalid pending_count: ${item.pending_count}`);
    }

    const sourceType = String(item.source_type || '').trim();
    if (!SOURCE_TYPES.includes(sourceType)) {
      handlers.fail(`${where} invalid source_type: ${sourceType || '(blank)'}`);
    } else if (!PATHLESS_SOURCE_TYPES.includes(sourceType)) {
      for (const part of actionPathParts(item.source)) {
        const abs = path.isAbsolute(part) ? part : path.join(root, part);
        if (!fs.existsSync(abs)) {
          handlers.fail(`${where} source_type=${sourceType} but source path does not exist: ${part}`);
        }
      }
    }

    const status = String(item.evidence_status || '').trim();
    const expectedParts = actionPathParts(item.expected_evidence_root);
    if (!EVIDENCE_STATUSES.includes(status)) {
      handlers.fail(`${where} invalid evidence_status: ${status || '(blank)'}`);
    } else if (expectedParts.length === 0) {
      handlers.fail(`${where} expected_evidence_root is empty`);
    } else {
      const present = expectedParts.every((part) => evidenceIsPresent(root, part));
      if (status === 'INCOMPLETE' && !present) {
        handlers.fail(`${where} claims evidence_status=INCOMPLETE but ${item.expected_evidence_root} holds no evidence yet`);
      } else if (status === 'MISSING' && present) {
        handlers.fail(`${where} claims evidence_status=MISSING but ${item.expected_evidence_root} already holds evidence; regenerate the report`);
      } else if (status === 'MISSING') {
        handlers.pending(`${where} still has no evidence under ${item.expected_evidence_root}`);
      }
    }

    if (/password|token|secret|bearer/i.test(combined)) {
      handlers.fail(`${where} contains a high-risk secret keyword`);
    }
  }
}

// --------------------------------------------------------------------------
// Gate grading
// --------------------------------------------------------------------------

function parseGateSummary(output) {
  const line = String(output || '')
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith('[gate] summary '));
  if (!line) return null;
  const match = line.match(/pass=(\d+)\s+warn=(\d+)\s+fail=(\d+)\s+skip=(\d+)/);
  if (!match) return null;
  return {
    line: line.trim(),
    pass: Number(match[1]),
    warn: Number(match[2]),
    fail: Number(match[3]),
    skip: Number(match[4]),
  };
}

function linesWithPrefix(output, prefix) {
  return String(output || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function notEvaluatedLines(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('NOT EVALUATED'));
}

/**
 * A gate that exits 0 with warnings is not a pass.
 *
 * production-readiness-gate.sh exits 1 only on [fail]; a [warn] - including
 * `npm audit NOT EVALUATED`, which is what an unreachable registry produces -
 * leaves the exit code at 0 by design. Grading on the exit code alone recorded
 * PASS for a run in which the dependencies were never checked, and that PASS
 * propagated into the readiness totals.
 *
 * Grade on the counters the gate printed: fail > 0 is FAIL, warn > 0 with
 * fail = 0 is PENDING, PASS needs both at zero. An unparsable summary is
 * PENDING, never PASS - an unreadable gate is an unevaluated gate.
 */
function gradeGateOutput(output, exitCode) {
  const gateSummary = parseGateSummary(output);
  const warnings = linesWithPrefix(output, '[warn] ');
  const failures = linesWithPrefix(output, '[fail] ');
  const notEvaluated = notEvaluatedLines(output);

  let status;
  let detail;
  if (!gateSummary) {
    status = 'PENDING';
    detail = `no parsable "[gate] summary" line (exit=${exitCode}); gate result NOT EVALUATED`;
  } else if (gateSummary.fail > 0) {
    status = 'FAIL';
    detail = gateSummary.line;
  } else if (gateSummary.warn > 0) {
    status = 'PENDING';
    detail = gateSummary.line;
  } else if (exitCode !== 0) {
    status = 'PENDING';
    detail = `${gateSummary.line} but the gate exited ${exitCode}; result NOT EVALUATED`;
  } else {
    status = 'PASS';
    detail = gateSummary.line;
  }

  // Carry the reasons, not only the counts. A PENDING row that says just
  // "warn=1" sends the reader back into the log to find out what was skipped.
  const reasons = [...failures, ...warnings];
  if (reasons.length > 0) detail = `${detail} | ${reasons.join(' | ')}`;

  return {
    status,
    detail,
    gateSummary: gateSummary
      ? {
        pass: gateSummary.pass,
        warn: gateSummary.warn,
        fail: gateSummary.fail,
        skip: gateSummary.skip,
      }
      : null,
    warnings,
    failures,
    notEvaluated,
  };
}

/**
 * "NOT EVALUATED" is what a check prints when it could not reach the thing it
 * grades. That is not a pass, and it must not be swallowed on the way into the
 * report.
 */
function statusFromValidatorOutput(output) {
  if (/NOT EVALUATED/.test(output)) return 'PENDING';
  return /\bPENDING\b/.test(output) ? 'PENDING' : 'PASS';
}

// `[go-live-bundle] PENDING: check uat-evidence is PENDING` and friends. The
// bracketed tag varies by validator; the verdict word and the reason do not.
const VALIDATOR_REASON = /^\[[^\]]+\]\s+(FAIL|PENDING|WARN):\s*(.+)$/;
const VALIDATOR_SUMMARY = /^\[[^\]]+\]\s+summary\b/;
const MAX_DETAIL_REASONS = 5;

/**
 * Grade a validator run and keep the reasons it printed.
 *
 * Taking the last line that merely mentions PASS/PENDING/FAIL is the trap here:
 * every validator run with `--allow-pending` ends with `PASS (pending allowed)`,
 * so a PENDING row's one-line detail read the word "PASS" while the counts line
 * and all the pending reasons - sitting directly above it - were dropped. The
 * summary line is the one carrying the numbers, so prefer it explicitly, and
 * carry the reasons instead of leaving them only in the log.
 */
function gradeValidatorOutput(output, exitCode) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim());
  const failures = [];
  const warnings = [];
  for (const line of lines) {
    const match = VALIDATOR_REASON.exec(line);
    if (!match) continue;
    if (match[1] === 'FAIL') failures.push(match[2].trim());
    else warnings.push(match[2].trim());
  }

  const notEvaluated = notEvaluatedLines(output);
  const summaryLine = lines.slice().reverse().find((line) => VALIDATOR_SUMMARY.test(line));
  const status = exitCode === 0 ? statusFromValidatorOutput(output) : 'FAIL';

  const reasons = [...failures, ...warnings]
    .filter((reason) => !notEvaluated.some((line) => line.includes(reason)));
  const shown = reasons.slice(0, MAX_DETAIL_REASONS);
  const parts = [summaryLine || `exit=${exitCode}`, ...notEvaluated, ...shown];
  // Say how many were left out rather than trimming silently: a detail cell that
  // shows five of sixteen reasons and admits nothing reads as the whole story.
  if (reasons.length > shown.length) {
    parts.push(`(+${reasons.length - shown.length} more reason(s) in the log)`);
  }

  return {
    status,
    detail: parts.join(' | '),
    warnings,
    failures,
    notEvaluated,
  };
}

module.exports = {
  ACTION_COLUMNS,
  ACTION_CSV_HEADER,
  SOURCE_TYPES,
  PATHLESS_SOURCE_TYPES,
  EVIDENCE_STATUSES,
  PRIORITIES,
  PATH_SEPARATOR,
  TIMESTAMPED_RUN_DIR,
  UAT_SIGNOFF_DOC,
  OWNER_APPROVAL_DOC,
  SCORECARD_DOC,
  SIGNOFF_DOCS,
  EVIDENCE_ROOTS,
  actionPathParts,
  evidenceIsPresent,
  evidenceStatus,
  actionRow,
  actionRowsCsv,
  csvCell,
  validateActionRows,
  parseGateSummary,
  linesWithPrefix,
  notEvaluatedLines,
  gradeGateOutput,
  gradeValidatorOutput,
  statusFromValidatorOutput,
};
