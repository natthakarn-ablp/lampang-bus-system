'use strict';

/**
 * Snapshot-derived fields for the research export (`summary.dme_mie`).
 *
 * WHY THIS EXISTS (metric-dictionary.md §7, closure handoff 2026-09-05 §2 #2 and #4)
 * ---------------------------------------------------------------------------------
 * `/api/admin/research-export` shipped eight percentages and six deltas that were
 * computed inline in the route, with two problems the project's own tooling
 * caught:
 *
 *   1. `calcDelta()` substituted 0% for a side whose denominator was 0, so a
 *      baseline with no students and a current snapshot at 85% reported
 *      "+85 percentage points" — a number that reads as improvement and is
 *      actually "no baseline". The registry's own missing-data rules for the
 *      metrics involved say the opposite (researchMetrics.js: "total_students
 *      = 0 ให้รายงาน null ห้ามรายงาน 0%", "ตัวส่วน 0 ให้รายงาน null"). The
 *      percentages already obeyed that rule; the deltas did not.
 *
 *   2. Four of the percentages (`parent_coverage_pct`, `insurance_coverage_pct`,
 *      `inspection_coverage_pct`, `inspection_pass_pct`) matched no metric in
 *      the registry at all, so they left the system with no formula,
 *      denominator or missing-data rule attached — numbers without a
 *      definition, in a dataset whose data dictionary claims to define
 *      everything it exports.
 *
 * This module is the single definition of those fields. The route computes
 * from it, the JSON/CSV/Excel data dictionaries describe from it, and a unit
 * test checks that the route no longer carries its own copy. It deliberately
 * does NOT add the four unregistered fields to `METRICS`: the registry is the
 * frozen list of 24 research metrics (4 per role, asserted in tests), and a
 * coverage percentage nobody has defined a research claim for is a
 * descriptive statistic, not a metric. It is labelled as such here so the
 * export can say so, rather than promoted to look like one.
 *
 * Rules, in one place:
 *   - A percentage with a zero, missing or non-numeric denominator is null.
 *   - A delta is null when EITHER side's percentage is null. Never 0.
 *   - Rounding is to two decimals, matching the previous route behaviour.
 */

const { getMetric, METRIC_CATEGORIES } = require('../config/researchMetrics');

/** Category label for a field that is exported but is not a research metric. */
const DESCRIPTIVE_STATISTIC = 'descriptive_statistic';

const NOT_IN_REGISTRY =
  'ไม่มี metric ใน registry (researchMetrics.js) — เป็นสถิติเชิงบรรยายจาก snapshot ' +
  'ห้ามใช้เป็นผลวิจัยหรือ KPI จนกว่าจะมีนิยาม key/formula/instrument ใน registry';

/**
 * Every snapshot-derived field the export publishes, in export order.
 *
 * `delta_key` names the entry in `summary.dme_mie.delta`; null means the field
 * is reported for the latest snapshot only (no baseline comparison).
 * `registry_metric` is the registry key this field is the system-side reading
 * of, or null when there is none — in which case `note` says so.
 */
const SNAPSHOT_DERIVED_FIELDS = Object.freeze([
  {
    key: 'data_completeness_pct',
    delta_key: 'data_completeness',
    title_th: 'สัดส่วนนักเรียนที่มีรถ',
    numerator: 'students_with_vehicle',
    denominator: 'total_students',
    missing_data_rule: 'total_students = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: 'school.data_completeness_rate',
    note: null,
  },
  {
    key: 'parent_coverage_pct',
    delta_key: 'parent_coverage',
    title_th: 'สัดส่วนนักเรียนที่มีผู้ปกครองผูกในระบบ',
    numerator: 'students_with_parent',
    denominator: 'total_students',
    missing_data_rule: 'total_students = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: null,
    note: NOT_IN_REGISTRY,
  },
  {
    key: 'insurance_coverage_pct',
    delta_key: 'insurance_coverage',
    title_th: 'สัดส่วนรถที่มีประกัน',
    numerator: 'vehicles_with_insurance',
    denominator: 'total_vehicles',
    missing_data_rule: 'total_vehicles = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: null,
    note: NOT_IN_REGISTRY,
  },
  {
    key: 'inspection_coverage_pct',
    delta_key: 'inspection_coverage',
    title_th: 'สัดส่วนรถที่ถูกตรวจสภาพ',
    numerator: 'vehicles_inspected',
    denominator: 'total_vehicles',
    missing_data_rule: 'total_vehicles = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: null,
    note: NOT_IN_REGISTRY,
  },
  {
    key: 'inspection_pass_pct',
    delta_key: null,
    title_th: 'สัดส่วนรถที่ผ่านการตรวจ (ต่อรถทั้งหมด)',
    numerator: 'vehicles_passed',
    denominator: 'total_vehicles',
    missing_data_rule: 'total_vehicles = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: null,
    note:
      NOT_IN_REGISTRY +
      ' · ตัวหารคือรถทั้งหมด ไม่ใช่รถที่ถูกตรวจ จึงไม่ใช่ "อัตราผ่านการตรวจ" ' +
      'ถ้าต้องการอัตราผ่านต้องใช้ vehicles_passed / vehicles_inspected ซึ่งยังไม่มีในชุดนี้',
  },
  {
    key: 'morning_completion_pct',
    delta_key: 'morning_completion',
    title_th: 'สัดส่วนรอบเช้าที่เช็กอินครบ',
    numerator: 'morning_done',
    denominator: 'morning_total',
    missing_data_rule: 'morning_total = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: 'driver.completion_consistency',
    note: 'registry รวมเช้า+เย็นเป็นค่าเดียว ฟิลด์นี้แยกรอบ จึงเป็นส่วนประกอบของ metric ไม่ใช่ตัว metric',
  },
  {
    key: 'evening_completion_pct',
    delta_key: 'evening_completion',
    title_th: 'สัดส่วนรอบเย็นที่เช็กอินครบ',
    numerator: 'evening_done',
    denominator: 'evening_total',
    missing_data_rule: 'evening_total = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: 'driver.completion_consistency',
    note: 'registry รวมเช้า+เย็นเป็นค่าเดียว ฟิลด์นี้แยกรอบ จึงเป็นส่วนประกอบของ metric ไม่ใช่ตัว metric',
  },
  {
    key: 'active_user_pct',
    delta_key: null,
    title_th: 'สัดส่วนผู้ใช้ที่ active',
    numerator: 'active_users',
    denominator: 'total_users',
    missing_data_rule: 'total_users = 0 ให้รายงาน null ห้ามรายงาน 0%',
    registry_metric: 'admin.active_account_rate',
    note: null,
  },
]);

