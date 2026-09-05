import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import {
  AppCard, AlertBanner, StatusBadge, DataTable, FormField, Modal, SectionTitle,
} from '../../components/ui';
import { snapshotPct, pctDelta, fmtSnapshotPct, fmtPctDelta } from '../../utils/kpi';

// Metric definitions — edit here to add/change metrics
const METRICS = [
  { key: 'data_completeness', label: 'ความครบถ้วนข้อมูล (รถ)', num: 'students_with_vehicle', den: 'total_students', pct: true, higher: true },
  { key: 'parent_coverage', label: 'ผู้ปกครองครบ', num: 'students_with_parent', den: 'total_students', pct: true, higher: true },
  { key: 'insurance_coverage', label: 'ประกันภัยครอบคลุม', num: 'vehicles_with_insurance', den: 'total_vehicles', pct: true, higher: true },
  { key: 'inspection_coverage', label: 'ตรวจสภาพรถครบ', num: 'vehicles_inspected', den: 'total_vehicles', pct: true, higher: true },
  { key: 'inspection_passed', label: 'ผ่านตรวจสภาพ', num: 'vehicles_passed', den: 'total_vehicles', pct: true, higher: true },
  { key: 'morning_completion', label: 'ส่งเช้าครบ', num: 'morning_done', den: 'morning_total', pct: true, higher: true },
  { key: 'evening_completion', label: 'รับเย็นครบ', num: 'evening_done', den: 'evening_total', pct: true, higher: true },
  { key: 'active_users', label: 'ผู้ใช้ที่ active', num: 'active_users', den: 'total_users', pct: true, higher: true },
];

// Percentages and deltas come from utils/kpi.js (snapshotPct / pctDelta), the
// same rule the backend research export uses: a zero or missing denominator
// is null — shown as "ไม่มีข้อมูล" — never 0%, and a delta against it is null
// rather than a trend.

/**
 * The direction of a change was carried by a bare ▲ / ▼ / = glyph in a colour.
 * A screen reader read "black up-pointing triangle", and a red/green pair is
 * the only thing separating "ดีขึ้น" from "ลดลง" for a colour-blind reader.
 * Each trend now carries its own word and an icon marked decorative.
 */
