import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertOctagon, Clock, Info, ArrowRight, Sunrise, Sunset } from 'lucide-react';
import { tone } from '../ui/tone';
import { SESSION_LABEL, dayStatus } from './roundStatus';

const ICONS = { success: CheckCircle2, warn: AlertTriangle, danger: AlertOctagon, info: Clock, neutral: Info };
const ROUND_ICON = { morning: Sunrise, evening: Sunset };
const fmt = n => Number(n || 0).toLocaleString('th-TH');

function ActionButton({ action, solidCls }) {
  if (!action) return null;
  const cls = `focus-ring inline-flex items-center justify-center gap-1.5 min-h-[44px] w-full sm:w-auto px-4 rounded-xl text-sm font-semibold text-white ${solidCls} hover:opacity-90 transition shrink-0`;
  const body = <>{action.label}<ArrowRight className="w-4 h-4" aria-hidden="true" /></>;
  return action.to
    ? <Link to={action.to} className={cls}>{body}</Link>
    : <button type="button" onClick={action.onClick} className={cls}>{body}</button>;
}

/**
 * RoundProgress — one round (เช้า/เย็น): name, status word, big done/expected
 * and a progress bar. `status` is the result of roundStatus().
 * A round that has not started shows no bar and no percentage, so nothing is
 * red or 0% before it could have happened.
 */
export function RoundProgress({ status, to, title }) {
  if (!status) return null;
  const t = tone(status.tone);
  const Icon = ROUND_ICON[status.session] || Clock;
  const showBar = status.expected > 0 && !['not_yet', 'unavailable', 'off_day'].includes(status.state);
  const roundName = title || SESSION_LABEL[status.session];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <Icon className="w-5 h-5 text-ink-muted" strokeWidth={2} aria-hidden="true" />
          {roundName}
        </span>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${t.soft} ${t.ink} ${t.border}`}>
          {status.label}
        </span>
      </div>
      <p className="mt-2 tabular-nums text-ink">
        {status.state === 'unavailable' ? (
          <span className="text-3xl font-bold">—</span>
        ) : (
          <>
            <span className="text-3xl font-bold">{fmt(status.done)}</span>
            <span className="text-base text-ink-muted"> / {fmt(status.expected)} คน</span>
          </>
        )}
      </p>
      {showBar && (
        <div
          className="mt-2 h-2.5 w-full rounded-full bg-surface overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={status.expected}
          aria-valuenow={status.done}
          aria-label={`${roundName} ${fmt(status.done)} จาก ${fmt(status.expected)} คน`}
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${status.pct ?? 0}%`, backgroundColor: t.ring }} />
        </div>
      )}
      <p className="mt-2 text-sm text-ink-muted text-pretty">{status.detail}</p>
    </>
  );
  const cls = 'block rounded-2xl border border-surface-border bg-surface-raised p-4';
  return to
    ? <Link to={to} className={`${cls} focus-ring hover:bg-surface transition`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/**
 * StatusHero — the one answer at the top of a dashboard or daily report:
 * "วันนี้เป็นอย่างไร / ต้องทำอะไรต่อ".
 *
 * Props
 *   rounds       [{ status: roundStatus(...), to?, title? }] — one card per round
 *   day          optional { tone, headline, sub } — defaults to dayStatus(rounds)
 *   emergencies  number passed to dayStatus when `day` is not given
 *   action       { label, to } | { label, onClick } — the single next step
 *   eyebrow      small line above the headline (scope name · date)
 *   loading      calm skeleton instead of content
 *   children     extra content under the round cards
 */
export default function StatusHero({ rounds = [], day, emergencies = 0, action, eyebrow, loading = false, className = '', children }) {
  if (loading) {
    return (
      <section aria-busy="true" aria-label="สรุปวันนี้" className={`rounded-2xl border border-surface-border bg-surface-raised p-4 sm:p-5 ${className}`}>
        <div className="h-6 w-2/3 rounded bg-surface motion-safe:animate-pulse" />
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="h-28 rounded-2xl bg-surface motion-safe:animate-pulse" />
          <div className="h-28 rounded-2xl bg-surface motion-safe:animate-pulse" />
        </div>
      </section>
    );
  }
  const summary = day || dayStatus(rounds.map(r => r.status), { emergencies });
  const t = tone(summary.tone);
  const Icon = ICONS[summary.tone] || Info;
  return (
    <section aria-label="สรุปวันนี้" className={`rounded-2xl border p-4 sm:p-5 ${t.border} ${t.soft} ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`w-11 h-11 rounded-full text-white inline-flex items-center justify-center shrink-0 ${t.solid}`}>
            <Icon className="w-6 h-6" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div className={`min-w-0 ${t.ink}`}>
            {eyebrow && <p className="text-sm text-ink-muted">{eyebrow}</p>}
            <h2 className="text-xl sm:text-2xl font-bold leading-snug text-pretty">{summary.headline}</h2>
            {summary.sub && <p className="text-sm sm:text-base mt-0.5 text-pretty">{summary.sub}</p>}
          </div>
        </div>
        <ActionButton action={action} solidCls={t.solid} />
      </div>
      {rounds.length > 0 && (
        <div className={`mt-4 grid grid-cols-1 gap-3 ${rounds.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {rounds.map((r, i) => <RoundProgress key={r.status?.session || i} status={r.status} to={r.to} title={r.title} />)}
        </div>
      )}
      {children}
    </section>
  );
}
