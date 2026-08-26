import { useState, useEffect, useCallback, useRef } from 'react';
import { FileBarChart, Bus, GraduationCap, Sunrise, Sunset} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import ExportButtons from '../../components/ExportButtons';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { StatusBadge, DataTable, FormField, AlertBanner} from '../../components/ui';

export default function DailyReport() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDecision, setShowDecision] = useState(false);
  const decisionResolveRef = useRef(null);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/reports/daily?date=${date}`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const thaiDate = date ? new Date(date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) : '';
  const mPct = data?.morning_total > 0 ? Math.round((data.morning_done / data.morning_total) * 100) : 0;
  const ePct = data?.evening_total > 0 ? Math.round((data.evening_done / data.evening_total) * 100) : 0;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      {/* ── HEADER ── */}
      <div className="bg-navy-700 text-white rounded-xl px-5 py-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-caption text-navy-200 uppercase tracking-wider">รายงานรายวัน</p>
            <h1 className="text-lg font-semibold">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</h1>
            <p className="text-sm text-navy-200 mt-0.5">{thaiDate}</p>
          </div>
          <FormField
            label="วันที่ของรายงาน"
            labelClassName="text-navy-200"
            className="sm:w-44"
          >
            {ctl => (
              <input {...ctl} type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="focus-ring-inverse w-full border border-navy-500 bg-navy-600 text-white rounded-lg px-3 min-h-[44px] text-base sm:text-sm" />
            )}
          </FormField>
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : !data ? (
        <EmptyState icon={FileBarChart} title="ไม่มีข้อมูล" description="ลองเปลี่ยนวันที่หรือช่วงเวลาอื่น" />
      ) : (
        <>
          {/* ── KPI 4 CARDS ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <KpiBox icon={Bus} label="รถรับส่ง" value={data.total_vehicles} sub="คัน" tone="brand" />
            <KpiBox icon={GraduationCap} label="นักเรียน" value={data.total_students} sub="คน" tone="brand" />
            <KpiBox icon={Sunrise} label="ส่งเช้าสำเร็จ" value={`${mPct}%`}
              sub={`${data.morning_done}/${data.morning_total} คน`}
              tone={mPct === 100 ? 'success' : mPct >= 80 ? 'warn' : 'danger'} />
            <KpiBox icon={Sunset} label="รับเย็นสำเร็จ" value={`${ePct}%`}
              sub={`${data.evening_done}/${data.evening_total} คน`}
              tone={ePct === 100 ? 'success' : ePct >= 80 ? 'warn' : 'danger'} />
          </div>

          {/* ── ALERT: จุดที่ต้องติดตาม ── */}
          {(() => {
            const alerts = [];
            if (data.morning_pending > 0) alerts.push(`รอส่งเช้า ${data.morning_pending} คน`);
            if (data.evening_pending > 0) alerts.push(`รอรับเย็น ${data.evening_pending} คน`);
            if (data.emergency_count > 0) alerts.push(`เหตุฉุกเฉิน ${data.emergency_count} รายการ`);
            return alerts.length > 0 ? (
              <AlertBanner variant="warn" title="จุดที่ต้องติดตาม" className="mb-5">
                <ul className="space-y-0.5 mt-1">
                  {alerts.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </AlertBanner>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-5 text-center">
                <p className="text-sm font-semibold text-green-700">✅ ดำเนินการครบทุกรายการ</p>
              </div>
            );
          })()}

          {/* ── สรุปรายโรงเรียน ── */}
          {data.schools?.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-ink mb-2">สรุปรายโรงเรียน</h2>
              <CompletionTable
                caption="สรุปการรับ-ส่งรายโรงเรียน"
                rows={data.schools}
                rowKey={s => s.school_id}
                labelHeader="โรงเรียน"
                label={s => s.school_name}
              />
            </section>
          )}

          {/* ── สรุปรายรถ ── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-ink mb-2">สรุปรายรถ</h2>
              <CompletionTable
                caption="สรุปการรับ-ส่งรายรถ"
                rows={data.vehicles}
                rowKey={v => v.vehicle_id}
                labelHeader="ทะเบียนรถ"
                label={v => v.plate_no}
              />
            </section>
          )}

          {/* ── FOOTER: Export + timestamp ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200">
            <ExportButtons queryParams={`date=${date}`} filenamePrefix={`report-${date}`}
              onBeforeExport={user?.role === 'province' ? (fmt) => new Promise((resolve, reject) => {
                if (fmt !== 'pdf') { resolve(); return; }
                decisionResolveRef.current = { resolve, reject };
                setShowDecision(true);
              }) : undefined}
            />
            <p className="text-xs text-gray-400">
              สร้างจากระบบรถรับส่งนักเรียนจังหวัดลำปาง · {new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
            </p>
          </div>
        </>
      )}

      {/* Province Decision Log Modal */}
      {showDecision && <DecisionLogModal
        onSubmit={async (decisionType, decisionNote) => {
          if (decisionType || decisionNote) {
            try {
              await api.post('/reports/decision-log', { decision_type: decisionType, decision_note: decisionNote, report_type: 'daily', report_date: date });
            } catch {}
          }
          setShowDecision(false);
          decisionResolveRef.current?.resolve();
        }}
        onSkip={() => { setShowDecision(false); decisionResolveRef.current?.resolve(); }}
        onCancel={() => { setShowDecision(false); decisionResolveRef.current?.reject(); }}
      />}
    </div>
  );
}

function DecisionLogModal({ onSubmit, onSkip, onCancel }) {
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const TYPES = [
    { value: 'follow_up', label: 'ติดตามผล' },
    { value: 'action_needed', label: 'ต้องดำเนินการ' },
    { value: 'info_only', label: 'รับทราบ' },
    { value: 'escalate', label: 'ส่งต่อผู้บังคับบัญชา' },
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">บันทึกการตัดสินใจ</h3>
        <p className="text-sm text-gray-500 mb-4">บันทึกสั้นๆ ก่อนดาวน์โหลด PDF (ไม่บังคับ)</p>
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">ประเภทการตัดสินใจ</label>
          <div className="flex flex-wrap gap-2">
            {TYPES.map(t => (
              <button key={t.value} onClick={() => setType(t.value)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${type === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">หมายเหตุ</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="เช่น จะประสานเรื่อง..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 text-sm text-gray-500 border border-gray-200 py-2 rounded-lg hover:bg-gray-50">ยกเลิก</button>
          <button onClick={onSkip} className="flex-1 text-sm text-gray-600 border border-gray-200 py-2 rounded-lg hover:bg-gray-50">ข้าม</button>
          <button onClick={() => onSubmit(type, note)} className="flex-1 text-sm bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium">บันทึก + ดาวน์โหลด</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The four report KPI tiles used an emoji as the icon (🚌 👨‍🎓 🌅 🌆) and a
 * hardcoded blue/green/red/amber palette. The emoji announced nothing useful
 * and did not print reliably; the tones now come from the semantic tokens and
 * the icons from Lucide, marked aria-hidden since the label says what the tile
 * is.
 */
function KpiBox({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const TONES = {
    brand:   'bg-brand-50     border-brand-200  text-brand-700',
    success: 'bg-success-soft border-success/30 text-success-ink',
    warn:    'bg-warn-soft    border-warn/30    text-warn-ink',
    danger:  'bg-danger-soft  border-danger/30  text-danger-ink',
  };
  const cls = TONES[tone] || TONES.brand;
  return (
    <div className={`rounded-xl border p-3 text-center ${cls.replace(/text-[\w-]+$/, '')}`}>
      {Icon && (
        <Icon className={`w-5 h-5 mx-auto mb-1 ${cls.split(' ').pop()}`} strokeWidth={2} aria-hidden="true" />
      )}
      <p className={`text-2xl font-bold tabular-nums ${cls.split(' ').pop()}`}>{value}</p>
      <p className="text-caption text-ink-muted">{label}</p>
      {sub && <p className="text-caption text-ink-muted tabular-nums">{sub}</p>}
    </div>
  );
}

/**
 * CompletionTable — the daily report's two summary tables (per school, per
 * vehicle) are the same table with a different label column, so they are one
 * component here rather than two near-identical blocks.
 *
 * The done/total cells used green-vs-amber text alone to say whether a session
 * was complete. The status column already carries that as a word, so the counts
 * stay neutral and the badge does the signalling.
 */
function CompletionTable({ caption, rows, rowKey, labelHeader, label }) {
  const done = (d, total) => `${d}/${total}`;
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={rowKey}
      columns={[
        { key: 'label', header: labelHeader, primary: true,
          cell: r => <span className="font-medium text-ink">{label(r)}</span> },
        { key: 'students', header: 'นักเรียน', numeric: true, cell: r => r.student_count },
        { key: 'morning', header: 'ส่งเช้า', numeric: true, cell: r => done(r.morning_done, r.student_count) },
        { key: 'evening', header: 'รับเย็น', numeric: true, cell: r => done(r.evening_done, r.student_count) },
        { key: 'status', header: 'สถานะ', align: 'center', badge: true,
          cell: r => {
            const ok = r.morning_done >= r.student_count && r.evening_done >= r.student_count;
            return <StatusBadge variant={ok ? 'success' : 'warn'}>{ok ? 'ครบ' : 'ค้าง'}</StatusBadge>;
          } },
      ]}
      empty={{ title: 'ไม่มีข้อมูลในวันที่เลือก' }}
    />
  );
}
