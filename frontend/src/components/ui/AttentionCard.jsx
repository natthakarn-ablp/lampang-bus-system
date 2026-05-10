import AppCard from './AppCard';
import StatusBadge from './StatusBadge';

/**
 * AttentionCard — one cell of a dashboard attention panel.
 *
 * Composes AppCard + StatusBadge. Three render states:
 *   - count === 0                  → muted emptyLabel, non-interactive <div>
 *   - count > 0, onJump provided   → items list + "ดูทั้งหมด →" affordance
 *                                    inside a real <button> so click + Enter
 *                                    + Space all fire onJump natively
 *   - count > 0, no onJump prop    → items list shown, but no button wrapper
 *                                    and no "ดูทั้งหมด →" — for dashboards
 *                                    that surface the signal but don't yet
 *                                    have a detail section to drill into
 *
 * Caller-provided items[] each have { key, primary, secondary }; up to the
 * caller to slice to the desired top-N before passing in.
 */
export default function AttentionCard({
  icon: Icon,
  title,
  count,
  variant,
  items,
  onJump,
  emptyLabel,
}) {
  const hasContent = count > 0;
  const isJumpable = hasContent && typeof onJump === 'function';
  const Wrapper = isJumpable ? 'button' : 'div';
  const wrapperProps = isJumpable
    ? { type: 'button', onClick: onJump,
        className: 'block w-full text-left transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-xl' }
    : { className: 'block w-full text-left' };

  return (
    <Wrapper {...wrapperProps}>
      <AppCard padding="md" className="h-full">
        <div className="flex items-start gap-2 mb-2">
          {Icon && <Icon className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" strokeWidth={2} />}
          <span className="text-sm font-semibold text-ink leading-tight">{title}</span>
          <span className="ml-auto shrink-0">
            <StatusBadge variant={variant} size="sm">{count}</StatusBadge>
          </span>
        </div>
        {hasContent ? (
          <>
            <ul className="space-y-1.5">
              {items.map(it => (
                <li key={it.key} className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{it.primary}</p>
                  <p className="text-xs text-ink-muted truncate">{it.secondary}</p>
                </li>
              ))}
            </ul>
            {isJumpable && <p className="text-xs text-brand font-medium mt-3">ดูทั้งหมด →</p>}
          </>
        ) : (
          <p className="text-xs text-ink-muted">{emptyLabel}</p>
        )}
      </AppCard>
    </Wrapper>
  );
}
