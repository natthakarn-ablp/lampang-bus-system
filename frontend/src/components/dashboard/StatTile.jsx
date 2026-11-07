import { Link } from 'react-router-dom';
import { tone } from '../ui/tone';

/**
 * StatTile — one large, readable number.
 *
 * tone: 'calm' (default — neutral card, ink number: a fact, not a problem),
 *       'success' | 'warn' | 'danger' | 'info' only when the number asks for
 *       attention; 'danger' is for real problems (emergency, not delivered).
 * Props: label, value, unit, sub, icon (lucide component), to (whole tile is
 * a link), unavailable (feed failed → "—", never 0).
 */
export default function StatTile({ label, value, unit, sub, tone: toneKey = 'calm', icon: Icon, to, unavailable = false, className = '' }) {
  const calm = !toneKey || toneKey === 'calm';
  const t = tone(calm ? 'neutral' : toneKey);
  const frame = calm ? 'bg-surface-raised border-surface-border' : `${t.soft} ${t.border}`;
  const num = calm ? 'text-ink' : t.ink;
  const shown = unavailable || value == null || value === ''
    ? '—'
    : typeof value === 'number' ? value.toLocaleString('th-TH') : value;
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-muted">
        {Icon && <Icon className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </p>
      <p className={`mt-1 tabular-nums leading-tight ${num}`}>
        <span className="text-3xl font-bold">{shown}</span>
        {unit && shown !== '—' && <span className="ml-1 text-base font-medium text-ink-muted">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-sm text-ink-muted text-pretty">{sub}</p>}
    </>
  );
  const cls = `block rounded-2xl border p-4 ${frame} ${className}`;
  return to
    ? <Link to={to} className={`${cls} focus-ring hover:shadow-soft transition`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** StatGrid — 2 columns on phones, up to `cols` (2–4) on wide screens. */
export function StatGrid({ cols = 4, label, className = '', children }) {
  const lg = { 2: 'sm:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cols] || 'lg:grid-cols-4';
  return (
    <section aria-label={label} className={`grid grid-cols-2 gap-3 ${lg} ${className}`}>
      {children}
    </section>
  );
}
