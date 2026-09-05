/**
 * Skeleton loaders — reusable shimmer placeholders.
 * Use instead of plain "กำลังโหลด…" text for a better perceived loading UX.
 *
 * Basic:
 *   <Skeleton className="h-6 w-32" />
 *
 * Preset compositions:
 *   <SkeletonCard />         — a single card-sized block
 *   <SkeletonList rows={5} /> — a list of rows
 *   <SkeletonTable cols={4} rows={5} />
 *   <PageLoading />          — centered spinner + text, full-height
 */

export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:400%_100%] rounded ${className}`}
      style={{ animation: 'skeleton-shimmer 1.4s ease-in-out infinite' }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-2 w-full mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function SkeletonKpiGrid({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-white">
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-3/5 mb-1.5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 p-3 flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="p-3 flex gap-3 border-b border-gray-100 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-height centered spinner with label */
export function PageLoading({ label = 'กำลังโหลด…' }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
        <p className="text-sm text-ink-muted">{label}</p>
      </div>
    </div>
  );
}

/** Inline centered spinner (smaller, for within-card loading) */
export function InlineLoading({ label = 'กำลังโหลด…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-ink-muted text-sm">
      <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
