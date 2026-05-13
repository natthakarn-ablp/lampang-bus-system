import AlertBanner from './ui/AlertBanner';

/**
 * ErrorState — consistent fetch-error display.
 *
 * Thin wrapper over AlertBanner that enforces Phase 8.5 canonical copy
 * (title, fallback body, retry button shape). Use for blocking errors
 * that occupy the page; for non-blocking poll warnings keep the inline
 * AlertBanner.
 *
 * Props:
 *   title    — default "โหลดข้อมูลไม่สำเร็จ"
 *   message  — defaults to "กรุณาลองใหม่อีกครั้ง" when not provided.
 *              Caller can pass the server-side Thai message captured
 *              earlier — never the raw error object.
 *   onRetry  — optional handler; renders a retry button when set.
 */
export default function ErrorState({
  title = 'โหลดข้อมูลไม่สำเร็จ',
  message,
  onRetry,
  className = '',
}) {
  const body = message || 'กรุณาลองใหม่อีกครั้ง';
  return (
    <AlertBanner variant="danger" title={title} className={className}>
      <div className="space-y-2">
        <p>{body}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-danger underline-offset-2 hover:underline"
          >
            ลองใหม่อีกครั้ง
          </button>
        )}
      </div>
    </AlertBanner>
  );
}