function trendMeta(delta, higher) {
  if (delta === 0) return { Icon: Minus, tone: 'neutral', cls: 'text-ink-muted', label: 'คงเดิม' };
  const improved = higher ? delta > 0 : delta < 0;
  return improved
    ? { Icon: TrendingUp,   tone: 'success', cls: 'text-success-ink', label: 'ดีขึ้น' }
    : { Icon: TrendingDown, tone: 'danger',  cls: 'text-danger-ink',  label: 'ลดลง' };
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ResearchMetrics() {
  const toast = useToast();
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  // The load error used to be swallowed, so a failed request rendered the
  // "ยังไม่มี snapshot" empty state — telling the admin there is no baseline
  // when there may well be one.
  const [error, setError] = useState(null);
  const [selectedBaselineId, setSelectedBaselineId] = useState(null);
  const [running, setRunning] = useState(false);
  const [showPreMeasure, setShowPreMeasure] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/admin/snapshots?limit=50');
      const data = Array.isArray(r.data?.data) ? r.data.data : [];
      setSnapshots(data);
      const firstBaseline = data.find(s => s.is_baseline);
      if (firstBaseline) setSelectedBaselineId(firstBaseline.id);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูล snapshot ไม่สำเร็จ');
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRunSnapshot(isBaseline = false, researchPhase = null, note = null) {
    setRunning(true);
    try {
      await api.post('/admin/snapshots/run', {
        is_baseline: isBaseline,
        baseline_note: note || (isBaseline ? 'Baseline created from Research Metrics page' : null),
        research_phase: researchPhase,
      });
      toast.success(isBaseline ? 'สร้าง baseline สำเร็จ' : 'บันทึก snapshot สำเร็จ');
      const r = await api.get('/admin/snapshots?limit=50');
      const data = Array.isArray(r.data?.data) ? r.data.data : [];
      setSnapshots(data);
      if (isBaseline) {
        const nb = data.find(s => s.is_baseline);
        if (nb) setSelectedBaselineId(nb.id);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setRunning(false); setShowPreMeasure(false); }
  }

  const baselines = snapshots.filter(s => s.is_baseline);
  const baseline = baselines.find(s => s.id === selectedBaselineId) || baselines[0] || null;
  const latest = snapshots.find(s => !s.is_baseline) || snapshots[0] || null;

  // One row per metric, computed once and shared by the table and the cards so
  // the two cannot disagree.
  const comparison = METRICS.map(m => {
    const bNum = baseline?.[m.num] ?? 0;
    const bDen = baseline?.[m.den] ?? 0;
    const cNum = latest?.[m.num] ?? 0;
    const cDen = latest?.[m.den] ?? 0;
    // Raw values go in, so a missing snapshot or a zero denominator is null.
    const bVal = baseline ? snapshotPct(baseline[m.num], baseline[m.den]) : null;
    const cVal = latest ? snapshotPct(latest[m.num], latest[m.den]) : null;
    const delta = pctDelta(bVal, cVal);
    return {
      ...m, bNum, bDen, cNum, cDen, bVal, cVal, delta,
      trend: delta !== null ? trendMeta(delta, m.higher) : null,
      hasBaseline: Boolean(baseline),
      hasLatest: Boolean(latest),
      // Both snapshots exist but at least one side has no denominator.
      notComparable: Boolean(baseline && latest) && delta === null,
    };
  });

  const columns = [
    { key: 'label', header: 'ตัวชี้วัด', primary: true, cell: r => r.label },
    {
      key: 'baseline', header: 'Baseline', align: 'center', numeric: true,
      cell: r => (r.hasBaseline ? `${fmtSnapshotPct(r.bVal)} (${r.bNum}/${r.bDen})` : '-'),
    },
    {
      key: 'current', header: 'ปัจจุบัน', align: 'center', numeric: true,
      cell: r => (r.hasLatest ? <span className="font-semibold text-ink">{fmtSnapshotPct(r.cVal)} ({r.cNum}/{r.cDen})</span> : '-'),
    },
    {
      key: 'delta', header: 'เปลี่ยนแปลง', align: 'center', numeric: true,
      cell: r => (r.delta === null
        ? <span className="text-ink-muted">{r.notComparable ? fmtPctDelta(null) : '-'}</span>
        : (
          <span className={`inline-flex items-center gap-1 font-semibold ${r.trend.cls}`}>
            <r.trend.Icon className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            {fmtPctDelta(r.delta)}
          </span>
        )),
    },
    {
      key: 'status', header: 'สถานะ', align: 'center', badge: true,
      cell: r => (r.trend
        ? <StatusBadge variant={r.trend.tone} size="sm">{r.trend.label}</StatusBadge>
        : r.notComparable
          ? <StatusBadge variant="neutral" size="sm">ไม่มีข้อมูล</StatusBadge>
          : '-'),
    },
  ];

  if (loading) return <LoadingState />;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      <PageHeader
        icon={FlaskConical}
        title="เปรียบเทียบ Baseline กับสถานะปัจจุบัน"
        subtitle="ดูความเปลี่ยนแปลงของข้อมูลหลักจาก baseline"
        meta="Research Evaluation"
        actions={<StatusBadge variant="info">เฉพาะผู้ดูแลระบบ</StatusBadge>}
      />

      {/* Baseline selector + actions */}
      <AppCard padding="md" className="mb-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="min-w-0">
            {baselines.length > 0 ? (
              <FormField label="Baseline อ้างอิง" className="sm:max-w-md">
                {ctl => (
                  <select
                    {...ctl}
                    value={selectedBaselineId || ''}
                    onChange={e => setSelectedBaselineId(Number(e.target.value))}
                    className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition"
                  >
                    {baselines.map(b => (
                      <option key={b.id} value={b.id}>
                        {fmtDate(b.snapshot_date)} {b.baseline_note ? `— ${b.baseline_note}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            ) : (
              <AlertBanner variant="warn" title="ยังไม่มี baseline">
                กด “สร้าง Baseline” เพื่อเริ่มเก็บข้อมูลเปรียบเทียบ
              </AlertBanner>
            )}
            {latest && (
              <p className="text-caption text-ink-muted mt-1">
                Snapshot ล่าสุด: {fmtDate(latest.snapshot_date)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleRunSnapshot(false)}
              disabled={running}
              className="focus-ring text-sm font-medium bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 border border-brand-200 px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {running ? 'กำลังบันทึก…' : 'Snapshot วันนี้'}
            </button>
            <button
              type="button"
              onClick={() => handleRunSnapshot(true)}
              disabled={running}
              className="focus-ring text-sm font-medium bg-success-soft hover:opacity-90 text-success-ink border border-success/30 px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {running ? 'กำลังบันทึก…' : 'สร้าง Baseline'}
            </button>
            <button
              type="button"
              onClick={() => setShowPreMeasure(true)}
              disabled={running}
              className="focus-ring text-sm font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 border border-navy-200 px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {running ? 'กำลังบันทึก…' : 'Baseline (Pre-measure)'}
            </button>
          </div>
        </div>
      </AppCard>

      {error ? (
        <ErrorState title="โหลดข้อมูล snapshot ไม่สำเร็จ" message={error} onRetry={load} />
      ) : !baseline && !latest ? (
        <EmptyState
          title="ยังไม่มี snapshot"
          description='กด "สร้าง Baseline" เพื่อเริ่มเก็บข้อมูลเปรียบเทียบ'
        />
      ) : (
        <>
          {/* KPI comparison cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {comparison.map(r => (
              <AppCard key={r.key} padding="sm" className="text-center">
                <p className="text-caption text-ink-muted mb-1">{r.label}</p>
                <p className="text-2xl font-bold text-ink tabular-nums">
                  {r.hasLatest ? fmtSnapshotPct(r.cVal) : '-'}
                </p>
                {r.trend && r.delta !== null && (
                  <p className={`inline-flex items-center gap-1 text-sm font-medium mt-0.5 ${r.trend.cls}`}>
                    <r.trend.Icon className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span className="tabular-nums">{fmtPctDelta(r.delta)}</span>
                    <span className="sr-only">{r.trend.label}</span>
                  </p>
                )}
                {r.notComparable && (
                  <p className="text-sm text-ink-muted mt-0.5">ไม่มีข้อมูล</p>
                )}
                {r.hasBaseline && (
                  <p className="text-caption text-ink-muted mt-0.5 tabular-nums">baseline: {fmtSnapshotPct(r.bVal)}</p>
                )}
              </AppCard>
            ))}
          </div>

          <div className="mb-5">
            <DataTable
              caption="ตารางเปรียบเทียบตัวชี้วัดกับ baseline"
              columns={columns}
              rows={comparison}
              rowKey={r => r.key}
              empty={{ title: 'ยังไม่มีตัวชี้วัด' }}
            />
          </div>

          {/* Snapshot history */}
          <AppCard padding="none">
            <details className="group">
              <summary className="focus-ring flex items-center px-4 min-h-[44px] cursor-pointer text-sm font-medium text-ink-muted hover:bg-surface rounded-xl transition">
                ประวัติ Snapshot ({snapshots.length} รายการ)
              </summary>
              <div className="border-t border-surface-border divide-y divide-surface-border">
                {snapshots.slice(0, 20).map(s => (
                  <div key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-ink">{fmtDate(s.snapshot_date)}</span>
                      {s.is_baseline && <StatusBadge variant="success" size="sm">Baseline</StatusBadge>}
                      {s.research_phase && <StatusBadge variant="info" size="sm">{s.research_phase}</StatusBadge>}
                      <span className="text-caption text-ink-muted">{s.run_type}</span>
                    </div>
                    <span className="text-caption text-ink-muted truncate">{s.baseline_note || ''}</span>
                  </div>
                ))}
              </div>
            </details>
          </AppCard>
        </>
      )}

      {/* Pre-measure baseline — a research record, so it states exactly what it
          will write before it writes it. */}
      <Modal
        open={showPreMeasure}
        title="บันทึก Baseline (Pre-measure)"
        onClose={() => { if (!running) setShowPreMeasure(false); }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowPreMeasure(false)}
              disabled={running}
              className="focus-ring px-4 min-h-[44px] text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => handleRunSnapshot(true, 'pre-measure', 'Research R2 Pre-measure Baseline')}
              disabled={running}
              className="focus-ring px-4 min-h-[44px] text-sm font-semibold rounded-lg bg-navy-700 hover:bg-navy-800 active:bg-navy-900 text-white transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {running ? 'กำลังบันทึก…' : 'ยืนยันบันทึก Baseline'}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted mb-3">
          ระบบจะบันทึก snapshot ปัจจุบันเป็น{' '}
          <strong className="text-ink">Baseline สำหรับการวิจัย R2 (Pre-measure)</strong>
        </p>

        <SectionTitle title="รายละเอียดที่จะบันทึก" className="mb-2" />
        <dl className="bg-navy-50 border border-navy-200 rounded-lg p-3 mb-4 text-sm text-navy-800 space-y-1">
          <div className="flex gap-2">
            <dt className="font-semibold shrink-0">วันที่:</dt>
            <dd>{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold shrink-0">ประเภท:</dt>
            <dd>Research Baseline — Pre-measure</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold shrink-0">หมายเหตุ:</dt>
            <dd>ข้อมูลนี้จะถูกแยกจาก snapshot ปกติในการส่งออกงานวิจัย</dd>
          </div>
        </dl>

        <AlertBanner variant="warn" title="บันทึกซ้ำไม่ได้ภายใน 24 ชั่วโมง">
          หากมี baseline อยู่แล้วระบบจะแจ้งเตือน
        </AlertBanner>
      </Modal>
    </div>
  );
}
