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

/**
 * Every run of text a user could actually read: quoted literals plus the text
 * between JSX tags. The rule below has to be decided per string rather than on
 * a window of source, otherwise a denial on a neighbouring line would excuse a
 * badge on this one — which is exactly how the frontend registry kept its
 * 'พร้อมวัด' badge while the file around it talked about evidence.
 */
function readableStrings(text) {
  const src = stripComments(text);
  const out = [];
  const quoted = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const jsxText = />([^<>{}]+)</g;
  let m;
  while ((m = quoted.exec(src)) !== null) out.push(m[0]);
  while ((m = jsxText.exec(src)) !== null) out.push(m[1]);
  return out;
}

/**
 * The claim this guard exists to prevent: text telling a reader that a research
 * metric can now be measured, evaluated or reported. The alternation sits on
 * the verb after "พร้อม" so a reworded version of the same claim is caught too,
 * not only the two spellings the audit happened to find — 'พร้อมประเมิน' in
 * EvaluationDashboard and 'พร้อมวัด' in the frontend measurement registry.
 * Vehicle and deployment wording ('พร้อมใช้งาน') is a different claim, derived
 * from inspection records, and is deliberately not in this list.
 */
const MEASUREMENT_READY_CLAIM =
  /พร้อม(?:วัด|ประเมิน|รายงานผล|สรุปผล|เผยแพร่|ตีความ|อ้างอิงผล|ใช้เป็นผล)|วัดได้(?:ครบ|ทั้งหมด|แล้ว|บางส่วน)|ready\s+to\s+(?:measure|evaluate|report)/i;

/**
 * The phrase may still be written down while being denied — the pages that
 * replaced the old heuristic explain in Thai that action counts are not the
 * criterion, and that sentence has to name what it is denying.
 */
const DENIAL = /ไม่ใช่|ยังไม่|ห้าม|\bnot\b|\bnever\b/i;

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

describe('no hardcoded research readiness in the UI', () => {
  const uiFiles = readAll(walk(FRONTEND_SRC, ['.jsx', '.js']));

  it('actually has frontend source to scan', () => {
    // A guard that walks an empty tree passes forever. If the frontend moves,
    // this fails loudly instead of the rules below going quiet.
    expect(uiFiles.length).toBeGreaterThan(100);
  });

  it('does not award a positive readiness label from a raw action total', () => {
    // The original: `if (total >= 20) return { label: 'พร้อมประเมิน' ... }`
    const offenders = uiFiles.filter((f) => {
      const src = stripComments(f.text);
      return /(total|actions?\.total|\bt\b)\s*>=\s*\d+/.test(src) && MEASUREMENT_READY_CLAIM.test(src);
    });
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('never presents a measurement-readiness verdict as text a user reads', () => {
    // Scoped to every readable string in frontend/src, not to a list of pages:
    // the backend was cleaned up first and the claim simply reappeared in a
    // second registry nobody was watching (frontend/src/config/
    // measurementFramework.js, rendered on /admin/measurement).
    const offenders = [];
    for (const f of uiFiles) {
      for (const s of readableStrings(f.text)) {
        if (MEASUREMENT_READY_CLAIM.test(s) && !DENIAL.test(s)) {
          offenders.push(`${f.file}: ${s.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never takes a readiness value from a literal in frontend source', () => {
    // Readiness is a function of evidence only the server can see, so a
    // readiness value written into a source file is wrong whatever it says —
    // including a value that sounds cautious. This is the assertion that would
    // have caught `readiness: 'ready'` without depending on its Thai label.
    const offenders = uiFiles.filter((f) => /\breadiness\b\s*[:=]\s*['"`]/.test(stripComments(f.text)));
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

  it('keeps the measurement plan page labelled as a plan, not a verdict', () => {
    // The registry stays in the tree because it is the design record of what
    // the project intends to measure. It is only honest while the page saying
    // so, and pointing at the page that does show derived readiness, stays put.
    const page = uiFiles.find((f) => f.file.endsWith('MeasurementFramework.jsx'));
    expect(page).toBeDefined();
    expect(page.text).toMatch(/ไม่ใช่ความพร้อมของระบบ/);
    expect(page.text).toContain('/admin/evaluation');

    const config = uiFiles.find((f) => f.file.endsWith('measurementFramework.js'));
    expect(config).toBeDefined();
    expect(stripComments(config.text)).not.toMatch(/READINESS/);
  });

  /**
   * The rule above catches the identifier `readiness`. That is not enough on its
   * own: the field was renamed to `data_basis` when the page was corrected, so a
   * guard that only watches the old spelling now watches a word nothing uses,
   * and `data_basis: 'ready'` would sail past it. What has to hold is the
   * PROPERTY — that this registry describes what data a metric would need, and
   * never announces that a metric is ready — so that is what is asserted.
   */
  it('the measurement plan describes what data is needed, never a verdict', () => {
    const config = uiFiles.find((f) => f.file.endsWith('measurementFramework.js'));
    const src = stripComments(config.text);

    // Only the data-basis vocabulary, not every labelled map in the file: the
    // source labels (SL, AL, …) are abbreviations of where a number comes from
    // and have nothing to do with readiness.
    const block = src.match(/PROPOSED_DATA_BASIS\s*=\s*\{([\s\S]*?)\n\};/);
    expect(block).not.toBeNull();

    // Every value the registry assigns must come from the declared vocabulary.
    const vocabulary = [...block[1].matchAll(/^\s*(\w+):\s*\{\s*label:/gm)].map((m) => m[1]);
    expect(vocabulary.length).toBeGreaterThanOrEqual(4);
    const used = [...new Set([...src.matchAll(/data_basis:\s*'([^']+)'/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(0);
    for (const v of used) expect(vocabulary).toContain(v);

    // And no term in that vocabulary may read as a verdict about readiness.
    // These are the words a future edit would reach for.
    const VERDICT_WORDS = /\b(ready|complete|verified|validated|approved|passed)\b/i;
    const VERDICT_THAI = /(พร้อมวัด|พร้อมประเมิน|พร้อมใช้|ผ่านแล้ว|ครบแล้ว|รับรองแล้ว)/;
    for (const term of vocabulary) expect(term).not.toMatch(VERDICT_WORDS);

    // Each label must announce itself as a plan. The prefix is what stops a
    // label drifting from "this metric needs a baseline" into "this metric is
    // fine", which is the same failure in a different vocabulary.
    const labels = [...block[1].matchAll(/^\s*\w+:\s*\{\s*label:\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(labels.length).toBe(vocabulary.length);
    for (const label of labels) {
      expect(label.startsWith('ตามแผน:')).toBe(true);
      expect(label).not.toMatch(VERDICT_THAI);
      expect(label).not.toMatch(VERDICT_WORDS);
    }
  });
});
