/**
 * KpiCard — displays a percentage KPI with color thresholds.
 *
 * Props:
 *   label    — card title (Thai)
 *   pct      — percentage value (0–100)
 *   detail   — detail text e.g. "230/240"
 *   sub      — optional subtitle e.g. "ครบ 100% จำนวน 18 วัน"
 */
export default function KpiCard({ label, pct, detail, sub }) {
  const raw = Number(pct);
  const value = Number.isFinite(raw) ? raw : 0;
  const color =
    value >= 95   ? 'success' :
    value >= 85   ? 'warn'    :
    value > 0     ? 'danger'  :
                    'ink-muted';

  const colors = {
    success:   'bg-success-soft  border-success/20  text-success',
    warn:      'bg-warn-soft     border-warn/20     text-warn',
    danger:    'bg-danger-soft   border-danger/20   text-danger',
    'ink-muted': 'bg-surface    border-surface-border text-ink-muted',
  };

  const barColors = {
    success:   'bg-success',
    warn:      'bg-warn',
    danger:    'bg-danger',
    'ink-muted': 'bg-ink-muted',
  };

  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value.toFixed(1)}%</p>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-black/10 rounded-full mt-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColors[color]}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      {detail && <p className="text-xs mt-2 opacity-70">{detail}</p>}
      {sub && <p className="text-xs mt-0.5 opacity-60">{sub}</p>}
    </div>
  );
}
