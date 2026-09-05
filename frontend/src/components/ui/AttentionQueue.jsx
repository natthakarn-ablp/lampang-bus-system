import { CheckCircle2, HelpCircle } from 'lucide-react';
import AppCard from './AppCard';
import AttentionCard from './AttentionCard';

/**
 * AttentionQueue — the "what needs me right now" band of a dashboard.
 *
 * The old layout rendered every signal as an equal-height card, so two empty
 * cards reading "ไม่มีคำขอรอดำเนินการ" occupied exactly as much of the fold as
 * the one card that actually had 643 people waiting. Attention should scale
 * with the amount of attention required.
 *
 * So: signals with work render as full cards; signals that are clear collapse
 * into a single "เรียบร้อย" strip underneath. When everything is clear the
 * strip is the whole component — a quiet one-liner instead of a wall.
 *
 * A signal whose fetch failed is NOT clear — it is unknown, and it is reported
 * separately. Telling an administrator "เรียบร้อย" because a request errored
 * would be worse than showing nothing.
 *
 * `signals` — [{ key, icon, title, count, items, onJump, emptyLabel, variant, unknown }]
 */
export default function AttentionQueue({ signals = [], className = '' }) {
  const known   = signals.filter(s => !s.unknown);
  const unknown = signals.filter(s => s.unknown);
  const active  = known.filter(s => (s.count ?? 0) > 0);
  const clear   = known.filter(s => (s.count ?? 0) === 0);

  if (signals.length === 0) return null;

  const cols = active.length >= 3 ? 'sm:grid-cols-3'
             : active.length === 2 ? 'sm:grid-cols-2'
             : 'sm:grid-cols-1';

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {active.length > 0 && (
        <div className={`grid grid-cols-1 ${cols} gap-3`}>
          {active.map(s => (
            <AttentionCard
              key={s.key}
              icon={s.icon}
              title={s.title}
              count={s.count}
              variant={s.variant}
              items={s.items}
              onJump={s.onJump}
              emptyLabel={s.emptyLabel}
            />
          ))}
        </div>
      )}

      {clear.length > 0 && (
        <AppCard padding="sm">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-success-ink shrink-0 mt-0.5" strokeWidth={2.2} aria-hidden="true" />
            <p className="text-sm text-ink-muted leading-relaxed">
              <span className="font-medium text-ink">เรียบร้อย</span>
              {' · '}
              {clear.map(s => s.title).join(' · ')}
            </p>
          </div>
        </AppCard>
      )}

      {unknown.length > 0 && (
        <AppCard padding="sm">
          <div className="flex items-start gap-2.5">
            <HelpCircle className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" strokeWidth={2.2} aria-hidden="true" />
            <p className="text-sm text-ink-muted leading-relaxed">
              <span className="font-medium text-ink">ไม่ทราบสถานะ</span>
              {' · '}
              {unknown.map(s => s.title).join(' · ')}
            </p>
          </div>
        </AppCard>
      )}
    </div>
  );
}
