import { Inbox } from 'lucide-react';

/**
 * EmptyState — consistent empty/no-data placeholder.
 *
 * Props:
 *   icon        — React component for icon (optional, defaults to Inbox)
 *   title       — main empty-state message
 *   description — secondary explanation
 *   action      — optional CTA button/link (ReactNode)
 *   variant     — 'default' | 'success' | 'warn' | 'info'
 *   compact     — true → smaller padding (for use inside cards)
 */

const VARIANTS = {
  default: { iconBg: 'bg-surface',      iconColor: 'text-ink-muted' },
  success: { iconBg: 'bg-success-soft', iconColor: 'text-success-ink' },
  warn:    { iconBg: 'bg-warn-soft',    iconColor: 'text-warn-ink' },
  info:    { iconBg: 'bg-info-soft',    iconColor: 'text-info-ink' },
};

export default function EmptyState({
  icon: Icon = Inbox,
  title = 'ไม่มีข้อมูล',
  description,
  action,
  variant = 'default',
  compact = false,
}) {
  const v = VARIANTS[variant] || VARIANTS.default;
  const padding = compact ? 'py-8 px-4' : 'py-12 px-4';

  return (
    <div className={`flex flex-col items-center justify-center ${padding} text-center`}>
      {Icon && (
        <div className={`w-14 h-14 rounded-full ${v.iconBg} flex items-center justify-center mb-3`}>
          <Icon className={`w-7 h-7 ${v.iconColor}`} strokeWidth={1.6} aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-semibold text-ink mb-1">{title}</p>
      {description && (
        <p className="text-sm text-ink-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
