const VARIANTS = {
  success: 'bg-success-soft text-success-ink',
  warn:    'bg-warn-soft    text-warn-ink',
  danger:  'bg-danger-soft  text-danger-ink',
  info:    'bg-info-soft    text-info-ink',
  neutral: 'bg-surface      text-ink-muted border border-surface-border',
  brand:   'bg-brand-50     text-brand-700',
};

const SIZES = {
  sm: 'text-[11px] px-2   py-0.5  gap-1',
  md: 'text-xs    px-2.5 py-0.5  gap-1',
  lg: 'text-sm    px-3   py-1    gap-1.5',
};

export default function StatusBadge({
  variant = 'neutral',
  size = 'md',
  icon: Icon,
  className = '',
  children,
}) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full whitespace-nowrap ${VARIANTS[variant] || VARIANTS.neutral} ${SIZES[size] || SIZES.md} ${className}`}
    >
      {Icon && <Icon className={size === 'lg' ? 'w-4 h-4' : 'w-3 h-3'} strokeWidth={2.2} aria-hidden="true" />}
      {children}
    </span>
  );
}
