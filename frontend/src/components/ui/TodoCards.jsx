import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { tone } from './tone';

/**
 * TodoCards — "ต้องทำวันนี้": at most three cards, each a count, a title,
 * a one-line sub and one button. Items with `count === 0` are dropped unless
 * they set `keepZero` (e.g. admin's pending requests showing a green 0).
 * Nothing left → one green "ไม่มีงานค้าง" line.
 *
 * item = { key, variant, count, title, sub, cta: { label, to } | { label, onClick }, keepZero }
 */
export default function TodoCards({ title = 'ต้องทำวันนี้', items = [], max = 3 }) {
  const shown = items.filter(i => i && (i.keepZero || Number(i.count) > 0)).slice(0, max);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> ไม่มีงานค้าง
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {shown.map((item, idx) => {
            const t = tone(item.variant);
            const btnCls = `focus-ring self-start inline-flex items-center min-h-[44px] px-4 rounded-xl border text-sm font-semibold bg-surface-raised ${t.border} ${t.ink} hover:bg-surface transition`;
            return (
              <div key={item.key || idx} className="bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className={`min-w-[56px] h-14 px-2 rounded-2xl inline-flex items-center justify-center text-2xl font-bold tabular-nums ${t.soft} ${t.ink}`}>
                    {Number(item.count).toLocaleString('th-TH')}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink leading-snug">{item.title}</p>
                    {item.sub && <p className="text-sm text-ink-muted leading-snug">{item.sub}</p>}
                  </div>
                </div>
                {item.cta && (item.cta.to ? (
                  <Link to={item.cta.to} className={btnCls}>{item.cta.label}</Link>
                ) : (
                  <button type="button" onClick={item.cta.onClick} className={btnCls}>{item.cta.label}</button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
