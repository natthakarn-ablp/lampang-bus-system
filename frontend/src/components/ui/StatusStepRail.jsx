import { AlertTriangle, CheckCircle2, Circle, Clock3 } from 'lucide-react';

const STATUS_STYLE = {
  complete: {
    dot: 'bg-success-soft text-success ring-success/25',
    line: 'bg-success',
    label: 'text-ink',
    icon: CheckCircle2,
  },
  current: {
    dot: 'bg-brand-50 text-brand-700 ring-brand-700/25',
    line: 'bg-brand-600',
    label: 'text-ink',
    icon: Clock3,
  },
  warning: {
    dot: 'bg-warn-soft text-warn ring-warn/25',
    line: 'bg-warn',
    label: 'text-ink',
    icon: AlertTriangle,
  },
  danger: {
    dot: 'bg-danger-soft text-danger ring-danger/25',
    line: 'bg-danger',
    label: 'text-ink',
    icon: AlertTriangle,
  },
  upcoming: {
    dot: 'bg-surface text-ink-muted ring-surface-border',
    line: 'bg-surface-border',
    label: 'text-ink-muted',
    icon: Circle,
  },
};

const GRID_BY_COUNT = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

function resolveStatus(step, currentKey) {
  if (step.status) return step.status;
  if (currentKey && step.key === currentKey) return 'current';
  return 'upcoming';
}

export default function StatusStepRail({
  steps,
  currentKey,
  className = '',
  ariaLabel = 'ขั้นตอนการทำงาน',
}) {
  return (
    <ol
      className={`grid gap-3 ${GRID_BY_COUNT[Math.min(Math.max(steps.length, 1), 4)]} ${className}`}
      aria-label={ariaLabel}
    >
      {steps.map((step, index) => {
        const status = resolveStatus(step, currentKey);
        const style = STATUS_STYLE[status] || STATUS_STYLE.upcoming;
        const Icon = style.icon;
        return (
          <li key={step.key} className="relative min-w-0">
            {index > 0 && (
              <span
                className={`absolute -left-3 top-5 hidden h-0.5 w-3 sm:block ${style.line}`}
                aria-hidden="true"
              />
            )}
            <div className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-raised p-3 shadow-soft">
              <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ${style.dot}`}>
                <Icon className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold leading-tight ${style.label}`}>
                  {step.label}
                </span>
                {step.description && (
                  <span className="mt-1 block text-xs leading-5 text-ink-muted">
                    {step.description}
                  </span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
