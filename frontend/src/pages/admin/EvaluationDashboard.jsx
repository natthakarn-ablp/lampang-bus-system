import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, ChevronDown, Check, X as XIcon, Minus,
  TrendingUp, TrendingDown, AlertTriangle,
} from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { AppCard, AlertBanner, StatusBadge, DataTable } from '../../components/ui';

function pct(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 100 : 0; }
function delta(c, b) { return Math.round((c - b) * 100) / 100; }

/**
 * Direction of change. The glyphs ▲ / ▼ / = carried the whole meaning before:
 * unreadable to a screen reader and, paired only with red/green, invisible to
 * a colour-blind reader. Each trend now names itself.
 */
function trend(d, higher = true) {
  if (d === 0) return { Icon: Minus, cls: 'text-ink-muted', label: 'คงเดิม' };
  const ok = higher ? d > 0 : d < 0;
  return ok
    ? { Icon: TrendingUp,   cls: 'text-success-ink', label: 'ดีขึ้น' }
    : { Icon: TrendingDown, cls: 'text-danger-ink',  label: 'ลดลง' };
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }

const ROLE_DEFS = [
  { id: 'driver', code: 'DR', name: 'คนขับ', color: 'orange', focus: 'ความสม่ำเสมอ + UX',
    metrics: [
      { label: 'ส่งเช้าครบ', num: 'morning_done', den: 'morning_total' },
      { label: 'รับเย็นครบ', num: 'evening_done', den: 'evening_total' },
    ]},
  { id: 'school', code: 'SC', name: 'โรงเรียน', color: 'green', focus: 'ข้อมูลครบถ้วน + ภาระงาน',
    metrics: [
      { label: 'ข้อมูลครบ (รถ)', num: 'students_with_vehicle', den: 'total_students' },
      { label: 'ผู้ปกครองครบ', num: 'students_with_parent', den: 'total_students' },
    ]},
  { id: 'affiliation', code: 'AF', name: 'สังกัด', color: 'teal', focus: 'ตรวจจับเชิงรุก',
    metrics: [
      { label: 'ข้อมูลครบ (รถ)', num: 'students_with_vehicle', den: 'total_students' },
      { label: 'ตรวจสภาพรถ', num: 'vehicles_inspected', den: 'total_vehicles' },
    ]},
  { id: 'province', code: 'PR', name: 'จังหวัด', color: 'blue', focus: 'คุณภาพการตัดสินใจ',
    metrics: [
      { label: 'ตรวจสภาพ', num: 'vehicles_inspected', den: 'total_vehicles' },
      { label: 'ประกัน', num: 'vehicles_with_insurance', den: 'total_vehicles' },
    ]},
  { id: 'transport', code: 'TR', name: 'ขนส่ง', color: 'indigo', focus: 'ปิดความเสี่ยง',
    metrics: [
      { label: 'ตรวจสภาพ', num: 'vehicles_inspected', den: 'total_vehicles' },
      { label: 'ผ่านตรวจ', num: 'vehicles_passed', den: 'total_vehicles' },
      { label: 'ประกัน', num: 'vehicles_with_insurance', den: 'total_vehicles' },
    ]},
  { id: 'admin', code: 'AD', name: 'แอดมิน', color: 'purple', focus: 'สุขภาพระบบ',
    metrics: [
      { label: 'ผู้ใช้ active', num: 'active_users', den: 'total_users' },
      { label: 'ข้อมูลครบ', num: 'students_with_vehicle', den: 'total_students' },
    ]},
];

// The role initials are an identity marker, not a status, so they use the
// structural navy/brand family rather than the semantic success/warn/danger
// tones that mean something elsewhere on this page.
const CODE_BG = {
  orange: 'bg-navy-500', green: 'bg-navy-600', teal:   'bg-navy-700',
  blue:   'bg-brand-600', indigo: 'bg-brand-700', purple: 'bg-navy-800',
};

