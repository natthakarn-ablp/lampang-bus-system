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
  const value = pct ?? 0;
  const color =
    value >= 95   ? 'green'  :
    value >= 85   ? 'yellow' :
    value > 0     ? 'red'    :
                    'gray';

  const colors = {
    green:  'bg-green-50  border-green-200  text-green-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    red:    'bg-red-50    border-red-200    text-red-700',
    gray:   'bg-gray-50   border-gray-200   text-gray-700',
  };

  const barColors = {
    green:  'bg-green-500',
    yellow: 'bg-yellow-500',
    red:    'bg-red-500',
    gray:   'bg-gray-300',
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
