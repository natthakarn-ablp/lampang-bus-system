/**
 * Shared KPI utilities for report pages.
 * Ensures consistent formatting, colors, and labels across
 * MonthlyReport and SummaryReport.
 */

/** KPI text color class by threshold. */
export function kpiColor(v) {
  if (v >= 95) return 'text-green-600';
  if (v >= 85) return 'text-yellow-600';
  return 'text-red-600';
}

/** Safe percentage display — returns "-" for null/NaN/Infinity/zero-denom. */
export function safePct(v) {
  if (v == null || !isFinite(v)) return '-';
  return v.toFixed(1) + '%';
}

/** Level badge (ดีมาก / ดี / เฝ้าระวัง) from average of morning + evening KPI. */
export function levelBadge(morningKpi, eveningKpi) {
  const avg = ((morningKpi ?? 0) + (eveningKpi ?? 0)) / 2;
  if (avg >= 95) return { label: 'ดีมาก', cls: 'bg-green-100 text-green-700' };
  if (avg >= 85) return { label: 'ดี', cls: 'bg-yellow-100 text-yellow-700' };
  return { label: 'เฝ้าระวัง', cls: 'bg-red-100 text-red-700' };
}

/** Top N items sorted descending by key. */
export function topN(arr, key, n = 5) {
  return [...arr].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, n);
}

/** Bottom N items sorted ascending by key. */
export function bottomN(arr, key, n = 5) {
  return [...arr].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0)).slice(0, n);
}

/** Sort by combined morning + evening KPI descending. */
export function sortByKpi(arr) {
  return [...arr].sort((a, b) =>
    ((b.morning_kpi ?? 0) + (b.evening_kpi ?? 0)) - ((a.morning_kpi ?? 0) + (a.evening_kpi ?? 0))
  );
}