function evalStatus(actions, snapHas) {
  const total = actions?.total || 0;
  if (!snapHas || total < 5) return { label: 'ยังต้องเพิ่มหลักฐาน', variant: 'danger' };
  if (total >= 20) return { label: 'พร้อมประเมิน', variant: 'success' };
  return { label: 'ประเมินได้บางส่วน', variant: 'warn' };
}

/**
 * Evidence coverage was `Snapshots: ✅` / `❌` — the emoji WAS the answer, so a
 * screen reader announced "Snapshots: white heavy check mark" and a reader who
 * cannot see the colour got nothing at all. The word is now the answer and the
 * icon is decorative.
 */
function EvidenceChip({ label, present, count, absentText = 'ยังไม่มี' }) {
  const Icon = present ? Check : XIcon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium ${
      present ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger-ink'
    }`}>
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      {label}: {present ? (count != null ? `มี ${count} รายการ` : 'มี') : absentText}
    </span>
  );
}

export default function EvaluationDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // A failed request used to render the "ยังไม่มีข้อมูล" empty state, which
  // reads as "evaluation has no evidence yet" — the opposite of "we could not
  // check". On this page that distinction is the whole point.
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/admin/evaluation-summary');
      setData(r.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลการประเมินไม่สำเร็จ');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState title="โหลดข้อมูลการประเมินไม่สำเร็จ" message={error} onRetry={load} />;
  if (!data) return <EmptyState title="ยังไม่มีข้อมูล" description="ยังไม่มี snapshot หรือ action log สำหรับการประเมิน" />;

  const { baseline, latest } = data;
  // These come back keyed by role; a response missing either key used to throw
  // on the first lookup.
  const roleActions = data.role_actions || {};
  const roleExports = data.role_exports || {};
  const bData = baseline?.data || {};
  const lData = latest?.data || {};
  const hasSnap = Boolean(baseline) && Boolean(latest);

  const statuses = ROLE_DEFS.map(r => evalStatus(roleActions[r.id], hasSnap).label);
  const readyCount = statuses.filter(l => l === 'พร้อมประเมิน').length;
  const partialCount = statuses.filter(l => l === 'ประเมินได้บางส่วน').length;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      <PageHeader
        icon={ClipboardCheck}
        title="แดชบอร์ดประเมินผลแยกตามสิทธิ์"
        subtitle="Snapshot · Action Logs · Export Evidence"
        meta="Role-by-Role Evaluation"
      />

      {/* Global summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryPill label="Baseline" value={baseline ? fmtDate(baseline.date) : 'ยังไม่มี'} tone={baseline ? 'brand' : 'muted'} />
        <SummaryPill label="Snapshot ล่าสุด" value={latest ? fmtDate(latest.date) : 'ยังไม่มี'} tone={latest ? 'brand' : 'muted'} />
        <SummaryPill label="พร้อมประเมิน" value={`${readyCount} / ${ROLE_DEFS.length} role`} tone={readyCount >= 4 ? 'success' : 'warn'} />
        <SummaryPill label="ยังต้องเพิ่ม" value={`${ROLE_DEFS.length - readyCount - partialCount} role`} tone="muted" />
      </div>

      <div className="space-y-3">
        {ROLE_DEFS.map(role => {
          const actions = roleActions[role.id] || { actions: {}, total: 0 };
          const exports = roleExports[role.id] || 0;
          const status = evalStatus(actions, hasSnap);
          const isOpen = expanded === role.id;
          const panelId = `eval-panel-${role.id}`;

          const metricRows = role.metrics.map(m => {
            const bv = pct(bData[m.num] || 0, bData[m.den] || 0);
            const cv = pct(lData[m.num] || 0, lData[m.den] || 0);
            const d = delta(cv, bv);
            return { ...m, bv, cv, d, t: trend(d) };
          });

          return (
            <AppCard key={role.id} padding="none" className={isOpen ? 'ring-1 ring-surface-border' : undefined}>
              <h2>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? '' : role.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="focus-ring w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-surface rounded-xl transition"
                >
                  <span className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${CODE_BG[role.color]}`}>
                    {role.code}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{role.name}</span>
                      <StatusBadge variant={status.variant} size="sm">{status.label}</StatusBadge>
                    </span>
                    <span className="block text-caption text-ink-muted">
                      {role.focus} · {actions.total || 0} actions · {exports} exports
                    </span>
                  </span>
                  <span className="hidden sm:flex gap-2 shrink-0">
                    {role.metrics.slice(0, 2).map(m => (
                      <span key={m.label} className="text-caption text-ink-muted bg-surface px-2 py-0.5 rounded tabular-nums">
                        {m.label} {pct(lData[m.num] || 0, lData[m.den] || 0)}%
                      </span>
                    ))}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-ink-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              </h2>

              {isOpen && (
                <div id={panelId} className="border-t border-surface-border px-4 py-4 space-y-4">
                  <div>
                    <h3 className="text-caption font-semibold text-ink-muted mb-1.5">หลักฐานที่มี</h3>
                    <div className="flex flex-wrap gap-2">
                      <EvidenceChip label="Snapshots" present={hasSnap} />
                      <EvidenceChip label="Audit logs" present={(actions.total || 0) > 0} count={actions.total || 0} />
                      <EvidenceChip label="Exports" present={exports > 0} count={exports} absentText="ยังไม่มี" />
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-warn-soft text-warn-ink">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                        External: ต้องใช้หลักฐานภายนอกร่วม
                      </span>
                    </div>
                  </div>

                  {actions.actions && Object.keys(actions.actions).length > 0 && (
                    <div>
                      <h3 className="text-caption font-semibold text-ink-muted mb-1.5">Action breakdown</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(actions.actions).map(([action, cnt]) => (
                          <span key={action} className="text-caption bg-surface text-ink-muted px-2 py-1 rounded tabular-nums">
                            {action}: {cnt}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasSnap && (
                    <div>
                      <h3 className="text-caption font-semibold text-ink-muted mb-1.5">Baseline vs Current</h3>
                      <DataTable
                        caption={`ตัวชี้วัดของสิทธิ์${role.name} เทียบกับ baseline`}
                        rowKey={r => r.label}
                        rows={metricRows}
                        columns={[
                          { key: 'label', header: 'ตัวชี้วัด', primary: true, cell: r => r.label },
                          { key: 'bv', header: 'Baseline', align: 'center', numeric: true, cell: r => `${r.bv}%` },
                          { key: 'cv', header: 'ปัจจุบัน', align: 'center', numeric: true,
                            cell: r => <span className="font-semibold text-ink">{r.cv}%</span> },
                          { key: 'd', header: 'เปลี่ยนแปลง', align: 'center', numeric: true,
                            cell: r => (
                              <span className={`inline-flex items-center gap-1 font-semibold ${r.t.cls}`}>
                                <r.t.Icon className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                                {r.d > 0 ? '+' : ''}{r.d}%
                                <span className="sr-only">{r.t.label}</span>
                              </span>
                            ) },
                        ]}
                      />
                    </div>
                  )}

                  <AlertBanner variant="warn" title="ต้องใช้หลักฐานภายนอกร่วม">
                    บาง metric ของสิทธิ์นี้ต้องใช้แบบสอบถาม สัมภาษณ์ หรือบันทึกประชุมร่วมด้วย —
                    ดูรายละเอียดที่หน้า “กรอบวัดผลระบบ”
                  </AlertBanner>
                </div>
              )}
            </AppCard>
          );
        })}
      </div>
    </div>
  );
}

const PILL_TONES = {
  brand:   'bg-brand-50 text-brand-700',
  success: 'bg-success-soft text-success-ink',
  warn:    'bg-warn-soft text-warn-ink',
  muted:   'bg-surface text-ink-muted border border-surface-border',
};

function SummaryPill({ label, value, tone }) {
  return (
    <div className={`rounded-xl p-3 text-center ${PILL_TONES[tone] || PILL_TONES.muted}`}>
      <p className="text-sm font-semibold">{value}</p>
      <p className="text-caption mt-0.5 opacity-80">{label}</p>
    </div>
  );
}
