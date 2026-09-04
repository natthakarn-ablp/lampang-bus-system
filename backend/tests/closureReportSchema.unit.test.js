'use strict';

/**
 * The shared closure/readiness report schema.
 *
 * Two regressions live here. The first: a gate that exits 0 with warnings was
 * recorded as PASS, so `npm audit NOT EVALUATED` - the gate's own way of saying
 * it never reached the registry - propagated into the readiness totals as a
 * dependency check that had happened. The second: action rows carried a single
 * `evidence` column that meant both "what produced this status" and "where the
 * evidence must eventually go", so a row naming a directory nobody had created
 * read as though the evidence in it existed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const schema = require(path.join(REPO_ROOT, 'scripts', 'lib', 'closure-report-schema.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lampang-closure-schema-'));

afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function gateOutput(lines) {
  return `${lines.join('\n')}\n`;
}

function collect() {
  const messages = { ok: [], pending: [], fail: [] };
  return {
    messages,
    handlers: {
      ok: (message) => messages.ok.push(message),
      pending: (message) => messages.pending.push(message),
      fail: (message) => messages.fail.push(message),
    },
  };
}

function validRow(overrides) {
  return {
    id: 'sample-row',
    category: 'readiness-verifier',
    owner: 'operator',
    priority: 'P0',
    pending_count: 1,
    source: 'git status --short',
    source_type: 'command',
    expected_evidence_root: 'never-created-evidence-root',
    evidence_status: 'MISSING',
    evidence_instruction: schema.TIMESTAMPED_RUN_DIR,
    action: 'Run role UAT and store the evidence pack.',
    ...overrides,
  };
}

describe('gradeGateOutput', () => {
  test('a clean gate that exits 0 is a PASS', () => {
    const graded = schema.gradeGateOutput(gateOutput([
      '[pass] backend npm audit clean total=0',
      '[gate] summary pass=12 warn=0 fail=0 skip=0',
    ]), 0);

    expect(graded.status).toBe('PASS');
    expect(graded.gateSummary).toEqual({ pass: 12, warn: 0, fail: 0, skip: 0 });
    expect(graded.warnings).toEqual([]);
  });

  test('warnings make the gate PENDING even though the gate exited 0', () => {
    const graded = schema.gradeGateOutput(gateOutput([
      '[warn] backend npm audit NOT EVALUATED: npm audit produced no readable report',
      '[gate] summary pass=11 warn=1 fail=0 skip=0',
    ]), 0);

    expect(graded.status).toBe('PENDING');
    expect(graded.gateSummary.warn).toBe(1);
    expect(graded.warnings).toHaveLength(1);
    expect(graded.notEvaluated).toHaveLength(1);
  });

  test('the NOT EVALUATED reason survives into the recorded detail', () => {
    const graded = schema.gradeGateOutput(gateOutput([
      '[warn] frontend npm audit NOT EVALUATED: registry unreachable; dependencies were not checked',
      '[gate] summary pass=11 warn=1 fail=0 skip=0',
    ]), 0);

    expect(graded.detail).toContain('[gate] summary pass=11 warn=1 fail=0 skip=0');
    expect(graded.detail).toContain('NOT EVALUATED');
    expect(graded.detail).toContain('dependencies were not checked');
  });

  test('any failure makes the gate FAIL', () => {
    const graded = schema.gradeGateOutput(gateOutput([
      '[fail] backend npm audit vulnerable total=3 critical=0 high=2',
      '[warn] frontend npm audit NOT EVALUATED: registry unreachable',
      '[gate] summary pass=10 warn=1 fail=1 skip=0',
    ]), 1);

    expect(graded.status).toBe('FAIL');
    expect(graded.failures).toHaveLength(1);
    expect(graded.detail).toContain('vulnerable total=3');
  });

  test('a clean summary from a non-zero run is PENDING, not PASS', () => {
    const graded = schema.gradeGateOutput(gateOutput([
      '[gate] summary pass=12 warn=0 fail=0 skip=0',
    ]), 137);

    expect(graded.status).toBe('PENDING');
    expect(graded.detail).toContain('NOT EVALUATED');
  });

  test('an unreadable gate is PENDING, never PASS', () => {
    const graded = schema.gradeGateOutput('bash: scripts/production-readiness-gate.sh: No such file\n', 127);

    expect(graded.status).toBe('PENDING');
    expect(graded.gateSummary).toBeNull();
    expect(graded.detail).toContain('NOT EVALUATED');
  });
});

describe('statusFromValidatorOutput', () => {
  test('NOT EVALUATED is never a pass', () => {
    expect(schema.statusFromValidatorOutput('[x] NOT EVALUATED: registry unreachable')).toBe('PENDING');
  });

  test('PENDING is reported as PENDING', () => {
    expect(schema.statusFromValidatorOutput('[x] PENDING: awaiting evidence')).toBe('PENDING');
  });

  test('a clean validator body passes', () => {
    expect(schema.statusFromValidatorOutput('[x] OK: everything checked\n[x] PASS')).toBe('PASS');
  });
});

describe('gradeValidatorOutput', () => {
  const pendingRun = [
    '[go-live-bundle] OK: manifest parsed',
    '[go-live-bundle] PENDING: check uat-evidence is PENDING',
    '[go-live-bundle] PENDING: check restore-drill-evidence is PENDING',
    '[go-live-bundle] summary ok=19 pending=16 fail=0 allow_pending=true',
    '[go-live-bundle] PASS (pending allowed)',
  ].join('\n');

  test('a PENDING run is not described by its trailing "PASS (pending allowed)" line', () => {
    const graded = schema.gradeValidatorOutput(pendingRun, 0);

    expect(graded.status).toBe('PENDING');
    expect(graded.detail).toContain('summary ok=19 pending=16 fail=0');
    expect(graded.detail).not.toMatch(/^\[go-live-bundle\] PASS/);
  });

  test('the pending reasons are carried into the row, not left only in the log', () => {
    const graded = schema.gradeValidatorOutput(pendingRun, 0);

    expect(graded.warnings).toEqual([
      'check uat-evidence is PENDING',
      'check restore-drill-evidence is PENDING',
    ]);
    expect(graded.detail).toContain('check uat-evidence is PENDING');
  });

  test('a FAIL run reports its failures instead of claiming zero', () => {
    const graded = schema.gradeValidatorOutput([
      '[closure-status] FAIL: required closure file missing: summary.md',
      '[closure-status] FAIL: manifest.action_columns must list the shared action-row schema',
      '[closure-status] summary ok=3 pending=0 fail=2 allow_pending=true',
    ].join('\n'), 1);

    expect(graded.status).toBe('FAIL');
    expect(graded.failures).toHaveLength(2);
    expect(graded.detail).toContain('required closure file missing: summary.md');
  });

  test('reasons beyond the detail cap are counted, never dropped silently', () => {
    const many = Array.from({ length: 9 }, (_, i) => `[x] PENDING: reason ${i + 1}`);
    const graded = schema.gradeValidatorOutput([...many, '[x] summary ok=0 pending=9 fail=0'].join('\n'), 0);

    expect(graded.warnings).toHaveLength(9);
    expect(graded.detail).toContain('(+4 more reason(s) in the log)');
  });

  test('NOT EVALUATED survives into the detail', () => {
    const graded = schema.gradeValidatorOutput([
      '[x] WARN: dependency audit NOT EVALUATED: registry unreachable',
      '[x] summary ok=1 pending=1 fail=0',
    ].join('\n'), 0);

    expect(graded.status).toBe('PENDING');
    expect(graded.detail).toContain('NOT EVALUATED');
  });
});

describe('evidenceStatus', () => {
  test('a path that does not exist is MISSING', () => {
    expect(schema.evidenceStatus(TMP, 'never-created')).toBe('MISSING');
  });

  test('an empty evidence root is MISSING, not evidence', () => {
    fs.mkdirSync(path.join(TMP, 'empty-root'), { recursive: true });
    expect(schema.evidenceStatus(TMP, 'empty-root')).toBe('MISSING');
  });

  test('a root holding a run directory with a manifest is INCOMPLETE', () => {
    const run = path.join(TMP, 'populated-root', '20260904-120000');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'manifest.json'), '{}');
    expect(schema.evidenceStatus(TMP, 'populated-root')).toBe('INCOMPLETE');
  });

  test('a run directory carrying its own manifest is INCOMPLETE', () => {
    expect(schema.evidenceStatus(TMP, 'populated-root/20260904-120000')).toBe('INCOMPLETE');
  });

  test('a plain file is INCOMPLETE', () => {
    fs.writeFileSync(path.join(TMP, 'signoff.md'), '# sign-off\n');
    expect(schema.evidenceStatus(TMP, 'signoff.md')).toBe('INCOMPLETE');
  });

  test('a two-document root is MISSING unless both documents exist', () => {
    expect(schema.evidenceStatus(TMP, 'signoff.md + approval.md')).toBe('MISSING');
    fs.writeFileSync(path.join(TMP, 'approval.md'), '# approval\n');
    expect(schema.evidenceStatus(TMP, 'signoff.md + approval.md')).toBe('INCOMPLETE');
  });

  test('there is no PASS state for an action row', () => {
    expect(schema.EVIDENCE_STATUSES).toEqual(['MISSING', 'INCOMPLETE']);
  });
});

describe('validateActionRows', () => {
  test('a well-formed row with missing evidence is PENDING, not a failure', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows([validRow()], 'rows.json', TMP, handlers);

    expect(messages.fail).toEqual([]);
    expect(messages.pending).toHaveLength(1);
    expect(messages.pending[0]).toContain('never-created-evidence-root');
  });

  test('an unresolved <timestamp> placeholder fails', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(
      [validRow({ expected_evidence_root: 'outputs/uat-evidence/<timestamp>' })],
      'rows.json',
      TMP,
      handlers,
    );

    expect(messages.fail.join(' ')).toContain('<timestamp>');
  });

  test('a path-typed source that does not exist fails', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(
      [validRow({ source: 'docs/NOT_A_REAL_DOCUMENT.md', source_type: 'document' })],
      'rows.json',
      REPO_ROOT,
      handlers,
    );

    expect(messages.fail.join(' ')).toContain('source path does not exist');
  });

  test('a real document source passes the existence check', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(
      [validRow({
        source: schema.SIGNOFF_DOCS,
        source_type: 'document',
        expected_evidence_root: schema.SIGNOFF_DOCS,
        evidence_status: 'INCOMPLETE',
      })],
      'rows.json',
      REPO_ROOT,
      handlers,
    );

    expect(messages.fail).toEqual([]);
    expect(messages.pending).toEqual([]);
  });

  test('claiming INCOMPLETE for evidence that does not exist fails', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(
      [validRow({ expected_evidence_root: 'empty-root', evidence_status: 'INCOMPLETE' })],
      'rows.json',
      TMP,
      handlers,
    );

    expect(messages.fail.join(' ')).toContain('holds no evidence yet');
  });

  test('claiming MISSING for evidence that exists fails, so a stale board is caught', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(
      [validRow({ expected_evidence_root: 'populated-root', evidence_status: 'MISSING' })],
      'rows.json',
      TMP,
      handlers,
    );

    expect(messages.fail.join(' ')).toContain('already holds evidence');
  });

  test('an unknown source_type fails', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows([validRow({ source_type: 'vibes' })], 'rows.json', TMP, handlers);
    expect(messages.fail.join(' ')).toContain('invalid source_type');
  });

  test('a missing column fails', () => {
    const row = validRow();
    delete row.evidence_instruction;
    const { messages, handlers } = collect();
    schema.validateActionRows([row], 'rows.json', TMP, handlers);
    expect(messages.fail.join(' ')).toContain('missing evidence_instruction');
  });

  test('a bad priority fails', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows([validRow({ priority: 'urgent' })], 'rows.json', TMP, handlers);
    expect(messages.fail.join(' ')).toContain('invalid priority');
  });
});

describe('CSV and JSON stay one schema', () => {
  test('the CSV header is exactly the column list', () => {
    expect(schema.ACTION_CSV_HEADER).toBe(schema.ACTION_COLUMNS.join(','));
    expect(schema.ACTION_COLUMNS).toContain('source');
    expect(schema.ACTION_COLUMNS).toContain('expected_evidence_root');
    expect(schema.ACTION_COLUMNS).toContain('evidence_status');
  });

  test('rendered CSV rows carry every column in order', () => {
    const csv = schema.actionRowsCsv([validRow()]).split('\n');
    expect(csv[0]).toBe(schema.ACTION_CSV_HEADER);
    expect(csv[1].split('","')).toHaveLength(schema.ACTION_COLUMNS.length);
  });

  test('actionRow derives evidence_status instead of trusting the caller', () => {
    const row = schema.actionRow(TMP, {
      ...validRow(),
      expected_evidence_root: 'populated-root',
      evidence_status: 'MISSING',
    });
    expect(row.evidence_status).toBe('INCOMPLETE');
  });

  test('the sign-off document pair names both documents', () => {
    expect(schema.SIGNOFF_DOCS).toContain('UAT_SIGNOFF_2026-08.md');
    expect(schema.SIGNOFF_DOCS).toContain('PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
    expect(schema.actionPathParts(schema.SIGNOFF_DOCS)).toHaveLength(2);
  });

  test('no evidence root is written as a timestamped child', () => {
    for (const root of Object.values(schema.EVIDENCE_ROOTS)) {
      expect(root).not.toContain('<timestamp>');
      expect(root.endsWith('/')).toBe(false);
    }
  });
});
