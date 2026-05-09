export default function SectionTitle({ title, description, action, className = '' }) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {title && <h2 className="text-lg sm:text-xl font-semibold text-ink leading-tight truncate">{title}</h2>}
        {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
