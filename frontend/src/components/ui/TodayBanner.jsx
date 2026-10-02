import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, ArrowRight } from 'lucide-react';
import { tone } from './tone';

const ICONS = { success: CheckCircle2, warn: AlertTriangle, danger: AlertOctagon, info: Info, neutral: Info };

/**
 * TodayBanner — the one-sentence summary at the top of every dashboard.
 * One tone, one title, one sub line, at most one call to action.
 * `cta` = { label, to } for a route or { label, onClick } for an in-page action.
 */
export default function TodayBanner({ variant = 'info', title, sub, cta, className = '' }) {
  const t = tone(variant);
  const Icon = ICONS[variant] || Info;
  const ctaCls = `focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white ${t.solid} hover:opacity-90 transition shrink-0`;
  return (
    <section
      aria-label="สรุปวันนี้"
      className={`flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${t.soft} ${t.border} ${className}`}
    >
      <span className={`w-12 h-12 rounded-full ${t.solid} text-white inline-flex items-center justify-center shrink-0`}>
        <Icon className="w-6 h-6" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <div className={`flex-1 min-w-[200px] ${t.ink}`}>
        <p className="text-lg sm:text-xl font-bold leading-snug">{title}</p>
        {sub && <p className="text-sm mt-0.5 text-pretty">{sub}</p>}
      </div>
      {cta && (cta.to ? (
        <Link to={cta.to} className={ctaCls}>{cta.label}<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
      ) : (
        <button type="button" onClick={cta.onClick} className={ctaCls}>{cta.label}<ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
      ))}
    </section>
  );
}
