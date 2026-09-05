import AppCard from './AppCard';

/**
 * LiveKpiCard — compact KPI tile used on live-vehicle and similar
 * monitoring pages (School / Affiliation / Province / Admin).
 *
 * Distinct from KPIStat (used on dashboards): smaller padding, icon
 * inline with the metric instead of a separate tile, value rendered at
 * text-xl so a 6-up row fits on tablet without wrapping.
 *
 * Props:
 *   icon    — lucide-react component, rendered at 5x5
 *   label   — short metric name (truncated to one line)
 *   value   — number or string
 *   variant — 'success' | 'warn' | 'brand' | 'neutral' (default)
 */
const TONE = {
  success: 'text-success-ink',
  warn:    'text-warn-ink',
  brand:   'text-brand',
  neutral: 'text-ink-muted',
};

export default function LiveKpiCard({ icon: Icon, label, value, variant = 'neutral' }) {
  const tone = TONE[variant] || TONE.neutral;
  return (
    <AppCard padding="sm">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`shrink-0 ${tone}`}>
            <Icon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-ink-muted leading-tight truncate">{label}</p>
          <p className="text-xl font-semibold text-ink tabular-nums">{value}</p>
        </div>
      </div>
    </AppCard>
  );
}
