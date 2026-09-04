'use strict';

/**
 * Source-level guard against the two research-integrity regressions the
 * 2026-09-04 audit found. Both were single lines that looked harmless in a
 * diff: a constant `true`, and a `>= 20` threshold. A unit test on behaviour
 * would not have caught either, because both were the behaviour.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function readAll(files) {
  return files.map((f) => ({ file: path.relative(REPO_ROOT, f), text: fs.readFileSync(f, 'utf8') }));
}

/** Strips block and line comments so a rule can be described without tripping it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no hardcoded research readiness', () => {
  const backendFiles = readAll(walk(BACKEND_SRC, ['.js']));

  it('has no dme_mie_ready constant anywhere in backend source', () => {
    // Comments still name it, deliberately — the point is that no code emits it.
    const hits = backendFiles.filter((f) => /dme_mie_ready/.test(stripComments(f.text)));
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it('exports readiness as a derived structure, not a literal boolean', () => {
    const routeFile = backendFiles.find((f) => f.file.endsWith(path.join('routes', 'admin.routes.js').replace(/\\/g, path.sep)))
      || backendFiles.find((f) => f.file.includes('admin.routes.js'));
    expect(routeFile).toBeDefined();
    expect(routeFile.text).toContain('buildEvidenceReadiness');
    // A `research_claims_allowed: true` literal would reintroduce the bug
    // under a new name.
    expect(stripComments(routeFile.text)).not.toMatch(/research_claims_allowed:\s*true/);
  });

  it('never asserts a frozen protocol from code alone', () => {
    const protocolFile = backendFiles.find((f) => f.file.includes('researchProtocol.js'));
    expect(protocolFile).toBeDefined();
    const src = stripComments(protocolFile.text);
    expect(src).toMatch(/frozen:\s*false/);
    expect(src).toMatch(/research_lead_signed_off:\s*false/);
    expect(src).not.toMatch(/frozen:\s*true/);
    expect(src).not.toMatch(/research_lead_signed_off:\s*true/);
  });
});

describe('no action-count readiness heuristic in the UI', () => {
  const uiFiles = readAll(walk(FRONTEND_SRC, ['.jsx', '.js']));

  it('does not award a positive readiness label from a raw action total', () => {
    // The original: `if (total >= 20) return { label: 'พร้อมประเมิน' ... }`
    const offenders = uiFiles.filter((f) => {
      const src = stripComments(f.text);
      return /(total|actions?\.total|\bt\b)\s*>=\s*\d+/.test(src) && /พร้อมประเมิน/.test(src);
    });
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('does not render "พร้อมประเมิน" as a status label', () => {
    // The phrase may still appear in a sentence that explains it is NOT the
    // criterion; what must not come back is a status label or badge value.
    const offenders = uiFiles.filter((f) => {
      const src = stripComments(f.text);
      return /label:\s*'พร้อมประเมิน'/.test(src)
        || /return\s*'พร้อมประเมิน'/.test(src)
        || /label="พร้อมประเมิน"/.test(src);
    });
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('reads role status from server-computed evidence coverage', () => {
    const pages = ['EvaluationDashboard.jsx', 'ExecutiveSummary.jsx', 'ExecutivePrint.jsx'];
    for (const page of pages) {
      const file = uiFiles.find((f) => f.file.endsWith(page));
      expect(file).toBeDefined();
      expect(file.text).toContain('evidence_readiness');
      expect(file.text).toContain('roleEvidenceMeta');
    }
  });
});
