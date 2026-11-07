import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { tone } from '../ui/tone';

const ORDER = { danger: 0, warn: 1, info: 2, neutral: 3, success: 4 };

/**
 * ActionList — "ต้องทำวันนี้": a short list of things the user can act on,
 * each a whole-row link (or button) to the page where they act.
 *
 * item = {
 *   key, tone ('danger'|'warn'|'info'|'neutral'), count, title, sub,
 *   to | onClick, actionLabel (default 'ไปดำเนินการ', shown from sm up),
 *   keepZero (show even at 0), unavailable (feed failed → "—", never dropped)
 * }
 * Items with count 0 are dropped. Danger first, then warn, then the rest,
 * keeping the given order inside a tone.
 *
 * Empty list:
 *   hideWhenEmpty → render nothing
 *   afterAlert    → neutral "ไม่มีงานอื่นค้าง นอกจากที่แจ้งด้านบน"
 *   otherwise     → one calm green `emptyText` line ('ไม่มีงานค้าง')
 */
export default function ActionList({ title = 'ต้องทำวันนี้', items = [], max = 6, hideWhenEmpty = false, afterAlert = false, emptyText = 'ไม่มีงานค้าง', className = '' }) {
  const shown = items
    .filter(i => i && (i.unavailable || i.keepZero || Number(i.count) > 0))
    .map((i, idx) => ({ ...i, _idx: idx }))
    .sort((a, b) => ((ORDER[a.tone] ?? 3) - (ORDER[b.tone] ?? 3)) || (a._idx - b._idx))
    .slice(0, max);

  if (shown.length === 0 && hideWhenEmpty) return null;

  return (
    <section className={`flex flex-col gap-2 ${className}`} aria-label={title || 'ต้องทำวันนี้'}>
      {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
      {shown.length === 0 ? (
        afterAlert ? (
          <p className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">ไม่มีงานอื่นค้าง นอกจากที่แจ้งด้านบน</p>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success-ink">
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            {emptyText}
          </p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-surface-border rounded-2xl border border-surface-border bg-surface-raised overflow-hidden">
          {shown.map(item => <ActionRow key={item.key || item._idx} item={item} />)}
        </ul>
      )}
    </section>
  );
}

function ActionRow({ item }) {
  const t = tone(item.tone || 'info');
  const actionable = Boolean(item.to || item.onClick);
  const body = (
    <>
      <span className={`min-w-[52px] h-12 px-2 rounded-xl inline-flex items-center justify-center text-xl font-bold tabular-nums shrink-0 ${t.soft} ${t.ink}`}>
        {item.unavailable ? '—' : Number(item.count || 0).toLocaleString('th-TH')}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-ink leading-snug">{item.title}</span>
        {item.sub && <span className="block text-sm text-ink-muted leading-snug">{item.sub}</span>}
      </span>
      {actionable && <span className={`hidden sm:inline text-sm font-semibold shrink-0 ${t.ink}`}>{item.actionLabel || 'ไปดำเนินการ'}</span>}
      {actionable && <ChevronRight className="w-5 h-5 text-ink-muted shrink-0" aria-hidden="true" />}
    </>
  );
  const cls = 'flex items-center gap-3 px-4 py-3 min-h-[64px] w-full text-left';
  const hover = 'focus-ring hover:bg-surface transition';
  return (
    <li>
      {item.to ? (
        <Link to={item.to} className={`${cls} ${hover}`}>{body}</Link>
      ) : item.onClick ? (
        <button type="button" onClick={item.onClick} className={`${cls} ${hover}`}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
