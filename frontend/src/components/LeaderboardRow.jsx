import { AlertTriangle } from 'lucide-react';
import AppCard from './ui/AppCard';
import StatusBadge from './ui/StatusBadge';
import { kpiVariant, safePct } from '../utils/kpi';

/**
 * LeaderboardRow — single ranked entry for top/bottom tables.
 *
 * Designed for ranking contexts (RankingTable). Shows a circular rank badge,
 * primary name + optional subtext, and right-aligned KPI pills. First place
 * (highlighted) gets a brand-filled rank badge for visual emphasis.
 *
 * Props:
 *   rank        — 1-based position
 *   name        — primary label
 *   subtext     — optional secondary line (e.g. schools served by a vehicle)
 *   morningKpi  — % (null/undefined → "ยังไม่เริ่ม")
 *   eveningKpi  — %
 *   emergency   — count; only renders a danger badge when > 0
 *   highlighted — bool; first-place visual emphasis
 */
export default function LeaderboardRow({
  rank,
  name,
  subtext,
  morningKpi,
  eveningKpi,
  emergency = 0,
  highlighted = false,
}) {
  const rankCls = highlighted
    ? 'bg-brand-700 text-white'
    : 'bg-brand-50 text-brand-700';

  return (
    <AppCard padding="md" className="flex items-center gap-3">
      <span
        className={`shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-semibold tabular-nums ${rankCls}`}
        aria-label={`อันดับที่ ${rank}`}
      >
        {rank}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{name}</p>
        {subtext && (
          <p className="text-xs text-ink-muted truncate mt-0.5">{subtext}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <KpiPill label="เช้า" value={morningKpi} />
        <KpiPill label="เย็น" value={eveningKpi} />
        {emergency > 0 && (
          <StatusBadge variant="danger" size="sm" icon={AlertTriangle}>
            {emergency}
          </StatusBadge>
        )}
      </div>
    </AppCard>
  );
}

function KpiPill({ label, value }) {
  const variant = kpiVariant(value);
  return (
    <StatusBadge variant={variant} size="sm">
      <span className="text-ink-muted/70 mr-0.5">{label}</span>
      <span className="tabular-nums">{safePct(value)}</span>
    </StatusBadge>
  );
}
