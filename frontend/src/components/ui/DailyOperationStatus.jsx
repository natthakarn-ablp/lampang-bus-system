import { Sunrise, Sunset, ShieldAlert, CheckCircle2, Clock } from 'lucide-react';
import AppCard from './AppCard';

/**
 * DailyOperationStatus — "how is today going", as the first thing on a dashboard.
 *
 * Replaces the amber AlertBanner that used to shout "รอส่งเข้า 4654 คน" at
 * 06:00, before a single bus had left. Pending work is not a warning; it is
 * simply the state of a round that has not run yet. The tile says
 * "ยังไม่เริ่มรอบ" when a session has no expected trips, and only turns amber
 * or red once a round is genuinely under way and falling behind.
 *
 * Every state carries an icon and a word, never colour alone.
 */

function tone(pct, notStarted) {
  if (notStarted)  return { text: 'text-ink-muted', bar: 'bg-surface-border', Icon: Clock,        word: 'ยังไม่เริ่มรอบ' };
  if (pct >= 100)  return { text: 'text-success-ink',   bar: 'bg-success',        Icon: CheckCircle2, word: 'ครบแล้ว' };
  if (pct >= 80)   return { text: 'text-ink',       bar: 'bg-brand-600',      Icon: null,         word: 'กำลังดำเนินการ' };
  if (pct >= 50)   return { text: 'text-warn-ink',      bar: 'bg-warn',           Icon: null,         word: 'ต้องติดตาม' };
  return             { text: 'text-danger-ink',   bar: 'bg-danger',         Icon: null,         word: 'ล่าช้า' };
}

function SessionTile({ icon: Icon, label, done, total }) {
  // A session counts as "not started" when it has no expected trips OR when
  // none have been completed yet. The evening round is legitimately at 0/4,651
  // all morning; calling that "ล่าช้า" in red is the same false alarm the old
  // amber banner raised, one component further down.
  //
  // The dashboard API returns no session window, so time-of-day cannot be used
  // to distinguish "not started" from "started and stalled". Zero-completed is
  // the honest reading with the data available.
  // TODO: if the API later exposes a session start time, treat 0-done AFTER
  // that time as genuinely behind.
  const notStarted = !total || done === 0;
  const pct = notStarted ? 0 : Math.round((done / total) * 100);
  const t = tone(pct, notStarted);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
          <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} aria-hidden="true" />
          {label}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${t.text}`}>
          {notStarted ? '—' : `${pct}%`}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-ink tabular-nums leading-none">
          {notStarted ? '0' : done.toLocaleString('th-TH')}
        </span>
        <span className="text-sm text-ink-muted tabular-nums">
          / {total.toLocaleString('th-TH')} คน
        </span>
      </div>

      <div
        className="w-full h-1.5 rounded-full overflow-hidden bg-surface"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${notStarted ? 'ยังไม่เริ่มรอบ' : `${pct} เปอร์เซ็นต์`}`}
      >
        {!notStarted && <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />}
      </div>

      <p className={`text-caption inline-flex items-center gap-1 ${t.text}`}>
        {t.Icon && <t.Icon className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />}
        {t.word}
      </p>
    </div>
  );
}

export default function DailyOperationStatus({
  morningDone = 0, morningTotal = 0,
  eveningDone = 0, eveningTotal = 0,
  emergencies = 0,
  freshness,
  className = '',
}) {
  const hasEmergency = emergencies > 0;

  return (
    <AppCard padding="md" className={className}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
        <SessionTile icon={Sunrise} label="ส่งเช้า" done={morningDone} total={morningTotal} />
        <SessionTile icon={Sunset}  label="รับเย็น" done={eveningDone} total={eveningTotal} />

        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            <ShieldAlert className="w-4 h-4 text-ink-muted" strokeWidth={2} aria-hidden="true" />
            เหตุฉุกเฉินวันนี้
          </span>
          <span className={`text-2xl font-bold tabular-nums leading-none ${hasEmergency ? 'text-danger-ink' : 'text-ink'}`}>
            {emergencies.toLocaleString('th-TH')}
          </span>
          <p className={`text-caption inline-flex items-center gap-1 ${hasEmergency ? 'text-danger-ink' : 'text-success-ink'}`}>
            {hasEmergency
              ? <><ShieldAlert className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />ต้องตรวจสอบ</>
              : <><CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />ไม่มีเหตุ</>}
          </p>
        </div>
      </div>

      {freshness && (
        <p className="text-caption text-ink-muted mt-4 pt-3 border-t border-surface-border">
          ข้อมูล ณ {freshness}
        </p>
      )}
    </AppCard>
  );
}
