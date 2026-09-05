'use strict';

/**
 * A check may only report PASS about a command that ran.
 *
 * THE DEFECT
 * ----------
 * collect-automated-readiness-evidence.js read git like this:
 *
 *     return result.status === 0 ? String(result.stdout || '') : '';
 *
 * and every caller took the empty string as a real, empty answer. An unreadable
 * worktree reported "worktree clean" and an unreadable diff reported "no secret
 * patterns found" — both PASS, both having looked at nothing. Proved against the
 * real script by pointing `git show` at a ref that does not exist:
 * secret-scan-head still came back PASS.
 *
 * It matters more than it looks. A0-9's exit criteria in the execution plan is
 * that both secret scans are PASS, so a machine without git, or a repository
 * git cannot read, satisfied a gate about secrets in the diff.
 *
 * It is also the second time this exact shape has appeared in this pipeline: npm
 * audit reported a clean audit from an unparsable report in
 * production-readiness-gate.sh. Same rule both times — ran-and-found-nothing is
 * PASS, could-not-run is PENDING, and the two must never share a value.
 *
 * WHY THIS TESTS A MODULE AND NOT THE SCRIPT
 * ------------------------------------------
 * Running the collector takes 35 seconds: it shells out to both readiness gates,
 * npm audit and eight validators. Stubbing git on PATH does not work either —
 * Node resolves git.exe ahead of a .cmd shim. The grading is the part that was
 * wrong, so the grading is what moved somewhere it can be called directly.
 */

const {
  runCommand, gradeScan, gradeWorktreeStatus,
} = require('../../scripts/lib/command-result');

/** A spawnSync stand-in. */
const spawnStub = (result) => () => result;

const findSecrets = (text) => String(text).split('\n').filter((l) => l.includes('SECRET='));

describe('runCommand keeps "did it run" apart from "what did it say"', () => {
  it('reports a successful command with its output', () => {
    const r = runCommand(spawnStub({ status: 0, stdout: 'a\nb\n' }), 'git', ['status']);
    expect(`${r.ok} / ${JSON.stringify(r.text)}`).toBe('true / "a\\nb\\n"');
  });

  it('reports a non-zero exit as not ok, and says so', () => {
    const r = runCommand(spawnStub({ status: 128, stdout: '' }), 'git', ['show', 'NO_SUCH_REF']);
    expect(`ok=${r.ok}`).toBe('ok=false');
    expect(r.reason).toBe('git show NO_SUCH_REF exited 128');
  });

  it('reports a missing binary as not ok', () => {
    // The case that makes this more than theory: a machine without git.
    const r = runCommand(spawnStub({ error: new Error('spawnSync git ENOENT') }), 'git', ['status']);
    expect(`ok=${r.ok}`).toBe('ok=false');
    expect(r.reason).toContain('ENOENT');
  });

  it('does not pass stdout through when the command failed', () => {
    // A failed git can still have written to stdout. Reading it would be reading
    // a partial answer as a whole one.
    const r = runCommand(spawnStub({ status: 1, stdout: 'partial output' }), 'git', ['diff']);
    expect(`text=${JSON.stringify(r.text)}`).toBe('text=""');
  });
});

describe('gradeScan', () => {
  it('is PASS only when the scan ran and found nothing', () => {
    const g = gradeScan({ ok: true, text: 'nothing here\n' }, findSecrets);
    expect(`${g.status} / ${g.detail}`).toBe('PASS / no secret patterns found');
  });

  it('is FAIL when the scan ran and found something', () => {
    const g = gradeScan({ ok: true, text: 'x\nSECRET=abc\ny\n' }, findSecrets);
    expect(`${g.status} / ${g.detail}`).toBe('FAIL / 1 secret-like lines found');
    expect(g.output).toBe('SECRET=abc');
  });

  it('is PENDING when the scan could not run — the defect', () => {
    // Before the fix this returned PASS with "no secret patterns found", because
    // the failed command's empty output contained no matches.
    const g = gradeScan({ ok: false, text: '', reason: 'git show HEAD exited 128' }, findSecrets);
    expect(`${g.status}`).toBe('PENDING');
    expect(g.detail).toBe('NOT EVALUATED: git show HEAD exited 128');
  });

  it('cannot be talked into PASS by a matcher that finds nothing', () => {
    // The failure has to be decided before the matcher is consulted, not by it.
    const g = gradeScan({ ok: false, text: 'SECRET=abc', reason: 'boom' }, () => []);
    expect(`${g.status}`).toBe('PENDING');
  });

  it('treats a missing result object as not evaluated', () => {
    expect(gradeScan(undefined, findSecrets).status).toBe('PENDING');
    expect(gradeScan(null, findSecrets).detail).toBe('NOT EVALUATED: command did not run');
  });
});

describe('gradeWorktreeStatus', () => {
  it('is PASS for a clean worktree', () => {
    const g = gradeWorktreeStatus({ ok: true, text: '' });
    expect(`${g.status} / ${g.detail}`).toBe('PASS / worktree clean');
  });

  it('is PENDING when there are changes', () => {
    const g = gradeWorktreeStatus({ ok: true, text: ' M src/app.js\n' });
    expect(`${g.status} / ${g.detail}`).toBe('PENDING / worktree has source changes');
  });

  it('is PENDING when the worktree could not be read', () => {
    // An unreadable worktree is not a clean worktree, which is what the old code
    // reported and what this line exists to stop.
    const g = gradeWorktreeStatus({ ok: false, text: '', reason: 'git status --short exited 128' });
    expect(`${g.status}`).toBe('PENDING');
    expect(g.detail).toBe('NOT EVALUATED: git status --short exited 128');
  });
});
