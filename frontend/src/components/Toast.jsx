import { useState, useCallback, createContext, useContext } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

const COLORS = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  info: 'bg-blue-600',
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

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast container — fixed bottom-right; lifts above bottom nav when --app-bottom-nav is set */}
      <div
        className="fixed right-4 z-50 flex flex-col gap-2 pointer-events-none"
        style={{ bottom: 'calc(1rem + var(--app-bottom-nav, 0px))' }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm shadow-lg animate-slide-in ${COLORS[t.type]}`}
          >
            <span className="font-semibold text-base leading-none">{ICONS[t.type]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
