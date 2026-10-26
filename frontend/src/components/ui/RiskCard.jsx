import { ChevronRight } from 'lucide-react';
import AppCard from './AppCard';
import StatusBadge from './StatusBadge';

// Risk level conveyed by a semantic-tinted icon chip + a labelled StatusBadge —
// never a decorative left bar or color alone (DESIGN.md: status needs text/icon,
// no border-left accent strips).
const LEVEL = {
  low:    { chip: 'bg-success-soft text-success-ink', badge: 'success', label: 'ปกติ' },
  medium: { chip: 'bg-warn-soft    text-warn-ink',    badge: 'warn',    label: 'เฝ้าระวัง' },
  high:   { chip: 'bg-danger-soft  text-danger-ink',  badge: 'danger',  label: 'เสี่ยงสูง' },
};

export default function RiskCard({
  level = 'medium',
  title,
  subtitle,
  meta,
  icon: Icon,
  onClick,
  className = '',
}) {
  const style = LEVEL[level] || LEVEL.medium;
  const interactive = typeof onClick === 'function';
  const Tag = interactive ? 'button' : 'div';

  return (
    <AppCard
      as={Tag}
      padding="md"
      interactive={interactive}
      onClick={onClick}
      className={`flex items-center gap-3 text-left ${className}`}
    >
      {Icon && (
        <span className={`shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center ${style.chip}`}>
          <Icon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <StatusBadge variant={style.badge} size="sm">{style.label}</StatusBadge>
          {meta && <span className="text-[11px] text-ink-muted">{meta}</span>}
        </div>
        {title && <p className="mt-1 text-sm font-semibold text-ink truncate">{title}</p>}
        {subtitle && <p className="text-xs text-ink-muted truncate">{subtitle}</p>}
      </div>
      {interactive && (
        <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" strokeWidth={2} aria-hidden="true" />
      )}
    </AppCard>
  );
}
