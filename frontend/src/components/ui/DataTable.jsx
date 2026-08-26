import AppCard from './AppCard';
import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';

/**
 * DataTable — one column definition, two renderings.
 *
 * Every list page in this app authored its rows twice: a <table> for md+ and a
 * hand-built card stack for mobile. The two drifted (different fields shown,
 * different action sizes, different empty text), and every page re-implemented
 * loading / empty / error around them.
 *
 * Here a column is declared once and the component renders the desktop row and
 * the mobile card from the same definition, and owns all four states.
 *
 * columns: [{
 *   key,                  unique id
 *   header,               th text
 *   cell(row),            content — string or node
 *   align,                'left' (default) | 'center' | 'right'
 *   primary,              mobile: card title
 *   secondary,            mobile: card subtitle
 *   badge,                mobile: pinned top-right of the card
 *   hideOnMobile,         omit from the card entirely (keeps cards readable)
 *   numeric,              right-align + tabular-nums
 * }]
 *
 * `actions(row)` renders in the last table column and along the card footer.
 */

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' };

const ACTION_TONE = {
  neutral: 'text-ink bg-surface hover:bg-surface-border active:bg-surface-border',
  brand:   'text-brand-700 bg-brand-50 hover:bg-brand-100 active:bg-brand-200',
  warn:    'text-warn-ink bg-warn-soft hover:bg-warn-soft/70 active:bg-warn-soft',
  danger:  'text-danger-ink bg-danger-soft hover:bg-danger-soft/70 active:bg-danger-soft',
};

/**
 * TableAction — a row-level action button.
 *
 * Row actions were previously written inline on every page with hardcoded
 * blue-50 / amber-50 / red-50 fills at `px-2 py-1`, which put them at roughly
 * 24px tall — well under the 44px target minimum, and inconsistent between the
 * desktop row and the mobile card on the same page.
 */
export function TableAction({ tone = 'neutral', onClick, disabled, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`focus-ring inline-flex items-center justify-center gap-1 whitespace-nowrap px-3 min-w-[44px] min-h-[44px] rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none ${ACTION_TONE[tone] || ACTION_TONE.neutral} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function DataTable({
  columns = [],
  rows = [],
  rowKey = (r, i) => r?.id ?? i,
  actions,
  actionsHeader = 'จัดการ',
  loading = false,
  error = null,
  onRetry,
  empty = {},
  caption,
  rowClassName,
  className = '',
}) {
  if (loading) return <LoadingState />;
  if (error) {
    return <ErrorState title={empty.errorTitle || 'โหลดข้อมูลไม่สำเร็จ'} message={typeof error === 'string' ? error : undefined} onRetry={onRetry} />;
  }
  if (!rows.length) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title || 'ยังไม่มีข้อมูล'}
        description={empty.description}
        action={empty.action}
      />
    );
  }

  const primary   = columns.find(c => c.primary);
  const secondary = columns.find(c => c.secondary);
  const badge     = columns.find(c => c.badge);
  const detail    = columns.filter(c => !c.primary && !c.secondary && !c.badge && !c.hideOnMobile);

  const cellAlign = c => c.numeric ? 'text-right tabular-nums' : (ALIGN[c.align] || ALIGN.left);

  return (
    <div className={className}>
      {/* Desktop — the horizontal scroll lives here, never on <body> */}
      <AppCard padding="none" className="hidden md:block overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
              <tr>
                {columns.map(c => (
                  <th key={c.key} scope="col" className={`px-4 py-3 ${cellAlign(c)}`}>{c.header}</th>
                ))}
                {actions && <th scope="col" className="px-4 py-3 text-center">{actionsHeader}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row, i) => (
                <tr key={rowKey(row, i)} className={`hover:bg-surface transition ${rowClassName ? rowClassName(row) : ''}`}>
                  {columns.map(c => (
                    <td key={c.key} className={`px-4 py-3 text-ink ${cellAlign(c)}`}>{c.cell(row)}</td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1.5">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppCard>

      {/* Mobile — same columns, card shape. No horizontal scrolling to read a row. */}
      <ul className="md:hidden space-y-3">
        {rows.map((row, i) => (
          <li key={rowKey(row, i)}>
            <AppCard padding="md">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {primary && <p className="font-semibold text-ink truncate">{primary.cell(row)}</p>}
                  {secondary && <p className="text-sm text-ink-muted truncate">{secondary.cell(row)}</p>}
                </div>
                {badge && <div className="shrink-0">{badge.cell(row)}</div>}
              </div>

              {detail.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {detail.map(c => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-caption text-ink-muted">{c.header}</dt>
                      <dd className={`text-sm text-ink truncate ${c.numeric ? 'tabular-nums' : ''}`}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {actions && (
                <div className="mt-3 pt-3 border-t border-surface-border flex flex-wrap gap-2">
                  {actions(row)}
                </div>
              )}
            </AppCard>
          </li>
        ))}
      </ul>
    </div>
  );
}
