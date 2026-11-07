import { Children, useState } from 'react';
import { ChevronDown } from 'lucide-react';

function hasContent(children) {
  return Children.toArray(children).some(c => c !== null && c !== false && c !== '');
}

/**
 * SectionCard — a titled card that disappears when it has nothing to show,
 * so a dashboard never has an empty box (QA: "งานแก้ไขรายการพิเศษ").
 *
 * Props
 *   title, sub, action (node, e.g. a "ดูทั้งหมด" link)
 *   empty          true → the section has no data
 *   hideWhenEmpty  default true; false shows `emptyText` instead
 *   emptyText      default 'ไม่มีข้อมูล'
 *   collapsible    render as a disclosure for secondary detail
 *   defaultOpen    open the disclosure initially
 * Also renders nothing when `children` is empty.
 */
export default function SectionCard({ title, sub, action, empty = false, hideWhenEmpty = true, emptyText = 'ไม่มีข้อมูล', collapsible = false, defaultOpen = false, className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = empty || !hasContent(children);
  if (isEmpty && hideWhenEmpty) return null;

  const content = isEmpty
    ? <p className="py-6 text-center text-sm text-ink-muted">{emptyText}</p>
    : children;

  if (collapsible) {
    return (
      <section className={`rounded-2xl border border-surface-border bg-surface-raised shadow-soft ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="focus-ring w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 min-h-[52px] text-left rounded-2xl hover:bg-surface transition"
        >
          <span className="min-w-0">
            <span className="block font-semibold text-ink">{title}</span>
            {sub && <span className="block text-sm text-ink-muted">{sub}</span>}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 shrink-0">
            {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </button>
        {open && <div className="border-t border-surface-border p-3 sm:p-4">{content}</div>}
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-surface-border bg-surface-raised shadow-soft p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {sub && <p className="text-sm text-ink-muted">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {content}
    </section>
  );
}
