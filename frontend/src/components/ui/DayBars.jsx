/**
 * DayBars — grouped bars per day (two series), today's column shaded.
 *
 * days = [{ key, label, a, b, today }]   a/b are numbers (or null = no data);
 *        days itself null = still loading
 * With `percent` the scale is fixed at 0–100 and the top label shows "a%".
 */
export default function DayBars({
  title, days, aLabel = 'ส่งเช้า', bLabel = 'รับเย็น', percent = true, note, height = 160,
}) {
  const loading = days == null;
  days = days || [];
  const vals = days.flatMap(d => [d.a, d.b]).filter(v => v != null && isFinite(v));
  const max = percent ? 100 : Math.max(1, ...vals);
  const h = v => (v == null || !isFinite(v) ? 0 : Math.max(0, Math.round((Math.min(v, max) / max) * height)));
  return (
    <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-ink">{title}</h3>
        <div className="flex gap-3 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-brand-600" aria-hidden="true" />{aLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-warn" aria-hidden="true" />{bLabel}</span>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-ink-muted py-10 text-center" aria-busy="true">กำลังโหลด…</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-ink-muted py-10 text-center">ยังไม่มีข้อมูลย้อนหลัง</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-1 border-b border-surface-border px-1" style={{ height: height + 28 }}>
            {days.map((d, i) => (
              <div
                key={d.key || i}
                className={`flex-1 flex flex-col items-center gap-1 pt-1 rounded-t-lg ${d.today ? 'bg-surface' : ''}`}
                title={`${d.label}: ${aLabel} ${d.a ?? '-'}${percent ? '%' : ''} · ${bLabel} ${d.b ?? '-'}${percent ? '%' : ''}`}
              >
                <span className="text-[11px] font-semibold text-ink tabular-nums">{d.a == null ? '–' : `${d.a}${percent ? '%' : ''}`}</span>
                <div className="flex items-end gap-1">
                  <div className="w-3.5 sm:w-4 rounded-t bg-brand-600 transition-all duration-500" style={{ height: h(d.a) }} />
                  <div className="w-3.5 sm:w-4 rounded-t bg-warn transition-all duration-500" style={{ height: h(d.b) }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-1 px-1 -mt-1">
            {days.map((d, i) => (
              <span key={d.key || i} className={`flex-1 text-center text-xs ${d.today ? 'font-bold text-ink' : 'text-ink-muted'}`}>{d.label}</span>
            ))}
          </div>
        </>
      )}
      {note && <p className="text-sm text-ink-muted">{note}</p>}
    </div>
  );
}
