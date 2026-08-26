import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * ConfirmDialog — confirmation for destructive or irreversible actions.
 *
 * Replaces `window.confirm`, which cannot say what is about to happen beyond
 * one line of plain text, cannot be styled, cannot mark a destructive action as
 * destructive, and blocks the whole tab.
 *
 * Accessibility: role="alertdialog", labelled and described by its own content,
 * Escape closes, focus is trapped while open, focus starts on the CANCEL
 * button (never on the destructive one — a stray Enter should not delete), and
 * focus returns to the trigger on close.
 *
 * `itemName` renders the affected record so the user can confirm they are
 * acting on the right row. Pass only what is safe to display — for a person,
 * a username or display name, never an identifier like a national ID.
 *
 * `children` is for the rare confirmation that needs an input before it can
 * proceed — an import rollback has to record why. Pair it with
 * `confirmDisabled` so the destructive button stays unavailable until that
 * input is filled in.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  itemName,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  tone = 'danger',
  loading = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}) {
  // Ids were hard-coded, so two dialogs mounted at once pointed both panels'
  // aria-labelledby at the first one's heading.
  const uid = useId();
  const panelRef = useRef(null);
  const cancelRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (open) restoreRef.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the safe choice, not the destructive one.
    cancelRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); return; }
      if (e.key !== 'Tab') return;
      // Not just buttons: a dialog with a required reason field has to keep
      // that field inside the trap, or Tab walks straight past it.
      const items = Array.from(
        panelRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) ?? []
      );
      if (!items.length) return;
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
  }, [open, onCancel]);

  if (!open) return null;

  const confirmTone = tone === 'danger'
    ? 'bg-danger hover:bg-danger/90 active:bg-danger text-white'
    : 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white';

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/60 motion-safe:animate-fade-in" onClick={onCancel} aria-hidden="true" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-desc`}
        className="relative w-full max-w-md bg-surface-raised rounded-2xl shadow-overlay p-5 motion-safe:animate-scale-in"
      >
        <div className="flex items-start gap-3">
          <span className={`shrink-0 w-10 h-10 rounded-full inline-flex items-center justify-center ${tone === 'danger' ? 'bg-danger-soft' : 'bg-brand-50'}`}>
            <AlertTriangle className={`w-5 h-5 ${tone === 'danger' ? 'text-danger' : 'text-brand-700'}`} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={`${uid}-title`} className="text-base font-semibold text-ink leading-tight">{title}</h2>
            <div id={`${uid}-desc`} className="mt-1.5 text-sm text-ink-muted space-y-1.5">
              {itemName && (
                <p className="font-medium text-ink break-words">{itemName}</p>
              )}
              {description && <p>{description}</p>}
            </div>
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="focus-ring inline-flex items-center justify-center px-4 min-h-[44px] rounded-lg border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface active:bg-surface-border transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={`focus-ring inline-flex items-center justify-center px-4 min-h-[44px] rounded-lg text-sm font-semibold transition disabled:opacity-60 disabled:pointer-events-none ${confirmTone}`}
          >
            {loading ? 'กำลังดำเนินการ…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
