import { useState } from 'react';
import { ChevronDown, AlertOctagon } from 'lucide-react';

const SESSIONS = [
  { key: 'morning', name: 'รอบเช้า', self: 'มาเอง' },
  { key: 'evening', name: 'รอบเย็น', self: 'กลับเอง' },
];
const KINDS = ['self', 'leave'];
const fmt = n => Number(n || 0).toLocaleString('th-TH');
const shown = v => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('th-TH') : '—');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * True when the feed failed: an object without any of the counts (pages pass
 * `{}` for a failed feed). Shown as "—", never hidden as if it were 0.
 */
export function isTravelLeaveUnavailable(data) {
  if (!data || typeof data !== 'object') return false;
  return SESSIONS.every(({ key }) => KINDS.every(kind => typeof data[`${key}_${kind}`] !== 'number'));
}

/** True when there is nothing worth showing: no data, or every count is 0 and no conflict. */
export function isTravelLeaveEmpty(data) {
  if (!data || typeof data !== 'object') return true;
  if (isTravelLeaveUnavailable(data)) return false;
  return SESSIONS.every(({ key }) => !num(data[`${key}_conflict`]) && KINDS.every(kind => !num(data[`${key}_${kind}`])));
}

/**
 * TravelLeaveSummary — pupils who travelled by themselves (มาเอง/กลับเอง) or
 * were on leave (ลา), per round. Replaces the old AttendanceBreakdown card
 * that sat at the very top of dashboards and reports, mostly showing zeros.
 *
 * Place it IN CONTEXT: under the round progress (dashboards) or next to the
 * per-round totals (reports) — never above the page header.
 *
 * Behaviour
 *   - renders nothing when `data` is missing or every count is 0 and there is
 *     no conflict (no box of zeros)
 *   - a one-line summary ("ไม่ใช้รถวันนี้: มาเอง 3 · ลา 2 …") with the
 *     per-round detail behind a disclosure (closed by default)
 *   - a data conflict is shown outside the disclosure, in danger tone, since
 *     it needs checking
 *
 * Props
 *   data     API payload with morning_self, morning_leave, evening_self,
 *            evening_leave, *_conflict and (monthly) *_people
 *   monthly  counts are ครั้ง (with unique people) instead of คน
 *   defaultOpen
 */
export default function TravelLeaveSummary({ data, monthly = false, defaultOpen = false, className = '' }) {
  const [toggled, setOpen] = useState(defaultOpen);
  if (isTravelLeaveEmpty(data)) return null;
  // A failed feed keeps the detail open so every count reads "—", not 0.
  const unavailable = isTravelLeaveUnavailable(data);
  const open = toggled || unavailable;

  const unit = monthly ? 'ครั้ง' : 'คน';
  const conflicts = SESSIONS.filter(({ key }) => num(data[`${key}_conflict`]) > 0);
  const parts = [];
  for (const s of SESSIONS) {
    const self = num(data[`${s.key}_self`]);
    const leave = num(data[`${s.key}_leave`]);
    if (self) parts.push(`${s.self} ${fmt(self)}`);
    if (leave) parts.push(`ลา${s.key === 'morning' ? 'เช้า' : 'เย็น'} ${fmt(leave)}`);
  }
  const title = monthly ? 'ไม่ใช้รถในเดือนนี้ (เดินทางเอง/ลา)' : 'ไม่ใช้รถวันนี้ (เดินทางเอง/ลา)';

  return (
    <section aria-label="แยกการเดินทางและการลา" className={`rounded-2xl border border-surface-border bg-surface-raised ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="focus-ring w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] text-left rounded-2xl hover:bg-surface transition"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{title}</span>
          {unavailable
            ? <span className="block text-sm text-ink-muted">โหลดข้อมูลไม่สำเร็จ</span>
            : parts.length > 0 && <span className="block text-sm text-ink-muted tabular-nums">{parts.join(' · ')} {unit}</span>}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 shrink-0">
          {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>

      {conflicts.length > 0 && (
        <p role="alert" className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            มีข้อมูลการเดินทางขัดกัน {conflicts.map(({ key, name }) => `${name} ${fmt(data[`${key}_conflict`])} รายการ`).join(' · ')} กรุณาตรวจสอบ
          </span>
        </p>
      )}

      {open && (
        <div className="border-t border-surface-border px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SESSIONS.map(s => (
              <div key={s.key}>
                <h3 className="font-medium text-ink">{s.name}</h3>
                <dl className="mt-1 space-y-1 text-sm text-ink-muted">
                  {[['self', s.self], ['leave', 'ลา']].map(([kind, label]) => (
                    <div key={kind} className="flex justify-between gap-3">
                      <dt>{label}</dt>
                      <dd className="tabular-nums">
                        {shown(data[`${s.key}_${kind}`])}{unavailable ? '' : ` ${unit}`}
                        {monthly && typeof data[`${s.key}_${kind}_people`] === 'number' ? ` / ${shown(data[`${s.key}_${kind}_people`])} คนไม่ซ้ำ` : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-muted">การเดินทางเองและการลาไม่นับเป็นผู้โดยสารรถ และไม่นับเป็นรายการรอรับ–ส่ง</p>
        </div>
      )}
    </section>
  );
}
