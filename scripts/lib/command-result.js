'use strict';

/**
 * command-result.js — a check may only report PASS about a command that ran.
 *
 * THE SHAPE THIS EXISTS TO PREVENT
 * --------------------------------
 * The readiness collector used to read git like this:
 *
 *     function git(args) {
 *       const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
 *       return r.status === 0 ? String(r.stdout || '') : '';
 *     }
 *
 * Every caller then treated the empty string as a real, empty answer. An
 * unreadable worktree became "worktree clean" and an unreadable diff became
 * "no secret patterns found" — both PASS, both having checked nothing. Proved by
 * pointing `git show` at a ref that does not exist: secret-scan-head still
 * reported PASS.
 *
 * It is the same false green npm audit produced in production-readiness-gate.sh,
 * in the same evidence pipeline, and it mattered more here: A0-9's exit criteria
 * is that both secret scans are PASS, so a broken git satisfied the gate.
 *
 * The rule these helpers encode is the one the gate script already follows:
 * ran-and-found-nothing is PASS, could-not-run is PENDING, and the two are never
 * the same value.
 */

/**
 * Run a command and keep whether it ran, separate from what it printed.
 *
 * @param {Function} spawnSyncFn  child_process.spawnSync, or a stub in tests
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]  passed through to spawnSync
 * @returns {{ok: boolean, text: string, reason: string}}
 */
function runCommand(spawnSyncFn, command, args, options = {}) {
  const result = spawnSyncFn(command, args, { encoding: 'utf8', ...options }) || {};
  const ok = !result.error && result.status === 0;
  return {
    ok,
    text: ok ? String(result.stdout || '') : '',
    reason: result.error
      ? String(result.error.message || result.error)
      : `${command} ${args.join(' ')} exited ${result.status === undefined ? 'unknown' : result.status}`,
  };
}

/**
 * Grade a scan whose PASS means "looked and found nothing".
 *
 * @param {{ok: boolean, text: string, reason: string}} result
 * @param {(text: string) => string[]} findMatches
 * @returns {{status: 'PASS'|'FAIL'|'PENDING', detail: string, output: string}}
 */
function gradeScan(result, findMatches) {
  if (!result || !result.ok) {
    const reason = (result && result.reason) || 'command did not run';
    return { status: 'PENDING', detail: `NOT EVALUATED: ${reason}`, output: reason };
  }
  const matches = findMatches(result.text) || [];
  return matches.length > 0
    ? { status: 'FAIL', detail: `${matches.length} secret-like lines found`, output: matches.join('\n') }
    : { status: 'PASS', detail: 'no secret patterns found', output: '' };
}

/**
 * Grade "is the worktree clean", where unreadable is not clean.
 *
 * @param {{ok: boolean, text: string, reason: string}} result
 * @returns {{status: 'PASS'|'PENDING', detail: string, output: string}}
 */
function gradeWorktreeStatus(result) {
  if (!result || !result.ok) {
    const reason = (result && result.reason) || 'command did not run';
    return { status: 'PENDING', detail: `NOT EVALUATED: ${reason}`, output: reason };
  }
  const dirty = result.text.trim();
  return dirty
    ? { status: 'PENDING', detail: 'worktree has source changes', output: result.text }
    : { status: 'PASS', detail: 'worktree clean', output: '(clean)' };
}

module.exports = { runCommand, gradeScan, gradeWorktreeStatus };
