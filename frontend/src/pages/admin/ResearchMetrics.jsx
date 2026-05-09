import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

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

function calcPct(num, den) {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 10000) / 100;
}

function calcDelta(current, baseline) {
  return Math.round((current - baseline) * 100) / 100;
}

function trendMeta(delta, higher) {
  if (delta === 0) return { icon: '=', cls: 'text-gray-500', label: 'คงเดิม' };
  const improved = higher ? delta > 0 : delta < 0;
  return improved
    ? { icon: '▲', cls: 'text-green-600', label: 'ดีขึ้น' }
    : { icon: '▼', cls: 'text-red-600', label: 'ลดลง' };
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ResearchMetrics() {
  const toast = useToast();
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBaselineId, setSelectedBaselineId] = useState(null);
  const [running, setRunning] = useState(false);
  const [showPreMeasure, setShowPreMeasure] = useState(false);

  useEffect(() => {
    api.get('/admin/snapshots?limit=50')
      .then(r => {
        const data = r.data?.data || [];
        setSnapshots(data);
        const firstBaseline = data.find(s => s.is_baseline);
        if (firstBaseline) setSelectedBaselineId(firstBaseline.id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      const data = r.data?.data || [];
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

  if (loading) return <p className="text-gray-400 py-10 text-center text-lg">กำลังโหลด…</p>;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div className="bg-blue-800 text-white rounded-xl px-5 py-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wider">Research Evaluation</p>
            <h1 className="text-lg font-bold">เปรียบเทียบ Baseline กับสถานะปัจจุบัน</h1>
            <p className="text-sm text-blue-200 mt-0.5">ดูความเปลี่ยนแปลงของข้อมูลหลักจาก baseline</p>
          </div>
          <span className="bg-blue-600 text-blue-100 text-xs font-medium px-3 py-1.5 rounded-full shrink-0">Admin only</span>
        </div>
      </div>

      {/* Baseline selector + actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            {baselines.length > 0 ? (
              <div>
                <label className="text-xs text-gray-500">Baseline อ้างอิง:</label>
                <select value={selectedBaselineId || ''} onChange={e => setSelectedBaselineId(Number(e.target.value))}
                  className="ml-2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  {baselines.map(b => (
                    <option key={b.id} value={b.id}>
                      {fmtDate(b.snapshot_date)} {b.baseline_note ? `— ${b.baseline_note}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-amber-700 font-medium">⚠️ ยังไม่มี baseline — กดปุ่มด้านขวาเพื่อสร้าง</p>
            )}
            {latest && <p className="text-xs text-gray-400 mt-1">Snapshot ล่าสุด: {fmtDate(latest.snapshot_date)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleRunSnapshot(false)} disabled={running}
              className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg transition disabled:opacity-50">
              {running ? '...' : '📸 Snapshot วันนี้'}
            </button>
            <button onClick={() => handleRunSnapshot(true)} disabled={running}
              className="text-sm bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-4 py-2 rounded-lg transition disabled:opacity-50">
              {running ? '...' : '🔖 สร้าง Baseline'}
            </button>
            <button onClick={() => setShowPreMeasure(true)} disabled={running}
              className="text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-4 py-2 rounded-lg transition disabled:opacity-50 font-medium">
              {running ? '...' : '🔬 Baseline (Pre-measure)'}
            </button>
          </div>
        </div>
      </div>

      {/* No data state */}
      {!baseline && !latest ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl border border-gray-200">
          <p className="text-3xl mb-3">📊</p>
          <p className="text-lg font-semibold text-gray-600">ยังไม่มี snapshot</p>
          <p className="text-sm text-gray-400 mt-1">กด "สร้าง Baseline" เพื่อเริ่มเก็บข้อมูลเปรียบเทียบ</p>
        </div>
      ) : (
        <>
          {/* KPI comparison cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {METRICS.map(m => {
              const bVal = baseline ? calcPct(baseline[m.num], baseline[m.den]) : null;
              const cVal = latest ? calcPct(latest[m.num], latest[m.den]) : null;
              const delta = bVal !== null && cVal !== null ? calcDelta(cVal, bVal) : null;
              const trend = delta !== null ? trendMeta(delta, m.higher) : null;

              return (
                <div key={m.key} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                  <p className="text-2xl font-bold text-gray-800">{cVal !== null ? `${cVal}%` : '-'}</p>
                  {trend && delta !== null && (
                    <p className={`text-sm font-medium mt-0.5 ${trend.cls}`}>
                      {trend.icon} {delta > 0 ? '+' : ''}{delta}%
                    </p>
                  )}
                  {bVal !== null && <p className="text-xs text-gray-400 mt-0.5">baseline: {bVal}%</p>}
                </div>
              );
            })}
          </div>

          {/* Detail comparison table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">ตัวชี้วัด</th>
                  <th className="px-4 py-3 font-medium text-center">Baseline</th>
                  <th className="px-4 py-3 font-medium text-center">ปัจจุบัน</th>
                  <th className="px-4 py-3 font-medium text-center">เปลี่ยนแปลง</th>
                  <th className="px-4 py-3 font-medium text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {METRICS.map(m => {
                  const bNum = baseline?.[m.num] ?? 0;
                  const bDen = baseline?.[m.den] ?? 0;
                  const cNum = latest?.[m.num] ?? 0;
                  const cDen = latest?.[m.den] ?? 0;
                  const bVal = calcPct(bNum, bDen);
                  const cVal = calcPct(cNum, cDen);
                  const delta = baseline && latest ? calcDelta(cVal, bVal) : null;
                  const trend = delta !== null ? trendMeta(delta, m.higher) : null;

                  return (
                    <tr key={m.key} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-800 font-medium">{m.label}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">
                        {baseline ? `${bVal}% (${bNum}/${bDen})` : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-800 font-medium">
                        {latest ? `${cVal}% (${cNum}/${cDen})` : '-'}
                      </td>
                      <td className={`px-4 py-2.5 text-center font-bold ${trend?.cls || 'text-gray-400'}`}>
                        {delta !== null ? `${trend.icon} ${delta > 0 ? '+' : ''}${delta}%` : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {trend ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            trend.label === 'ดีขึ้น' ? 'bg-green-100 text-green-700' :
                            trend.label === 'ลดลง' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{trend.label}</span>
                        ) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Snapshot history */}
          <details className="bg-white rounded-xl border border-gray-200">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600 hover:bg-gray-50">
              📋 ประวัติ Snapshot ({snapshots.length} รายการ)
            </summary>
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {snapshots.slice(0, 20).map(s => (
                <div key={s.id} className="px-4 py-2 flex items-center justify-between text-sm">
                  <div>
                    <span className="text-gray-800">{fmtDate(s.snapshot_date)}</span>
                    {s.is_baseline && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Baseline</span>}
                    {s.research_phase && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">{s.research_phase}</span>}
                    <span className="ml-2 text-xs text-gray-400">{s.run_type}</span>
                  </div>
                  <span className="text-xs text-gray-400">{s.baseline_note || ''}</span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      {/* Pre-measure Baseline Confirmation Modal */}
      {showPreMeasure && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-purple-800 mb-2">บันทึก Baseline (Pre-measure)</h3>
            <p className="text-sm text-gray-600 mb-3">
              ระบบจะบันทึก snapshot ปัจจุบันเป็น <strong>Baseline สำหรับการวิจัย R2 (Pre-measure)</strong>
            </p>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4 text-sm text-purple-700 space-y-1">
              <p><strong>วันที่:</strong> {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p><strong>ประเภท:</strong> Research Baseline — Pre-measure</p>
              <p><strong>หมายเหตุ:</strong> ข้อมูลนี้จะถูกแยกจาก snapshot ปกติในการส่งออกงานวิจัย</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs text-amber-700">
              ห้ามบันทึก baseline ซ้ำภายใน 24 ชั่วโมง — หากมี baseline อยู่แล้วระบบจะแจ้งเตือน
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowPreMeasure(false)}
                className="flex-1 text-sm text-gray-600 border border-gray-300 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition">
                ยกเลิก
              </button>
              <button
                onClick={() => handleRunSnapshot(true, 'pre-measure', 'Research R2 Pre-measure Baseline')}
                disabled={running}
                className="flex-1 text-sm bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2.5 rounded-lg transition disabled:opacity-50">
                {running ? 'กำลังบันทึก...' : 'ยืนยันบันทึก Baseline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
