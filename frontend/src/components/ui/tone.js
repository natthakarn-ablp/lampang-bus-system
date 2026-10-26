/**
 * One status vocabulary for every dashboard.
 *
 *   success = เรียบร้อย   (done, healthy — no action)
 *   warn    = รอติดตาม   (in progress, expiring, waiting for approval)
 *   danger  = ต้องรีบ     (expired, failed, nobody has checked in)
 *   info    = ข้อมูล      (a number to know, not a problem)
 *   neutral = ยังไม่เริ่ม / ทั่วไป
 *
 * Text always uses the `-ink` tone on the `-soft` background (WCAG AA);
 * `ring` is the vivid fill used only for chart strokes and bars.
 */
export const TONE = {
  success: { soft: 'bg-success-soft', ink: 'text-success-ink', border: 'border-success/30', solid: 'bg-success-ink', ring: '#10B981', word: 'เรียบร้อย' },
  warn:    { soft: 'bg-warn-soft',    ink: 'text-warn-ink',    border: 'border-warn/40',    solid: 'bg-warn-ink',    ring: '#F59E0B', word: 'รอติดตาม' },
  danger:  { soft: 'bg-danger-soft',  ink: 'text-danger-ink',  border: 'border-danger/35',  solid: 'bg-danger-ink',  ring: '#EF4444', word: 'ต้องรีบ' },
  info:    { soft: 'bg-brand-50',     ink: 'text-brand-800',   border: 'border-brand-200',  solid: 'bg-brand-700',   ring: '#2563EB', word: 'ข้อมูล' },
  neutral: { soft: 'bg-surface',      ink: 'text-ink-muted',   border: 'border-surface-border', solid: 'bg-ink-muted', ring: '#94A3B8', word: 'ยังไม่เริ่ม' },
};

export function tone(key) {
  return TONE[key] || TONE.neutral;
}

/** Percent of done/total, or null when there is nothing to count. */
export function pctOf(done, total) {
  const d = Number(done) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return null;
  return Math.round((d / t) * 100);
}

/**
 * Tone for a completion percentage. Same thresholds as utils/kpi.js
 * (≥95 good, ≥85 watch, below that act) so reports and dashboards agree.
 */
export function pctTone(pct) {
  if (pct == null || !isFinite(pct)) return 'neutral';
  if (pct >= 95) return 'success';
  if (pct >= 85) return 'warn';
  return 'danger';
}
