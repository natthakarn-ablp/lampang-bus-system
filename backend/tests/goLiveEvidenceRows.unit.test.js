'use strict';

/**
 * End-to-end checks on the action rows the go-live bundle and the closure board
 * emit, and on what the validators refuse to accept.
 *
 * The review these lock down found rows that could not be checked by anyone: a
 * `source` naming a directory that had never been created, an `evidence` column
 * pointing at `outputs/uat-evidence/<timestamp>/` - a path that resolves to
 * nothing - and readiness rows that all cited the phase9-evidence folder no
 * matter which gate was actually open. A row that cannot be checked is not
 * evidence of anything, and a board full of them reads as progress.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'scripts');
const schema = require(path.join(SCRIPTS, 'lib', 'closure-report-schema.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lampang-go-live-rows-'));
const BUNDLE_DIR = path.join(TMP, 'bundles', 'test-run');
const CLOSURE_DIR = path.join(TMP, 'closure', 'test-run');

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status == null ? 1 : result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function writeRows(dir, jsonName, csvName, rows) {
  fs.writeFileSync(path.join(dir, jsonName), `${JSON.stringify(rows, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, csvName), schema.actionRowsCsv(rows));
}

let bundleRows;
let closureRows;

beforeAll(() => {
  const bundle = run('create-go-live-bundle.js', [
    '--allow-pending',
    '--out-dir', path.join(TMP, 'bundles'),
    '--run-id', 'test-run',
  ]);
  expect(bundle.status).toBe(0);

  const closure = run('summarize-go-live-closure.js', [
    '--allow-pending',
    '--bundle', BUNDLE_DIR,
    '--out-dir', path.join(TMP, 'closure'),
    '--run-id', 'test-run',
  ]);
  expect(closure.status).toBe(0);

  bundleRows = readJson(path.join(BUNDLE_DIR, 'ACTION_ITEMS.json'));
  closureRows = readJson(path.join(CLOSURE_DIR, 'owner-actions.json'));
}, 300000);

afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('go-live bundle action rows', () => {
  test('every row satisfies the shared schema', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(bundleRows, 'ACTION_ITEMS.json', REPO_ROOT, handlers);
    expect(messages.fail).toEqual([]);
    expect(bundleRows.length).toBeGreaterThan(0);
  });

  test('no machine-readable row carries an unresolved <timestamp>', () => {
    const json = fs.readFileSync(path.join(BUNDLE_DIR, 'ACTION_ITEMS.json'), 'utf8');
    const csv = fs.readFileSync(path.join(BUNDLE_DIR, 'ACTION_ITEMS.csv'), 'utf8');
    expect(json).not.toContain('<timestamp>');
    expect(csv).not.toContain('<timestamp>');
  });

  test('JSON and CSV are the same schema and the same rows', () => {
    const csvLines = fs.readFileSync(path.join(BUNDLE_DIR, 'ACTION_ITEMS.csv'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim());
    expect(csvLines[0]).toBe(schema.ACTION_CSV_HEADER);
    expect(csvLines.length - 1).toBe(bundleRows.length);
    expect(readJson(path.join(BUNDLE_DIR, 'manifest.json')).action_columns).toEqual(schema.ACTION_COLUMNS);
  });

  test('a path-typed source names something that exists right now', () => {
    const pathTyped = bundleRows.filter((row) => !schema.PATHLESS_SOURCE_TYPES.includes(row.source_type));
    expect(pathTyped.length).toBeGreaterThan(0);
    for (const row of pathTyped) {
      for (const part of schema.actionPathParts(row.source)) {
        const abs = path.isAbsolute(part) ? part : path.join(REPO_ROOT, part);
        expect({ id: row.id, part, exists: fs.existsSync(abs) })
          .toEqual({ id: row.id, part, exists: true });
      }
    }
  });

  // These assertions must hold whether or not real evidence packs exist in the
  // repository yet. Pinning them to "outputs/uat-evidence is empty" would make
  // the suite - and therefore the local readiness gate that runs it - go red the
  // day the UAT lead delivers a pack, which is the project succeeding.
  test('an evidence root with no pack stays MISSING; once a pack exists the row names the pack', () => {
    const uatRow = bundleRows.find((row) => row.id === 'readiness-uat-evidence-pack');
    const packExists = schema.evidenceStatus(REPO_ROOT, schema.EVIDENCE_ROOTS.uat) === 'INCOMPLETE';

    if (!packExists) {
      expect(uatRow).toBeDefined();
      expect(uatRow.expected_evidence_root).toBe(schema.EVIDENCE_ROOTS.uat);
      expect(uatRow.evidence_status).toBe('MISSING');
      expect(uatRow.evidence_instruction).toContain('timestamped run directory');
    } else if (uatRow) {
      expect(uatRow.expected_evidence_root.startsWith(`${schema.EVIDENCE_ROOTS.uat}/`)).toBe(true);
      expect(uatRow.evidence_status).toBe('INCOMPLETE');
    }

    for (const row of bundleRows) {
      expect(row.expected_evidence_root).not.toContain('<timestamp>');
    }
  });

  test('the readiness sign-off row cites both sign-off documents', () => {
    const row = bundleRows.find((item) => item.id === 'readiness-go-live-signoff');
    expect(row).toBeDefined();
    expect(row.source).toContain('docs/UAT_SIGNOFF_2026-08.md');
    expect(row.source).toContain('docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
    expect(row.expected_evidence_root).toContain('docs/UAT_SIGNOFF_2026-08.md');
    expect(row.expected_evidence_root).toContain('docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
  });

  test('each readiness row is routed to the owner and evidence root of its own gate', () => {
    const expected = {
      'readiness-phase9-evidence': { owner: 'operator', root: schema.EVIDENCE_ROOTS.phase9 },
      'readiness-restore-drill-evidence': { owner: 'operator', root: schema.EVIDENCE_ROOTS.restoreDrill },
      'readiness-operator-gate-evidence': { owner: 'operator', root: schema.EVIDENCE_ROOTS.operatorGates },
      'readiness-uat-evidence-pack': { owner: 'uat-lead', root: schema.EVIDENCE_ROOTS.uat },
      'readiness-uat-evidence-safety': { owner: 'uat-lead', root: schema.EVIDENCE_ROOTS.uat },
      'readiness-go-live-signoff': { owner: 'project-owner', root: schema.SIGNOFF_DOCS, exact: true },
      'readiness-scorecard-overall': { owner: 'technical-owner', root: schema.SCORECARD_DOC, exact: true },
    };

    const readinessRows = bundleRows.filter((row) => row.category === 'readiness-verifier');

    // Every pending readiness check becomes exactly one row - no more, no fewer -
    // so the count self-adjusts as gates close instead of encoding today's census.
    const readinessLog = fs.readFileSync(path.join(BUNDLE_DIR, 'checks', 'readiness-100.log'), 'utf8');
    const pendingChecks = (readinessLog.match(/^\[ready-100\] PENDING: /gm) || []).length;
    expect(readinessRows).toHaveLength(pendingChecks);

    for (const row of readinessRows) {
      const spec = expected[row.id];
      expect({ id: row.id, routed: Boolean(spec) }).toEqual({ id: row.id, routed: true });
      expect({ id: row.id, owner: row.owner }).toEqual({ id: row.id, owner: spec.owner });
      if (spec.exact) {
        expect(row.expected_evidence_root).toBe(spec.root);
      } else {
        const under = row.expected_evidence_root === spec.root
          || row.expected_evidence_root.startsWith(`${spec.root}/`);
        expect({ id: row.id, root: row.expected_evidence_root, under }).toEqual({
          id: row.id, root: row.expected_evidence_root, under: true,
        });
      }
    }
  });

  test('sign-off and approval rows point at the document that gates them', () => {
    for (const row of bundleRows) {
      if (row.category === 'approval-scope') {
        expect(row.source).toBe(schema.OWNER_APPROVAL_DOC);
        expect(row.source_type).toBe('document');
      }
      if (row.id.startsWith('signoff-approval_scope') || row.id.startsWith('signoff-owner_operator')) {
        expect(row.source).toBe(schema.OWNER_APPROVAL_DOC);
      }
      if (row.id === 'signoff-common_checks' || row.id === 'signoff-role_checks') {
        expect(row.source).toBe(schema.UAT_SIGNOFF_DOC);
      }
    }
  });

  test('the bundle validator accepts pending rows only with --allow-pending', () => {
    const strict = run('validate-go-live-bundle.js', [BUNDLE_DIR]);
    expect(strict.status).toBe(1);

    const lenient = run('validate-go-live-bundle.js', [BUNDLE_DIR, '--allow-pending']);
    expect(lenient.output).toContain('[go-live-bundle] PASS (pending allowed)');
    expect(lenient.status).toBe(0);
  }, 60000);

  test('a missing evidence root is reported as PENDING, never as OK', () => {
    const lenient = run('validate-go-live-bundle.js', [BUNDLE_DIR, '--allow-pending']);
    const missingRows = bundleRows.filter((row) => row.evidence_status === 'MISSING');
    if (missingRows.length > 0) {
      expect(lenient.output).toContain('still has no evidence under');
    }
    for (const row of missingRows) {
      expect(lenient.output).not.toContain(`OK: ACTION_ITEMS.json row with ${row.expected_evidence_root}`);
    }
  }, 60000);
});

describe('closure board action rows', () => {
  test('the board carries every bundle action id', () => {
    const closureIds = new Set(closureRows.map((row) => row.id));
    for (const row of bundleRows) {
      expect({ id: row.id, carried: closureIds.has(row.id) }).toEqual({ id: row.id, carried: true });
    }
  });

  test('board rows satisfy the same schema as bundle rows', () => {
    const { messages, handlers } = collect();
    schema.validateActionRows(closureRows, 'owner-actions.json', REPO_ROOT, handlers);
    expect(messages.fail).toEqual([]);
  });

  test('owner-actions.csv shares the bundle header', () => {
    const header = fs.readFileSync(path.join(CLOSURE_DIR, 'owner-actions.csv'), 'utf8').split(/\r?\n/)[0];
    expect(header).toBe(schema.ACTION_CSV_HEADER);
    expect(readJson(path.join(CLOSURE_DIR, 'manifest.json')).action_columns).toEqual(schema.ACTION_COLUMNS);
  });

  test('the closure validator passes on the generated board with --allow-pending', () => {
    const result = run('validate-go-live-closure-status.js', [CLOSURE_DIR, '--allow-pending']);
    expect(result.output).toContain('[closure-status] PASS (pending allowed)');
    expect(result.status).toBe(0);
  }, 60000);
});

describe('the closure validator refuses rows that cannot be checked', () => {
  function tamperedBoard(name, mutate) {
    const dir = path.join(TMP, 'tampered', name);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of ['summary.md', 'manifest.json']) {
      fs.copyFileSync(path.join(CLOSURE_DIR, file), path.join(dir, file));
    }
    const rows = readJson(path.join(CLOSURE_DIR, 'owner-actions.json')).map((row) => ({ ...row }));
    const mutated = mutate(rows) || rows;
    writeRows(dir, 'owner-actions.json', 'owner-actions.csv', mutated);
    return run('validate-go-live-closure-status.js', [dir, '--allow-pending']);
  }

  test('an unresolved <timestamp> placeholder is rejected', () => {
    const result = tamperedBoard('placeholder', (rows) => {
      rows[0].expected_evidence_root = 'outputs/uat-evidence/<timestamp>';
      return rows;
    });
    expect(result.output).toContain('<timestamp>');
    expect(result.status).toBe(1);
  }, 60000);

  test('a source path that does not exist is rejected', () => {
    const result = tamperedBoard('ghost-source', (rows) => {
      rows[0].source = 'outputs/never-created/report.log';
      rows[0].source_type = 'log';
      return rows;
    });
    expect(result.output).toContain('source path does not exist');
    expect(result.status).toBe(1);
  }, 60000);

  test('claiming evidence exists when the root is empty is rejected', () => {
    const result = tamperedBoard('fake-evidence', (rows) => {
      rows[0].expected_evidence_root = 'outputs/never-created-evidence-root';
      rows[0].evidence_status = 'INCOMPLETE';
      return rows;
    });
    // Point at a root that can never hold evidence, so the assertion does not
    // depend on whether a real UAT pack has landed in the repository yet.
    expect(result.output).toContain('holds no evidence yet');
    expect(result.status).toBe(1);
  }, 60000);

  test('dropping a bundle action from the board is rejected', () => {
    const result = tamperedBoard('dropped-action', (rows) => rows.filter((row) => !row.id.startsWith('readiness-')));
    expect(result.output).toContain('dropped');
    expect(result.status).toBe(1);
  }, 60000);
});

describe('closure board with no bundle at all', () => {
  let noBundle;
  let rows;

  beforeAll(() => {
    const emptyRoot = path.join(TMP, 'empty-bundle-root');
    fs.mkdirSync(emptyRoot, { recursive: true });
    noBundle = run('summarize-go-live-closure.js', [
      '--allow-pending',
      '--bundle-root', emptyRoot,
      '--out-dir', path.join(TMP, 'closure'),
      '--run-id', 'no-bundle',
    ]);
    rows = readJson(path.join(TMP, 'closure', 'no-bundle', 'owner-actions.json'));
  }, 60000);

  test('stays FAIL and exits non-zero even with --allow-pending', () => {
    expect(noBundle.output).toContain('status=FAIL');
    expect(noBundle.status).toBe(1);
  });

  test('raises exactly one technical-owner action with pending_count 1', () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'bundle-missing',
      owner: 'technical-owner',
      priority: 'P0',
      pending_count: 1,
      evidence_status: 'MISSING',
    });
  });

  test('names the scan as the source and a plain root as the evidence target', () => {
    expect(rows[0].source_type).toBe('command');
    expect(rows[0].source).toContain('found no run directory');
    expect(rows[0].expected_evidence_root).not.toContain('<timestamp>');
    expect(rows[0].evidence_instruction).toContain('timestamped run directory');
  });

  test('the manifest totals and owner board agree with the single action', () => {
    const manifest = readJson(path.join(TMP, 'closure', 'no-bundle', 'manifest.json'));
    expect(manifest.status).toBe('FAIL');
    expect(manifest.totals).toEqual({ pass: 0, pending: 0, fail: 1 });
    expect(manifest.owner_totals['technical-owner']).toMatchObject({ actions: 1, pending_count: 1, p0: 1 });
  });
});

describe('the automated readiness collector cannot regrade a warning as a pass', () => {
  const source = fs.readFileSync(path.join(SCRIPTS, 'collect-automated-readiness-evidence.js'), 'utf8');

  test('gate status comes from the shared grader, not from the exit code', () => {
    expect(source).toContain('schema.gradeGateOutput(output, exitCode)');
    expect(source).not.toMatch(/const status = result\.status === 0 \? 'PASS' : 'FAIL'/);
  });

  test('warnings, failures and NOT EVALUATED lines are recorded, not summarised away', () => {
    expect(source).toContain('warnings: graded.warnings');
    expect(source).toContain('failures: graded.failures');
    expect(source).toContain('notEvaluated: graded.notEvaluated');
    for (const column of ['warning_count', 'failure_count', 'not_evaluated_count', 'gate_warn', 'gate_fail']) {
      expect(source).toContain(column);
    }
  });

  test('human action rows use evidence roots, never timestamped placeholders', () => {
    const codeLines = source
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
    expect(codeLines.join('\n')).not.toContain('<timestamp>');
    expect(source).toContain('EVIDENCE_ROOTS.operatorGates');
    expect(source).toContain('EVIDENCE_ROOTS.restoreDrill');
    expect(source).toContain('EVIDENCE_ROOTS.uat');
  });

  test('human action rows are built through the shared schema', () => {
    expect(source).toContain('humanActions.push(schema.actionRow(ROOT, item))');
    expect(source).toContain('csv(humanActions, ACTION_COLUMNS)');
  });
});
