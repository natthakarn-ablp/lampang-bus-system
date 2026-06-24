const COLS = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

export default function KPIGrid({ cols = 4, gap = 'md', stagger = true, className = '', children }) {
  const gapCls = gap === 'sm' ? 'gap-3' : gap === 'lg' ? 'gap-6' : 'gap-4';
  // Cards reveal in sequence as the dashboard data lands (motion-with-evidence).
  // motion-safe so reduced-motion users see them instantly.
  const staggerCls = stagger ? 'motion-safe:stagger-children' : '';
  return (
    <div className={`grid ${COLS[cols] || COLS[4]} ${gapCls} ${staggerCls} ${className}`}>
      {children}
    </div>
  );
}
