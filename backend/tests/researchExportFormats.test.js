'use strict';

/**
 * The research export, exercised end to end in all three formats against a
 * baseline/latest pair built to hit the missing-data rule.
 *
 * WHAT THIS PROVES (closure handoff 2026-09-05 §2, items 2, 3 and 4)
 * ------------------------------------------------------------------
 *   2. A delta whose baseline denominator is 0 is null in the JSON, an empty
 *      cell in the CSV, and a labelled "null" row in the workbook — never 0,
 *      and never the whole current value dressed up as improvement.
 *   3. The CSV and the Excel workbook carry evidence readiness and the data
 *      dictionary, as the JSON already did. Before this, a spreadsheet copy
 *      of the dataset had no way to say which of its numbers were defined.
 *   4. Every `_pct` field in summary.dme_mie has a row in
 *      data_dictionary.derived_fields, with formula, denominator and
 *      missing-data rule, and the four fields with no registry metric are
 *      labelled descriptive_statistic rather than passed off as metrics.
 *
 * FIXTURE
 * -------
 * Two `daily_snapshots` rows in January–February 2021 — a range no other
 * suite uses and comfortably in the past, so the route's own date filter
 * selects exactly these two. The baseline deliberately has
 * total_students = 0 and morning_total = 0 so two deltas must be null while
 * the others are numbers. Both rows are tagged in `research_phase` and
 * deleted by that tag, never by date alone.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { SNAPSHOT_DERIVED_FIELDS } = require('../src/utils/researchSnapshotFields');

const TAG = '__test_export_formats';
const ADMIN_USER = '__test_admin_export_formats';
const FROM = '2021-01-01';
const TO = '2021-02-01';

let token = null;
let adminId = null;

const BASELINE = {
  snapshot_date: FROM, is_baseline: 1, run_type: 'baseline',
  total_students: 0, students_with_vehicle: 0, students_with_parent: 0,
  total_vehicles: 10, vehicles_with_insurance: 5, vehicles_inspected: 4, vehicles_passed: 2,
  morning_total: 0, morning_done: 0, evening_total: 20, evening_done: 10,
  active_users: 5, total_users: 10,
};
const LATEST = {
  snapshot_date: TO, is_baseline: 0, run_type: 'manual',
  total_students: 100, students_with_vehicle: 80, students_with_parent: 60,
  total_vehicles: 10, vehicles_with_insurance: 8, vehicles_inspected: 9, vehicles_passed: 7,
  morning_total: 50, morning_done: 40, evening_total: 20, evening_done: 15,
  active_users: 6, total_users: 10,
};

async function insertSnapshot(row) {
  const cols = Object.keys(row);
  await pool.query(
    `INSERT INTO daily_snapshots (${cols.join(', ')}, scope_type, scope_id, research_phase, baseline_note)
     VALUES (${cols.map(() => '?').join(', ')}, 'system', NULL, ?, ?)`,
    [...cols.map((c) => row[c]), TAG, TAG]
  );
}

async function removeFixture() {
  await pool.query('DELETE FROM daily_snapshots WHERE research_phase = ?', [TAG]);
  if (adminId) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ?', [adminId]);
    await pool.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
  }
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', 'admin', ?)
     ON DUPLICATE KEY UPDATE role = 'admin', is_active = TRUE, is_deleted = FALSE`,
    [ADMIN_USER, ADMIN_USER]
  );
  const [[u]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [ADMIN_USER]);
  adminId = u.id;
  // Signed rather than logged in: loginLimiter is 20/15min/IP with no test skip.
  token = jwt.sign(
    { sub: adminId, username: ADMIN_USER, role: 'admin', scopeType: null, scopeId: null,
      gradeScope: null, displayName: ADMIN_USER, mustChangePassword: false },
    env.jwt.secret, { expiresIn: '1h' }
  );
  await pool.query('DELETE FROM daily_snapshots WHERE research_phase = ?', [TAG]);
  await insertSnapshot(BASELINE);
  await insertSnapshot(LATEST);
});

afterAll(async () => {
  await removeFixture();
});

const QUERY = `?from=${FROM}&to=${TO}&include=snapshots,summary`;
const get = (extra = '') => request(app)
  .get(`/api/admin/research-export${QUERY}${extra}`)
  .set('Authorization', `Bearer ${token}`);

// supertest only buffers text/* and json; the workbook has to be collected by hand.
const asBuffer = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('JSON', () => {
  let dme;
  let dictionary;

  beforeAll(async () => {
    const res = await get();
    expect(res.status).toBe(200);
    dme = res.body.data.summary.dme_mie;
    dictionary = res.body.data.data_dictionary;
  });

  it('computes the percentages from the latest snapshot', () => {
    expect(dme.data_completeness_pct).toBe(80);
    expect(dme.parent_coverage_pct).toBe(60);
    expect(dme.insurance_coverage_pct).toBe(80);
    expect(dme.inspection_coverage_pct).toBe(90);
    expect(dme.inspection_pass_pct).toBe(70);
    expect(dme.morning_completion_pct).toBe(80);
    expect(dme.evening_completion_pct).toBe(75);
    expect(dme.active_user_pct).toBe(60);
  });

  it('reports null, not 0 and not +80, for a delta whose baseline denominator is zero', () => {
    expect(dme.delta).toEqual({
      data_completeness: null,   // baseline total_students = 0 → would have read +80
      parent_coverage: null,     // same denominator → would have read +60
      insurance_coverage: 30,    // 50 → 80
      inspection_coverage: 50,   // 40 → 90
      morning_completion: null,  // baseline morning_total = 0 → would have read +80
      evening_completion: 25,    // 50 → 75
    });
    expect(dme._notes.delta).toMatch(/null/);
  });

  it('describes every _pct field it exports, and labels the unregistered four', () => {
    const exported = Object.keys(dme).filter((k) => k.endsWith('_pct')).sort();
    const described = dictionary.derived_fields.map((f) => f.key).sort();
    expect(described).toEqual(exported);
    expect(exported).toEqual(SNAPSHOT_DERIVED_FIELDS.map((f) => f.key).sort());

    const byKey = Object.fromEntries(dictionary.derived_fields.map((f) => [f.key, f]));
    for (const key of ['parent_coverage_pct', 'insurance_coverage_pct', 'inspection_coverage_pct', 'inspection_pass_pct']) {
      expect(byKey[key].registry_metric).toBeNull();
      expect(byKey[key].category).toBe('descriptive_statistic');
      expect(byKey[key].missing_data_rule).toMatch(/null/);
    }
    expect(byKey.data_completeness_pct.registry_metric).toBe('school.data_completeness_rate');
    expect(dictionary.categories.descriptive_statistic).toMatch(/ห้ามใช้เป็นผลวิจัย/);
    // The 24 registry metrics are still there, unchanged in number.
    expect(dictionary.metrics).toHaveLength(24);
  });
});

describe('CSV', () => {
  let csv;

  beforeAll(async () => {
    const res = await get('&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    csv = res.text;
  });

  it('carries readiness, a delta section and both dictionary tables', () => {
    expect(csv).toContain('=== Evidence Readiness ===');
    expect(csv).toContain('=== Delta From Baseline (percentage points) ===');
    expect(csv).toContain('=== Data Dictionary (metrics) ===');
    expect(csv).toContain('=== Data Dictionary (snapshot-derived fields in dme_mie) ===');
  });

  it('writes a null delta as an empty cell, not 0', () => {
    expect(csv).toMatch(/^data_completeness,$/m);
    expect(csv).toMatch(/^morning_completion,$/m);
    expect(csv).toMatch(/^insurance_coverage,30$/m);
    expect(csv).toMatch(/^evening_completion,25$/m);
  });

  it('lists every registry metric and every derived field with its missing-data rule', () => {
    const [, metricsAndAfter] = csv.split('=== Data Dictionary (metrics) ===\n');
    const [metricsTable, derivedTable] = metricsAndAfter.split('=== Data Dictionary (snapshot-derived fields in dme_mie) ===\n');
    const metricRows = metricsTable.trim().split('\n').slice(1);
    expect(metricRows).toHaveLength(24);
    expect(metricRows.every((r) => /null|ตัด|แยก|ไม่นับ|ห้าม|ต้อง/.test(r))).toBe(true);
    const derivedRows = derivedTable.trim().split('\n').slice(1);
    expect(derivedRows).toHaveLength(SNAPSHOT_DERIVED_FIELDS.length);
    expect(derivedRows.filter((r) => r.includes('descriptive_statistic'))).toHaveLength(4);
  });
});

describe('Excel', () => {
  let wb;
  const sheet = (name) => wb.getWorksheet(name);
  const rowsOf = (ws) => {
    const out = [];
    ws.eachRow((row) => out.push(row.values.slice(1)));
    return out;
  };

  beforeAll(async () => {
    const res = await get('&format=excel').buffer(true).parse(asBuffer);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
  });

  it('has readiness and dictionary sheets alongside the data sheets', () => {
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ['Snapshots', 'Summary', 'Evidence Readiness', 'Readiness by Metric', 'Data Dictionary']) {
      expect(names).toContain(n);
    }
  });

  it('states readiness rather than leaving it to the JSON', () => {
    const rows = rowsOf(sheet('Evidence Readiness'));
    const labels = rows.map((r) => r[0]);
    expect(labels).toEqual(expect.arrayContaining(['research_claims_allowed', 'blocking_reasons', 'snapshot_fresh', 'protocol_frozen']));
    const claims = rows.find((r) => r[0] === 'research_claims_allowed');
    // Nobody has frozen a protocol or signed off in the test database.
    expect(claims[1]).toBe('false');
    expect(rowsOf(sheet('Readiness by Metric'))).toHaveLength(1 + 24);
  });

  it('carries one dictionary row per metric and per derived field', () => {
    const rows = rowsOf(sheet('Data Dictionary'));
    expect(rows[0]).toEqual(expect.arrayContaining(['kind', 'key', 'formula', 'denominator', 'missing_data_rule']));
    const body = rows.slice(1);
    expect(body.filter((r) => r[0] === 'metric')).toHaveLength(24);
    expect(body.filter((r) => r[0] === 'derived')).toHaveLength(SNAPSHOT_DERIVED_FIELDS.length);
  });

  it('shows a zero-denominator delta as "null", never as 0', () => {
    const rows = rowsOf(sheet('Summary'));
    const value = (label) => (rows.find((r) => r[0] === label) || [])[1];
    expect(String(value('delta.data_completeness'))).toMatch(/^null/);
    expect(String(value('delta.morning_completion'))).toMatch(/^null/);
    expect(value('delta.insurance_coverage')).toBe(30);
    expect(value('delta.evening_completion')).toBe(25);
  });
});
