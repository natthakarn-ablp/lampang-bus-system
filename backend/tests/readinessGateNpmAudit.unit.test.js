'use strict';

/**
 * The npm audit check in scripts/production-readiness-gate.sh.
 *
 * The bug this locks down: the gate captured `npm audit --json` into a file and
 * then decided PASS/FAIL without ever reading it, so "you have a critical CVE",
 * "the registry was unreachable" and "the audit was clean" all collapsed into
 * one verdict. Reading only the report is not enough either - npm can exit
 * non-zero for reasons unrelated to the vulnerability count and still leave a
 * `total: 0` report behind, and calling that PASS claims dependencies were
 * checked when they were not.
 *
 * `npm` is stubbed with a shell function rather than a file on PATH: a function
 * is inherited by the subshell the gate runs the audit in, and it sidesteps
 * PATH translation between Windows and the msys shell entirely.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GATE_SCRIPT = posix(path.join(REPO_ROOT, 'scripts', 'production-readiness-gate.sh'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lampang-readiness-'));

const CLEAN_REPORT = JSON.stringify({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});
const VULNERABLE_REPORT = JSON.stringify({
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0, total: 3 } },
});
const REGISTRY_ERROR_REPORT = JSON.stringify({
  auditReportVersion: 2,
  error: { code: 'ENETUNREACH', summary: 'request to https://registry.npmjs.org failed' },
});

/**
 * Bare `bash` on this platform can resolve to a WSL stub that is not usable
 * here, so probe the same candidates the readiness collector probes.
 */
function findBash() {
  const candidates = [process.env.BASH, 'bash', 'C:\\Program Files\\Git\\bin\\bash.exe'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return '';
}

const BASH = findBash();

function posix(value) {
  return String(value).replace(/\\/g, '/');
}

function runCheck({ report, exitCode, outPath, dir }) {
  const script = [
    'npm() { printf "%s" "${FAKE_AUDIT_JSON:-}"; return "${FAKE_AUDIT_EXIT:-0}"; }',
    'READINESS_GATE_LIB_ONLY=1 . "$1"',
    'check_npm_audit "dependency audit" "$2" "$3"',
    'echo "COUNTS pass=$PASS warn=$WARN fail=$FAIL"',
  ].join('\n');

  const result = spawnSync(
    BASH,
    ['-c', script, 'gate-test', GATE_SCRIPT, dir === undefined ? posix(TMP) : dir, outPath],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_AUDIT_JSON: report === undefined ? CLEAN_REPORT : report,
        FAKE_AUDIT_EXIT: String(exitCode === undefined ? 0 : exitCode),
      },
    },
  );

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const counts = output.match(/COUNTS pass=(\d+) warn=(\d+) fail=(\d+)/);
  return {
    output,
    pass: counts ? Number(counts[1]) : -1,
    warn: counts ? Number(counts[2]) : -1,
    fail: counts ? Number(counts[3]) : -1,
  };
}

const describeIfBash = BASH ? describe : describe.skip;

afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describeIfBash('production-readiness-gate.sh check_npm_audit', () => {
  test('exit 0 with total=0 is the only combination that passes', () => {
    const result = runCheck({
      report: CLEAN_REPORT,
      exitCode: 0,
      outPath: posix(path.join(TMP, 'clean.json')),
    });

    expect(result.output).toContain('[pass] dependency audit clean total=0');
    expect(result.output).not.toContain('NOT EVALUATED');
    expect(result).toMatchObject({ pass: 1, warn: 0, fail: 0 });
  });

  test('a report with vulnerabilities fails, which is what makes the gate exit 1', () => {
    const result = runCheck({
      report: VULNERABLE_REPORT,
      exitCode: 1,
      outPath: posix(path.join(TMP, 'vulnerable.json')),
    });

    expect(result.output).toContain('[fail] dependency audit vulnerable total=3');
    expect(result.output).toContain('high=2');
    expect(result).toMatchObject({ pass: 0, warn: 0, fail: 1 });
  });

  test('a clean report from a failed npm run is NOT EVALUATED, never a pass', () => {
    const result = runCheck({
      report: CLEAN_REPORT,
      exitCode: 1,
      outPath: posix(path.join(TMP, 'clean-but-failed.json')),
    });

    expect(result.output).toContain('NOT EVALUATED');
    expect(result.output).toContain('exited 1');
    expect(result.output).not.toContain('[pass]');
    expect(result).toMatchObject({ pass: 0, warn: 1, fail: 0 });
  });

  test('vulnerabilities fail even when npm exits 0', () => {
    const result = runCheck({
      report: VULNERABLE_REPORT,
      exitCode: 0,
      outPath: posix(path.join(TMP, 'vulnerable-exit0.json')),
    });

    expect(result.output).toContain('[fail] dependency audit vulnerable total=3');
    expect(result).toMatchObject({ pass: 0, warn: 0, fail: 1 });
  });

  test('unparsable JSON is NOT EVALUATED', () => {
    const result = runCheck({
      report: 'npm ERR! code ENETUNREACH\nnot json at all',
      exitCode: 1,
      outPath: posix(path.join(TMP, 'invalid.json')),
    });

    expect(result.output).toContain('NOT EVALUATED');
    expect(result).toMatchObject({ pass: 0, warn: 1, fail: 0 });
  });

  test('an empty report is NOT EVALUATED', () => {
    const result = runCheck({
      report: '',
      exitCode: 1,
      outPath: posix(path.join(TMP, 'empty.json')),
    });

    expect(result.output).toContain('NOT EVALUATED');
    expect(result).toMatchObject({ pass: 0, warn: 1, fail: 0 });
  });

  test('valid JSON without metadata.vulnerabilities is NOT EVALUATED', () => {
    const result = runCheck({
      report: REGISTRY_ERROR_REPORT,
      exitCode: 1,
      outPath: posix(path.join(TMP, 'registry-error.json')),
    });

    expect(result.output).toContain('NOT EVALUATED');
    expect(result).toMatchObject({ pass: 0, warn: 1, fail: 0 });
  });

  test('a report file that could not be written at all is NOT EVALUATED', () => {
    const result = runCheck({
      report: CLEAN_REPORT,
      exitCode: 0,
      outPath: posix(path.join(TMP, 'no-such-directory', 'audit.json')),
    });

    expect(result.output).toContain('NOT EVALUATED');
    expect(result.output).not.toContain('[pass]');
    expect(result).toMatchObject({ pass: 0, warn: 1, fail: 0 });
  });

  test('an output path containing spaces still evaluates', () => {
    const spacedDir = path.join(TMP, 'evidence dir with spaces');
    fs.mkdirSync(spacedDir, { recursive: true });
    const outPath = posix(path.join(spacedDir, 'audit out.json'));

    const result = runCheck({ report: CLEAN_REPORT, exitCode: 0, outPath });

    expect(result.output).toContain('[pass] dependency audit clean total=0');
    expect(result).toMatchObject({ pass: 1, warn: 0, fail: 0 });
    expect(fs.existsSync(path.join(spacedDir, 'audit out.json'))).toBe(true);
  });

  test('a backslash-separated output path still evaluates', () => {
    // On Windows this is a native `C:\...\dir with spaces\file` path handed to
    // an msys shell; elsewhere it is a filename that literally contains a
    // backslash. Both are cases the old path-argument handoff could mangle.
    const backslashDir = path.join(TMP, 'backslash case');
    fs.mkdirSync(backslashDir, { recursive: true });
    const outPath = process.platform === 'win32'
      ? path.join(backslashDir, 'audit win.json')
      : `${backslashDir}/audit\\win.json`;

    const result = runCheck({ report: CLEAN_REPORT, exitCode: 0, outPath });

    expect(result.output).toContain('[pass] dependency audit clean total=0');
    expect(result).toMatchObject({ pass: 1, warn: 0, fail: 0 });
  });

  test('the audit working directory may contain spaces', () => {
    const workDir = path.join(TMP, 'project dir with spaces');
    fs.mkdirSync(workDir, { recursive: true });

    const result = runCheck({
      report: CLEAN_REPORT,
      exitCode: 0,
      outPath: posix(path.join(TMP, 'spaced-workdir.json')),
      dir: posix(workDir),
    });

    expect(result.output).toContain('[pass] dependency audit clean total=0');
    expect(result).toMatchObject({ pass: 1, warn: 0, fail: 0 });
  });

  test('cleanup removes both audit reports and both .err sidecars', () => {
    const files = [
      path.join(TMP, 'cleanup-backend.json'),
      path.join(TMP, 'cleanup-backend.json.err'),
      path.join(TMP, 'cleanup-frontend.json'),
      path.join(TMP, 'cleanup-frontend.json.err'),
    ];
    for (const file of files) fs.writeFileSync(file, 'x');

    const script = [
      'READINESS_GATE_LIB_ONLY=1 . "$1"',
      'TMP_BACKEND_AUDIT="$2"',
      'TMP_FRONTEND_AUDIT="$3"',
      'cleanup',
    ].join('\n');

    const result = spawnSync(
      BASH,
      ['-c', script, 'gate-test', GATE_SCRIPT, posix(files[0]), posix(files[2])],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    for (const file of files) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  test('the library-only guard cannot make an executed gate exit 0 having run nothing', () => {
    const result = spawnSync(BASH, [GATE_SCRIPT, 'public'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, READINESS_GATE_LIB_ONLY: '1', BASE_URL: 'http://127.0.0.1:1' },
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(output).toContain('refusing to run');
    expect(output).not.toContain('[gate] summary');
    expect(result.status).toBe(2);
  });

  test('the gate exits 1 when any check fails', () => {
    // Read-only: five HTTP probes against a closed local port, so every check
    // fails and the run exercises the summary/exit contract that turns a failed
    // npm audit into a non-zero gate.
    const result = spawnSync(BASH, [GATE_SCRIPT, 'public'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, BASE_URL: 'http://127.0.0.1:1' },
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(output).toMatch(/\[gate\] summary pass=\d+ warn=\d+ fail=[1-9]/);
    expect(result.status).toBe(1);
  }, 60000);
});
