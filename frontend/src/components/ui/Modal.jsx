import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Modal — general-purpose dialog for forms and record detail.
 *
 * The per-page modals this replaces were plain divs with an onClick backdrop:
 * no role, no aria-modal, Escape did nothing, Tab walked out into the page
 * behind, the background still scrolled, and focus was left wherever it was
 * when the modal opened.
 *
 * For destructive confirmations use ConfirmDialog instead — it additionally
 * puts initial focus on Cancel so a stray Enter cannot confirm.
 *
 * `size`: 'sm' | 'md' | 'lg'
 *
 * `dismissible={false}` removes every exit that is not an explicit choice in
 * the body: no close button, no Escape, no backdrop click. For a gate the user
 * must answer — the driver's pre-trip safety check — the dialog semantics,
 * focus trap and scroll lock are wanted, and a way to skip it is not.
 */
const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };

export default function Modal({
  open = true,
  title,
  onClose,
  size = 'md',
  footer,
  dismissible = true,
  children,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) restoreRef.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () => Array.from(
      panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    (focusables()[0] || panelRef.current)?.focus?.();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (dismissible) onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-950/60 motion-safe:animate-fade-in"
        onClick={dismissible ? () => onCloseRef.current?.() : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${SIZES[size] || SIZES.md} max-h-[90vh] flex flex-col bg-surface-raised rounded-2xl shadow-overlay outline-none motion-safe:animate-scale-in`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-ink leading-tight">{title}</h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="focus-ring shrink-0 -mr-1.5 -mt-1.5 inline-flex items-center justify-center w-11 h-11 rounded-lg text-ink-muted hover:bg-surface hover:text-ink active:bg-surface-border transition"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="px-5 pb-5 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-surface-border shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
