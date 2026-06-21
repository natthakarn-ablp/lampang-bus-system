import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// Searchable vehicle picker (combobox) — replaces a native <select> so an operator
// can TYPE to filter a long fleet (100+ vehicles) instead of scrolling an iOS
// picker. Plate matching is space/dash-insensitive so "นข2833" finds "นข 2833 ลำปาง".
// Drop-in for the student vehicle assignment: value = vehicle id ('' = none).
const norm = (s) => String(s || '').toLowerCase().replace(/[\s-]/g, '');

export default function VehicleSelect({ vehicles = [], value, onChange, placeholder = 'พิมพ์ทะเบียนเพื่อค้นหา…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  const label = (v) => `${v.display_plate || v.plate_no}${v.vehicle_type ? ` (${v.vehicle_type})` : ''}`;
  const selected = vehicles.find((v) => v.id === value) || null;

  // Hide province-variant duplicates, but always keep the currently-assigned one.
  const visible = useMemo(
    () => vehicles.filter((v) => !v.duplicate_candidate || v.id === value),
    [vehicles, value]
  );
  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return visible;
    return visible.filter((v) => norm(label(v)).includes(q) || norm(v.compact_plate).includes(q));
  }, [visible, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  function pick(id) { onChange(id); setOpen(false); setQuery(''); }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2.5 text-base text-left bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'text-gray-800 truncate' : 'text-gray-400'}>
          {selected ? label(selected) : '— ไม่มีรถ —'}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" strokeWidth={2} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-md pl-8 pr-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            <li>
              <button type="button" onClick={() => pick('')}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${!value ? 'text-blue-700 font-medium bg-blue-50' : 'text-gray-500'}`}>
                — ไม่มีรถ —
              </button>
            </li>
            {filtered.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => pick(v.id)}
                  className={`w-full text-left px-3 py-2 text-base hover:bg-blue-50 transition ${v.id === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-800'}`}>
                  {label(v)}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-gray-400 text-center">ไม่พบรถที่ตรงกับ “{query}”</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
