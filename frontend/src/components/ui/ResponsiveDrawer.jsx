import { useEffect, useRef } from 'react';

/**
 * ResponsiveDrawer — off-canvas panel for mobile navigation.
 *
 * Replaces the hand-rolled overlay in Layout.jsx, which rendered a bare div:
 * no dialog semantics, no Escape, no focus trap, no scroll lock, and focus was
 * left wherever it was when the drawer opened. Those are the four things a
 * keyboard or screen-reader user needs from an off-canvas panel.
 *
 * Behaviour:
 *   - role="dialog" aria-modal, labelled by `title`
 *   - Escape closes
 *   - Tab / Shift+Tab cycle inside the panel while open
 *   - background scroll locked while open
 *   - focus moves into the panel on open and returns to the trigger on close
 */
export default function ResponsiveDrawer({
  open,
  onClose,
  title = 'เมนู',
  side = 'left',
  className = '',
  children,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  // Remember the trigger so focus can go back to it when the drawer closes.
  useEffect(() => {
    if (open) restoreRef.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the panel — first focusable, else the panel itself.
    const focusables = () => Array.from(
      panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter(el => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    (first || panelRef.current)?.focus?.();

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault(); firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Return focus to whatever opened the drawer.
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-drawer md:hidden">
      <div
        className="absolute inset-0 bg-navy-950/60 motion-safe:animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative h-full w-[82vw] max-w-[300px] min-w-[260px] shadow-overlay outline-none motion-safe:animate-slide-in-left ${
          side === 'right' ? 'ml-auto' : ''
        } ${className}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {children}
      </div>
    </div>
  );
}
