/**
 * Lightweight SVG chart components — no external dependencies.
 * Designed for dashboard summary use. All charts are responsive and accessible.
 */

/** Donut Chart — shows proportional segments with center label */
export function DonutChart({ segments = [], size = 120, thickness = 20, label, sublabel }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
  let offset = 0;

  // Empty state
  if (total === 0) {
    return (
      <div className="flex flex-col items-center">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xs text-gray-400">ไม่มีข้อมูล</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              {seg.label} 0
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          {segments.map((seg, i) => {
            if (!seg.value) { return null; }
            const pct = seg.value / total;
            const dashLength = pct * circumference;
            const el = (
              <circle
                key={i}
                cx={size/2} cy={size/2} r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={-offset}
                className="transition-all duration-500"
              />
            );
            offset += dashLength;
            return el;
          })}
        </svg>
        {/* Center label — positioned absolutely over SVG */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {label && <p className="text-lg font-bold text-gray-800 leading-tight">{label}</p>}
          {sublabel && <p className="text-[10px] text-gray-400 leading-tight">{sublabel}</p>}
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            {seg.label} {seg.value}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal Bar Chart — compares items side by side */
export function HBarChart({ items = [], maxValue, label, valueLabel = '', barHeight = 24, showValue = true }) {
  const max = maxValue || Math.max(...items.map(i => i.value || 0), 1);

  if (!items.length) {
    return (
      <div>
        {label && <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>}
        <p className="text-xs text-gray-400 py-4 text-center">ไม่มีข้อมูล</p>
      </div>
    );
  }

  return (
    <div>
      {label && <p className="text-xs font-semibold text-gray-500 mb-2">{label}</p>}
      <div className="space-y-1.5">
        {items.map((item, i) => {
          const pct = max > 0 ? Math.min((item.value / max) * 100, 100) : 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600 w-24 truncate shrink-0 text-right">{item.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full overflow-hidden" style={{ height: barHeight * 0.6 }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: item.color || '#3b82f6' }}
                />
              </div>
              {showValue && <span className="text-[11px] text-gray-500 w-12 text-right shrink-0">{item.value}{valueLabel}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mini Spark Bar — compact inline progress bar with label */
export function SparkProgress({ value = 0, max = 100, color = '#3b82f6', label, height = 6 }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div>
      {label && <div className="flex justify-between text-[10px] text-gray-500 mb-0.5"><span>{label}</span><span>{pct}%</span></div>}
      <div className="w-full bg-gray-100 rounded-full overflow-hidden" style={{ height }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/** Trend Line Chart — multi-series line chart with SVG */
export function TrendChart({ series = [], labels = [], height = 140, title }) {
  if (!labels.length) {
    return (
      <div>
        {title && <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>}
        <p className="text-xs text-gray-400 py-6 text-center">ไม่มีข้อมูลแนวโน้ม</p>
      </div>
    );
  }

  const W = 100; // viewBox width percentage
  const H = height;
  const padX = 0;
  const padY = 10;
  const plotW = W;
  const plotH = H - padY * 2;

  // Find global max
  const allVals = series.flatMap(s => s.data || []);
  const maxVal = Math.max(...allVals, 1);

  function toX(i) { return padX + (i / Math.max(labels.length - 1, 1)) * plotW; }
  function toY(v) { return padY + plotH - (v / maxVal) * plotH; }

  return (
    <div>
      {title && <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = padY + plotH - (pct / 100) * plotH;
          return <line key={pct} x1={0} y1={y} x2={W} y2={y} stroke="#f1f5f9" strokeWidth={0.3} />;
        })}
        {/* Series */}
        {series.map((s, si) => {
          if (!s.data?.length) return null;
          const points = s.data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
          // Area fill
          const areaPoints = `${toX(0)},${padY + plotH} ${points} ${toX(s.data.length - 1)},${padY + plotH}`;
          return (
            <g key={si}>
              <polygon points={areaPoints} fill={s.color} opacity={0.08} />
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              {/* Dots */}
              {s.data.map((v, i) => (
                <circle key={i} cx={toX(i)} cy={toY(v)} r={1.8} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      {/* X-axis labels */}
      <div className="flex justify-between mt-1">
        {labels.map((l, i) => (
          <span key={i} className="text-[9px] text-gray-400">{l}</span>
        ))}
      </div>
      {/* Legend */}
      <div className="flex gap-3 mt-1.5 justify-center">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