/**
 * numerator / denominator × 100, to two decimals — or null.
 *
 * Null, not 0, whenever the value cannot be computed: a zero or negative
 * denominator, a missing side, or a non-numeric value. "0%" is a finding;
 * "null" is the absence of one, and the two must not be confused.
 */
function pctOf(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return Math.round((n / d) * 10000) / 100;
}

/** Percentage-point difference, or null when either side is null. */
function deltaOf(baselinePct, latestPct) {
  if (baselinePct == null || latestPct == null) return null;
  return Math.round((latestPct - baselinePct) * 100) / 100;
}

/**
 * Delta for one field between two snapshot rows. Kept with the signature the
 * route used to have so the call sites read the same; the behaviour on a zero
 * denominator is the part that changed (null, was 0).
 */
function calcDelta(baseline, latest, numField, denField) {
  if (!baseline || !latest) return null;
  return deltaOf(pctOf(baseline[numField], baseline[denField]), pctOf(latest[numField], latest[denField]));
}

/** All `_pct` fields for one snapshot row; every value null when there is no row. */
function snapshotPercentages(snapshot) {
  const out = {};
  for (const f of SNAPSHOT_DERIVED_FIELDS) {
    out[f.key] = snapshot ? pctOf(snapshot[f.numerator], snapshot[f.denominator]) : null;
  }
  return out;
}

/** The delta block, or null when there is no baseline/latest pair to compare. */
function snapshotDeltas(baseline, latest) {
  if (!baseline || !latest) return null;
  const out = {};
  for (const f of SNAPSHOT_DERIVED_FIELDS) {
    if (!f.delta_key) continue;
    out[f.delta_key] = calcDelta(baseline, latest, f.numerator, f.denominator);
  }
  return out;
}

/**
 * Dictionary rows for the export. Each row carries enough to be read on its
 * own: formula, both sides of the fraction, the missing-data rule, and — where
 * one exists — the registry metric it reads for, with that metric's category.
 * A field with no registry metric is labelled `descriptive_statistic`.
 */
function derivedFieldDictionary() {
  return SNAPSHOT_DERIVED_FIELDS.map((f) => {
    const metric = f.registry_metric ? getMetric(f.registry_metric) : null;
    return {
      key: f.key,
      delta_key: f.delta_key,
      title_th: f.title_th,
      formula: `daily_snapshots.${f.numerator} / daily_snapshots.${f.denominator} × 100`,
      numerator: `daily_snapshots.${f.numerator}`,
      denominator: `daily_snapshots.${f.denominator}`,
      missing_data_rule: f.missing_data_rule,
      delta_rule: f.delta_key
        ? 'ผลต่างเป็น percentage point ระหว่าง baseline กับ latest · ถ้าฝั่งใดฝั่งหนึ่งเป็น null ให้ delta เป็น null ห้ามแทนด้วย 0'
        : 'ไม่มี delta — รายงานเฉพาะ snapshot ล่าสุด',
      registry_metric: f.registry_metric,
      registry_title_th: metric ? metric.title_th : null,
      category: metric ? metric.category : DESCRIPTIVE_STATISTIC,
      note: f.note,
    };
  });
}

module.exports = {
  SNAPSHOT_DERIVED_FIELDS,
  DESCRIPTIVE_STATISTIC,
  METRIC_CATEGORIES,
  pctOf,
  deltaOf,
  calcDelta,
  snapshotPercentages,
  snapshotDeltas,
  derivedFieldDictionary,
};
