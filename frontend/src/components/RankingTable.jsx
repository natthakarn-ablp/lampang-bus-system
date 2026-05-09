import { Trophy } from 'lucide-react';
import LeaderboardRow from './LeaderboardRow';
import EmptyState from './EmptyState';

/**
 * Ranking section header + leaderboard rows.
 * Used by MonthlyReport and SummaryReport for top/bottom rankings.
 *
 * Public API preserved from the original table-based version:
 *   title       — section heading
 *   items       — array of school or vehicle records
 *   nameKey     — 'school_name' (default) or 'plate_no'
 *   showSchool  — when true, render item.school_names as subtext
 *                 (used for vehicle rankings to show the schools served)
 */
export default function RankingTable({ title, items, nameKey = 'school_name', showSchool = false }) {
  return (
    <section>
      <header className="px-1 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
      </header>

      {items.length === 0 ? (
        <EmptyState icon={Trophy} title="ไม่มีข้อมูล" compact />
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <LeaderboardRow
              key={item.school_id || item.vehicle_id || i}
              rank={i + 1}
              name={item[nameKey]}
              subtext={showSchool ? item.school_names : null}
              morningKpi={item.morning_kpi}
              eveningKpi={item.evening_kpi}
              emergency={item.emergency_count ?? 0}
              highlighted={i === 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
