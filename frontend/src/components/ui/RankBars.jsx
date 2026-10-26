import { Link } from 'react-router-dom';
import { tone } from './tone';

/**
 * RankBars — "what needs attention", one horizontal bar per row.
 * rows = [{ key, label, width (0–100), text, variant }]
 */
export default function RankBars({ title, sub, rows = [], link, empty = 'ไม่มีรายการที่ต้องติดตาม' }) {
  return (
    <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-ink">{title}</h3>
        {sub && <span className="text-sm text-ink-muted">{sub}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted py-8 text-center">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r, i) => {
            const t = tone(r.variant);
            const w = Math.max(2, Math.min(100, Number(r.width) || 0));
            return (
              <li key={r.key || i} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-sm text-ink truncate" title={r.label}>{r.label}</span>
                <span className="h-3 bg-surface rounded-full overflow-hidden border border-surface-border">
                  <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, backgroundColor: t.ring }} />
                </span>
                <span className={`text-xs font-semibold whitespace-nowrap text-right ${t.ink}`}>{r.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {link && (
        <Link to={link.to} className="focus-ring mt-auto self-start text-sm font-semibold text-brand-700 hover:underline min-h-[44px] inline-flex items-center">
          {link.label} →
        </Link>
      )}
    </div>
  );
}
