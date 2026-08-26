import { Search, X } from 'lucide-react';

/**
 * FilterBar — search + filters + result count for a list page.
 *
 * The list pages each rolled their own: a bare <input> with a placeholder and
 * no accessible name, `border-2 border-gray-200` instead of tokens, a focus
 * ring that differed page to page, no way to clear the filters, and no
 * statement of how many results the filters produced.
 *
 * search:  { value, onChange, placeholder, label }   label is the accessible
 *          name — a placeholder is not one, it disappears once typing starts.
 * filters: [{ key, label, value, onChange, options: [[value, label], …] }]
 * count / countLabel: result summary, e.g. 276 / 'ผู้ใช้งาน'
 */
export default function FilterBar({
  search,
  filters = [],
  chips,
  count,
  countLabel = 'รายการ',
  onClear,
  actions,
  className = '',
}) {
  const hasActiveFilter = Boolean(search?.value) || filters.some(f => f.value);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* A small, fixed set of mutually exclusive states reads better as chips
          than a select. Rendered as a radiogroup so arrow keys and screen
          readers treat it as the single choice it is. */}
      {chips && chips.options.length > 0 && (
        <div
          role="radiogroup"
          aria-label={chips.label}
          className="flex flex-wrap gap-1.5"
        >
          {chips.options.map(([value, label]) => {
            const active = chips.value === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chips.onChange(value)}
                className={`focus-ring inline-flex items-center min-h-[44px] px-3.5 rounded-full border text-sm font-medium transition ${
                  active
                    ? 'bg-navy-700 text-white border-navy-700'
                    : 'bg-surface-raised text-ink-muted border-surface-border hover:bg-surface hover:text-ink active:bg-surface-border'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {(search || filters.length > 0 || actions) && (
      <div className="flex flex-col sm:flex-row gap-2.5">
        {search && (
          <div className="relative flex-1 min-w-0">
            <label htmlFor="filterbar-search" className="sr-only">
              {search.label || 'ค้นหา'}
            </label>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none"
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              id="filterbar-search"
              type="search"
              value={search.value}
              onChange={e => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              /* 16px so iOS does not zoom the viewport on focus */
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg pl-9 pr-3 min-h-[44px] text-base sm:text-sm text-ink placeholder:text-ink-muted transition"
            />
          </div>
        )}

        {filters.map(f => (
          <div key={f.key} className="sm:w-48">
            {/* Date filters keep a visible label — "ตั้งแต่" and "ถึง" are not
                self-evident from an empty date box the way a select's current
                option is. */}
            <label
              htmlFor={`filterbar-${f.key}`}
              className={f.type === 'date' ? 'block text-caption text-ink-muted mb-1' : 'sr-only'}
            >
              {f.label}
            </label>
            {f.type === 'date' ? (
              <input
                id={`filterbar-${f.key}`}
                type="date"
                value={f.value}
                onChange={e => f.onChange(e.target.value)}
                className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition"
              />
            ) : (
              <select
                id={`filterbar-${f.key}`}
                value={f.value}
                onChange={e => f.onChange(e.target.value)}
                className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition"
              >
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </div>
        ))}

        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      )}

      {(count !== undefined || hasActiveFilter) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {count !== undefined && (
            <p className="text-sm text-ink-muted" aria-live="polite">
              {hasActiveFilter ? 'พบ ' : 'ทั้งหมด '}
              <span className="font-semibold text-ink tabular-nums">{count.toLocaleString('th-TH')}</span>
              {' '}{countLabel}
            </p>
          )}
          {hasActiveFilter && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] rounded-lg text-sm font-medium text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
            >
              <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
              ล้างตัวกรอง
            </button>
          )}
        </div>
      )}
    </div>
  );
}
