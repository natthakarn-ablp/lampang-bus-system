import { ChevronRight } from 'lucide-react';
import AppCard from './AppCard';

const LEVEL = {
  low:    { accent: 'before:bg-success', dot: 'bg-success', label: 'ปกติ',    text: 'text-success' },
  medium: { accent: 'before:bg-warn',    dot: 'bg-warn',    label: 'เฝ้าระวัง', text: 'text-warn' },
  high:   { accent: 'before:bg-danger',  dot: 'bg-danger',  label: 'เสี่ยงสูง', text: 'text-danger' },
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
      onClick={onClick}
      className={`relative pl-5 text-left flex items-center gap-3 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-1 before:rounded-r-full ${style.accent} ${interactive ? 'hover:shadow-elevate transition cursor-pointer' : ''} ${className}`}
    >
      {Icon && (
        <span className="shrink-0 w-10 h-10 rounded-xl bg-surface inline-flex items-center justify-center text-ink-muted">
          <Icon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${style.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </span>
          {meta && <span className="text-[11px] text-ink-muted">· {meta}</span>}
        </div>
        {title && <p className="text-sm font-semibold text-ink truncate mt-0.5">{title}</p>}
        {subtitle && <p className="text-xs text-ink-muted truncate">{subtitle}</p>}
      </div>
      {interactive && (
        <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" strokeWidth={2} aria-hidden="true" />
      )}
    </AppCard>
  );
}
