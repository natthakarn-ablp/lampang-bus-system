/**
 * EmptyState — consistent empty/no-data placeholder.
 *
 * Props:
 *   icon        — React component for icon (optional)
 *   title       — main empty-state message
 *   description — secondary explanation
 *   action      — optional CTA button/link (ReactNode)
 *   variant     — 'default' | 'success' | 'warning' | 'info'
 */

const VARIANTS = {
  default: {
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-400',
  },
  success: {
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  warning: {
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  info: {
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
};

export default function EmptyState({
  icon: Icon,
  title = 'ไม่มีข้อมูล',
  description,
  action,
  variant = 'default',
}) {
  const v = VARIANTS[variant] || VARIANTS.default;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {Icon && (
        <div className={`w-16 h-16 rounded-full ${v.iconBg} flex items-center justify-center mb-4`}>
          <Icon className={`w-8 h-8 ${v.iconColor}`} />
        </div>
      )}
      <p className="text-base font-semibold text-gray-700 mb-1">{title}</p>
      {description && (
        <p className="text-sm text-gray-500 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
