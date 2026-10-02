import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AppCard from './AppCard';

/** FoldSection — secondary dashboard detail, closed by default. */
export default function FoldSection({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <AppCard padding="none">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-surface transition min-h-[52px] focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-2xl"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{title}</p>
          {subtitle && <p className="text-sm text-ink-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        <span className="text-sm font-semibold text-brand-700 shrink-0 inline-flex items-center gap-1 ml-2">
          {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
        </span>
      </button>
      {open && <div className="border-t border-surface-border p-3 sm:p-4">{children}</div>}
    </AppCard>
  );
}
