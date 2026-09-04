import { useState, useEffect, useCallback } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { AppCard, AlertBanner, StatusBadge, FormField, SectionTitle } from '../../components/ui';
import { describeBlockingReason } from '../../utils/evidenceStatus';

const DATASETS = [
  { key: 'snapshots', label: 'Snapshots',       desc: 'daily_snapshots' },
  { key: 'audit',     label: 'Action Logs',     desc: 'audit_logs' },
  { key: 'exports',   label: 'Export Evidence', desc: 'export events' },
  { key: 'summary',   label: 'Summary',         desc: 'aggregated' },
];

const FORMATS = [
  { key: 'json',  label: 'JSON',  hint: 'ข้อมูลดิบสำหรับวิเคราะห์' },
  { key: 'csv',   label: 'CSV',   hint: 'เปิดใน Excel/Sheets ได้ทันที' },
  { key: 'excel', label: 'Excel', hint: 'หลาย sheet แยกตามชุดข้อมูล' },
];

const EXT_MAP = { json: 'json', csv: 'csv', excel: 'xlsx' };

export default function ResearchExport() {
  const toast = useToast();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  // The preview error was swallowed, so a failed request rendered
  // "ไม่มีข้อมูลในช่วงที่เลือก" — an admin would widen the date range looking
  // for data that was never actually queried.
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null); // null | 'json' | 'csv' | 'excel'

  const [included, setIncluded] = useState(() => new Set(DATASETS.map(d => d.key)));

  // Server-computed. Absent from an older backend, in which case no readiness
  // claim is rendered at all rather than an assumed-good one.
  const readiness = preview?.evidence_readiness || null;

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/admin/research-export/preview?from=${from}&to=${to}`);
      setPreview(r.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'ตรวจสอบข้อมูลในช่วงที่เลือกไม่สำเร็จ');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  function toggleDataset(key) {
    setIncluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleExport(format = 'json') {
    const include = DATASETS.filter(d => included.has(d.key)).map(d => d.key);
    if (include.length === 0) { toast.error('กรุณาเลือกอย่างน้อย 1 ชุดข้อมูล'); return; }

    setExporting(format);
    try {
      const token = localStorage.getItem('access_token');
      const dateTag = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
      const url = `/api/admin/research-export?from=${from}&to=${to}&include=${include.join(',')}&download=true&format=${format}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `research-dataset-${dateTag}.${EXT_MAP[format]}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('ดาวน์โหลดสำเร็จ');
    } catch {
      toast.error('ดาวน์โหลดไม่สำเร็จ');
    } finally { setExporting(null); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto pb-10">
      <PageHeader
        icon={Download}
        title="ส่งออกชุดข้อมูลวิจัย"
        subtitle="Snapshot · Action Logs · Export Evidence · Summary"
        meta="Research Dataset"
        actions={<StatusBadge variant="info">เฉพาะผู้ดูแลระบบ</StatusBadge>}
      />

      {/* Export settings */}
      <AppCard padding="md" className="mb-5 space-y-4">
        <SectionTitle title="ตั้งค่าการส่งออก" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="วันที่เริ่มต้น" type="date" value={from} onChange={setFrom} />
          <FormField
            label="วันที่สิ้นสุด"
            type="date"
            value={to}
            onChange={setTo}
            error={to < from ? 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น' : undefined}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink mb-2">ชุดข้อมูลที่ต้องการ</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {DATASETS.map(d => {
              const on = included.has(d.key);
              return (
                <label
                  key={d.key}
                  className={`flex items-center gap-2 px-3 min-h-[44px] rounded-lg border cursor-pointer transition ${
                    on ? 'bg-brand-50 border-brand-300' : 'bg-surface border-surface-border hover:bg-surface-border/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleDataset(d.key)}
                    className="focus-ring w-5 h-5 rounded border-surface-border accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{d.label}</span>
                    <span className="block text-caption text-ink-muted">{d.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {included.size === 0 && (
            <p className="mt-2 text-caption text-danger">เลือกอย่างน้อย 1 ชุดข้อมูลจึงจะส่งออกได้</p>
          )}
        </fieldset>
      </AppCard>

      {/* Preview */}
      <AppCard padding="md" className="mb-5">
        <SectionTitle title="ตัวอย่างข้อมูลที่จะส่งออก" className="mb-3" />
        {loading ? (
          <LoadingState compact message="กำลังตรวจสอบ…" />
        ) : error ? (
          <ErrorState title="ตรวจสอบข้อมูลไม่สำเร็จ" message={error} onRetry={fetchPreview} />
        ) : preview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PreviewCard label="Snapshots"  value={preview.snapshots}   sub={`${preview.baselines} baseline`} />
            <PreviewCard label="Audit Logs" value={preview.audit_logs} />
            <PreviewCard label="Export Logs" value={preview.export_logs} />
            <PreviewCard
              label="ช่วงวันที่"
              value={`${fmtDate(preview.earliest_snapshot)} — ${fmtDate(preview.latest_snapshot)}`}
              small
            />
          </div>
        ) : (
          <EmptyState title="ไม่มีข้อมูลในช่วงที่เลือก" description="ลองขยายช่วงวันที่" />
        )}

        {/* Row counts read as "the dataset is this big". What the dataset can
            and cannot support belongs next to them, not in a separate doc. */}
        {readiness && (
          <div className="mt-4">
            <AlertBanner
              variant={readiness.research_claims_allowed ? 'info' : 'warn'}
              title={readiness.research_claims_allowed
                ? 'ชุดข้อมูลนี้อยู่ในช่วง protocol ที่ freeze แล้ว'
                : 'ชุดข้อมูลนี้ยังใช้อ้างผลวิจัยไม่ได้'}
            >
              {readiness.snapshot_freshness && (
                <p>
                  Snapshot ล่าสุด {readiness.snapshot_freshness.latest_snapshot_date || 'ยังไม่มี'}
                  {readiness.snapshot_freshness.age_days != null
                    && ` (อายุ ${readiness.snapshot_freshness.age_days} วัน, เกณฑ์ ${readiness.snapshot_freshness.max_age_days} วัน)`}
                  {readiness.snapshot_freshness.fresh ? ' — อยู่ในเกณฑ์' : ' — เก่าเกินเกณฑ์'}
                </p>
              )}
              {readiness.summary?.by_status && (
                <p className="mt-1">
                  ตัวชี้วัด: มีหลักฐานระบบเบื้องต้น {readiness.summary.by_status.system_evidence} ·
                  {' '}มีหลักฐานบางส่วน {readiness.summary.by_status.partial_evidence} ·
                  {' '}ยังไม่มีหลักฐานพอ {readiness.summary.by_status.evidence_missing} จาก {readiness.summary.total}
                </p>
              )}
              {readiness.blocking_reasons?.length > 0 && (
                <p className="mt-1">เหตุผล: {readiness.blocking_reasons.map(describeBlockingReason).join(' · ')}</p>
              )}
            </AlertBanner>
          </div>
        )}
      </AppCard>

      {/* Download */}
      <AppCard padding="md" className="mb-5">
        <SectionTitle title="ดาวน์โหลดชุดข้อมูล" className="mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {FORMATS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => handleExport(f.key)}
              disabled={exporting !== null || included.size === 0}
              className="focus-ring flex flex-col items-center justify-center gap-0.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold py-3 min-h-[56px] rounded-xl transition disabled:opacity-50 disabled:pointer-events-none"
            >
              <span className="text-base">{exporting === f.key ? 'กำลังสร้าง…' : f.label}</span>
              <span className="text-caption font-normal text-white/80">{f.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-caption text-ink-muted text-center">
          ไฟล์จะถูกบันทึกลงโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์โดยอัตโนมัติ
        </p>
      </AppCard>

      {/* Data dictionary */}
      <AppCard padding="none">
        <details>
          <summary className="focus-ring flex items-center px-4 min-h-[44px] cursor-pointer text-sm font-medium text-ink-muted hover:bg-surface rounded-xl transition">
            คำอธิบายชุดข้อมูล (Data Dictionary)
          </summary>
          <div className="border-t border-surface-border px-4 py-3 text-caption text-ink-muted space-y-3">
            <div>
              <p className="font-semibold text-ink">snapshots[]</p>
              <p>ข้อมูลสรุปรายวัน: จำนวนนักเรียน, รถ, ประกัน, ผลตรวจ, ความครบถ้วน, completion rate</p>
              <p>Fields: snapshot_date, total_students, students_with_vehicle, students_with_parent, total_vehicles, vehicles_with_insurance, vehicles_inspected, vehicles_passed, morning_total/done, evening_total/done, emergency_count, active_users, total_users, is_baseline, baseline_note, run_type</p>
            </div>
            <div>
              <p className="font-semibold text-ink">audit_logs[]</p>
              <p>ประวัติ action ทั้งหมด: login, create, update, delete, export, import, approve</p>
              <p>Fields: id, user_id, user_role, action, entity_type, entity_id, new_value, created_at</p>
              {/* This exclusion was a bare ⚠️ in amber text — the only marker
                  that these three fields are deliberately withheld. */}
              <p className="mt-1 inline-flex items-start gap-1.5 text-warn-ink font-medium">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" strokeWidth={2.2} aria-hidden="true" />
                <span>ไม่รวม: ip_address, user_agent, old_value (เพื่อความเป็นส่วนตัว)</span>
              </p>
            </div>
            <div>
              <p className="font-semibold text-ink">export_evidence[]</p>
              <p>เฉพาะ action=EXPORT — หลักฐานการดาวน์โหลดรายงาน</p>
              <p>Fields: id, user_id, user_role, entity_type (report_csv/report_excel/report_pdf), entity_id, new_value, created_at</p>
            </div>
            <div>
              <p className="font-semibold text-ink">summary</p>
              <p>สรุป aggregate: จำนวนรวม, แยกตาม action type, แยกตาม role</p>
            </div>
          </div>
        </details>
      </AppCard>

      <AlertBanner variant="info" title="ข้อมูลนี้ใช้เพื่อการวิจัย" className="mt-5">
        {/* TODO: ตรวจสอบกับผู้เชี่ยวชาญ — ชุดข้อมูลนี้มี audit log ระดับผู้ใช้
            (user_id, user_role) การเผยแพร่ภายนอกอาจต้องผ่านการพิจารณา PDPA
            ก่อน จึงไม่เปลี่ยนขอบเขตข้อมูลเองในรอบนี้ */}
        ชุดข้อมูลมี audit log ระดับผู้ใช้ — โปรดตรวจสอบขอบเขตการเผยแพร่ก่อนนำออกนอกหน่วยงาน
      </AlertBanner>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PreviewCard({ label, value, sub, small }) {
  return (
    <div className="bg-surface rounded-lg p-3 text-center border border-surface-border">
      <p className={`font-semibold text-ink tabular-nums ${small ? 'text-sm' : 'text-xl'}`}>{value}</p>
      <p className="text-caption text-ink-muted">{label}</p>
      {sub && <p className="text-caption text-ink-muted">{sub}</p>}
    </div>
  );
}
