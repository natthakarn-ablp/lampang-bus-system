import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';
import { safePct, kpiColor } from '../../utils/kpi';
import { PAGE_TITLES, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS } from '../../constants/uiLabels';

export default function ProvinceDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/province/dashboard')
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400 py-10 text-center text-lg">{UI_MESSAGES.LOADING}</p>;
  if (!data) return <p className="text-gray-400 py-10 text-center text-lg">{UI_MESSAGES.NO_DATA}</p>;

  const affs = data.affiliations ?? [];
  const problemSchools = data.schools_not_complete ?? [];
  const hasEmergency = data.recent_emergencies > 0;
  const hasPending = data.morning_pending > 0 || data.evening_pending > 0;

  // Build alerts
  const alerts = [];
  if (problemSchools.length > 0) alerts.push({ icon: '🏫', text: `${problemSchools.length} โรงเรียนยังมีรายการค้าง`, severity: 'red' });
  if (data.morning_pending > 20) alerts.push({ icon: '🌅', text: `รอส่งเช้า ${data.morning_pending} คน`, severity: data.morning_pending > 50 ? 'red' : 'amber' });
  if (data.evening_pending > 20) alerts.push({ icon: '🌆', text: `รอรับเย็น ${data.evening_pending} คน`, severity: data.evening_pending > 50 ? 'red' : 'amber' });
  if (hasEmergency) alerts.push({ icon: '🚨', text: `เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง (7 วัน)`, severity: 'red' });
  if ((data.leave_count ?? 0) > 10) alerts.push({ icon: '📝', text: `ลาวันนี้ ${data.leave_count} คน`, severity: 'amber' });

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">{PAGE_TITLES.PROVINCE_DASHBOARD}</h1>
        {data.date && (
          <p className="text-sm text-gray-400">
            ข้อมูล ณ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {/* ── 1. ALERT: สิ่งที่ต้องติดตามทันที ── */}
      {alerts.length > 0 ? (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 mb-5">
          <p className="text-base font-bold text-red-800 mb-2">⚠️ สิ่งที่ต้องติดตามทันที</p>
          <div className="space-y-1.5">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-center gap-2 text-sm font-medium ${a.severity === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
                <span>{a.icon}</span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-5 text-center">
          <p className="text-lg font-bold text-green-700">✅ ระบบปกติ — ทุกโรงเรียนดำเนินการครบ</p>
        </div>
      )}

      {/* ── 2. KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiBox icon="🚌" label="รถรับส่ง" value={data.total_vehicles}
          sub={`เฉลี่ย ${data.total_students > 0 ? Math.round(data.total_students / data.total_vehicles) : 0} คน/คัน`} color="blue" />
        <KpiBox icon="👨‍🎓" label="นักเรียน" value={data.total_students}
          sub={`${data.total_schools} ร.ร. · ${data.total_vehicles} คัน`} color="blue" />
        <KpiBox icon="🏫" label="โรงเรียน" value={data.total_schools}
          sub={`${data.total_affiliations} สังกัด · ค้าง ${problemSchools.length}`} color={problemSchools.length > 0 ? 'yellow' : 'blue'} />
        <KpiBox icon={hasPending ? '⏳' : '✅'}
          label={hasPending ? 'รอดำเนินการ' : 'ครบแล้ว'}
          value={hasPending ? data.morning_pending + data.evening_pending : '✓'}
          sub={hasPending ? `เช้า ${data.morning_pending} · เย็น ${data.evening_pending}` : 'ทุกรายการ'}
          color={hasPending ? (data.morning_pending + data.evening_pending > 50 ? 'red' : 'yellow') : 'green'} />
      </div>

      {/* ── 3. Morning / Evening Progress ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <SessionProgress
          label="🌅 ส่งเช้า" done={data.morning_done} total={data.morning_total}
          pending={data.morning_pending} leave={data.morning_leave ?? 0}
          kpi={data.morning_kpi} session="morning"
        />
        <SessionProgress
          label="🌆 รับเย็น" done={data.evening_done} total={data.evening_total}
          pending={data.evening_pending} leave={data.evening_leave ?? 0}
          kpi={data.evening_kpi} session="evening"
        />
      </div>

      {/* ── 4. โรงเรียนที่ยังมีรายการค้าง ── */}
      {problemSchools.length > 0 && (
        <section className="mb-5">
          <h2 className="text-base font-bold text-red-700 mb-3">
            🏫 โรงเรียนที่ยังมีรายการค้าง ({problemSchools.length} แห่ง)
          </h2>
          <div className="space-y-2">
            {problemSchools.map((s) => {
              const mTotal = s.morning_expected || 0;
              const mDone = s.morning_done || 0;
              const mPct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;
              const eDone = s.evening_done || 0;
              const eTotal = s.evening_expected || 0;
              const ePct = eTotal > 0 ? Math.round((eDone / eTotal) * 100) : 0;
              const totalPending = (s.morning_pending || 0) + (s.evening_pending || 0);

              return (
                <div key={s.school_id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-bold text-gray-800">{s.school_name}</p>
                      <p className="text-sm text-gray-500">👨‍🎓 {s.student_count} คน · 🚌 {s.vehicle_count} คัน</p>
                    </div>
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-full shrink-0 ${
                      totalPending > 20 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      รอ {totalPending}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniBar label="เช้า" done={mDone} total={mTotal} pct={mPct} />
                    <MiniBar label="เย็น" done={eDone} total={eTotal} pct={ePct} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 5. สรุปรายสังกัด ── */}
      {affs.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปรายสังกัด</h2>
          <div className="space-y-2">
            {affs.map(a => (
              <div key={a.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 text-sm truncate">{a.name}</p>
                  <p className="text-xs text-gray-500">{a.school_count} ร.ร. · {a.student_count} คน · {a.vehicle_count} คัน</p>
                </div>
                <div className="flex gap-3 text-sm shrink-0">
                  <span className={`font-bold ${kpiColor(a.morning_kpi)}`}>เช้า {safePct(a.morning_kpi)}</span>
                  <span className={`font-bold ${kpiColor(a.evening_kpi)}`}>เย็น {safePct(a.evening_kpi)}</span>
                  {a.emergency_count > 0 && <span className="text-red-600 font-bold">🚨 {a.emergency_count}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 6. Executive Summary ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-blue-800 mb-2">สรุปผู้บริหาร</h2>
        <ul className="text-sm text-blue-700 space-y-1 leading-relaxed">
          <li>• รถรับส่ง <strong>{data.total_vehicles} คัน</strong> ให้บริการ <strong>{data.total_students} คน</strong> ใน <strong>{data.total_schools} โรงเรียน</strong></li>
          <li>• KPI ส่งเช้า <strong className={kpiColor(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> · รับเย็น <strong className={kpiColor(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong></li>
          {problemSchools.length > 0
            ? <li>• <strong className="text-red-600">{problemSchools.length} โรงเรียน</strong>ยังมีรายการค้าง</li>
            : <li>• <strong className="text-green-600">ทุกโรงเรียนดำเนินการครบ</strong></li>}
          {hasEmergency && <li>• เหตุฉุกเฉิน <strong className="text-red-600">{data.recent_emergencies} ครั้ง</strong></li>}
        </ul>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

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

function SessionProgress({ label, done, total, pending, leave, kpi, session }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = pending === 0 && total > 0;

  return (
    <div className={`rounded-xl border-2 p-4 ${isComplete ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-gray-700">{label}</span>
        <span className={`text-xl font-bold ${isComplete ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
          {safePct(kpi)}
        </span>
      </div>
      {/* Progress bar */}
      <div className="flex w-full h-4 rounded-full overflow-hidden bg-gray-100 mb-2">
        {done > 0 && <div className="bg-green-500 h-full transition-all" style={{ width: `${pct}%` }} />}
        {pending > 0 && <div className="bg-red-400 h-full" style={{ width: `${Math.round((pending / total) * 100)}%` }} />}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span className="text-green-600 font-medium">✅ {done}/{total}</span>
        {pending > 0 && <span className="text-red-500 font-medium">รอ {pending}</span>}
        {leave > 0 && <span className="text-amber-600">ลา {leave}</span>}
      </div>
    </div>
  );
}

function MiniBar({ label, done, total, pct }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{done}/{total} ({pct}%)</span>
      </div>
      <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100">
        {done > 0 && <div className="bg-green-500 h-full" style={{ width: `${pct}%` }} />}
        {pct < 100 && <div className="bg-red-300 h-full" style={{ width: `${100 - pct}%` }} />}
      </div>
    </div>
  );
}
