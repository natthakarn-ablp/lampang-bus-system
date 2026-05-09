import { CheckCircle2, AlertTriangle, AlertOctagon, Info, X } from 'lucide-react';

const VARIANT_STYLE = {
  success: { wrap: 'bg-success-soft border-l-success', icon: 'text-success', defaultIcon: CheckCircle2 },
  warn:    { wrap: 'bg-warn-soft    border-l-warn',    icon: 'text-warn',    defaultIcon: AlertTriangle },
  danger:  { wrap: 'bg-danger-soft  border-l-danger',  icon: 'text-danger',  defaultIcon: AlertOctagon },
  info:    { wrap: 'bg-info-soft    border-l-info',    icon: 'text-info',    defaultIcon: Info },
};

export default function AlertBanner({
  variant = 'info',
  title,
  icon: IconOverride,
  onClose,
  className = '',
  children,
}) {
  const style = VARIANT_STYLE[variant] || VARIANT_STYLE.info;
  const Icon = IconOverride || style.defaultIcon;

  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-xl border-l-4 px-4 py-3 ${style.wrap} ${className}`}
    >
      {Icon && (
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${style.icon}`} strokeWidth={2} aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-semibold text-ink leading-tight">{title}</p>}
        {children && (
          <div className={`text-sm text-ink-muted ${title ? 'mt-1' : ''}`}>{children}</div>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-ink-muted hover:bg-black/5 transition"
          aria-label="ปิด"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
