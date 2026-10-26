'use strict';

/**
 * Two things the research export could not do before, guarded here.
 *
 * 1. THE TWO RENDERERS AGREEING ON WHAT A NESTED FIELD IS. The CSV renderer
 *    and the Excel renderer each flatten `summary.dme_mie` into label/value
 *    rows, and each used to carry its own list of the object-valued fields it
 *    had to skip. The lists drifted the day `snapshot_freshness` and
 *    `baseline_pair` were added — only the CSV list learned about them — and
 *    the workbook wrote both objects into a value cell as a JSON blob. The
 *    fix is one shared constant, so the invariant to guard is that neither
 *    renderer has a private copy again.
 *
 * 2. THE CHECKSUM BEING RECOMPUTABLE. A checksum is worth nothing unless a
 *    reader with the file and the documented recipe gets the same hex string
 *    back. That means it must ignore everything that changes between two
 *    exports of the same rows (the export timestamp, the order object keys
 *    happen to come back in, Date objects vs. the ISO strings they become in
 *    the JSON file) and must change when any exported row changes.
 *
 * DB-free by construction: every function under test is pure over an
 * already-built payload, so the fixtures below are payloads, not queries.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  DME_MIE_NESTED_FIELDS,
  RESEARCH_EXPORT_FORMAT_VERSION,
  RESEARCH_CHECKSUM_SECTIONS,
  idListCell,
  canonicalJson,
  researchDataChecksum,
  buildResearchProvenance,
} = require('../src/routes/admin.routes')._test;

const ROUTE_FILE = path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js');
const ROUTE_SRC = fs.readFileSync(ROUTE_FILE, 'utf8');

/**
 * Strips block and line comments so the rules below can be described in prose
 * next to the code without the prose tripping the assertion — the same reason
 * researchIntegrityGuard.unit.test.js does it.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const CODE = stripComments(ROUTE_SRC);

/** The stretch of code that follows a marker, for anchoring a rule to one renderer. */
function after(marker, chars = 700) {
  const at = CODE.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return CODE.slice(at, at + chars);
}

/**
 * The shape `summary.dme_mie` really has: scalars, four object-valued fields
 * and the notes block. Only the keys matter to these tests, but the values are
 * realistic so a reader can see which ones are objects.
 */
const dmeMie = () => ({
  data_completeness_pct: 80,
  parent_coverage_pct: 60,
  total_audit_actions: 12,
  total_exports: 3,
  role_adoption: { driver_actions: 4, school_actions: 8 },
  stakeholder_satisfaction: null,
  baseline_snapshot_id: 11,
  baseline_date: '2021-01-01',
  current_snapshot_id: 12,
  current_date: '2021-02-01',
  delta: { data_completeness: null, insurance_coverage: 30 },
  snapshot_freshness: {
    has_snapshot: true, fresh: false, latest_snapshot_date: '2021-02-01',
    age_days: 900, max_age_days: 7, reason: 'snapshot_stale',
  },
  baseline_pair: { usable: false, reason: 'research_protocol_not_frozen', gap_days: 31 },
  _notes: { dme: 'computed from snapshots', delta: 'null, never 0' },
});

const payload = () => ({
  // Shaped like the real thing: the route puts the readiness verdict inside
  // meta, so a fixture without it would let the coverage assertions pass while
  // proving nothing about the field that actually matters.
  meta: {
    generated_at: '2026-09-08T01:00:00.000Z',
    generated_by: 'admin',
    date_range: { from: '2021-01-01', to: '2021-02-01' },
    included: ['snapshots', 'audit_logs', 'summary'],
    format_version: RESEARCH_EXPORT_FORMAT_VERSION,
    evidence_readiness: {
      snapshot_freshness: { fresh: false, reason: 'snapshot_stale' },
      baseline_pair: { usable: false, reason: 'research_protocol_not_frozen' },
      research_claims_allowed: false,
    },
    research_claims_allowed: false,
    readiness_note: 'ชุดข้อมูลนี้เป็นหลักฐานเชิงระบบ ไม่ใช่ผลการวิจัย',
  },
  snapshots: [
    { id: 11, snapshot_date: '2021-01-01', is_baseline: 1, total_students: 0 },
    { id: 12, snapshot_date: '2021-02-01', is_baseline: 0, total_students: 100 },
  ],
  audit_logs: [
    { id: 501, action: 'LOGIN', created_at: '2021-01-05T02:00:00.000Z' },
    { id: 540, action: 'EXPORT', created_at: '2021-01-30T02:00:00.000Z' },
  ],
  summary: { counts: { snapshot_count: 2 }, dme_mie: dmeMie() },
  data_dictionary: { schema_version: '1.0', metrics: [{ key: 'school.data_completeness_rate' }] },
});

