import { tone } from './tone';

const R = 36;
const C = 2 * Math.PI * R;

/**
 * KpiRingCard — one headline number.
 *  - `pct` given (0–100)  → a progress ring with the percent inside.
 *  - otherwise            → a round badge holding `value` (a count or a short word).
 * Every card carries a word chip (`chip`, default the tone's word) so status is
 * never colour alone.
 */
export default function KpiRingCard({ label, pct = null, value, sub, variant = 'info', chip, onClick }) {
  const t = tone(variant);
  const hasRing = pct != null && isFinite(pct);
  const shown = Math.max(0, Math.min(100, Number(pct) || 0));
  const Tag = onClick ? 'button' : 'div';
  const valueText = value == null ? '' : (typeof value === 'number' ? value.toLocaleString('th-TH') : String(value));
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-4 flex items-center gap-4 text-left ${onClick ? 'focus-ring hover:shadow-elevate transition cursor-pointer' : ''}`}
    >
      {hasRing ? (
        <div className="relative w-[84px] h-[84px] shrink-0">
          <svg width="84" height="84" viewBox="0 0 88 88" aria-hidden="true">
            <circle cx="44" cy="44" r={R} fill="none" stroke="#E2E8F0" strokeWidth="10" />
            <circle
              cx="44" cy="44" r={R} fill="none" stroke={t.ring} strokeWidth="10"
              strokeDasharray={`${(shown / 100) * C} ${C}`} transform="rotate(-90 44 44)"
              className="transition-all duration-500"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-ink tabular-nums">{shown}%</span>
        </div>
      ) : (
        <span
          className={`w-[84px] h-[84px] shrink-0 rounded-full inline-flex items-center justify-center font-bold tabular-nums text-center leading-tight px-1 ${t.soft} ${t.ink} ${valueText.length > 4 ? 'text-base' : 'text-3xl'}`}
        >
          {valueText}
        </span>
      )}
      <div className="min-w-0 flex flex-col gap-1">
        <p className="font-semibold text-ink leading-snug">{label}</p>
        {sub && <p className="text-sm text-ink-muted leading-snug">{sub}</p>}
        <span className={`self-start text-xs font-semibold rounded-full px-2.5 py-0.5 ${t.soft} ${t.ink}`}>{chip || t.word}</span>
      </div>
    </Tag>
  );
}
