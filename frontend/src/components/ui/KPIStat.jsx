import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import AppCard from './AppCard';
import { CountUp } from '../../lib/motion';

const ICON_BG = {
  brand:   'bg-brand-50    text-brand-700',
  success: 'bg-success-soft text-success-ink',
  warn:    'bg-warn-soft    text-warn-ink',
  danger:  'bg-danger-soft  text-danger-ink',
  info:    'bg-info-soft    text-info-ink',
  neutral: 'bg-surface      text-ink-muted',
};

const TREND_STYLE = {
  up:   { icon: TrendingUp,   className: 'text-success-ink' },
  down: { icon: TrendingDown, className: 'text-danger-ink' },
  flat: { icon: Minus,        className: 'text-ink-muted' },
};

export default function KPIStat({
  label,
  value,
  icon: Icon,
  variant = 'brand',
  trend,
  hint,
  className = '',
  onClick,
}) {
  const interactive = typeof onClick === 'function';
  const Tag = interactive ? 'button' : 'div';
  const trendStyle = trend && TREND_STYLE[trend.direction];

  return (
    <AppCard
      as={Tag}
      padding="md"
      onClick={onClick}
      className={`flex flex-col gap-3 text-left ${interactive ? 'hover:shadow-elevate hover:-translate-y-0.5 transition cursor-pointer' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted leading-tight">{label}</p>
        {Icon && (
          <span className={`shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center ${ICON_BG[variant] || ICON_BG.brand}`}>
            <Icon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-ink leading-none tabular-nums">
          {typeof value === 'number' || /^\d+$/.test(String(value)) ? (
            <CountUp value={value} />
          ) : value}
        </span>
        {trend && trendStyle && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${trendStyle.className}`}>
            <trendStyle.icon className="w-3.5 h-3.5" strokeWidth={2.2} />
            {trend.label || `${trend.value}%`}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </AppCard>
  );
}
