import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { useState, useCallback, useEffect, createContext, useContext } from 'react';
import { AnimatePresence, ToastSlide } from '../lib/motion';
import { RATE_LIMIT_EVENT } from '../utils/rateLimitNotice';

const ToastContext = createContext(null);

// A toast's type was carried by a bare ✓ / ✕ / ℹ glyph plus a background
// colour. Neither survives a screen reader, so each type now has a real icon
// (aria-hidden, since it is decorative) and an sr-only word that is not.
const ICONS = {
  success: { Icon: CheckCircle2,  label: 'สำเร็จ' },
  error:   { Icon: XCircle,       label: 'ผิดพลาด' },
  info:    { Icon: Info,          label: 'ข้อมูล' },
};

// The `ink` half of each pair, not the fill half: every toast puts white text
// on this background, and white on bg-success is 2.54:1 (bg-danger 3.76). On
// the ink tones the same white is 5.48 and 6.47. brand-600 already carries
// white at 5.17.
const COLORS = {
  success: 'bg-success-ink',
  error: 'bg-danger-ink',
  info: 'bg-brand-600',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  // Stable context object — getter pattern ensures addToast is always current
  const [ctx] = useState(() => ({
    get success() { return (msg) => addToast(msg, 'success'); },
    get error() { return (msg) => addToast(msg, 'error', 5000); },
    get info() { return (msg) => addToast(msg, 'info'); },
  }));

  // A 429 anywhere in the app (axios interceptor or the export download) shows
  // the server's Thai message once, instead of each page's generic failure.
  useEffect(() => {
    const onRateLimited = (e) => addToast(e.detail?.message, 'error', 6000);
    window.addEventListener(RATE_LIMIT_EVENT, onRateLimited);
    return () => window.removeEventListener(RATE_LIMIT_EVENT, onRateLimited);
  }, [addToast]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast container — top centre, just under the top bar. It used to sit
          bottom-right, exactly where row actions (เช็กชื่อ / ยกเลิก / แก้ไข)
          live, and covered them for 3.5 s after every save (live QA vis-15).
          Toasts carry no controls, so they never take clicks either. */}
      <div
        className="fixed inset-x-0 z-toast flex flex-col items-center gap-2 px-4 pointer-events-none"
        role="status"
        aria-live="polite"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.25rem)' }}
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastSlide
              key={t.id}
              className={`max-w-md flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm shadow-lg ${COLORS[t.type]}`}
            >
              {(() => {
                const { Icon, label } = ICONS[t.type] || ICONS.info;
                return (
                  <>
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={2.4} aria-hidden="true" />
                    <span className="sr-only">{label}:</span>
                  </>
                );
              })()}
              <span>{t.message}</span>
            </ToastSlide>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
