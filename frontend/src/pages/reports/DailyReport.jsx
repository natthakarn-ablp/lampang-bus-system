import { useState, useEffect, useCallback, useRef } from 'react';
import { FileBarChart } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import ExportButtons from '../../components/ExportButtons';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';

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
      <div className="bg-blue-800 text-white rounded-xl px-5 py-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wider">รายงานรายวัน</p>
            <h1 className="text-lg font-semibold">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</h1>
            <p className="text-sm text-blue-200 mt-0.5">{thaiDate}</p>
          </div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="border border-blue-600 bg-blue-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 sm:w-44" />
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
            <KpiBox icon="🚌" label="รถรับส่ง" value={data.total_vehicles} sub="คัน" color="blue" />
            <KpiBox icon="👨‍🎓" label="นักเรียน" value={data.total_students} sub="คน" color="blue" />
            <KpiBox icon="🌅" label="ส่งเช้าสำเร็จ" value={`${mPct}%`}
              sub={`${data.morning_done}/${data.morning_total} คน`}
              color={mPct === 100 ? 'green' : mPct >= 80 ? 'yellow' : 'red'} />
            <KpiBox icon="🌆" label="รับเย็นสำเร็จ" value={`${ePct}%`}
              sub={`${data.evening_done}/${data.evening_total} คน`}
              color={ePct === 100 ? 'green' : ePct >= 80 ? 'yellow' : 'red'} />
          </div>

          {/* ── ALERT: จุดที่ต้องติดตาม ── */}
          {(() => {
            const alerts = [];
            if (data.morning_pending > 0) alerts.push(`🌅 รอส่งเช้า ${data.morning_pending} คน`);
            if (data.evening_pending > 0) alerts.push(`🌆 รอรับเย็น ${data.evening_pending} คน`);
            if (data.emergency_count > 0) alerts.push(`🚨 เหตุฉุกเฉิน ${data.emergency_count} รายการ`);
            return alerts.length > 0 ? (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-5">
                <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ จุดที่ต้องติดตาม</p>
                {alerts.map((a, i) => <p key={i} className="text-sm text-amber-700">{a}</p>)}
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-5 text-center">
                <p className="text-sm font-semibold text-green-700">✅ ดำเนินการครบทุกรายการ</p>
              </div>
            );
          })()}

          {/* ── สรุปรายโรงเรียน ── */}
          {data.schools?.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">สรุปรายโรงเรียน</h2>
              <AppCard padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                    <tr className="text-left">
                      <th className="px-4 py-2.5">โรงเรียน</th>
                      <th className="px-4 py-2.5 text-center">นักเรียน</th>
                      <th className="px-4 py-2.5 text-center">ส่งเช้า</th>
                      <th className="px-4 py-2.5 text-center">รับเย็น</th>
                      <th className="px-4 py-2.5 text-center">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {data.schools.map((s) => {
                      const mOk = s.morning_done >= s.student_count;
                      const eOk = s.evening_done >= s.student_count;
                      return (
                        <tr key={s.school_id} className="hover:bg-surface transition">
                          <td className="px-4 py-2.5 text-gray-800 font-medium">{s.school_name}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{s.student_count}</td>
                          <td className={`px-4 py-2.5 text-center font-medium ${mOk ? 'text-green-600' : 'text-amber-600'}`}>
                            {s.morning_done}/{s.student_count}
                          </td>
                          <td className={`px-4 py-2.5 text-center font-medium ${eOk ? 'text-green-600' : 'text-amber-600'}`}>
                            {s.evening_done}/{s.student_count}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <StatusBadge variant={mOk && eOk ? 'success' : 'warn'} size="sm">
                              {mOk && eOk ? 'ครบ' : 'ค้าง'}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </AppCard>
            </section>
          )}

          {/* ── สรุปรายรถ ── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">สรุปรายรถ</h2>
              <AppCard padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                    <tr className="text-left">
                      <th className="px-4 py-2.5">ทะเบียนรถ</th>
                      <th className="px-4 py-2.5 text-center">นักเรียน</th>
                      <th className="px-4 py-2.5 text-center">ส่งเช้า</th>
                      <th className="px-4 py-2.5 text-center">รับเย็น</th>
                      <th className="px-4 py-2.5 text-center">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {data.vehicles.map((v) => {
                      const mOk = v.morning_done >= v.student_count;
                      const eOk = v.evening_done >= v.student_count;
                      return (
                        <tr key={v.vehicle_id} className="hover:bg-surface transition">
                          <td className="px-4 py-2.5 text-gray-800 font-medium">{v.plate_no}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{v.student_count}</td>
                          <td className={`px-4 py-2.5 text-center font-medium ${mOk ? 'text-green-600' : 'text-amber-600'}`}>
                            {v.morning_done}/{v.student_count}
                          </td>
                          <td className={`px-4 py-2.5 text-center font-medium ${eOk ? 'text-green-600' : 'text-amber-600'}`}>
                            {v.evening_done}/{v.student_count}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <StatusBadge variant={mOk && eOk ? 'success' : 'warn'} size="sm">
                              {mOk && eOk ? 'ครบ' : 'ค้าง'}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </AppCard>
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
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
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

function KpiBox({ icon, label, value, sub, color }) {
  const bg = { blue: 'bg-blue-50 border-blue-200', green: 'bg-green-50 border-green-200', red: 'bg-red-50 border-red-200', yellow: 'bg-amber-50 border-amber-200' };
  const text = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', yellow: 'text-amber-700' };
  return (
    <div className={`rounded-xl border-2 p-3 text-center ${bg[color] || bg.blue}`}>
      <p className="text-xl mb-0.5">{icon}</p>
      <p className={`text-2xl font-bold ${text[color] || text.blue}`}>{value}</p>
      <p className="text-xs text-gray-600">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
