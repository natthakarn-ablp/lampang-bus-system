#!/usr/bin/env node
'use strict';

/**
 * deploy-ci-gate.js — OPS-001 (2026-11-08)
 *
 * Answers one question for scripts/deploy-backend.sh: did the "Full Quality"
 * workflow pass for EXACTLY this commit on this branch?
 *
 *   node deploy-ci-gate.js --sha <40-hex> --branch <name>
 *        [--repo owner/name] [--workflow "Full Quality"]
 *
 * Exit 0 = allow, 2 = refuse (CI pending / failed / cancelled / not found),
 * 3 = cannot check (API unreachable, rate-limited, unauthorised, bad answer).
 * Anything but 0 must stop the deploy; there is no "allow on error".
 *
 * Which run counts. Full Quality runs on `push` (every branch) and on
 * `pull_request`. A pull_request run tests GitHub's temporary merge ref, not a
 * commit that exists on the branch, so it is NOT evidence for a deploy. Only a
 * `push` run whose head_sha is the target SHA, on the target branch, in this
 * repository, tested the exact tree that will be deployed. If several such runs
 * exist (a re-push of the same commit), the most recent one decides; a run that
 * is still in progress after an earlier success means "wait", not "allow".
 *
 * Network/credentials. The repository is public, so the GitHub REST API needs
 * no token; DEPLOY_CI_TOKEN_FILE may name a file holding a read-only token
 * (Actions: read) to avoid the anonymous rate limit. The token is sent in the
 * Authorization header only and is never printed. DEPLOY_CI_API overrides the
 * API base (tests only), DEPLOY_CI_TIMEOUT_MS bounds the request (default 15s).
 */

const fs = require('fs');

const DEFAULT_REPO = 'natthakarn-ablp/lampang-bus-system';
const DEFAULT_WORKFLOW = 'Full Quality';
const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

// Pure decision over the API's workflow_runs. Returns { decision, reason, run }.
function evaluateRuns(runs, { sha, branch, repo, workflow }) {
  const matching = (Array.isArray(runs) ? runs : []).filter((r) => r
    && r.name === workflow
    && r.event === 'push'
    && r.head_sha === sha
    && r.head_branch === branch
    && r.repository && r.repository.full_name === repo);
  if (!matching.length) {
    return { decision: 'refuse', reason: `no "${workflow}" push run found for ${sha} on ${branch} — push it and wait for CI, or check the SHA` };
  }
  matching.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || (b.id || 0) - (a.id || 0));
  const run = matching[0];
  const ref = `run ${run.id}${run.run_attempt > 1 ? ` attempt ${run.run_attempt}` : ''}`;
  if (run.status !== 'completed') {
    return { decision: 'refuse', reason: `"${workflow}" ${ref} for ${sha.slice(0, 7)} is ${run.status} — wait until it completes`, run };
  }
  if (run.conclusion !== 'success') {
    return { decision: 'refuse', reason: `"${workflow}" ${ref} for ${sha.slice(0, 7)} concluded ${run.conclusion || 'without a conclusion'} — fix and re-run CI first`, run };
  }
  return { decision: 'allow', reason: `"${workflow}" ${ref} for ${sha.slice(0, 7)} on ${branch}: success`, run };
}

async function checkCi({ sha, branch, repo = DEFAULT_REPO, workflow = DEFAULT_WORKFLOW, token = null,
  apiBase = 'https://api.github.com', timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (!SHA_RE.test(String(sha || ''))) return { decision: 'error', reason: 'target must be a full 40-character lowercase commit SHA' };
  if (!BRANCH_RE.test(String(branch || ''))) return { decision: 'error', reason: 'branch name missing or invalid' };
  if (!REPO_RE.test(String(repo || ''))) return { decision: 'error', reason: 'repository must be owner/name' };
  if (typeof fetchImpl !== 'function') return { decision: 'error', reason: 'this Node has no fetch (Node 18+ required)' };

  const url = `${String(apiBase).replace(/\/+$/, '')}/repos/${repo}/actions/runs`
    + `?head_sha=${sha}&event=push&branch=${encodeURIComponent(branch)}&per_page=100`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'lampang-deploy-ci-gate' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: ac.signal });
  } catch (err) {
    return { decision: 'error', reason: err && err.name === 'AbortError'
      ? `GitHub API did not answer within ${timeoutMs} ms`
      : `GitHub API unreachable (${(err && err.code) || (err && err.message) || 'network error'})` };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    const limited = res.headers && typeof res.headers.get === 'function' && res.headers.get('x-ratelimit-remaining') === '0';
    return { decision: 'error', reason: limited
      ? 'GitHub API rate limit reached — wait, or set DEPLOY_CI_TOKEN_FILE to a read-only token'
      : `GitHub API refused the request (HTTP ${res.status}) — check DEPLOY_CI_TOKEN_FILE permissions (Actions: read)` };
  }
  if (res.status === 404) return { decision: 'error', reason: `repository ${repo} not found or not visible to this token (HTTP 404)` };
  if (!res.ok) return { decision: 'error', reason: `GitHub API answered HTTP ${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { decision: 'error', reason: 'GitHub API answer was not JSON' }; }
  if (!body || !Array.isArray(body.workflow_runs)) return { decision: 'error', reason: 'GitHub API answer has no workflow_runs list' };
  return evaluateRuns(body.workflow_runs, { sha, branch, repo, workflow });
}

function readToken(file) {
  if (!file) return { token: null };
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (!t) return { error: `DEPLOY_CI_TOKEN_FILE ${file} is empty` };
    return { token: t };
  } catch (err) {
    return { error: `cannot read DEPLOY_CI_TOKEN_FILE ${file} (${err.code || 'error'})` };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !k.startsWith('--') || v === undefined) return { error: `bad argument near '${k || ''}'` };
    out[k.slice(2)] = v;
  }
  return out;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.error) { console.error(`[ci-gate] ERROR: ${args.error}`); return 3; }
  const tok = readToken(env.DEPLOY_CI_TOKEN_FILE);
  if (tok.error) { console.error(`[ci-gate] ERROR: ${tok.error}`); return 3; }
  const result = await checkCi({
    sha: args.sha, branch: args.branch,
    repo: args.repo || env.DEPLOY_CI_REPO || DEFAULT_REPO,
    workflow: args.workflow || env.DEPLOY_CI_WORKFLOW || DEFAULT_WORKFLOW,
    token: tok.token,
    apiBase: env.DEPLOY_CI_API || 'https://api.github.com',
    timeoutMs: Number(env.DEPLOY_CI_TIMEOUT_MS) > 0 ? Number(env.DEPLOY_CI_TIMEOUT_MS) : 15000,
  });
  if (result.decision === 'allow') { console.log(`[ci-gate] ALLOW: ${result.reason}`); return 0; }
  if (result.decision === 'refuse') { console.error(`[ci-gate] REFUSE: ${result.reason}`); return 2; }
  console.error(`[ci-gate] CANNOT CHECK: ${result.reason}`);
  return 3;
}

module.exports = { evaluateRuns, checkCi, main, DEFAULT_REPO, DEFAULT_WORKFLOW };

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`[ci-gate] CANNOT CHECK: unexpected error (${err && err.message})`);
    process.exitCode = 3;
  });
}
