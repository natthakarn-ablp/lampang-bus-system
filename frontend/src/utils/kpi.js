/**
 * Shared KPI utilities for report pages.
 * Ensures consistent formatting, colors, and labels across
 * MonthlyReport and SummaryReport.
 *
 * Semantic state mapping (do not change without UX review):
 *   not-started → neutral (ink-muted)   — value is null / NaN / undefined
 *   risk        → warn (≥85%)
 *   good        → success (≥95%)
 *   critical    → danger (rest of the numeric range, i.e. has-data-but-low)
 *
 * "0.0% before any operations have happened" must read as neutral, not
 * critical. We can't tell from the percentage alone whether 0 means
 * "nothing has started" or "everything has failed" — but null/NaN means
 * the denominator was zero, which is the not-started signal.
 */

/** KPI text color class by threshold. Neutral when value is missing. */
// KPI percentages render as text on white cards and table cells, so they use
// the `-ink` tones. The vivid DEFAULT tones measured 2.54 / 2.15 / 3.76 : 1 on
// white — all under the WCAG AA 4.5:1 floor. The ink tones are 5.48 / 7.09 /
// 6.47 and keep the same hue.
export function kpiColor(v) {
  if (v == null || !isFinite(v)) return 'text-ink-muted';
  if (v >= 95) return 'text-success-ink';
  if (v >= 85) return 'text-warn-ink';
  return 'text-danger-ink';
}

/** Safe percentage display — returns "-" for null/NaN/Infinity/zero-denom. */
export function safePct(v) {
  if (v == null || !isFinite(v)) return '-';
  return v.toFixed(1) + '%';
}

/** Variant key (for StatusBadge / KPIStat / etc.) by KPI threshold. */
export function kpiVariant(v) {
  if (v == null || !isFinite(v)) return 'neutral';
  if (v >= 95) return 'success';
  if (v >= 85) return 'warn';
  return 'danger';
}

/** Level badge (ดีมาก / ดี / เฝ้าระวัง / ยังไม่เริ่ม) from morning + evening KPI. */
export function levelBadge(morningKpi, eveningKpi) {
  const mMissing = morningKpi == null || !isFinite(morningKpi);
  const eMissing = eveningKpi == null || !isFinite(eveningKpi);
  // `variant` feeds StatusBadge; `cls` is kept for the print view, which does
  // not use components. Both now carry the AA-passing text tone.
  if (mMissing && eMissing) return { label: 'ยังไม่เริ่ม', variant: 'neutral', cls: 'bg-surface text-ink-muted' };
  const avg = ((morningKpi ?? 0) + (eveningKpi ?? 0)) / 2;
  if (avg >= 95) return { label: 'ดีมาก',     variant: 'success', cls: 'bg-success-soft text-success-ink' };
  if (avg >= 85) return { label: 'ดี',        variant: 'warn',    cls: 'bg-warn-soft text-warn-ink' };
  return            { label: 'เฝ้าระวัง',  variant: 'danger',  cls: 'bg-danger-soft text-danger-ink' };
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
