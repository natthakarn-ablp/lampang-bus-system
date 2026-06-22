import { useState, useEffect } from 'react';

// Pagination with a jump-to-page input — type a page number + Enter (or blur) to
// jump straight there instead of tapping ถัดไป one page at a time (painful at
// 28 pages). Clamps to [1, totalPages]. onPage(n) loads that page.
export default function Pagination({ page, totalPages, total = null, shown = null, onPage }) {
  const [input, setInput] = useState(String(page));
  useEffect(() => { setInput(String(page)); }, [page]);

  function jump() {
    const n = Math.max(1, Math.min(totalPages, parseInt(input, 10) || 1));
    setInput(String(n));
    if (n !== page) onPage(n);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 text-sm text-gray-500">
      {total != null && <span>แสดง {shown != null ? shown : ''} จาก {total}</span>}
      <div className="flex gap-2 items-center">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-30 text-sm min-h-[40px]"
        >
          ก่อนหน้า
        </button>

        <div className="flex items-center gap-1">
          <span>หน้า</span>
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
            className="w-14 text-center border border-gray-300 rounded-md py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="tabular-nums whitespace-nowrap">/ {totalPages}</span>
        </div>

        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-30 text-sm min-h-[40px]"
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}