const sumOf = (p) => researchDataChecksum(p).data_checksum;

describe('one shared list of nested summary fields', () => {
  it('declares the list exactly once', () => {
    expect(CODE.match(/const DME_MIE_NESTED_FIELDS = new Set\(/g)).toHaveLength(1);
  });

  it('has no second, private list in either renderer', () => {
    // The two shapes the private copies took: a local Set, and an inline
    // chain of === comparisons against the same field names.
    expect(CODE).not.toMatch(/const NESTED = new Set\(/);
    expect(CODE).not.toMatch(/k === '_notes'/);
    expect(CODE).not.toMatch(/k === 'role_adoption'/);
  });

  it('is what the CSV renderer skips on', () => {
    expect(after("'\\n=== DME Metrics ===\\n'")).toMatch(/if \(DME_MIE_NESTED_FIELDS\.has\(k\)\) continue;/);
  });

  it('is what the Excel renderer skips on', () => {
    expect(after("'--- DME Metrics ---'")).toMatch(/if \(DME_MIE_NESTED_FIELDS\.has\(k\)\) continue;/);
  });

  it('names every object-valued field of dme_mie, and nothing else', () => {
    const objectFields = Object.entries(dmeMie())
      .filter(([, v]) => v !== null && typeof v === 'object')
      .map(([k]) => k)
      .sort();
    expect(objectFields).toEqual([...DME_MIE_NESTED_FIELDS].sort());
    // The two the Excel list was missing, named so a future removal is loud.
    expect(DME_MIE_NESTED_FIELDS.has('snapshot_freshness')).toBe(true);
    expect(DME_MIE_NESTED_FIELDS.has('baseline_pair')).toBe(true);
  });

  it('states baseline_pair in words on both readiness surfaces instead of as a blob', () => {
    expect(CODE).toContain('baseline_pair_usable');
    expect(CODE).toContain('baseline_pair_reason');
    expect(CODE.match(/baseline_pair_usable/g)).toHaveLength(2); // CSV and workbook
  });
});

describe('the checksum is stable for the same data', () => {
  it('gives the same value twice for the same rows', () => {
    expect(sumOf(payload())).toBe(sumOf(payload()));
  });

  it('ignores the order the keys arrive in', () => {
    const shuffled = payload();
    shuffled.snapshots = shuffled.snapshots.map((r) => ({
      total_students: r.total_students, is_baseline: r.is_baseline,
      snapshot_date: r.snapshot_date, id: r.id,
    }));
    expect(sumOf(shuffled)).toBe(sumOf(payload()));
  });

  it('ignores the export timestamp and who ran it', () => {
    // This is the property that makes the checksum checkable at all: the same
    // rows exported an hour later by a different admin must still hash alike.
    const later = payload();
    later.meta.generated_at = '2027-01-01T00:00:00.000Z';
    later.meta.generated_by = 'someone_else';
    expect(sumOf(later)).toBe(sumOf(payload()));
    // `meta` as a whole is never a covered section; the specific claim fields
    // inside it are gathered under `meta_claims` instead.
    expect(researchDataChecksum(payload()).covered_sections).not.toContain('meta');
  });

  it('covers the claim that the dataset may be cited as research', () => {
    // The reason meta is not excluded wholesale. `research_claims_allowed` is
    // the single most consequential statement in the file, and it is exactly
    // what someone would edit. Flipping it must break the checksum.
    const tampered = payload();
    tampered.meta.research_claims_allowed = !tampered.meta.research_claims_allowed;
    expect(sumOf(tampered)).not.toBe(sumOf(payload()));
  });

  it('covers the readiness block the claim is derived from', () => {
    const tampered = payload();
    tampered.meta.evidence_readiness = { ...tampered.meta.evidence_readiness, tampered: true };
    expect(sumOf(tampered)).not.toBe(sumOf(payload()));
  });

  it('names which meta fields it covered, so a reader can rebuild them', () => {
    const integrity = researchDataChecksum(payload());
    expect(integrity.covered_meta_fields).toContain('research_claims_allowed');
    expect(integrity.covered_meta_fields).toContain('evidence_readiness');
    expect(integrity.covered_meta_fields).not.toContain('generated_at');
    expect(integrity.covered_meta_fields).not.toContain('generated_by');
    expect(integrity.covered_meta_fields).not.toContain('integrity');
  });

  it('ignores the data dictionary, which describes the numbers rather than being one', () => {
    const redescribed = payload();
    redescribed.data_dictionary.metrics = [{ key: 'something.else' }];
    expect(sumOf(redescribed)).toBe(sumOf(payload()));
    expect(researchDataChecksum(payload()).covered_sections).not.toContain('data_dictionary');
  });

  it('reads a Date the same as the ISO string it becomes in the JSON file', () => {
    // The route hashes mysql2 Date objects; a reader re-hashing the downloaded
    // file has only the ISO strings JSON.stringify wrote. If those two
    // disagreed, no exported file could ever be re-verified.
    const withDates = payload();
    withDates.audit_logs = withDates.audit_logs.map((r) => ({ ...r, created_at: new Date(r.created_at) }));
    expect(sumOf(withDates)).toBe(sumOf(payload()));
  });
});

describe('the checksum changes when the data does', () => {
  it('notices one edited number', () => {
    const edited = payload();
    edited.snapshots[1].total_students = 101;
    expect(sumOf(edited)).not.toBe(sumOf(payload()));
  });

  it('notices a deleted row', () => {
    const trimmed = payload();
    trimmed.audit_logs = trimmed.audit_logs.slice(0, 1);
    expect(sumOf(trimmed)).not.toBe(sumOf(payload()));
  });

  it('notices a reordered row, because row order is part of the data', () => {
    const reordered = payload();
    reordered.snapshots = [reordered.snapshots[1], reordered.snapshots[0]];
    expect(sumOf(reordered)).not.toBe(sumOf(payload()));
  });

  it('notices a rewritten summary number', () => {
    const inflated = payload();
    inflated.summary.dme_mie.delta.insurance_coverage = 99;
    expect(sumOf(inflated)).not.toBe(sumOf(payload()));
  });

  it('distinguishes a section that was not requested from one that came back empty', () => {
    const empty = payload();
    empty.export_evidence = [];
    expect(sumOf(empty)).not.toBe(sumOf(payload()));
  });
});

describe('the documented recipe is the one that was used', () => {
  it('matches a hash computed by hand from the canonical text', () => {
    const one = { snapshots: [{ snapshot_date: '2021-01-01', id: 2 }] };
    const canonical = '{"snapshots":[{"id":2,"snapshot_date":"2021-01-01"}]}';
    expect(canonicalJson(one)).toBe(canonical);
    expect(researchDataChecksum(one).data_checksum)
      .toBe(crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });

  it('recomputes from the payload the way the comment tells a reader to', () => {
    const p = payload();
    const integrity = researchDataChecksum(p);
    const covered = {};
    for (const s of integrity.covered_sections) {
      if (s === 'meta_claims') continue;
      covered[s] = p[s];
    }
    if (integrity.covered_meta_fields.length) {
      covered.meta_claims = {};
      for (const f of integrity.covered_meta_fields) covered.meta_claims[f] = p.meta[f];
    }
    expect(crypto.createHash('sha256').update(canonicalJson(covered), 'utf8').digest('hex'))
      .toBe(integrity.data_checksum);
  });

  it('names the algorithm, the covered sections and how to canonicalise', () => {
    const integrity = researchDataChecksum(payload());
    expect(integrity.algorithm).toBe('sha256');
    expect(integrity.data_checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(integrity.canonicalisation).toMatch(/sorted/);
    expect(integrity.note).toMatch(/sha256/);
    // Only the sections this export actually carried, in the declared order,
    // followed by the meta claims gathered under their own key.
    expect(integrity.covered_sections).toEqual([
      ...RESEARCH_CHECKSUM_SECTIONS.filter((s) => s !== 'export_evidence'),
      'meta_claims',
    ]);
  });

  it('is recorded in the EXPORT audit row, not only inside the file it describes', () => {
    expect(after('action: \'EXPORT\', entityType: \'research_dataset\'')).toMatch(/data_checksum: integrity\.data_checksum/);
  });
});

describe('provenance says where the numbers came from', () => {
  const opts = { from: '2021-01-01', to: '2021-02-01', include: ['snapshots', 'audit', 'summary'] };
  const prov = () => buildResearchProvenance(payload(), opts);

  it('echoes the window that was asked for', () => {
    expect(prov().date_range).toEqual({ from: '2021-01-01', to: '2021-02-01' });
    expect(prov().requested_sections).toEqual(opts.include);
  });

  it('names the snapshot ids rather than only counting them', () => {
    expect(prov().snapshots.ids).toEqual([11, 12]);
    expect(prov().snapshots.baseline_ids).toEqual([11]);
    expect(prov().snapshots.row_count).toBe(2);
    expect(prov().snapshots.first_snapshot_date).toBe('2021-01-01');
    expect(prov().snapshots.last_snapshot_date).toBe('2021-02-01');
  });

  it('reads a snapshot date on the Bangkok calendar, not a day early', () => {
    // mysql2 hands back a DATE column as the instant 2021-01-31T17:00Z for
    // 2021-02-01 Bangkok; an ISO slice would report the 31st.
    const p = payload();
    p.snapshots[1].snapshot_date = new Date('2021-01-31T17:00:00.000Z');
    expect(buildResearchProvenance(p, opts).snapshots.last_snapshot_date).toBe('2021-02-01');
  });

  it('separates a section nobody asked for from one that returned no rows', () => {
    expect(prov().export_evidence).toEqual({
      included: false, row_count: null, first_id: null, last_id: null,
    });
    const p = payload();
    p.export_evidence = [];
    expect(buildResearchProvenance(p, opts).export_evidence).toEqual({
      included: true, row_count: 0, first_id: null, last_id: null,
    });
  });

  it('bounds the audit rows by id so a later reader can re-select them', () => {
    expect(prov().audit_logs).toEqual({
      included: true, row_count: 2, first_id: 501, last_id: 540,
    });
  });

  it('names the snapshot pair every delta was measured between', () => {
    expect(prov().computed_from).toEqual({
      baseline_snapshot_id: 11, baseline_date: '2021-01-01',
      current_snapshot_id: 12, current_date: '2021-02-01',
    });
  });

  it('keeps the id list inside a cell a spreadsheet can hold', () => {
    // A default export spans every snapshot ever taken, so the list grows by
    // one id a day. Excel rejects a cell over 32,767 characters outright, and
    // an unopenable workbook is worse evidence than a summarised cell — the
    // full list is in the JSON either way.
    expect(idListCell([11, 12])).toBe('11 | 12');
    expect(idListCell([])).toBe('');
    expect(idListCell(null)).toBe('');
    const many = Array.from({ length: 9000 }, (_, i) => i + 1);
    const cell = idListCell(many);
    expect(cell.length).toBeLessThan(32767);
    expect(cell).toContain('1');
    expect(cell).toContain('9000');
  });

  it('can be re-derived from the rows the checksum covers', () => {
    // Provenance lives in meta and is therefore outside the checksum. That is
    // safe only because it is a function of the covered rows, so a reader can
    // recompute it and catch an edited provenance block.
    const p = payload();
    expect(buildResearchProvenance(p, opts).snapshots.ids).toEqual(p.snapshots.map((s) => s.id));
  });
});

describe('the integrity block claims nothing about readiness', () => {
  it('carries no readiness verdict of its own', () => {
    const integrity = researchDataChecksum(payload());
    const provenance = buildResearchProvenance(
      payload(), { from: '2021-01-01', to: '2021-02-01', include: [] }
    );
    // A checksum says the rows are unedited. It says nothing about whether they
    // may be reported as research, and must never look as if it does.
    //
    // Naming `research_claims_allowed` in covered_meta_fields is NOT such a
    // claim — it is the opposite, a statement that the verdict is protected
    // from tampering, and a reader needs the name to recompute the hash. What
    // is forbidden is carrying a VALUE for it. So the list of covered field
    // names is set aside and everything else is checked.
    const { covered_meta_fields: covered, ...rest } = integrity;
    expect(covered).toContain('research_claims_allowed');
    const text = JSON.stringify({ integrity: rest, provenance });
    expect(text).not.toMatch(/research_claims_allowed|dme_mie_ready|"ready"/);
    // And the value itself never appears anywhere in the block, under any key.
    expect(JSON.stringify(integrity)).not.toMatch(/"research_claims_allowed"\s*:\s*(true|false)/);
  });

  it('versions the payload shape from one constant, written into every format', () => {
    expect(RESEARCH_EXPORT_FORMAT_VERSION).toMatch(/^\d+\.\d+$/);
    expect(CODE).toContain('format_version: RESEARCH_EXPORT_FORMAT_VERSION');
    expect(CODE).not.toMatch(/format_version: '3\.0'/);
    // CSV and workbook both print the version they were rendered at.
    expect(CODE.match(/format_version/g).length).toBeGreaterThanOrEqual(4);
  });
});
