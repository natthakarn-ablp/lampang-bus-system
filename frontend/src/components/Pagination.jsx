import { useState, useEffect } from 'react';

// Pagination with a jump-to-page input — type a page number + Enter (or blur) to
// jump straight there instead of tapping ถัดไป one page at a time (painful at
// 28 pages). Clamps to [1, totalPages]. onPage(n) loads that page.
export default function Pagination({ page, totalPages, total = null, shown = null, unit = '', onPage }) {
  const [input, setInput] = useState(String(page));
  useEffect(() => { setInput(String(page)); }, [page]);

  function jump() {
    const n = Math.max(1, Math.min(totalPages, parseInt(input, 10) || 1));
    setInput(String(n));
    if (n !== page) onPage(n);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 text-sm text-ink-muted">
      {total != null && <span>แสดง {shown != null ? shown : ''} จาก {total}{unit ? ` ${unit}` : ''}</span>}
      <div className="flex gap-2 items-center">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="focus-ring px-4 border border-surface-border bg-surface-raised rounded-lg hover:bg-surface active:bg-surface-border disabled:opacity-30 disabled:pointer-events-none text-sm text-ink min-h-[44px]"
        >
          ก่อนหน้า
        </button>

        <div className="flex items-center gap-1">
          <span className="whitespace-nowrap">หน้า</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jump(); e.currentTarget.blur(); } }}
            onBlur={jump}
            aria-label="ไปยังหน้า"
            className="focus-ring w-16 min-h-[44px] text-center text-base border border-surface-border bg-surface-raised rounded-lg tabular-nums text-ink transition"
          />
          <span className="tabular-nums whitespace-nowrap">/ {totalPages}</span>
        </div>

        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="focus-ring px-4 border border-surface-border bg-surface-raised rounded-lg hover:bg-surface active:bg-surface-border disabled:opacity-30 disabled:pointer-events-none text-sm text-ink min-h-[44px]"
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}
