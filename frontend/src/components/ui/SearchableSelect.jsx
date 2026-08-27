import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

// Phase 9.8B — popover height upper-bound estimate used for placement
// decisions: ~40 px search row + worst-case list height (240 px desktop
// max-h-60, 40vh mobile). 280 covers the desktop case and is close enough
// to the mobile case that the heuristic still produces stable results.
const POPOVER_ESTIMATE = 280;

/**
 * SearchableSelect — lightweight name-first combobox.
 *
 * Trigger button shows the current selection's label (or `placeholder` when
 * cleared). Click/Enter opens a popover with a Thai-friendly search input
 * and the filtered option list. Selecting an option emits the option's
 * `value` via onChange — the calling page treats it the same way it
 * treats a plain <select>.
 *
 * Props:
 *   label       — field label
 *   value       — currently selected option value (or '')
 *   onChange    — (value) => void
 *   options     — [{ value, label }]   (consumers can use uniqOptions)
 *   placeholder — empty-state hint shown when value is '' (e.g. "เลือกโรงเรียน")
 *   searchPlaceholder — hint inside the search input (default "ค้นหา…")
 *
 * Keyboard:
 *   Enter / Space / ArrowDown on trigger → open
 *   ArrowUp / ArrowDown                  → move highlight
 *   Enter                                → select highlighted
 *   Esc                                  → close (and clear search)
 *
 * Tailwind only; no external dependencies.
 */
export default function SearchableSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'เลือกรายการ',
  searchPlaceholder = 'ค้นหา…',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  // Phase 9.8B — 'bottom' (default) or 'top' when there's no room below.
  const [placement, setPlacement] = useState('bottom');

  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const listboxRef = useRef(null);
  const listboxId = useId();

  const selected = useMemo(
    () => options.find(o => String(o.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('th');
    if (!q) return options;
    return options.filter(o => String(o.label).toLocaleLowerCase('th').includes(q));
  }, [options, query]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Focus the search input when opening
  useEffect(() => {
    if (open && searchRef.current) {
      // microtask so the input is mounted
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Phase 9.5 — keep the keyboard-highlighted option in view on long lists.
  useEffect(() => {
    if (!open || !listboxRef.current) return;
    const el = listboxRef.current.children[highlight];
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // Phase 9.8B — pick 'top' placement only when there isn't enough room
  // below AND there's actually more room above. Defaults to 'bottom'
  // (matches user expectation in most cases). Measured synchronously
  // before paint so the popover never flashes in the wrong position.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function measure() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = viewportH - rect.bottom;
      const spaceAbove = rect.top;
      const shouldFlip = spaceBelow < POPOVER_ESTIMATE && spaceAbove > spaceBelow;
      setPlacement(shouldFlip ? 'top' : 'bottom');
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  function pick(opt) {
    onChange(opt.value);
    closeAndReset();
  }

  function onTriggerKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onSearchKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) pick(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAndReset();
    }
  }

  function clear(e) {
    e.stopPropagation();
    onChange('');
    closeAndReset();
  }

  return (
    <label className={`flex flex-col text-xs text-ink-muted w-full sm:w-auto sm:min-w-[160px] relative ${className}`} ref={wrapRef}>
      <span className="mb-1">{label}</span>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="focus-ring text-base sm:text-sm border border-surface-border rounded-lg pl-3 pr-9 bg-surface-raised text-ink min-h-[44px] text-left flex items-center gap-2 hover:bg-surface transition relative"
      >
        <span className={`flex-1 truncate ${selected ? 'text-ink' : 'text-ink-muted'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={-1}
            onClick={clear}
            aria-label="ล้างการเลือก"
            className="absolute right-7 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-border text-ink-muted"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
        )}
        <ChevronDown
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className={`absolute z-40 left-0 right-0 bg-surface-raised border border-surface-border rounded-lg shadow-elevate overflow-hidden ${
          placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          <div className="relative border-b border-surface-border">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" strokeWidth={2} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={searchPlaceholder}
              className="w-full text-base sm:text-sm bg-transparent pl-8 pr-3 min-h-[44px] outline-none text-ink"
              aria-controls={listboxId}
              aria-autocomplete="list"
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            ref={listboxRef}
            className="max-h-[40vh] sm:max-h-60 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted text-center">ไม่พบรายการ</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = String(opt.value) === String(value);
                const isHighlighted = i === highlight;
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(opt)}
                    className={`px-3 min-h-[44px] flex items-center text-sm cursor-pointer truncate ${
                      isHighlighted ? 'bg-brand-50' : ''
                    } ${isSelected ? 'font-semibold text-brand-700' : 'text-ink'}`}
                  >
                    {opt.label}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </label>
  );
}
