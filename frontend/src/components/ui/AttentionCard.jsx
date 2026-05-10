import AppCard from './AppCard';
import StatusBadge from './StatusBadge';

/**
 * AttentionCard — one cell of a dashboard attention panel.
 *
 * Composes AppCard + StatusBadge. When count > 0 the entire card is a real
 * <button> (so click + Enter + Space all fire onJump natively and screen
 * readers announce "button"); when count === 0 it falls back to a plain
 * <div> with a muted emptyLabel — there's nothing to navigate to.
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
  const interactive = count > 0;
  const Wrapper = interactive ? 'button' : 'div';
  const wrapperProps = interactive
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
        {interactive ? (
          <>
            <ul className="space-y-1.5">
              {items.map(it => (
                <li key={it.key} className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{it.primary}</p>
                  <p className="text-xs text-ink-muted truncate">{it.secondary}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-brand font-medium mt-3">ดูทั้งหมด →</p>
          </>
        ) : (
          <p className="text-xs text-ink-muted">{emptyLabel}</p>
        )}
      </AppCard>
    </Wrapper>
  );
}
