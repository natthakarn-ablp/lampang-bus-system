import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * RowActionMenu — the "เพิ่มเติม" overflow menu for a table row or card.
 *
 * A list row keeps one visible primary action (TableAction) and puts the rest
 * here, so a wide table does not carry three or four buttons on every line.
 *
 *   <RowActionMenu label="การจัดการเพิ่มเติมของ …">
 *     <RowActionMenuItem onClick={…}>เปลี่ยนรถ</RowActionMenuItem>
 *   </RowActionMenu>
 *
 * The popup is position:fixed so the DataTable's scroll region cannot clip it
 * on the last rows. Keyboard: Enter/Space/ArrowDown opens and focuses the first
 * item, ArrowUp/ArrowDown/Home/End move, Escape closes and returns focus to the
 * trigger, Tab closes. A click outside or a resize also closes it; on scroll
 * the menu follows its trigger.
 */
const MenuContext = createContext(null);

export default function RowActionMenu({ label, buttonText = 'เพิ่มเติม', disabled = false, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const focusFirst = useRef(false);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Place the menu under the trigger, right-aligned; flip above when the
  // viewport has no room below. Re-run on scroll so the menu follows its row.
  const place = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    const gap = 4;
    const below = t.bottom + gap + m.height <= window.innerHeight - 8;
    const top = below ? t.bottom + gap : Math.max(8, t.top - gap - m.height);
    const left = Math.min(Math.max(8, t.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open || !pos) return;
    if (focusFirst.current) { items()[0]?.focus({ preventScroll: true }); focusFirst.current = false; }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    }
    function onResize() { close(); }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close, place]);

  function onTriggerKeyDown(e) {
    if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && !open)) {
      e.preventDefault();
      focusFirst.current = true;
      if (open) items()[0]?.focus({ preventScroll: true });
      else setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  }

  function onMenuKeyDown(e) {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus({ preventScroll: true }); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus({ preventScroll: true }); }
    else if (e.key === 'Tab') { close(); }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className="focus-ring inline-flex items-center justify-center gap-1 whitespace-nowrap px-3 min-w-[44px] min-h-[44px] rounded-lg text-sm font-medium transition text-ink bg-surface hover:bg-surface-border active:bg-surface-border disabled:opacity-50 disabled:pointer-events-none"
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        {buttonText}
      </button>
      {open && (
        <MenuContext.Provider value={close}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="z-50 min-w-[12rem] py-1 rounded-xl border border-surface-border bg-surface-raised shadow-lg"
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </>
  );
}

export function RowActionMenuItem({ onClick, disabled, children }) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={() => { close?.(true); onClick?.(); }}
      className="focus-ring w-full min-h-[44px] px-4 text-left text-sm text-ink hover:bg-surface focus:bg-surface disabled:opacity-50"
    >
      {children}
    </button>
  );
}
