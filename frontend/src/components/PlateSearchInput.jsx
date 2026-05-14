import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * PlateSearchInput — text-input for filtering by vehicle plate number,
 * with optional autocomplete suggestions.
 *
 * Backward-compatible: when `suggestions` is omitted or empty, this
 * component behaves identically to the original plain <input> — pages
 * that don't have a vehicles array handy keep working unchanged.
 *
 * When `suggestions` is supplied (typically the same `vehicles` array
 * the page is already rendering), a small popover appears below the
 * input as the user types, listing up to `maxSuggestions` matching
 * plates. Click or Enter fills the input with the full plate string;
 * the parent's onChange is the only API for that value.
 *
 * Props:
 *   value            — current input text
 *   onChange         — (text) => void
 *   placeholder      — optional
 *   suggestions      — optional array of objects with at least
 *                      { plate_no }, ideally also { driver_name,
 *                      school_name | school_names, vehicle_type }
 *   maxSuggestions   — default 8
 *
 * Matching rule (OR):
 *   normalize(plate_no).includes(normalize(query))      // space-insensitive
 *   driver_name      .toLocaleLowerCase('th').includes(q)
 *   school_name(s)   .toLocaleLowerCase('th').includes(q)
 *
 * The normalize() helper collapses whitespace so users can search
 *   "นข1571"     → matches  "นข 1571 ลำปาง"
 *   "1589"       → matches  "1 นค 1589 กรุงเทพมหานคร"
 *   "ลำปาง"      → matches the province suffix
 */
function normalizePlateSearch(s) {
  return String(s || '').toLocaleLowerCase('th').replace(/\s+/g, '');
}

export default function PlateSearchInput({
  value,
  onChange,
  placeholder,
  suggestions,
  maxSuggestions = 8,
  // Phase 9.12 — optional styling overrides so callers can fit the input
  // into wider layouts (admin support page, dashboard headers, etc.) and
  // attach a leading icon. All three default to the original Phase 9.9
  // styling so the six existing consumers keep working without changes.
  className,
  inputClassName,
  leadingIcon,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const wrapRef = useRef(null);
  const listboxRef = useRef(null);
  const listboxId = useId();

  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;

  const filtered = useMemo(() => {
    if (!hasSuggestions) return [];
    const q = String(value || '').trim();
    if (!q) return [];
    const qLower = q.toLocaleLowerCase('th');
    const qNorm  = normalizePlateSearch(q);
    const matches = [];
    for (const v of suggestions) {
      if (!v || !v.plate_no) continue;
      const plateNorm = normalizePlateSearch(v.plate_no);
      const driver = String(v.driver_name || '').toLocaleLowerCase('th');
      const school = String(v.school_name || v.school_names || '').toLocaleLowerCase('th');
      if (
        plateNorm.includes(qNorm) ||
        (driver && driver.includes(qLower)) ||
        (school && school.includes(qLower))
      ) {
        matches.push(v);
        if (matches.length >= maxSuggestions) break;
      }
    }
    return matches;
  }, [suggestions, value, maxSuggestions, hasSuggestions]);

  const showPopover = open && hasSuggestions && filtered.length > 0;

  // Reset highlight whenever the visible suggestion list changes.
  useEffect(() => { setHighlight(0); }, [filtered]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep keyboard-highlighted item in view on long lists.
  useEffect(() => {
    if (!showPopover || !listboxRef.current) return;
    listboxRef.current.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, showPopover]);

  function pick(item) {
    onChange(item.plate_no);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!showPopover) return; // fall through to default input behavior
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Pressing Enter while suggestions are visible picks the highlight.
      // Without suggestions visible, the input keeps its default behavior
      // (form submit / no-op for our consumers).
      const item = filtered[highlight];
      if (item) {
        e.preventDefault();
        pick(item);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  function metaText(v) {
    if (v.driver_name) return v.driver_name;
    if (v.school_name) return v.school_name;
    if (v.school_names) return v.school_names;
    if (v.affiliation_name) return v.affiliation_name;
    if (v.vehicle_type) return v.vehicle_type;
    return '';
  }

  const wrapperCls = className || 'w-full sm:w-64';
  const inputCls = inputClassName ||
    'w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div ref={wrapRef} className={`relative ${wrapperCls}`}>
      {leadingIcon && (
        <span
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none flex items-center"
        >
          {leadingIcon}
        </span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || 'ค้นหาทะเบียนรถ…'}
        className={inputCls}
        role={hasSuggestions ? 'combobox' : undefined}
        aria-expanded={hasSuggestions ? showPopover : undefined}
        aria-controls={hasSuggestions ? listboxId : undefined}
        aria-autocomplete={hasSuggestions ? 'list' : undefined}
      />

      {showPopover && (
        <ul
          id={listboxId}
          role="listbox"
          ref={listboxRef}
          className="absolute z-30 top-full left-0 right-0 mt-1 max-h-[40vh] sm:max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1"
        >
          {filtered.map((v, i) => {
            const isHighlighted = i === highlight;
            const meta = metaText(v);
            return (
              <li
                key={`${v.plate_no}-${i}`}
                role="option"
                aria-selected={isHighlighted}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(v)}
                className={`px-3 py-2 text-sm cursor-pointer ${isHighlighted ? 'bg-blue-50' : ''}`}
              >
                <p className="font-medium text-gray-800 truncate">{v.plate_no}</p>
                {meta && <p className="text-xs text-gray-500 truncate">{meta}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
