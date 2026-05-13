import { Loader2 } from 'lucide-react';

/**
 * LoadingState — consistent inline loading placeholder.
 *
 * Pair with EmptyState / ErrorState so the three async-data states share
 * a visual rhythm. Defaults match Phase 8.5 canonical copy.
 *
 * Props:
 *   message — primary loading text (default "กำลังโหลดข้อมูล…")
 *   compact — true → tighter padding (use inside cards / map panes)
 */
export default function LoadingState({
  message = 'กำลังโหลดข้อมูล…',
  compact = false,
  className = '',
}) {
  const padding = compact ? 'py-6' : 'py-10';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center ${padding} text-center text-ink-muted ${className}`}
    >
      <Loader2 className="w-5 h-5 mb-2 animate-spin" strokeWidth={2} aria-hidden="true" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
