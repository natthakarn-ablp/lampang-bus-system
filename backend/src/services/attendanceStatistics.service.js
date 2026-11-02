'use strict';
const { outcome } = require('../utils/attendanceOutcome');

// Scope SQL is supplied only by report.service.buildScopeFilter, never from a
// request. Keep identifiers internal; only aggregate counts leave this service.
async function readLedger(pool, { where, params, start, end }) {
  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.school_id, s.vehicle_id, sc.affiliation_id,
            sl.leave_date AS check_date, sl.session, sl.attendance_kind,
            COALESCE(sl.morning_enabled_snapshot, s.morning_enabled) AS morning_enabled,
            COALESCE(sl.evening_enabled_snapshot, s.evening_enabled) AS evening_enabled,
            ds.morning_done, ds.evening_done
       FROM student_leaves sl
       JOIN students s ON s.id = sl.student_id JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = sl.leave_date
      WHERE ${where} AND sl.cancelled = FALSE AND sl.leave_date >= ? AND sl.leave_date < ?
     UNION ALL
     SELECT NULL, s.school_id, s.vehicle_id, sc.affiliation_id, ds.check_date,
            'both', 'BUS_DATE', NULL, NULL, SUM(ds.morning_done), SUM(ds.evening_done)
       FROM daily_status ds
       JOIN students s ON s.id = ds.student_id JOIN schools sc ON sc.id = s.school_id
      WHERE ${where} AND ds.check_date >= ? AND ds.check_date < ?
      GROUP BY s.school_id, s.vehicle_id, sc.affiliation_id, ds.check_date`,
    [...params, start, end, ...params, start, end]);
  return rows;
}

function calendar(value) {
  return value instanceof Date ? require('../utils/thaiTime').toBangkokDate(value) : String(value).slice(0, 10);
}

function totals(rows) {
  const result = { days: new Set() };
  for (const session of ['morning', 'evening']) {
    result[`${session}_bus`] = 0;
    for (const kind of ['self', 'leave', 'conflict']) {
      result[`${session}_${kind}`] = 0;
      result[`${session}_${kind}_people`] = new Set();
    }
  }
  const grouped = new Map();
  for (const row of rows) {
    result.days.add(calendar(row.check_date));
    if (row.attendance_kind === 'BUS_DATE') {
      for (const session of ['morning', 'evening']) result[`${session}_bus`] += Number(row[`${session}_done`] || 0);
      continue;
    }
    for (const session of ['morning', 'evening']) {
      if (!row[`${session}_enabled`] || ![session, 'both'].includes(row.session)) continue;
      const key = JSON.stringify([calendar(row.check_date), row.student_id, session]);
      if (!grouped.has(key)) grouped.set(key, { session, id: row.student_id, kinds: new Set(), bus: false });
      const item = grouped.get(key);
      item.kinds.add(row.attendance_kind);
      item.bus ||= !!row[`${session}_done`];
    }
  }
  for (const item of grouped.values()) {
    const kind = outcome({ enabled: true, busDone: item.bus, kinds: [...item.kinds] }).toLowerCase();
    result[`${item.session}_${kind}`]++;
    result[`${item.session}_${kind}_people`].add(String(item.id));
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value instanceof Set ? value.size : value]));
}

function decorateRow(row, ledger, monthly = false) {
  const stats = totals(ledger);
  const result = { ...row, ...stats };
  const days = Math.max(stats.days, Number(row.days_with_data || 0));
  if (monthly) result.days_with_data = days;
  for (const session of ['morning', 'evening']) {
    if (`${session}_done` in row) result[`${session}_done`] = stats[`${session}_bus`];
    if (`total_${session}_done` in row) result[`total_${session}_done`] = stats[`${session}_bus`];
    const excluded = stats[`${session}_self`] + stats[`${session}_leave`];
    const totalKey = `${session}_total`;
    const expectedKey = `${session}_expected`;
    if (monthly) {
      const registered = Number(row[expectedKey] ?? 0);
      result[`total_${session}_expected`] = Math.max(0, registered * days - excluded);
      result[`days_${session}_100`] = 0;
      for (const date of new Set(ledger.map(item => calendar(item.check_date)))) {
        const dayRows = ledger.filter(item => calendar(item.check_date) === date);
        const dayStats = totals(dayRows);
        const dayExpected = registered - dayStats[`${session}_self`] - dayStats[`${session}_leave`];
        const dayDone = dayRows.filter(item => item.attendance_kind === 'BUS_DATE').reduce((sum, item) => sum + Number(item[`${session}_done`] || 0), 0);
        if (dayExpected > 0 && !dayStats[`${session}_conflict`] && dayDone >= dayExpected) result[`days_${session}_100`]++;
      }
      const done = Number(result[`total_${session}_done`] ?? 0);
      result[`${session}_kpi`] = stats[`${session}_conflict`] || !result[`total_${session}_expected`] ? null
        : Math.round(done / result[`total_${session}_expected`] * 10000) / 100;
    } else {
      for (const key of [totalKey, expectedKey]) {
        if (key in row) {
          result[`${session}_registered`] = Number(row[`${session}_registered`] ?? row[key]);
          result[key] = Math.max(0, result[`${session}_registered`] - excluded);
          result[`${session}_pending`] = Math.max(0, result[key] - Number(result[`${session}_done`] || 0));
        }
      }
      const denominator = result[totalKey] ?? result[expectedKey];
      if (`${session}_kpi` in row && denominator != null) result[`${session}_kpi`] = !denominator || stats[`${session}_conflict`] ? null
        : Math.round(Number(result[`${session}_done`] || 0) / denominator * 10000) / 100;
    }
  }
  delete result.days;
  return result;
}

function decorateDaily(report, ledger) {
  const result = decorateRow(report, ledger);
  for (const [key, id] of [['schools', 'school_id'], ['vehicles', 'vehicle_id'], ['affiliations', 'affiliation_id']]) {
    if (report[key]) result[key] = report[key].map(row => decorateRow(row, ledger.filter(item => String(item[id]) === String(row[id] ?? row.id))));
  }
  return result;
}

function decorateMonthly(report, ledger) {
  const result = decorateRow(report, ledger, true);
  const dates = new Set(ledger.map(row => calendar(row.check_date)));
  const trend = new Map((report.daily_trend || []).filter(row => dates.has(calendar(row.date))).map(row => [calendar(row.date), row]));
  for (const row of ledger) if (!trend.has(calendar(row.check_date))) trend.set(calendar(row.check_date), { date: calendar(row.check_date), morning_done: 0, evening_done: 0 });
  result.daily_trend = [...trend.values()].sort((a, b) => calendar(a.date).localeCompare(calendar(b.date))).map(row => {
    const day = decorateRow({ ...row, morning_expected: report.morning_expected, evening_expected: report.evening_expected }, ledger.filter(item => calendar(item.check_date) === calendar(row.date)));
    for (const session of ['morning', 'evening']) day[`${session}_pct`] = !day[`${session}_expected`] || day[`${session}_conflict`] ? null : Math.round(Number(day[`${session}_done`] || 0) / day[`${session}_expected`] * 10000) / 100;
    return day;
  });
  for (const [key, id] of [['schools', 'school_id'], ['vehicles', 'vehicle_id']]) {
    if (report[key]) result[key] = report[key].map(row => decorateRow(row, ledger.filter(item => String(item[id]) === String(row[id] ?? row.id)), true));
  }
  return result;
}

module.exports = { readLedger, totals, decorateRow, decorateDaily, decorateMonthly };
