export default function DashboardCard({ label, value, sub, color = 'brand' }) {
  const colors = {
    brand:    'bg-brand-50  border-brand-200  text-brand-700',
    success:  'bg-success-soft border-success/20 text-success',
    warn:     'bg-warn-soft    border-warn/20    text-warn',
    danger:   'bg-danger-soft  border-danger/20  text-danger',
    'ink-muted': 'bg-surface  border-surface-border text-ink-muted',
  };

  return (
    <div className={`rounded-xl border p-5 ${colors[color] || colors.brand}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value ?? '–'}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}
